import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import {
  getAppEndpoint,
  getSonarEndpointCached,
  getAudioMode,
  setAudioMode,
  getAudioDataClassic,
  getAudioDataStream,
  setChannelVolumeClassic,
  setChannelVolumeStreamer,
  setChannelMuteClassic,
  setChannelMuteStreamer,
  getChatMixState,
  setChatMixBalance,
  getAudioDevices,
  setAudioDevice,
  AudioMode,
  AudioChannel,
  StreamerPath,
  DeviceFlow,
  DeviceChannel
} from "steelseries-sonar-sdk";

const UUID = "com.loading.sonar-control";
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(process.env.APPDATA || os.homedir(), "LoadingSonarControl");
const CONFIG = path.join(DATA, "config.json");
const LOG = path.join(DATA, "plugin.log");
const OSD_FILE = path.join(DATA, "osd.json");

fs.mkdirSync(DATA, { recursive: true });

const log = (x) => {
  try {
    fs.appendFileSync(LOG, new Date().toISOString() + " " + String(x) + "\r\n");
  } catch {}
};

process.on("uncaughtException", (e) => log("Uncaught: " + (e?.stack || e)));
process.on("unhandledRejection", (e) => log("Unhandled: " + (e?.stack || e)));

const loadConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return { scenes: {} };
  }
};
const saveConfig = (v) => {
  const t = CONFIG + ".tmp";
  fs.writeFileSync(t, JSON.stringify(v, null, 2));
  fs.renameSync(t, CONFIG);
};

let config = loadConfig();
let endpoint = "";
let status = { connected: false, error: "", mode: "", last: 0 };
let osdProcess = null;
const knobRotations = new Map();

const channelNames = {
  master: "MASTER",
  game: "GAME",
  chat: "CHAT",
  media: "MEDIA",
  aux: "AUX",
  mic: "MICROPHONE"
};

