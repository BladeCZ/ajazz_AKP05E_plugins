// VSD Craft plugin entry point. Launched by the app as:
//   node20 index.js -port <p> -pluginUUID <u> -registerEvent <e> -info <json>
// Talks the Stream Dock / Elgato-style JSON protocol over ws://127.0.0.1:<port>.
//
// Supports:
//   - SteelSeries Arctis Nova 5 / 7+ (HID)
//   - Ajazz AJ179 PRO wireless mouse (HID vendor feature report)
//   - Logitech wireless mouse (HID++)
//   - Xbox Controller (XInput)
//   - Multi-device combo views (Headset + Mouse on one button)
//   - Custom Property Inspector configuration
//   - Instant forced hardware refresh on keypress

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { readBattery: readArctis } = require('./arctis');
const { readController } = require('./xinput');
const { readBattery: readLogitech } = require('./logitech');
const { readBattery: readAjazz } = require('./ajazz');
const { readMouseDpi, cycleNextDpi, stepDpi, drawDpiKey } = require('./ajazz_dpi');
const { readMouseLayer, cycleNextLayer, stepLayer, drawLayerKey } = require('./ajazz_layer');
const { drawComboKnobKey } = require('./ajazz_combo_knob');

const POLL_MS = 60_000;
const LOG = path.join(__dirname, 'plugin.log');
const LOG_MAX_BYTES = 256 * 1024;

const logErr = (msg) => {
  try {
    if (fs.statSync(LOG, { throwIfNoEntry: false })?.size > LOG_MAX_BYTES) fs.truncateSync(LOG, 0);
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* logging must never take the plugin down */
  }
};
process.on('uncaughtException', (e) => logErr('uncaught: ' + (e.stack || e)));
process.on('unhandledRejection', (e) => logErr('rejection: ' + e));

const [, , , port, , uuid, , registerEvent] = process.argv;

const GREEN = '#22c55e';
const CUT = '#000000';
const BOLT = 'M75 24 L61 46 L70 46 L67 62 L81 38 L72 38 Z';
const TRACK = 100;

const HEADSET =
  `<path d="M40 58 v-5 a32 32 0 0 1 64 0 v5" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>` +
  `<rect x="31" y="50" width="18" height="31" rx="9" fill="#fff"/>` +
  `<rect x="95" y="50" width="18" height="31" rx="9" fill="#fff"/>`;

const GAMEPAD =
  `<rect x="26" y="26" width="92" height="38" rx="19" fill="#fff"/>` +
  `<rect x="28" y="48" width="20" height="30" rx="10" fill="#fff" transform="rotate(20 38 63)"/>` +
  `<rect x="96" y="48" width="20" height="30" rx="10" fill="#fff" transform="rotate(-20 106 63)"/>` +
  `<rect x="39" y="41" width="20" height="7" rx="2" fill="${CUT}" fill-opacity=".62"/>` +
  `<rect x="45" y="35" width="7" height="20" rx="2" fill="${CUT}" fill-opacity=".62"/>` +
  `<circle cx="88" cy="40" r="5" fill="${CUT}" fill-opacity=".62"/>` +
  `<circle cx="99" cy="50" r="5" fill="${CUT}" fill-opacity=".62"/>`;

const MOUSE =
  `<rect x="48" y="14" width="48" height="68" rx="24" fill="#fff"/>` +
  `<rect x="48" y="44" width="48" height="4" fill="${CUT}" fill-opacity=".62"/>` +
  `<rect x="68" y="22" width="8" height="18" rx="4" fill="${CUT}" fill-opacity=".62"/>`;

const GLYPHS = {
  headset: HEADSET,
  mouse: MOUSE,
  gamepad: GAMEPAD,
};

const COLORS = [
  [75, GREEN],
  [50, '#eab308'],
  [25, '#f97316'],
  [0, '#ef4444'],
];
const colorFor = (percent) => (COLORS.find(([min]) => percent >= min) || COLORS[3])[1];
const fillFor = (percent) => Math.max(8, Math.round(TRACK * (percent / 100)));

function key(glyph, color, fill, label, charging) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" fill="#101014"/>` +
    `<g transform="translate(72 40) scale(.7) translate(-72 -48)">` +
    glyph +
    (charging
      ? `<path d="${BOLT}" fill="none" stroke="#101014" stroke-width="8" stroke-linejoin="round"/>` +
        `<path d="${BOLT}" fill="#fff"/>`
      : '') +
    `</g>` +
    `<g opacity=".6">` +
    `<rect x="16" y="80" width="112" height="54" rx="10" fill="none" stroke="#fff" stroke-width="4"/>` +
    `<rect x="128" y="96" width="8" height="22" rx="2" fill="#fff"/>` +
    `</g>` +
    (fill ? `<rect x="22" y="86" width="${fill}" height="42" rx="5" fill="${color}"/>` : '') +
    `<text x="72" y="119" font-family="Segoe UI,Arial,sans-serif" font-size="34" ` +
    `font-weight="700" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="2" paint-order="stroke fill">${label}</text>` +
    `</svg>`
  );
}

