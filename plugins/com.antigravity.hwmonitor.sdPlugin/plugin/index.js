'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert');
const WebSocket = require('ws');

const POLL_MS = 2000;
const HISTORY_LEN = 30;
const SENSORS_SCRIPT = path.join(__dirname, 'sensors.ps1');
const LOG_PATH = path.join(__dirname, 'plugin.log');
const LOG_MAX_BYTES = 256 * 1024;

const STYLE_ORDER = ['multi_graph', 'gauge_multi', 'quad_grid', 'bars_triple', 'big_clean'];

const THEMES = {
  cyan:    { accent: '#38bdf8', glow: '#0284c7', header: '#0369a1' },
  amd:     { accent: '#ef4444', glow: '#dc2626', header: '#b91c1c' },
  emerald: { accent: '#10b981', glow: '#059669', header: '#047857' },
  purple:  { accent: '#a855f7', glow: '#7e22ce', header: '#6b21a8' },
  amber:   { accent: '#f59e0b', glow: '#d97706', header: '#b45309' },
};

const METRICS = {
  cpu_usage: {
    shortLabel: 'ZÁTĚŽ',
    fullLabel: 'CPU Vytížení (%)',
    min: 0, max: 100, warn: 65, crit: 85,
    format: (v) => `${Math.round(v)}%`,
    formatCompact: (v) => `${Math.round(v)}%`,
  },
  cpu_util: {
    shortLabel: 'UTIL',
    fullLabel: 'CPU Utility (%)',
    min: 0, max: 100, warn: 65, crit: 85,
    format: (v) => `${Math.round(v)}%`,
    formatCompact: (v) => `${Math.round(v)}%`,
  },
  cpu_temp: {
    shortLabel: 'TEPL',
    fullLabel: 'CPU Teplota (°C)',
    min: 30, max: 95, warn: 72, crit: 84,
    format: (v) => `${Math.round(v)}°C`,
    formatCompact: (v) => `${Math.round(v)}°C`,
  },
  cpu_power: {
    shortLabel: 'VÝKON',
    fullLabel: 'CPU Výkon (W)',
    min: 0, max: 162, warn: 105, crit: 135,
    format: (v) => `${Math.round(v)}W`,
    formatCompact: (v) => `${Math.round(v)}W`,
  },
  cpu_clock: {
    shortLabel: 'TAKT',
    fullLabel: 'CPU Takt (GHz / MHz)',
    min: 800, max: 5400, warn: 9999, crit: 9999,
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)}GHz` : `${Math.round(v)}MHz`),
    formatCompact: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}G` : `${Math.round(v)}M`),
  },
  cpu_volt: {
    shortLabel: 'VCORE',
    fullLabel: 'CPU Napětí (V)',
    min: 0.6, max: 1.5, warn: 1.38, crit: 1.45,
    format: (v) => `${Number(v).toFixed(2)}V`,
    formatCompact: (v) => `${Number(v).toFixed(2)}V`,
  },

  gpu_usage: {
    shortLabel: 'JÁDRO',
    fullLabel: 'GPU Vytížení (%)',
    min: 0, max: 100, warn: 75, crit: 92,
    format: (v) => `${Math.round(v)}%`,
    formatCompact: (v) => `${Math.round(v)}%`,
  },
  gpu_temp: {
    shortLabel: 'TEPL',
    fullLabel: 'GPU Teplota Edge (°C)',
    min: 25, max: 95, warn: 68, crit: 80,
    format: (v) => `${Math.round(v)}°C`,
    formatCompact: (v) => `${Math.round(v)}°C`,
  },
  gpu_hotspot: {
    shortLabel: 'HOTSP',
    fullLabel: 'GPU HotSpot Teplota (°C)',
    min: 30, max: 110, warn: 82, crit: 95,
    format: (v) => `${Math.round(v)}°C`,
    formatCompact: (v) => `${Math.round(v)}°C`,
  },
  gpu_mem_temp: {
    shortLabel: 'VRAM°',
    fullLabel: 'GPU Paměť Teplota (°C)',
    min: 30, max: 105, warn: 80, crit: 92,
    format: (v) => `${Math.round(v)}°C`,
    formatCompact: (v) => `${Math.round(v)}°C`,
  },
  gpu_power: {
    shortLabel: 'PŘÍK',
    fullLabel: 'GPU Příkon TBP (W)',
    min: 0, max: 380, warn: 280, crit: 335,
    format: (v) => `${Math.round(v)}W`,
    formatCompact: (v) => `${Math.round(v)}W`,
  },
  gpu_clock: {
    shortLabel: 'TAKT',
    fullLabel: 'GPU Takt jádra (MHz)',
    min: 0, max: 3300, warn: 9999, crit: 9999,
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)}GHz` : `${Math.round(v)}MHz`),
    formatCompact: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}G` : `${Math.round(v)}M`),
  },
  gpu_mem_clock: {
    shortLabel: 'MEMHz',
    fullLabel: 'GPU Takt paměti (MHz)',
    min: 0, max: 2800, warn: 9999, crit: 9999,
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)}G` : `${Math.round(v)}M`),
    formatCompact: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}G` : `${Math.round(v)}M`),
  },
  gpu_mem_ctrl: {
    shortLabel: 'ŘADIČ',
    fullLabel: 'GPU Řadič paměti (%)',
    min: 0, max: 100, warn: 70, crit: 90,
    format: (v) => `${Math.round(v)}%`,
    formatCompact: (v) => `${Math.round(v)}%`,
  },
  gpu_fan_rpm: {
    shortLabel: 'FAN',
    fullLabel: 'GPU Ventilátor (RPM)',
    min: 0, max: 3200, warn: 2000, crit: 2600,
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}kr` : `${Math.round(v)}r`),
    formatCompact: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}r`),
  },
  gpu_fan_pct: {
    shortLabel: 'FAN%',
    fullLabel: 'GPU Ventilátor (%)',
    min: 0, max: 100, warn: 65, crit: 85,
    format: (v) => `${Math.round(v)}%`,
    formatCompact: (v) => `${Math.round(v)}%`,
  },
  gpu_volt: {
    shortLabel: 'VOLT',
    fullLabel: 'GPU Napětí (V)',
    min: 0.4, max: 1.25, warn: 99, crit: 99,
    format: (v) => `${Number(v).toFixed(2)}V`,
    formatCompact: (v) => `${Number(v).toFixed(2)}V`,
  },

  vram_used_gb: {
    shortLabel: 'VRAM',
    fullLabel: 'GPU VRAM Obsazeno (GB)',
    min: 0, max: 16, warn: 12, crit: 14.5,
    format: (v) => `${Number(v).toFixed(1)}GB`,
    formatCompact: (v) => `${Number(v).toFixed(1)}G`,
  },
  vram_pct: {
    shortLabel: 'VRAM%',
    fullLabel: 'GPU VRAM Využití (%)',
    min: 0, max: 100, warn: 75, crit: 90,
    format: (v) => `${Math.round(v)}%`,
    formatCompact: (v) => `${Math.round(v)}%`,
  },

  ram_pct: {
    shortLabel: 'RAM%',
    fullLabel: 'RAM Využití (%)',
    min: 0, max: 100, warn: 75, crit: 90,
    format: (v) => `${Math.round(v)}%`,
    formatCompact: (v) => `${Math.round(v)}%`,
  },
  ram_used_gb: {
    shortLabel: 'UŽITO',
    fullLabel: 'RAM Obsazeno (GB)',
    min: 0, max: 64, warn: 48, crit: 56,
    format: (v) => `${Number(v).toFixed(1)}GB`,
    formatCompact: (v) => (v >= 10 ? `${Math.round(v)}GB` : `${Number(v).toFixed(1)}G`),
  },
  ram_free_gb: {
    shortLabel: 'VOLNÉ',
    fullLabel: 'RAM Volná (GB)',
    min: 0, max: 64, warn: 999, crit: 999,
    format: (v) => `${Number(v).toFixed(1)}GB`,
    formatCompact: (v) => (v >= 10 ? `${Math.round(v)}GB` : `${Number(v).toFixed(1)}G`),
  },
  ddr_temp: {
    shortLabel: 'DDR5°',
    fullLabel: 'DDR5 RAM Teplota (°C)',
    min: 25, max: 75, warn: 52, crit: 62,
    format: (v) => `${Number(v).toFixed(1)}°C`,
    formatCompact: (v) => `${Math.round(v)}°C`,
  },
  ddr_temp1: {
    shortLabel: 'DIMM1',
    fullLabel: 'DDR5 DIMM #1 Teplota (°C)',
    min: 25, max: 75, warn: 52, crit: 62,
    format: (v) => `${Number(v).toFixed(1)}°C`,
    formatCompact: (v) => `${Math.round(v)}°C`,
  },
  ddr_temp2: {
    shortLabel: 'DIMM3',
    fullLabel: 'DDR5 DIMM #3 Teplota (°C)',
    min: 25, max: 75, warn: 52, crit: 62,
    format: (v) => `${Number(v).toFixed(1)}°C`,
    formatCompact: (v) => `${Math.round(v)}°C`,
  },
  ddr_power: {
    shortLabel: 'DDR W',
    fullLabel: 'DDR5 Příkon modulů (W)',
    min: 0, max: 10, warn: 6, crit: 8,
    format: (v) => `${Number(v).toFixed(2)}W`,
    formatCompact: (v) => `${Number(v).toFixed(1)}W`,
  },
  ddr_mts: {
    shortLabel: 'RAMHz',
    fullLabel: 'DDR5 Rychlost (MT/s)',
    min: 2000, max: 6400, warn: 99999, crit: 99999,
    format: (v) => `${Math.round(v)}`,
    formatCompact: (v) => `${(v / 1000).toFixed(1)}G`,
  },

  vrm_temp: {
    shortLabel: 'VRM°',
    fullLabel: 'VRM Napájení Teplota (°C)',
    min: 25, max: 100, warn: 70, crit: 85,
    format: (v) => `${Math.round(v)}°C`,
    formatCompact: (v) => `${Math.round(v)}°C`,
  },
  mb_temp: {
    shortLabel: 'DESKA',
    fullLabel: 'Základní deska Teplota (°C)',
    min: 20, max: 70, warn: 50, crit: 60,
    format: (v) => `${Math.round(v)}°C`,
    formatCompact: (v) => `${Math.round(v)}°C`,
  },
  chipset_temp: {
    shortLabel: 'CHIPS',
    fullLabel: 'Chipset B850 Teplota (°C)',
    min: 30, max: 85, warn: 65, crit: 75,
    format: (v) => `${Math.round(v)}°C`,
    formatCompact: (v) => `${Math.round(v)}°C`,
  },

  disk_pct: {
    shortLabel: 'DISK%',
    fullLabel: 'Disk Aktivita (%)',
    min: 0, max: 100, warn: 70, crit: 90,
    format: (v) => `${Math.round(v)}%`,
    formatCompact: (v) => `${Math.round(v)}%`,
  },
  disk_read_mb: {
    shortLabel: 'ČTENÍ',
    fullLabel: 'Disk Čtení (MB/s)',
    min: 0, max: 500, warn: 9999, crit: 9999,
    format: (v) => (v >= 100 ? `${Math.round(v)}M/s` : `${Number(v).toFixed(1)}M/s`),
    formatCompact: (v) => (v >= 10 ? `${Math.round(v)}M` : `${Number(v).toFixed(1)}M`),
  },
  disk_write_mb: {
    shortLabel: 'ZÁPIS',
    fullLabel: 'Disk Zápis (MB/s)',
    min: 0, max: 500, warn: 9999, crit: 9999,
    format: (v) => (v >= 100 ? `${Math.round(v)}M/s` : `${Number(v).toFixed(1)}M/s`),
    formatCompact: (v) => (v >= 10 ? `${Math.round(v)}M` : `${Number(v).toFixed(1)}M`),
  },
  ssd_c_temp: {
    shortLabel: 'SSD C',
    fullLabel: 'SSD [C:] Teplota (°C)',
    min: 25, max: 80, warn: 60, crit: 70,
    format: (v) => `${Math.round(v)}°C`,
    formatCompact: (v) => `${Math.round(v)}°C`,
  },
  ssd_f_temp: {
    shortLabel: 'SSD F',
    fullLabel: 'SSD [F:] Teplota (°C)',
    min: 25, max: 80, warn: 60, crit: 70,
    format: (v) => `${Math.round(v)}°C`,
    formatCompact: (v) => `${Math.round(v)}°C`,
  },
  c_free_gb: {
    shortLabel: 'C:VOL',
    fullLabel: 'Disk [C:] Volné místo (GB)',
    min: 0, max: 465, warn: 9999, crit: 9999,
    format: (v) => `${Number(v).toFixed(1)}GB`,
    formatCompact: (v) => `${Number(v).toFixed(1)}G`,
  },

  net_dl_kbs: {
    shortLabel: 'DOWN',
    fullLabel: 'Síť Download (KB/s / MB/s)',
    min: 0, max: 25000, warn: 999999, crit: 999999,
    format: (v) => (v >= 1024 ? `${(v / 1024).toFixed(1)}MB` : `${Math.round(v)}KB`),
    formatCompact: (v) => (v >= 1024 ? `${(v / 1024).toFixed(1)}M` : `${Math.round(v)}K`),
  },
  net_ul_kbs: {
    shortLabel: 'UP',
    fullLabel: 'Síť Upload (KB/s / MB/s)',
    min: 0, max: 10000, warn: 999999, crit: 999999,
    format: (v) => (v >= 1024 ? `${(v / 1024).toFixed(1)}MB` : `${Math.round(v)}KB`),
    formatCompact: (v) => (v >= 1024 ? `${(v / 1024).toFixed(1)}M` : `${Math.round(v)}K`),
  },
  net_total_mbps: {
    shortLabel: 'SÍŤ',
    fullLabel: 'Síť Celkem (Mbps)',
    min: 0, max: 500, warn: 999999, crit: 999999,
    format: (v) => (v >= 10 ? `${Math.round(v)}Mb` : `${Number(v).toFixed(1)}Mb`),
    formatCompact: (v) => (v >= 10 ? `${Math.round(v)}M` : `${Number(v).toFixed(1)}M`),
  },
};