function escapeXml(unsafe) {
  return String(unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderDeviceSvg({
  iconType = "headphones",
  label = "",
  showLabel = "icon",
  active = true,
  accentColor = ""
}) {
  const isHeadphones = iconType === "headphones";
  const isSpeakers = iconType === "speakers";
  const isSoundwaves = iconType === "soundwaves";
  const isDisplay = iconType === "display";

  // Neon accents: Cyan for headphones, Neon Yellow/Lime for speakers, Green for waves, Sky for display
  const accent =
    accentColor ||
    (isHeadphones
      ? "#00e5ff"
      : isSpeakers
      ? "#e2fd36"
      : isSoundwaves
      ? "#00ff88"
      : isDisplay
      ? "#38bdf8"
      : "#e2fd36");

  const white = "#ffffff";
  let iconSvg = "";

  if (isHeadphones) {
    // Normal over-ear headphones: clean curved headband arch + symmetrical earcups
    iconSvg = `
      <path d="M 40 68 A 32 32 0 0 1 104 68" fill="none" stroke="${white}" stroke-width="7" stroke-linecap="round"/>
      <rect x="29" y="61" width="19" height="34" rx="9.5" fill="${white}"/>
      <rect x="39" y="66" width="5" height="24" rx="2.5" fill="${accent}"/>
      <rect x="96" y="61" width="19" height="34" rx="9.5" fill="${white}"/>
      <rect x="100" y="66" width="5" height="24" rx="2.5" fill="${accent}"/>
    `;
  } else if (isSpeakers) {
    // Normal desktop stereo speakers: clean dual cabinets with tweeters and woofers
    iconSvg = `
      <!-- Left Speaker -->
      <rect x="28" y="44" width="38" height="56" rx="6" fill="#121620" stroke="${white}" stroke-width="3"/>
      <circle cx="47" cy="56" r="5" fill="${accent}"/>
      <circle cx="47" cy="78" r="11" stroke="${white}" stroke-width="2.5" fill="#090c12"/>
      <circle cx="47" cy="78" r="4" fill="${accent}"/>

      <!-- Right Speaker -->
      <rect x="78" y="44" width="38" height="56" rx="6" fill="#121620" stroke="${white}" stroke-width="3"/>
      <circle cx="97" cy="56" r="5" fill="${accent}"/>
      <circle cx="97" cy="78" r="11" stroke="${white}" stroke-width="2.5" fill="#090c12"/>
      <circle cx="97" cy="78" r="4" fill="${accent}"/>
    `;
  } else if (isSoundwaves) {
    // Normal audio speaker horn with sound waves
    iconSvg = `
      <path d="M 36 58 L 52 58 L 74 42 L 74 102 L 52 86 L 36 86 Z" fill="${white}"/>
      <path d="M 85 58 A 18 18 0 0 1 85 86" fill="none" stroke="${accent}" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M 97 48 A 32 32 0 0 1 97 96" fill="none" stroke="${accent}" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M 109 38 A 46 46 0 0 1 109 106" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" opacity="0.35"/>
    `;
  } else if (isDisplay) {
    // Normal flat display / monitor
    iconSvg = `
      <rect x="26" y="42" width="92" height="56" rx="6" fill="#121620" stroke="${white}" stroke-width="3.5"/>
      <path d="M 65 98 L 63 108 L 81 108 L 79 98 Z" fill="${white}"/>
      <rect x="52" y="108" width="40" height="4" rx="2" fill="${accent}"/>
    `;
  } else {
    // Normal audio interface / DAC
    iconSvg = `
      <rect x="26" y="46" width="92" height="52" rx="7" fill="#121620" stroke="${white}" stroke-width="3"/>
      <circle cx="50" cy="72" r="12" stroke="${accent}" stroke-width="3" fill="#090c12"/>
      <circle cx="50" cy="72" r="3.5" fill="${accent}"/>
      <line x1="78" y1="62" x2="104" y2="62" stroke="${white}" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="78" y1="74" x2="98" y2="74" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>
      <line x1="78" y1="84" x2="92" y2="84" stroke="${white}" stroke-width="2.5" stroke-linecap="round"/>
    `;
  }

  const cleanLabel = String(label || "").trim().toUpperCase().slice(0, 12);
  const topText = showLabel === "icon" && cleanLabel ? cleanLabel : "AUDIO OUT";

  const bottomSection =
    showLabel === "both" && cleanLabel
      ? `
      <line x1="20" y1="116" x2="124" y2="116" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/>
      <text x="72" y="134" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="800" font-size="12" fill="#ffffff" text-anchor="middle" letter-spacing="0.8">${escapeXml(cleanLabel)}</text>
    `
      : `
      <!-- Accent bar with active glowing center indicator -->
      <line x1="20" y1="120" x2="124" y2="120" stroke="#1f2533" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="72" cy="120" r="4.5" fill="${accent}"/>
      <circle cx="72" cy="120" r="7.5" stroke="${accent}" stroke-width="1.5" opacity="0.4" fill="none"/>
    `;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">
    <rect width="144" height="144" fill="#000000"/>
    
    <!-- Top HUD Pill -->
    <rect x="18" y="10" width="108" height="22" rx="11" fill="#0d1117" stroke="${accent}" stroke-width="1.8"/>
    <text x="72" y="25" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="800" font-size="11" fill="${accent}" text-anchor="middle" letter-spacing="1">${escapeXml(topText)}</text>

    <!-- Center Normal Icon -->
    ${iconSvg}

    <!-- Bottom Section -->
    ${bottomSection}
  </svg>`;
}

function getChannelIconSvg(ch, color) {
  if (ch === "master") {
    return `
      <g stroke="${color}" stroke-width="1.8" stroke-linecap="round">
        <line x1="4" y1="2" x2="4" y2="16"/>
        <line x1="2" y1="7" x2="6" y2="7" stroke-width="2.2"/>
        <line x1="9" y1="2" x2="9" y2="16"/>
        <line x1="7" y1="12" x2="11" y2="12" stroke-width="2.2"/>
        <line x1="14" y1="2" x2="14" y2="16"/>
        <line x1="12" y1="5" x2="16" y2="5" stroke-width="2.2"/>
      </g>
    `;
  }
  if (ch === "game") {
    return `
      <g fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M 3 8 C 3 5, 15 5, 15 8 C 16 11, 16 14, 14 15 C 13 15.5, 11 13.5, 10 12 L 8 12 C 7 13.5, 5 15.5, 4 15 C 2 14, 2 11, 3 8 Z"/>
        <line x1="5.5" y1="8.5" x2="7.5" y2="8.5" stroke-width="1.4"/>
        <line x1="6.5" y1="7.5" x2="6.5" y2="9.5" stroke-width="1.4"/>
        <circle cx="11.5" cy="8.5" r="0.7" fill="${color}"/>
        <circle cx="12.5" cy="9.5" r="0.7" fill="${color}"/>
      </g>
    `;
  }
  if (ch === "chat") {
    return `
      <g fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M 2.5 4 C 2.5 2.5, 15.5 2.5, 15.5 4 L 15.5 10 C 15.5 11.5, 2.5 11.5, 2.5 10 L 2.5 14 L 6 11.5 Z"/>
        <line x1="6.5" y1="6" x2="6.5" y2="8" stroke-width="1.4"/>
        <line x1="9" y1="4.5" x2="9" y2="9.5" stroke-width="1.4"/>
        <line x1="11.5" y1="6" x2="11.5" y2="8" stroke-width="1.4"/>
      </g>
    `;
  }
  if (ch === "media") {
    return `
      <g fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2.5" y="3.5" width="13" height="10" rx="2.5"/>
        <polygon points="7.5,6 11.5,8.5 7.5,11" fill="${color}" stroke="none"/>
      </g>
    `;
  }
  if (ch === "aux") {
    return `
      <g fill="${color}">
        <polygon points="9,3.5 12.5,9.5 5.5,9.5"/>
        <rect x="4.5" y="11" width="4" height="4" rx="0.5"/>
        <circle cx="12" cy="13" r="2.2"/>
      </g>
    `;
  }
  if (ch === "mic") {
    return `
      <g fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="6.5" y="2.5" width="5" height="8" rx="2.5" fill="${color}"/>
        <path d="M 4 7 C 4 11.5, 14 11.5, 14 7"/>
        <line x1="9" y1="12" x2="9" y2="15"/>
        <line x1="6" y1="15" x2="12" y2="15"/>
      </g>
    `;
  }
  return "";
}

function renderVolumeSvg({
  channel = "game",
  volume = 50,
  isMuted = false,
  style = "hud",
  hudTheme = "channel",
  cycleChannels = ["master", "game", "chat", "media"]
}) {
  const chNames = {
    master: "MASTER",
    game: "GAME",
    chat: "CHAT",
    media: "MEDIA",
    aux: "AUX",
    mic: "MIC"
  };

  const chColors = {
    master: "#4d69ff",
    game: "#00e699",
    chat: "#00d4ff",
    media: "#ff2d6d",
    aux: "#a855f7",
    mic: "#ff9900"
  };

  const ch = String(channel || "game").toLowerCase();
  const rawList = Array.isArray(cycleChannels)
    ? cycleChannels
    : typeof cycleChannels === "string" && cycleChannels
    ? cycleChannels.split(",")
    : ["master", "game", "chat", "media"];
  const cleanCycle = rawList.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  const activeCycle = cleanCycle.length > 0 ? cleanCycle : ["master", "game", "chat", "media"];

  let chIdx = activeCycle.indexOf(ch);
  if (chIdx === -1) chIdx = 0;
  const chName = chNames[ch] || ch.toUpperCase();
  const vol = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));

  // Accent determination
  let accent = chColors[ch] || "#00e699";
  if (hudTheme === "yellow") accent = "#e2fd36";
  else if (hudTheme === "cyan") accent = "#00e5ff";
  else if (hudTheme === "green") accent = "#00ff88";
  else if (hudTheme === "amber") accent = "#ffb700";

  const effectiveAccent = isMuted ? "#ff3355" : accent;

  if (style === "minimal") {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">
      <rect width="144" height="144" fill="#000000"/>
      <text x="72" y="48" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="800" font-size="16" fill="${effectiveAccent}" text-anchor="middle" letter-spacing="1.5">${escapeXml(chName)}</text>
      <text x="72" y="98" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="900" font-size="${isMuted ? '26' : '38'}" fill="${isMuted ? '#ff3355' : '#ffffff'}" text-anchor="middle">${isMuted ? 'MUTED' : vol + '%'}</text>
    </svg>`;
  }

  if (style === "transparent") {
    const fillWidth = Math.round((vol / 100) * 108);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">
      <text x="72" y="48" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="800" font-size="16" fill="${effectiveAccent}" text-anchor="middle" letter-spacing="1.5">${escapeXml(chName)}</text>
      <text x="72" y="98" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="900" font-size="${isMuted ? '26' : '38'}" fill="${isMuted ? '#ff3355' : '#ffffff'}" text-anchor="middle">${isMuted ? 'MUTED' : vol + '%'}</text>
      <rect x="18" y="116" width="108" height="6" rx="3" fill="#252d3a"/>
      ${fillWidth > 0 ? `<rect x="18" y="116" width="${fillWidth}" height="6" rx="3" fill="${effectiveAccent}"/>` : ""}
    </svg>`;
  }

  // 1. Top row: Centered active channel badge with icon and label
  const topBadge = `
    <rect x="20" y="6" width="104" height="22" rx="11" fill="#0d1117" stroke="${effectiveAccent}" stroke-width="1.6"/>
    <g transform="translate(37, 8) scale(0.9)">
      ${getChannelIconSvg(ch, effectiveAccent)}
    </g>
    <text x="80" y="21.5" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="800" font-size="11.5" fill="${effectiveAccent}" text-anchor="middle" letter-spacing="1">${escapeXml(chName)}</text>
  `;

  // 2. Center: Big, bold volume number or MUTED (spacious, high contrast)
  const valueDisplay = isMuted
    ? `<text x="72" y="55" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="900" font-size="26" fill="#ff3355" text-anchor="middle" letter-spacing="1.5">MUTED</text>`
    : `<text x="72" y="57" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="900" font-size="33" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">${vol}<tspan font-size="18" font-weight="700" fill="${effectiveAccent}">%</tspan></text>`;

  // 3. Horizontal accent / volume line
  const fillX = 14 + Math.round((vol / 100) * 116);
  const accentLine = `
    <line x1="14" y1="68" x2="130" y2="68" stroke="#19202c" stroke-width="2.6" stroke-linecap="round"/>
    ${!isMuted && vol > 0 ? `<line x1="14" y1="68" x2="${fillX}" y2="68" stroke="${effectiveAccent}" stroke-width="2.6" stroke-linecap="round"/>` : ""}
    ${isMuted ? `<line x1="14" y1="68" x2="130" y2="68" stroke="#ff3355" stroke-width="2" stroke-linecap="round" opacity="0.6"/>` : ""}
  `;

  // 4. Bottom row: Dynamic Channel Icons dock
  const count = activeCycle.length;
  const boxW = count <= 3 ? 30 : count === 4 ? 26 : 22;
  const boxH = boxW;
  const spacing = count <= 3 ? 10 : count === 4 ? 6 : 4;
  const totalW = count * boxW + (count - 1) * spacing;
  const startX = Math.round((144 - totalW) / 2);
  const boxY = 76;
  const scale = boxW < 24 ? (boxW - 4) / 18 : 1;
  const pad = Math.round((boxW - 18 * scale) / 2);

  const iconDocks = activeCycle
    .map((c, idx) => {
      const x = startX + idx * (boxW + spacing);
      const isActive = idx === chIdx;
      const cColor = chColors[c] || "#ffffff";
      const iconColor = isActive ? (isMuted ? "#ff3355" : cColor) : "#3e4a5d";

      const bg = isActive
        ? `
        <rect x="${x}" y="${boxY}" width="${boxW}" height="${boxH}" rx="6" fill="#141a24" stroke="${isMuted ? '#ff3355' : cColor}" stroke-width="1.8"/>
        <line x1="${x + 3}" y1="${boxY + boxH + 3}" x2="${x + boxW - 3}" y2="${boxY + boxH + 3}" stroke="${isMuted ? '#ff3355' : cColor}" stroke-width="2" stroke-linecap="round"/>
      `
        : `
        <rect x="${x}" y="${boxY}" width="${boxW}" height="${boxH}" rx="6" fill="#080b10" stroke="#1d2533" stroke-width="1"/>
      `;

      return `
        ${bg}
        <g transform="translate(${x + pad}, ${boxY + pad}) scale(${scale})">
          ${getChannelIconSvg(c, iconColor)}
        </g>
      `;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 110" width="144" height="110">
    <rect width="144" height="110" fill="#000000"/>
    ${topBadge}
    ${valueDisplay}
    ${accentLine}
    ${iconDocks}
  </svg>`;
}

function svgToDataUri(svg) {
  return "data:image/svg+xml;charset=utf8," + encodeURIComponent(svg);
}

function startOSD() {
  try {
    if (osdProcess && osdProcess.exitCode == null && !osdProcess.killed) return;
    const ps = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    const out = fs.openSync(path.join(DATA, "osd.log"), "a");
    const child = spawn(
      ps,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-STA",
        "-WindowStyle",
        "Hidden",
        "-File",
        path.join(PLUGIN_DIR, "osd.ps1"),
        OSD_FILE,
        String(process.pid)
      ],
      { windowsHide: true, detached: false, stdio: ["ignore", out, out] }
    );
    osdProcess = child;
    child.on("error", (e) => log("OSD process error: " + e.message));
    child.on("exit", (code) => {
      log("OSD exited code=" + code);
      if (osdProcess === child) osdProcess = null;
    });
  } catch (e) {
    log("OSD start error: " + e.message);
  }
}

function showOSD(label, value, muted = false, subtitle = "", kind = "volume", settings = null) {
  // OSD popup is OFF by default; only show if explicitly set to "on"
  const isEnabled = settings ? settings.showOsd === "on" : config.osd === true;
  if (!isEnabled) return;

  try {
    const payload = {
      id: Date.now(),
      label: String(label),
      value: Math.max(0, Math.min(100, Number(value) || 0)),
      muted: !!muted,
      subtitle: String(subtitle || ""),
      kind: String(kind || "volume"),
      duration: 2000
    };
    const temp = OSD_FILE + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(payload), "utf8");
    fs.renameSync(temp, OSD_FILE);
    startOSD();
  } catch (e) {
    log("OSD write error: " + e.message);
  }
}

function parseCliArgs() {
  const argv = process.argv.slice(2);
  let port = "";
  let pluginUUID = UUID;
  let registerEvent = "registerPlugin";
  let info = "";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "-port" || a === "--port") && i + 1 < argv.length) port = argv[++i];
    else if ((a === "-pluginUUID" || a === "--pluginUUID" || a === "-uuid") && i + 1 < argv.length)
      pluginUUID = argv[++i];
    else if ((a === "-registerEvent" || a === "--registerEvent") && i + 1 < argv.length)
      registerEvent = argv[++i];
    else if ((a === "-info" || a === "--info") && i + 1 < argv.length) info = argv[++i];
  }
  if (!port) {
    const num = argv.find((x) => /^\d+$/.test(x));
    if (num) port = num;
  }
  return { port, pluginUUID, registerEvent, info };
}

let sd = null;
const contexts = new Map();

const send = (obj) => {
  if (sd && sd.readyState === WebSocket.OPEN) {
    sd.send(JSON.stringify(obj));
  }
};
const title = (c, t) => send({ event: "setTitle", context: c, payload: { target: 0, title: String(t) } });
const setImage = (c, img) => send({ event: "setImage", context: c, payload: { target: 0, image: img } });
const state = (c, s) => send({ event: "setState", context: c, payload: { state: s } });
const feedback = (c, payload) => send({ event: "setFeedback", context: c, payload });
const alert = (c) => send({ event: "showAlert", context: c });

const actionKey = (a) => String(a || "").split(".").pop();
const chan = (x) =>
  ({
    master: AudioChannel.Master,
    game: AudioChannel.Game,
    chat: AudioChannel.Chat,
    media: AudioChannel.Media,
    aux: AudioChannel.Aux,
    mic: AudioChannel.Mic
  }[x] || AudioChannel.Game);

const streamPath = (x) =>
  x === "streaming" ? StreamerPath.Streaming : StreamerPath.Monitoring;

async function getStreamRedirections(ep) {
  const r = await fetch(`${ep}/streamRedirections/`);
  const t = await r.text();
  if (!r.ok) throw Error(`Cannot read Sonar device routes (${r.status}): ${t}`);
  const d = JSON.parse(t);
  return Array.isArray(d) ? d : [];
}

async function setMixerHardwareDevice(ep, flow, deviceId) {
  const route = flow === "input" ? "mic" : "monitoring";
  const encoded = encodeURIComponent(String(deviceId));
  const r = await fetch(`${ep}/streamRedirections/${route}/deviceId/${encoded}`, {
    method: "PUT"
  });
  const t = await r.text();
  if (!r.ok) throw Error(`Sonar ${route} device failed (${r.status}): ${t}`);
  const routes = await getStreamRedirections(ep);
  const active = routes.find((x) => x && x.streamRedirectionId === route);
  if (!active || String(active.deviceId) !== String(deviceId))
    throw Error(`Sonar did not apply the selected ${flow} device`);
  return active;
}

async function getActiveOutputDevice(ep, channel = "render") {
  const mode = await getAudioMode(ep);
  if (mode === AudioMode.Streamer) {
    const routes = await getStreamRedirections(ep);
    const active = routes.find((x) => x && x.streamRedirectionId === "monitoring");
    return active ? active.deviceId : "";
  } else {
    const r = await fetch(`${ep}/classicRedirections/`);
    if (!r.ok) return "";
    const list = await r.json();
    const ch = channel === "render" ? "game" : channel;
    const item = list.find((x) => x.id === ch) || list.find((x) => x.id === "game") || list[0];
    return item ? item.deviceId : "";
  }
}

async function setOutputDevice(ep, deviceId, channel = "render") {
  const mode = await getAudioMode(ep);
  if (mode === AudioMode.Streamer) {
    return await setMixerHardwareDevice(ep, "output", deviceId);
  } else {
    const encoded = encodeURIComponent(String(deviceId));
    const ch = channel === "render" ? "render" : channel;
    const r = await fetch(`${ep}/classicRedirections/${ch}/deviceId/${encoded}`, {
      method: "PUT"
    });
    if (!r.ok) {
      const t = await r.text();
      throw Error(`Failed to switch device (${r.status}): ${t}`);
    }
    return true;
  }
}

async function sonar(force = false) {
  if (endpoint && !force) return endpoint;
  const app = await getAppEndpoint();
  endpoint = await getSonarEndpointCached(app, 8);
  status = {
    connected: true,
    error: "",
    mode: await getAudioMode(endpoint),
    last: Date.now()
  };
  return endpoint;
}

async function withSonar(fn) {
  try {
    return await fn(await sonar());
  } catch (e) {
    endpoint = "";
    status.connected = false;
    status.error = String(e?.message || e);
    log("Sonar retry due to: " + (e?.message || e));
    return fn(await sonar(true));
  }
}

async function snapshot() {
  return withSonar(async (ep) => {
    const mode = await getAudioMode(ep);
    const audio =
      mode === AudioMode.Streamer
        ? await getAudioDataStream(ep)
        : await getAudioDataClassic(ep);
    status = { connected: true, error: "", mode, last: Date.now() };
    return { mode, audio };
  });
}

function currentData(s, settings) {
  const c = settings.channel || "game";
  return s.mode === AudioMode.Streamer
    ? s.audio?.[c]?.[settings.path || "monitoring"]
    : s.audio?.[c];
}

async function setVolume(settings, value) {
  return withSonar(async (ep) => {
    const mode = await getAudioMode(ep);
    const v = Math.max(0, Math.min(100, Math.round(Number(value))));
    const result =
      mode === AudioMode.Streamer
        ? await setChannelVolumeStreamer(
            ep,
            v,
            chan(settings.channel),
            streamPath(settings.path)
          )
        : await setChannelVolumeClassic(ep, v, chan(settings.channel));
    showOSD(
      channelNames[settings.channel || "game"],
      result.volume,
      result.isMuted,
      mode === AudioMode.Streamer
        ? settings.path === "streaming"
          ? "STREAM / AUDIENCE"
          : "PERSONAL / MONITORING"
        : "",
      "volume",
      settings
    );
    return result;
  });
}

async function setMute(settings, value) {
  return withSonar(async (ep) => {
    const mode = await getAudioMode(ep);
    const result =
      mode === AudioMode.Streamer
        ? await setChannelMuteStreamer(
            ep,
            value,
            chan(settings.channel),
            streamPath(settings.path)
          )
        : await setChannelMuteClassic(ep, value, chan(settings.channel));
    showOSD(
      channelNames[settings.channel || "game"],
      result.volume,
      result.isMuted,
      mode === AudioMode.Streamer
        ? settings.path === "streaming"
          ? "STREAM / AUDIENCE"
          : "PERSONAL / MONITORING"
        : "",
      "volume",
      settings
    );
    return result;
  });
}

async function refreshContext(c) {
  const r = contexts.get(c);
  if (!r) return;
  const k = actionKey(r.action);
  const s = r.settings || {};

  try {
    if (k === "status") {
      await sonar();
      const modeStr = String(status.mode || "").toUpperCase();
      title(c, `SONAR\n${modeStr}`);
      feedback(c, { title: "SONAR", value: modeStr });
      state(c, 1);
      return;
    }

    if (k === "volume" || k === "setvolume") {
      const snap = await snapshot();
      const d = currentData(snap, s) || { volume: 0, isMuted: false };
      const chName = (s.channel || "game").toUpperCase();
      const valStr = d.isMuted ? "MUTED" : Math.round(d.volume) + "%";

      const displayStyle = s.displayStyle || "hud";

      if (displayStyle === "classic") {
        title(c, `${chName}\n${valStr}`);
      } else {
        const svg = renderVolumeSvg({
          channel: s.channel || "game",
          volume: d.volume,
          isMuted: d.isMuted,
          style: displayStyle,
          hudTheme: s.hudTheme || "channel",
          cycleChannels: s.cycleChannels || ["master", "game", "chat", "media"]
        });
        setImage(c, svgToDataUri(svg));
        title(c, "");
      }

      feedback(c, {
        title: chName,
        value: valStr,
        indicator: { value: Math.round(d.volume) }
      });
      state(c, d.isMuted ? 1 : 0);
      return;
    }

    if (k === "mute") {
      const snap = await snapshot();
      const d = currentData(snap, s) || { volume: 0, isMuted: false };
      const chName = (s.channel || "game").toUpperCase();
      const valStr = d.isMuted ? "MUTED" : "ON";
      title(c, `${chName}\n${valStr}`);
      feedback(c, { title: chName, value: valStr });
      state(c, d.isMuted ? 1 : 0);
      return;
    }

    if (k === "devicetoggle") {
      const activeId = await withSonar((ep) =>
        getActiveOutputDevice(ep, s.channel || "render")
      );
      const devA = s.deviceA || "";
      const devB = s.deviceB || "";
      const isA = activeId && devA && activeId.toLowerCase() === devA.toLowerCase();
      const isB = activeId && devB && activeId.toLowerCase() === devB.toLowerCase();

      let curLabel = "";
      let iconType = "headphones";
      if (isA) {
        curLabel = s.labelA || "Sluchátka";
        iconType = s.iconA || "headphones";
      } else if (isB) {
        curLabel = s.labelB || "Reproduktory";
        iconType = s.iconB || "speakers";
      } else {
        const ep = await sonar();
        const devs = await getAudioDevices(ep, DeviceFlow.Output);
        const found = devs.find((x) => x.id === activeId);
        curLabel = found ? found.name.split("(")[0].trim() : "Výstup";
        iconType = /sluch|head/i.test(curLabel) ? "headphones" : (/repro|speak/i.test(curLabel) ? "speakers" : "device");
      }

      const displayMode = s.displayMode || "icon";

      if (displayMode === "text") {
        const topText = curLabel.toUpperCase().slice(0, 11);
        const nextLabel = (isA ? s.labelB || "REPRO" : s.labelA || "SLUCHÁTKA")
          .toUpperCase()
          .slice(0, 10);
        title(c, `${topText}\n[${nextLabel}]`);
      } else {
        const svg = renderDeviceSvg({
          iconType,
          label: curLabel,
          showLabel: displayMode,
          active: true,
          accentColor: s.accentColor || (isB ? "#e2fd36" : "#00e5ff")
        });
        setImage(c, svgToDataUri(svg));
        title(c, "");
      }

      state(c, isB ? 1 : 0);
      feedback(c, {
        title: "VÝSTUP",
        value: curLabel
      });
      return;
    }

    if (k === "chatmix") {
      try {
        const d = await withSonar((ep) => getChatMixState(ep));
        const val = Math.round(d.chatBalance);
        title(c, `CHAT MIX\n${val}%`);
        feedback(c, {
          title: "CHAT MIX",
          value: `${val}%`,
          indicator: { value: val }
        });
        state(c, d.isEnabled ? 1 : 0);
      } catch (err) {
        title(c, "CHAT MIX\nN/A");
        feedback(c, { title: "CHAT MIX", value: "N/A" });
        state(c, 2);
      }
      return;
    }

    if (k === "mode") {
      const m = await withSonar((ep) => getAudioMode(ep));
      const modeName = m === AudioMode.Streamer ? "STREAMER" : "CLASSIC";
      title(c, modeName);
      feedback(c, { title: "MODE", value: modeName });
      state(c, m === AudioMode.Streamer ? 1 : 0);
      return;
    }

    if (k === "scene") {
      title(c, s.sceneName || "MIX SCENE");
      feedback(c, { title: "SCENE", value: s.sceneName || "Default" });
      return;
    }

    if (k === "device" || k === "micdevice") {
      const name = s.deviceName || (k === "micdevice" ? "MIC DEVICE" : "OUTPUT");
      title(c, name);
      feedback(c, { title: k === "micdevice" ? "MIC" : "OUTPUT", value: name });
      return;
    }
  } catch (e) {
    title(c, "SONAR\nOFFLINE");
    feedback(c, { title: "SONAR", value: "OFFLINE" });
    state(c, 2);
  }
}

const volumeHolds = new Map();

async function applyVolumeStep(c) {
  const r = contexts.get(c);
  if (!r || actionKey(r.action) !== "volume") return;
  const s = r.settings || {};
  if (volumeHolds.get(c)?.busy) return;
  const h = volumeHolds.get(c) || {};
  h.busy = true;
  volumeHolds.set(c, h);
  try {
    const snap = await snapshot();
    const d = currentData(snap, s) || { volume: 0 };
    const dir = s.direction === "down" ? -1 : 1;
    await setVolume(s, Number(d.volume) + dir * (Math.abs(Number(s.step)) || 5));
    await refreshContext(c);
  } catch (e) {
    log("applyVolumeStep error: " + (e.stack || e));
    alert(c);
  } finally {
    const x = volumeHolds.get(c);
    if (x) x.busy = false;
  }
}

function beginVolumeHold(c) {
  endVolumeHold(c);
  const h = { busy: false };
  volumeHolds.set(c, h);
  applyVolumeStep(c);
  h.delay = setTimeout(() => {
    if (volumeHolds.get(c) !== h) return;
    h.timer = setInterval(() => applyVolumeStep(c), 160);
  }, 320);
}

function endVolumeHold(c) {
  const h = volumeHolds.get(c);
  if (!h) return;
  if (h.delay) clearTimeout(h.delay);
  if (h.timer) clearInterval(h.timer);
  volumeHolds.delete(c);
}

async function keyUp(c) {
  const r = contexts.get(c);
  if (!r) return;
  const k = actionKey(r.action);
  const s = r.settings || {};

  try {
    if (k === "volume") {
      if (s.knobPress === "cycle") {
        const cycleChannels = ["master", "game", "chat", "media", "aux"];
        const currentIdx = cycleChannels.indexOf(s.channel || "game");
        const nextChannel = cycleChannels[(currentIdx + 1) % cycleChannels.length];
        s.channel = nextChannel;
        r.settings = s;
        contexts.set(c, r);
        send({ event: "setSettings", context: c, payload: s });
        const snap = await snapshot();
        const d = currentData(snap, s) || { volume: 0, isMuted: false };
        showOSD(channelNames[nextChannel], d.volume, d.isMuted, "OVLÁDANÝ KANÁL", "volume", s);
      }
      return;
    } else if (k === "mute") {
      const snap = await snapshot();
      const d = currentData(snap, s) || { isMuted: false };
      await setMute(s, !d.isMuted);
    } else if (k === "devicetoggle") {
      const activeId = await withSonar((ep) =>
        getActiveOutputDevice(ep, s.channel || "render")
      );
      let devA = s.deviceA;
      let devB = s.deviceB;

      if (!devA || !devB) {
        const ep = await sonar();
        const devs = await getAudioDevices(ep, DeviceFlow.Output);
        if (!devA) {
          const head = devs.find((d) => /sluch|head/i.test(d.name)) || devs[0];
          if (head) devA = head.id;
        }
        if (!devB) {
          const spk = devs.find((d) => /repro|speak/i.test(d.name)) || devs[1] || devs[0];
          if (spk) devB = spk.id;
        }
        s.deviceA = devA;
        s.deviceB = devB;
        r.settings = s;
        contexts.set(c, r);
        send({ event: "setSettings", context: c, payload: s });
      }

      const targetId =
        activeId && devA && activeId.toLowerCase() === devA.toLowerCase() && devB
          ? devB
          : devA || devB;
      const targetLabel =
        targetId === devB ? s.labelB || "Reproduktory" : s.labelA || "Sluchátka";

      await withSonar((ep) => setOutputDevice(ep, targetId, s.channel || "render"));
      showOSD("MIXER OUTPUT", 0, false, targetLabel, "device", s);
    } else if (k === "setvolume") {
      await setVolume(s, Number(s.target) || 50);
    } else if (k === "chatmix") {
      try {
        const d = await withSonar((ep) => getChatMixState(ep));
        const next = Math.max(0, Math.min(100, d.chatBalance + (Number(s.step) || 10)));
        const result = await withSonar((ep) => setChatMixBalance(ep, next));
        showOSD(
          "CHAT MIX",
          result.chatBalance,
          false,
          `GAME ${100 - result.chatBalance}%  /  CHAT ${result.chatBalance}%`,
          "volume",
          s
        );
      } catch {
        alert(c);
        return;
      }
    } else if (k === "mode") {
      const ep = await sonar();
      const m = await getAudioMode(ep);
      const next = m === AudioMode.Streamer ? AudioMode.Classic : AudioMode.Streamer;
      await setAudioMode(ep, next);
      showOSD(
        "SONAR MODE",
        next === AudioMode.Streamer ? 100 : 0,
        false,
        next === AudioMode.Streamer ? "STREAMER" : "CLASSIC",
        "volume",
        s
      );
    } else if (k === "device") {
      if (!s.deviceId) throw Error("Choose output device");
      await withSonar((ep) => setMixerHardwareDevice(ep, "output", s.deviceId));
      showOSD("MIXER OUTPUT", 0, false, s.deviceName || "DEVICE CHANGED", "device", s);
    } else if (k === "micdevice") {
      if (!s.deviceId) throw Error("Choose microphone");
      await withSonar((ep) => setMixerHardwareDevice(ep, "input", s.deviceId));
      showOSD("MIXER INPUT", 0, false, s.deviceName || "DEVICE CHANGED", "device", s);
    } else if (k === "scene") {
      const scene = config.scenes?.[s.sceneName];
      if (!scene) throw Error("Scene not found");
      for (const [channel, v] of Object.entries(scene.channels || {})) {
        await setVolume({ channel, path: "monitoring" }, v.volume);
        await setMute({ channel, path: "monitoring" }, v.isMuted);
      }
      showOSD("MIXER SCENE", 100, false, s.sceneName || "APPLIED", "volume", s);
    } else if (k === "status") {
      await sonar(true);
    }
    await refreshContext(c);
  } catch (e) {
    log("keyUp error: " + (e.stack || e));
    title(c, String(e.message || e).slice(0, 20));
    alert(c);
  }
}

async function panel(m) {
  const r = contexts.get(m.context) || { settings: {}, action: m.action };
  let extra = {};
  try {
    const ep = await sonar();
    extra.mode = await getAudioMode(ep);
    if (["device", "micdevice", "devicetoggle"].includes(actionKey(m.action))) {
      extra.devices = await getAudioDevices(
        ep,
        actionKey(m.action) === "micdevice" ? DeviceFlow.Input : DeviceFlow.Output
      );
    }
    extra.scenes = Object.keys(config.scenes || {});
  } catch (e) {
    extra.error = String(e.message || e);
  }
  send({
    event: "sendToPropertyInspector",
    context: m.context,
    action: m.action,
    payload: {
      event: "panel",
      actionKey: actionKey(m.action),
      settings: r.settings || {},
      status,
      ...extra
    }
  });
}

async function handle(m) {
  const c = m.context;
  const k = actionKey(m.action);

  if (m.event === "willAppear") {
    contexts.set(c, { action: m.action, settings: m.payload?.settings || {} });
    refreshContext(c);
  }
  if (m.event === "didReceiveSettings") {
    const r = contexts.get(c) || { action: m.action };
    r.settings = m.payload?.settings || {};
    contexts.set(c, r);
    refreshContext(c);
  }
  if (m.event === "willDisappear") {
    endVolumeHold(c);
    contexts.delete(c);
  }
  if (m.event === "keyDown" && k === "volume") {
    beginVolumeHold(c);
  }
  if (m.event === "keyUp") {
    if (k === "volume") endVolumeHold(c);
    else keyUp(c);
  }
  if (m.event === "dialRotate" && ["volume", "chatmix"].includes(k)) {
    const r = contexts.get(c);
    const ticks = Number(m.payload?.ticks || 0);
    const s = r?.settings || {};
    if (k === "volume") {
      const now = Date.now();
      const track = knobRotations.get(c) || { ticks: 0, lastTime: 0 };
      if (now - track.lastTime > 250) track.ticks = 0;
      track.lastTime = now;
      if (ticks < 0) track.ticks += ticks;
      else track.ticks = 0;
      knobRotations.set(c, track);

      const quickTurnMode = s.quickTurn || "zero";
      if (quickTurnMode === "zero" && (ticks <= -3 || track.ticks <= -4)) {
        track.ticks = 0;
        await setVolume(s, 0);
        refreshContext(c);
        return;
      }

      const snap = await snapshot();
      const d = currentData(snap, s);
      const step = Number(s.step) || 2;
      await setVolume(s, Number(d?.volume || 0) + ticks * step);
    } else {
      try {
        const d = await withSonar((ep) => getChatMixState(ep));
        const step = Number(s.step) || 2;
        const result = await withSonar((ep) =>
          setChatMixBalance(ep, d.chatBalance + ticks * step)
        );
        showOSD(
          "CHAT MIX",
          result.chatBalance,
          false,
          `GAME ${100 - result.chatBalance}%  /  CHAT ${result.chatBalance}%`,
          "volume",
          s
        );
      } catch {}
    }
    refreshContext(c);
  }
  if (m.event === "dialDown" || m.event === "touchTap") {
    if (k === "volume") {
      const r = contexts.get(c);
      const s = r?.settings || {};
      const pressAction = s.knobPress || "mute";

      if (pressAction === "cycle") {
        const rawCycle = s.cycleChannels || ["master", "game", "chat", "media"];
        const cycleList = (Array.isArray(rawCycle) ? rawCycle : String(rawCycle).split(","))
          .map((x) => String(x).trim().toLowerCase())
          .filter(Boolean);
        const cycleChannels = cycleList.length > 0 ? cycleList : ["master", "game", "chat", "media"];
        let currentIdx = cycleChannels.indexOf(s.channel || "game");
        if (currentIdx === -1) currentIdx = 0;
        const nextChannel = cycleChannels[(currentIdx + 1) % cycleChannels.length];
        s.channel = nextChannel;
        contexts.set(c, r);
        send({ event: "setSettings", context: c, payload: s });

        const snap = await snapshot();
        const d = currentData(snap, s) || { volume: 0, isMuted: false };
        showOSD(
          channelNames[nextChannel],
          d.volume,
          d.isMuted,
          "OVLÁDANÝ KANÁL",
          "volume",
          s
        );
        refreshContext(c);
        return;
      } else {
        const snap = await snapshot();
        const d = currentData(snap, s);
        await setMute(s, !d?.isMuted);
        refreshContext(c);
        return;
      }
    } else if (k === "mute") {
      const r = contexts.get(c);
      const snap = await snapshot();
      const d = currentData(snap, r?.settings || {});
      await setMute(r?.settings || {}, !d?.isMuted);
      refreshContext(c);
    } else if (k === "devicetoggle") {
      keyUp(c);
    } else if (k === "chatmix") {
      try {
        await withSonar((ep) => setChatMixBalance(ep, 50));
        showOSD("CHAT MIX", 50, false, "GAME 50%  /  CHAT 50%");
        refreshContext(c);
      } catch {}
    } else {
      keyUp(c);
    }
  }
  if (m.event === "sendToPlugin") {
    const p = m.payload || {};
    const r = contexts.get(c) || { action: m.action, settings: {} };
    if (!r.action && m.action) r.action = m.action;
    if (p.settings && Object.keys(r.settings || {}).length === 0) {
      r.settings = p.settings;
    }
    if (p.event === "getPanel") await panel(m);
    if (p.event === "saveAction") {
      r.settings = p.settings || {};
      contexts.set(c, r);
      send({ event: "setSettings", context: c, payload: r.settings });
      send({
        event: "sendToPropertyInspector",
        context: c,
        action: m.action,
        payload: { event: "saved" }
      });
      refreshContext(c);
    }
    if (p.event === "saveScene") {
      const snap = await snapshot();
      const channels = {};
      for (const name of ["master", "game", "chat", "media", "aux", "mic"]) {
        const d =
          snap.mode === AudioMode.Streamer
            ? snap.audio?.[name]?.monitoring
            : snap.audio?.[name];
        if (d) channels[name] = { volume: d.volume, isMuted: d.isMuted };
      }
      config.scenes = config.scenes || {};
      config.scenes[p.name || "My Scene"] = { channels, createdAt: Date.now() };
      saveConfig(config);
      await panel(m);
    }
  }
}

let shuttingDown = false;
function shutdown(reason = "shutdown") {
  if (shuttingDown) return;
  shuttingDown = true;
  log("Plugin shutdown: " + reason);
  try {
    if (osdProcess && osdProcess.exitCode == null) osdProcess.kill();
  } catch {}
  try {
    sd?.close();
  } catch {}
  setTimeout(() => process.exit(0), 80).unref();
}

const args = parseCliArgs();
if (!args.port) {
  log("Missing port argument, exiting");
  process.exit(1);
}

process.on("exit", () => {
  try {
    if (osdProcess) osdProcess.kill();
  } catch {}
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  try {
    process.on(signal, () => shutdown(signal));
  } catch {}
}

log("Connecting to StreamDock on port " + args.port + " with UUID " + args.pluginUUID);
sd = new WebSocket(`ws://127.0.0.1:${args.port}`);
sd.on("open", () => {
  log("WebSocket connected. Registering with event: " + args.registerEvent);
  send({ uuid: args.pluginUUID, event: args.registerEvent });
});
sd.on("message", (data) => {
  try {
    handle(JSON.parse(data.toString()));
  } catch (e) {
    log("Handle message error: " + (e.stack || e));
  }
});
sd.on("close", (code, reason) => {
  shutdown(`StreamDock socket closed: code=${code} reason=${reason}`);
});
sd.on("error", (err) => {
  log("StreamDock socket error: " + err.message);
});

setInterval(() => {
  for (const c of contexts.keys()) refreshContext(c);
}, 1500).unref();
