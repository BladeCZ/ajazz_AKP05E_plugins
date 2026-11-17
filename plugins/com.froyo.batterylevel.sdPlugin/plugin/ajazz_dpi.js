// Ajazz AJ179 PRO DPI reader and switcher via local driver gRPC service (iot_driver).
//
// Communicates with iot_driver on 127.0.0.1:3814 using gRPC-Web (application/grpc-web+proto).
// Device path: \\?\HID#VID_3151&PID_402D&MI_02#... (UsagePage 0xffff, Usage 0x02).
//
// Protocol:
//   FEA_CMD_MOUSE_GET_OPTIONPARAM1 = 212 (0xD4) -> reads current DPI index, max stages, 8x DPI values, 8x RGB colors
//   FEA_CMD_MOUSE_SET_OPTIONPARAM1 = 84 (0x54)  -> sets active DPI index

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { withAjazzLock } = require('./ajazz_lock');

const IOT_PORT = 3814;
const FEA_CMD_GET = 212; // 0xD4
const FEA_CMD_SET = 84;  // 0x54
const CUT = '#000000';

const MOUSE =
  `<rect x="48" y="14" width="48" height="68" rx="24" fill="#fff"/>` +
  `<rect x="48" y="44" width="48" height="4" fill="${CUT}" fill-opacity=".62"/>` +
  `<rect x="68" y="22" width="8" height="18" rx="4" fill="${CUT}" fill-opacity=".62"/>`;

let cachedDevPath = null;
let lastDpiCache = null; // { data, at }
const CACHE_TTL_MS = 10_000;

// Persistent fallback to ensure display always shows last selected DPI even during mouse sleep or page switch
// Preloaded with standard Ajazz AJ179 PRO profiles (automatically updated with live values on hardware read)
let lastKnownDpi = {
  found: true,
  connected: true,
  currentDpiIndex: 4,
  currentDPIMax: 8,
  currentDpiValue: 2400,
  activeStageIndex: 4,
  activeStagesCount: 6,
  currentColor: '#ffff00',
  activeStages: [
    { index: 0, dpi: 400, color: '#ff0000' },
    { index: 1, dpi: 800, color: '#00ff00' },
    { index: 2, dpi: 1200, color: '#0000ff' },
    { index: 3, dpi: 1600, color: '#00ffff' },
    { index: 4, dpi: 2400, color: '#ffff00' },
    { index: 5, dpi: 3200, color: '#ff00ff' },
  ],
  dpis: [400, 800, 1200, 1600, 2400, 3200, 0, 0],
  colors: ['#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ffff00', '#ff00ff', '#ff00ff', '#ffffff'],
  rawBuf: null,
};

function findDevicePath() {
  if (cachedDevPath) return cachedDevPath;
  try {
    const HID = require('node-hid');
    const dev = HID.devices().find(
      (d) => d.vendorId === 0x3151 && d.usagePage === 0xffff && d.usage === 2
    );
    if (dev?.path) {
      cachedDevPath = dev.path;
      return cachedDevPath;
    }
  } catch {
    /* fallback to known path */
  }
  return '\\\\?\\HID#VID_3151&PID_402D&MI_02#b&1d08ce18&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}';
}

function ensureIotDriverRunning() {
  const possiblePaths = [
    path.join(process.env.APPDATA || '', 'AJAZZ Driver（R）', 'iot_driver_v193.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'AJAZZ Driver（R）', 'resources', 'app', 'iot_driver.exe'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const child = spawn(p, [], { detached: true, stdio: 'ignore' });
        child.unref();
        return true;
      } catch {
        /* continue */
      }
    }
  }
  return false;
}

function encodeVarint(val) {
  const bytes = [];
  while (val > 127) {
    bytes.push((val & 0x7f) | 0x80);
    val >>>= 7;
  }
  bytes.push(val & 0x7f);
  return Buffer.from(bytes);
}

function encodeField(fieldNum, wireType, data) {
  const tag = (fieldNum << 3) | wireType;
  return Buffer.concat([encodeVarint(tag), data]);
}

