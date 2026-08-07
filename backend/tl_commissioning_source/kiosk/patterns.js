/* TL Commissioning Test Source — kiosk pattern renderer (§7.3).
 *
 * Driven by the backend over WS /api/v1/events?role=kiosk. Shows a black
 * holding screen until the backend says which pattern is active (FR-07).
 * All geometry is derived from the canvas size so patterns render
 * correctly at 720p, 1080p and 2160p (AC-03).
 */
"use strict";

const canvas = document.getElementById("out");
const ctx = canvas.getContext("2d");

let state = {
  pattern: "holding",
  params: {},
  identity: null,
  output: null,
  soak: { running: false },
  connected: false,
};
let frameCounter = 0;
let audioEngine = null;

/* ---------------- sizing ---------------- */
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}
window.addEventListener("resize", resize);
resize();

/* ---------------- websocket ---------------- */
function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/api/v1/events?role=kiosk`;
}

function applyPatternState(p) {
  const previous = state.pattern;
  state.pattern = p.active_pattern || "holding";
  state.params = p.params || {};
  state.identity = p.identity || state.identity;
  state.output = p.output || state.output;
  state.soak = p.soak || { running: false };
  state.report = p.report || state.report;
  if (state.pattern !== previous) onPatternChange(previous);
}

function connect() {
  const ws = new WebSocket(wsUrl());
  ws.onopen = () => { state.connected = true; };
  ws.onmessage = (msg) => {
    let evt;
    try { evt = JSON.parse(msg.data); } catch { return; }
    if (evt.type === "hello" || evt.type === "pattern") applyPatternState(evt.payload);
    else if (evt.type === "soak_step") {
      state.soak = evt.payload;
      state.soakStep = evt.payload.step;
    } else if (evt.type === "soak_complete") {
      state.soak = { running: false };
    } else if (evt.type === "output") {
      state.output = evt.payload;
    }
  };
  ws.onclose = () => {
    state.connected = false;
    setTimeout(connect, 1500);
  };
  ws.onerror = () => ws.close();
}
connect();

/* QR handling: the backend serves QRs as SVG, but Chromium re-rasterises
 * an SVG image on EVERY drawImage call - at 60 fps that costs real CPU
 * (compositor + renderer) and the resulting GC churn shows as periodic
 * jitter on the output. Each QR is therefore rasterised ONCE into an
 * offscreen bitmap when it loads; the render loop only blits the bitmap. */
const QR_RASTER_PX = 1024;

function loadQrBitmap(url, assign) {
  const img = new Image();
  img.onload = () => {
    const off = document.createElement("canvas");
    off.width = off.height = QR_RASTER_PX;
    off.getContext("2d").drawImage(img, 0, 0, QR_RASTER_PX, QR_RASTER_PX);
    assign(off);
  };
  img.src = url;
}

let qrBitmap = null;
let panelQrBitmap = null;
let panelQrLoadedFor = "";
function onPatternChange(previous) {
  if (audioEngine) { audioEngine.stop(); audioEngine = null; }
  if (state.pattern === "audio") audioEngine = new AudioIdent(state.params.tone_hz || 1000);
  if (state.pattern === "report") {
    // Fetch the QR for the just-generated report (cache-busted so a new
    // report on the same screen never shows a stale code).
    qrBitmap = null;
    loadQrBitmap(`/api/v1/reports/latest/qr.svg?v=${Date.now()}`, (b) => { qrBitmap = b; });
  }
}

/* ---------------- helpers ---------------- */
function modeText() {
  const active = state.output && state.output.active;
  if (active && active.active_mode) {
    const m = active.active_mode;
    return `${m.width}×${m.height} @ ${m.refresh.toFixed(2).replace(/\.?0+$/, "")} Hz (${active.connector})`;
  }
  return `${canvas.width}×${canvas.height} (canvas)`;
}

function clockText(now) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}.${p(Math.floor(now.getMilliseconds() / 100), 1)}`;
}

function fitText(text, weight, px, family = "Arial, sans-serif") {
  ctx.font = `${weight} ${Math.round(px)}px ${family}`;
}

/* ---------------- pattern renderers ---------------- */
const renderers = {
  holding: drawHolding,
  identify: drawIdentify,
  alignment: drawAlignment,
  colour: drawColour,
  motion: drawMotion,
  audio: drawAudio,
  mode: drawMode,
  soak: drawSoak,
  report: drawReport,
};

function drawHolding(w, h, t) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  if (!state.connected) {
    ctx.fillStyle = "#222";
    fitText("", "400", h * 0.02);
    ctx.textAlign = "center";
    ctx.fillText("waiting for test source backend…", w / 2, h * 0.97);
  }
}

