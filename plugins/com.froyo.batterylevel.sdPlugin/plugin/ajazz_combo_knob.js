// Ajazz AJ179 PRO Combo Knob (DPI + Profile toggled by press).
// Press knob -> toggles active mode (DPI <-> Profile).
// Rotate knob -> adjusts whichever mode is active!

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

function drawComboKnobKey(mode = 'dpi', dpiInfo = {}, layerInfo = {}, switching = false, maxProfiles = 8) {
  const isDpi = mode === 'dpi';

  // DPI data with solid fallbacks
  const dpiVal = dpiInfo?.currentDpiValue || 2400;
  const rawColor = dpiInfo?.currentColor;
  const dpiColor = rawColor && rawColor !== '#000000' ? rawColor : '#ffff00';
  const rawTotal = dpiInfo?.activeStagesCount || (dpiInfo?.activeStages ? dpiInfo.activeStages.length : 0);
  const dpiTotalStages = Math.max(1, rawTotal || 6);
  const rawStage = dpiInfo?.activeStageIndex ?? 4;
  const dpiStageIdx = Math.max(0, Math.min(dpiTotalStages - 1, rawStage < 0 ? 0 : rawStage));

  // Profile / Layer data with solid fallbacks
  const limit = Math.max(2, Math.min(8, Number(maxProfiles) || layerInfo?.maxLayers || 8));
  const currentLayer = Math.max(1, Math.min(limit, layerInfo?.currentLayer || 1));
  const layerIdx = Math.max(0, Math.min(limit - 1, currentLayer - 1));
  const layerColor = LAYER_COLORS[layerIdx] || '#38bdf8';

  // Active color based on current mode
  const activeColor = isDpi ? dpiColor : layerColor;

  // Top Tabs: [  DPI  ] [ PROFILE ]
  // Active tab: High-contrast, bright border & background tint, bold white text
  // Inactive tab: Subtle dark slate container with muted label
  const dpiTabBg = isDpi ? dpiColor : '#1e222d';
  const dpiTabBgOpacity = isDpi ? '0.35' : '0.5';
  const dpiTabStroke = isDpi ? dpiColor : '#334155';
  const dpiTabStrokeWidth = isDpi ? '1.8' : '1';
  const dpiTabFg = isDpi ? '#ffffff' : '#64748b';
  const dpiTabFontWeight = isDpi ? '900' : '700';
  const dpiTabFontSize = isDpi ? '13' : '11';

  const profTabBg = !isDpi ? layerColor : '#1e222d';
  const profTabBgOpacity = !isDpi ? '0.35' : '0.5';
  const profTabStroke = !isDpi ? layerColor : '#334155';
  const profTabStrokeWidth = !isDpi ? '1.8' : '1';
  const profTabFg = !isDpi ? '#ffffff' : '#64748b';
  const profTabFontWeight = !isDpi ? '900' : '700';
  const profTabFontSize = !isDpi ? '13' : '11';

  const switchPulse = switching
    ? `<circle cx="134" cy="8" r="4.5" fill="#38bdf8"/>`
    : '';

  let bodySvg = '';
  if (isDpi) {
    // Stage dots at bottom
    let dotsSvg = '';
    if (dpiTotalStages > 1 && dpiTotalStages <= 8) {
      const spacing = dpiTotalStages <= 4 ? 20 : (dpiTotalStages <= 6 ? 16 : 13);
      const startX = 72 - ((dpiTotalStages - 1) * spacing) / 2;
      for (let i = 0; i < dpiTotalStages; i++) {
        const cx = startX + i * spacing;
        const isActive = i === dpiStageIdx;
        const fill = isActive ? dpiColor : '#334155';
        const r = isActive ? 5 : 3;
        dotsSvg += `<circle cx="${cx}" cy="126" r="${r}" fill="${fill}"/>`;
      }
    }

    bodySvg =
      // Stage badge pill (e.g. STAGE 5/6)
      `<rect x="42" y="49" width="60" height="20" rx="6" fill="${dpiColor}" fill-opacity="0.25" stroke="${dpiColor}" stroke-width="1.2"/>` +
      `<text x="72" y="64" font-family="Segoe UI,Arial,sans-serif" font-size="12" font-weight="800" fill="#ffffff" text-anchor="middle">STAGE ${dpiStageIdx + 1}/${dpiTotalStages}</text>` +
      // Main DPI value: large, bright white with black outline
      `<text x="72" y="97" font-family="Segoe UI,Arial,sans-serif" font-size="34" ` +
      `font-weight="800" text-anchor="middle" fill="#ffffff" stroke="#000000" stroke-width="2.5" paint-order="stroke fill">${dpiVal}</text>` +
      // Glow bar under DPI value
      `<rect x="22" y="107" width="100" height="4.5" rx="2.2" fill="${dpiColor}"/>` +
      dotsSvg;
  } else {
    // Layer dots at bottom (tailored to limit)
    let dotsSvg = '';
    const spacing = limit <= 4 ? 20 : (limit <= 6 ? 16 : 14);
    const startX = 72 - ((limit - 1) * spacing) / 2;
    for (let i = 0; i < limit; i++) {
      const cx = startX + i * spacing;
      const isActive = i === layerIdx;
      const fill = isActive ? layerColor : '#334155';
      const r = isActive ? 5 : 3;
      dotsSvg += `<circle cx="${cx}" cy="126" r="${r}" fill="${fill}"/>`;
    }

    bodySvg =
      // Layer badge pill (e.g. LAYER 1/3)
      `<rect x="42" y="49" width="60" height="20" rx="6" fill="${layerColor}" fill-opacity="0.25" stroke="${layerColor}" stroke-width="1.2"/>` +
      `<text x="72" y="64" font-family="Segoe UI,Arial,sans-serif" font-size="12" font-weight="800" fill="#ffffff" text-anchor="middle">LAYER ${currentLayer}/${limit}</text>` +
      // Main Layer value: large, bright white with black outline
      `<text x="72" y="99" font-family="Segoe UI,Arial,sans-serif" font-size="38" ` +
      `font-weight="800" text-anchor="middle" fill="#ffffff" stroke="#000000" stroke-width="3" paint-order="stroke fill">${currentLayer}</text>` +
      // Glow bar under Layer value
      `<rect x="36" y="107" width="72" height="4.5" rx="2.2" fill="${layerColor}"/>` +
      dotsSvg;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" fill="#101014"/>` +
    // Top Tabs Bar
    `<g transform="translate(10 10)">` +
    // Tab 1: DPI
    `<rect x="0" y="0" width="58" height="26" rx="6" fill="${dpiTabBg}" fill-opacity="${dpiTabBgOpacity}" stroke="${dpiTabStroke}" stroke-width="${dpiTabStrokeWidth}"/>` +
    `<text x="29" y="18" font-family="Segoe UI,Arial,sans-serif" font-size="${dpiTabFontSize}" font-weight="${dpiTabFontWeight}" fill="${dpiTabFg}" text-anchor="middle">DPI</text>` +
    // Tab 2: PROFILE
    `<rect x="64" y="0" width="60" height="26" rx="6" fill="${profTabBg}" fill-opacity="${profTabBgOpacity}" stroke="${profTabStroke}" stroke-width="${profTabStrokeWidth}"/>` +
    `<text x="94" y="18" font-family="Segoe UI,Arial,sans-serif" font-size="${profTabFontSize}" font-weight="${profTabFontWeight}" fill="${profTabFg}" text-anchor="middle">PROFILE</text>` +
    `</g>` +
    `<line x1="10" y1="42" x2="134" y2="42" stroke="#262a36" stroke-width="1.2"/>` +
    bodySvg +
    switchPulse +
    `</svg>`
  );
}

module.exports = {
  drawComboKnobKey,
  LAYER_COLORS,
};
