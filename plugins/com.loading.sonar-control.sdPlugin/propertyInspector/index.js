"use strict";
let ws, action = "", context = "", panel = {};
const E = (x) => document.getElementById(x);
const send = (payload) =>
  ws?.readyState === 1 &&
  ws.send(JSON.stringify({ event: "sendToPlugin", action, context, payload }));

function option(v, n, sel) {
  return `<option value="${v}" ${String(v) === String(sel) ? "selected" : ""}>${n}</option>`;
}

function saveSettings() {
  const s = {};
  if (E("channel")) s.channel = E("channel").value;
  if (E("path")) s.path = E("path").value;
  if (E("step")) s.step = Number(E("step").value);
  if (E("direction")) s.direction = E("direction").value;
  if (E("target")) s.target = Number(E("target").value);
  if (E("knobPress")) s.knobPress = E("knobPress").value;
  if (E("quickTurn")) s.quickTurn = E("quickTurn").value;
  const cycleBoxes = document.querySelectorAll("input[name='cycleCh']:checked");
  if (cycleBoxes.length > 0) {
    s.cycleChannels = Array.from(cycleBoxes).map((x) => x.value);
  } else if (document.querySelector("input[name='cycleCh']")) {
    s.cycleChannels = ["master", "game", "chat", "media"];
  }
  if (E("displayStyle")) s.displayStyle = E("displayStyle").value;
  if (E("hudTheme")) s.hudTheme = E("hudTheme").value;
  if (E("displayMode")) s.displayMode = E("displayMode").value;
  if (E("accentColor")) s.accentColor = E("accentColor").value;
  if (E("showOsd")) s.showOsd = E("showOsd").value;
  if (E("deviceId")) {
    s.deviceId = E("deviceId").value;
    s.deviceName = E("deviceId").options[E("deviceId").selectedIndex]?.text || "";
  }
  if (E("deviceA")) s.deviceA = E("deviceA").value;
  if (E("labelA")) s.labelA = E("labelA").value.trim();
  if (E("iconA")) s.iconA = E("iconA").value;
  if (E("deviceB")) s.deviceB = E("deviceB").value;
  if (E("labelB")) s.labelB = E("labelB").value.trim();
  if (E("iconB")) s.iconB = E("iconB").value;
  if (E("sceneName")) s.sceneName = E("sceneName").value;
  send({ event: "saveAction", settings: s });
}

window.connectElgatoStreamDeckSocket = function (port, uuid, event, info, actionInfo) {
  let a = {};
  try {
    a = JSON.parse(actionInfo || "{}");
  } catch {}
  action = a.action || "";
  context = uuid;
  ws = new WebSocket("ws://127.0.0.1:" + port);
  ws.onopen = () => {
    ws.send(JSON.stringify({ event, uuid }));
    send({ event: "getPanel", settings: a?.payload?.settings });
  };
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    const p = m.payload || {};
    if (m.event === "sendToPropertyInspector" && p.event === "panel") render(p);
    if (p.event === "saved") {
      const msg = E("message");
      if (msg) {
        msg.textContent = "Uloženo";
        setTimeout(() => {
          if (msg.textContent === "Uloženo") msg.textContent = "";
        }, 1500);
      }
    }
  };
};

const channels = [
  ["master", "Master"],
  ["game", "Game"],
  ["chat", "Chat"],
  ["media", "Media"],
  ["aux", "Aux"],
  ["mic", "Microphone"]
];