function movingBorder(w, h, t, thickness) {
  // Marching dashes around the full perimeter prove the image is live and
  // reaches every edge.
  ctx.save();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = thickness;
  ctx.setLineDash([thickness * 3, thickness * 2]);
  ctx.lineDashOffset = -(t / 25) % (thickness * 5);
  ctx.strokeRect(thickness / 2, thickness / 2, w - thickness, h - thickness);
  ctx.restore();
}

function drawIdentify(w, h, t) {
  ctx.fillStyle = "#080c0f";
  ctx.fillRect(0, 0, w, h);
  const id = state.identity || {};
  movingBorder(w, h, t, Math.max(4, h * 0.012));

  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  fitText("", "800", h * 0.30);
  ctx.fillText(`SOURCE ${id.source_number ?? "?"}`, w / 2, h * 0.36);

  fitText("", "600", h * 0.065);
  ctx.fillStyle = "#00d4aa";
  ctx.fillText(id.friendly_name || "TL TEST SOURCE", w / 2, h * 0.47);

  fitText("", "400", h * 0.045);
  ctx.fillStyle = "#c8ccd2";
  ctx.fillText(`${id.appliance_id || "UNSET"}  ·  ${modeText()}`, w / 2, h * 0.56);
  ctx.fillText(`Control: ${id.control_url || ""}`, w / 2, h * 0.63);

  fitText("", "700", h * 0.085, "'IBM Plex Mono', 'Courier New', monospace");
  ctx.fillStyle = "#ffd54a";
  ctx.fillText(clockText(new Date()), w / 2, h * 0.76);

  fitText("", "500", h * 0.05, "'IBM Plex Mono', 'Courier New', monospace");
  ctx.fillStyle = "#4a9eff";
  ctx.fillText(`FRAME ${String(frameCounter).padStart(7, "0")}`, w / 2, h * 0.85);

  // Room-control panel QR (integration.panel_url), bottom-right corner.
  // Reloaded whenever the resolved URL changes (e.g. a new DHCP lease).
  if (id.panel_url) {
    if (id.panel_url !== panelQrLoadedFor) {
      panelQrLoadedFor = id.panel_url;
      panelQrBitmap = null;
      loadQrBitmap(
        `/api/v1/integration/panel-qr.svg?v=${encodeURIComponent(id.panel_url)}`,
        (b) => { panelQrBitmap = b; }
      );
    }
    if (panelQrBitmap) {
      const qrSize = h * 0.2;
      const pad = qrSize * 0.08;
      const boxSize = qrSize + pad * 2;
      const x = w - boxSize - h * 0.045;
      const y = h - boxSize - h * 0.085;
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, y, boxSize, boxSize);
      ctx.drawImage(panelQrBitmap, x + pad, y + pad, qrSize, qrSize);
      ctx.fillStyle = "#c8ccd2";
      fitText("", "600", h * 0.028);
      ctx.fillText("SCAN FOR ROOM CONTROL", x + boxSize / 2, y + boxSize + h * 0.045);
    }
  }
}

function drawAlignment(w, h, t) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const line = Math.max(1, h / 540);

  // Edge-to-edge border, exactly at the pixel edge. Deliberately bold so
  // any cropping/overscan is unmissable.
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = line * 4;
  ctx.strokeRect(line * 2, line * 2, w - line * 4, h - line * 4);

  // Grid.
  const divisions = state.params.grid_divisions || 8;
  ctx.lineWidth = line;
  ctx.strokeStyle = "#666";
  ctx.beginPath();
  for (let i = 1; i < divisions; i++) {
    const x = (w / divisions) * i;
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
  }
  const rows = Math.round(divisions * h / w) || divisions;
  for (let j = 1; j < rows; j++) {
    const y = (h / rows) * j;
    ctx.moveTo(0, y); ctx.lineTo(w, y);
  }
  ctx.stroke();

  // Centre cross.
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = line * 2;
  ctx.beginPath();
  ctx.moveTo(w / 2, h * 0.42); ctx.lineTo(w / 2, h * 0.58);
  ctx.moveTo(w / 2 - h * 0.08, h / 2); ctx.lineTo(w / 2 + h * 0.08, h / 2);
  ctx.stroke();

  // 16:9 circle (true circle: judge geometry/aspect).
  ctx.strokeStyle = "#ffd54a";
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, h * 0.45, 0, Math.PI * 2);
  ctx.stroke();

  // Safe-area guides: 5% (action) and 10% (title).
  ctx.strokeStyle = "#e14f4f";
  ctx.setLineDash([line * 6, line * 4]);
  ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
  ctx.strokeStyle = "#4fa3e1";
  ctx.strokeRect(w * 0.10, h * 0.10, w * 0.8, h * 0.8);
  ctx.setLineDash([]);

  fitText("", "500", h * 0.03);
  ctx.fillStyle = "#e14f4f"; ctx.textAlign = "left";
  ctx.fillText("5% action safe", w * 0.05 + line * 4, h * 0.05 + h * 0.035);
  ctx.fillStyle = "#4fa3e1";
  ctx.fillText("10% title safe", w * 0.10 + line * 4, h * 0.10 + h * 0.035);
}