const gauge = (glyph, percent, charging) =>
  key(glyph, colorFor(percent), fillFor(percent), String(percent), charging);

function drawHeadset(state) {
  if (!state.found) return key(HEADSET, '', 0, 'N/A');
  if (!state.connected) return key(HEADSET, '', 0, 'OFF');
  return gauge(HEADSET, state.level, state.charging);
}

function drawGamepad(state) {
  if (!state.found) return key(GAMEPAD, '', 0, 'OFF');
  if (state.wired) return key(GAMEPAD, GREEN, TRACK, 'USB', true);
  return gauge(GAMEPAD, state.percent);
}

function drawMouse(state) {
  if (!state.found) return key(MOUSE, '', 0, 'OFF');
  return gauge(MOUSE, state.percent, state.charging);
}

// Single device card with large gauge & bold text
function drawSingle(dev, refreshing = false) {
  const isOnline = dev.found && dev.connected;
  const pct = isOnline ? Math.max(0, Math.min(100, dev.percent || 0)) : null;
  const label = !dev.found ? 'N/A' : (!dev.connected ? 'OFF' : String(pct));
  const fill = pct !== null ? fillFor(pct) : 0;
  const color = pct !== null ? colorFor(pct) : '';
  const refreshIndicator = refreshing ? `<circle cx="134" cy="10" r="5" fill="#38bdf8"/>` : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" fill="#101014"/>` +
    `<g transform="translate(72 40) scale(.7) translate(-72 -48)">` +
    dev.glyph +
    (dev.charging
      ? `<path d="${BOLT}" fill="none" stroke="#101014" stroke-width="8" stroke-linejoin="round"/>` +
        `<path d="${BOLT}" fill="#fff"/>`
      : '') +
    `</g>` +
    `<g opacity=".6">` +
    `<rect x="16" y="80" width="112" height="54" rx="10" fill="none" stroke="#fff" stroke-width="4"/>` +
    `<rect x="128" y="96" width="8" height="22" rx="2" fill="#fff"/>` +
    `</g>` +
    (fill ? `<rect x="22" y="86" width="${fill}" height="42" rx="5" fill="${color}"/>` : '') +
    `<text x="72" y="119" font-family="Segoe UI,Arial,sans-serif" font-size="34" ` +
    `font-weight="700" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke fill">${label}</text>` +
    refreshIndicator +
    `</svg>`
  );
}

// Dual rows (horizontal split) - 28px numbers with outline for small 2 cm LCD screen
function drawDualHorizontal(d1, d2, refreshing = false) {
  function renderRow(dev, yCenter) {
    if (!dev) return '';
    const isOnline = dev.found && dev.connected;
    const pct = isOnline ? Math.max(0, Math.min(100, dev.percent || 0)) : null;
    const color = pct !== null ? colorFor(pct) : '#64748b';
    const label = !dev.found ? 'N/A' : (!dev.connected ? 'OFF' : String(pct));
    const fillWidth = pct !== null ? Math.max(6, Math.round(74 * (pct / 100))) : 0;
    const iconOpacity = isOnline ? '1' : '0.35';

    let boltSvg = '';
    if (dev.charging) {
      boltSvg =
        `<g transform="translate(39 ${yCenter - 21}) scale(0.32) translate(-72 -48)">` +
        `<path d="${BOLT}" fill="none" stroke="#101014" stroke-width="8" stroke-linejoin="round"/>` +
        `<path d="${BOLT}" fill="#38bdf8"/>` +
        `</g>`;
    }

    return (
      `<g opacity="${iconOpacity}" transform="translate(24 ${yCenter}) scale(0.44) translate(-72 -48)">` +
      dev.glyph +
      `</g>` +
      boltSvg +
      `<g opacity=".55">` +
      `<rect x="48" y="${yCenter - 22}" width="82" height="44" rx="8" fill="none" stroke="#fff" stroke-width="3"/>` +
      `<rect x="130" y="${yCenter - 10}" width="4" height="20" rx="2" fill="#fff"/>` +
      `</g>` +
      (fillWidth > 0
        ? `<rect x="52" y="${yCenter - 18}" width="${fillWidth}" height="36" rx="5" fill="${color}"/>`
        : '') +
      `<text x="89" y="${yCenter + 10}" font-family="Segoe UI,Arial,sans-serif" font-size="28" ` +
      `font-weight="700" text-anchor="middle" fill="#ffffff" stroke="#000000" stroke-width="2.5" paint-order="stroke fill">` +
      label + `</text>`
    );
  }

  const refreshIndicator = refreshing
    ? `<circle cx="134" cy="10" r="5" fill="#38bdf8"/>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" fill="#101014"/>` +
    `<line x1="8" y1="72" x2="136" y2="72" stroke="#262a36" stroke-width="1.5" stroke-dasharray="3 3"/>` +
    renderRow(d1, 37) +
    renderRow(d2, 107) +
    refreshIndicator +
    `</svg>`
  );
}

