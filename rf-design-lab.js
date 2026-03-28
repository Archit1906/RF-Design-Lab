/* ============================================================
       GLOBALS & CHART REFS
    ============================================================ */
let vswrChartInst = null, rlChartInst = null, gammaChartInst = null, matchChartInst = null;
let waveAnimId = null, wavePhase = 0, waveRunning = false;

// Phasor drag state
let phasorDragging = false;
let phasorHistory = [];
let abRef = null;

// Wave termination
let wTermMode = 'matched';

// Sweep saved overlays + marker
let savedSweeps = [];
const SWEEP_COLORS = ['#fb923c', '#a78bfa', '#4ade80'];
let lastSweepData = null;
let markerPos = 0.5;

const CHART_DEFAULTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { display: false }, tooltip: {
      backgroundColor: '#18181b', borderColor: '#3f3f46', borderWidth: 1,
      titleColor: '#fafafa', bodyColor: '#a1a1aa',
      titleFont: { family: "'IBM Plex Mono',monospace", size: 11 },
      bodyFont: { family: "'IBM Plex Mono',monospace", size: 11 },
    }
  },
  scales: {
    x: {
      ticks: { color: '#52525b', font: { family: "'IBM Plex Mono',monospace", size: 10 } },
      grid: { color: '#27272a' }, border: { color: '#27272a' }
    },
    y: {
      ticks: { color: '#52525b', font: { family: "'IBM Plex Mono',monospace", size: 10 } },
      grid: { color: '#27272a' }, border: { color: '#27272a' }
    }
  }
};

/* ============================================================
   NAVIGATION
============================================================ */
function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  event.currentTarget.classList.add('active');
  if (id === 'sweep') runSweep();
  if (id === 'smith') { document.getElementById('smithSweepFields').style.display = document.getElementById('smithSweep').checked ? 'block' : 'none'; updateSmith(); }
  if (id === 'learn') setLearnLevel(0, document.querySelector('.learn-level-btn'));
  if (id === 'match') calcMatch();
  if (id === 'wave') { updateWaveInfo(); if (waveRunning) startWave(); }
  if (id === 'power') calcPowerMetrics();
}

/* ============================================================
   PANEL 1: IMPEDANCE MATH
============================================================ */
function syncInput(k) {
  const s = document.getElementById(k + 'Slider'), n = document.getElementById(k + 'Num'), v = document.getElementById(k + 'Val');
  n.value = s.value; if (v) v.textContent = (k === 'x' && s.value >= 0 ? '+' : '') + s.value;
}
function syncSlider(k) {
  const s = document.getElementById(k + 'Slider'), n = document.getElementById(k + 'Num'), v = document.getElementById(k + 'Val');
  const val = parseFloat(n.value) || 0;
  s.value = Math.min(Math.max(val, parseFloat(s.min)), parseFloat(s.max));
  if (v) v.textContent = (k === 'x' && val >= 0 ? '+' : '') + val;
}

function calcImpedance() {
  const R = parseFloat(document.getElementById('rNum').value) || 0;
  const X = parseFloat(document.getElementById('xNum').value) || 0;
  const Z0 = parseFloat(document.getElementById('z0Num').value) || 50;

  // Complex Gamma: (ZL-Z0)/(ZL+Z0)
  const numR = R - Z0, numI = X;
  const denR = R + Z0, denI = X;
  const denMag2 = denR * denR + denI * denI;
  const gR = (numR * denR + numI * denI) / denMag2;
  const gI = (numI * denR - numR * denI) / denMag2;
  const gamma = Math.sqrt(gR * gR + gI * gI);
  const angleRad = Math.atan2(gI, gR);
  const angleDeg = (angleRad * 180 / Math.PI).toFixed(1);

  const vswr = gamma >= 1 ? 999 : (1 + gamma) / (1 - gamma);
  const rl = gamma < 0.0001 ? 999 : -20 * Math.log10(gamma);
  const ml = gamma < 0.0001 ? 0 : -10 * Math.log10(1 - gamma * gamma);
  const power = (1 - gamma * gamma) * 100;
  const zlMag = Math.sqrt(R * R + X * X);

  // Color coding
  const gc = gamma < 0.1 ? 'good' : gamma < 0.333 ? 'warn' : 'bad';

  document.getElementById('gammaVal').textContent = gamma.toFixed(4);
  document.getElementById('gammaVal').className = 'metric-val ' + gc;
  document.getElementById('gammaAngle').textContent = '∠' + angleDeg + '°';
  document.getElementById('vswrVal').textContent = vswr > 100 ? '>100' : vswr.toFixed(3);
  document.getElementById('vswrVal').className = 'metric-val ' + (vswr < 1.5 ? 'good' : vswr < 2 ? 'warn' : 'bad');
  document.getElementById('rlVal').textContent = rl > 99 ? '∞' : rl.toFixed(2) + ' dB';
  document.getElementById('rlVal').className = 'metric-val ' + (rl > 20 ? 'good' : rl > 10 ? 'warn' : 'bad');
  document.getElementById('mlVal').textContent = ml.toFixed(3) + ' dB';
  document.getElementById('powerVal').textContent = power.toFixed(1) + '%';
  document.getElementById('powerVal').className = 'metric-val ' + (power > 95 ? 'good' : power > 75 ? 'warn' : 'bad');
  document.getElementById('zlMagVal').textContent = zlMag.toFixed(2) + ' Ω';

  // VSWR Gauge
  if (typeof drawVswrGauge === 'function') drawVswrGauge(vswr);

  document.getElementById('powerBar').style.width = power.toFixed(1) + '%';

  // Status badge
  const st = document.getElementById('matchStatus');
  if (vswr < 1.5) { st.textContent = 'GOOD MATCH'; st.className = 'status good'; }
  else if (vswr < 2) { st.textContent = 'ACCEPTABLE'; st.className = 'status warn'; }
  else { st.textContent = 'MISMATCH'; st.className = 'status bad'; }

  // Update RF Assistant Context
  window.vswr_state = {
    gamma: gamma.toFixed(3),
    vswr: vswr > 100 ? '>100:1' : vswr.toFixed(2) + ':1',
    pFwd: power.toFixed(1) + ' %',
    pRef: (100 - power).toFixed(1) + ' %',
    rl: rl > 99 ? '∞ dB' : rl.toFixed(2) + ' dB',
    ml: ml.toFixed(3) + ' dB',
    zL: R.toFixed(1) + (X >= 0 ? '+j' : '-j') + Math.abs(X).toFixed(1) + ' Ω',
    z0: Z0 + ' Ω',
    severity: vswr
  };
  if (window.rf_assistant) window.rf_assistant.updateContextData();


  // (Power Metrics moved to standalone tab function)

  // ==== L-NETWORK SOLVER (Prompt 3) ====
  const solverTop = document.getElementById('solverTopology');
  if (solverTop) {
    const f_MHz = parseFloat(document.getElementById('diagFreq').value) || 2400;
    const w = 2 * Math.PI * f_MHz * 1e6;

    function formatReactance(X_val) {
      if (Math.abs(X_val) < 0.01) return { comp: "None", val: "0" };
      if (X_val > 0) {
        let L = X_val / w; // H
        if (L < 1e-6) return { comp: "Inductor", val: (L * 1e9).toFixed(2) + " nH" };
        return { comp: "Inductor", val: (L * 1e6).toFixed(2) + " μH" };
      } else {
        let C = 1 / (w * Math.abs(X_val)); // F
        if (C < 1e-9) return { comp: "Capacitor", val: (C * 1e12).toFixed(2) + " pF" };
        return { comp: "Capacitor", val: (C * 1e9).toFixed(2) + " nF" };
      }
    }

    if (Math.abs(R - 50) < 0.1 && Math.abs(X) < 0.1) {
      solverTop.textContent = "Already Matched";
      document.getElementById('solverQ').textContent = "0";
      document.getElementById('solverSeriesX').textContent = "0 Ω";
      document.getElementById('solverSeriesComp').textContent = "Direct short";
      document.getElementById('solverSeriesName').textContent = "Series Element";
      document.getElementById('solverShuntX').textContent = "∞ Ω";
      document.getElementById('solverShuntComp').textContent = "Open circuit";
      document.getElementById('solverShuntName').textContent = "Shunt Element";
      document.getElementById('solverSchematic').innerHTML = `<div style="text-align:center;color:var(--green)">Load is already 50Ω.<br>No network needed!</div>`;
    } else {
      let Q = 0, Xs_val = 0, Xp_val = 0, topoStr = "", ascii = "";
      let G = R / (R * R + X * X);
      let B_L = -X / (R * R + X * X);
      let v1 = G / 50 - G * G;
      let v2 = 50 * R - R * R;

      if (R > 50 && v1 >= 0) {
        topoStr = "Low-pass L (Shunt on Load)";
        let B_p_total = Math.sqrt(v1);
        let B_p = B_p_total - B_L;
        Xp_val = B_p === 0 ? 999999 : -1 / B_p;
        let X_series_rem = -B_p_total / (G * G + B_p_total * B_p_total);
        Xs_val = -X_series_rem;
        Q = B_p_total / G;
        ascii = "Source    [Series]       Load\n (50Ω) ──+─[      ]─+── (R+jX)\n         |          |\n      [Shunt]       |\n         |          |\n        GND        GND";
      } else if (v2 >= 0) {
        topoStr = "Low-pass L (Series on Load)";
        let X_total = Math.sqrt(v2);
        Xs_val = X_total - X;
        Xp_val = - (50 * R) / X_total;
        Q = X_total / R;
        ascii = "Source          [Series] Load\n (50Ω) ──+──────[      ]──+──\n         |                |\n      [Shunt]         (R+jX)\n         |                |\n        GND              GND";
      } else {
        topoStr = "Complex match fallback";
      }

      solverTop.textContent = topoStr;
      document.getElementById('solverQ').textContent = Q.toFixed(2);

      let s_info = formatReactance(Xs_val);
      document.getElementById('solverSeriesName').textContent = `Series ${s_info.comp}`;
      document.getElementById('solverSeriesX').textContent = `${(Xs_val > 0 ? '+' : '')}${Xs_val.toFixed(2)} Ω`;
      document.getElementById('solverSeriesComp').textContent = s_info.val;

      let p_info = formatReactance(Xp_val);
      document.getElementById('solverShuntName').textContent = `Shunt ${p_info.comp}`;
      document.getElementById('solverShuntX').textContent = `${(Xp_val > 0 ? '+' : '')}${Xp_val.toFixed(2)} Ω`;
      document.getElementById('solverShuntComp').textContent = p_info.val;

      document.getElementById('solverSchematic').textContent = ascii;
    }
  }

  drawPhasor(R, X, Z0);
  aiDiagnose(R, X, Z0, gamma, vswr, rl);
  if (abRef) updateABDisplay();

  // Global Smith Chart Mapping (Feature 4)
  const elNr = document.getElementById('sNr');
  const elNx = document.getElementById('sNx');
  if (elNr && elNx && !window.smithIsDragging) {
    elNr.value = Math.min(Math.max(R / Z0 * 100, 0), 500);
    elNx.value = Math.min(Math.max(X / Z0 * 100, -200), 200);
    document.getElementById('sNrVal').textContent = (elNr.value / 100).toFixed(2);
    document.getElementById('sNxVal').textContent = (elNx.value >= 0 ? '+' : '') + (elNx.value / 100).toFixed(2);
    if (typeof updateSmith === 'function') updateSmith();
  }

  // Global Glow (Feature 3)
  const shellEl = document.querySelector('.shell');
  if (shellEl && document.getElementById('panel-impedance').classList.contains('active')) {
    shellEl.classList.remove('glow-safe', 'glow-warn', 'glow-danger');
    if (vswr < 1.5) shellEl.classList.add('glow-safe');
    else if (vswr < 2.5) shellEl.classList.add('glow-warn');
    else if (vswr >= 3.0) shellEl.classList.add('glow-danger');
  }
}

/* ============================================================
   POWER METRICS DASHBOARD
============================================================ */
let pmZlMode = 'resistive';
let pmFreeze = false;
let pmWavePhase = 0;
let pmWaveAnimId = null;
let pmLastGammaMag = 0;
let pmLastAngleRad = 0;
let pmPowerUnit = 'W';

function togglePmPowerUnit() {
  pmPowerUnit = (pmPowerUnit === 'W') ? 'dBm' : 'W';
  calcPowerMetrics();
}

function syncPmControls() {
  const pSlider = document.getElementById('pmSrcPowSlider');
  const zlSlider = document.getElementById('pmZlSlider');
  const z0Slider = document.getElementById('pmZ0Slider');

  const pVal = parseInt(pSlider.value);
  const dbm = (pVal > 0) ? (10 * Math.log10(pVal * 1000)).toFixed(1) : 0;
  document.getElementById('pmSrcPowDisplay').textContent = pVal + ' W / ' + dbm + ' dBm';

  document.getElementById('pmZlDisplay').textContent = zlSlider.value + ' Ω';
  document.getElementById('pmZ0Display').textContent = z0Slider.value + ' Ω';

  calcPowerMetrics();
}

function setPmZlMode(mode) {
  pmZlMode = mode;
  ['pmBtnRes', 'pmBtnCap', 'pmBtnInd', 'pmBtnOpen', 'pmBtnShort'].forEach(id => document.getElementById(id).classList.remove('active'));
  const map = { 'resistive': 'pmBtnRes', 'capacitive': 'pmBtnCap', 'inductive': 'pmBtnInd', 'open': 'pmBtnOpen', 'short': 'pmBtnShort' };
  document.getElementById(map[mode]).classList.add('active');

  const zlSlider = document.getElementById('pmZlSlider');
  if (mode === 'open' || mode === 'short') { zlSlider.disabled = true; zlSlider.style.opacity = '0.5'; }
  else { zlSlider.disabled = false; zlSlider.style.opacity = '1'; }

  syncPmControls();
}

function togglePmFreeze() {
  pmFreeze = !pmFreeze;
  document.getElementById('pmFreezeBtn').style.color = pmFreeze ? 'var(--red)' : '';
}

function resetPmControls() {
  document.getElementById('pmSrcPowSlider').value = 100;
  document.getElementById('pmZlSlider').value = 50;
  document.getElementById('pmZ0Slider').value = 50;
  setPmZlMode('resistive');
}

function calcPowerMetrics() {
  const pSrc = parseFloat(document.getElementById('pmSrcPowSlider').value);
  const zlVal = parseFloat(document.getElementById('pmZlSlider').value);
  const Z0 = parseFloat(document.getElementById('pmZ0Slider').value);

  let R = 50, X = 0;
  if (pmZlMode === 'resistive') { R = zlVal; X = 0; }
  else if (pmZlMode === 'capacitive') { R = 50; X = -zlVal; }
  else if (pmZlMode === 'inductive') { R = 50; X = zlVal; }
  else if (pmZlMode === 'open') { R = 1e6; X = 0; }
  else if (pmZlMode === 'short') { R = 0; X = 0; }

  const numR = R - Z0, numI = X;
  const denR = R + Z0, denI = X;
  const denMag2 = denR * denR + denI * denI;
  const gR = (numR * denR + numI * denI) / denMag2;
  const gI = (numI * denR - numR * denI) / denMag2;
  const gammaMag = Math.sqrt(gR * gR + gI * gI);
  const angleRad = Math.atan2(gI, gR);
  const angleDeg = (angleRad * 180 / Math.PI);

  pmLastGammaMag = gammaMag;
  pmLastAngleRad = angleRad;

  const vswr = gammaMag >= 0.999 ? 999 : (1 + gammaMag) / (1 - gammaMag);
  const prefRatio = gammaMag * gammaMag;
  const pfwdRatio = 1 - prefRatio;

  const pRef = pSrc * prefRatio;
  const pFwd = pSrc; // Fwd power from source
  const pTrans = pSrc * pfwdRatio; // Power delivered to load

  const rl = gammaMag < 0.0001 ? 999 : -20 * Math.log10(gammaMag);
  const ml = gammaMag < 0.0001 ? 0 : -10 * Math.log10(pfwdRatio);

  // Update Telemetry Table
  const el = (id) => document.getElementById(id);

  const formatPower = (w) => {
    if (w <= 0) return { val: '0.0', unit: pmPowerUnit };
    if (pmPowerUnit === 'dBm') return { val: (10 * Math.log10(w * 1000)).toFixed(1), unit: ' dBm' };
    return { val: w.toFixed(1), unit: ' W' };
  };

  if (el('pmT_gamma')) el('pmT_gamma').textContent = gammaMag.toFixed(3);
  if (el('pmT_vswr')) el('pmT_vswr').textContent = vswr > 100 ? '∞' : vswr.toFixed(3);

  if (el('pmT_pfwd')) { let fw = formatPower(pFwd); el('pmT_pfwd').textContent = fw.val; el('pmT_pfwd_u').textContent = fw.unit; }
  if (el('pmT_pref')) { let rw = formatPower(pRef); el('pmT_pref').textContent = rw.val; el('pmT_pref_u').textContent = rw.unit; }
  if (el('pmT_ptrans')) { let tw = formatPower(pTrans); el('pmT_ptrans').textContent = tw.val; el('pmT_ptrans_u').textContent = tw.unit; }

  if (el('pmT_rl')) el('pmT_rl').textContent = rl > 99 ? '∞' : rl.toFixed(2);
  if (el('pmT_ml')) el('pmT_ml').textContent = ml.toFixed(2);

  // SVG Power Flow
  if (el('pmPowerFlowRef')) {
    let maxW = 20; // max stroke width for 100% reflection
    let rW = Math.max(prefRatio * maxW, 0);
    if (prefRatio < 0.005) rW = 0;
    el('pmPowerFlowRef').setAttribute('stroke-width', rW.toFixed(1));
    if (prefRatio > 0.02) {
      el('pmPowerFlowRefText').setAttribute('opacity', '1');
    } else {
      el('pmPowerFlowRefText').setAttribute('opacity', '0');
    }
  }

  // Status message
  let msg = '';
  if (vswr < 1.1) msg = "Perfect impedance match. 100% of power reaches the load. No reflected energy. Ideal for all RF systems.";
  else if (vswr < 1.5) msg = "Excellent match. Minimal reflected power. Safe for all transmitters and optimized for high efficiency.";
  else if (vswr < 2.0) msg = "Acceptable match for most systems (" + (prefRatio * 100).toFixed(1) + "% power reflected). Transmitter safety protection unlikely to trigger.";
  else if (vswr < 3.0) msg = "Marginal match. Significant power loss (" + (prefRatio * 100).toFixed(1) + "%). Transmitter may start folding back power to protect internals.";
  else msg = "CRITICAL REFLECTION: Risk of PA Thermal Failure. " + (prefRatio * 100).toFixed(1) + "% power reflected. Do not transmit.";

  const statusEl = document.getElementById('pmT_status');
  const shellEl = document.querySelector('.shell');
  if (shellEl) {
    shellEl.classList.remove('glow-safe', 'glow-warn', 'glow-danger');
  }
  if (statusEl) {
    statusEl.textContent = msg;
    if (vswr < 1.5) {
      statusEl.style.borderColor = '#4ade80'; statusEl.style.background = 'rgba(74,222,128,0.05)'; statusEl.style.color = '#4ade80'; statusEl.style.borderLeft = '3px solid #4ade80';
      if (shellEl) shellEl.classList.add('glow-safe');
    }
    else if (vswr < 2.0) {
      statusEl.style.borderColor = '#fbbf24'; statusEl.style.background = 'rgba(251,191,36,0.05)'; statusEl.style.color = '#fbbf24'; statusEl.style.borderLeft = '3px solid #fbbf24';
      if (shellEl) shellEl.classList.add('glow-warn');
    }
    else if (vswr >= 3.0) {
      statusEl.style.borderColor = '#f87171'; statusEl.style.background = 'rgba(248,113,113,0.05)'; statusEl.style.color = '#f87171'; statusEl.style.borderLeft = '3px solid #f87171';
      if (shellEl) shellEl.classList.add('glow-danger');
    } else {
      statusEl.style.borderColor = '#f87171'; statusEl.style.background = 'rgba(248,113,113,0.05)'; statusEl.style.color = '#f87171'; statusEl.style.borderLeft = '3px solid #f87171';
    }
  }

  // Labels for waveform
  if (el('pmGammaLabel')) el('pmGammaLabel').textContent = '|Γ| ≈ ' + gammaMag.toFixed(2);
  if (el('pmPhaseLabel')) el('pmPhaseLabel').textContent = 'φ ∠ ' + angleDeg.toFixed(0) + '°';

  // Draw objects
  drawPmMeter(vswr, pFwd, pRef, pSrc);

  if (!pmWaveAnimId) {
    pmWaveAnimLoop();
  }
}

