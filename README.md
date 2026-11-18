# 🚀 Pluginy pro Stream Dock AJAZZ (AKP05E)

Tento repozitář obsahuje balíček vyladěných, optimalizovaných a nově vytvořených pluginů pro ovládací konzoli **Stream Dock AJAZZ AKP05E** (s LCD tlačítky a otočnými knoby). 

Všechny pluginy jsou plně lokalizované do **češtiny**, mají předpřipravené všechny potřebné knihovny (`node_modules`) a fungují okamžitě po nakopírování do Stream Docku – bez nutnosti cokoliv kompilovat či instalovat přes terminál.

---

## 📦 Obsah repozitáře

| Plugin | Složka | Popis |
| :--- | :--- | :--- |
| 🖥️ **HW Monitor Pro** | `com.antigravity.hwmonitor.sdPlugin` | Živé sledování CPU, GPU, RAM, VRAM, disků a sítě (teploty, zátěž, takty, ventilátory, W). |
| 🎵 **Brave Media Controller** | `com.antigravity.bravemedia.sdPlugin` | Ovládání multimédií v Brave/Chrome (název skladby, interpret, Play/Pause, Next/Prev, ovládání hlasitosti knobem). |
| 🔋 **Ajazz & Arctis Manager** | `com.froyo.batterylevel.sdPlugin` | Stav baterie myši **Ajazz AJ179 PRO** a sluchátek **Arctis Nova 5**, přepínání **DPI**, správa **profilů/vrstev (Layers)** a sdílený knob. |
| 🎧 **SteelSeries Sonar Control** | `com.loading.sonar-control.sdPlugin` | Ovládání virtuálního mixu SteelSeries GG Sonar (hlasitost kanálů knobem, Mute, ChatMix, přepínání zařízení, scény). |
| 🕒 **Datum & Čas CZ** | `com.mirabox.streamdock.dateTime.sdPlugin` | Plně české datum a čas, skládání 3 nezávislých řádků, individuální volba velikosti písma (12–40 px) a barev pro každý řádek. |

---

## 📥 Možnosti stažení

### 1. Stažení všeho najednou (Kompletní balíček)
* 📦 **[Stáhnout All_AKP05E_Plugins.zip (vše v jednom)](zips/All_AKP05E_Plugins.zip)**

### 2. Stažení jednotlivých pluginů samostatně
Pokud potřebujete pouze konkrétní plugin, můžete si stáhnout samostatný `.zip` archiv ze složky [`zips/`](zips/):
* 🖥️ **[com.antigravity.hwmonitor.sdPlugin.zip](zips/com.antigravity.hwmonitor.sdPlugin.zip)** (HW Monitor Pro)
* 🎵 **[com.antigravity.bravemedia.sdPlugin.zip](zips/com.antigravity.bravemedia.sdPlugin.zip)** (Brave Media)
* 🔋 **[com.froyo.batterylevel.sdPlugin.zip](zips/com.froyo.batterylevel.sdPlugin.zip)** (Baterie myši & sluchátek + DPI a Profily)
* 🎧 **[com.loading.sonar-control.sdPlugin.zip](zips/com.loading.sonar-control.sdPlugin.zip)** (SteelSeries Sonar Control)
* 🕒 **[com.mirabox.streamdock.dateTime.sdPlugin.zip](zips/com.mirabox.streamdock.dateTime.sdPlugin.zip)** (Datum a čas CZ)

---

## ⚡ Návod k instalaci

### Varianta A: Automatická instalace (Doporučeno, 1 kliknutí)
1. Stáhněte si repozitář jako ZIP (zelené tlačítko **Code -> Download ZIP** nahoře na GitHubu) a rozbalte jej.
2. Dvakrát klikněte na soubor **`install.bat`** (nebo spusťte `install.ps1` v PowerShellu).
3. Skript automaticky nakopíruje všechny složky `.sdPlugin` do vašeho profilu Stream Docku a nabídne restart aplikace.