const ACTION_DEFAULTS = {
  'com.antigravity.hwmonitor.cpu': {
    title: 'CPU 9800X3D',
    style: 'multi_graph',
    theme: 'auto',
    metric1: 'cpu_usage',
    metric2: 'cpu_temp',
    metric3: 'cpu_power',
    metric4: 'cpu_clock',
    clickAction: 'cycle',
    textStrokeWidth: '3',
  },
  'com.antigravity.hwmonitor.gpu': {
    title: 'GPU 9070XT',
    style: 'multi_graph',
    theme: 'auto',
    metric1: 'gpu_usage',
    metric2: 'gpu_temp',
    metric3: 'gpu_power',
    metric4: 'gpu_clock',
    clickAction: 'cycle',
    textStrokeWidth: '3',
  },
  'com.antigravity.hwmonitor.vram': {
    title: 'VRAM & FAN',
    style: 'quad_grid',
    theme: 'amd',
    metric1: 'vram_used_gb',
    metric2: 'gpu_hotspot',
    metric3: 'gpu_mem_temp',
    metric4: 'gpu_fan_rpm',
    clickAction: 'cycle',
    textStrokeWidth: '3',
  },
  'com.antigravity.hwmonitor.ram': {
    title: 'RAM DDR5',
    style: 'bars_triple',
    theme: 'emerald',
    metric1: 'ram_pct',
    metric2: 'ram_used_gb',
    metric3: 'ddr_temp',
    metric4: 'ddr_power',
    clickAction: 'cycle',
    textStrokeWidth: '3',
  },
  'com.antigravity.hwmonitor.storage': {
    title: 'SÍŤ & DISK',
    style: 'quad_grid',
    theme: 'purple',
    metric1: 'net_dl_kbs',
    metric2: 'net_ul_kbs',
    metric3: 'ssd_c_temp',
    metric4: 'c_free_gb',
    clickAction: 'cycle',
    textStrokeWidth: '3',
  },
  'com.antigravity.hwmonitor.custom': {
    title: 'SYSTÉM',
    style: 'gauge_multi',
    theme: 'cyan',
    metric1: 'cpu_temp',
    metric2: 'gpu_temp',
    metric3: 'ddr_temp',
    metric4: 'vrm_temp',
    clickAction: 'cycle',
    textStrokeWidth: '3',
  },
};

