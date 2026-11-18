// Music analysis for the beamer: play a music file on the laptop, or listen to the
// room through the microphone. levels() gives 0..1 values the 3D space reacts to.
let ctx = null, analyser = null, data = null, src = null, el = null, url = "", stream = null;
let mode = "";                       // "", "file" or "mic"
let bassAvg = 0, prevBass = 0, lastBeat = 0, lastAt = 0, lastOut = null;
// Sync: the analyser hears the music before the speakers play it, so visuals are delayed
// by the output latency (large on Bluetooth). [ and ] shift it by hand.
let queue = [], current = null, offsetMs = 0;
try { offsetMs = Number(localStorage.getItem("vm-sync")) || 0; } catch {}
const BANDS = 16, bands = new Float32Array(BANDS);   // zeros for OFF
const peaks = new Float32Array(BANDS + 2).fill(0.05);   // per band, plus level and bass
const OFF = { on: false, level: 0, bass: 0, bands, beat: false };

function ensure() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (!analyser) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.15;
    data = new Uint8Array(analyser.frequencyBinCount);
  }
}

export const musicMode = () => mode;
export const musicName = () => (el && el.dataset.name) || "";

/** Play a chosen audio file through the laptop speakers and analyse it. */
export async function playFile(file) {
  stopMusic(); ensure();
  url = URL.createObjectURL(file);
  el = new Audio(url); el.loop = true; el.dataset.name = file.name;
  src = ctx.createMediaElementSource(el);
  src.connect(analyser); analyser.connect(ctx.destination);
  await ctx.resume(); await el.play();
  mode = "file";
}

/** Listen to music in the room through the microphone (nothing is recorded or sent). */
export async function listenMic() {
  stopMusic(); ensure();
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  src = ctx.createMediaStreamSource(stream);
  src.connect(analyser);               // not to the speakers: no feedback
  await ctx.resume();
  mode = "mic";
}

export function stopMusic() {
  if (el) { el.pause(); el.removeAttribute("src"); el.load(); el = null; }
  if (url) { URL.revokeObjectURL(url); url = ""; }
  if (src) { try { src.disconnect(); } catch {} src = null; }
  if (analyser) { try { analyser.disconnect(); } catch {} }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  mode = ""; bassAvg = 0; prevBass = 0; lastOut = null; queue = []; current = null; peaks.fill(0.05);
}

/** Automatic gain per band: v relative to its own recent peak, squared for contrast. */
function norm(v, i) {
  peaks[i] = Math.max(v, peaks[i] * 0.996, 0.04);
  const x = Math.min(1, v / peaks[i]); return x * x;
}

/** Automatic delay in ms: what the browser reports for the speakers (file mode only). */
function autoDelay() {
  if (mode !== "file" || !ctx) return 0;
  return ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
}
/** Total delay of the visuals behind the analysis, in ms. */
export const syncDelay = () => Math.max(0, autoDelay() + offsetMs);
/** Shift the visuals later (+) or earlier (-); remembered on this laptop. */
export function nudgeSync(ms) {
  offsetMs = Math.max(-autoDelay(), Math.min(1500, offsetMs + ms));
  try { localStorage.setItem("vm-sync", String(offsetMs)); } catch {}
  return syncDelay();
}

function measure(now) {
  analyser.getByteFrequencyData(data);
  const n = data.length;                           // ~43 Hz per bin at 44.1 kHz
  let sum = 0; for (let i = 1; i < 200; i++) sum += data[i];
  const level = norm(sum / 199 / 255, BANDS);
  let b = 0; for (let i = 1; i <= 4; i++) b += data[i];
  const bassRaw = b / 4 / 255, bass = norm(bassRaw, BANDS + 1);
  const bs = new Float32Array(BANDS);
  // Log-spaced bands from ~40 Hz to ~11 kHz.
  for (let k = 0; k < BANDS; k++) {
    const lo = Math.max(1, Math.floor(Math.pow(256, k / BANDS))), hi = Math.min(n - 1, Math.max(lo + 1, Math.floor(Math.pow(256, (k + 1) / BANDS))));
    let s = 0; for (let i = lo; i < hi; i++) s += data[i];
    bs[k] = norm(s / (hi - lo) / 255, k);
  }
  // Beat: a sudden rise in the bass (a kick drum), above its recent average, at most ~4 per second.
  // Byte frequency data is in decibels, so a small jump is a big change in loudness.
  const rise = bassRaw - prevBass;
  const beat = rise > 0.08 && bassRaw > bassAvg + 0.05 && bassRaw > 0.3 && now - lastBeat > 240;
  if (beat) lastBeat = now;
  prevBass = bassRaw;
  bassAvg += (bassRaw - bassAvg) * 0.05;
  return { t: now, on: true, level, bass, bands: bs, beat };
}

/** Loudness (0..1), bass (0..1), 16 bands (0..1) and whether a beat just hit, timed to the speakers. */
export function levels() {
  if (!mode || !analyser) return OFF;
  const now = performance.now();
  if (lastOut && now - lastAt < 12) return lastOut;     // once per frame, however many callers
  lastAt = now;
  queue.push(measure(now));
  // Release everything that is now audible; a beat anywhere in that stretch counts.
  const due = now - syncDelay();
  let beat = false, took = null;
  while (queue.length && queue[0].t <= due) { took = queue.shift(); if (took.beat) beat = true; }
  if (took) current = took;
  if (queue.length > 300) queue.splice(0, queue.length - 300);
  if (!current) return OFF;
  lastOut = { on: true, level: current.level, bass: current.bass, bands: current.bands, beat };
  return lastOut;
}