function pmWaveAnimLoop() {
  if (!pmFreeze) pmWavePhase += 0.05;
  drawPmWave(pmLastGammaMag, pmLastAngleRad);
  pmWaveAnimId = requestAnimationFrame(pmWaveAnimLoop);
}

function drawPmMeter(vswrVal, pFwd, pRef, maxScale) {
  const cv = document.getElementById('pmMeterCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H - 35;
  const rOuter = 160, rInner = 145;

  ctx.lineWidth = rOuter - rInner;
  ctx.lineCap = 'butt';
  const rMid = (rOuter + rInner) / 2;

  function getVswrAngle(v) {
    if (v <= 1) return Math.PI;
    if (v <= 1.5) return Math.PI + ((v - 1) / 0.5) * (Math.PI / 4);
    if (v <= 2.0) return Math.PI + Math.PI / 4 + ((v - 1.5) / 0.5) * (Math.PI / 5);
    if (v <= 3.0) return Math.PI + Math.PI / 4 + Math.PI / 5 + ((v - 2.0) / 1.0) * (Math.PI / 5);
    if (v <= 10) return Math.PI + Math.PI / 4 + 2 * Math.PI / 5 + ((v - 3.0) / 7.0) * (Math.PI / 5);
    return 2 * Math.PI;
  }

  const a1 = Math.PI;
  const a15 = getVswrAngle(1.5);
  const a20 = getVswrAngle(2.0);
  const a30 = getVswrAngle(3.0);
  const aEnd = 2 * Math.PI;

  ctx.beginPath(); ctx.arc(cx, cy, rMid, a1, a15); ctx.strokeStyle = '#4ade80'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, rMid, a15, a20); ctx.strokeStyle = '#86efac'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, rMid, a20, a30); ctx.strokeStyle = '#fbbf24'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, rMid, a30, aEnd); ctx.strokeStyle = '#f87171'; ctx.stroke();

  const ticks = [1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 999];
  ctx.fillStyle = '#a1a1aa';
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 2; ctx.strokeStyle = '#3f3f46';

  ticks.forEach(t => {
    const ang = getVswrAngle(t);
    ctx.beginPath();
    ctx.moveTo(cx + (rInner - 5) * Math.cos(ang), cy + (rInner - 5) * Math.sin(ang));
    ctx.lineTo(cx + (rOuter + 5) * Math.cos(ang), cy + (rOuter + 5) * Math.sin(ang));
    ctx.stroke();
    let label = t > 100 ? '∞' : t.toString();
    ctx.fillText(label, cx + (rOuter + 18) * Math.cos(ang), cy + (rOuter + 18) * Math.sin(ang));
  });

  let pFpct = Math.min(pFwd / Math.max(maxScale, 1), 1);
  let pRpct = Math.min(pRef / Math.max(maxScale, 1), 1);

  const aFwd = Math.PI + pFpct * Math.PI * 0.8;
  const aRef = 2 * Math.PI - pRpct * Math.PI * 0.8;

  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + rOuter * Math.cos(aFwd), cy + rOuter * Math.sin(aFwd));
  ctx.lineWidth = 3; ctx.strokeStyle = '#06b6d4'; ctx.stroke();

  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + rOuter * Math.cos(aRef), cy + rOuter * Math.sin(aRef));
  ctx.lineWidth = 3; ctx.strokeStyle = '#f43f5e'; ctx.stroke();

  ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fillStyle = '#18181b'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#fafafa'; ctx.stroke();

  ctx.font = 'bold 24px "IBM Plex Mono", monospace';
  ctx.fillStyle = '#4ade80';
  if (vswrVal > 2) ctx.fillStyle = '#fbbf24';
  if (vswrVal > 3) ctx.fillStyle = '#f87171';
  let displayVswr = vswrVal > 100 ? '∞' : vswrVal.toFixed(2);
  ctx.fillText('VSWR ' + displayVswr, cx, cy + 25);

  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillStyle = '#06b6d4'; ctx.fillText('FWD', cx - 30, cy + 45);
  ctx.fillStyle = '#f43f5e'; ctx.fillText('REF', cx + 30, cy + 45);
}