function drawColour(w, h, t) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  // 75% colour bars (top 45%).
  const bars75 = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
  const bw = w / bars75.length;
  bars75.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(i * bw), 0, Math.ceil(bw), h * 0.45);
  });
  // 100% primaries and secondaries (next 15%).
  const full = ["#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#000000"];
  const fw = w / full.length;
  full.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(i * fw), h * 0.45, Math.ceil(fw), h * 0.15);
  });
  // Grayscale ramp, stepped (next 20%): 16 visible tonal steps.
  const steps = 16;
  const sw = w / steps;
  for (let i = 0; i < steps; i++) {
    const v = Math.round((i / (steps - 1)) * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.round(i * sw), h * 0.60, Math.ceil(sw), h * 0.20);
  }
  // Black/white level areas (bottom 20%): PLUGE-style steps.
  const half = w / 2;
  ctx.fillStyle = "#000"; ctx.fillRect(0, h * 0.8, half, h * 0.2);
  ctx.fillStyle = "#fff"; ctx.fillRect(half, h * 0.8, half, h * 0.2);
  const blackSteps = [2, 4, 8];   // just-above-black
  const whiteSteps = [253, 251, 247]; // just-below-white
  const pw = half / 5;
  blackSteps.forEach((v, i) => {
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(pw * (i + 1), h * 0.84, pw * 0.6, h * 0.12);
  });
  whiteSteps.forEach((v, i) => {
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(half + pw * (i + 1), h * 0.84, pw * 0.6, h * 0.12);
  });
  fitText("", "500", h * 0.025);
  ctx.textAlign = "center";
  ctx.fillStyle = "#888";
  ctx.fillText("near-black steps", w * 0.25, h * 0.99);
  ctx.fillStyle = "#666";
  ctx.fillText("near-white steps", w * 0.75, h * 0.99);
}

function drawMotion(w, h, t) {
  ctx.fillStyle = "#080c0f";
  ctx.fillRect(0, 0, w, h);
  const speed = state.params.speed || 1;
  const s = t / 1000 * speed;

  // Horizontal sweep bar.
  const xPos = (s * w * 0.25) % (w + w * 0.04) - w * 0.02;
  ctx.fillStyle = "#4a9eff";
  ctx.fillRect(xPos, 0, w * 0.02, h);
  // Vertical sweep bar.
  const yPos = (s * h * 0.25) % (h + h * 0.04) - h * 0.02;
  ctx.fillStyle = "#ffd54a";
  ctx.fillRect(0, yPos, w, h * 0.02);

  // Rotating element.
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(s * Math.PI);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = Math.max(2, h * 0.01);
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(h * 0.08, 0);
    ctx.lineTo(h * 0.22, 0);
    ctx.stroke();
  }
  ctx.restore();

  // Bouncing block: judder/dropped frames show as a visible jump.
  const period = 2 / speed;
  const phase = (t / 1000 % period) / period;
  const bounce = Math.abs(Math.sin(phase * Math.PI));
  ctx.fillStyle = "#e14f4f";
  const size = h * 0.05;
  ctx.fillRect(w * 0.1 + (w * 0.8 - size) * phase, h * 0.82 - bounce * h * 0.1, size, size);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd54a";
  fitText("", "700", h * 0.07, "'IBM Plex Mono', 'Courier New', monospace");
  ctx.fillText(clockText(new Date()), w / 2, h * 0.14);
  ctx.fillStyle = "#4a9eff";
  fitText("", "500", h * 0.045, "'IBM Plex Mono', 'Courier New', monospace");
  ctx.fillText(`FRAME ${String(frameCounter).padStart(7, "0")}`, w / 2, h * 0.22);
}