function getActionDefaults(actionUUID) {
  return ACTION_DEFAULTS[actionUUID] || ACTION_DEFAULTS['com.antigravity.hwmonitor.custom'];
}

function mergeSettings(raw, actionUUID) {
  const base = getActionDefaults(actionUUID);
  const merged = Object.assign({}, base, raw || {});
  if (!merged.title || String(merged.title).trim() === '') merged.title = base.title;
  if (!STYLE_ORDER.includes(merged.style)) merged.style = base.style;
  return merged;
}

function logMsg(msg) {
  try {
    const st = fs.statSync(LOG_PATH, { throwIfNoEntry: false });
    if (st && st.size > LOG_MAX_BYTES) fs.truncateSync(LOG_PATH, 0);
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${msg}\n`, 'utf8');
  } catch {
    // Logging must never break the plugin
  }
}

process.on('uncaughtException', (err) => logMsg('uncaughtException: ' + (err && err.stack ? err.stack : err)));
process.on('unhandledRejection', (err) => logMsg('unhandledRejection: ' + err));

function parseArgs(argv) {
  const result = { port: '', pluginUUID: '', registerEvent: '', info: '' };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-port' && i + 1 < argv.length) result.port = argv[++i];
    else if (arg === '-pluginUUID' && i + 1 < argv.length) result.pluginUUID = argv[++i];
    else if (arg === '-registerEvent' && i + 1 < argv.length) result.registerEvent = argv[++i];
    else if (arg === '-info' && i + 1 < argv.length) result.info = argv[++i];
  }
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

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function renderOutlinedText(x, y, text, fontSize, fontWeight, fillColor, strokeWidth, anchor) {
  const esc = escapeXml(text);
  const fill = fillColor || '#FFFFFF';
  const sw = Number(strokeWidth !== undefined ? strokeWidth : 3);
  const anc = anchor || 'middle';
  const common = `x="${x}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" text-anchor="${anc}"`;
  if (sw > 0) {
    return (
      `<text ${common} fill="${fill}" stroke="#000000" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke fill">${esc}</text>` +
      `<text ${common} fill="${fill}">${esc}</text>`
    );
  }
  return `<text ${common} fill="${fill}">${esc}</text>`;
}

