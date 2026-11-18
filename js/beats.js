// Beat detection.
// 1) analyseSong(): a whole music file is analysed before it plays: onset strength in three
//    frequency bands, tempo from autocorrelation, a beat grid by dynamic programming
//    (after Ellis 2007), and which beat of four is the downbeat.
// 2) LiveBeats: for the microphone (or a song without a steady tempo): spectral flux with an
//    adaptive threshold, plus a tempo lock that keeps the pulse going through a missed kick.

const SR = 22050, HOP = 256, FPS = SR / HOP;          // ~86 analysis frames per second

/** Returns {beats: seconds[], downbeat: 0..3, bpm, confidence} or null if there is no steady beat. */
export async function analyseSong(audioBuffer) {
  const len = Math.ceil(audioBuffer.duration * SR);
  if (len < SR * 4) return null;
  // Split into low / mid / high with native filters (fast, offline).
  const off = new OfflineAudioContext(3, len, SR);
  const src = off.createBufferSource(); src.buffer = audioBuffer;
  const merge = off.createChannelMerger(3);
  const f = (type, freq, q) => { const b = off.createBiquadFilter(); b.type = type; b.frequency.value = freq; if (q) b.Q.value = q; return b; };
  const low = f("lowpass", 150), mid = f("bandpass", 900, 0.7), high = f("highpass", 3000);
  src.connect(low).connect(merge, 0, 0);
  src.connect(mid).connect(merge, 0, 1);
  src.connect(high).connect(merge, 0, 2);
  merge.connect(off.destination);
  src.start();
  const out = await off.startRendering();

  const N = Math.floor(len / HOP);
  const flux = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  for (let c = 0; c < 3; c++) {
    const x = out.getChannelData(c);
    let prev = 0;
    for (let n = 0; n < N; n++) {
      let e = 0; const o = n * HOP;
      for (let i = 0; i < HOP; i++) { const v = x[o + i] || 0; e += v * v; }
      const l = Math.log1p(1000 * Math.sqrt(e / HOP));      // loudness, log-compressed
      flux[c][n] = Math.max(0, l - prev); prev = l;
    }
  }
  // Onset strength: weighted towards the kick, minus a local average (adaptive), normalised.
  const raw = new Float32Array(N);
  for (let n = 0; n < N; n++) raw[n] = flux[0][n] * 1.0 + flux[1][n] * 0.6 + flux[2][n] * 0.4;
  const onset = new Float32Array(N), W = Math.round(FPS * 0.25);
  let acc = 0;
  for (let n = 0; n < N; n++) {
    acc += raw[n] - (n - 2 * W - 1 >= 0 ? raw[n - 2 * W - 1] : 0);
    const mean = acc / Math.min(n + 1, 2 * W + 1);
    onset[n] = Math.max(0, raw[n] - mean);
  }
  let s2 = 0; for (let n = 0; n < N; n++) s2 += onset[n] * onset[n];
  const sd = Math.sqrt(s2 / N) || 1;
  for (let n = 0; n < N; n++) onset[n] /= sd;

  // Tempo: autocorrelation between 70 and 180 BPM, gently preferring ~120.
  const lagMin = Math.floor(FPS * 60 / 180), lagMax = Math.ceil(FPS * 60 / 70);
  const M = Math.min(N, Math.round(FPS * 90));                 // the first 90 s is plenty
  const ac = new Float32Array(lagMax * 2 + 2);
  for (let L = lagMin; L <= Math.min(lagMax * 2 + 1, M - 1); L++) {
    let s = 0; for (let n = 0; n + L < M; n++) s += onset[n] * onset[n + L];
    ac[L] = s / (M - L);
  }
  let best = -1, bestL = 0, sum = 0, cnt = 0;
  for (let L = lagMin; L <= lagMax; L++) {
    const bpm = 60 * FPS / L, w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2));
    const score = (ac[L] + 0.5 * (ac[2 * L] || 0)) * w;          // the double period should agree too
    sum += ac[L]; cnt++;
    if (score > best) { best = score; bestL = L; }
  }
  const confidence = ac[bestL] / (sum / cnt || 1);
  if (!(confidence > 3.5)) return null;                           // no clear steady tempo: use live detection
  // Parabolic refinement for a fractional period.
  const a = ac[bestL - 1], b = ac[bestL], c = ac[bestL + 1];
  const den = a - 2 * b + c;
  const P = bestL + (den < 0 ? 0.5 * (a - c) / den : 0);

  // Beat tracking (dynamic programming): reward onsets, punish gaps that differ from the period.
  const score = new Float32Array(N), back = new Int32Array(N).fill(-1);
  const tight = 100, lo = Math.round(P / 2), hi = Math.round(P * 2);
  for (let n = 0; n < N; n++) {
    let bestPrev = 0, bi = -1;
    for (let p = n - hi; p <= n - lo; p++) {
      if (p < 0) continue;
      const d = Math.log((n - p) / P), v = score[p] - tight * d * d;
      if (bi < 0 || v > bestPrev) { bestPrev = v; bi = p; }
    }
    score[n] = onset[n] + (bi >= 0 ? Math.max(0, bestPrev) : 0);
    back[n] = bi >= 0 && bestPrev > 0 ? bi : -1;
  }
  let end = N - 1, top = -Infinity;
  for (let n = Math.max(0, N - Math.round(P)); n < N; n++) if (score[n] > top) { top = score[n]; end = n; }
  const frames = [];
  // Walk back; where the chain breaks (a quiet bit), jump to the best frame one period earlier.
  for (let n = end; n >= 0;) {
    frames.push(n);
    if (back[n] >= 0) { n = back[n]; continue; }
    let bp = -1, bv = -Infinity;
    for (let p = n - hi; p <= n - lo; p++) if (p >= 0 && score[p] > bv) { bv = score[p]; bp = p; }
    n = bp;
  }
  frames.reverse();
  if (frames.length < 8) return null;

  // Downbeat: the beat of four that hits hardest — mostly kick, plus crashes and accents.
  const k4 = [0, 0, 0, 0];
  frames.forEach((fr, i) => {
    for (const q of [fr, Math.min(fr + 1, N - 1)]) k4[i % 4] += flux[0][q] + 0.5 * (flux[1][q] + flux[2][q]);
  });
  const downbeat = k4.indexOf(Math.max(...k4));
  // Onset frames mark the start of a hop; centre them.
  const beats = frames.map(fr => (fr + 0.5) * HOP / SR);
  return { beats, downbeat, bpm: Math.round(60 * FPS / P), confidence };
}

