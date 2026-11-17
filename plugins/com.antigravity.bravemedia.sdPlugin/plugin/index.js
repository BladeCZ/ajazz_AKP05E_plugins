'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert');
const WebSocket = require('ws');

const POLL_MS = 2000;
const LONG_PRESS_MS = 550;
const VOLUME_HIGHLIGHT_MS = 3000;
const SMTC_SCRIPT = path.join(__dirname, 'smtc.ps1');
const LOG_PATH = path.join(__dirname, 'plugin.log');
const LOG_MAX_BYTES = 256 * 1024;

const DEFAULT_SETTINGS = {
  displayMode: 'svg',       // 'svg' | 'title'
  knobMode: 'volume',       // 'volume' | 'track' | 'none'
  volumeStep: '5',          // '2' | '5' | '10'
  pressAction: 'playpause', // 'playpause' | 'next' | 'prev' | 'mute' | 'none'
  doublePressAction: 'next',// 'next' | 'prev' | 'mute' | 'playpause' | 'none'
  triplePressAction: 'prev',// 'prev' | 'next' | 'mute' | 'playpause' | 'none'
  longPressAction: 'mute',  // 'mute' | 'next' | 'prev' | 'playpause' | 'none'
  multiPressDelay: '350',   // '250' | '350' | '450'
  showThumbnail: 'true',    // 'true' | 'false'
  overlayOpacity: '0.45',   // '0.30' | '0.45' | '0.65'
  textStrokeWidth: '3',     // '0' | '2' | '3' | '4'
  stripArtist: 'true',      // 'true' | 'false'
};

function mergeSettings(raw) {
  return Object.assign({}, DEFAULT_SETTINGS, raw || {});
}

function logMsg(msg) {
  try {
    const st = fs.statSync(LOG_PATH, { throwIfNoEntry: false });
    if (st && st.size > LOG_MAX_BYTES) fs.truncateSync(LOG_PATH, 0);
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${msg}\n`, 'utf8');
  } catch {
    // Logging must never crash the plugin
  }
}

process.on('uncaughtException', (err) => logMsg('uncaughtException: ' + (err && err.stack ? err.stack : err)));
process.on('unhandledRejection', (err) => logMsg('unhandledRejection: ' + err));

function parseArgs(argv) {
  const result = {
    port: '',
    pluginUUID: '',
    registerEvent: '',
    info: '',
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-port' && i + 1 < argv.length) result.port = argv[++i];
    else if (arg === '-pluginUUID' && i + 1 < argv.length) result.pluginUUID = argv[++i];
    else if (arg === '-registerEvent' && i + 1 < argv.length) result.registerEvent = argv[++i];
    else if (arg === '-info' && i + 1 < argv.length) result.info = argv[++i];
  }
  if (!result.port && argv[3]) result.port = argv[3];
  if (!result.pluginUUID && argv[5]) result.pluginUUID = argv[5];
  if (!result.registerEvent && argv[7]) result.registerEvent = argv[7];
  if (!result.info && argv[9]) result.info = argv[9];
  return result;
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripArtistPrefix(title, artist) {
  const cleanTitle = String(title || '').trim();
  const cleanArtist = String(artist || '').trim();
  if (!cleanTitle || !cleanArtist) return cleanTitle;

  const candidates = [cleanArtist];
  const noSuffix = cleanArtist.replace(/\s*(?:-\s*Topic|Official)\s*$/i, '').trim();
  if (noSuffix && noSuffix !== cleanArtist) {
    candidates.push(noSuffix);
  }

  for (const cand of candidates) {
    if (!cand) continue;
    const re = new RegExp('^\\s*' + escapeRegExp(cand) + '\\s*[-–—:|]+\\s*(.+)$', 'i');
    const m = cleanTitle.match(re);
    if (m && m[1] && m[1].trim()) {
      return m[1].trim();
    }
  }
  return cleanTitle;
}

function wrapText(text, maxCharsPerLine) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const words = clean.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    if (word.length > maxCharsPerLine) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += maxCharsPerLine) {
        const chunk = word.slice(i, i + maxCharsPerLine);
        if (chunk.length === maxCharsPerLine) {
          lines.push(chunk);
        } else {
          current = chunk;
        }
      }
      continue;
    }

    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function wrapAndWindow(text, maxCharsPerLine, visibleLines, tick) {
  const lines = wrapText(text, maxCharsPerLine);
  if (lines.length === 0) return [];
  if (lines.length <= visibleLines) return lines;

  const maxOffset = lines.length - visibleLines;
  const cycleLen = maxOffset + 3; // 1-tick pause at start and 1-tick pause at end
  const pos = ((tick % cycleLen) + cycleLen) % cycleLen;

  let offset;
  if (pos === 0) offset = 0;
  else if (pos >= maxOffset + 1) offset = maxOffset;
  else offset = pos - 1;

  return lines.slice(offset, offset + visibleLines);
}

function renderOutlinedText(x, y, rawOrEscapedText, fontSize, fontWeight, fillColor, strokeWidth, isPreEscaped) {
  const text = isPreEscaped ? String(rawOrEscapedText || '') : escapeXml(rawOrEscapedText);
  const fill = fillColor || '#FFFFFF';
  const sw = Number(strokeWidth !== undefined ? strokeWidth : 3);
  const common = `x="${x}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" text-anchor="middle"`;
  if (sw > 0) {
    return (
      `<text ${common} fill="${fill}" stroke="#000000" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke fill">${text}</text>` +
      `<text ${common} fill="${fill}">${text}</text>`
    );
  }
  return `<text ${common} fill="${fill}">${text}</text>`;
}