function encodeSendMsg(devicePath, msgBytes, checksumType = 0, dangleDevType = 0) {
  const parts = [];
  if (devicePath) {
    const b = Buffer.from(devicePath, 'utf8');
    parts.push(encodeField(1, 2, Buffer.concat([encodeVarint(b.length), b])));
  }
  if (msgBytes && msgBytes.length > 0) {
    parts.push(encodeField(2, 2, Buffer.concat([encodeVarint(msgBytes.length), msgBytes])));
  }
  if (checksumType !== 0) parts.push(encodeField(3, 0, encodeVarint(checksumType)));
  if (dangleDevType !== 0) parts.push(encodeField(4, 0, encodeVarint(dangleDevType)));
  const payload = Buffer.concat(parts);
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = 0x00;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

function encodeReadMsg(devicePath) {
  const b = Buffer.from(devicePath, 'utf8');
  const payload = encodeField(1, 2, Buffer.concat([encodeVarint(b.length), b]));
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = 0x00;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

function grpcCall(method, reqFrame, timeoutMs = 800) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: IOT_PORT,
        path: '/driver.DriverGrpc/' + method,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'content-type': 'application/grpc-web+proto',
          'x-grpc-web': '1',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, data: Buffer.concat(chunks) });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
    req.write(reqFrame);
    req.end();
  });
}

function parseGrpcResponse(buf) {
  if (!buf || buf.length < 5) return null;
  const len = buf.readUInt32BE(1);
  return buf.subarray(5, 5 + len);
}

function toHexColor(r, g, b) {
  const hex = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  return '#' + hex;
}

/**
 * Reads the current DPI configuration and active stage.
 * If mouse is sleeping/unreachable, gracefully preserves and returns last known DPI state.
 * @param {boolean} force - whether to bypass the in-memory cache
 */
async function readMouseDpi(force = false) {
  const now = Date.now();
  if (!force && lastDpiCache && now - lastDpiCache.at < CACHE_TTL_MS) {
    return lastDpiCache.data;
  }

  return withAjazzLock(async () => {
    // Check cache again in case another call populated it while waiting for lock
    if (!force && lastDpiCache && Date.now() - lastDpiCache.at < CACHE_TTL_MS) {
      return lastDpiCache.data;
    }

    const devPath = findDevicePath();
    // 64-byte getCmd with checksum at byte 7 required by Ajazz dongle firmware
    const getCmd = Buffer.alloc(64);
    getCmd[0] = FEA_CMD_GET; // 212 (0xD4)
    getCmd[1] = 0;           // profile 0
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += getCmd[i];
    getCmd[7] = (255 - (sum & 0xff)) & 0xff;

    let sendRes;
    try {
      sendRes = await grpcCall('sendMsg', encodeSendMsg(devPath, getCmd, 0, 0));
    } catch (err) {
      if (err.code === 'ECONNREFUSED' && ensureIotDriverRunning()) {
        await new Promise((r) => setTimeout(r, 600));
        sendRes = await grpcCall('sendMsg', encodeSendMsg(devPath, getCmd, 0, 0)).catch(() => null);
      }
    }

    if (!sendRes) {
      const standby = { ...lastKnownDpi, connected: true };
      lastDpiCache = { data: standby, at: Date.now() };
      return standby;
    }

    await new Promise((r) => setTimeout(r, 20));
    let readRes;
    try {
      readRes = await grpcCall('readMsg', encodeReadMsg(devPath));
    } catch {
      const standby = { ...lastKnownDpi, connected: true };
      lastDpiCache = { data: standby, at: Date.now() };
      return standby;
    }

    const payload = parseGrpcResponse(readRes?.data);
    if (!payload || payload.length < 66) {
      const standby = { ...lastKnownDpi, connected: true };
      lastDpiCache = { data: standby, at: Date.now() };
      return standby;
    }

    const buf = payload.subarray(2);
    // CRITICAL: Verify response command is indeed FEA_CMD_GET (212 / 0xD4).
    // If it's a battery response (0 / 131) or layer response (133), do NOT overwrite!
    if (buf[0] !== FEA_CMD_GET) {
      return lastKnownDpi;
    }

    const currentDpiIndex = buf[2];
    const currentDPIMax = buf[3] || 8;

    const dpis = [];
    for (let i = 0; i < 8; i++) {
      dpis.push(buf.readUInt16LE(8 + i * 2));
    }

    const colors = [];
    for (let i = 0; i < 8; i++) {
      colors.push(toHexColor(buf[40 + i * 3], buf[40 + i * 3 + 1], buf[40 + i * 3 + 2]));
    }

    // Dynamically extract all stages configured with DPI > 0
    const activeStages = [];
    for (let i = 0; i < dpis.length; i++) {
      if (dpis[i] > 0) {
        activeStages.push({
          index: i,
          dpi: dpis[i],
          color: colors[i] && colors[i] !== '#000000' ? colors[i] : '#ffff00',
        });
      }
    }

    // CRITICAL: If no active stages could be parsed (e.g. empty report), keep lastKnownDpi!
    if (activeStages.length === 0) {
      return lastKnownDpi;
    }

    let activeStageIndex = activeStages.findIndex((s) => s.index === currentDpiIndex);
    if (activeStageIndex === -1 && activeStages.length > 0) activeStageIndex = 0;

    const result = {
      found: true,
      connected: true,
      currentDpiIndex,
      currentDPIMax,
      currentDpiValue: dpis[currentDpiIndex] || (activeStages[0]?.dpi ?? lastKnownDpi.currentDpiValue),
      activeStageIndex,
      activeStagesCount: activeStages.length,
      activeStages,
      currentColor: colors[currentDpiIndex] && colors[currentDpiIndex] !== '#000000' ? colors[currentDpiIndex] : '#ffff00',
      dpis,
      colors,
      rawBuf: buf,
    };

    lastKnownDpi = result;
    lastDpiCache = { data: result, at: Date.now() };
    return result;
  });
}