function resolvePalette(themeKey, metricKey, val) {
  if (themeKey && themeKey !== 'auto' && THEMES[themeKey]) {
    return THEMES[themeKey];
  }
  const m = METRICS[metricKey];
  if (!m) return THEMES.cyan;
  if (val >= m.crit) return { accent: '#ef4444', glow: '#b91c1c', header: '#991b1b' };
  if (val >= m.warn) return { accent: '#f59e0b', glow: '#d97706', header: '#b45309' };
  return { accent: '#10b981', glow: '#059669', header: '#047857' };
}

function getMetricValue(sensors, key) {
  if (!key || key === 'none' || !METRICS[key]) return null;
  const raw = sensors && sensors[key];
  const val = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  const def = METRICS[key];
  const pct = clamp((val - def.min) / Math.max(0.0001, def.max - def.min), 0, 1);
  return {
    key,
    def,
    val,
    pct,
    text: def.format(val, sensors),
    compact: def.formatCompact(val, sensors),
    label: def.shortLabel,
  };
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function polarArcPath(cx, cy, r, startDeg, endDeg) {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const span = Math.abs(endDeg - startDeg);
  const largeArc = span > 180 ? 1 : 0;
  const sweep = endDeg >= startDeg ? 1 : 0;
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} A ${r} ${r} 0 ${largeArc} ${sweep} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

function buildSparklineSvg(values, def, x, y, w, h, accentColor) {
  const pts = (Array.isArray(values) && values.length > 0) ? values : [0];
  let lo = def ? def.min : 0;
  let hi = def ? def.max : 100;

  // Dynamic auto-range for clocks, power, network, disk throughput so sparklines visibly react
  if (hi > 100 && def) {
    const vmax = Math.max(...pts, 1);
    const vmin = Math.min(...pts);
    lo = Math.max(0, vmin * 0.8);
    hi = Math.max(lo + 5, vmax * 1.15);
  }

  const count = pts.length;
  const padY = 4;
  const innerH = Math.max(4, h - padY * 2);
  const coords = [];

  for (let i = 0; i < count; i++) {
    const ratioX = count === 1 ? 1 : i / (count - 1);
    const px = count === 1 ? x + w : x + ratioX * w;
    const norm = clamp((pts[i] - lo) / Math.max(0.0001, hi - lo), 0, 1);
    const py = y + h - padY - norm * innerH;
    coords.push({ x: Number(px.toFixed(1)), y: Number(py.toFixed(1)) });
  }
  if (coords.length === 1) {
    coords.unshift({ x, y: coords[0].y });
  }

  const linePts = coords.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPts = `${coords[0].x},${y + h} ${linePts} ${coords[coords.length - 1].x},${y + h}`;
  const last = coords[coords.length - 1];

  const guideY1 = (y + h * 0.33).toFixed(1);
  const guideY2 = (y + h * 0.66).toFixed(1);

  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#070a10" stroke="#1e293b" stroke-width="1" />` +
    `<line x1="${x + 2}" y1="${guideY1}" x2="${x + w - 2}" y2="${guideY1}" stroke="#1e293b" stroke-width="0.8" />` +
    `<line x1="${x + 2}" y1="${guideY2}" x2="${x + w - 2}" y2="${guideY2}" stroke="#1e293b" stroke-width="0.8" />` +
    `<polygon points="${areaPts}" fill="${accentColor}" fill-opacity="0.24" />` +
    `<polyline points="${linePts}" fill="none" stroke="${accentColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />` +
    `<circle cx="${last.x}" cy="${last.y}" r="3.2" fill="#FFFFFF" stroke="${accentColor}" stroke-width="1.6" />`
  );
}