function renderButtonSvg(state, tick, actionUUID, rawSettings, isVolumeHighlighted) {
  const settings = mergeSettings(rawSettings);
  const found = Boolean(state && state.found && state.title);
  const status = (state && state.status) || 'Closed';
  const isPlaying = found && status === 'Playing';
  const isPaused = found && status === 'Paused';
  const hasVol = Boolean(state && typeof state.volume === 'number' && state.volume >= 0);
  const vol = hasVol ? Math.max(0, Math.min(100, Math.round(state.volume))) : null;
  const muted = Boolean(state && state.muted);

  const rawSw = Number(settings.textStrokeWidth);
  const strokeW = Number.isFinite(rawSw) && rawSw >= 0 ? rawSw : 3;
  const rawOv = Number(settings.overlayOpacity);
  const overlayOpacity = Number.isFinite(rawOv) ? Math.max(0, Math.min(0.95, rawOv)).toString() : '0.45';

  let bgSvg = `<rect width="144" height="144" fill="#12141a"/>`;
  if (settings.showThumbnail !== 'false' && state && typeof state.thumbnail === 'string' && state.thumbnail.startsWith('data:image/')) {
    const safeThumb = escapeXml(state.thumbnail);
    bgSvg +=
      `<image x="0" y="0" width="144" height="144" href="${safeThumb}" xlink:href="${safeThumb}" preserveAspectRatio="xMidYMid slice"/>` +
      `<rect x="0" y="0" width="144" height="144" fill="#000000" fill-opacity="${overlayOpacity}" style="fill: rgba(0,0,0,${overlayOpacity});"/>`;
  }

  // Top bar (y=6..32): shows artist name normally, switches temporarily to volume bar on change
  const topStrokeW = Math.min(strokeW, 2.5);
  let topBarSvg = '';

  if (isVolumeHighlighted && hasVol) {
    const volColor = muted ? '#dc2626' : vol <= 35 ? '#0284c7' : vol <= 75 ? '#16a34a' : '#ea580c';
    const volFillW = muted ? 132 : Math.round((132 * vol) / 100);
    const volLabel = muted ? 'HLASITOST: MUTE' : `HLASITOST: ${vol}%`;
    topBarSvg =
      `<rect x="6" y="6" width="132" height="26" rx="7" fill="#1e293b" fill-opacity="0.9"/>` +
      (volFillW > 0 ? `<rect x="6" y="6" width="${volFillW}" height="26" rx="7" fill="${volColor}"/>` : '') +
      renderOutlinedText(72, 24, volLabel, 15, 700, '#FFFFFF', topStrokeW, false);
  } else {
    let topBarFill = '#334155';
    let topBarText = 'BRAVE';
    const cleanArtist = state && state.artist ? String(state.artist).replace(/\s*-\s*Topic\s*$/i, '').trim() : '';

    if (found && cleanArtist) {
      const artistLine = wrapAndWindow(cleanArtist, 13, 1, tick)[0] || cleanArtist;
      if (muted && hasVol) {
        topBarFill = '#dc2626';
        topBarText = `MUTE &#8226; ${escapeXml(artistLine)}`;
      } else if (isPaused) {
        topBarFill = '#d97706';
        topBarText = `&#9208; ${escapeXml(artistLine)}`;
      } else {
        topBarFill = '#16a34a';
        topBarText = escapeXml(artistLine);
      }
    } else if (muted && hasVol) {
      topBarFill = '#dc2626';
      topBarText = 'MUTE';
    } else if (isPlaying) {
      topBarFill = '#16a34a';
      topBarText = '&#9654; BRAVE';
    } else if (isPaused) {
      topBarFill = '#d97706';
      topBarText = '&#9208; PAUZA';
    }

    topBarSvg =
      `<rect x="6" y="6" width="132" height="26" rx="7" fill="${topBarFill}" fill-opacity="0.88"/>` +
      renderOutlinedText(72, 24, topBarText, 15, 700, '#FFFFFF', topStrokeW, true);
  }

  // Middle track title or idle state
  let bodySvg = '';
  if (!found) {
    if (actionUUID === 'com.antigravity.bravemedia.volume' && hasVol) {
      const volText = muted ? 'MUTE' : `${vol}%`;
      bodySvg =
        renderOutlinedText(72, 82, volText, 30, 700, '#FFFFFF', strokeW, false) +
        renderOutlinedText(72, 112, 'Hlasitost Brave', 14, 600, '#FFFFFF', Math.min(strokeW, 2.5), false);
    } else {
      bodySvg =
        `<circle cx="72" cy="64" r="16" fill="none" stroke="#94a3b8" stroke-width="3"/>` +
        `<line x1="60" y1="76" x2="84" y2="52" stroke="#fb542b" stroke-width="3" stroke-linecap="round"/>` +
        renderOutlinedText(72, 110, 'Nic nehraje', 18, 700, '#FFFFFF', strokeW, false);
    }
  } else {
    const displayTitle = settings.stripArtist !== 'false' ? stripArtistPrefix(state.title, state.artist) : state.title;
    const titleLines = wrapAndWindow(displayTitle, 11, 2, tick);

    if (titleLines.length === 1) {
      bodySvg += renderOutlinedText(72, 88, titleLines[0], 24, 700, '#FFFFFF', strokeW, false);
    } else {
      bodySvg += renderOutlinedText(72, 68, titleLines[0] || '', 22, 700, '#FFFFFF', strokeW, false);
      bodySvg += renderOutlinedText(72, 104, titleLines[1] || '', 22, 700, '#FFFFFF', strokeW, false);
    }
  }

  // Bottom playback timeline progress bar (y=132..138)
  const endTime = state && typeof state.endTime === 'number' ? state.endTime : 0;
  const position = state && typeof state.position === 'number' ? state.position : 0;
  const ratio = found && endTime > 0 ? Math.max(0, Math.min(1, position / endTime)) : 0;
  const progW = Math.round(124 * ratio);
  const progColor = isPlaying ? '#22c55e' : '#f59e0b';
  const progressBarSvg =
    `<rect x="10" y="132" width="124" height="6" rx="3" fill="#1e293b" fill-opacity="0.85" stroke="#000000" stroke-width="1"/>` +
    (progW > 0 ? `<rect x="10" y="132" width="${progW}" height="6" rx="3" fill="${progColor}"/>` : '');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="144" height="144" viewBox="0 0 144 144">` +
    bgSvg +
    `<rect x="1" y="1" width="142" height="142" rx="14" fill="none" stroke="#242936" stroke-width="2"/>` +
    topBarSvg +
    bodySvg +
    progressBarSvg +
    `</svg>`
  );
}

function formatPlainTitle(state, tick, actionUUID, rawSettings) {
  const settings = mergeSettings(rawSettings);
  const hasVol = Boolean(state && typeof state.volume === 'number' && state.volume >= 0);
  const volStr = hasVol ? (state.muted ? 'MUTE' : `${Math.round(state.volume)}%`) : '';
  if (!state || !state.found || !state.title) {
    if (actionUUID === 'com.antigravity.bravemedia.volume' && hasVol) {
      return `Brave\n${volStr}`;
    }
    return hasVol ? `Nic nehraje\n${volStr}` : 'Nic nehraje';
  }
  const displayTitle = settings.stripArtist !== 'false' ? stripArtistPrefix(state.title, state.artist) : state.title;
  const titleLines = wrapAndWindow(displayTitle, 10, 2, tick);
  const artistLines = state.artist ? wrapAndWindow(state.artist, 10, 1, tick) : [];
  const all = [...titleLines];
  if (artistLines.length > 0) all.push(artistLines[0]);
  if (hasVol && actionUUID === 'com.antigravity.bravemedia.volume') {
    all.push(volStr);
  }
  return all.join('\n');
}

function createGestureTracker(onTrigger, scheduler) {
  const sched = scheduler || {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const states = new Map();

  function getEntry(context) {
    let entry = states.get(context);
    if (!entry) {
      entry = {
        clickCount: 0,
        clickTimer: null,
        longTimer: null,
        isKeyDown: false,
        longFired: false,
        lastSettings: DEFAULT_SETTINGS,
      };
      states.set(context, entry);
    }
    return entry;
  }

  function clearClickTimer(entry) {
    if (entry.clickTimer !== null) {
      sched.clearTimeout(entry.clickTimer);
      entry.clickTimer = null;
    }
  }

  function clearLongTimer(entry) {
    if (entry.longTimer !== null) {
      sched.clearTimeout(entry.longTimer);
      entry.longTimer = null;
    }
  }

  function registerShortPress(context, rawSettings) {
    const settings = mergeSettings(rawSettings);
    const entry = getEntry(context);
    entry.lastSettings = settings;

    const singleAct = settings.pressAction;
    const doubleAct = settings.doublePressAction;
    const tripleAct = settings.triplePressAction;
    const multiDelay = Number(settings.multiPressDelay) || 350;

    if (doubleAct === 'none' && tripleAct === 'none') {
      clearClickTimer(entry);
      entry.clickCount = 0;
      if (singleAct !== 'none') onTrigger(singleAct, settings, context);
      return;
    }

    entry.clickCount += 1;
    clearClickTimer(entry);

    if (entry.clickCount >= 3 && tripleAct !== 'none') {
      entry.clickCount = 0;
      onTrigger(tripleAct, settings, context);
      return;
    }

    if (entry.clickCount === 2 && tripleAct === 'none' && doubleAct !== 'none') {
      entry.clickCount = 0;
      onTrigger(doubleAct, settings, context);
      return;
    }

    entry.clickTimer = sched.setTimeout(() => {
      const count = entry.clickCount;
      entry.clickCount = 0;
      entry.clickTimer = null;
      const s = entry.lastSettings || settings;
      let actionToRun = s.pressAction;
      if (count === 2) {
        actionToRun = s.doublePressAction !== 'none' ? s.doublePressAction : s.pressAction;
      } else if (count >= 3) {
        if (s.triplePressAction !== 'none') actionToRun = s.triplePressAction;
        else if (s.doublePressAction !== 'none') actionToRun = s.doublePressAction;
        else actionToRun = s.pressAction;
      }
      if (actionToRun && actionToRun !== 'none') {
        onTrigger(actionToRun, s, context);
      }
    }, multiDelay);
  }

  function onKeyDown(context, rawSettings) {
    const settings = mergeSettings(rawSettings);
    const entry = getEntry(context);
    entry.isKeyDown = true;
    entry.longFired = false;
    entry.lastSettings = settings;
    clearLongTimer(entry);

    if (settings.longPressAction && settings.longPressAction !== 'none') {
      entry.longTimer = sched.setTimeout(() => {
        entry.longTimer = null;
        entry.longFired = true;
        clearClickTimer(entry);
        entry.clickCount = 0;
        const s = entry.lastSettings || settings;
        if (s.longPressAction && s.longPressAction !== 'none') {
          onTrigger(s.longPressAction, s, context);
        }
      }, LONG_PRESS_MS);
    }
  }

  function onKeyUp(context, rawSettings) {
    const settings = mergeSettings(rawSettings);
    const entry = getEntry(context);
    entry.isKeyDown = false;
    clearLongTimer(entry);

    if (entry.longFired) {
      entry.longFired = false;
      return;
    }
    registerShortPress(context, settings);
  }

  function onDialDown(context, rawSettings) {
    registerShortPress(context, rawSettings);
  }

  function clearContext(context) {
    const entry = states.get(context);
    if (!entry) return;
    clearClickTimer(entry);
    clearLongTimer(entry);
    states.delete(context);
  }

  return {
    registerShortPress,
    onKeyDown,
    onKeyUp,
    onDialDown,
    clearContext,
  };
}

function executeGestureAction(actionType, settings, bridge, onVolumeTrigger) {
  switch (actionType) {
    case 'playpause':
      bridge.togglePlayPause();
      setTimeout(() => bridge.poll(), 450);
      break;
    case 'next':
      bridge.nextTrack();
      setTimeout(() => bridge.poll(), 450);
      setTimeout(() => bridge.poll(), 900);
      break;
    case 'prev':
      bridge.prevTrack();
      setTimeout(() => bridge.poll(), 450);
      setTimeout(() => bridge.poll(), 900);
      break;
    case 'mute':
      if (onVolumeTrigger) onVolumeTrigger();
      bridge.toggleMute();
      break;
    case 'none':
    default:
      break;
  }
}

class SmtcBridge {
  constructor(onState) {
    this.onState = onState;
    this.child = null;
    this.buf = '';
    this.closing = false;
    this.cachedThumbnail = '';
    this.cachedThumbKey = '';
    this.latestState = {
      ok: true,
      found: false,
      status: 'Closed',
      title: '',
      artist: '',
      volume: -1,
      muted: false,
      position: 0,
      endTime: 0,
      thumbnail: '',
    };
  }

  start() {
    if (this.closing || this.child) return;
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SMTC_SCRIPT],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    this.child = child;
    this.buf = '';

    child.stdout.on('data', (chunk) => {
      this.buf += chunk.toString('utf8');
      let nl;
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          const key = `${parsed.title || ''}|${parsed.artist || ''}`;
          if (!parsed.found) {
            this.cachedThumbnail = '';
            this.cachedThumbKey = '';
          } else if (typeof parsed.thumbnail === 'string' && parsed.thumbnail.startsWith('data:image/')) {
            this.cachedThumbnail = parsed.thumbnail;
            this.cachedThumbKey = key;
          } else if (key !== this.cachedThumbKey) {
            this.cachedThumbnail = '';
            this.cachedThumbKey = key;
          }
          parsed.thumbnail = this.cachedThumbnail;
          this.latestState = parsed;
          if (this.onState) this.onState(parsed);
        } catch (e) {
          logMsg('SMTC parse error: ' + e.message + ' | line: ' + line);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const errTxt = chunk.toString('utf8').trim();
      if (errTxt) logMsg('SMTC stderr: ' + errTxt);
    });

    child.on('close', (code) => {
      if (this.child === child) this.child = null;
      if (!this.closing) {
        logMsg('SMTC helper exited with code ' + code + ', restarting in 2s');
        setTimeout(() => this.start(), 2000);
      }
    });

    child.on('error', (err) => {
      logMsg('SMTC spawn error: ' + err.message);
    });
  }

  sendCommand(cmd) {
    if (!this.child) this.start();
    if (this.child && this.child.stdin && !this.child.stdin.destroyed) {
      try {
        this.child.stdin.write(cmd + '\n');
      } catch (e) {
        logMsg('SMTC write error: ' + e.message);
      }
    }
  }

  poll() {
    this.sendCommand('POLL');
  }

  togglePlayPause() {
    this.sendCommand('TOGGLE');
  }

  nextTrack() {
    this.sendCommand('NEXT');
  }

  prevTrack() {
    this.sendCommand('PREV');
  }

  adjustVolume(delta) {
    this.sendCommand('VOL_DELTA:' + Math.round(delta));
  }

  toggleMute() {
    this.sendCommand('MUTE_TOGGLE');
  }

  stop() {
    this.closing = true;
    if (this.child) {
      try {
        if (this.child.stdin && !this.child.stdin.destroyed) {
          this.child.stdin.write('QUIT\n');
        }
      } catch {}
      try {
        this.child.kill();
      } catch {}
      this.child = null;
    }
  }
}

function selftest() {
  // Test XML escaping
  assert.strictEqual(escapeXml('A & B <C> "D" \'E\''), 'A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;');

  // Test short wrapping
  assert.deepStrictEqual(wrapAndWindow('Short Song', 12, 2, 0), ['Short Song']);

  // Test long wrapping and scrolling cycle (with 1-tick start/end pauses)
  const longTitle = 'Very Long Song Title That Wraps Into Multiple Lines For Testing';
  const wrapped = wrapText(longTitle, 12);
  assert.ok(wrapped.length >= 4, 'Long title should wrap into 4+ lines');
  const win0 = wrapAndWindow(longTitle, 12, 2, 0);
  const win1 = wrapAndWindow(longTitle, 12, 2, 1);
  const win2 = wrapAndWindow(longTitle, 12, 2, 2);
  assert.deepStrictEqual(win0, wrapped.slice(0, 2));
  assert.deepStrictEqual(win1, wrapped.slice(0, 2)); // 1-tick pause at start
  assert.deepStrictEqual(win2, wrapped.slice(1, 3)); // scrolls down

  // Test SVG output when nothing is playing
  const svgEmpty = renderButtonSvg({ ok: true, found: false, status: 'Closed', title: '', artist: '', volume: -1, muted: false }, 0);
  assert.ok(svgEmpty.includes('Nic nehraje'));
  assert.ok(svgEmpty.startsWith('<svg ') && svgEmpty.endsWith('</svg>'));

  // Test SVG output with thumbnail background, dark overlay, outlined text, top volume bar & bottom progress bar
  const fakeThumb = 'data:image/jpeg;base64,/9j/4AAQ';
  const svgPlay = renderButtonSvg(
    {
      ok: true,
      found: true,
      status: 'Playing',
      title: 'Track & Roll',
      artist: 'Artist <1>',
      volume: 75,
      muted: false,
      position: 50,
      endTime: 100,
      thumbnail: fakeThumb,
    },
    0,
    'com.antigravity.bravemedia.nowplaying',
    { showThumbnail: 'true', overlayOpacity: '0.45', textStrokeWidth: '3' },
    false
  );
  assert.ok(svgPlay.includes(`href="${fakeThumb}"`));
  assert.ok(svgPlay.includes(`xlink:href="${fakeThumb}"`));
  assert.ok(svgPlay.includes('preserveAspectRatio="xMidYMid slice"'));
  assert.ok(svgPlay.includes('rgba(0,0,0,0.45)'));
  assert.ok(svgPlay.includes('fill="#FFFFFF" stroke="#000000" stroke-width="3" stroke-linejoin="round" paint-order="stroke fill"'));
  assert.ok(!svgPlay.includes('75%')); // Volume percentage hidden when not manipulating volume
  assert.ok(svgPlay.includes('Artist &lt;1&gt;'));
  assert.ok(svgPlay.includes('font-size="22"'));
  assert.ok(svgPlay.includes('width="62"')); // bottom progress bar: 124 * 0.50 = 62
  assert.ok(svgPlay.includes('Track &amp;'));
  assert.ok(svgPlay.includes('Roll'));

  // Test disabling thumbnail, changing stroke width to 0, and temporary volume bar on change
  const svgNoThumb = renderButtonSvg(
    {
      ok: true,
      found: true,
      status: 'Playing',
      title: 'Song',
      artist: 'Band',
      volume: 25,
      muted: false,
      position: 25,
      endTime: 100,
      thumbnail: fakeThumb,
    },
    0,
    'com.antigravity.bravemedia.nowplaying',
    { showThumbnail: 'false', textStrokeWidth: '0' },
    true
  );
  assert.ok(!svgNoThumb.includes('<image '));
  assert.ok(!svgNoThumb.includes('paint-order="stroke fill"'));
  assert.ok(svgNoThumb.includes('HLASITOST: 25%'));
  assert.ok(svgNoThumb.includes('width="33"')); // top volume bar: 132 * 0.25 = 33
  assert.ok(svgNoThumb.includes('font-size="24"')); // 1-line enlarged track title

  // Test SVG output when muted
  const svgMute = renderButtonSvg({ ok: true, found: false, status: 'Closed', title: '', artist: '', volume: 50, muted: true }, 0, 'com.antigravity.bravemedia.volume');
  assert.ok(svgMute.includes('MUTE'));

  // Test artist prefix stripping
  assert.strictEqual(stripArtistPrefix('Steve Sniff - Není to v poho', 'Steve Sniff'), 'Není to v poho');
  assert.strictEqual(stripArtistPrefix('Vladis  - Výhra(off.audio)', 'Vladis'), 'Výhra(off.audio)');
  assert.strictEqual(stripArtistPrefix('Indy - S tebou', 'Indy - Topic'), 'S tebou');
  assert.strictEqual(stripArtistPrefix('Song by Steve Sniff', 'Steve Sniff'), 'Song by Steve Sniff');
  assert.strictEqual(stripArtistPrefix('Steve Sniff', 'Steve Sniff'), 'Steve Sniff');

  // Test plain title formatting
  assert.strictEqual(formatPlainTitle({ found: false }, 0), 'Nic nehraje');
  assert.strictEqual(formatPlainTitle({ found: true, title: 'Song', artist: 'Band' }, 0), 'Song\nBand');
  assert.strictEqual(formatPlainTitle({ found: true, title: 'Band - Song', artist: 'Band' }, 0), 'Song\nBand');
  assert.strictEqual(formatPlainTitle({ found: true, title: 'Band - Song', artist: 'Band' }, 0, '', { stripArtist: 'false' }), 'Band -\nSong\nBand');

  // Test deterministic gesture engine (1x, 2x, 3x, long press)
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const fakeSched = {
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  function advance(ms) {
    const target = now + ms;
    while (true) {
      let earliestId = null;
      let earliestAt = Infinity;
      for (const [id, t] of timers.entries()) {
        if (t.at <= target && t.at < earliestAt) {
          earliestAt = t.at;
          earliestId = id;
        }
      }
      if (earliestId === null) break;
      const t = timers.get(earliestId);
      timers.delete(earliestId);
      now = t.at;
      t.fn();
    }
    now = target;
  }

  const fired = [];
  const gt = createGestureTracker((act, _s, ctx) => fired.push({ act, ctx }), fakeSched);

  // 1) Immediate single click when 2x and 3x are disabled
  gt.onDialDown('c1', { pressAction: 'playpause', doublePressAction: 'none', triplePressAction: 'none' });
  assert.deepStrictEqual(fired, [{ act: 'playpause', ctx: 'c1' }]);
  fired.length = 0;

  // 2) Immediate double click when 3x is disabled
  const sNoTriple = { pressAction: 'playpause', doublePressAction: 'next', triplePressAction: 'none', multiPressDelay: '350' };
  gt.onDialDown('c2', sNoTriple);
  assert.strictEqual(fired.length, 0);
  advance(100);
  gt.onDialDown('c2', sNoTriple);
  assert.deepStrictEqual(fired, [{ act: 'next', ctx: 'c2' }]);
  fired.length = 0;

  // 3) Triple click immediate trigger, and timed single/double click when 3x enabled
  const sAll = { pressAction: 'playpause', doublePressAction: 'next', triplePressAction: 'prev', longPressAction: 'mute', multiPressDelay: '350' };
  gt.onDialDown('c3', sAll);
  advance(80);
  gt.onDialDown('c3', sAll);
  advance(80);
  gt.onDialDown('c3', sAll);
  assert.deepStrictEqual(fired, [{ act: 'prev', ctx: 'c3' }]);
  fired.length = 0;

  // Timed single click
  gt.onDialDown('c3', sAll);
  advance(349);
  assert.strictEqual(fired.length, 0);
  advance(2);
  assert.deepStrictEqual(fired, [{ act: 'playpause', ctx: 'c3' }]);
  fired.length = 0;

  // Timed double click
  gt.onDialDown('c3', sAll);
  advance(100);
  gt.onDialDown('c3', sAll);
  advance(349);
  assert.strictEqual(fired.length, 0);
  advance(2);
  assert.deepStrictEqual(fired, [{ act: 'next', ctx: 'c3' }]);
  fired.length = 0;

  // 4) Keypad long-press fires at 550ms and suppresses keyUp
  gt.onKeyDown('k1', sAll);
  advance(549);
  assert.strictEqual(fired.length, 0);
  advance(2);
  assert.deepStrictEqual(fired, [{ act: 'mute', ctx: 'k1' }]);
  gt.onKeyUp('k1', sAll);
  advance(400);
  assert.strictEqual(fired.length, 1); // No extra short press fired on release
  fired.length = 0;

  // 5) Short keypad tap (<550ms) triggers short press after release
  gt.onKeyDown('k1', sAll);
  advance(120);
  gt.onKeyUp('k1', sAll);
  advance(400);
  assert.deepStrictEqual(fired, [{ act: 'playpause', ctx: 'k1' }]);

  gt.clearContext('c1');
  gt.clearContext('c2');
  gt.clearContext('c3');
  gt.clearContext('k1');
  assert.strictEqual(timers.size, 0);

  console.log('selftest ok');
}

function oneshot() {
  let done = false;
  const bridge = new SmtcBridge((state) => {
    if (done) return;
    done = true;
    const svg = renderButtonSvg(state, 0, 'com.antigravity.bravemedia.nowplaying', DEFAULT_SETTINGS, false);
    const dataUri = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
    const summaryState = Object.assign({}, state, {
      hasThumbnail: Boolean(state.thumbnail),
      thumbnailLen: state.thumbnail ? state.thumbnail.length : 0,
      thumbnail: state.thumbnail ? state.thumbnail.slice(0, 32) + '...' : '',
    });
    console.log(JSON.stringify({ state: summaryState, svgLength: svg.length, dataUriPrefix: dataUri.slice(0, 50) }));
    bridge.stop();
    process.exit(0);
  });
  bridge.start();
  setTimeout(() => {
    if (!done) {
      console.error('oneshot timeout');
      bridge.stop();
      process.exit(1);
    }
  }, 6000);
}

function main() {
  if (process.argv.includes('--selftest')) {
    try {
      selftest();
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
    return;
  }
  if (process.argv.includes('--oneshot')) {
    oneshot();
    return;
  }

  const { port, pluginUUID, registerEvent } = parseArgs(process.argv);
  if (!port || !pluginUUID || !registerEvent) {
    logMsg('Missing CLI args: ' + JSON.stringify(process.argv));
    process.exit(1);
  }

  const contexts = new Map(); // context -> { action, settings }
  let scrollTick = 0;
  let lastTrackSignature = '';
  let lastSeenVolume = null;
  let lastSeenMuted = null;
  let volumeHighlightUntil = 0;
  let volumeRevertTimer = null;
  let pollTimer = null;

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);

  function triggerVolumeHighlight() {
    volumeHighlightUntil = Date.now() + VOLUME_HIGHLIGHT_MS;
    if (volumeRevertTimer) clearTimeout(volumeRevertTimer);
    volumeRevertTimer = setTimeout(() => {
      volumeRevertTimer = null;
      pushToAllContexts(bridge.latestState);
    }, VOLUME_HIGHLIGHT_MS + 50);
  }

  const bridge = new SmtcBridge((state) => {
    const sig = `${state.found}|${state.title}|${state.artist}`;
    if (sig !== lastTrackSignature) {
      lastTrackSignature = sig;
      scrollTick = 0;
    }
    const volNow = typeof state.volume === 'number' ? state.volume : -1;
    const muteNow = Boolean(state.muted);
    if (lastSeenVolume !== null && (volNow !== lastSeenVolume || muteNow !== lastSeenMuted)) {
      triggerVolumeHighlight();
    }
    lastSeenVolume = volNow;
    lastSeenMuted = muteNow;
    pushToAllContexts(state);
  });

  const gestures = createGestureTracker((actionType, settings) => {
    executeGestureAction(actionType, settings, bridge, triggerVolumeHighlight);
  });

  function sendJson(obj) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function pushToContext(context, entry, state) {
    const settings = mergeSettings(entry && entry.settings);
    const actionUUID = (entry && entry.action) || '';
    const mode = settings.displayMode || 'svg';
    if (mode === 'title') {
      const title = formatPlainTitle(state, scrollTick, actionUUID, settings);
      sendJson({
        event: 'setTitle',
        context,
        payload: { target: 0, title },
      });
    } else {
      const isHighlight = Date.now() < volumeHighlightUntil;
      const svg = renderButtonSvg(state, scrollTick, actionUUID, settings, isHighlight);
      const image = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
      sendJson({
        event: 'setImage',
        context,
        payload: { target: 0, image },
      });
    }
  }

  function pushToAllContexts(state) {
    for (const [context, entry] of contexts.entries()) {
      pushToContext(context, entry, state);
    }
  }

  ws.on('open', () => {
    sendJson({ event: registerEvent, uuid: pluginUUID });
    bridge.start();
    pollTimer = setInterval(() => {
      scrollTick++;
      bridge.poll();
    }, POLL_MS);
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }

    const { event, context, payload } = msg;
    switch (event) {
      case 'willAppear': {
        const action = msg.action || '';
        const settings = mergeSettings(payload && payload.settings);
        const entry = { action, settings };
        contexts.set(context, entry);
        if (settings.displayMode === 'svg') {
          sendJson({ event: 'setTitle', context, payload: { target: 0, title: '' } });
        }
        pushToContext(context, entry, bridge.latestState);
        bridge.poll();
        break;
      }
      case 'willDisappear': {
        gestures.clearContext(context);
        contexts.delete(context);
        break;
      }
      case 'didReceiveSettings': {
        const existing = contexts.get(context);
        const action = msg.action || (existing && existing.action) || '';
        const settings = mergeSettings(payload && payload.settings);
        const entry = { action, settings };
        contexts.set(context, entry);
        if (settings.displayMode === 'svg') {
          sendJson({ event: 'setTitle', context, payload: { target: 0, title: '' } });
        }
        pushToContext(context, entry, bridge.latestState);
        break;
      }
      case 'keyDown': {
        const existing = contexts.get(context);
        const settings = mergeSettings(existing && existing.settings);
        gestures.onKeyDown(context, settings);
        break;
      }
      case 'keyUp': {
        const existing = contexts.get(context);
        const settings = mergeSettings(existing && existing.settings);
        gestures.onKeyUp(context, settings);
        break;
      }
      case 'dialDown': {
        const existing = contexts.get(context);
        const settings = mergeSettings(existing && existing.settings);
        gestures.onDialDown(context, settings);
        break;
      }
      case 'dialRotate': {
        const existing = contexts.get(context);
        const settings = mergeSettings(existing && existing.settings);
        const ticks = payload && typeof payload.ticks === 'number' ? payload.ticks : 1;
        const step = Number(settings.volumeStep) || 5;
        if (settings.knobMode === 'none') {
          break;
        } else if (settings.knobMode === 'track') {
          if (ticks > 0) bridge.nextTrack();
          else if (ticks < 0) bridge.prevTrack();
        } else {
          triggerVolumeHighlight();
          bridge.adjustVolume(ticks * step);
        }
        break;
      }
    }
  });

  const cleanup = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (volumeRevertTimer) {
      clearTimeout(volumeRevertTimer);
      volumeRevertTimer = null;
    }
    for (const ctx of contexts.keys()) {
      gestures.clearContext(ctx);
    }
    bridge.stop();
  };

  ws.on('close', () => {
    cleanup();
    process.exit(0);
  });
  ws.on('error', (err) => logMsg('ws error: ' + err.message));
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}