let commitTimer = null;

function buildDpiPayload(state) {
  // 64-byte payload matching driver FEA_CMD_MOUSE_SET_OPTIONPARAM1 protocol
  const u = Buffer.alloc(64);
  if (state?.rawBuf && state.rawBuf.length >= 64) {
    state.rawBuf.copy(u);
  } else {
    const dpis = state?.dpis || [400, 800, 1200, 1600, 2400, 3200, 0, 0];
    for (let i = 0; i < 8; i++) {
      u.writeUInt16LE(dpis[i] || 0, 8 + i * 2);
    }
    const colors = state?.colors || [];
    for (let i = 0; i < 8; i++) {
      const hex = colors[i] || '#38bdf8';
      const parsed = parseInt(String(hex).replace('#', ''), 16) || 0;
      u[40 + i * 3 + 0] = (parsed >> 16) & 0xff;
      u[40 + i * 3 + 1] = (parsed >> 8) & 0xff;
      u[40 + i * 3 + 2] = parsed & 0xff;
    }
  }

  const targetIndex = state?.currentDpiIndex !== undefined ? state.currentDpiIndex : 4;
  u[0] = FEA_CMD_SET; // 84 (0x54)
  u[1] = 0;           // profile 0
  u[2] = targetIndex; // target DPI index
  u[3] = state?.currentDPIMax || 8;

  // Checksum at byte 7: (255 - (sum(0..6) & 0xff)) & 0xff
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += u[i];
  u[7] = (255 - (sum & 0xff)) & 0xff;

  return u;
}

async function commitHardwareDpi(state) {
  if (!state) return;
  const payload = buildDpiPayload(state);
  const devPath = findDevicePath();

  return withAjazzLock(async () => {
    // 1. Direct USB HID Feature Report via node-hid (instant, no driver dependencies)
    try {
      const HID = require('node-hid');
      const hidBuf = Buffer.alloc(65);
      hidBuf[0] = 0; // Windows HID report ID 0
      payload.copy(hidBuf, 1);
      const dev = new HID.HID(devPath);
      dev.sendFeatureReport(Array.from(hidBuf));
      dev.close();
    } catch (err) {
      /* fallback */
    }

    // 2. Also send via gRPC sendMsg with checksum embedded at byte 7
    try {
      await grpcCall('sendMsg', encodeSendMsg(devPath, payload, 0, 0));
    } catch {}
  });
}

/**
 * Optimistically steps the DPI stage up or down in memory, returns immediately,
 * and debounces the hardware write by 120ms.
 */
function stepDpi(direction) {
  let current = lastDpiCache?.data || lastKnownDpi;
  let stages = current.activeStages;
  if (!stages || stages.length === 0) {
    stages = lastKnownDpi.activeStages && lastKnownDpi.activeStages.length > 0
      ? lastKnownDpi.activeStages
      : [
          { index: 0, dpi: 400, color: '#ff0000' },
          { index: 1, dpi: 800, color: '#00ff00' },
          { index: 2, dpi: 1200, color: '#0000ff' },
          { index: 3, dpi: 1600, color: '#00ffff' },
          { index: 4, dpi: 2400, color: '#ffff00' },
          { index: 5, dpi: 3200, color: '#ff00ff' },
        ];
  }

  let curPos = current.activeStageIndex;
  if (curPos === undefined || curPos < 0 || curPos >= stages.length) {
    curPos = stages.findIndex((s) => s.index === current.currentDpiIndex);
    if (curPos === -1) curPos = 0;
  }

  const delta = direction > 0 ? 1 : -1;
  let nextPos = curPos + delta;
  if (nextPos >= stages.length) nextPos = 0;
  if (nextPos < 0) nextPos = stages.length - 1;

  const nextStage = stages[nextPos];

  current = {
    ...current,
    found: true,
    connected: true,
    activeStageIndex: nextPos,
    activeStagesCount: stages.length,
    activeStages: stages,
    currentDpiIndex: nextStage.index,
    currentDpiValue: nextStage.dpi,
    currentColor: nextStage.color,
  };

  lastKnownDpi = current;
  lastDpiCache = { data: current, at: Date.now() };

  // Debounced commit to hardware
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    commitHardwareDpi(current);
  }, 100);

  return current;
}