function common(s, withTarget = false) {
  return `<label>Kanál</label><select id="channel">${channels
    .map((x) => option(x[0], x[1], s.channel || "game"))
    .join("")}</select><label>Režim Streamer cíl</label><select id="path">${option(
    "monitoring",
    "Osobní poslech (Monitoring)",
    s.path || "monitoring"
  )}${option("streaming", "Stream / Diváci (Audience)", s.path)}</select>${
    withTarget
      ? `<label>Cílová hlasitost (%)</label><input id="target" type="number" min="0" max="100" value="${
          s.target ?? 50
        }">`
      : ""
  }` +
  `<label>Vyskakovací lišta na monitoru (OSD vpravo nahoře)</label><select id="showOsd">${option(
    "off",
    "Vypnuto (žádné vyskakovací okno na monitoru - Doporučeno)",
    s.showOsd || "off"
  )}${option(
    "on",
    "Zapnuto (zobrazovat lištu v rohu obrazovky)",
    s.showOsd
  )}</select>`;
}

function render(p) {
  panel = p;
  const c = E("connection"),
    box = E("settings"),
    s = p.settings || {},
    k = p.actionKey;

  if (p.error) {
    c.innerHTML = `<span class="bad">Sonar offline</span><p>${p.error}</p>`;
  } else {
    c.innerHTML = `<span class="good">Sonar připojen</span><p>Režim: ${
      p.mode || p.status?.mode || "unknown"
    }</p>`;
  }

  E("save").hidden = false;

  if (k === "volume") {
    box.innerHTML =
      common(s) +
      `<label>Vzhled displeje na knobu</label><select id="displayStyle">${option(
        "hud",
        "⚡ Sci-Fi HUD (Herní vysoce kontrastní styl jako na foto)",
        s.displayStyle || "hud"
      )}${option(
        "minimal",
        "Minimalistický (Pouze název kanálu a velká čísla)",
        s.displayStyle
      )}${option(
        "transparent",
        "Průhledné pozadí (ukazatel dole)",
        s.displayStyle
      )}${option(
        "classic",
        "Původní jednoduchý text",
        s.displayStyle
      )}</select>` +
      `<label>Barevný motiv displeje</label><select id="hudTheme">${option(
        "channel",
        "🌈 Dle kanálu (Master=Modrá, Game=Zelená, Chat=Azurová, Media=Růžová)",
        s.hudTheme || "channel"
      )}${option(
        "yellow",
        "⚡ Jednotná neonová žlutá / Lime",
        s.hudTheme
      )}${option(
        "cyan",
        "💎 Jednotná azurová Cyberpunk",
        s.hudTheme
      )}${option(
        "green",
        "🟢 Jednotná zelená HUD",
        s.hudTheme
      )}${option(
        "amber",
        "🟠 Jednotná jantarová HUD",
        s.hudTheme
      )}</select>` +
      `<label>Směr tlačítka (pro klasická tlačítka)</label><select id="direction">${option(
        "up",
        "Zvyšovat hlasitost (+)",
        s.direction || "up"
      )}${option(
        "down",
        "Snižovat hlasitost (-)",
        s.direction
      )}</select>` +
      `<label>Krok na 1 krok / tik knobu</label><input id="step" type="number" min="1" max="25" value="${
        s.step ?? 5
      }">` +
      `<label>Akce při stisku knobu</label><select id="knobPress">${option(
        "mute",
        "Ztlumit / Zapnout (Mute)",
        s.knobPress || "mute"
      )}${option(
        "cycle",
        "Přepínat kanál (Cyklovat vybrané kanály)",
        s.knobPress
      )}</select>` +
      `<label>Povolené kanály pro cyklování stiskem</label><div class="chip-group">${[
        ["master", "Master"],
        ["game", "Game"],
        ["chat", "Chat"],
        ["media", "Media"],
        ["aux", "Aux"],
        ["mic", "Mic"]
      ]
        .map(
          ([id, label]) =>
            `<label class="chip"><input type="checkbox" name="cycleCh" value="${id}" ${
              (s.cycleChannels || ["master", "game", "chat", "media"]).includes(id)
                ? "checked"
                : ""
            }> ${label}</label>`
        )
        .join("")}</div>` +
      `<label>Rychlé otočení knobu doleva</label><select id="quickTurn">${option(
        "zero",
        "Rychlé otočení = okamžitě ztlumit na 0% (Doporučeno)",
        s.quickTurn || "zero"
      )}${option(
        "none",
        "Vypnuto (běžný krok)",
        s.quickTurn
      )}</select>` +
      `<p class="hint">Displej knobu má čisté černé pozadí bez jakéhokoliv nevzhledného šedého rámečku s ikonou přes text.</p>`;
  } else if (k === "devicetoggle") {
    const devs = p.devices || [];
    const defaultDevA = s.deviceA || (devs.find((d) => /sluch|head/i.test(d.name)) || devs[0])?.id || "";
    const defaultDevB = s.deviceB || (devs.find((d) => /repro|speak/i.test(d.name)) || devs[1] || devs[0])?.id || "";
    const defaultLabelA = s.labelA || (devs.find((d) => d.id === defaultDevA)?.name.split("(")[0].trim() || "Sluchátka");
    const defaultLabelB = s.labelB || (devs.find((d) => d.id === defaultDevB)?.name.split("(")[0].trim() || "Reproduktory");
    const defaultIconA = s.iconA || (/sluch|head/i.test(defaultLabelA) ? "headphones" : "device");
    const defaultIconB = s.iconB || (/repro|speak/i.test(defaultLabelB) ? "speakers" : "device");

    box.innerHTML =
      `<label>Styl zobrazení tlačítka</label>` +
      `<select id="displayMode">${option(
        "icon",
        "Pouze čistá dynamická ikona (Doporučeno)",
        s.displayMode || "icon"
      )}${option(
        "both",
        "Ikona + název zařízení dole",
        s.displayMode
      )}${option(
        "text",
        "Pouze text",
        s.displayMode
      )}</select>` +

      `<hr style="border:0;border-top:1px solid var(--line);margin:15px 0;">` +
      `<label>Zařízení 1 (A)</label>` +
      `<select id="deviceA">${devs
        .map((x) => option(x.id, x.name, s.deviceA || defaultDevA))
        .join("")}</select>` +
      `<div class="row">` +
      `<div><label>Ikona pro Zařízení 1</label><select id="iconA">${option(
        "headphones",
        "🎧 Sluchátka (normální)",
        s.iconA || defaultIconA
      )}${option(
        "speakers",
        "🔊 Reproduktory (stereo monitory)",
        s.iconA || defaultIconA
      )}${option(
        "soundwaves",
        "📢 Reproduktor se zvukovými vlnami",
        s.iconA || defaultIconA
      )}${option(
        "display",
        "🖥️ Monitor / TV",
        s.iconA || defaultIconA
      )}${option(
        "device",
        "🎛️ Zvuková karta / DAC",
        s.iconA || defaultIconA
      )}</select></div>` +
      `<div><label>Zkrácený název (A)</label><input id="labelA" type="text" placeholder="Sluchátka" value="${
        s.labelA ?? defaultLabelA
      }"></div>` +
      `</div>` +

      `<hr style="border:0;border-top:1px solid var(--line);margin:15px 0;">` +
      `<label>Zařízení 2 (B)</label>` +
      `<select id="deviceB">${devs
        .map((x) => option(x.id, x.name, s.deviceB || defaultDevB))
        .join("")}</select>` +
      `<div class="row">` +
      `<div><label>Ikona pro Zařízení 2</label><select id="iconB">${option(
        "speakers",
        "🔊 Reproduktory (stereo monitory)",
        s.iconB || defaultIconB
      )}${option(
        "soundwaves",
        "📢 Reproduktor se zvukovými vlnami",
        s.iconB || defaultIconB
      )}${option(
        "headphones",
        "🎧 Sluchátka (normální)",
        s.iconB || defaultIconB
      )}${option(
        "display",
        "🖥️ Monitor / TV",
        s.iconB || defaultIconB
      )}${option(
        "device",
        "🎛️ Zvuková karta / DAC",
        s.iconB || defaultIconB
      )}</select></div>` +
      `<div><label>Zkrácený název (B)</label><input id="labelB" type="text" placeholder="Repro" value="${
        s.labelB ?? defaultLabelB
      }"></div>` +
      `</div>` +

      `<hr style="border:0;border-top:1px solid var(--line);margin:15px 0;">` +
      `<label>Neonový akcent tlačítek</label>` +
      `<select id="accentColor">${option(
        "",
        "Automaticky (Azurová pro sluchátka, Žlutá pro repro)",
        s.accentColor || ""
      )}${option(
        "#00e5ff",
        "💎 Azurová Cyberpunk",
        s.accentColor
      )}${option(
        "#e2fd36",
        "⚡ Neonová žlutá (jako na foto)",
        s.accentColor
      )}${option(
        "#00ff88",
        "🟢 Neonová zelená HUD",
        s.accentColor
      )}${option(
        "#ffb700",
        "🟠 Jantarová HUD",
        s.accentColor
      )}</select>` +
      `<hr style="border:0;border-top:1px solid var(--line);margin:15px 0;">` +
      `<label>Které kanály v Sonaru přepínat</label>` +
      `<select id="channel">${[
        ["render", "Všechny výstupy v Sonaru (Doporučeno)"],
        ["game", "Pouze Game"],
        ["media", "Pouze Media"],
        ["chat", "Pouze Chat"],
        ["aux", "Pouze Aux"]
      ]
        .map((x) => option(x[0], x[1], s.channel || "render"))
        .join("")}</select>` +
      `<label>Vyskakovací lišta na monitoru (OSD vpravo nahoře)</label><select id="showOsd">${option(
        "off",
        "Vypnuto (žádné vyskakovací okno na monitoru - Doporučeno)",
        s.showOsd || "off"
      )}${option(
        "on",
        "Zapnuto (zobrazovat lištu v rohu obrazovky)",
        s.showOsd
      )}</select>` +
      `<p class="hint">Při stisku se ikona okamžitě změní podle aktivního výstupu (sluchátka / repráky) a přepne zvuk v Sonaru bez jakékoliv zbytečné šipky přes displej.</p>`;
  } else if (k === "mute") {
    box.innerHTML = common(s) + `<p>Stiskem klávesy nebo knobu přepnete ztlumení (Mute/Unmute) vybraného kanálu.</p>`;
  } else if (k === "setvolume") {
    box.innerHTML = common(s, true);
  } else if (k === "chatmix") {
    box.innerHTML = `<label>Krok</label><input id="step" type="number" min="1" max="25" value="${
      s.step ?? 10
    }"><p>Knob: otočením vlevo/vpravo měníte poměr Game/Chat, stiskem knobu resetujete na 50/50.<br>Tlačítko: stisk posouvá k Chat.</p>`;
  } else if (k === "device") {
    box.innerHTML = `<label>Kanál Sonaru</label><select id="channel">${[
      ["output", "Všechny výstupy"],
      ...channels.slice(1, 5)
    ]
      .map((x) => option(x[0], x[1], s.channel || "output"))
      .join("")}</select><label>Výstupní zařízení</label><select id="deviceId">${(
      p.devices || []
    )
      .map((x) => option(x.id, x.name, s.deviceId))
      .join("")}</select>`;
  } else if (k === "micdevice") {
    box.innerHTML = `<label>Mikrofon</label><select id="deviceId">${(
      p.devices || []
    )
      .map((x) => option(x.id, x.name, s.deviceId))
      .join("")}</select>`;
  } else if (k === "scene") {
    box.innerHTML = `<label>Scéna</label><select id="sceneName">${(
      p.scenes || []
    )
      .map((x) => option(x, x, s.sceneName))
      .join("")}</select><label>Vytvořit scénu z aktuálního mixu</label><div class="row"><input id="newScene" placeholder="Gaming"><button id="capture">Uložit mix</button></div><p>Uloží aktuální hlasitosti a stavy ztlumení všech kanálů.</p>`;
  } else if (k === "mode") {
    box.innerHTML = "<p>Stiskem přepnete mezi Classic a Streamer módem.</p>";
  } else {
    box.innerHTML = "<p>Tato akce zobrazuje stav připojení k Sonaru a aktuální mód.</p>";
  }

  box.onchange = saveSettings;
  box.oninput = saveSettings;

  if (E("capture")) {
    E("capture").onclick = () =>
      send({
        event: "saveScene",
        name: E("newScene").value.trim() || "My Scene"
      });
  }
}

E("save").onclick = saveSettings;