function drawAudio(w, h, t) {
  ctx.fillStyle = "#080c0f";
  ctx.fillRect(0, 0, w, h);
  const phase = audioEngine ? audioEngine.phase() : { channel: "-", level: 0 };

  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  fitText("", "800", h * 0.12);
  ctx.fillText("AUDIO IDENTIFICATION", w / 2, h * 0.16);
  fitText("", "400", h * 0.04);
  ctx.fillStyle = "#c8ccd2";
  ctx.fillText("Stereo only in this release · left then right", w / 2, h * 0.23);

  const boxW = w * 0.32, boxH = h * 0.4, y = h * 0.32;
  [["LEFT", w * 0.09], ["RIGHT", w * 0.59]].forEach(([label, x]) => {
    const active = phase.channel === label.toLowerCase();
    ctx.fillStyle = active ? "#1d7a3e" : "#1c2126";
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = active ? "#6fff9f" : "#3a4149";
    ctx.lineWidth = Math.max(2, h * 0.006);
    ctx.strokeRect(x, y, boxW, boxH);
    ctx.fillStyle = active ? "#fff" : "#5c636b";
    fitText("", "800", h * 0.09);
    ctx.fillText(label, x + boxW / 2, y + boxH * 0.45);
    if (active) {
      // Tone activity meter (visible indication, §7.3 Audio).
      const bars = 12;
      for (let i = 0; i < bars; i++) {
        const on = i / bars < phase.level;
        ctx.fillStyle = on ? "#6fff9f" : "#2a3138";
        const bw2 = boxW * 0.05;
        ctx.fillRect(x + boxW * 0.14 + i * bw2 * 1.4, y + boxH * 0.62, bw2, boxH * 0.22);
      }
    }
  });

  fitText("", "500", h * 0.035);
  ctx.fillStyle = "#00d4aa";
  ctx.fillText(
    audioEngine && audioEngine.speaking
      ? "Playing spoken channel identification"
      : `Tone ${state.params.tone_hz || 1000} Hz · pattern repeats automatically`,
    w / 2, h * 0.84
  );
}

function drawMode(w, h, t) {
  ctx.fillStyle = "#080c0f";
  ctx.fillRect(0, 0, w, h);
  movingBorder(w, h, t, Math.max(4, h * 0.012));
  ctx.textAlign = "center";
  const active = state.output && state.output.active;
  const m = active && active.active_mode;
  ctx.fillStyle = "#fff";
  fitText("", "800", h * 0.16);
  ctx.fillText(m ? `${m.width}×${m.height}` : "MODE", w / 2, h * 0.42);
  ctx.fillStyle = "#ffd54a";
  fitText("", "700", h * 0.11);
  ctx.fillText(m ? `${m.refresh.toFixed(2).replace(/\.?0+$/, "")} Hz` : "unknown", w / 2, h * 0.57);
  ctx.fillStyle = "#c8ccd2";
  fitText("", "400", h * 0.045);
  ctx.fillText(active ? `Connector ${active.connector}` : "No display detected", w / 2, h * 0.67);
  // Live motion so a frozen scaler is obvious.
  const x = (t / 8) % w;
  ctx.fillStyle = "#4a9eff";
  ctx.fillRect(x, h * 0.78, Math.max(6, w * 0.008), h * 0.12);
  fitText("", "500", h * 0.04, "'IBM Plex Mono', 'Courier New', monospace");
  ctx.fillStyle = "#4a9eff";
  ctx.fillText(`FRAME ${String(frameCounter).padStart(7, "0")}`, w / 2, h * 0.96);
}

function drawSoak(w, h, t) {
  // Render the current sub-pattern with a soak status strip on top.
  const step = state.soakStep || "identify";
  (renderers[step] || drawIdentify)(w, h, t);
  const soak = state.soak || {};
  const stripH = h * 0.07;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(0, 0, w, stripH);
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffd54a";
  fitText("", "600", stripH * 0.5);
  const fmt = (secs) => {
    secs = Math.max(0, secs | 0);
    const m2 = String(Math.floor(secs / 60)).padStart(2, "0");
    return `${m2}:${String(secs % 60).padStart(2, "0")}`;
  };
  const label = soak.running
    ? `SOAK · step: ${step.toUpperCase()} · elapsed ${fmt(soak.elapsed_seconds)} · remaining ${fmt(soak.remaining_seconds)}${soak.faults ? ` · FAULTS: ${soak.faults}` : ""}`
    : "SOAK · starting…";
  ctx.fillText(label, w * 0.02, stripH * 0.68);
}