---

### Varianta B: Ruční instalace (krok za krokem)
1. Otevřete v Průzkumníku Windows následující složku:
   ```cmd
   %APPDATA%\HotSpot\StreamDock\plugins
   ```
   *(Stačí zkopírovat tuto cestu, stisknout `Win + R`, vložit a potvrdit Enterem. Obvykle je to `C:\Users\<VašeJméno>\AppData\Roaming\HotSpot\StreamDock\plugins`)*.
2. Z rozbaleného archivu (nebo ze složky `plugins/` v tomto repozitáři) zkopírujte požadované složky `.sdPlugin` přímo do této složky `plugins`.
3. **Ukončete a znovu spusťte aplikaci Stream Dock AJAZZ** (případně zkontrolujte ikonu vedle hodin v oznamovací oblasti Windows a zvolte Exit/Ukončit).
4. V postranním panelu aplikace Stream Dock se ihned objeví nové kategorie a akce.

---

## 🔍 Podrobný přehled pluginů a funkcí

### 1. 🖥️ HW Monitor Pro (`com.antigravity.hwmonitor.sdPlugin`)
* Navržen pro detailní a plynulé sledování hardwaru vašeho PC přímo na klávesách i knotech Stream Docku.
* **Podporované metriky**:
  * **CPU**: Celková zátěž %, teplota CPU Package / Tdie, průměrná frekvence jader (GHz), okamžitá spotřeba (W).
  * **GPU**: Teplota jádra GPU, teplota Hotspotu, teplota pamětí VRAM, vytížení jádra %, otáčky ventilátorů (RPM / %), spotřeba GPU (W).
  * **RAM & VRAM**: Využití operační paměti v GB a %, teplota modulů DDR5 (SPD Hub).
  * **Úložiště & Síť**: Rychlost čtení/zápisu na disky, přenosová rychlost sítě (Download/Upload).
* **Integrace s HWiNFO64**:
  * Pro nejvyšší přesnost a čtení všech senzorů stačí mít spuštěný program **HWiNFO64** se zapnutou volbou **Sdílená paměť (Shared Memory)**.
  * Pokud HWiNFO neběží, plugin automaticky přepne na vestavěný Windows senzor engine.

---

### 2. 🎵 Brave Media Controller (`com.antigravity.bravemedia.sdPlugin`)
* Umožňuje plnohodnotné ovládání přehrávače v prohlížeči Brave (nebo Chrome / Edge / Spotify) pomocí rozhraní Windows SMTC.
* **Funkce na tlačítkách**:
  * **Displej Now Playing**: Zobrazuje název aktuálně přehrávané skladby nebo YouTube videa, jméno interpreta a stav přehrávání s automatickým centrováním.
  * **Tlačítka**: Play / Pause, Další skladba (Next), Předchozí skladba (Prev).
* **Podpora otočných knobů**:
  * Otáčením knobu plynule měníte hlasitost přehrávání (nebo přetáčíte v časové ose).
  * Stiskem knobu okamžitě pozastavíte přehrávání nebo ztlumíte zvuk.

---

### 3. 🔋 Ajazz AJ179 PRO & Arctis Nova 5 Manager (`com.froyo.batterylevel.sdPlugin`)
Komplexní modul pro bezdrátové periferie a myš **Ajazz AJ179 PRO**:
* **Baterie**:
  * Sledování reálného nabití myši **Ajazz AJ179 PRO** (přes 2.4G přijímač i kabel) včetně ikony nabíjení.
  * Sledování baterie bezdrátového headsetu **SteelSeries Arctis Nova 5**.
* **Ovládání DPI myši**:
  * Tlačítko i otočný knob pro bleskovou změnu DPI profilu.
  * Zobrazuje aktuální DPI stupeň (např. `1/4`, `2/4`), hodnotu DPI v DPI rámečku a aktivní barevnou linku.
  * Implementován interní hardwarový mutex – otáčení knobem nereaguje se zpožděním a neblokuje komunikaci myši.
