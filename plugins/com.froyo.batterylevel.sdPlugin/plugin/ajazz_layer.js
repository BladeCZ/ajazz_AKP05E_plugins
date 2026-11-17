// Ajazz AJ179 PRO Hardware Profile / Layer reader and switcher.
//
// Reads and switches mouse onboard hardware profile layers (Layer-1 to Layer-8).
// Communicates with iot_driver on 127.0.0.1:3814 using gRPC-Web.
//
// Protocol:
//   FEA_CMD_GET_PROFILE = 133 (0x85) -> reads current profile index (byte 1: 0..7)
//   FEA_CMD_SET_PROFILE = 5   (0x05) -> sets active profile index (byte 1: 0..7)
//   Checksum in byte 7: (255 - (sum(byte 0..6) & 0xff)) & 0xff

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { withAjazzLock } = require('./ajazz_lock');

const IOT_PORT = 3814;
const FEA_CMD_GET = 133; // 0x85
const FEA_CMD_SET = 5;   // 0x05
const MAX_LAYERS = 8;
const CUT = '#000000';

const MOUSE =
  `<rect x="48" y="14" width="48" height="68" rx="24" fill="#fff"/>` +
  `<rect x="48" y="44" width="48" height="4" fill="${CUT}" fill-opacity=".62"/>` +
  `<rect x="68" y="22" width="8" height="18" rx="4" fill="${CUT}" fill-opacity=".62"/>`;

let cachedDevPath = null;
let lastLayerCache = null; // { data, at }
const CACHE_TTL_MS = 10_000;

// Persistent fallback to ensure display always shows last selected layer even during mouse sleep
let lastKnownLayer = {
  found: true,
  connected: true,
  layerIndex: 0,
  currentLayer: 1,
  maxLayers: MAX_LAYERS,
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
    /* fallback */
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

/**
 * Reads active hardware layer (1..8) from the mouse.
 * If mouse is sleeping/unreachable, gracefully preserves and returns last known layer.
 * @param {boolean} force
 */
async function readMouseLayer(force = false) {
  const now = Date.now();
  if (!force && lastLayerCache && now - lastLayerCache.at < CACHE_TTL_MS) {
    return lastLayerCache.data;
  }

  return withAjazzLock(async () => {
    if (!force && lastLayerCache && Date.now() - lastLayerCache.at < CACHE_TTL_MS) {
      return lastLayerCache.data;
    }

    const devPath = findDevicePath();
    const getCmd = Buffer.alloc(64);
    getCmd[0] = FEA_CMD_GET;
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
      const standby = { ...lastKnownLayer, connected: true };
      lastLayerCache = { data: standby, at: Date.now() };
      return standby;
    }

    await new Promise((r) => setTimeout(r, 20));
    let readRes;
    try {
      readRes = await grpcCall('readMsg', encodeReadMsg(devPath));
    } catch {
      const standby = { ...lastKnownLayer, connected: true };
      lastLayerCache = { data: standby, at: Date.now() };
      return standby;
    }

    const payload = parseGrpcResponse(readRes?.data);
    if (!payload || payload.length < 66) {
      const standby = { ...lastKnownLayer, connected: true };
      lastLayerCache = { data: standby, at: Date.now() };
      return standby;
    }

    const raw = payload.subarray(2);
    // CRITICAL: verify that response is FEA_CMD_GET (133 / 0x85)
    if (raw[0] !== FEA_CMD_GET) {
      return lastKnownLayer;
    }

    const layerIndex = raw[1] !== undefined ? raw[1] : lastKnownLayer.layerIndex;
    const currentLayer = layerIndex + 1;

    const result = {
      found: true,
      connected: true,
      layerIndex,
      currentLayer,
      maxLayers: MAX_LAYERS,
    };

    lastKnownLayer = result;
    lastLayerCache = { data: result, at: Date.now() };
    return result;
  });
}

let commitLayerTimer = null;

async function commitHardwareLayer(layerIndex) {
  const devPath = findDevicePath();
  const setCmd = Buffer.alloc(64);
  setCmd[0] = FEA_CMD_SET;
  setCmd[1] = Math.max(0, Math.min(MAX_LAYERS - 1, layerIndex));
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += setCmd[i];
  setCmd[7] = (255 - (sum & 0xff)) & 0xff;

  return withAjazzLock(async () => {
    // 1. Direct USB HID Feature Report via node-hid
    try {
      const HID = require('node-hid');
      const hidBuf = Buffer.alloc(65);
      hidBuf[0] = 0;
      setCmd.copy(hidBuf, 1);
      const dev = new HID.HID(devPath);
      dev.sendFeatureReport(Array.from(hidBuf));
      dev.close();
    } catch (err) {}

    // 2. Also send via gRPC sendRawFeature and sendMsg with dangleDevType = 2 (MOUSE)
    try {
      await grpcCall('sendRawFeature', encodeSendMsg(devPath, setCmd, 0, 2));
    } catch {}
    try {
      await grpcCall('sendMsg', encodeSendMsg(devPath, setCmd, 0, 2));
    } catch {}
  });
}

/**
 * Steps layer up or down, bounded by maxProfiles (e.g. 1..3 or 1..8).
 */