function drawReport(w, h, t) {
  // End-of-session screen: QR straight to the PDF, no TL UI needed.
  ctx.fillStyle = "#080c0f";
  ctx.fillRect(0, 0, w, h);
  movingBorder(w, h, t, Math.max(4, h * 0.012));
  ctx.textAlign = "center";

  ctx.fillStyle = "#00d4aa";
  fitText("", "800", h * 0.09);
  ctx.fillText("GET YOUR REPORT", w / 2, h * 0.13);

  const rep = state.report || {};
  if (rep.session_id) {
    const passed = rep.status === "completed_passed";
    const refText = `${rep.session_id}  ·  `;
    const resText = passed ? "PASSED" : "FAILED";
    fitText("", "600", h * 0.04);
    let x = (w - ctx.measureText(refText + resText).width) / 2;
    ctx.textAlign = "left";
    ctx.fillStyle = "#c8ccd2";
    ctx.fillText(refText, x, h * 0.20);
    x += ctx.measureText(refText).width;
    ctx.fillStyle = passed ? "#6fff9f" : "#ff7a7a";
    ctx.fillText(resText, x, h * 0.20);
    ctx.textAlign = "center";
  }

  // QR on a white quiet-zone panel for reliable scanning.
  const qrSize = h * 0.46;
  const pad = qrSize * 0.08;
  const boxSize = qrSize + pad * 2;
  const boxX = (w - boxSize) / 2;
  const boxY = h * 0.25;
  ctx.fillStyle = "#fff";
  ctx.fillRect(boxX, boxY, boxSize, boxSize);
  if (qrBitmap) {
    ctx.drawImage(qrBitmap, boxX + pad, boxY + pad, qrSize, qrSize);
  } else {
    ctx.fillStyle = "#333";
    fitText("", "500", h * 0.03);
    ctx.fillText("loading QR…", w / 2, boxY + boxSize / 2);
  }

  ctx.fillStyle = "#c8ccd2";
  fitText("", "400", h * 0.035);
  const base = (state.identity && state.identity.control_url) || "";
  ctx.fillText(
    `Scan with your phone to download the PDF${base ? `  ·  ${base}/api/v1/reports/latest/download` : ""}`,
    w / 2, boxY + boxSize + h * 0.055
  );

  ctx.fillStyle = "#ffd54a";
  fitText("", "700", h * 0.055);
  ctx.fillText("SELECT ANOTHER SIGNAL PATH TO CONTINUE", w / 2, h * 0.93);
}

/* ---------------- audio engine ---------------- */
class AudioIdent {
  /* Left-then-right identification loop: spoken via speechSynthesis when a
   * voice is available, always accompanied by a panned tone so the check
   * works even without installed TTS voices. */
  constructor(toneHz) {
    this.toneHz = toneHz;
    this.startedAt = performance.now();
    this.cycleMs = 6000;
    this.speaking = false;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.panner = this.ctx.createStereoPanner();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.osc = this.ctx.createOscillator();
    this.osc.frequency.value = toneHz;
    this.osc.connect(this.gain).connect(this.panner).connect(this.ctx.destination);
    this.osc.start();
    this._timer = setInterval(() => this._tick(), 100);
    this._lastChannel = "";
  }
  phase() {
    const t = (performance.now() - this.startedAt) % this.cycleMs;
    // 0-2.5s left, 3-5.5s right, rest silence.
    if (t < 2500) return { channel: "left", level: 0.3 + 0.7 * Math.abs(Math.sin(t / 90)) };
    if (t >= 3000 && t < 5500) return { channel: "right", level: 0.3 + 0.7 * Math.abs(Math.sin(t / 90)) };
    return { channel: "", level: 0 };
  }
  _tick() {
    const p = this.phase();
    const target = p.channel ? 0.25 : 0;
    this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.03);
    this.panner.pan.setTargetAtTime(
      p.channel === "left" ? -1 : p.channel === "right" ? 1 : 0,
      this.ctx.currentTime, 0.03
    );
    if (p.channel && p.channel !== this._lastChannel) {
      this._lastChannel = p.channel;
      this._speak(p.channel === "left" ? "Left channel" : "Right channel");
    }
    if (!p.channel) this._lastChannel = "";
  }
  _speak(text) {
    try {
      if (!window.speechSynthesis || speechSynthesis.getVoices().length === 0) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      this.speaking = true;
      u.onend = () => { this.speaking = false; };
      speechSynthesis.speak(u);
    } catch { /* tone alone is sufficient */ }
  }
  stop() {
    clearInterval(this._timer);
    try { this.osc.stop(); this.ctx.close(); } catch { /* already closed */ }
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch { }
  }
}

/* ---------------- main loop ---------------- */
function frame(t) {
  frameCounter++;
  const w = canvas.width, h = canvas.height;
  (renderers[state.pattern] || drawHolding)(w, h, t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