/**
 * Optimistically cycles to the next DPI stage.
 */
function cycleNextDpi() {
  return stepDpi(1);
}

/**
 * Draws the 144x144 SVG tile for the DPI button.
 * Always renders the full vibrant colors, pill, glow line, and stages.
 */
function drawDpiKey(dpiInfo, switching = false) {
  const info = dpiInfo || lastKnownDpi;
  const isConnected = info && info.connected !== false;
  const dpiValue = info.currentDpiValue || lastKnownDpi.currentDpiValue || 2400;
  const rawTotal = info.activeStagesCount || (info.activeStages ? info.activeStages.length : 0);
  const totalStages = Math.max(1, rawTotal || 6);
  const rawIndex = info.activeStageIndex ?? 0;
  const stageIndex = Math.max(0, Math.min(totalStages - 1, rawIndex < 0 ? 0 : rawIndex));
  const rawColor = info.currentColor;
  const stageColor = rawColor && rawColor !== '#000000' ? rawColor : '#ffff00';

  let dotsSvg = '';
  if (totalStages > 1 && totalStages <= 6) {
    const spacing = 16;
    const startX = 72 - ((totalStages - 1) * spacing) / 2;
    for (let i = 0; i < totalStages; i++) {
      const cx = startX + i * spacing;
      const isActive = i === stageIndex;
      const fill = isActive ? stageColor : '#475569';
      const r = isActive ? 5 : 3;
      dotsSvg += `<circle cx="${cx}" cy="125" r="${r}" fill="${fill}"/>`;
    }
  }

  const switchPulse = switching
    ? `<circle cx="134" cy="10" r="5" fill="#38bdf8"/>`
    : '';

  const mouseOpacity = isConnected ? '0.9' : '0.7';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" fill="#101014"/>` +
    // Top bar: Mouse icon (left), DPI label (middle), Stage pill (right)
    `<g transform="translate(18 24) scale(0.32) translate(-72 -48)" opacity="${mouseOpacity}">` +
    MOUSE +
    `</g>` +
    `<text x="36" y="29" font-family="Segoe UI,Arial,sans-serif" font-size="14" ` +
    `font-weight="800" fill="#94a3b8" letter-spacing="0.5">DPI</text>` +
    // Stage badge with larger 14px font & solid contrasting pill
    `<rect x="88" y="13" width="44" height="22" rx="6" fill="${stageColor}" fill-opacity="0.3" stroke="${stageColor}" stroke-width="1.2"/>` +
    `<text x="110" y="29" font-family="Segoe UI,Arial,sans-serif" font-size="14" font-weight="800" fill="#ffffff" stroke="#000000" stroke-width="2" paint-order="stroke fill" text-anchor="middle">${stageIndex + 1}/${totalStages}</text>` +
    `<line x1="12" y1="41" x2="132" y2="41" stroke="#262a36" stroke-width="1.5"/>` +
    // Main DPI value (large 34px bold, always white and visible)
    `<text x="72" y="85" font-family="Segoe UI,Arial,sans-serif" font-size="34" ` +
    `font-weight="800" text-anchor="middle" fill="#ffffff" stroke="#000000" stroke-width="2.5" paint-order="stroke fill">` +
    `${dpiValue}` +
    `</text>` +
    // Color glow bar under value (always full opacity and vibrant)
    `<rect x="24" y="100" width="96" height="5" rx="2.5" fill="${stageColor}"/>` +
    dotsSvg +
    switchPulse +
    `</svg>`
  );
}

// Prime cache on startup in background
readMouseDpi(true).catch(() => {});

module.exports = {
  readMouseDpi,
  cycleNextDpi,
  stepDpi,
  drawDpiKey,
};