function fitFontSize(str, baseSize, maxChars, minSize = 18) {
  const len = String(str || '').length;
  if (len <= maxChars) return baseSize;
  const scaled = Math.floor(baseSize * (maxChars / len));
  return Math.max(minSize, scaled);
}

function renderCardHeader(title, rightBadgeText, palette, sw, height = 22) {
  const cleanTitle = String(title || 'HW MON').trim().slice(0, rightBadgeText ? 11 : 13);
  const textY = height === 21 ? 19 : 20;
  return (
    `<rect x="4" y="4" width="136" height="${height}" rx="6" fill="${palette.header}" fill-opacity="0.92" stroke="${palette.accent}" stroke-width="1" />` +
    (rightBadgeText
      ? renderOutlinedText(10, textY, cleanTitle, 14, '900', '#FFFFFF', Math.min(sw, 2), 'start') +
        renderOutlinedText(134, textY, rightBadgeText, 15, '900', '#fde047', Math.min(sw, 2), 'end')
      : renderOutlinedText(72, textY, cleanTitle, 15, '900', '#FFFFFF', Math.min(sw, 2), 'middle'))
  );
}

function renderCardSvg(sensors, historyMap, actionUUID, rawSettings) {
  const settings = mergeSettings(rawSettings, actionUUID);
  const sw = clamp(Number(settings.textStrokeWidth ?? 3), 0, 4);

  const m1 = getMetricValue(sensors, settings.metric1) || getMetricValue(sensors, 'cpu_usage');
  const m2 = getMetricValue(sensors, settings.metric2);
  const m3 = getMetricValue(sensors, settings.metric3);
  const m4 = getMetricValue(sensors, settings.metric4);

  const palette = resolvePalette(settings.theme, m1.key, m1.val);
  const hist1 = (historyMap && historyMap.get(m1.key)) || [m1.val];

  let body = '';

  if (settings.style === 'multi_graph') {
    body += renderCardHeader(settings.title, '', palette, sw, 22);

    // Live sparkline graph fills the upper-middle area behind the main numeric readouts
    body += buildSparklineSvg(hist1, m1.def, 4, 28, 136, 72, palette.accent);

    if (m2) {
      body += renderOutlinedText(10, 42, m1.label, 13, '800', palette.accent, Math.min(sw, 2), 'start');
      const mainSize = fitFontSize(m1.compact, 38, 4, 26);
      body += renderOutlinedText(10, 78, m1.compact, mainSize, '900', '#FFFFFF', sw, 'start');

      body += renderOutlinedText(134, 42, m2.label, 13, '800', '#cbd5e1', Math.min(sw, 2), 'end');
      const m2Palette = resolvePalette('auto', m2.key, m2.val);
      const m2Color = (m2.key.includes('temp') || m2.key.includes('hotspot')) ? m2Palette.accent : '#fde047';
      const subSize = fitFontSize(m2.compact, 25, 4, 19);
      body += renderOutlinedText(134, 72, m2.compact, subSize, '900', m2Color, sw, 'end');
    } else {
      body += renderOutlinedText(72, 42, m1.label, 14, '800', palette.accent, Math.min(sw, 2), 'middle');
      body += renderOutlinedText(72, 82, m1.compact, fitFontSize(m1.compact, 42, 4, 28), '900', '#FFFFFF', sw, 'middle');
    }

    // Bottom multi-sensor bar (2 large cells when m3 & m4 are set)
    body += `<rect x="4" y="103" width="136" height="37" rx="7" fill="#0b101b" stroke="#222d42" stroke-width="1" />`;
    if (m3 && m4) {
      body += `<line x1="72" y1="106" x2="72" y2="137" stroke="#222d42" stroke-width="1" />`;
      body += renderOutlinedText(38, 117, m3.label, 13, '800', '#94a3b8', Math.min(sw, 2), 'middle');
      body += renderOutlinedText(38, 136, m3.compact, fitFontSize(m3.compact, 20, 4, 18), '900', '#FFFFFF', Math.min(sw, 2), 'middle');
      body += renderOutlinedText(106, 117, m4.label, 13, '800', '#94a3b8', Math.min(sw, 2), 'middle');
      body += renderOutlinedText(106, 136, m4.compact, fitFontSize(m4.compact, 20, 4, 18), '900', '#38bdf8', Math.min(sw, 2), 'middle');
    } else if (m3 || m4) {
      const sub = m3 || m4;
      body += renderOutlinedText(12, 127, sub.label, 14, '800', '#94a3b8', Math.min(sw, 2), 'start');
      body += renderOutlinedText(132, 129, sub.text, fitFontSize(sub.text, 22, 6, 18), '900', '#38bdf8', Math.min(sw, 2), 'end');
    } else {
      body += renderOutlinedText(72, 127, `${m1.label}: ${m1.text}`, 16, '800', '#e2e8f0', Math.min(sw, 2), 'middle');
    }
  } else if (settings.style === 'gauge_multi') {
    const hdrRight = (m2 && m3 && m4) ? m4.compact : '';
    body += renderCardHeader(settings.title, hdrRight, palette, sw, 22);

    const cx = 72;
    const cy = 69;
    const r = 37;
    const startDeg = -125;
    const endDeg = 125;
    const fillEndDeg = startDeg + (endDeg - startDeg) * clamp(m1.pct, 0.02, 1);

    body += `<path d="${polarArcPath(cx, cy, r, startDeg, endDeg)}" fill="none" stroke="#1e293b" stroke-width="9" stroke-linecap="round" />`;
    body += `<path d="${polarArcPath(cx, cy, r, startDeg, fillEndDeg)}" fill="none" stroke="${palette.accent}" stroke-width="9" stroke-linecap="round" />`;

    const centerSize = fitFontSize(m1.compact, 30, 4, 21);
    body += renderOutlinedText(cx, cy + 7, m1.compact, centerSize, '900', '#FFFFFF', sw, 'middle');
    body += renderOutlinedText(cx, cy + 23, m1.label, 13, '800', palette.accent, Math.min(sw, 2), 'middle');

    const subs = [m2, m3].filter(Boolean);
    if (subs.length === 0 && m4) subs.push(m4);
    if (subs.length === 1) {
      const s0 = subs[0];
      body += `<rect x="4" y="98" width="136" height="42" rx="7" fill="#0d131f" stroke="#233047" stroke-width="1" />`;
      body += renderOutlinedText(14, 124, s0.label, 14, '800', '#94a3b8', Math.min(sw, 2), 'start');
      body += renderOutlinedText(130, 126, s0.text, fitFontSize(s0.text, 22, 5, 18), '900', '#FFFFFF', sw, 'end');
    } else if (subs.length >= 2) {
      const wBox = 66;
      subs.slice(0, 2).forEach((sm, idx) => {
        const bx = idx === 0 ? 4 : 74;
        body += `<rect x="${bx}" y="98" width="${wBox}" height="42" rx="7" fill="#0d131f" stroke="#233047" stroke-width="1" />`;
        body += renderOutlinedText(bx + wBox / 2, 113, sm.label, 13, '800', '#94a3b8', Math.min(sw, 2), 'middle');
        body += renderOutlinedText(bx + wBox / 2, 134, sm.compact, fitFontSize(sm.compact, 21, 4, 18), '900', '#FFFFFF', sw, 'middle');
      });
    }
  } else if (settings.style === 'quad_grid') {
    body += renderCardHeader(settings.title, '', palette, sw, 21);
    const slots = [
      m1,
      m2 || m1,
      m3 || m1,
      m4 || m2 || m1,
    ];
    const boxes = [
      { x: 4, y: 27 },
      { x: 73, y: 27 },
      { x: 4, y: 85 },
      { x: 73, y: 85 },
    ];
    slots.forEach((sm, idx) => {
      const b = boxes[idx];
      const slotPal = settings.theme === 'auto' ? resolvePalette('auto', sm.key, sm.val) : palette;
      const barW = Math.max(5, Math.round(57 * sm.pct));
      body += `<rect x="${b.x}" y="${b.y}" width="67" height="56" rx="8" fill="#0c121e" stroke="#222d42" stroke-width="1" />`;
      body += renderOutlinedText(b.x + 33.5, b.y + 16, sm.label, 13, '800', slotPal.accent, Math.min(sw, 2), 'middle');
      const vSize = fitFontSize(sm.compact, 23, 4, 19);
      body += renderOutlinedText(b.x + 33.5, b.y + 42, sm.compact, vSize, '900', '#FFFFFF', sw, 'middle');
      body += `<rect x="${b.x + 5}" y="${b.y + 49}" width="57" height="4" rx="2" fill="#1e293b" />`;
      body += `<rect x="${b.x + 5}" y="${b.y + 49}" width="${barW}" height="4" rx="2" fill="${slotPal.accent}" />`;
    });
  } else if (settings.style === 'bars_triple') {
    const rows = [m1, m2, m3].filter(Boolean);
    if (rows.length < 3 && m4) rows.push(m4);
    const badge4 = ([m1, m2, m3].filter(Boolean).length === 3 && m4) ? m4.compact : '';
    body += renderCardHeader(settings.title, badge4, palette, sw, 21);

    const rowH = 36;
    const gap = 2;
    const startY = 27;

    rows.slice(0, 3).forEach((sm, idx) => {
      const ry = startY + idx * (rowH + gap);
      const rowPal = settings.theme === 'auto' ? resolvePalette('auto', sm.key, sm.val) : palette;
      const fillW = Math.max(6, Math.round(124 * sm.pct));
      body += `<rect x="4" y="${ry}" width="136" height="${rowH}" rx="7" fill="#0c121e" stroke="#1f293d" stroke-width="1" />`;
      body += renderOutlinedText(10, ry + 20, sm.label, 15, '900', rowPal.accent, Math.min(sw, 2), 'start');
      body += renderOutlinedText(134, ry + 21, sm.text, fitFontSize(sm.text, 22, 6, 18), '900', '#FFFFFF', sw, 'end');
      body += `<rect x="10" y="${ry + 27}" width="124" height="5.5" rx="2.5" fill="#1e293b" />`;
      body += `<rect x="10" y="${ry + 27}" width="${fillW}" height="5.5" rx="2.5" fill="${rowPal.accent}" />`;
    });
  } else {
    // 'big_clean' - Giant readout + tall live sparkline + clear bottom metric
    const badge = m2 ? m2.compact : '';
    body += renderCardHeader(settings.title, badge, palette, sw, 22);
    body += buildSparklineSvg(hist1, m1.def, 4, 28, 136, 112, palette.accent);
    body += renderOutlinedText(72, 46, m1.label, 14, '900', palette.accent, Math.min(sw, 2), 'middle');
    const bigSize = fitFontSize(m1.compact, 46, 4, 30);
    body += renderOutlinedText(72, 92, m1.compact, bigSize, '900', '#FFFFFF', sw, 'middle');
    const sub = m3 || m2 || m4;
    const subText = sub ? `${sub.label} ${sub.compact}` : m1.text;
    body += renderOutlinedText(72, 129, subText, fitFontSize(subText, 22, 9, 18), '900', '#fde047', sw, 'middle');
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<defs>` +
    `<linearGradient id="cardBg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#141b29" />` +
    `<stop offset="100%" stop-color="#090c12" />` +
    `</linearGradient>` +
    `</defs>` +
    `<rect width="144" height="144" fill="#06080d" />` +
    `<rect x="3" y="3" width="138" height="138" rx="14" fill="url(#cardBg)" stroke="${palette.accent}" stroke-width="1.6" />` +
    body +
    `</svg>`
  );
}

function svgToDataUri(svg) {
  return 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
}

class SensorWorker {
  constructor(onData) {
    this.onData = onData;
    this.child = null;
    this.buffer = '';
    this.closing = false;
  }

  start() {
    if (this.child) return;
    this.closing = false;
    this.buffer = '';

    const psArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SENSORS_SCRIPT];
    this.child = spawn('powershell.exe', psArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (this.onData) this.onData(parsed);
        } catch (e) {
          logMsg('Sensor JSON parse error: ' + e.message);
        }
      }
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      const s = chunk.trim();
      if (s) logMsg('sensors.ps1 stderr: ' + s);
    });

    this.child.on('exit', (code) => {
      logMsg('sensors.ps1 exited code=' + code);
      this.child = null;
      if (!this.closing) {
        setTimeout(() => this.start(), 2000);
      }
    });
  }

  poll() {
    if (!this.child) this.start();
    if (this.child && this.child.stdin && !this.child.stdin.destroyed) {
      try {
        this.child.stdin.write('POLL\n');
      } catch (e) {
        logMsg('sensors.ps1 write error: ' + e.message);
      }
    }
  }

  stop() {
    this.closing = true;
    if (this.child) {
      try {
        if (this.child.stdin && !this.child.stdin.destroyed) this.child.stdin.write('QUIT\n');
      } catch {}
      try {
        this.child.kill();
      } catch {}
      this.child = null;
    }
  }
}

function selftest() {
  assert.strictEqual(escapeXml('A & B <C> "D"'), 'A &amp; B &lt;C&gt; &quot;D&quot;');
  assert.strictEqual(clamp(150, 0, 100), 100);
  assert.strictEqual(clamp(-5, 0, 100), 0);

  const arc = polarArcPath(72, 66, 32, -125, 125);
  assert.ok(arc.startsWith('M ') && arc.includes(' A 32 32 0 1 1 '));

  const mockSensors = {
    ok: true,
    cpu_usage: 42.3,
    cpu_util: 50.1,
    cpu_temp: 71.2,
    cpu_power: 84.5,
    cpu_clock: 5210,
    cpu_volt: 1.26,
    gpu_usage: 88,
    gpu_temp: 59,
    gpu_hotspot: 77,
    gpu_mem_temp: 66,
    gpu_power: 310,
    gpu_clock: 3050,
    gpu_mem_clock: 2505,
    gpu_mem_ctrl: 25,
    gpu_fan_rpm: 1580,
    gpu_fan_pct: 39,
    gpu_volt: 1.06,
    vram_used_gb: 8.4,
    vram_pct: 52.5,
    ram_pct: 37,
    ram_used_gb: 23.1,
    ram_free_gb: 38.6,
    ddr_temp: 46.2,
    ddr_temp1: 46.2,
    ddr_temp2: 45.5,
    ddr_power: 1.25,
    ddr_mts: 4791,
    vrm_temp: 43,
    mb_temp: 36,
    chipset_temp: 55.6,
    disk_pct: 1.5,
    disk_read_mb: 12.4,
    disk_write_mb: 4.2,
    ssd_c_temp: 49,
    ssd_f_temp: 36,
    c_free_gb: 5.1,
    net_dl_kbs: 2450,
    net_ul_kbs: 310,
    net_total_mbps: 22.1,
  };

  const hist = new Map();
  Object.keys(METRICS).forEach((k) => {
    hist.set(k, [mockSensors[k] * 0.6, mockSensors[k] * 0.85, mockSensors[k]]);
  });

  STYLE_ORDER.forEach((style) => {
    const svg = renderCardSvg(mockSensors, hist, 'com.antigravity.hwmonitor.cpu', { style });
    assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'), `Style ${style} invalid SVG`);
    assert.ok(svg.includes('CPU 9800X3D'), `Style ${style} missing title`);
    assert.ok(svg.includes('paint-order="stroke fill"'), `Style ${style} missing outlined text`);
    const sizes = [...svg.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    assert.ok(sizes.length > 0 && Math.min(...sizes) >= 13, `Style ${style} has tiny font size: ${sizes.join(',')}`);
  });

  const dataUri = svgToDataUri(renderCardSvg(mockSensors, hist, 'com.antigravity.hwmonitor.ram', {}));
  assert.ok(dataUri.startsWith('data:image/svg+xml;charset=utf8,%3Csvg%20'));
  assert.ok(decodeURIComponent(dataUri).includes('46.2°C'));

  console.log('selftest ok');
}

function oneshot() {
  const hist = new Map();
  const worker = new SensorWorker((sensors) => {
    worker.stop();
    Object.keys(METRICS).forEach((k) => {
      const v = typeof sensors[k] === 'number' ? sensors[k] : 0;
      hist.set(k, [v * 0.8, v * 0.9, v]);
    });
    const samples = {};
    STYLE_ORDER.forEach((style) => {
      const svg = renderCardSvg(sensors, hist, 'com.antigravity.hwmonitor.cpu', { style });
      samples[style] = { len: svg.length, prefix: svgToDataUri(svg).slice(0, 64) };
    });
    console.log(JSON.stringify({ sensors, samples }));
    process.exit(0);
  });
  worker.start();
  setTimeout(() => {
    worker.stop();
    console.error('oneshot timeout');
    process.exit(1);
  }, 15000);
}

function runPlugin() {
  const args = parseArgs(process.argv);
  if (!args.port || !args.pluginUUID || !args.registerEvent) {
    console.error('Missing required Stream Deck launch arguments (-port, -pluginUUID, -registerEvent).');
    process.exit(1);
  }

  let ws = null;
  let lastSensors = { ok: false };
  const historyMap = new Map();
  const contexts = new Map();

  function recordHistory(sensors) {
    if (!sensors || !sensors.ok) return;
    Object.keys(METRICS).forEach((k) => {
      const v = typeof sensors[k] === 'number' && Number.isFinite(sensors[k]) ? sensors[k] : 0;
      let arr = historyMap.get(k);
      if (!arr) {
        arr = [];
        historyMap.set(k, arr);
      }
      arr.push(v);
      if (arr.length > HISTORY_LEN) arr.shift();
    });
  }

  function sendJson(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function renderContext(context) {
    const info = contexts.get(context);
    if (!info) return;
    const svg = renderCardSvg(lastSensors, historyMap, info.action, info.settings);
    sendJson({
      event: 'setImage',
      context,
      payload: {
        image: svgToDataUri(svg),
        target: 0,
      },
    });
  }

  function renderAllContexts() {
    for (const ctx of contexts.keys()) {
      renderContext(ctx);
    }
  }

  const worker = new SensorWorker((sensors) => {
    lastSensors = sensors;
    recordHistory(sensors);
    renderAllContexts();
  });

  ws = new WebSocket(`ws://127.0.0.1:${args.port}`);

  ws.on('open', () => {
    logMsg(`Connected to ws://127.0.0.1:${args.port} uuid=${args.pluginUUID}`);
    sendJson({ event: args.registerEvent, uuid: args.pluginUUID });
    worker.start();
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }

    const ev = msg.event;
    const context = msg.context;
    const action = msg.action || '';
    const payload = msg.payload || {};

    if (ev === 'willAppear' && context) {
      contexts.set(context, {
        action,
        settings: mergeSettings(payload.settings, action),
      });
      renderContext(context);
    } else if (ev === 'willDisappear' && context) {
      contexts.delete(context);
    } else if (ev === 'didReceiveSettings' && context) {
      const prev = contexts.get(context) || { action };
      contexts.set(context, {
        action: action || prev.action,
        settings: mergeSettings(payload.settings, action || prev.action),
      });
      renderContext(context);
    } else if (ev === 'sendToPlugin' && context) {
      const prev = contexts.get(context) || { action };
      if (payload && payload.settings) {
        contexts.set(context, {
          action: action || prev.action,
          settings: mergeSettings(payload.settings, action || prev.action),
        });
        renderContext(context);
      }
    } else if (ev === 'keyDown' && context) {
      const info = contexts.get(context);
      if (!info) return;
      const s = mergeSettings(info.settings, info.action);
      if (s.clickAction === 'cycle') {
        const idx = STYLE_ORDER.indexOf(s.style);
        const nextStyle = STYLE_ORDER[(idx + 1) % STYLE_ORDER.length];
        s.style = nextStyle;
        info.settings = s;
        contexts.set(context, info);
        sendJson({ event: 'setSettings', context, payload: s });
        sendJson({ event: 'sendToPropertyInspector', context, action: info.action, payload: { settings: s } });
        renderContext(context);
      } else if (s.clickAction === 'taskmgr') {
        try {
          spawn('cmd.exe', ['/c', 'start', 'taskmgr.exe'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
        } catch (e) {
          logMsg('taskmgr launch error: ' + e.message);
        }
      }
    }
  });

  const pollTimer = setInterval(() => {
    if (contexts.size > 0) {
      worker.poll();
    }
  }, POLL_MS);

  ws.on('close', () => {
    clearInterval(pollTimer);
    worker.stop();
    process.exit(0);
  });

  ws.on('error', (err) => {
    logMsg('WebSocket error: ' + (err && err.message ? err.message : err));
  });
}

if (process.argv.includes('--selftest')) {
  selftest();
} else if (process.argv.includes('--oneshot')) {
  oneshot();
} else {
  runPlugin();
}