// Dual columns (vertical split)
function drawDualVertical(d1, d2, refreshing = false) {
  function renderCol(dev, xCenter) {
    if (!dev) return '';
    const isOnline = dev.found && dev.connected;
    const pct = isOnline ? Math.max(0, Math.min(100, dev.percent || 0)) : null;
    const color = pct !== null ? colorFor(pct) : '#64748b';
    const label = !dev.found ? 'N/A' : (!dev.connected ? 'OFF' : String(pct));
    const fillWidth = pct !== null ? Math.max(4, Math.round(52 * (pct / 100))) : 0;
    const iconOpacity = isOnline ? '1' : '0.35';

    let boltSvg = '';
    if (dev.charging) {
      boltSvg =
        `<g transform="translate(${xCenter + 16} 22) scale(0.3) translate(-72 -48)">` +
        `<path d="${BOLT}" fill="none" stroke="#101014" stroke-width="8" stroke-linejoin="round"/>` +
        `<path d="${BOLT}" fill="#38bdf8"/>` +
        `</g>`;
    }

    return (
      `<g opacity="${iconOpacity}" transform="translate(${xCenter} 30) scale(0.48) translate(-72 -48)">` +
      dev.glyph +
      `</g>` +
      boltSvg +
      `<text x="${xCenter}" y="88" font-family="Segoe UI,Arial,sans-serif" font-size="28" ` +
      `font-weight="700" text-anchor="middle" fill="#ffffff" stroke="#000000" stroke-width="2.5" paint-order="stroke fill">` +
      label + `</text>` +
      `<g opacity=".55">` +
      `<rect x="${xCenter - 28}" y="102" width="56" height="20" rx="5" fill="none" stroke="#fff" stroke-width="2.5"/>` +
      `<rect x="${xCenter + 28}" y="107" width="3" height="10" rx="1.5" fill="#fff"/>` +
      `</g>` +
      (fillWidth > 0
        ? `<rect x="${xCenter - 26}" y="104" width="${fillWidth}" height="16" rx="3.5" fill="${color}"/>`
        : '')
    );
  }

  const refreshIndicator = refreshing
    ? `<circle cx="134" cy="10" r="5" fill="#38bdf8"/>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" fill="#101014"/>` +
    `<line x1="72" y1="8" x2="72" y2="136" stroke="#262a36" stroke-width="1.5" stroke-dasharray="3 3"/>` +
    renderCol(d1, 36) +
    renderCol(d2, 108) +
    refreshIndicator +
    `</svg>`
  );
}

