// Music for the beamer: play a music file on the laptop, or listen to the room through the
// microphone. levels() gives 0..1 values the 3D space reacts to.
// A music file is analysed before it plays (tempo + beat grid, see beats.js): its beats then
// come from the song's own clock, so they stay exactly in time. The microphone uses live
// detection with a tempo lock.
import { analyseSong, LiveBeats } from "./beats.js?v=16";

let ctx = null, analyser = null, data = null, src = null, el = null, url = "", stream = null;
let mode = "";                       // "", "file" or "mic"
let lastAt = 0, lastOut = null, grid = null, gridIdx = -1;
const live = new LiveBeats();
// Sync: the analyser hears the music before the speakers play it, so visuals are delayed
// by the output latency (large on Bluetooth). [ and ] shift it by hand.
let queue = [], current = null, offsetMs = 0;
try { offsetMs = Number(localStorage.getItem("vm-sync")) || 0; } catch {}
const BANDS = 16, bands = new Float32Array(BANDS);   // zeros for OFF
const peaks = new Float32Array(BANDS + 2).fill(0.05);   // per band, plus level and bass
const OFF = { on: false, level: 0, bass: 0, bands, beat: false, downbeat: false };

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
/** {bpm, grid} — grid is true when beats come from the pre-analysed song. */
export const musicInfo = () => ({ bpm: grid ? grid.bpm : 0, grid: !!grid });

/** Analyse a chosen audio file, then play it through the laptop speakers. */
export async function playFile(file) {
  stopMusic(); ensure();
  await ctx.resume();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    grid = await analyseSong(buf);
  } catch (e) { console.warn("Beatanalyse mislukt, live detectie wordt gebruikt.", e); grid = null; }
  url = URL.createObjectURL(file);
  el = new Audio(url); el.loop = true; el.dataset.name = file.name;
  src = ctx.createMediaElementSource(el);
  src.connect(analyser); analyser.connect(ctx.destination);
  await el.play();
  gridIdx = -1;
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
  mode = ""; lastOut = null; queue = []; current = null; grid = null; gridIdx = -1;
  peaks.fill(0.05); live.reset();
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
  const bass = norm(b / 4 / 255, BANDS + 1);
  const bs = new Float32Array(BANDS);
  // Log-spaced bands from ~40 Hz to ~11 kHz.
  for (let k = 0; k < BANDS; k++) {
    const lo = Math.max(1, Math.floor(Math.pow(256, k / BANDS))), hi = Math.min(n - 1, Math.max(lo + 1, Math.floor(Math.pow(256, (k + 1) / BANDS))));
    let s = 0; for (let i = lo; i < hi; i++) s += data[i];
    bs[k] = norm(s / (hi - lo) / 255, k);
  }
  const beat = grid ? false : live.step(data, now);
  return { t: now, on: true, level, bass, bands: bs, beat };
}

/** Beats from the pre-analysed grid, read off the song's own playback position. */
function gridBeat() {
  if (!grid || !el) return { beat: false, downbeat: false };
  const t = el.currentTime - syncDelay() / 1000;      // what the room hears right now
  const B = grid.beats;
  if (gridIdx >= 0 && t < B[gridIdx] - 0.3) gridIdx = -1;      // looped or jumped back
  let i = gridIdx;
  while (i + 1 < B.length && B[i + 1] <= t) i++;
  if (i === gridIdx || i < 0) return { beat: false, downbeat: false };
  const fresh = t - B[i] < 0.12;                       // don't flash for beats long past (after a pause)
  gridIdx = i;
  return { beat: fresh, downbeat: fresh && i % 4 === grid.downbeat };
}

/** Loudness (0..1), bass (0..1), 16 bands (0..1), beat and downbeat, timed to the speakers. */
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
  let downbeat = false;
  if (grid) ({ beat, downbeat } = gridBeat());
  if (!current) return OFF;
  lastOut = { on: true, level: current.level, bass: current.bass, bands: current.bands, beat, downbeat };
  return lastOut;
}