function drawPmWave(gammaMag, angleRad) {
  const cv = document.getElementById('pmWaveCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);

  const cy = H / 2;
  const amp = H * 0.35;
  const freq = 4 * Math.PI / W;

  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy);
  ctx.strokeStyle = '#27272a'; ctx.lineWidth = 1; ctx.stroke();

  ctx.lineWidth = 2;

  ctx.beginPath();
  for (let x = 0; x <= W; x += 2) {
    let y = cy - Math.sin(x * freq - pmWavePhase) * amp;
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.4)'; ctx.stroke();

  ctx.beginPath();
  for (let x = 0; x <= W; x += 2) {
    let y = cy - gammaMag * Math.sin(x * freq + pmWavePhase + angleRad) * amp;
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(248, 113, 113, 0.4)'; ctx.stroke();

  ctx.beginPath();
  for (let x = 0; x <= W; x += 2) {
    let vInc = Math.sin(x * freq - pmWavePhase);
    let vRef = gammaMag * Math.sin(x * freq + pmWavePhase + angleRad);
    let y = cy - (vInc + vRef) * amp;
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#fafafa'; ctx.shadowColor = '#fafafa'; ctx.shadowBlur = 4;
  ctx.stroke();
  ctx.shadowBlur = 0;
}



function drawPhasor(R, X, Z0) {
  const cv = document.getElementById('phasorCanvas');
  const ctx = cv.getContext('2d');
  const W = cv.offsetWidth || 500, H = 260;
  cv.width = W; cv.height = H;
  ctx.clearRect(0, 0, W, H);

  const ox = W * 0.5, oy = H * 0.5;
  const maxVal = Math.max(Math.sqrt(R * R + X * X), Z0, 1);
  const scale = Math.min(W, H) * 0.38 / maxVal;

  // Grid rings
  [1, 2, 3].forEach(n => {
    ctx.beginPath(); ctx.arc(ox, oy, n * maxVal * scale * 0.33, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(39,39,42,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  });

  // Axes
  ctx.strokeStyle = '#27272a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke();

  // Z0 circle (dashed)
  ctx.strokeStyle = 'rgba(34,211,238,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.arc(ox, oy, Z0 * scale, 0, 2 * Math.PI); ctx.stroke();
  ctx.setLineDash([]);

  // History trail
  phasorHistory.forEach((h, i) => {
    const alpha = 0.15 + (i / phasorHistory.length) * 0.35;
    const hex = ox + h.R * scale, hey = oy - h.X * scale;
    ctx.beginPath(); ctx.arc(hex, hey, 4, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(34,211,238,${alpha})`; ctx.fill();
    ctx.fillStyle = `rgba(161,161,170,${alpha * 0.8})`;
    ctx.font = '9px IBM Plex Mono';
    ctx.fillText('V' + h.vswr.toFixed(1), hex + 5, hey - 4);
  });

  // A/B reference ghost
  if (abRef) {
    const ax = ox + abRef.R * scale, ay = oy - abRef.X * scale;
    ctx.strokeStyle = 'rgba(251,191,36,0.4)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(ax, ay, 5, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(251,191,36,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(251,191,36,0.5)'; ctx.font = '9px IBM Plex Mono';
    ctx.fillText('A', ax + 6, ay - 4);
  }

  // ZL vector
  const ex = ox + R * scale, ey = oy - X * scale;
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
  const angle = Math.atan2(ey - oy, ex - ox);
  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - 10 * Math.cos(angle - 0.4), ey - 10 * Math.sin(angle - 0.4));
  ctx.lineTo(ex - 10 * Math.cos(angle + 0.4), ey - 10 * Math.sin(angle + 0.4));
  ctx.closePath(); ctx.fill();

  // Drag handle ring
  ctx.beginPath(); ctx.arc(ex, ey, 10, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(34,211,238,0.3)'; ctx.lineWidth = 1; ctx.stroke();

  // Z0 dot
  ctx.fillStyle = 'rgba(34,211,238,0.4)'; ctx.beginPath(); ctx.arc(ox + Z0 * scale, oy, 4, 0, 2 * Math.PI); ctx.fill();

  // Labels
  ctx.fillStyle = '#52525b'; ctx.font = '10px IBM Plex Mono'; ctx.textAlign = 'left';
  ctx.fillText('R', W - 22, oy - 5);
  ctx.fillText('jX', ox + 5, 12);
  ctx.fillStyle = '#22d3ee'; ctx.font = '11px IBM Plex Mono';
  const zlabel = 'ZL=' + R.toFixed(0) + (X >= 0 ? '+j' : '-j') + Math.abs(X).toFixed(0);
  const lx = Math.min(ex + 6, W - zlabel.length * 7);
  ctx.fillText(zlabel, lx, Math.max(ey - 8, 12));
  ctx.fillStyle = 'rgba(34,211,238,0.5)';
  ctx.fillText('Z₀=' + Z0 + 'Ω', Math.min(ox + Z0 * scale + 4, W - 60), oy + 14);

  // Reactance component hint
  updateCompHint(R, X);
}

function updateCompHint(R, X) {
  const f = parseFloat(document.getElementById('diagFreq').value) * 1e6;
  const hint = document.getElementById('compHint');
  if (Math.abs(X) < 0.5) { hint.style.display = 'none'; return; }
  hint.style.display = 'block';
  if (X > 0) {
    const L = (X / (2 * Math.PI * f)) * 1e9;
    hint.innerHTML = 'Inductive: X=+' + X.toFixed(1) + 'Ω → <span style="color:var(--acc)">L = ' + L.toFixed(2) + ' nH</span> at ' + (f / 1e6).toFixed(0) + ' MHz';
  } else {
    const C = (1 / (2 * Math.PI * f * Math.abs(X))) * 1e12;
    hint.innerHTML = 'Capacitive: X=' + X.toFixed(1) + 'Ω → <span style="color:var(--acc)">C = ' + C.toFixed(2) + ' pF</span> at ' + (f / 1e6).toFixed(0) + ' MHz';
  }
}

// ── Phasor canvas drag interaction ──
function initPhasorDrag() {
  const cv = document.getElementById('phasorCanvas');
  function getPos(e) {
    const rect = cv.getBoundingClientRect();
    const scaleX = cv.width / rect.width;
    const scaleY = cv.height / rect.height;
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return { x: cx * scaleX, y: cy * scaleY };
  }
  function applyPos(x, y) {
    const W = cv.width, H = cv.height, ox = W * 0.5, oy = H * 0.5;
    const R0 = parseFloat(document.getElementById('rNum').value) || 75;
    const X0 = parseFloat(document.getElementById('xNum').value) || 0;
    const Z0 = parseFloat(document.getElementById('z0Num').value) || 50;
    const maxVal = Math.max(Math.sqrt(R0 * R0 + X0 * X0), Z0, 1);
    const scale = Math.min(W, H) * 0.38 / maxVal;
    let newR = Math.round((x - ox) / scale);
    let newX = Math.round(-(y - oy) / scale);
    newR = Math.max(1, newR);
    // push history before updating
    const prevR = parseFloat(document.getElementById('rNum').value) || 1;
    const prevX = parseFloat(document.getElementById('xNum').value) || 0;
    const prevZ0 = parseFloat(document.getElementById('z0Num').value) || 50;
    const nR = prevR - prevZ0, nI = prevX, dR = prevR + prevZ0, dI = prevX;
    const d2 = dR * dR + dI * dI;
    const gR = (nR * dR + nI * dI) / d2, gI = (nI * dR - nR * dI) / d2;
    const g = Math.sqrt(gR * gR + gI * gI);
    const v = g >= 1 ? 99 : (1 + g) / (1 - g);
    if (phasorHistory.length === 0 || Math.abs(phasorHistory[phasorHistory.length - 1].R - prevR) > 5 || Math.abs(phasorHistory[phasorHistory.length - 1].X - prevX) > 5) {
      phasorHistory.push({ R: prevR, X: prevX, vswr: v });
      if (phasorHistory.length > 6) phasorHistory.shift();
    }
    // update inputs
    document.getElementById('rNum').value = newR;
    document.getElementById('rSlider').value = Math.min(newR, 300);
    document.getElementById('rVal').textContent = newR;
    document.getElementById('xNum').value = newX;
    document.getElementById('xSlider').value = Math.min(Math.max(newX, -200), 200);
    document.getElementById('xVal').textContent = (newX >= 0 ? '+' : '') + newX;
    calcImpedance();
  }
  cv.addEventListener('mousedown', e => { phasorDragging = true; applyPos(...Object.values(getPos(e))); });
  cv.addEventListener('mousemove', e => { if (phasorDragging) applyPos(...Object.values(getPos(e))); });
  cv.addEventListener('mouseup', () => phasorDragging = false);
  cv.addEventListener('mouseleave', () => phasorDragging = false);
  cv.addEventListener('touchstart', e => { e.preventDefault(); phasorDragging = true; applyPos(...Object.values(getPos(e))); }, { passive: false });
  cv.addEventListener('touchmove', e => { e.preventDefault(); if (phasorDragging) applyPos(...Object.values(getPos(e))); }, { passive: false });
  cv.addEventListener('touchend', () => phasorDragging = false);
}

function clearHistory() { phasorHistory = []; abRef = null; document.getElementById('abDisplay').textContent = ''; calcImpedance(); }

function abLock() {
  const R = parseFloat(document.getElementById('rNum').value) || 0;
  const X = parseFloat(document.getElementById('xNum').value) || 0;
  const Z0 = parseFloat(document.getElementById('z0Num').value) || 50;
  const nR = R - Z0, nI = X, dR = R + Z0, dI = X, d2 = dR * dR + dI * dI;
  const gR = (nR * dR + nI * dI) / d2, gI = (nI * dR - nR * dI) / d2;
  const g = Math.sqrt(gR * gR + gI * gI);
  const v = g >= 1 ? 99 : (1 + g) / (1 - g);
  const rl = g < 1e-6 ? 99 : -20 * Math.log10(g);
  abRef = { R, X, vswr: v, rl };
  document.getElementById('abLockBtn').textContent = 'REF A: ' + R + (X >= 0 ? '+j' : '-j') + Math.abs(X) + ' Ω';
  updateABDisplay();
  calcImpedance();
}

function updateABDisplay() {
  if (!abRef) return;
  const R = parseFloat(document.getElementById('rNum').value) || 0;
  const X = parseFloat(document.getElementById('xNum').value) || 0;
  const Z0 = parseFloat(document.getElementById('z0Num').value) || 50;
  const nR = R - Z0, nI = X, dR = R + Z0, dI = X, d2 = dR * dR + dI * dI;
  const gR = (nR * dR + nI * dI) / d2, gI = (nI * dR - nR * dI) / d2;
  const g = Math.sqrt(gR * gR + gI * gI);
  const v = g >= 1 ? 99 : (1 + g) / (1 - g);
  const rl = g < 1e-6 ? 99 : -20 * Math.log10(g);
  const dv = (v - abRef.vswr).toFixed(2);
  const dr = (rl - abRef.rl).toFixed(1);
  const col = v < abRef.vswr ? '#4ade80' : '#f87171';
  document.getElementById('abDisplay').innerHTML =
    'ΔV: <span style="color:' + col + '">' + (v < abRef.vswr ? '' : '+') + dv + '</span> &nbsp; ΔRL: <span style="color:' + col + '">' + (rl > abRef.rl ? '+' : '') + dr + ' dB</span>';
}

function setPreset(r, x) {
  document.getElementById('rNum').value = r;
  document.getElementById('rSlider').value = Math.min(r, 300);
  document.getElementById('rVal').textContent = r;
  document.getElementById('xNum').value = x;
  document.getElementById('xSlider').value = Math.min(Math.max(x, -200), 200);
  document.getElementById('xVal').textContent = (x >= 0 ? '+' : '') + x;
  calcImpedance();
}

function aiDiagnose(R, X, Z0, gamma, vswr, rl) {
  if (!document.getElementById('aiVswrBadge')) return;

  // Section 1: VSWR Health Indicator
  const badge = document.getElementById('aiVswrBadge');
  badge.className = ""; // reset animation class
  if (vswr < 1.2) {
    badge.textContent = "✅ Excellent Match";
    badge.style.background = "var(--green)";
    badge.style.color = "#000";
  } else if (vswr < 1.5) {
    badge.textContent = "🟢 Good Match";
    badge.style.background = "#86efac"; // light green
    badge.style.color = "#000";
  } else if (vswr <= 2.0) {
    badge.textContent = "🟡 Acceptable — Monitor";
    badge.style.background = "var(--yellow)";
    badge.style.color = "#000";
  } else if (vswr <= 3.0) {
    badge.textContent = "🔴 Poor Match — Action Needed";
    badge.style.background = "var(--red)";
    badge.style.color = "#fff";
  } else {
    badge.textContent = "❌ Critical Mismatch";
    badge.className = "vswr-crit";
    badge.style.background = "#dc2626";
    badge.style.color = "#fff";
  }

  // Section 2: Impedance Character Analysis
  const isInductive = X > +0.1;
  const isCapacitive = X < -0.1;
  const isPure = Math.abs(X) <= 0.1;

  document.getElementById('aiImpType').textContent = isPure ? "Purely Resistive" : (isInductive ? "Inductive" : "Capacitive");
  document.getElementById('aiImpMag').textContent = Math.sqrt(R * R + X * X).toFixed(2) + " Ω";

  let phase = Math.atan2(X, R) * (180 / Math.PI);
  document.getElementById('aiImpPhase').textContent = phase.toFixed(2) + "°";

  if (isPure) {
    document.getElementById('aiImpDom').textContent = "Pure Resistance";
    document.getElementById('aiImpDom').style.color = "var(--t1)";
  } else if (Math.abs(X) > R) {
    document.getElementById('aiImpDom').textContent = "Reactance-dominant — harder to match";
    document.getElementById('aiImpDom').style.color = "var(--orange)";
  } else {
    document.getElementById('aiImpDom').textContent = "Resistance-dominant — good matching candidate";
    document.getElementById('aiImpDom').style.color = "var(--green)";
  }

  // Section 3: AI Suggestions Engine
  let tip = "";
  if (vswr > 2.0) {
    if (isInductive) tip = "Add a series capacitor to cancel inductive reactance, then re-tune.";
    else if (isCapacitive) tip = "Add a series inductor to neutralise capacitive reactance.";
    else tip = "Use a quarter-wave transformer or L-network to shift resistance to 50 Ω.";
  } else if (vswr >= 1.5) {
    tip = "Marginal match — consider a stub tuner or trim component values.";
  } else if (vswr >= 1.2) {
    tip = "System is within acceptable bounds. No immediate action required.";
  } else {
    tip = "Near-perfect match. Verify with VNA sweep across operating bandwidth.";
  }
  document.getElementById('aiSuggestionText').textContent = tip;
}

/* ============================================================
   PANEL 2: FREQUENCY SWEEP
============================================================ */
function runSweep() {
  const type = document.getElementById('sweepType').value;
  const R = parseFloat(document.getElementById('sRSlider').value);
  const L = parseFloat(document.getElementById('sLSlider').value) * 1e-9;
  const C = parseFloat(document.getElementById('sCSlider').value) * 1e-12;
  const Z0 = 50;
  const fmax = parseFloat(document.getElementById('freqRange').value) * 1e6;
  const N = 200;

  // Show/hide L/C fields
  document.getElementById('fieldL').style.display = (type === 'RC' ? 'none' : 'block');
  document.getElementById('fieldC').style.display = (type === 'RL' ? 'none' : 'block');

  const freqs = [], vswrArr = [], rlArr = [], gammaArr = [];
  let minVswr = 999, minVswrF = 0, resonanceF = 0, bwLow = 0, bwHigh = 0, inBW = false;

  for (let i = 0; i <= N; i++) {
    const f = fmax * i / N;
    freqs.push(f / 1e6);
    let Zr = R, Zi = 0;
    const w = 2 * Math.PI * f;
    if (w > 0) {
      if (type === 'RL' || type === 'RLC') Zi += w * L;
      if (type === 'RC' || type === 'RLC') Zi -= 1 / (w * C);
      if (type === 'LC') { Zr = 0; Zi = w * L - 1 / (w * C); }
    }
    const nR = Zr - Z0, nI = Zi;
    const dR = Zr + Z0, dI = Zi;
    const d2 = dR * dR + dI * dI;
    const gR = (nR * dR + nI * dI) / d2;
    const gI = (nI * dR - nR * dI) / d2;
    const g = Math.sqrt(gR * gR + gI * gI);
    const v = g >= 1 ? 999 : (1 + g) / (1 - g);
    const rl2 = g < 1e-6 ? 99 : -20 * Math.log10(g);

    vswrArr.push(Math.min(v, 10));
    rlArr.push(Math.min(rl2, 40));
    gammaArr.push(g);

    if (v < minVswr) { minVswr = v; minVswrF = f; }
    if (i > 0 && Math.abs(Zi) < Math.abs(prevZi) && Zi * prevZi < 0) resonanceF = f;
    var prevZi = Zi;

    if (v <= 2 && !inBW) { bwLow = f; inBW = true; }
    if (v > 2 && inBW) { bwHigh = f; inBW = false; }
  }
  if (inBW) bwHigh = fmax;
  const bw = bwHigh - bwLow;

  const chartData = {
    labels: freqs, datasets: [{
      data: vswrArr, borderColor: '#22d3ee', borderWidth: 1.5,
      pointRadius: 0, fill: true, backgroundColor: 'rgba(34,211,238,0.05)', tension: 0.3
    }]
  };

  // VSWR=2 reference line
  const vswr2Line = { label: 'VSWR=2', data: freqs.map(() => 2), borderColor: 'rgba(251,191,36,0.4)', borderWidth: 1, borderDash: [4, 4], pointRadius: 0 };
  chartData.datasets.push(vswr2Line);

  lastSweepData = { freqs, vswrArr, rlArr, gammaArr: gammaArr.map(g => +g.toFixed(4)), fmax };

  // Build datasets including saved sweeps
  function mkDatasets(key, mainColor, mainData) {
    const ds = [{
      data: mainData, borderColor: mainColor, borderWidth: 1.5, pointRadius: 0,
      fill: true, backgroundColor: mainColor + '18', tension: 0.3, label: 'Current'
    }];
    savedSweeps.forEach(s => {
      ds.push({
        data: s[key], borderColor: s.color, borderWidth: 1, pointRadius: 0,
        tension: 0.3, borderDash: [4, 3], label: s.label
      });
    });
    return ds;
  }

  buildChart('vswrChart', freqs, vswrArr, '#22d3ee', 'VSWR', 0, 6, mkDatasets('vswrArr', '#22d3ee', vswrArr));
  buildChart('rlChart', freqs, rlArr, '#a78bfa', 'Return Loss (dB)', 0, 40, mkDatasets('rlArr', '#a78bfa', rlArr));
  buildChart('gammaChart', freqs, gammaArr.map(g => +g.toFixed(4)), '#4ade80', '|Γ|', 0, 1, mkDatasets('gammaArr', '#4ade80', gammaArr.map(g => +g.toFixed(4))));

  setTimeout(() => { updateMarker(document.getElementById('freqMarker').value); }, 50);

  // Summary chips
  document.getElementById('resChip').textContent = 'Resonance: ' + (resonanceF > 0 ? (resonanceF / 1e6).toFixed(1) + ' MHz' : 'N/A');
  document.getElementById('resChip').className = 'sweep-chip' + (resonanceF > 0 ? ' highlight' : '');
  document.getElementById('bwChip').textContent = 'BW (VSWR<2): ' + (bw > 0 ? (bw / 1e6).toFixed(1) + ' MHz' : 'N/A');
  document.getElementById('minVswrChip').textContent = 'Min VSWR: ' + minVswr.toFixed(3) + ' @ ' + (minVswrF / 1e6).toFixed(1) + 'MHz';
  document.getElementById('minVswrChip').className = 'sweep-chip' + (minVswr < 2 ? ' highlight' : '');

  let sweepTxt = '';
  if (resonanceF > 0) sweepTxt += 'Resonance at <strong>' + (resonanceF / 1e6).toFixed(1) + ' MHz</strong> — reactive parts cancel here. ';
  if (bw > 0) sweepTxt += 'Usable bandwidth ' + (bwLow / 1e6).toFixed(0) + '–' + (bwHigh / 1e6).toFixed(0) + ' MHz. ';
  if (minVswr < 2) sweepTxt += 'Minimum VSWR ' + minVswr.toFixed(2) + ' — acceptable match at this frequency.';
  else sweepTxt += 'VSWR remains above 2 across the sweep. Consider an impedance matching network.';
  document.getElementById('sweepAI').innerHTML = sweepTxt;
}

function buildChart(id, labels, data, color, ylabel, ymin, ymax, extraDatasets) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (ctx._chart) ctx._chart.destroy();
  const datasets = extraDatasets || [{
    data, borderColor: color, borderWidth: 1.5, pointRadius: 0,
    fill: true, backgroundColor: color + '18', tension: 0.3
  }];
  ctx._chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...CHART_DEFAULTS, plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: savedSweeps.length > 0, labels: { color: '#a1a1aa', font: { family: "'IBM Plex Mono',monospace", size: 9 }, boxWidth: 12 } },
        tooltip: { ...CHART_DEFAULTS.plugins.tooltip, callbacks: { title: i => i[0].label + ' MHz', label: i => ylabel + ': ' + i.raw } }
      },
      scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: ymin, max: ymax } }
    }
  });
}

function saveSweep() {
  if (!lastSweepData) return;
  if (savedSweeps.length >= 3) { document.getElementById('sweepSaveInfo').textContent = 'Max 3 sweeps saved. Clear first.'; return; }
  const idx = savedSweeps.length;
  const type = document.getElementById('sweepType').value;
  const R = document.getElementById('sRSlider').value;
  savedSweeps.push({ ...lastSweepData, color: SWEEP_COLORS[idx], label: type + ' R=' + R + 'Ω' });
  document.getElementById('sweepSaveInfo').textContent = savedSweeps.map((s, i) => 'S' + (i + 1) + ': ' + s.label).join(' | ');
  runSweep();
}
function clearSweeps() { savedSweeps = []; document.getElementById('sweepSaveInfo').textContent = ''; runSweep(); }

function updateMarker(val) {
  markerPos = val / 100;
  drawMarkerOverlays();
  if (!lastSweepData) return;
  const { freqs, vswrArr, rlArr, gammaArr } = lastSweepData;
  const idx = Math.min(Math.floor(markerPos * (freqs.length - 1)), freqs.length - 1);
  const f = freqs[idx];
  document.getElementById('freqMarkerLabel').textContent = f.toFixed(1) + ' MHz';
}

function drawMarkerOverlays() {
  [1, 2, 3].forEach(n => {
    const ov = document.getElementById('markerOverlay' + n);
    if (!ov) return;
    const chart = {
      1: document.getElementById('vswrChart')._chart,
      2: document.getElementById('rlChart')._chart,
      3: document.getElementById('gammaChart')._chart
    }[n];
    if (!chart) return;
    const W = ov.offsetWidth, H = ov.offsetHeight;
    ov.width = W; ov.height = H;
    const ctx = ov.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const area = chart.chartArea;
    if (!area) return;
    const sx = area.left + (area.right - area.left) * markerPos;
    ctx.strokeStyle = 'rgba(34,211,238,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(sx, area.top); ctx.lineTo(sx, area.bottom); ctx.stroke();
    ctx.setLineDash([]);
    // readout
    if (lastSweepData) {
      const { freqs, vswrArr, rlArr, gammaArr } = lastSweepData;
      const idx = Math.min(Math.floor(markerPos * (freqs.length - 1)), freqs.length - 1);
      const vals = [vswrArr[idx], rlArr[idx], gammaArr[idx]];
      const labels = ['VSWR', 'RL (dB)', '|Γ|'];
      ctx.fillStyle = 'rgba(34,211,238,0.85)'; ctx.font = '10px IBM Plex Mono';
      ctx.fillText(labels[n - 1] + ': ' + (vals[n - 1]).toFixed(3), sx + 4, area.top + 12);
    }
  });
}
function setTermination(mode, btn) {
  wTermMode = mode;
  document.querySelectorAll('.wterm-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const infos = {
    matched: 'Matched: Γ = 0, no reflection. All incident power is absorbed by the load.',
    open: 'Open circuit: Γ = +1, ∠0°. Voltage doubles at the load end. Total reflection, no phase reversal.',
    short: 'Short circuit: Γ = −1, ∠180°. Voltage is zero at the load. Total reflection with 180° phase reversal.'
  };
  document.getElementById('wTermInfo').textContent = infos[mode];
  if (mode === 'matched') document.getElementById('wGamma').value = 0;
  else document.getElementById('wGamma').value = 100;
  document.getElementById('wGammaVal').textContent = mode === 'matched' ? '0.00' : '1.00';
  updateWaveInfo();
}

function updateWaveInfo() {
  const gamma = parseFloat(document.getElementById('wGamma').value) / 100;
  const freq = parseFloat(document.getElementById('wFreq').value) * 1e6;
  const lambda = (3e8 / freq);
  const vswr = (1 + gamma) / (1 - gamma + 1e-10);
  const fwdPow = 100, refPow = gamma * gamma * 100;

  document.getElementById('wLambda').textContent = lambda >= 1 ? (lambda.toFixed(2) + ' m') : (lambda * 100).toFixed(1) + ' cm';
  document.getElementById('wVswr').textContent = vswr.toFixed(2);
  document.getElementById('wFwdPow').textContent = fwdPow.toFixed(0) + '%';
  document.getElementById('wRefPow').textContent = refPow.toFixed(1) + '%';
  drawWave();
}

function drawWave() {
  const cv = document.getElementById('waveCanvas');
  const ctx = cv.getContext('2d');
  const W = cv.offsetWidth || 600;
  cv.width = W; cv.height = 400;
  ctx.clearRect(0, 0, W, 400);

  const gamma = parseFloat(document.getElementById('wGamma').value) / 100;
  const phase = wavePhase;
  const userPhase = parseFloat(document.getElementById('wPhase').value) * Math.PI / 180;
  const ox = 40, ow = W - 80, midY = 200, amp = 80;

  // Background grid
  ctx.strokeStyle = 'rgba(39,39,42,0.8)'; ctx.lineWidth = 1;
  for (let y = 0; y <= 400; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let x = ox; x <= ox + ow; x += ow / 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 400); ctx.stroke(); }

  // Axis
  ctx.strokeStyle = '#3f3f46'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ox, midY); ctx.lineTo(ox + ow, midY); ctx.stroke();

  // Labels
  ctx.fillStyle = '#52525b'; ctx.font = '10px IBM Plex Mono'; ctx.textAlign = 'center';
  ctx.fillText('0', ox, midY + 20); ctx.fillText('λ/2', ox + ow * 0.5, midY + 20); ctx.fillText('λ', ox + ow, midY + 20);
  ctx.fillText('Source', ox + ow * 0.05, 18); ctx.fillText('Load', ox + ow * 0.95, 18);

  // Transmission line
  ctx.strokeStyle = '#27272a'; ctx.lineWidth = 3; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(ox, midY - 2); ctx.lineTo(ox + ow, midY - 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ox, midY + 2); ctx.lineTo(ox + ow, midY + 2); ctx.stroke();

  const N = 400;
  // Forward wave (cyan)
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.setLineDash([]);
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const x = ox + ow * i / N;
    const pos = i / N;
    const y = midY - amp * Math.sin(2 * Math.PI * (pos - phase * 0.02) + userPhase);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Reflected wave (orange) — phase-reversed for short circuit
  const refSign = (wTermMode === 'short') ? -1 : 1;
  ctx.strokeStyle = '#fb923c'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const x = ox + ow * i / N;
    const pos = i / N;
    const y = midY - amp * gamma * refSign * Math.sin(2 * Math.PI * (1 - pos + phase * 0.02) + userPhase);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Standing wave envelope (green dashed)
  ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
  const envTop = [], envBot = [];
  for (let i = 0; i <= N; i++) {
    const pos = i / N;
    const fwd = amp * Math.sin(2 * Math.PI * pos + userPhase);
    const ref = amp * gamma * Math.sin(2 * Math.PI * (1 - pos) + userPhase);
    const sw = fwd + ref;
    envTop.push(midY - Math.abs(sw)); envBot.push(midY + Math.abs(sw));
  }
  ctx.beginPath();
  for (let i = 0; i <= N; i++) { const x = ox + ow * i / N; i === 0 ? ctx.moveTo(x, envTop[i]) : ctx.lineTo(x, envTop[i]); }
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= N; i++) { const x = ox + ow * i / N; i === 0 ? ctx.moveTo(x, envBot[i]) : ctx.lineTo(x, envBot[i]); }
  ctx.stroke();
  ctx.setLineDash([]);

  // Nodes & antinodes
  for (let i = 0; i < 4; i++) {
    const xNode = ox + ow * (i * 0.5 + 0.25);
    const xAnti = ox + ow * (i * 0.5);
    // Node
    ctx.fillStyle = 'rgba(248,113,113,0.7)';
    ctx.beginPath(); ctx.arc(xNode, midY, 4, 0, 2 * Math.PI); ctx.fill();
    // Antinode
    ctx.fillStyle = 'rgba(34,211,238,0.7)';
    ctx.beginPath(); ctx.arc(xAnti, midY - amp * (1 + gamma), 4, 0, 2 * Math.PI); ctx.fill();
    ctx.beginPath(); ctx.arc(xAnti, midY + amp * (1 + gamma), 4, 0, 2 * Math.PI); ctx.fill();
  }
}

function toggleWave() {
  if (waveRunning) {
    cancelAnimationFrame(waveAnimId);
    waveRunning = false;
    document.getElementById('wavePlayBtn').textContent = '▶ PLAY';
  } else {
    waveRunning = true;
    document.getElementById('wavePlayBtn').textContent = '⏸ PAUSE';
    startWave();
  }
}

function startWave() {
  function frame() {
    wavePhase += 0.3;
    drawWave();
    if (waveRunning) waveAnimId = requestAnimationFrame(frame);
  }
  waveAnimId = requestAnimationFrame(frame);
}

function resetWave() {
  wavePhase = 0;
  drawWave();
}

/* ============================================================
   E12 STANDARD VALUES + PANEL 4: MATCHING CIRCUIT (upgraded)
============================================================ */
const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
function snapE12(val) {
  const decades = [0.01, 0.1, 1, 10, 100, 1000, 10000];
  let best = val, bestDiff = Infinity;
  decades.forEach(dec => E12.forEach(e => { const v = e * dec; const d = Math.abs(v - val); if (d < bestDiff) { bestDiff = d; best = v; } }));
  return best;
}

function calcMatch() {
  const RL = parseFloat(document.getElementById('mRL').value) || 75;
  const XL = parseFloat(document.getElementById('mXL').value) || 0;
  const Z0 = parseFloat(document.getElementById('mZ0').value) || 50;
  const f = parseFloat(document.getElementById('mFreq').value) * 1e6 || 2.4e9;
  const type = document.getElementById('mType').value;
  const tol = parseFloat(document.getElementById('mTol').value) / 100;
  const doSnap = document.getElementById('mE12snap').checked;
  const w = 2 * Math.PI * f;

  const Rhigh = Math.max(RL, Z0), Rlow = Math.min(RL, Z0);
  const Q = Math.sqrt(Math.max(Rhigh / Rlow - 1, 0.001));
  const matchHigh = (RL > Z0);
  const Xs = Q * Rlow, Xp = Rhigh / Q;

  let comp1Ideal, comp2Ideal, comp1Unit, comp2Unit, comp1Name, comp2Name, c1raw, c2raw;
  if (type === 'LP') {
    if (matchHigh) {
      c1raw = Xs / w; comp1Ideal = c1raw * 1e9; comp1Unit = 'nH'; comp1Name = 'Series L';
      c2raw = 1 / (w * Xp); comp2Ideal = c2raw * 1e12; comp2Unit = 'pF'; comp2Name = 'Shunt C';
    } else {
      c1raw = 1 / (w * Xs); comp1Ideal = c1raw * 1e12; comp1Unit = 'pF'; comp1Name = 'Series C';
      c2raw = Xp / w; comp2Ideal = c2raw * 1e9; comp2Unit = 'nH'; comp2Name = 'Shunt L';
    }
  } else {
    if (matchHigh) {
      c1raw = 1 / (w * Xs); comp1Ideal = c1raw * 1e12; comp1Unit = 'pF'; comp1Name = 'Series C';
      c2raw = Xp / w; comp2Ideal = c2raw * 1e9; comp2Unit = 'nH'; comp2Name = 'Shunt L';
    } else {
      c1raw = Xs / w; comp1Ideal = c1raw * 1e9; comp1Unit = 'nH'; comp1Name = 'Series L';
      c2raw = 1 / (w * Xp); comp2Ideal = c2raw * 1e12; comp2Unit = 'pF'; comp2Name = 'Shunt C';
    }
  }

  const c1s = doSnap ? snapE12(comp1Ideal) : comp1Ideal;
  const c2s = doSnap ? snapE12(comp2Ideal) : comp2Ideal;
  const d1 = ((c1s - comp1Ideal) / comp1Ideal * 100);
  const d2 = ((c2s - comp2Ideal) / comp2Ideal * 100);

  document.getElementById('matchComponents').innerHTML =
    `<div class="comp-row"><span class="comp-name">${comp1Name} — ideal</span><span class="comp-val">${comp1Ideal.toFixed(3)} ${comp1Unit}</span></div>` +
    (doSnap ? `<div class="comp-row"><span class="comp-name">${comp1Name} — E12</span><span class="comp-val" style="color:${Math.abs(d1) < 5 ? 'var(--green)' : 'var(--yellow)'}">${c1s.toFixed(2)} ${comp1Unit} <span style="font-size:10px;color:var(--t3)">(${d1 >= 0 ? '+' : ''}${d1.toFixed(1)}%)</span></span></div>` : '') +
    `<div class="comp-row"><span class="comp-name">${comp2Name} — ideal</span><span class="comp-val">${comp2Ideal.toFixed(3)} ${comp2Unit}</span></div>` +
    (doSnap ? `<div class="comp-row"><span class="comp-name">${comp2Name} — E12</span><span class="comp-val" style="color:${Math.abs(d2) < 5 ? 'var(--green)' : 'var(--yellow)'}">${c2s.toFixed(2)} ${comp2Unit} <span style="font-size:10px;color:var(--t3)">(${d2 >= 0 ? '+' : ''}${d2.toFixed(1)}%)</span></span></div>` : '') +
    `<div class="comp-row"><span class="comp-name">Q factor</span><span class="comp-val">${Q.toFixed(3)}</span></div>` +
    `<div class="comp-row"><span class="comp-name">Bandwidth est.</span><span class="comp-val">${(f / Q / 1e6).toFixed(1)} MHz</span></div>`;

  // Feature 2: AI Engineering Recommendation Block
  const aiBlock = document.getElementById('matchAIRecommendation');
  if (aiBlock) {
    let topologyStr = "";
    let recL = 0, recC = 0;

    // 433 MHz recommendation block fixed frequency calculation
    const fRec = 433e6;
    const wRec = 2 * Math.PI * fRec;
    const XsRec = Q * Rlow;
    const XpRec = Rhigh / Q;

    if (RL === Z0) {
      aiBlock.innerHTML = `<span style="color:var(--green)">✓ Load is naturally matched to source. No L-Network required.</span>`;
    } else {
      if (RL > Z0) {
        topologyStr = "Shunt Capacitor (parallel to Load) + Series Inductor";
        recL = XsRec / wRec * 1e9;   // nH
        recC = 1 / (wRec * XpRec) * 1e12; // pF
      } else {
        topologyStr = "Series Inductor + Shunt Capacitor (parallel to Source)";
        recL = XsRec / wRec * 1e9;   // nH
        recC = 1 / (wRec * XpRec) * 1e12; // pF
      }

      aiBlock.innerHTML = `
             <strong style="color:#fafafa;font-size:12px;display:block;margin-bottom:6px;">Recommended Topology:</strong>
             <span style="color:var(--acc)">${topologyStr}</span><br><br>
             Targeting the standard ISM band <strong style="color:var(--green)">433 MHz</strong>:<br>
             <ul style="margin-top:4px;padding-left:14px;color:#a1a1aa">
               <li>Inductor Component: <strong style="color:#fafafa">${recL.toFixed(2)} nH</strong></li>
               <li>Capacitor Component: <strong style="color:#fafafa">${recC.toFixed(2)} pF</strong></li>
             </ul>
           `;
    }
  }

  // Tolerance impact card
  const vnom = 1 + 2 * Q * Q * 0;
  const vworse = 1 + 2 * (Q * (1 + tol)) * (Q * (1 + tol)) * ((tol * 0.5) ** 2) * 100;
  // Real worst-case: component shift pushes resonant freq
  const tolPct = Math.round(tol * 100);
  const fShift = f * (1 - tol * 0.5);
  const deltaWorst = (fShift - f) / f;
  const vswrWorst = 1 + 2 * Q * Q * deltaWorst * deltaWorst;
  document.getElementById('matchTolerance').innerHTML =
    `±${tolPct}% tolerance on both components shifts resonance by ~${(Math.abs(deltaWorst * 100)).toFixed(1)}%<br>` +
    `<span style="color:var(--green)">Nominal VSWR at design freq: 1.00</span><br>` +
    `<span style="color:${vswrWorst < 2 ? 'var(--yellow)' : 'var(--red)'}">Worst-case VSWR: ${vswrWorst.toFixed(2)}</span><br>` +
    `<span style="color:var(--t3)">Recommendation: use ${tolPct > 5 ? '1%' : '5%'} or better components.</span>`;

  // Draw circuit diagram
  const typeKey = (type === 'LP' ? 'LP' : 'HP') + '-' + (comp1Unit === 'nH' ? 'series-L' : 'series-C');
  const rawV1 = comp1Unit === 'nH' ? c1s * 1e-9 : c1s * 1e-12;
  const rawV2 = comp2Unit === 'nH' ? c2s * 1e-9 : c2s * 1e-12;
  drawCircuit(typeKey, rawV1, rawV2, f, comp1Unit, comp2Unit, c1s, c2s);

  // Before/after + tolerance band
  const freqs = [], beforeArr = [], afterNom = [], afterWorstArr = [], afterBestArr = [];
  for (let i = 1; i <= 200; i++) {
    const fi = f * 0.2 + f * 1.8 * i / 200;
    freqs.push((fi / 1e6).toFixed(0));
    const bR = RL - Z0, bI = XL, bdR = RL + Z0, bdI = XL, bd2 = bdR * bdR + bdI * bdI;
    const bg = Math.sqrt(((bR * bdR + bI * bdI) / bd2) ** 2 + ((bI * bdR - bR * bdI) / bd2) ** 2);
    beforeArr.push(Math.min((1 + bg) / (1 - bg + 1e-9), 10));
    const df = (fi - f) / f;
    afterNom.push(Math.min(1 + 2 * Q * Q * df * df, 6));
    const Qworst = Q * (1 + tol);
    afterWorstArr.push(Math.min(1 + 2 * Qworst * Qworst * df * df, 6));
    afterBestArr.push(Math.min(1 + 2 * (Q * (1 - tol)) * (Q * (1 - tol)) * df * df, 6));
  }
  const mctx = document.getElementById('matchChart');
  if (mctx._chart) mctx._chart.destroy();
  mctx._chart = new Chart(mctx, {
    type: 'line',
    data: {
      labels: freqs, datasets: [
        { label: 'Before', data: beforeArr, borderColor: '#f87171', borderWidth: 1.5, pointRadius: 0, tension: 0.3, borderDash: [4, 4] },
        { label: 'After (nominal)', data: afterNom, borderColor: '#4ade80', borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: `±${tolPct}% best`, data: afterBestArr, borderColor: 'rgba(34,211,238,0.35)', borderWidth: 1, pointRadius: 0, tension: 0.3, fill: false },
        { label: `±${tolPct}% worst`, data: afterWorstArr, borderColor: 'rgba(251,191,36,0.5)', borderWidth: 1, pointRadius: 0, tension: 0.3, borderDash: [3, 3] },
      ]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: { ...CHART_DEFAULTS.plugins, legend: { display: true, labels: { color: '#52525b', font: { family: "'IBM Plex Mono',monospace", size: 9 }, boxWidth: 10 } } },
      scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 1, max: 6 } }
    }
  });

  // Matching path Smith Chart
  drawMatchingSmith(RL, XL, Z0, f, comp1Name, comp1Unit, c1s, comp2Unit, c2s);

  document.getElementById('matchAI').innerHTML =
    `L-network (${type}) at <strong>${(f / 1e6).toFixed(0)} MHz</strong>. Q=${Q.toFixed(2)}, BW≈${(f / Q / 1e6).toFixed(0)} MHz. ` +
    (doSnap ? `E12 snap: ${comp1Name} ${c1s.toFixed(2)} ${comp1Unit}, ${comp2Name} ${c2s.toFixed(2)} ${comp2Unit}. ` : '') +
    `±${tolPct}% tolerance → worst-case VSWR ${vswrWorst.toFixed(2)}. ` +
    (Q > 5 ? 'High Q — narrow but selective. Consider 1% components.' : 'Moderate Q — good bandwidth.');
}

function drawCircuit(type, val1, val2, f, cu1, cu2, cv1, cv2) {
  const el = document.getElementById('circuitDiagram');
  const w = Math.min(el.offsetWidth - 32, 420);
  const isSeriesL = cu1 === 'nH';
  const c1label = (cu1 === 'nH' ? 'L=' + cv1.toFixed(2) + 'nH' : 'C=' + cv1.toFixed(2) + 'pF');
  const c2label = (cu2 === 'nH' ? 'L=' + cv2.toFixed(2) + 'nH' : 'C=' + cv2.toFixed(2) + 'pF');
  el.innerHTML = `<svg viewBox="0 0 420 120" width="${w}" height="110" style="display:block;margin:0 auto">
    <rect x="8" y="45" width="40" height="30" rx="4" fill="#18181b" stroke="#3f3f46" stroke-width="1"/>
    <text x="28" y="63" text-anchor="middle" fill="#52525b" font-size="9" font-family="IBM Plex Mono">Z₀</text>
    <line x1="48" y1="60" x2="110" y2="60" stroke="#22d3ee" stroke-width="1.5"/>
    <rect x="110" y="44" width="60" height="32" rx="4" fill="#18181b" stroke="#22d3ee" stroke-width="1.5"/>
    <text x="140" y="56" text-anchor="middle" fill="#22d3ee" font-size="8" font-family="IBM Plex Mono">${isSeriesL ? 'L' : 'C'}</text>
    <text x="140" y="68" text-anchor="middle" fill="#a1a1aa" font-size="7.5" font-family="IBM Plex Mono">${c1label}</text>
    <line x1="170" y1="60" x2="250" y2="60" stroke="#22d3ee" stroke-width="1.5"/>
    <line x1="250" y1="44" x2="250" y2="60" stroke="#22d3ee" stroke-width="1.5"/>
    <rect x="222" y="20" width="56" height="24" rx="4" fill="#18181b" stroke="#a78bfa" stroke-width="1.5"/>
    <text x="250" y="30" text-anchor="middle" fill="#a78bfa" font-size="8" font-family="IBM Plex Mono">${isSeriesL ? 'C' : 'L'}</text>
    <text x="250" y="40" text-anchor="middle" fill="#a1a1aa" font-size="7.5" font-family="IBM Plex Mono">${c2label}</text>
    <line x1="250" y1="60" x2="250" y2="80" stroke="#22d3ee" stroke-width="1.5"/>
    <line x1="222" y1="90" x2="278" y2="90" stroke="#52525b" stroke-width="1"/>
    <line x1="232" y1="95" x2="268" y2="95" stroke="#52525b" stroke-width="1"/>
    <line x1="243" y1="100" x2="257" y2="100" stroke="#52525b" stroke-width="1"/>
    <line x1="250" y1="60" x2="310" y2="60" stroke="#22d3ee" stroke-width="1.5"/>
    <rect x="310" y="44" width="60" height="32" rx="4" fill="#18181b" stroke="#fb923c" stroke-width="1.5"/>
    <text x="340" y="56" text-anchor="middle" fill="#fb923c" font-size="9" font-family="IBM Plex Mono">ZL</text>
    <text x="340" y="68" text-anchor="middle" fill="#a1a1aa" font-size="7.5" font-family="IBM Plex Mono">Load</text>
    <line x1="8" y1="75" x2="8" y2="90" stroke="#3f3f46" stroke-width="1"/>
    <line x1="1" y1="90" x2="15" y2="90" stroke="#3f3f46" stroke-width="1"/>
    <line x1="3" y1="95" x2="13" y2="95" stroke="#3f3f46" stroke-width="1"/>
    <line x1="370" y1="60" x2="370" y2="76" stroke="#22d3ee" stroke-width="1.5"/>
    <line x1="363" y1="76" x2="377" y2="76" stroke="#3f3f46" stroke-width="1"/>
    <line x1="365" y1="81" x2="375" y2="81" stroke="#3f3f46" stroke-width="1"/>
    <text x="210" y="115" text-anchor="middle" fill="#52525b" font-size="8" font-family="IBM Plex Mono">${type} @ ${(f / 1e6).toFixed(0)}MHz</text>
  </svg>`;
}

function drawMatchingSmith(RL, XL, Z0, f, cn1, cu1, cv1, cu2, cv2) {
  const cv = document.getElementById('matchSmithCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.offsetWidth || 400, H = 260;
  cv.width = W; cv.height = H;
  ctx.clearRect(0, 0, W, H);
  const cx = W * 0.5, cy = H * 0.5, R = Math.min(W, H) * 0.43;

  // VSWR regions
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();
  [{ g: 1, c: 'rgba(248,113,113,0.08)' }, { g: 0.333, c: 'rgba(251,191,36,0.10)' }, { g: 0.2, c: 'rgba(74,222,128,0.10)' }]
    .forEach(({ g, c }) => { ctx.beginPath(); ctx.arc(cx, cy, R * g, 0, 2 * Math.PI); ctx.fillStyle = c; ctx.fill(); });
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.strokeStyle = '#3f3f46'; ctx.lineWidth = 1; ctx.stroke();

  // Grid
  [0, 0.5, 1, 2].forEach(r => {
    const cr = R / (1 + r), cnx = cx + R - cr;
    ctx.beginPath(); ctx.arc(cnx, cy, cr, 0, 2 * Math.PI);
    ctx.strokeStyle = r === 1 ? 'rgba(34,211,238,0.2)' : 'rgba(63,63,70,0.35)'; ctx.lineWidth = r === 1 ? 1 : 0.6; ctx.stroke();
  });
  [0.5, 1, 2].forEach(xv => [1, -1].forEach(sign => {
    const cr = R / xv, cny = cy - sign * R / xv;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();
    ctx.beginPath(); ctx.arc(cx + R, cny, cr, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(63,63,70,0.3)'; ctx.lineWidth = 0.6; ctx.stroke(); ctx.restore();
  }));
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.strokeStyle = '#27272a'; ctx.lineWidth = 0.7; ctx.stroke();

  function zToP(r, x) {
    const rr = Math.max(r, 0);
    const d = (rr + 1) * (rr + 1) + x * x;
    if (d < 1e-10) return { px: cx, py: cy };
    return { px: cx + ((rr - 1) * (rr + 1) + x * x) / d * R, py: cy - (2 * x) / d * R };
  }

  const rN = RL / Z0, xN = XL / Z0;
  const w = 2 * Math.PI * f;
  const ptA = zToP(rN, xN);

  let xMid = xN;
  if (cn1.includes('Series')) {
    if (cu1 === 'nH') xMid = xN + (w * cv1 * 1e-9) / Z0;
    else xMid = xN - (1 / (w * cv1 * 1e-12 * Z0));
  } else {
    if (cu2 === 'nH') xMid = xN + (w * cv2 * 1e-9) / Z0;
    else xMid = xN - (1 / (w * cv2 * 1e-12 * Z0));
  }
  const ptB = zToP(rN, xMid);
  const ptC = zToP(1, 0);

  // Path A→B (series element, constant r arc)
  ctx.beginPath();
  for (let i = 0; i <= 30; i++) {
    const xi = xN + (xMid - xN) * i / 30;
    const p = zToP(rN, xi);
    i === 0 ? ctx.moveTo(p.px, p.py) : ctx.lineTo(p.px, p.py);
  }
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2.5; ctx.stroke();

  // Path B→C (shunt element)
  ctx.beginPath(); ctx.moveTo(ptB.px, ptB.py); ctx.lineTo(ptC.px, ptC.py);
  ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2.5; ctx.stroke();

  // Arrows
  function arrowHead(x1, y1, x2, y2, col) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 8 * Math.cos(a - .4), y2 - 8 * Math.sin(a - .4));
    ctx.lineTo(x2 - 8 * Math.cos(a + .4), y2 - 8 * Math.sin(a + .4));
    ctx.closePath(); ctx.fill();
  }
  arrowHead(ptA.px, ptA.py, ptB.px, ptB.py, '#22d3ee');
  arrowHead(ptB.px, ptB.py, ptC.px, ptC.py, '#a78bfa');

  // Points
  [[ptA, '#fb923c', 'A: ZL'], [ptB, '#22d3ee', 'B'], [ptC, '#4ade80', 'C: match']].forEach(([pt, col, lbl]) => {
    ctx.beginPath(); ctx.arc(pt.px, pt.py, 5, 0, 2 * Math.PI); ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = col; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'left';
    const lx = pt.px + 8 > W - 55 ? pt.px - 55 : pt.px + 8;
    ctx.fillText(lbl, lx, pt.py + 4);
  });

  // Legend
  ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'left';
  ctx.fillStyle = '#22d3ee'; ctx.fillRect(8, H - 26, 10, 3); ctx.fillStyle = '#52525b'; ctx.fillText('Series elem.', 20, H - 20);
  ctx.fillStyle = '#a78bfa'; ctx.fillRect(8, H - 14, 10, 3); ctx.fillStyle = '#52525b'; ctx.fillText('Shunt elem.', 20, H - 8);
}

/* ============================================================
   PANEL 5: SMITH CHART — drag + hover + VSWR regions
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('smithSweep').addEventListener('change', function () {
    document.getElementById('smithSweepFields').style.display = this.checked ? 'block' : 'none';
    updateSmith();
  });
});

// Convert canvas pixel coords → normalised Gamma (gR, gI)
function smithPixelToGamma(cv, px, py) {
  const S = cv.width;
  const cx = S / 2, cy = S / 2, R = S * 0.44;
  const gR = (px - cx) / R;
  const gI = -(py - cy) / R;
  return { gR, gI };
}

// Convert Gamma → normalised impedance z = r+jx
function gammaToZ(gR, gI) {
  const d = (1 - gR) * (1 - gR) + gI * gI;
  if (d < 1e-10) return { r: 1e6, x: 0 };
  const zR = ((1 - gR * gR - gI * gI) / d);
  const zI = (2 * gI / d);
  return { r: zR, x: zI };
}

function updateSmithFromGamma(gR, gI) {
  const mag = Math.sqrt(gR * gR + gI * gI);
  if (mag > 0.98) {
    // clamp to unit circle edge
    const angle = Math.atan2(gI, gR);
    gR = 0.98 * Math.cos(angle); gI = 0.98 * Math.sin(angle);
  }
  const { r, x } = gammaToZ(gR, gI);
  const rClamped = Math.max(0, r);
  // Update sliders & labels
  document.getElementById('sNr').value = Math.min(rClamped * 100, 500);
  document.getElementById('sNrVal').textContent = rClamped.toFixed(2);
  document.getElementById('sNx').value = Math.min(Math.max(x * 100, -200), 200);
  document.getElementById('sNxVal').textContent = (x >= 0 ? '+' : '') + x.toFixed(2);
  updateSmith();
}

function initSmithDrag() {
  const cv = document.getElementById('smithCanvas');
  let dragging = false;

  function evtPos(e) {
    const rect = cv.getBoundingClientRect();
    const scaleX = cv.width / rect.width, scaleY = cv.height / rect.height;
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy2 = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return { x: cx * scaleX, y: cy2 * scaleY };
  }

  function applyEvt(e) {
    const { x, y } = evtPos(e);
    const { gR, gI } = smithPixelToGamma(cv, x, y);
    updateSmithFromGamma(gR, gI);
  }

  cv.addEventListener('mousedown', e => { dragging = true; applyEvt(e); });
  cv.addEventListener('mousemove', e => {
    if (dragging) { applyEvt(e); return; }
    // hover readout
    const { x, y } = evtPos(e);
    const { gR, gI } = smithPixelToGamma(cv, x, y);
    const mag = Math.sqrt(gR * gR + gI * gI);
    if (mag > 1) { document.getElementById('smithHoverReadout').textContent = ''; return; }
    const { r, x: xi } = gammaToZ(gR, gI);
    const vswr = mag >= 1 ? 999 : (1 + mag) / (1 - mag);
    const rl = mag < 1e-6 ? 99 : -20 * Math.log10(mag);
    document.getElementById('smithHoverReadout').textContent =
      'z = ' + Math.max(0, r).toFixed(2) + (xi >= 0 ? '+j' : '-j') + Math.abs(xi).toFixed(2) +
      '  |Γ|=' + mag.toFixed(3) + '  VSWR=' + vswr.toFixed(2) + '  RL=' + rl.toFixed(1) + ' dB';
  });
  cv.addEventListener('mouseup', () => dragging = false);
  cv.addEventListener('mouseleave', () => { dragging = false; document.getElementById('smithHoverReadout').textContent = ''; });
  cv.addEventListener('touchstart', e => { e.preventDefault(); dragging = true; applyEvt(e); }, { passive: false });
  cv.addEventListener('touchmove', e => { e.preventDefault(); if (dragging) applyEvt(e); }, { passive: false });
  cv.addEventListener('touchend', () => dragging = false);
}

function updateSmith() {
  const r = parseFloat(document.getElementById('sNr').value) / 100;
  const x = parseFloat(document.getElementById('sNx').value) / 100;
  const doSweep = document.getElementById('smithSweep').checked;

  const denom = (r + 1) * (r + 1) + x * x;
  const gR = ((r - 1) * (r + 1) + x * x) / denom;
  const gI = (2 * x) / denom;
  const gamma = Math.sqrt(gR * gR + gI * gI);
  const vswr = gamma >= 1 ? 999 : (1 + gamma) / (1 - gamma);
  const rl = gamma < 1e-6 ? 99 : -20 * Math.log10(gamma);

  document.getElementById('smithZ').textContent = r.toFixed(2) + (x >= 0 ? '+j' : '-j') + Math.abs(x).toFixed(2);
  document.getElementById('smithGamma').textContent = gamma.toFixed(4);
  document.getElementById('smithVswr').textContent = vswr > 100 ? '>100' : vswr.toFixed(3);
  document.getElementById('smithRL').textContent = (rl > 99 ? '∞' : rl.toFixed(1)) + ' dB';

  let sweepPoints = null;
  if (doSweep) {
    sweepPoints = [];
    const L = parseFloat(document.getElementById('smithL').value) * 1e-9;
    const C = parseFloat(document.getElementById('smithC').value) * 1e-12;
    for (let i = 1; i <= 200; i++) {
      const f = 100e6 + i * 50e6;
      const w = 2 * Math.PI * f;
      const zi_r = r, zi_x = w * L - 1 / (w * C);
      const dd = (zi_r + 1) * (zi_r + 1) + zi_x * zi_x;
      const gRi = ((zi_r - 1) * (zi_r + 1) + zi_x * zi_x) / dd;
      const gIi = (2 * zi_x) / dd;
      sweepPoints.push({ gR: gRi, gI: gIi, f });
    }
  }
  drawSmith(gR, gI, sweepPoints);
}

function drawSmith(gR, gI, sweepPoints) {
  const cv = document.getElementById('smithCanvas');
  const ctx = cv.getContext('2d');
  const S = Math.min(cv.offsetWidth, cv.offsetHeight) || 500;
  cv.width = S; cv.height = S;
  const cx = S / 2, cy = S / 2, R = S * 0.44;
  ctx.clearRect(0, 0, S, S);

  // ── VSWR colour regions (filled, clipped to unit circle) ──
  const regionData = [
    { g: 1.00, color: 'rgba(248,113,113,0.10)' },  // VSWR > 3  (red)   outermost
    { g: 0.333, color: 'rgba(251,191,36,0.12)' },  // VSWR 1.5–3 (amber)
    { g: 0.200, color: 'rgba(74,222,128,0.12)' },  // VSWR < 1.5 (green) innermost
  ];
  regionData.forEach(({ g, color }) => {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();
    ctx.beginPath(); ctx.arc(cx, cy, R * g, 0, 2 * Math.PI);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  });

  // ── Outer unit circle ──
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.strokeStyle = '#3f3f46'; ctx.lineWidth = 1.5; ctx.stroke();

  // ── Constant-r circles ──
  [0, 0.2, 0.5, 1, 2, 5].forEach(r => {
    const cr = R / (1 + r), cnx = cx + R - cr;
    ctx.beginPath(); ctx.arc(cnx, cy, cr, 0, 2 * Math.PI);
    ctx.strokeStyle = r === 1 ? 'rgba(34,211,238,0.35)' : 'rgba(63,63,70,0.55)';
    ctx.lineWidth = r === 1 ? 1.5 : 0.7; ctx.stroke();
    if (r > 0 && r < 5) {
      ctx.fillStyle = '#52525b'; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'left';
      ctx.fillText('r=' + r, cnx + cr - 22, cy + 10);
    }
  });

  // ── Constant-x arcs ──
  [0.5, 1, 2, 5].forEach(xv => {
    [1, -1].forEach(sign => {
      const cr = R / xv, cny = cy - sign * R / xv;
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();
      ctx.beginPath(); ctx.arc(cx + R, cny, cr, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(63,63,70,0.45)'; ctx.lineWidth = 0.7; ctx.stroke();
      ctx.restore();
      // x-labels near real axis crossing
      if (xv <= 2) {
        const lx = cx + R - 2 * cr + 4, ly = cy - sign * 12;
        ctx.fillStyle = '#3f3f46'; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'left';
        ctx.fillText((sign > 0 ? 'x=+' : 'x=-') + xv, lx, ly);
      }
    });
  });

  // ── Real axis ──
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.strokeStyle = '#3f3f46'; ctx.lineWidth = 0.7; ctx.stroke();

  // ── VSWR reference circles (dashed) ──
  [{ g: 0.333, c: 'rgba(251,191,36,0.5)', l: 'VSWR=2' }, { g: 0.200, c: 'rgba(74,222,128,0.5)', l: 'VSWR=1.5' }].forEach(({ g, c, l }) => {
    ctx.beginPath(); ctx.arc(cx, cy, R * g, 0, 2 * Math.PI);
    ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = c; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'left';
    ctx.fillText(l, cx + R * g + 3, cy - 4);
  });

  // ── Dynamic Constant VSWR Locus (Feature 4) ──
  const activeGamma = Math.sqrt(gR * gR + gI * gI);
  if (activeGamma > 0.01 && activeGamma < 0.99) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * activeGamma, 0, 2 * Math.PI);
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f43f5e'; ctx.font = 'bold 10px IBM Plex Mono'; ctx.textAlign = 'left';
    const activeVswr = (1 + activeGamma) / (1 - activeGamma);
    ctx.fillText('VSWR=' + activeVswr.toFixed(2), cx - 40, cy - R * activeGamma - 6);
  }

  // ── Sweep locus ──
  if (sweepPoints && sweepPoints.length) {
    // animated colour gradient along locus: purple→cyan
    for (let i = 0; i < sweepPoints.length - 1; i++) {
      const t = i / sweepPoints.length;
      const p = sweepPoints[i], q = sweepPoints[i + 1];
      ctx.beginPath();
      ctx.moveTo(cx + p.gR * R, cy - p.gI * R);
      ctx.lineTo(cx + q.gR * R, cy - q.gI * R);
      const r2 = Math.round(167 + t * (34 - 167)), g2 = Math.round(139 + t * (211 - 139)), b2 = Math.round(250 + t * (238 - 250));
      ctx.strokeStyle = `rgb(${r2},${g2},${b2})`; ctx.lineWidth = 1.8; ctx.stroke();
    }
    // freq labels at key points
    [0, 49, 99, 149, 199].forEach((i, n) => {
      if (!sweepPoints[i]) return;
      const p = sweepPoints[i];
      const px2 = cx + p.gR * R, py2 = cy - p.gI * R;
      ctx.beginPath(); ctx.arc(px2, py2, 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#a78bfa'; ctx.fill();
      ctx.fillStyle = '#52525b'; ctx.font = '8px IBM Plex Mono'; ctx.textAlign = 'center';
      ctx.fillText(((p.f) / 1e9).toFixed(1) + 'G', px2, py2 - 6);
    });
  }

  // ── Current point ──
  const px = cx + gR * R, py = cy - gI * R;
  const gamma = Math.sqrt(gR * gR + gI * gI);
  const ptColor = gamma < 0.2 ? '#4ade80' : gamma < 0.333 ? '#fbbf24' : '#f87171';

  // Crosshairs
  ctx.strokeStyle = 'rgba(34,211,238,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, cy - R); ctx.lineTo(px, cy + R); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - R, py); ctx.lineTo(cx + R, py); ctx.stroke();

  // Outer glow ring
  ctx.beginPath(); ctx.arc(px, py, 12, 0, 2 * Math.PI);
  ctx.strokeStyle = ptColor.replace(')', ',0.2)').replace('rgb', 'rgba'); ctx.lineWidth = 6; ctx.stroke();
  // Inner ring
  ctx.beginPath(); ctx.arc(px, py, 7, 0, 2 * Math.PI);
  ctx.strokeStyle = ptColor + '88'; ctx.lineWidth = 1.5; ctx.stroke();
  // Centre dot
  ctx.beginPath(); ctx.arc(px, py, 4, 0, 2 * Math.PI);
  ctx.fillStyle = ptColor; ctx.fill();

  // Centre of chart
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
  ctx.fillStyle = '#52525b'; ctx.fill();

  // Corner labels
  ctx.fillStyle = '#3f3f46'; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'center';
  ctx.fillText('matched', cx, cy + R + 14);
  ctx.textAlign = 'right'; ctx.fillText('short', cx - R + 4, cy + 11);
  ctx.textAlign = 'left'; ctx.fillText('open', cx + R - 4, cy + 11);

  // Region legend
  ctx.font = '8px IBM Plex Mono'; ctx.textAlign = 'left';
  [[cx - R + 4, cy - R + 10, 'rgba(74,222,128,0.7)', 'VSWR<1.5'],
  [cx - R + 4, cy - R + 22, 'rgba(251,191,36,0.7)', 'VSWR<3'],
  [cx - R + 4, cy - R + 34, 'rgba(248,113,113,0.7)', 'VSWR>3']
  ].forEach(([lx, ly, c, t]) => {
    ctx.fillStyle = c; ctx.fillRect(lx, ly - 7, 8, 8);
    ctx.fillStyle = '#52525b'; ctx.fillText(t, lx + 11, ly);
  });
}

/* ============================================================
   PANEL 6: LEARNING CONTENT
============================================================ */
const learnData = [
  {
    title: 'Beginner', content: `
<h3>What is Impedance?</h3>
Impedance (Z) is the total opposition a circuit offers to AC current — like resistance, but for signals. It has two parts: a real part (resistance R) and an imaginary part (reactance X).
<div class="formula-box">Z = R + jX  (Ohms)</div>
<h3>What is Impedance Matching?</h3>
When a signal source and load have the same impedance, maximum power flows between them. Mismatch causes reflections — power bounces back instead of being delivered.
<div class="callout">💡 In RF systems, the "standard" impedance is 50Ω — this is why all coax cables, antennas, and equipment use 50Ω.</div>
<h3>What is Reflection?</h3>
When a signal hits a mismatch, part of it reflects back toward the source. The reflection coefficient Γ (Gamma) tells us how much:
<div class="formula-box">Γ = (ZL − Z₀) / (ZL + Z₀)</div>
If ZL = Z₀: Γ = 0 → no reflection, perfect match.<br>
If ZL = 0 (short): Γ = -1 → total reflection.<br>
If ZL = ∞ (open): Γ = +1 → total reflection.
<h3>What is VSWR?</h3>
VSWR (Voltage Standing Wave Ratio) is a way to express how bad a mismatch is. VSWR = 1:1 is perfect. VSWR = 2:1 means ~11% of power is reflected.
<div class="formula-box">VSWR = (1 + |Γ|) / (1 − |Γ|)</div>`},
  {
    title: 'Intermediate', content: `
<h3>Return Loss</h3>
Return Loss expresses reflected power in dB. Higher = better (less reflection). >20 dB is excellent.
<div class="formula-box">RL = −20 × log₁₀(|Γ|)  [dB]</div>
<table style="width:100%;margin-top:8px;font-size:11px;border-collapse:collapse">
<tr><td style="color:var(--t3);padding:4px 0">RL > 20 dB</td><td style="color:#4ade80">Excellent (&lt;1% power reflected)</td></tr>
<tr><td style="color:var(--t3);padding:4px 0">RL 10–20 dB</td><td style="color:#fbbf24">Acceptable (1–10% reflected)</td></tr>
<tr><td style="color:var(--t3);padding:4px 0">RL &lt; 10 dB</td><td style="color:#f87171">Poor (&gt;10% reflected)</td></tr>
</table>
<h3>Inductive vs Capacitive Loads</h3>
A load with positive X (inductive) stores energy in a magnetic field. Negative X (capacitive) stores it in an electric field. The reactance changes with frequency:
<div class="formula-box">XL = 2πfL  (rises with frequency)<br>XC = 1/(2πfC)  (falls with frequency)</div>
<h3>Resonance</h3>
When XL = XC, they cancel out and the circuit is purely resistive. This is the resonant frequency:
<div class="formula-box">f₀ = 1 / (2π√(LC))</div>
<div class="callout">💡 Antenna design usually targets resonance — you want XL = XC at your operating frequency so the antenna looks purely resistive to the feed line.</div>
<h3>Power and Mismatch Loss</h3>
<div class="formula-box">P_delivered = (1 − |Γ|²) × P_incident</div>
Mismatch loss in dB:
<div class="formula-box">ML = −10 × log₁₀(1 − |Γ|²)</div>`},
  {
    title: 'Advanced', content: `
<h3>L-Network Matching Theory</h3>
An L-network uses two reactive components to transform one impedance to another. The key design parameter is the Q factor:
<div class="formula-box">Q = √(R_high / R_low − 1)</div>
For Z₀=50Ω and RL=200Ω: Q = √(200/50 − 1) = √3 ≈ 1.73
<h3>Network Topology</h3>
The position of series/shunt elements determines LP or HP response:
<ul style="margin:8px 0 8px 16px;font-size:12px;line-height:2;color:var(--t2)">
<li>Series L + Shunt C → Low-Pass</li>
<li>Series C + Shunt L → High-Pass</li>
<li>Series element goes on the high-R side</li>
<li>Shunt element goes on the low-R side</li>
</ul>
<h3>Smith Chart Navigation</h3>
On the Smith Chart, normalized impedance z = Z/Z₀ maps to a reflection coefficient plane:
<div class="formula-box">Γ = (z − 1) / (z + 1)</div>
<ul style="margin:8px 0 8px 16px;font-size:12px;line-height:2;color:var(--t2)">
<li>Center (0+j0) = perfect match</li>
<li>Left edge = short circuit</li>
<li>Right edge = open circuit</li>
<li>Moving clockwise = adding series C or shunt L</li>
<li>Moving counterclockwise = adding series L or shunt C</li>
</ul>
<div class="callout">💡 Adding a series element moves you along a constant-R circle. Adding a shunt element moves you along a constant-G (conductance) circle.</div>
<h3>Transmission Line Stubs</h3>
An open or shorted transmission line stub can create any reactance value. At λ/4, a shorted stub looks like an open circuit (and vice versa) — useful for filter design without lumped components.
<div class="formula-box">Z_in(shorted) = jZ₀ × tan(βl)<br>Z_in(open) = −jZ₀ × cot(βl)</div>`}
];

function setLearnLevel(idx, btn) {
  document.querySelectorAll('.learn-level-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('learnContent').innerHTML = learnData[idx].content;
}

/* ============================================================
   WAVE: CLICK INSPECTOR + VSWR MEASUREMENT MARKERS
============================================================ */
let waveMarkers = { 1: null, 2: null };  // positions as fraction 0–1 along line
let nextMarkerToPlace = null;       // 1 or 2 — which marker clicks place next

function placeMarker(n) {
  nextMarkerToPlace = n;
  const btn = document.getElementById('wMark' + (n === 1 ? 1 : 2) + 'Btn');
  document.getElementById('wMark1Btn').style.fontWeight = (n === 1 ? '700' : '400');
  document.getElementById('wMark2Btn').style.fontWeight = (n === 2 ? '700' : '400');
  document.getElementById('wMarkerReadout').textContent = 'Click on the wave to place M' + n + '…';
}

function clearMarkers() {
  waveMarkers = { 1: null, 2: null };
  nextMarkerToPlace = null;
  document.getElementById('wMark1Btn').style.fontWeight = '400';
  document.getElementById('wMark2Btn').style.fontWeight = '400';
  document.getElementById('wMarkerReadout').textContent = '';
  drawWaveOverlay();
}

function initWaveInteraction() {
  const cv = document.getElementById('waveCanvas');

  cv.addEventListener('click', e => {
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (cv.width / rect.width);
    const ox = 40, ow = cv.width - 80;
    const frac = Math.max(0, Math.min(1, (x - ox) / ow));

    if (nextMarkerToPlace) {
      waveMarkers[nextMarkerToPlace] = frac;
      nextMarkerToPlace = null;
      document.getElementById('wMark1Btn').style.fontWeight = '400';
      document.getElementById('wMark2Btn').style.fontWeight = '400';
      updateMarkerReadout();
      drawWaveOverlay();
      return;
    }

    // Inspector: show V, I, Z at this position
    const gamma = parseFloat(document.getElementById('wGamma').value) / 100;
    const refSign = (wTermMode === 'short') ? -1 : 1;
    const userPhase = parseFloat(document.getElementById('wPhase').value) * Math.PI / 180;
    // Voltage standing wave: |V(x)| = |1 + Γ·e^(j2βx)| (simplified envelope)
    const vFwd = Math.cos(2 * Math.PI * frac + userPhase);
    const vRef = gamma * refSign * Math.cos(2 * Math.PI * (1 - frac) + userPhase);
    const vTotal = vFwd + vRef;
    const iTotal = vFwd - vRef; // current is complementary
    // Local impedance at this point (normalised, simplified)
    const zNorm = Math.abs(vTotal) < 0.001 ? Infinity : Math.abs(vTotal) / Math.abs(iTotal);
    const Z0 = 50;
    const freqMHz = parseFloat(document.getElementById('wFreq').value);
    const lambda = 300 / freqMHz;
    const posMeters = (frac * lambda).toFixed(3);
    const posLambda = (frac).toFixed(3);

    const ins = document.getElementById('waveInspector');
    const col = v => v > 0 ? 'var(--green)' : 'var(--red)';
    ins.innerHTML =
      `<div><div style="font-size:9px;color:var(--t3)">Position</div><div style="color:var(--acc)">${posMeters} m (${posLambda}λ)</div></div>` +
      `<div><div style="font-size:9px;color:var(--t3)">V (norm.)</div><div style="color:${col(vTotal)}">${vTotal.toFixed(3)}</div></div>` +
      `<div><div style="font-size:9px;color:var(--t3)">I (norm.)</div><div style="color:${col(iTotal)}">${iTotal.toFixed(3)}</div></div>` +
      `<div><div style="font-size:9px;color:var(--t3)">|Z| (Ω)</div><div style="color:var(--yellow)">${isFinite(zNorm) ? (zNorm * Z0).toFixed(1) + ' Ω' : '∞'}</div></div>`;

    // Draw inspection dot on overlay
    drawWaveOverlay(frac);
  });

  // Hover: live readout without click
  cv.addEventListener('mousemove', e => {
    if (nextMarkerToPlace) cv.style.cursor = 'crosshair';
    else cv.style.cursor = 'pointer';
  });
}

function updateMarkerReadout() {
  const m1 = waveMarkers[1], m2 = waveMarkers[2];
  if (m1 === null || m2 === null) {
    if (m1 !== null || m2 !== null) {
      const set = m1 !== null ? 1 : 2;
      document.getElementById('wMarkerReadout').textContent = 'M' + set + ' placed. Place M' + (3 - set) + ' to measure.';
    }
    return;
  }
  const gamma = parseFloat(document.getElementById('wGamma').value) / 100;
  const vswr = (1 + gamma) / (1 - gamma + 1e-10);
  const freqMHz = parseFloat(document.getElementById('wFreq').value);
  const lambda = 300 / freqMHz;
  const dist = Math.abs(m2 - m1);
  const distM = (dist * lambda).toFixed(3);
  const distLambda = dist.toFixed(3);
  // VSWR from envelope at markers
  const refSign = (wTermMode === 'short') ? -1 : 1;
  function env(frac) {
    const v1 = Math.cos(2 * Math.PI * frac);
    const v2 = gamma * refSign * Math.cos(2 * Math.PI * (1 - frac));
    return Math.abs(v1 + v2);
  }
  const e1 = env(m1), e2 = env(m2);
  const vmax = Math.max(e1, e2), vmin = Math.min(e1, e2) + 0.001;
  const measVSWR = (vmax / vmin).toFixed(3);
  document.getElementById('wMarkerReadout').innerHTML =
    `M1→M2: <span style="color:var(--acc)">${distM} m</span> (${distLambda}λ) &nbsp;|&nbsp; ` +
    `Env ratio: <span style="color:var(--yellow)">${measVSWR}</span> &nbsp;|&nbsp; ` +
    `True VSWR: <span style="color:var(--green)">${vswr.toFixed(3)}</span>`;
}

function drawWaveOverlay(inspectFrac) {
  const ov = document.getElementById('waveOverlay');
  if (!ov) return;
  const W = ov.offsetWidth || 600, H = ov.offsetHeight || 400;
  ov.width = W; ov.height = H;
  const ctx = ov.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const ox = 40, ow = W - 80, midY = H / 2;

  // Draw VSWR markers
  const colors = ['#22d3ee', '#fbbf24'];
  [1, 2].forEach(n => {
    const frac = waveMarkers[n];
    if (frac === null) return;
    const x = ox + frac * ow;
    const col = colors[n - 1];
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, midY, 5, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = col; ctx.font = 'bold 10px IBM Plex Mono'; ctx.textAlign = 'center';
    ctx.fillText('M' + n, x, 14);
  });

  // Draw connecting band between markers if both set
  if (waveMarkers[1] !== null && waveMarkers[2] !== null) {
    const x1 = ox + waveMarkers[1] * ow, x2 = ox + waveMarkers[2] * ow;
    ctx.fillStyle = 'rgba(251,191,36,0.06)';
    ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), H);
  }

  // Draw inspection dot
  if (inspectFrac !== undefined) {
    const x = ox + inspectFrac * ow;
    ctx.beginPath(); ctx.arc(x, midY, 8, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(251,191,36,0.8)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, midY, 3, 0, 2 * Math.PI);
    ctx.fillStyle = '#fbbf24'; ctx.fill();
  }
}

/* ============================================================
   HOVER GLOSSARY — works on all tabs
============================================================ */
const GLOSSARY = {
  'VSWR': 'Voltage Standing Wave Ratio. Ratio of max to min voltage on a transmission line. VSWR=1 is perfect match; higher = more mismatch.',
  'vswr': 'Voltage Standing Wave Ratio. Ratio of max to min voltage on a transmission line. VSWR=1 is perfect match; higher = more mismatch.',
  'Γ': 'Reflection coefficient (Gamma). Complex number describing how much of a signal is reflected at an impedance discontinuity. |Γ| ranges 0 (matched) to 1 (total reflection).',
  'Gamma': 'Reflection coefficient. Complex number |Γ|∠θ. Magnitude = fraction of voltage reflected; angle = phase shift on reflection.',
  'Return Loss': 'Power reflected expressed in dB. RL = −20·log|Γ|. Higher is better — >20 dB is excellent.',
  'RL': 'Return Loss. Power reflected expressed in dB. RL = −20·log|Γ|. Higher is better — >20 dB is excellent.',
  'Impedance': 'Opposition to AC current flow. Z = R + jX. R is resistance (dissipates energy), X is reactance (stores energy).',
  'impedance': 'Opposition to AC current flow. Z = R + jX. R is resistance (dissipates energy), X is reactance (stores energy).',
  'reactance': 'Imaginary part of impedance. Positive X = inductive (L), negative X = capacitive (C). Reactance changes with frequency.',
  'Reactance': 'Imaginary part of impedance. Positive X = inductive (L), negative X = capacitive (C). Reactance changes with frequency.',
  'Smith Chart': 'Circular chart mapping normalised impedance to the reflection coefficient plane. The centre = perfect match; edge = total reflection.',
  'L-network': 'Two-element matching network (one series + one shunt component). Can match any two resistive impedances. Q = √(Rhigh/Rlow − 1).',
  'Q factor': 'Quality factor of a matching network. Q = √(Rhigh/Rlow−1). Higher Q = narrower bandwidth but more sensitive to tolerance.',
  'resonance': 'Frequency where XL = XC, so they cancel and load looks purely resistive. f₀ = 1/(2π√LC).',
  'mismatch': 'When source and load impedances differ, causing partial signal reflection. Measured by VSWR or Return Loss.',
  'Z₀': 'Characteristic impedance of a transmission line or system reference. Standard is 50Ω for RF; 75Ω for cable TV.',
  'ZL': 'Load impedance — the complex impedance of the device being driven (antenna, amplifier input, etc.).',
  'node': 'Point of zero voltage amplitude on a standing wave. Occurs at multiples of λ/2 from a short-circuit termination.',
  'antinode': 'Point of maximum voltage amplitude on a standing wave. Occurs at odd multiples of λ/4 from a short-circuit termination.',
  'E12': 'Standard resistor/capacitor value series with 12 values per decade (1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2).',
  'tolerance': 'Component value accuracy. ±5% means actual value is within 5% of nominal. Affects matching network VSWR in practice.',
  'inductive': 'Load with positive reactance (X > 0). Stores energy in a magnetic field. Fix: add series capacitor to cancel.',
  'capacitive': 'Load with negative reactance (X < 0). Stores energy in an electric field. Fix: add series inductor to cancel.',
  'bandwidth': 'Frequency range over which VSWR stays below 2:1. BW ≈ f₀/Q for a matched L-network.',
};

function initGlossary() {
  const tip = document.getElementById('glossaryTip');

  // Walk all text nodes and wrap glossary terms
  function wrapTerms(root) {
    const terms = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    const nodes = [];
    let node;
    while (node = walker.nextNode()) {
      if (['SCRIPT', 'STYLE', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.parentNode.tagName)) continue;
      if (node.parentNode.classList && node.parentNode.classList.contains('glossary-term')) continue;
      nodes.push(node);
    }
    nodes.forEach(n => {
      let html = n.textContent;
      let replaced = false;
      terms.forEach(term => {
        const re = new RegExp('\\b(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\b', 'g');
        if (re.test(html)) {
          html = html.replace(re, `<span class="glossary-term" data-term="${term}">$1</span>`);
          replaced = true;
        }
      });
      if (replaced) {
        const span = document.createElement('span');
        span.innerHTML = html;
        n.parentNode.replaceChild(span, n);
      }
    });
  }

  // Wrap terms in metric labels and card titles
  document.querySelectorAll('.metric-name,.card-title,.field-label,.ai-msg,.learn-content,.sweep-chip,.wterm-btn').forEach(el => {
    try { wrapTerms(el); } catch (e) { }
  });

  // Tooltip show/hide
  document.addEventListener('mouseover', e => {
    const t = e.target.closest('.glossary-term');
    if (!t) return;
    const term = t.getAttribute('data-term');
    if (!GLOSSARY[term]) return;
    tip.innerHTML = `<strong>${term}</strong>${GLOSSARY[term]}`;
    tip.style.display = 'block';
  });
  document.addEventListener('mousemove', e => {
    if (tip.style.display === 'none') return;
    const margin = 12;
    let left = e.clientX + margin;
    let top = e.clientY + margin;
    if (left + 270 > window.innerWidth) left = e.clientX - 270 - margin;
    if (top + 120 > window.innerHeight) top = e.clientY - 120 - margin;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  });
  document.addEventListener('mouseout', e => {
    if (!e.target.closest('.glossary-term')) return;
    tip.style.display = 'none';
  });
}

/* ============================================================
   PRINTABLE CHEAT SHEET
============================================================ */
function printCheatSheet() {
  const win = window.open('', '_blank', 'width=800,height=900');
  win.document.write(`<!DOCTYPE html><html><head><title>RF Design Lab — Cheat Sheet</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Mono',monospace;background:#fff;color:#111;padding:32px;font-size:12px}
h1{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#09090b;margin-bottom:4px}
.sub{font-size:11px;color:#666;margin-bottom:28px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.section{margin-bottom:20px}
h2{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#888;margin-bottom:10px;padding-bottom:4px;border-bottom:1px solid #e5e5e5}
.formula{background:#f8f8f8;border-left:3px solid #22d3ee;padding:6px 10px;border-radius:0 4px 4px 0;margin-bottom:6px;font-size:12px;color:#09090b}
.formula .name{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#888;margin-bottom:2px}
table{width:100%;border-collapse:collapse;font-size:11px}
td{padding:5px 8px;border-bottom:1px solid #f0f0f0}
td:first-child{color:#666;width:45%}
td:last-child{font-weight:600}
.good{color:#16a34a}.warn{color:#ca8a04}.bad{color:#dc2626}
.smith-note{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:10px 12px;font-size:11px;color:#166534;margin-top:8px;line-height:1.7}
.footer{margin-top:24px;font-size:10px;color:#aaa;border-top:1px solid #eee;padding-top:12px;text-align:center}
@media print{body{padding:16px}.no-print{display:none}}
</style>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Syne:wght@800&display=swap" rel="stylesheet">
</head><body>
<h1>RF Design Lab</h1>
<div class="sub">Quick Reference Cheat Sheet — generated ${new Date().toLocaleDateString()}</div>
<button class="no-print" onclick="window.print()" style="margin-bottom:20px;padding:8px 16px;background:#22d3ee;border:none;border-radius:4px;font-family:monospace;cursor:pointer;font-weight:600">Print / Save as PDF</button>

<div class="grid">
<div>
  <div class="section">
    <h2>Core Formulas</h2>
    <div class="formula"><div class="name">Reflection Coefficient</div>Γ = (ZL − Z₀) / (ZL + Z₀)</div>
    <div class="formula"><div class="name">VSWR</div>VSWR = (1 + |Γ|) / (1 − |Γ|)</div>
    <div class="formula"><div class="name">Return Loss</div>RL = −20 · log₁₀(|Γ|)  [dB]</div>
    <div class="formula"><div class="name">Mismatch Loss</div>ML = −10 · log₁₀(1 − |Γ|²)  [dB]</div>
    <div class="formula"><div class="name">Power Delivered</div>P_del = (1 − |Γ|²) × P_inc</div>
    <div class="formula"><div class="name">Inductive Reactance</div>XL = 2π · f · L</div>
    <div class="formula"><div class="name">Capacitive Reactance</div>XC = 1 / (2π · f · C)</div>
    <div class="formula"><div class="name">Resonant Frequency</div>f₀ = 1 / (2π · √(LC))</div>
    <div class="formula"><div class="name">L-Network Q Factor</div>Q = √(R_high / R_low − 1)</div>
    <div class="formula"><div class="name">Impedance</div>Z = R + jX  [Ω]</div>
  </div>

  <div class="section">
    <h2>VSWR Reference</h2>
    <table>
      <tr><td>VSWR = 1.00</td><td class="good">Perfect match</td></tr>
      <tr><td>VSWR &lt; 1.50</td><td class="good">Excellent</td></tr>
      <tr><td>VSWR &lt; 2.00</td><td class="warn">Good (2:1)</td></tr>
      <tr><td>VSWR &lt; 3.00</td><td class="warn">Marginal</td></tr>
      <tr><td>VSWR ≥ 3.00</td><td class="bad">Poor</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Return Loss Reference</h2>
    <table>
      <tr><td>RL &gt; 20 dB</td><td class="good">Excellent (&lt;1% reflected)</td></tr>
      <tr><td>RL 10–20 dB</td><td class="warn">Acceptable (1–10%)</td></tr>
      <tr><td>RL &lt; 10 dB</td><td class="bad">Poor (&gt;10% reflected)</td></tr>
    </table>
  </div>
</div>

<div>
  <div class="section">
    <h2>Termination Conditions</h2>
    <table>
      <tr><td>Matched (ZL=Z₀)</td><td>Γ = 0, VSWR = 1</td></tr>
      <tr><td>Open circuit</td><td>Γ = +1 ∠0°, VSWR = ∞</td></tr>
      <tr><td>Short circuit</td><td>Γ = −1 ∠180°, VSWR = ∞</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>L-Network Matching</h2>
    <table>
      <tr><td>Series L + Shunt C</td><td>Low-pass response</td></tr>
      <tr><td>Series C + Shunt L</td><td>High-pass response</td></tr>
      <tr><td>Series element</td><td>Goes on high-R side</td></tr>
      <tr><td>Shunt element</td><td>Goes on low-R side</td></tr>
      <tr><td>Bandwidth</td><td>BW ≈ f₀ / Q</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Smith Chart Navigation</h2>
    <div class="smith-note">
      Centre = perfect match (Γ=0)<br>
      Left edge = short circuit (Γ=−1)<br>
      Right edge = open circuit (Γ=+1)<br>
      Upper half = inductive (X &gt; 0)<br>
      Lower half = capacitive (X &lt; 0)<br>
      Series element → move along constant-R circle<br>
      Shunt element → move along constant-G circle<br>
      Clockwise = add series C or shunt L<br>
      Counter-clockwise = add series L or shunt C
    </div>
  </div>

  <div class="section">
    <h2>E12 Standard Values</h2>
    <div style="font-size:11px;color:#444;line-height:2">
      1.0 · 1.2 · 1.5 · 1.8 · 2.2 · 2.7 · 3.3 · 3.9 · 4.7 · 5.6 · 6.8 · 8.2<br>
      <span style="color:#888">× 10ⁿ for any n (pF, nH, Ω…)</span>
    </div>
  </div>
</div>
</div>

<div class="footer">RF Design Lab · All calculations pure JavaScript · Open in any browser</div>
</body></html>`);
  win.document.close();
}
let sweepPins = [];

function initSweepPins() {
  ['vswrChart', 'rlChart', 'gammaChart'].forEach((id, ci) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    canvas.style.cursor = 'crosshair';
    canvas.addEventListener('click', e => {
      const chart = canvas._chart;
      if (!chart || !lastSweepData) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const area = chart.chartArea;
      const frac = Math.max(0, Math.min(1, (x - area.left) / (area.right - area.left)));
      const { freqs, vswrArr, rlArr, gammaArr } = lastSweepData;
      const idx = Math.min(Math.floor(frac * (freqs.length - 1)), freqs.length - 1);
      sweepPins.push({ frac, freq: parseFloat(freqs[idx]), vswr: vswrArr[idx], rl: rlArr[idx], gamma: gammaArr[idx] });
      drawAllPins();
      const info = `Pin ${sweepPins.length}: ${parseFloat(freqs[idx]).toFixed(1)} MHz | VSWR=${vswrArr[idx].toFixed(2)} | RL=${rlArr[idx].toFixed(1)}dB | |Γ|=${gammaArr[idx].toFixed(3)}`;
      document.getElementById('pinReadout').textContent = info;
    });
  });
}

function drawAllPins() {
  [1, 2, 3].forEach(n => {
    const ov = document.getElementById('pinOverlay' + n);
    if (!ov) return;
    const chartId = ['vswrChart', 'rlChart', 'gammaChart'][n - 1];
    const chart = document.getElementById(chartId)._chart;
    if (!chart) return;
    const W = ov.offsetWidth, H = ov.offsetHeight;
    ov.width = W; ov.height = H;
    const ctx = ov.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const area = chart.chartArea;
    if (!area) return;
    const vals = ['vswr', 'rl', 'gamma'];
    const key = vals[n - 1];
    sweepPins.forEach((pin, i) => {
      const sx = area.left + (area.right - area.left) * pin.frac;
      ctx.strokeStyle = 'rgba(251,191,36,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(sx, area.top); ctx.lineTo(sx, area.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(sx, area.top + 16, 7, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(251,191,36,0.85)'; ctx.fill();
      ctx.fillStyle = '#09090b'; ctx.font = 'bold 9px IBM Plex Mono'; ctx.textAlign = 'center';
      ctx.fillText(i + 1, sx, area.top + 20);
      ctx.fillStyle = 'rgba(251,191,36,0.9)'; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'left';
      const val = pin[key];
      ctx.fillText(typeof val === 'number' ? val.toFixed(2) : '', sx + 4, area.top + 32);
    });
  });
}

function clearPins() {
  sweepPins = [];
  [1, 2, 3].forEach(n => {
    const ov = document.getElementById('pinOverlay' + n);
    if (ov) { const ctx = ov.getContext('2d'); ctx.clearRect(0, 0, ov.width, ov.height); }
  });
  document.getElementById('pinReadout').textContent = '';
}

/* ============================================================
   PANEL 6: GUIDED WALKTHROUGH
============================================================ */
const GUIDE_STEPS = [
  {
    title: 'Welcome to the RF Design Lab',
    body: 'This guided tour walks you through the core concepts of RF impedance matching, with live demos at each step. Click NEXT to begin.',
    action: null, tab: null
  },
  {
    title: 'Step 1 — What is impedance?',
    body: 'Impedance Z = R + jX is the total opposition to AC signals. The real part R dissipates energy. The imaginary part X stores it. Go to the Impedance tab and set R=50, X=0.',
    action: { label: 'Go to Impedance tab →', fn: () => document.querySelector('.tab').click() },
    tab: 'impedance', preset: [50, 0]
  },
  {
    title: 'Step 2 — Perfect match',
    body: 'With R=50Ω, X=0 and Z₀=50Ω, VSWR=1.00 and Return Loss=∞. All power is delivered. The phasor arrow points directly along the real axis.',
    action: { label: 'Set perfect match', fn: () => setPreset(50, 0) },
    tab: 'impedance', preset: [50, 0]
  },
  {
    title: 'Step 3 — Create a mismatch',
    body: 'Change R to 150Ω. VSWR jumps above 1.5 — you\'ve introduced a resistive mismatch. Watch the Γ angle stay at 0° because there\'s no reactance.',
    action: { label: 'Set R=150Ω mismatch', fn: () => setPreset(150, 0) },
    tab: 'impedance', preset: [150, 0]
  },
  {
    title: 'Step 4 — Add reactance',
    body: 'Now set R=75, X=+40 (inductive load). The phasor tilts upward. VSWR worsens further. The AI diagnoses it as inductive and suggests a series capacitor fix.',
    action: { label: 'Set inductive load', fn: () => setPreset(75, 40) },
    tab: 'impedance', preset: [75, 40]
  },
  {
    title: 'Step 5 — Frequency sweep',
    body: 'On the Sweep tab, select Series RLC with R=50, L=10nH, C=10pF. Watch the VSWR dip at resonance — that\'s where XL=XC and the load looks purely resistive.',
    action: { label: 'Go to Sweep tab →', fn: () => document.querySelectorAll('.tab')[1].click() },
    tab: 'sweep'
  },
  {
    title: 'Step 6 — Wave physics',
    body: 'On the Wave tab, try the three termination modes: Matched (no standing wave), Open (voltage maximum at load), Short (voltage node at load with phase reversal).',
    action: { label: 'Go to Wave tab →', fn: () => document.querySelectorAll('.tab')[2].click() },
    tab: 'wave'
  },
  {
    title: 'Step 7 — Auto-matching',
    body: 'On the Matching tab, enter RL=150, XL=0, Z₀=50. The L-network calculates exact component values. Toggle ±5% tolerance to see the VSWR worst-case band.',
    action: { label: 'Go to Matching tab →', fn: () => document.querySelectorAll('.tab')[3].click() },
    tab: 'match'
  },
  {
    title: 'Step 8 — Smith Chart mastery',
    body: 'On the Smith Chart, drag the point around. The coloured regions show VSWR zones. Enable the frequency sweep locus to see how a reactive load spirals with frequency.',
    action: { label: 'Go to Smith Chart →', fn: () => document.querySelectorAll('.tab')[4].click() },
    tab: 'smith'
  },
  {
    title: 'Tour complete!',
    body: 'You\'ve covered impedance, VSWR, frequency response, standing waves, matching circuits and the Smith Chart. You\'re ready to design real RF systems. Good luck!',
    action: null, tab: null
  },
];

let guideIdx = 0;

function startGuide() {
  guideIdx = 0;
  document.getElementById('learnContent').style.display = 'none';
  document.getElementById('guideOverlay').style.display = 'block';
  document.querySelectorAll('.learn-level-btn:not(#llbGuide)').forEach(b => b.classList.remove('active'));
  renderGuideStep();
}

function stopGuide() {
  document.getElementById('guideOverlay').style.display = 'none';
  document.getElementById('learnContent').style.display = 'block';
  setLearnLevel(0, document.getElementById('llb0'));
}

function guideStep(dir) {
  guideIdx = Math.max(0, Math.min(GUIDE_STEPS.length - 1, guideIdx + dir));
  renderGuideStep();
}

function renderGuideStep() {
  const step = GUIDE_STEPS[guideIdx];
  const total = GUIDE_STEPS.length;

  // Dots
  const dots = document.getElementById('guideDots');
  dots.innerHTML = Array.from({ length: total }, (_, i) =>
    `<div style="width:${i === guideIdx ? 16 : 6}px;height:6px;border-radius:3px;background:${i === guideIdx ? 'var(--acc)' : 'var(--border2)'};transition:width .2s"></div>`
  ).join('');

  // Next/Finish button
  const btn = document.getElementById('guideNextBtn');
  btn.textContent = guideIdx === total - 1 ? 'FINISH' : 'NEXT →';
  if (guideIdx === total - 1) btn.onclick = stopGuide;
  else btn.onclick = () => guideStep(1);

  document.getElementById('guideContent').innerHTML =
    `<h3 style="margin-bottom:8px">${step.title}</h3>${step.body}`;

  // Action button
  const actionDiv = document.getElementById('guideAction');
  if (step.action) {
    actionDiv.innerHTML = `<button class="btn primary" style="font-size:11px;padding:6px 14px" onclick="(${step.action.fn.toString()})()">${step.action.label}</button>`;
    if (step.preset) actionDiv.innerHTML += ` <span style="font-size:10px;color:var(--t3);margin-left:8px">or set manually on the tab</span>`;
  } else {
    actionDiv.innerHTML = '';
  }
}

function initScopeBg() {
  const cv = document.getElementById('scopeBg');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  let w = cv.width = window.innerWidth;
  let h = cv.height = window.innerHeight;

  window.addEventListener('resize', () => {
    w = cv.width = window.innerWidth;
    h = cv.height = window.innerHeight;
  });

  let time = 0;

  function getActiveFreq() {
    const activePanel = document.querySelector('.panel.active');
    if (!activePanel) return 1000;
    const id = activePanel.id;
    if (id === 'panel-impedance') return parseFloat(document.getElementById('diagFreq').value) || 2400;
    if (id === 'panel-sweep') {
      const maxFreq = parseFloat(document.getElementById('freqRange').value) || 1000;
      const markerPos = parseFloat(document.getElementById('freqMarker').value) / 100 || 0.5;
      return maxFreq * markerPos;
    }
    if (id === 'panel-wave') return parseFloat(document.getElementById('wFreq').value) || 100;
    if (id === 'panel-match') return parseFloat(document.getElementById('mFreq').value) || 2400;
    return 1000;
  }

  function draw() {
    ctx.fillStyle = 'rgba(9, 9, 11, 0.15)';
    ctx.fillRect(0, 0, w, h);

    const freq = getActiveFreq();

    ctx.strokeStyle = 'rgba(39, 39, 42, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gridSize = Math.max(50, Math.min(w, h) / 10);
    for (let x = w / 2 % gridSize; x < w; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = h / 2 % gridSize; y < h; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(34, 211, 238, 0.15)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.stroke();

    const speed = 0.02 + (freq / 6000) * 0.08;
    const waveLen = w / (2 + (freq / 1000) * 4);

    time += speed;

    const midY = h / 2;
    const amp = h * 0.25;

    const drawTrace = (harmonic, amplitudeMult, color, lineWidth) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      for (let x = 0; x < w; x += 4) {
        const t = x / w;
        const y = midY + Math.sin(t * Math.PI * 2 * (w / waveLen) * harmonic + time * harmonic) * (amp * amplitudeMult);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawTrace(1, 1.0, '#22d3ee', 2);
    drawTrace(2, 0.3, 'rgba(167, 139, 250, 0.6)', 1.5);
    drawTrace(3, 0.15, 'rgba(251, 146, 60, 0.4)', 1);

    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.8);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 1);
    }

    ctx.fillStyle = '#22d3ee';
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('FREQ: ' + freq.toFixed(1) + ' MHz', w - 24, 30);
    ctx.fillText('SPAN: ' + (freq * 0.5).toFixed(1) + ' MHz', w - 24, 48);
    ctx.fillText('ACQ: RUN', w - 24, 66);

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(34, 211, 238, 0.6)';
    ctx.fillText('CH1 10dB/div', 24, h - 24);

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('rf-theme', isLight ? 'light' : 'dark');
  const icon = document.getElementById('themeIcon');
  if (isLight) {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
  } else {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
  }
}

if (localStorage.getItem('rf-theme') === 'light') {
  document.documentElement.classList.add('light');
}

window.addEventListener('DOMContentLoaded', () => {
  if (document.documentElement.classList.contains('light')) {
    document.getElementById('themeIcon').innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
  }

  // Add Tooltips to Tabs
  const tabTips = {
    'IMPEDANCE': 'Analyze load impedance and calculate reflection coefficients.',
    'SWEEP': 'Sweep frequency and visualize VSWR over a selected band.',
    'WAVE SIM': 'Simulate standing waves on a transmission line.',
    'MATCHING': 'Design L-networks to perfectly match load to source.',
    'SMITH CHART': 'Visualize complex impedances on an interactive Smith Chart.',
    'LEARN': 'Educational reference material on RF and Microwave concepts.'
  };
  document.querySelectorAll('.tab').forEach(tab => {
    let text = tab.textContent;
    const numSpan = tab.querySelector('.tab-num');
    if (numSpan) text = text.replace(numSpan.textContent, '');
    text = text.trim();
    if (tabTips[text]) {
      const icon = document.createElement('span');
      icon.className = 'info-icon';
      icon.textContent = 'i';
      icon.setAttribute('data-tip', tabTips[text]);
      icon.onclick = (e) => e.stopPropagation();
      tab.appendChild(icon);
    }
  });

  // Add Tooltips to Card Titles
  const cardTips = {
    'Load Parameters': 'Adjust resistance (R) and reactance (X) of your load.',
    'Antenna Presets': 'Quickly load common antenna types or stubs.',
    'Results': 'Key metrics derived from your load impedance at reference Z₀.',
    'Impedance Phasor': 'Visual representation of resistive vs reactive components.',
    'AI Analysis Dashboard': 'Real-time intelligent diagnostic of matching conditions and automated corrective suggestions.',
    'Component Model': 'Simulate different matching networks (RC, RL, LC, RLC).',
    'Sweep Summary': 'Snapshot of resonant frequency, bandwidth, and lowest VSWR.',
    'VSWR vs Frequency': 'Graph comparing VSWR across your sweep range.',
    'Return Loss vs Frequency': 'Graph detailing how much signal is reflected back (dB).',
    '|Γ| vs Frequency': 'Magnitude of the reflection coefficient across the bandwidth.',
    'Wave Parameters': 'Control the source frequency, phase, and the type of termination.',
    'Wave Info': 'Real-time calculation of standing wave ratio and power percentages.',
    'Visualization': 'Animation of the forward, reflected, and standing waves.',
    'Matching Parameters': 'Input values for your load to calculate an optimal LC L-Network.',
    'Computed Components': 'The exact Inductor (L) and Capacitor (C) values required.',
    'Tolerance Impact': 'See how component variation (e.g. ±5%) impacts matching.',
    'Circuit Diagram': 'Schematic of the calculated L-network based on your inputs.',
    'Before vs After': 'Performance comparison of VSWR with and without matching.',
    'Matching Path': 'Traces how the L-Network pulls impedance to the Smith Chart center.',
    'AI Analysis': 'Breakdown of your matching network Q-factor and bandwidth.',
    'Smith Chart Controls': 'Manually plot normalized Resistance and Reactance points.',
    'Point Readout': 'Readout of metrics at your specific point plotted on the chart.',
    'Smith Chart': 'Interactive visualization tracking impedance on the circular chart.',
    'Learning Mode': 'Adjust the technical depth level of the interactive guide.',
    'Quick Reference': 'Cheat sheet containing fundamental RF equations and matching charts.',
    'All Formulas': 'Complete list of math utilized to calculate these metrics.',
    'Power Metrics': 'Visually splits reflected and delivered power percentages.',
    'L-Network Impedance Matching Solver': 'Calculates exact inductor and capacitor values.'
  };
  document.querySelectorAll('.card-title').forEach(title => {
    const text = title.textContent.trim();
    let matchedTip = 'Details about this section and its configurable parameters.';
    for (let key in cardTips) {
      if (text.includes(key)) matchedTip = cardTips[key];
    }
    const icon = document.createElement('span');
    icon.className = 'info-icon';
    icon.textContent = 'i';
    icon.setAttribute('data-tip', matchedTip);
    title.appendChild(icon);
  });

  // Old Chatbot Logic Removed
});

window.addEventListener('load', () => {
  initScopeBg();
  calcImpedance();
  setLearnLevel(0, document.querySelector('.learn-level-btn'));
  updateWaveInfo();
  updateSmith();
  runSweep();
  calcMatch();
  calcPowerMetrics();

  initPhasorDrag();
  initSmithDrag();
  initSweepPins();
  initWaveInteraction();
  // Glossary runs after a tick so all DOM is ready
  setTimeout(initGlossary, 200);

  window.addEventListener('resize', () => {
    calcImpedance();
    updateSmith();
    drawWave();
    calcMatch();
    setTimeout(() => { drawMarkerOverlays(); drawAllPins(); }, 80);
  });
});

/* ============================================================
   RF ASSISTANT PANEL CLASS (Progressive Disclosure & Chat)
============================================================ */
const GEMINI_API_KEY = "AIzaSyAqhkqR203IkjsSpm4i2fPShnmd0JVhfmE";

class RFAssistantPanel {
  constructor() {
    this.root = document.getElementById('rf-assistant-root');
    this.body = document.getElementById('rfa-body');
    this.tab = document.getElementById('rfa-tab');

    // State: 0 (Hidden), 1 (Beacon), 2 (Collapsed), 3 (Expanded)
    this.state = 3;
    // LocalStorage keys
    this.HISTORY_KEY = 'rfa_session_history';
    this.history = []; // History clears on refresh

    // DOM Elements
    this.els = {
      btnExpand: document.getElementById('rfa-btn-expand'),
      btnCollapse: document.getElementById('rfa-btn-collapse'),
      btnBeacon: document.getElementById('rfa-btn-beacon'),
      btnMenu: document.getElementById('rfa-btn-menu'),
      dropdown: document.getElementById('rfa-dropdown'),

      toggleContext: document.getElementById('rfa-context-toggle'),
      severityFill: document.getElementById('rfa-vswr-fill'),
      contextVals: {
        gamma: document.getElementById('rfa-val-gamma'),
        vswr: document.getElementById('rfa-val-vswr'),
        pFwd: document.getElementById('rfa-val-pfwd'),
        pRef: document.getElementById('rfa-val-pref'),
        rl: document.getElementById('rfa-val-rl'),
        ml: document.getElementById('rfa-val-ml'),
        zL: document.getElementById('rfa-val-zl'),
        z0: document.getElementById('rfa-val-z0')
      },

      thread: document.getElementById('rfa-thread'),
      emptyState: document.getElementById('rfa-empty-state'),
      input: document.getElementById('rfa-input'),
      sendBtn: document.getElementById('rfa-send'),

      sublabel: document.getElementById('rfa-sublabel'),
      statusDot: document.getElementById('rfa-status-dot')
    };

    if (this.root) {
      this.init();
    }
  }

  init() {
    this.bindEvents();
    this.restoreHistory();
    this.updateStateUI();
    this.bootSequence();
  }

  bindEvents() {
    // 1. Tab Toggle
    this.tab.addEventListener('click', () => {
      // Toggle between Hidden (0px) and the last visible state (default to 3 if starting hidden)
      if (this.state === 0) {
        this.setState(this._lastVisibleState || 3);
        this.tab.classList.remove('rotated');
        this.tab.setAttribute('data-tooltip', 'Hide RF Assistant');
      } else {
        this._lastVisibleState = this.state;
        this.setState(0);
        this.tab.classList.add('rotated');
        this.tab.setAttribute('data-tooltip', 'Show RF Assistant');
      }
    });

    // 2. Header State Buttons
    this.els.btnExpand.addEventListener('click', () => this.setState(3));
    this.els.btnCollapse.addEventListener('click', () => this.setState(2));
    this.els.btnBeacon.addEventListener('click', () => this.setState(1));

    // 3. Overflow Menu
    this.els.btnMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      this.els.dropdown.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!this.els.dropdown.contains(e.target)) {
        this.els.dropdown.classList.remove('open');
      }
    });

    // Dropdown items
    document.getElementById('rfa-opt-clear').addEventListener('click', () => {
      this.clearHistory();
    });

    // 4. Context Toggle
    this.els.toggleContext.addEventListener('click', () => {
      const isExpanded = this.els.toggleContext.getAttribute('aria-expanded') === 'true';
      this.els.toggleContext.setAttribute('aria-expanded', !isExpanded);
    });

    // 5. Input & Messaging
    this.els.sendBtn.addEventListener('click', () => this.handleSend());
    this.els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleSend();
    });

    // 6. Suggestion Chips
    document.querySelectorAll('.rfa-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        this.els.input.value = e.target.textContent;
        this.handleSend();
      });
    });
  }

  setState(level) {
    this.state = level;
    this.updateStateUI();
  }

  updateStateUI() {
    // Determine CSS class for panel body
    const classes = ['state-hidden', 'state-beacon', 'state-collapsed', 'state-expanded'];
    this.body.className = `rfa-body ${classes[this.state]}`;

    // Manage CSS variable for Shell compression
    const root = document.documentElement;
    if (this.state === 0) root.style.setProperty('--assistant-width', '0px');
    else if (this.state === 1) root.style.setProperty('--assistant-width', '60px');
    else if (this.state === 2) root.style.setProperty('--assistant-width', '220px');
    else if (this.state === 3) root.style.setProperty('--assistant-width', '360px');

    // Update active button states
    [this.els.btnBeacon, this.els.btnCollapse, this.els.btnExpand].forEach(btn => btn.classList.remove('active'));
    if (this.state === 1) this.els.btnBeacon.classList.add('active');
    else if (this.state === 2) this.els.btnCollapse.classList.add('active');
    else if (this.state === 3) this.els.btnExpand.classList.add('active');
  }

  bootSequence() {
    const seq = ["INITIALIZING...", "CONNECTING TO ENGINE...", "SYS.READY(1)"];
    let step = 0;

    this.els.sublabel.classList.add('typing-active');
    this.els.statusDot.className = 'rfa-status-dot processing';
    this.els.sublabel.className = 'rfa-sublabel processing typing-active';

    const interval = setInterval(() => {
      this.els.sublabel.textContent = seq[step];
      step++;
      if (step >= seq.length) {
        clearInterval(interval);
        setTimeout(() => {
          this.els.sublabel.textContent = "CONNECTED - ONLINE";
          this.els.sublabel.classList.remove('typing-active');
          this.els.statusDot.className = 'rfa-status-dot connected';
          this.els.sublabel.className = 'rfa-sublabel connected';

          // Start Placeholder Rotation
          this.startPlaceholderRotation();
        }, 800);
      }
    }, 1200);
  }

  startPlaceholderRotation() {
    const texts = [
      "Ask about your current VSWR...",
      "Type a formula to evaluate...",
      "What does Return Loss signify?",
      "Why is my Smith Chart tracing rings?",
      "Simulate parameter changes..."
    ];
    let idx = 0;
    setInterval(() => {
      this.els.input.classList.add('placeholder-fade');
      setTimeout(() => {
        idx = (idx + 1) % texts.length;
        this.els.input.setAttribute('placeholder', texts[idx]);
        this.els.input.classList.remove('placeholder-fade');
      }, 200);
    }, 5000);
  }

  updateContextData() {
    if (!window.vswr_state) return;

    // Update labels with Flash
    for (const [key, val] of Object.entries(window.vswr_state)) {
      if (this.els.contextVals[key] && this.els.contextVals[key].textContent !== val) {
        this.els.contextVals[key].textContent = val;
        // Trigger Flash Effect
        this.els.contextVals[key].classList.remove('rfa-flash');
        // Force reflow
        void this.els.contextVals[key].offsetWidth;
        this.els.contextVals[key].classList.add('rfa-flash');
        setTimeout(() => {
          if (this.els.contextVals[key]) {
            this.els.contextVals[key].classList.remove('rfa-flash');
          }
        }, 150);
      }
    }

    // Update Severity Bar
    const vswrNum = window.vswr_state.severity || 1;
    let widthObj = '0%';
    if (vswrNum >= 3.0) widthObj = '100%';
    else if (vswrNum > 1.0) widthObj = Math.min(((vswrNum - 1) / 2) * 100, 100) + '%';

    this.els.severityFill.style.width = widthObj;

    if (vswrNum >= 3) {
      this.els.statusDot.className = 'rfa-status-dot error vswr-crit-beacon';
      this.els.severityFill.style.background = 'var(--rfa-error)';
    } else if (vswrNum > 1.5) {
      this.els.statusDot.className = 'rfa-status-dot processing';
      this.els.severityFill.style.background = 'var(--rfa-warn)';
    } else {
      this.els.statusDot.className = 'rfa-status-dot connected';
      this.els.severityFill.style.background = 'var(--rfa-success)';
    }
  }

  async handleSend() {
    const text = this.els.input.value.trim();
    if (!text) return;

    // Remove empty state
    if (this.els.emptyState) this.els.emptyState.style.display = 'none';

    // 1. Render User Message
    this.addMessage('user', text);
    this.els.input.value = '';

    // Save locally
    this.history.push({ role: 'user', content: text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    this.saveHistory();

    // 2. Set UI to 'Thinking' state
    this.els.input.disabled = true;
    this.els.sendBtn.disabled = true;

    // Setup Typing Indicator
    const typingMsg = document.createElement('div');
    typingMsg.className = 'rfa-msg rfa-typing';
    typingMsg.innerHTML = '<div class="rfa-dot"></div><div class="rfa-dot"></div><div class="rfa-dot"></div>';
    this.els.thread.appendChild(typingMsg);
    this.scrollToBottom();

    // 3. API Call or Fallback
    try {
      const responseTemplate = await this.generateResponse(text);

      typingMsg.remove();
      this.streamMessage(responseTemplate, () => {
        this.els.input.disabled = false;
        this.els.sendBtn.disabled = false;
        this.els.input.focus();

        this.history.push({ role: 'ai', content: responseTemplate, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        this.saveHistory();
      });
    } catch (e) {
      typingMsg.remove();
      this.streamMessage("|alert| API Error: " + e.message, () => {
        this.els.input.disabled = false;
        this.els.sendBtn.disabled = false;
      });
    }
  }

  async generateResponse(query) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_API_KEY_HERE") {
      // Fallback Demo Logic if API key is not provided
      const lowQuery = query.toLowerCase();
      if (lowQuery.includes('formula') || lowQuery.includes('math')) return "To calculate the Voltage Standing Wave Ratio from Gamma (Γ), use the following fundamental relationship:\n|formula| VSWR = (1 + |Γ|) / (1 - |Γ|)";
      if (lowQuery.includes('vswr')) return "Voltage Standing Wave Ratio (VSWR) represents the measure of how efficiently radio-frequency power is transmitted from a power source into a load. A ratio of 1.0:1 denotes a perfect match.\n|alert| Warning: Extended operation above 3.0:1 VSWR may result in permanent damage to the final amplification stage.";
      if (lowQuery.includes('return loss')) return "Return loss represents the ratio, in decibels, between forward and reflected power. Higher return loss indicates better power transfer (less reflection). A Return Loss of >20dB is generally considered a good broadband match.";
      if (lowQuery.includes('standing wave')) return "A standing wave is formed when a forward traveling wave and a reflected wave combination create a stationary oscillation pattern along the transmission line. Notice the simulation on the wave sim showing nodes (zero amplitude) and antinodes (maximum amplitude).";
      return `Analysis Complete. Notice: No API key provided for live AI analysis.\nFallback response: In terms of impedance matching, any reactive components (+jX or -jX) will shift you away from the center 50Ω resonant point on the chart. Check your current Load Impedance matrix.`;
    }

    // Prepare Context from UI
    let contextStr = "No active simulator context.";
    if (window.vswr_state) {
      contextStr = `Current Simulator State:\n- VSWR: ${window.vswr_state.vswr}\n- Return Loss: ${window.vswr_state.rl} dB\n- Load Z: ${window.vswr_state.zL}\n- Line Z0: ${window.vswr_state.z0}\n- Gamma: ${window.vswr_state.gamma}`;
    }

    // Call Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
      systemInstruction: {
        role: "system",
        parts: [{ text: "You are an expert RF Communications Engineer acting as a terminal assistant within an RF Design Simulator. Keep your answers extremely concise, professional, and technical. Output normal text. Do NOT use markdown code blocks or asterisks. If highlighting an equation, prefix the line with '|formula| '. If giving a critical warning, prefix the line with '|alert| '. Do not write more than a couple of short paragraphs." }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: `[SYSTEM CONTEXT]\n${contextStr}\n\n[USER QUERY]\n${query}` }]
        }
      ]
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const data = await res.json();
    if (data && data.candidates && data.candidates.length > 0) {
      let text = data.candidates[0].content.parts[0].text;
      // Clean up markdown since our terminal font handles newlines raw
      return text.trim().replace(/\*\*/g, '');
    }
    return "No content returned from API.";
  }

  streamMessage(fullText, onComplete) {
    const aiMsgContainer = document.createElement('div');
    aiMsgContainer.className = 'rfa-msg rfa-msg-ai';
    this.els.thread.appendChild(aiMsgContainer);

    // Parse custom tags (|formula|... , |alert|...) before streaming tokens
    const lines = fullText.split('\n');
    let contentToStream = [];

    lines.forEach(line => {
      if (line.startsWith('|formula|')) {
        contentToStream.push({ type: 'formula', text: line.replace('|formula|', '').trim() });
      } else if (line.startsWith('|alert|')) {
        contentToStream.push({ type: 'alert', text: line.replace('|alert|', '').trim() });
      } else {
        contentToStream.push({ type: 'text', text: line });
      }
    });

    let lineIdx = 0;

    const renderNextLine = () => {
      if (lineIdx >= contentToStream.length) {
        if (onComplete) onComplete();
        return;
      }

      const part = contentToStream[lineIdx];
      if (part.type === 'text') {
        // Stream text token by token (mimic ~4ms/char)
        let charIdx = 0;
        const textNode = document.createTextNode('');
        if (lineIdx > 0 && part.text !== "") aiMsgContainer.appendChild(document.createElement('br'));
        aiMsgContainer.appendChild(textNode);

        const streamInterval = setInterval(() => {
          textNode.nodeValue += part.text[charIdx++];
          this.scrollToBottom();
          if (charIdx >= part.text.length) {
            clearInterval(streamInterval);
            lineIdx++;
            renderNextLine();
          }
        }, 12);
      } else if (part.type === 'formula') {
        const div = document.createElement('div');
        div.className = 'rfa-formula';
        div.innerHTML = part.text.replace(/([A-Za-z0-9_]+)/g, '<strong>$1</strong>');
        aiMsgContainer.appendChild(div);
        this.scrollToBottom();
        lineIdx++;
        setTimeout(renderNextLine, 100);
      } else if (part.type === 'alert') {
        const div = document.createElement('div');
        div.className = 'rfa-msg-alert';
        div.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> <span>${part.text}</span>`;
        aiMsgContainer.appendChild(div);
        this.scrollToBottom();
        lineIdx++;
        setTimeout(renderNextLine, 100);
      }
    };

    renderNextLine();
  }

  addMessage(role, text, time) {
    const msg = document.createElement('div');
    msg.className = `rfa-msg rfa-msg-${role}`;

    if (role === 'user') {
      const timeStr = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      msg.innerHTML = `<div>${text}</div><span class="rfa-msg-time">${timeStr}</span>`;
    } else {
      // Just drop text in instantly without stream (used for restoring history)
      msg.innerHTML = text.replace(/\|formula\| (.*)/g, '<div class="rfa-formula"><strong>$1</strong></div>')
        .replace(/\|alert\| (.*)/g, '<div class="rfa-msg-alert"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> <span>$1</span></div>')
        .replace(/\n/g, '<br>');
    }

    this.els.thread.appendChild(msg);
    this.scrollToBottom();
  }

  scrollToBottom() {
    this.els.thread.scrollTop = this.els.thread.scrollHeight;
  }

  saveHistory() {
    // Disabled to allow chat to refresh on page reload
  }

  restoreHistory() {
    if (this.history.length > 0) {
      if (this.els.emptyState) this.els.emptyState.style.display = 'none';
      this.history.forEach(item => {
        if (item.role === 'user') this.addMessage('user', item.content, item.time);
        else {
          this.addMessage('ai', item.content);
        }
      });
      setTimeout(() => this.scrollToBottom(), 100);
    }
  }

  clearHistory() {
    this.history = [];
    localStorage.removeItem(this.HISTORY_KEY);
    this.els.thread.innerHTML = '';
    // Restore empty state
    this.els.emptyState.style.display = 'flex';
    this.els.thread.appendChild(this.els.emptyState);
    this.els.dropdown.classList.remove('open');
  }
}

// Instantiate Global Reference once DOM is parsed.
window.addEventListener('DOMContentLoaded', () => {
  window.rf_assistant = new RFAssistantPanel();
});