/** Real-time beats from analyser frequency data, with a tempo lock. */
export class LiveBeats {
  constructor() { this.reset(); }
  reset() {
    this.prev = null; this.hist = []; this.lastOnset = -1e9; this.onsets = [];
    this.period = 0; this.locked = false; this.next = 0; this.misses = 0; this.lastBeat = -1e9;
  }
  /** data: Uint8Array of frequency bins; now: ms. Returns true when a beat should flash. */
  step(data, now) {
    const n = Math.min(200, data.length);
    if (!this.prev) { this.prev = Uint8Array.from(data); return false; }
    // Spectral flux: how much louder each bin got, weighted towards the low end.
    let f = 0, wsum = 0;
    for (let i = 1; i < n; i++) {
      const w = i < 8 ? 1.6 : i < 60 ? 1 : 0.5, d = data[i] - this.prev[i];
      if (d > 0) f += w * d; wsum += w;
    }
    this.prev.set(data);
    f /= wsum * 255;
    // Adaptive threshold over the last ~1.2 s.
    this.hist.push(f); if (this.hist.length > 72) this.hist.shift();
    let m = 0; for (const v of this.hist) m += v; m /= this.hist.length;
    let v2 = 0; for (const v of this.hist) v2 += (v - m) * (v - m);
    const sd = Math.sqrt(v2 / this.hist.length);
    const onset = this.hist.length > 20 && f > m + 1.6 * sd && f > 0.012 && now - this.lastOnset > 200;
    if (onset) { this.lastOnset = now; this.onsets.push(now); this.retempo(now); }
    while (this.onsets.length && now - this.onsets[0] > 8000) this.onsets.shift();

    if (!this.locked) {                       // no steady tempo yet: every onset is a beat
      if (onset) { this.lastBeat = now; return true; }
      return false;
    }
    // Locked: flash on the predicted beat, and pull the phase towards real onsets.
    if (onset && Math.abs(now - this.next) < this.period * 0.2) { this.next = now; this.misses = 0; }
    else if (onset && Math.abs(now - (this.next - this.period)) < this.period * 0.2) { this.next = now + this.period; this.misses = 0; }
    if (now >= this.next - 8) {
      const fired = now - this.lastBeat > this.period * 0.5;
      this.next += this.period; this.misses++;
      if (this.misses > 4) this.locked = false;   // lost the beat: back to plain onsets
      if (fired) { this.lastBeat = now; return true; }
    }
    return false;
  }
  /** Estimate the period from intervals between recent onsets (folded into 0.33–0.86 s). */
  retempo(now) {
    const on = this.onsets; if (on.length < 6) return;
    const bins = new Float32Array(54);                         // 10 ms bins from 330 to 860 ms
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
      let d = on[j] - on[i]; if (d > 3000) break;
      while (d > 860) d /= 2; while (d < 330) d *= 2;
      const k = Math.round((d - 330) / 10);
      if (k >= 0 && k < 54) { bins[k] += 1; if (k > 0) bins[k - 1] += 0.5; if (k < 53) bins[k + 1] += 0.5; }
    }
    let bk = 0, tot = 0; for (let k = 0; k < 54; k++) { tot += bins[k]; if (bins[k] > bins[bk]) bk = k; }
    const share = bins[bk] / (tot || 1);
    if (share > 0.12) {
      const period = 330 + bk * 10;
      if (!this.locked) { this.locked = true; this.next = now + period; this.misses = 0; }
      this.period = this.period ? this.period * 0.7 + period * 0.3 : period;
    }
  }
}