* **Přepínání profilů a vrstev (Layers 1–8)**:
  * Umožňuje přepínat mezi až 8 hardwarovými profily myši (Key Settings / Layers).
  * U tlačítka lze v nastavení omezit cyklus (např. přepínat pouze mezi profily 1 až 3). U knobu lze libovolně točit tam i zpět přes všechny profily.
* **Kombinovaný knob (Combo Knob)**:
  * Šetří fyzické knoby: otáčením knobu měníte DPI a stiskem přepnete režim na změnu profilu (Layer).

---

### 4. 🎧 SteelSeries Sonar Control (`com.loading.sonar-control.sdPlugin`)
Plnohodnotná integrace virtuálního zvukového mixu **SteelSeries GG Sonar** upravená pro Stream Dock AKP05E:
* **Hlasitost a kanály**: Nezávislé ovládání hlasitosti a Mute pro jednotlivé zvukové kanály (Master, Game, Chat, Media, Aux, Mic).
* **Plná podpora knobů konzole AKP05E**: Otáčením otočného knobu plynule měníte hlasitost daného kanálu, stiskem knobu přepínáte ztlumení (Mute) nebo cyklujete kanály.
* **ChatMix**: Plynulé vyvažování poměru hlasitosti hry a hlasové komunikace (Discord / TeamSpeak).
* **Přepínání výstupů a mikrofonů**: Rychlá volba aktivního audio výstupu (sluchátka / reproduktory) a mikrofonu přímo z tlačítka na ploše.
* **Režimy a scény**: Přepínání Classic vs Streamer módu a přepínání mixovacích profilů (scén).

---

### 5. 🕒 Datum & Čas CZ (`com.mirabox.streamdock.dateTime.sdPlugin`)
Kompletně přepracovaný oficiální plugin pro zobrazení hodin a data v češtině:
* **3 režimy zobrazení**:
  1. ⚡ **Rychlé předvolby**: Oblíbené české kombinace (Čas 24h + Datum `15:30:45 / 17. 11. 2026`, Den + Čas + Datum `Úterý / 15:30 / 17. 11.`, pouze čas, pouze datum, apod.).
  2. 🧱 **Skládání řádků (Line Composer)**: 3 nezávislé řádky, na které si můžete libovolně nakombinovat čas (HH:MM / HH:MM:SS), den slovně (`Úterý`) nebo zkratkou (`Út`), české datum (`17. 11. 2026` nebo `17. 11.`), měsíc slovně či rok.
  3. 🛠️ **Vlastní šablona**: Úplná svoboda zápisu textu s tokeny (`{TIME_HM}`, `{DATE_CZ}`, `{dddd}`, `{YYYY}`).
* **📏 Velikost písma a barva pro každý řádek zvlášť**:
  * U každého řádku lze nastavit vlastní velikost od **12 px** do **40 px** (např. velký 32px čas a decentní 14px datum).
  * Možnost zvolit barvu každého řádku (bílá, tyrkysová, zelená, žlutá, oranžová, červená, šedá).
* **Živý náhled**: V okně nastavení okamžitě vidíte reálný náhled tlačítka s tikajícím časem.

---

## 🛠️ Požadavky a kompatibilita
* Zařízení: **Ajazz AKP05E** (nebo jiné kompatibilní Stream Dock modely od MiraBoxu / HotSpotu).
* Software: **Stream Dock AJAZZ Global** (verze 3.x nebo novější).
* Operační systém: **Windows 10 / Windows 11 (64-bit)**.
* Není vyžadována žádná dodatečná instalace Node.js – Stream Dock využívá vlastní vestavěný engine.

---

## 📜 Licence
Všechny pluginy a úpravy jsou poskytovány jako open-source pod licencí MIT.
Vytvořeno a upraveno pro komunitu uživatelů Stream Dock AJAZZ AKP05E.