function stepLayer(direction, maxProfiles = 8) {
  const maxLimit = Math.max(2, Math.min(MAX_LAYERS, Number(maxProfiles) || MAX_LAYERS));
  let current = lastLayerCache?.data || lastKnownLayer;
  const delta = direction > 0 ? 1 : -1;
  let nextIdx = (current.layerIndex ?? 0) + delta;
  if (nextIdx >= maxLimit) nextIdx = 0;
  if (nextIdx < 0) nextIdx = maxLimit - 1;

  current = {
    found: true,
    connected: true,
    layerIndex: nextIdx,
    currentLayer: nextIdx + 1,
    maxLayers: maxLimit,
  };

  lastKnownLayer = current;
  lastLayerCache = { data: current, at: Date.now() };

  if (commitLayerTimer) clearTimeout(commitLayerTimer);
  commitLayerTimer = setTimeout(() => {
    commitHardwareLayer(current.layerIndex);
  }, 220);

  return current;
}

function cycleNextLayer(maxProfiles = 8) {
  return stepLayer(1, maxProfiles);
}

// Colors for the 8 layers to make each instantly recognizable
const LAYER_COLORS = [
  '#38bdf8', // L1: Sky Blue
  '#22c55e', // L2: Emerald Green
  '#eab308', // L3: Amber Yellow
  '#f97316', // L4: Bright Orange
  '#ec4899', // L5: Pink / Magenta
  '#a855f7', // L6: Purple
  '#06b6d4', // L7: Cyan
  '#14b8a6', // L8: Teal
];

/**
 * Draws the 144x144 SVG tile for the Profile / Layer button.
 * Preserves full vibrancy, line, and stage pill.
 */
function drawLayerKey(layerInfo, switching = false, maxProfiles = 8) {
  const info = layerInfo || lastKnownLayer;
  const isConnected = info && info.connected !== false;
  const currentLayer = info.currentLayer || lastKnownLayer.currentLayer || 1;
  const limit = Math.max(2, Math.min(MAX_LAYERS, Number(maxProfiles) || info.maxLayers || MAX_LAYERS));
  const layerIdx = Math.max(0, Math.min(limit - 1, currentLayer - 1));
  const accentColor = LAYER_COLORS[layerIdx] || '#38bdf8';

  // Dots at bottom tailored to maxProfiles (e.g. 3 dots if limit=3)
  let dotsSvg = '';
  const spacing = limit <= 4 ? 20 : (limit <= 6 ? 16 : 14);
  const startX = 72 - ((limit - 1) * spacing) / 2;
  for (let i = 0; i < limit; i++) {
    const cx = startX + i * spacing;
    const isActive = i === layerIdx;
    const fill = isActive ? accentColor : '#334155';
    const r = isActive ? 5 : 3;
    dotsSvg += `<circle cx="${cx}" cy="126" r="${r}" fill="${fill}"/>`;
  }

  const switchPulse = switching
    ? `<circle cx="134" cy="10" r="5" fill="#38bdf8"/>`
    : '';

  const mouseOpacity = isConnected ? '0.9' : '0.4';
  const sleepBadge = !isConnected
    ? `<text x="72" y="52" font-family="Segoe UI,Arial,sans-serif" font-size="10" font-weight="700" fill="#64748b" text-anchor="middle" letter-spacing="0.5">STANDBY (Zzz)</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" fill="#101014"/>` +
    // Top bar: Mouse icon (left), "PROFILE" full text (middle), Pill badge (right)
    `<g transform="translate(16 24) scale(0.32) translate(-72 -48)" opacity="${mouseOpacity}">` +
    MOUSE +
    `</g>` +
    `<text x="34" y="29" font-family="Segoe UI,Arial,sans-serif" font-size="13" ` +
    `font-weight="800" fill="#94a3b8" letter-spacing="0.5">PROFILE</text>` +
    // Pill badge: "L1".."L8" with 14px bold font neatly placed on the right
    `<rect x="94" y="13" width="40" height="22" rx="6" fill="${accentColor}" fill-opacity="0.3" stroke="${accentColor}" stroke-width="1.2"/>` +
    `<text x="114" y="29" font-family="Segoe UI,Arial,sans-serif" font-size="14" font-weight="800" fill="#ffffff" stroke="#000000" stroke-width="2" paint-order="stroke fill" text-anchor="middle">L${currentLayer}</text>` +
    `<line x1="12" y1="41" x2="132" y2="41" stroke="#262a36" stroke-width="1.5"/>` +
    // Center label: LAYER
    sleepBadge +
    `<text x="72" y="${isConnected ? 65 : 68}" font-family="Segoe UI,Arial,sans-serif" font-size="15" ` +
    `font-weight="700" text-anchor="middle" fill="#94a3b8" letter-spacing="1.5">` +
    `LAYER` +
    `</text>` +
    // Large center number: ALWAYS visible, bold white with black stroke
    `<text x="72" y="103" font-family="Segoe UI,Arial,sans-serif" font-size="40" ` +
    `font-weight="800" text-anchor="middle" fill="#ffffff" stroke="#000000" stroke-width="3" paint-order="stroke fill">` +
    `${currentLayer}` +
    `</text>` +
    // Color glow bar under number
    `<rect x="36" y="112" width="72" height="4" rx="2" fill="${accentColor}"/>` +
    dotsSvg +
    switchPulse +
    `</svg>`
  );
}

// Prime cache on startup in background
readMouseLayer(true).catch(() => {});

module.exports = {
  readMouseLayer,
  cycleNextLayer,
  stepLayer,
  drawLayerKey,
  MAX_LAYERS,
  LAYER_COLORS,
};