// Triple rows (3 devices on one button)
function drawTriple(d1, d2, d3, refreshing = false) {
  function renderRow(dev, yCenter) {
    if (!dev) return '';
    const isOnline = dev.found && dev.connected;
    const pct = isOnline ? Math.max(0, Math.min(100, dev.percent || 0)) : null;
    const color = pct !== null ? colorFor(pct) : '#64748b';
    const label = !dev.found ? 'N/A' : (!dev.connected ? 'OFF' : String(pct));
    const fillWidth = pct !== null ? Math.max(4, Math.round(76 * (pct / 100))) : 0;
    const iconOpacity = isOnline ? '1' : '0.35';

    return (
      `<g opacity="${iconOpacity}" transform="translate(20 ${yCenter}) scale(0.36) translate(-72 -48)">` +
      dev.glyph +
      `</g>` +
      `<g opacity=".55">` +
      `<rect x="42" y="${yCenter - 15}" width="84" height="30" rx="6" fill="none" stroke="#fff" stroke-width="2.5"/>` +
      `<rect x="126" y="${yCenter - 7}" width="3.5" height="14" rx="1.5" fill="#fff"/>` +
      `</g>` +
      (fillWidth > 0
        ? `<rect x="45" y="${yCenter - 12}" width="${fillWidth}" height="24" rx="4" fill="${color}"/>`
        : '') +
      `<text x="84" y="${yCenter + 7}" font-family="Segoe UI,Arial,sans-serif" font-size="22" ` +
      `font-weight="700" text-anchor="middle" fill="#ffffff" stroke="#000000" stroke-width="2" paint-order="stroke fill">` +
      label + `</text>`
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" fill="#101014"/>` +
    `<line x1="8" y1="48" x2="136" y2="48" stroke="#22252f" stroke-width="1"/>` +
    `<line x1="8" y1="96" x2="136" y2="96" stroke="#22252f" stroke-width="1"/>` +
    renderRow(d1, 24) +
    renderRow(d2, 72) +
    renderRow(d3, 120) +
    (refreshing ? `<circle cx="136" cy="8" r="4" fill="#38bdf8"/>` : '') +
    `</svg>`
  );
}

const MOUSE_STALE_MS = 3 * 60 * 60 * 1000;
const mouseCache = {}; // { state, at }

function holdLast(state, cache, now, ms) {
  if (state.found) {
    cache.state = state;
    cache.at = now;
    return state;
  }
  return cache.state && now - cache.at < ms ? cache.state : state;
}

function readMouseHeld(force = false) {
  if (force) {
    mouseCache.state = null;
    mouseCache.at = 0;
  }
  let state = { found: false };
  try {
    state = readAjazz();
  } catch (e) {
    logErr('ajazz: ' + e.message);
  }
  if (!state || !state.found) {
    try {
      state = readLogitech();
    } catch (e) {
      logErr('mouse: ' + e.message);
      state = { found: false };
    }
  }
  return holdLast(state, mouseCache, Date.now(), MOUSE_STALE_MS);
}

function getDeviceState(devKey, force = false) {
  switch (devKey) {
    case 'headset': {
      try {
        const s = readArctis();
        if (!s || !s.found) {
          return { key: 'headset', found: false, connected: false, percent: null, charging: false, glyph: HEADSET, label: 'Headset' };
        }
        return {
          key: 'headset',
          found: true,
          connected: s.connected !== false,
          percent: s.level ?? null,
          charging: Boolean(s.charging),
          glyph: HEADSET,
          label: 'Headset',
        };
      } catch (e) {
        logErr('readArctis: ' + e.message);
        return { key: 'headset', found: false, connected: false, percent: null, charging: false, glyph: HEADSET, label: 'Headset' };
      }
    }
    case 'mouse': {
      try {
        const s = readMouseHeld(force);
        if (!s || !s.found) {
          return { key: 'mouse', found: false, connected: false, percent: null, charging: false, glyph: MOUSE, label: 'Mouse' };
        }
        return {
          key: 'mouse',
          found: true,
          connected: s.connected !== false,
          percent: s.percent ?? null,
          charging: Boolean(s.charging),
          glyph: MOUSE,
          label: 'Mouse',
        };
      } catch (e) {
        logErr('readMouse: ' + e.message);
        return { key: 'mouse', found: false, connected: false, percent: null, charging: false, glyph: MOUSE, label: 'Mouse' };
      }
    }
    case 'gamepad': {
      try {
        const s = readController();
        if (!s || !s.found) {
          return { key: 'gamepad', found: false, connected: false, percent: null, charging: false, glyph: GAMEPAD, label: 'Gamepad' };
        }
        return {
          key: 'gamepad',
          found: true,
          connected: true,
          percent: s.wired ? 100 : (s.percent ?? null),
          charging: Boolean(s.wired),
          glyph: GAMEPAD,
          label: 'Gamepad',
        };
      } catch (e) {
        logErr('readController: ' + e.message);
        return { key: 'gamepad', found: false, connected: false, percent: null, charging: false, glyph: GAMEPAD, label: 'Gamepad' };
      }
    }
    default:
      return null;
  }
}

function getDefaultSettings(action) {
  switch (action) {
    case 'com.froyo.batterylevel.combo':
      return { device1: 'headset', device2: 'mouse', layout: 'dual_horiz', clickAction: 'refresh' };
    case 'com.froyo.batterylevel.mouse':
      return { device1: 'mouse', device2: 'none', layout: 'single', clickAction: 'refresh' };
    case 'com.froyo.batterylevel.gamepad':
      return { device1: 'gamepad', device2: 'none', layout: 'single', clickAction: 'refresh' };
    case 'com.froyo.batterylevel.ajazzdpi':
      return { device1: 'ajazzdpi', device2: 'none', layout: 'single', clickAction: 'cycle' };
    case 'com.froyo.batterylevel.ajazzlayer':
      return { device1: 'ajazzlayer', device2: 'none', layout: 'single', clickAction: 'cycle', maxProfiles: 8 };
    case 'com.froyo.batterylevel.ajazzcomboknob':
      return { device1: 'ajazzcomboknob', device2: 'none', layout: 'single', clickAction: 'cycle', mode: 'dpi', maxProfiles: 8 };
    case 'com.froyo.batterylevel.headset':
    default:
      return { device1: 'headset', device2: 'none', layout: 'single', clickAction: 'refresh' };
  }
}

function renderContextSvg(entry, force = false) {
  const s = entry.settings || {};
  const d1Key = s.device1 || 'headset';
  const d2Key = s.device2 || 'none';
  const layout = s.layout || 'auto';
  const refreshing = Boolean(entry.refreshing);

  if (layout === 'triple') {
    const dHeadset = getDeviceState('headset', force);
    const dMouse = getDeviceState('mouse', force);
    const dGamepad = getDeviceState('gamepad', force);
    return drawTriple(dHeadset, dMouse, dGamepad, refreshing);
  }

  if (d2Key !== 'none') {
    const cycle = (entry.cycleIndex || 0) % 3;
    if (cycle === 1) {
      const dev1 = getDeviceState(d1Key, force);
      return drawSingle(dev1, refreshing);
    }
    if (cycle === 2) {
      const dev2 = getDeviceState(d2Key, force);
      return drawSingle(dev2, refreshing);
    }
  }

  if (d2Key === 'none' || layout === 'single') {
    const dev1 = getDeviceState(d1Key, force);
    return drawSingle(dev1, refreshing);
  }

  const dev1 = getDeviceState(d1Key, force);
  const dev2 = getDeviceState(d2Key, force);

  if (layout === 'dual_vert') {
    return drawDualVertical(dev1, dev2, refreshing);
  }
  return drawDualHorizontal(dev1, dev2, refreshing);
}

const ACTIONS = {
  'com.froyo.batterylevel.headset': {
    defaultDevice1: 'headset',
    defaultDevice2: 'none',
  },
  'com.froyo.batterylevel.gamepad': {
    defaultDevice1: 'gamepad',
    defaultDevice2: 'none',
  },
  'com.froyo.batterylevel.mouse': {
    defaultDevice1: 'mouse',
    defaultDevice2: 'none',
  },
  'com.froyo.batterylevel.combo': {
    defaultDevice1: 'headset',
    defaultDevice2: 'mouse',
  },
  'com.froyo.batterylevel.ajazzdpi': {
    defaultDevice1: 'ajazzdpi',
    defaultDevice2: 'none',
  },
  'com.froyo.batterylevel.ajazzlayer': {
    defaultDevice1: 'ajazzlayer',
    defaultDevice2: 'none',
  },
  'com.froyo.batterylevel.ajazzcomboknob': {
    defaultDevice1: 'ajazzcomboknob',
    defaultDevice2: 'none',
  },
};

function selftest() {
  const assert = require('assert');
  const cache = {};
  const live = { found: true, percent: 90 };
  assert.strictEqual(holdLast(live, cache, 1000, 100), live);
  assert.strictEqual(holdLast({ found: false }, cache, 1050, 100), live);
  assert.deepStrictEqual(holdLast({ found: false }, cache, 2000, 100), { found: false });
  const fresh = { found: true, percent: 80 };
  assert.strictEqual(holdLast(fresh, cache, 2100, 100), fresh);
  assert.strictEqual(holdLast({ found: false }, cache, 2150, 100), fresh);
  assert.deepStrictEqual(holdLast({ found: false }, {}, 0, 100), { found: false });

  // Test SVG renderers
  const devA = { found: true, connected: true, percent: 85, charging: false, glyph: HEADSET };
  const devB = { found: true, connected: true, percent: 57, charging: true, glyph: MOUSE };
  const devC = { found: false, connected: false, percent: null, charging: false, glyph: GAMEPAD };

  const svgSingle = drawSingle(devA);
  assert(svgSingle.startsWith('<svg') && svgSingle.endsWith('</svg>'), 'drawSingle must output SVG');

  const svgDualH = drawDualHorizontal(devA, devB, true);
  assert(svgDualH.includes('85') && svgDualH.includes('57'), 'dual horiz must include battery values');
  assert(svgDualH.includes('fill="#38bdf8"'), 'refresh indicator must be present');

  const svgDualV = drawDualVertical(devA, devB);
  assert(svgDualV.includes('85') && svgDualV.includes('57'), 'dual vert must include values');

  const svgTriple = drawTriple(devA, devB, devC);
  assert(svgTriple.includes('85') && svgTriple.includes('57') && svgTriple.includes('N/A'), 'triple must handle offline dev');

  const svgDpi = drawDpiKey({
    found: true,
    currentDpiValue: 3200,
    activeStageIndex: 1,
    activeStagesCount: 2,
    currentColor: '#ff00ff',
  });
  assert(svgDpi.includes('3200') && svgDpi.includes('DPI'), 'drawDpiKey must include 3200 and DPI');

  const svgLayer = drawLayerKey({
    found: true,
    layerIndex: 2,
    currentLayer: 3,
    maxLayers: 8,
  }, false, 3);
  assert(svgLayer.includes('L3') && svgLayer.includes('PROFILE'), 'drawLayerKey must include L3 and PROFILE');

  const svgComboDpi = drawComboKnobKey('dpi', { currentDpiValue: 1600, activeStageIndex: 1, activeStagesCount: 4, currentColor: '#38bdf8' }, { currentLayer: 2 });
  assert(svgComboDpi.includes('1600') && svgComboDpi.includes('DPI'), 'drawComboKnobKey dpi mode');
  const svgComboProf = drawComboKnobKey('layer', { currentDpiValue: 1600 }, { currentLayer: 3 });
  assert(svgComboProf.includes('PROF') && (svgComboProf.includes('>3<') || svgComboProf.includes('3')), 'drawComboKnobKey layer mode');

  console.log('selftest ok');
}

module.exports = {
  draw: {
    headset: drawHeadset,
    gamepad: drawGamepad,
    mouse: drawMouse,
    single: drawSingle,
    dualHorizontal: drawDualHorizontal,
    dualVertical: drawDualVertical,
    triple: drawTriple,
    dpi: drawDpiKey,
    layer: drawLayerKey,
    combo: drawComboKnobKey,
  },
  holdLast,
  getDeviceState,
  readMouseDpi,
  cycleNextDpi,
  stepDpi,
  readMouseLayer,
  cycleNextLayer,
  stepLayer,
};

if (process.argv.includes('--selftest')) {
  selftest();
  process.exit(0);
}

if (require.main !== module) return;

const contexts = new Map(); // context -> { action, settings, cycleIndex, refreshing, refreshTimer, switching }
const ws = new WebSocket('ws://127.0.0.1:' + port);

async function refresh(only, force = false) {
  for (const [context, entry] of contexts) {
    if (only && only !== context) continue;
    let svg;
    try {
      if (entry.action === 'com.froyo.batterylevel.ajazzdpi') {
        const dpiInfo = await readMouseDpi(force);
        svg = drawDpiKey(dpiInfo, Boolean(entry.switching || entry.refreshing));
        // Also support encoder LCD strip feedback
        ws.send(
          JSON.stringify({
            event: 'setFeedback',
            context,
            payload: {
              title: 'DPI',
              value: String(dpiInfo.currentDpiValue || 0),
              indicator:
                dpiInfo.activeStagesCount > 1
                  ? Math.round(((dpiInfo.activeStageIndex + 1) / dpiInfo.activeStagesCount) * 100)
                  : 100,
            },
          })
        );
      } else if (entry.action === 'com.froyo.batterylevel.ajazzlayer') {
        const isKnob = entry.controller === 'Knob' || entry.controller === 'Encoder';
        // KNOB: ALWAYS all 8 profiles (no restriction).
        // Screen button: respects configured maxProfiles (default 8).
        const maxProf = isKnob ? 8 : (Number(entry.settings?.maxProfiles) || 8);
        const layerInfo = await readMouseLayer(force);
        svg = drawLayerKey(layerInfo, Boolean(entry.switching || entry.refreshing), maxProf);
        ws.send(
          JSON.stringify({
            event: 'setFeedback',
            context,
            payload: {
              title: 'PROFILE',
              value: 'Layer ' + (layerInfo.currentLayer || 1),
              indicator: Math.round(((layerInfo.currentLayer || 1) / maxProf) * 100),
            },
          })
        );
      } else if (entry.action === 'com.froyo.batterylevel.ajazzcomboknob') {
        const mode = entry.mode || 'dpi';
        // Combo knob: always all 8 profiles in layer mode (no restriction for knobs)
        // Sequential queries so HID / gRPC calls never collide on the single dongle endpoint
        const dpiInfo = await readMouseDpi(force);
        const layerInfo = await readMouseLayer(force);
        svg = drawComboKnobKey(mode, dpiInfo, layerInfo, Boolean(entry.switching || entry.refreshing), 8);
        if (mode === 'dpi') {
          ws.send(
            JSON.stringify({
              event: 'setFeedback',
              context,
              payload: {
                title: 'DPI',
                value: String(dpiInfo.currentDpiValue || 0),
                indicator:
                  dpiInfo.activeStagesCount > 1
                    ? Math.round(((dpiInfo.activeStageIndex + 1) / dpiInfo.activeStagesCount) * 100)
                    : 100,
              },
            })
          );
        } else {
          ws.send(
            JSON.stringify({
              event: 'setFeedback',
              context,
              payload: {
                title: 'PROFILE',
                value: 'Layer ' + (layerInfo.currentLayer || 1),
                indicator: Math.round(((layerInfo.currentLayer || 1) / 8) * 100),
              },
            })
          );
        }
      } else {
        svg = renderContextSvg(entry, force);
      }
    } catch (e) {
      logErr(`render ${entry.action}: ${e.message}`);
      svg = drawSingle({ found: false, connected: false, percent: null, glyph: HEADSET }, false);
    }
    const image = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
    ws.send(JSON.stringify({ event: 'setImage', context, payload: { target: 0, image } }));
  }
}

ws.on('open', () => {
  ws.send(JSON.stringify({ uuid, event: registerEvent }));
  setInterval(() => refresh(), POLL_MS);
});
ws.on('close', () => process.exit(0));
ws.on('error', (e) => logErr('ws: ' + e.message));
ws.on('message', async (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  switch (msg.event) {
    case 'willAppear': {
      const incomingSettings = msg.payload?.settings || {};
      const def = getDefaultSettings(msg.action);
      const entry = {
        action: msg.action,
        controller: msg.payload?.controller || 'Keypad',
        settings: Object.assign({}, def, incomingSettings),
        cycleIndex: 0,
        refreshing: false,
        refreshTimer: null,
      };
      contexts.set(msg.context, entry);
      await refresh(msg.context);
      break;
    }
    case 'willDisappear': {
      const entry = contexts.get(msg.context);
      if (entry?.refreshTimer) clearTimeout(entry.refreshTimer);
      contexts.delete(msg.context);
      break;
    }
    case 'didReceiveSettings': {
      const entry = contexts.get(msg.context);
      if (entry) {
        const nextSettings = msg.payload?.settings || msg.payload || {};
        entry.settings = Object.assign({}, entry.settings, nextSettings);
        await refresh(msg.context);
      }
      break;
    }
    case 'sendToPlugin': {
      const entry = contexts.get(msg.context);
      if (entry && msg.payload) {
        const nextSettings = msg.payload.settings || msg.payload;
        entry.settings = Object.assign({}, entry.settings, nextSettings);
        ws.send(
          JSON.stringify({
            event: 'setSettings',
            context: msg.context,
            payload: entry.settings,
          })
        );
        await refresh(msg.context);
      }
      break;
    }
    case 'propertyInspectorDidAppear': {
      const entry = contexts.get(msg.context);
      if (entry) {
        ws.send(
          JSON.stringify({
            event: 'sendToPropertyInspector',
            action: entry.action,
            context: msg.context,
            payload: { settings: entry.settings, action: entry.action },
          })
        );
      }
      break;
    }
    case 'keyUp': {
      const entry = contexts.get(msg.context);
      if (!entry) break;

      // Special handling for Ajazz DPI key: cycles to next DPI stage
      if (entry.action === 'com.froyo.batterylevel.ajazzdpi') {
        entry.switching = true;
        try {
          const nextDpi = cycleNextDpi();
          const svg = drawDpiKey(nextDpi, true);
          const image = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
          ws.send(JSON.stringify({ event: 'setImage', context: msg.context, payload: { target: 0, image } }));
        } catch (e) {
          logErr('cycleDpi: ' + e.message);
        }
        if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
        entry.refreshTimer = setTimeout(() => {
          entry.switching = false;
          entry.refreshTimer = null;
          refresh(msg.context, false);
        }, 350);
        break;
      }

      // Special handling for Ajazz Profile / Layer key: cycles to next Layer (1..maxProfiles)
      if (entry.action === 'com.froyo.batterylevel.ajazzlayer') {
        entry.switching = true;
        const maxProf = Number(entry.settings?.maxProfiles) || 8;
        try {
          const nextLayer = cycleNextLayer(maxProf);
          const svg = drawLayerKey(nextLayer, true, maxProf);
          const image = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
          ws.send(JSON.stringify({ event: 'setImage', context: msg.context, payload: { target: 0, image } }));
        } catch (e) {
          logErr('cycleLayer: ' + e.message);
        }
        if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
        entry.refreshTimer = setTimeout(() => {
          entry.switching = false;
          entry.refreshTimer = null;
          refresh(msg.context, false);
        }, 350);
        break;
      }

      // Ajazz Combo Knob key press (if assigned to key): toggle mode between DPI and Layer
      if (entry.action === 'com.froyo.batterylevel.ajazzcomboknob') {
        entry.mode = (entry.mode || 'dpi') === 'layer' ? 'dpi' : 'layer';
        await refresh(msg.context, false);
        break;
      }

      const clickAction = entry.settings?.clickAction || 'refresh';
      if (clickAction === 'cycle' && entry.settings?.device2 && entry.settings.device2 !== 'none') {
        entry.cycleIndex = (entry.cycleIndex || 0) + 1;
        await refresh(msg.context, false);
      } else {
        // Immediate forced hardware read with visual feedback dot
        entry.refreshing = true;
        await refresh(msg.context, true);
        if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
        entry.refreshTimer = setTimeout(() => {
          entry.refreshing = false;
          entry.refreshTimer = null;
          refresh(msg.context, false);
        }, 650);
      }
      break;
    }
    case 'dialRotate': {
      const entry = contexts.get(msg.context);
      if (!entry) break;
      if (entry.action === 'com.froyo.batterylevel.ajazzdpi') {
        entry.switching = true;
        const ticks = Number(msg.payload?.ticks || 0);
        try {
          const nextDpi = stepDpi(ticks);
          const svg = drawDpiKey(nextDpi, true);
          const image = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
          ws.send(JSON.stringify({ event: 'setImage', context: msg.context, payload: { target: 0, image } }));
          ws.send(
            JSON.stringify({
              event: 'setFeedback',
              context: msg.context,
              payload: {
                title: 'DPI',
                value: String(nextDpi.currentDpiValue || 0),
                indicator:
                  nextDpi.activeStagesCount > 1
                    ? Math.round(((nextDpi.activeStageIndex + 1) / nextDpi.activeStagesCount) * 100)
                    : 100,
              },
            })
          );
        } catch (e) {
          logErr('dialRotate dpi: ' + e.message);
        }
        if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
        entry.refreshTimer = setTimeout(() => {
          entry.switching = false;
          entry.refreshTimer = null;
          refresh(msg.context, false);
        }, 300);
      } else if (entry.action === 'com.froyo.batterylevel.ajazzlayer') {
        entry.switching = true;
        const ticks = Number(msg.payload?.ticks || 0);
        // KNOB: ALWAYS all 8 profiles (no restriction on rotary knobs)
        try {
          const nextLayer = stepLayer(ticks, 8);
          const svg = drawLayerKey(nextLayer, true, 8);
          const image = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
          ws.send(JSON.stringify({ event: 'setImage', context: msg.context, payload: { target: 0, image } }));
          ws.send(
            JSON.stringify({
              event: 'setFeedback',
              context: msg.context,
              payload: {
                title: 'PROFILE',
                value: 'Layer ' + (nextLayer.currentLayer || 1),
                indicator: Math.round(((nextLayer.currentLayer || 1) / 8) * 100),
              },
            })
          );
        } catch (e) {
          logErr('dialRotate layer: ' + e.message);
        }
        if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
        entry.refreshTimer = setTimeout(() => {
          entry.switching = false;
          entry.refreshTimer = null;
          refresh(msg.context, false);
        }, 300);
      } else if (entry.action === 'com.froyo.batterylevel.ajazzcomboknob') {
        entry.switching = true;
        const ticks = Number(msg.payload?.ticks || 0);
        const mode = entry.mode || 'dpi';
        // KNOB: ALWAYS all 8 profiles for Layer mode
        try {
          if (mode === 'dpi') {
            const nextDpi = stepDpi(ticks);
            const layerInfo = await readMouseLayer(false);
            const svg = drawComboKnobKey('dpi', nextDpi, layerInfo, true, 8);
            const image = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
            ws.send(JSON.stringify({ event: 'setImage', context: msg.context, payload: { target: 0, image } }));
            ws.send(
              JSON.stringify({
                event: 'setFeedback',
                context: msg.context,
                payload: {
                  title: 'DPI',
                  value: String(nextDpi.currentDpiValue || 0),
                  indicator:
                    nextDpi.activeStagesCount > 1
                      ? Math.round(((nextDpi.activeStageIndex + 1) / nextDpi.activeStagesCount) * 100)
                      : 100,
                },
              })
            );
          } else {
            const nextLayer = stepLayer(ticks, 8);
            const dpiInfo = await readMouseDpi(false);
            const svg = drawComboKnobKey('layer', dpiInfo, nextLayer, true, 8);
            const image = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
            ws.send(JSON.stringify({ event: 'setImage', context: msg.context, payload: { target: 0, image } }));
            ws.send(
              JSON.stringify({
                event: 'setFeedback',
                context: msg.context,
                payload: {
                  title: 'PROFILE',
                  value: 'Layer ' + (nextLayer.currentLayer || 1),
                  indicator: Math.round(((nextLayer.currentLayer || 1) / 8) * 100),
                },
              })
            );
          }
        } catch (e) {
          logErr('dialRotate comboknob: ' + e.message);
        }
        if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
        entry.refreshTimer = setTimeout(() => {
          entry.switching = false;
          entry.refreshTimer = null;
          refresh(msg.context, false);
        }, 300);
      }
      break;
    }
    case 'dialUp':
      // Drop dialUp event so physical knob click doesn't trigger twice (dialDown + dialUp)
      break;
    case 'dialDown':
    case 'touchTap': {
      const entry = contexts.get(msg.context);
      if (!entry) break;
      if (entry.action === 'com.froyo.batterylevel.ajazzdpi') {
        entry.switching = true;
        try {
          const nextDpi = cycleNextDpi();
          const svg = drawDpiKey(nextDpi, true);
          const image = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
          ws.send(JSON.stringify({ event: 'setImage', context: msg.context, payload: { target: 0, image } }));
          ws.send(
            JSON.stringify({
              event: 'setFeedback',
              context: msg.context,
              payload: {
                title: 'DPI',
                value: String(nextDpi.currentDpiValue || 0),
              },
            })
          );
        } catch (e) {
          logErr('dialPress dpi: ' + e.message);
        }
        if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
        entry.refreshTimer = setTimeout(() => {
          entry.switching = false;
          entry.refreshTimer = null;
          refresh(msg.context, false);
        }, 350);
      } else if (entry.action === 'com.froyo.batterylevel.ajazzlayer') {
        entry.switching = true;
        // KNOB: Physical knob press ALWAYS cycles through all 8 profiles
        try {
          const nextLayer = cycleNextLayer(8);
          const svg = drawLayerKey(nextLayer, true, 8);
          const image = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
          ws.send(JSON.stringify({ event: 'setImage', context: msg.context, payload: { target: 0, image } }));
          ws.send(
            JSON.stringify({
              event: 'setFeedback',
              context: msg.context,
              payload: {
                title: 'PROFILE',
                value: 'Layer ' + (nextLayer.currentLayer || 1),
                indicator: Math.round(((nextLayer.currentLayer || 1) / 8) * 100),
              },
            })
          );
        } catch (e) {
          logErr('dialPress layer: ' + e.message);
        }
        if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
        entry.refreshTimer = setTimeout(() => {
          entry.switching = false;
          entry.refreshTimer = null;
          refresh(msg.context, false);
        }, 350);
      } else if (entry.action === 'com.froyo.batterylevel.ajazzcomboknob') {
        // Knob click toggles between DPI and Profile mode!
        entry.mode = (entry.mode || 'dpi') === 'layer' ? 'dpi' : 'layer';
        await refresh(msg.context, false);
      }
      break;
    }
  }
});
