// 3D story space for the beamer: every player is a glowing particle in their own
// colour. While players join (lobby) the lights orbit an invisible sphere, each on
// its own tilted orbit. Writing makes your light brighter, votes fly to it as
// sparks, the winner comes to the front. Chosen sentences form the story arc
// (verhaalboog) along the top. With music on, every light swells and flares with
// its own frequency band and flashes on the beat.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { hash } from "./common.js?v=20";
import { levels } from "./audio.js?v=20";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let renderer, scene, camera, cluster, arc, orbitSys, GLOW, raf = 0, spin = 0, last = 0;
const objs = new Map();
let sparks = [], lastRound = -1, lastVotes = 0, arcKey = "", phaseNow = "lobby", authored = new Set();
let sphereSide = false, stars, beatFlash = 0, breath = 0;
// Camera orbit (host toggle): angle around the lights, and how much the orbit is blended in.
let camOrbit = false, camAngle = 0, camBlend = 0;
try { camOrbit = localStorage.getItem("vm-camorbit") === "1"; } catch {}
const camLook = new THREE.Vector3(0, -0.3, 0), camLookNow = new THREE.Vector3();
export const getCamOrbit = () => camOrbit;
export function setCamOrbit(on) { camOrbit = !!on; try { localStorage.setItem("vm-camorbit", camOrbit ? "1" : "0"); } catch {} }
// Crowd: with many players each light gets smaller and softer and they spread out more,
// so a big group stays a field of lights instead of one white cloud. 1 = up to ~24 players.
let crowd = 1, sizeK = 1, opK = 1, spread = 1;
const WHITE = new THREE.Color(0xffffff);
const tmp = new THREE.Vector3(), X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0);

function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const x = c.getContext("2d"), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.85)");
  g.addColorStop(0.45, "rgba(255,255,255,0.28)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const glowMat = (color, opacity = 1) => new THREE.SpriteMaterial({
  map: GLOW, color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending
});

function init(canvas) {
  if (renderer) return;
  GLOW = glowTexture();
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d22);
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
  camera.position.set(0, 0.4, 9);

  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 18 + Math.random() * 30, a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1);
    pos.set([r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a)], i * 3);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xc9cdf0, size: 0.09, transparent: true, opacity: 0.8 }));
  scene.add(stars);

  // The invisible sphere the lights orbit in the lobby: only a reference frame, nothing is drawn.
  orbitSys = new THREE.Group(); orbitSys.rotation.set(0.35, 0, -0.15); scene.add(orbitSys);
  cluster = new THREE.Group(); cluster.position.y = -0.9; scene.add(cluster);
  arc = new THREE.Group(); scene.add(arc);
  addEventListener("resize", resize); resize();
}
function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
function home(uid) {
  const h = hash(uid), a = (h % 997) / 997 * Math.PI * 2, b = Math.acos(((h >>> 10) % 991) / 495.5 - 1), r = 1 + ((h >>> 20) % 983) / 983 * 1.9;
  return new THREE.Vector3(r * Math.sin(b) * Math.cos(a) * 1.6, r * Math.cos(b) * 0.85, r * Math.sin(b) * Math.sin(a));
}

/* ---------- orbits around the invisible sphere ---------- */
function orbitOf(uid) {
  const h = hash(uid + "orbit");
  return {
    r: 1.9 + (h % 1000) / 1000 * 0.5,                       // all close to the sphere's surface
    incl: (((h >>> 10) % 1000) / 1000 - 0.5) * Math.PI,     // any tilt, so together they trace a ball
    node: ((h >>> 20) % 1000) / 1000 * Math.PI * 2,
    phase: (hash(uid) % 1000) / 1000 * Math.PI * 2,
    dir: (h & 1) ? 1 : -1
  };
}
function orbitPos(o, ang, out, grow = 1) {
  const b = o.orbit, r = b.r * grow;
  out.set(Math.cos(ang) * r, 0, Math.sin(ang) * r).applyAxisAngle(X_AXIS, b.incl).applyAxisAngle(Y_AXIS, b.node);
  return orbitSys.localToWorld(out);
}

/* ---------- formations (lobby) ----------
   Every ~12 s (on a downbeat when music plays) the lights regroup into another shape.
   Each shape maps light i of n to a point in the tilted frame beside the QR code. */
const frac = x => x - Math.floor(x);
const FORMS = [
  { name: "Banen", orbit: true },
  { name: "Ring", spin: true, tilt: 0.5, at(i, n, t, R, v) {
      const a = i / n * Math.PI * 2 + t * 0.3, w = 0.22 * Math.sin(a * 5 + t * 2);
      return v.set(Math.cos(a) * (R + w), Math.sin(a * 3 + t) * 0.18, Math.sin(a) * (R + w)); } },
  { name: "Dubbele helix", spin: true, at(i, n, t, R, v) {
      const m = Math.ceil(n / 2), u = (i >> 1) / Math.max(1, m - 1), a = u * Math.PI * 4 + (i & 1) * Math.PI + t * 0.8;
      return v.set(Math.cos(a) * R * 0.45, (u - 0.5) * R * 2, Math.sin(a) * R * 0.45); } },
  { name: "Hart", flat: true, at(i, n, t, R, v) {
      const u = i / n * Math.PI * 2, x = 16 * Math.pow(Math.sin(u), 3), y = 13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u);
      const beat = 1 + 0.04 * Math.sin(t * 6);
      return v.set(x / 17 * R * beat, (y / 17 + 0.15) * R * beat, Math.sin(i * 2.4) * 0.15); } },
  { name: "Sterrenstelsel", spin: true, tilt: 0.75, at(i, n, t, R, v) {
      const arm = i % 3, u = Math.floor(i / 3) / Math.max(1, Math.ceil(n / 3) - 1), r = 0.25 + u * R * 1.1;
      const a = u * Math.PI * 3 + arm * Math.PI * 2 / 3 + t * 0.25;
      return v.set(Math.cos(a) * r, (frac(i * 0.618) - 0.5) * 0.3, Math.sin(a) * r); } },
  { name: "Golf", tilt: 0.45, at(i, n, t, R, v) {
      const c = Math.ceil(Math.sqrt(n)), x = ((i % c) / Math.max(1, c - 1) - 0.5) * R * 2.2, z = (Math.floor(i / c) / Math.max(1, c - 1) - 0.5) * R * 2.2;
      return v.set(x, 0.4 * Math.sin(x * 1.4 + t * 1.6) * Math.cos(z * 1.4 + t * 1.1), z); } },
  { name: "Kubus", spin: true, at(i, n, t, R, v) {
      const f = i % 6, a = (frac(i * 0.618034) - 0.5) * 2, b = (frac(i * 0.414214 + 0.3) - 0.5) * 2, s = R * 0.7;
      const p = [[1, a, b], [-1, a, b], [a, 1, b], [a, -1, b], [a, b, 1], [a, b, -1]][f];
      return v.set(p[0] * s, p[1] * s, p[2] * s); } },
  { name: "Ster", flat: true, at(i, n, t, R, v) {
      const u = i / n * 10, seg = Math.floor(u), f = u - seg;
      const pt = k => { const a = -Math.PI / 2 + k * Math.PI / 5, r = (k % 2 ? 0.42 : 1) * R; return [Math.cos(a) * r, -Math.sin(a) * r]; };
      const p = pt(seg), q = pt(seg + 1);
      return v.set(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, 0); } }
];
let form = 0, formSince = 0, formPending = false, formN = 1;
/** Jump to another (random) formation now; returns its name. */
export function nextFormation() { formPending = true; }
/** For testing: jump to a formation by name. */
export function setFormation(name) { const i = FORMS.findIndex(f => f.name === name); if (i >= 0) { form = i; formSince = performance.now() / 1000; } }
export const formationName = () => FORMS[form].name;
function pickForm(t) {
  let f = form; while (f === form) f = Math.floor(Math.random() * FORMS.length);
  form = f; formSince = t;
}
function formPos(o, t, grow, out) {
  const F = FORMS[form], R = 2.2 * grow;
  F.at(o.idx, formN, t, R, out);
  if (F.spin) out.applyAxisAngle(Y_AXIS, t * 0.25);
  else if (F.flat) out.applyAxisAngle(Y_AXIS, Math.sin(t * 0.4) * 0.35);
  if (F.tilt) out.applyAxisAngle(X_AXIS, F.tilt);           // open flat shapes up towards the camera
  return orbitSys.localToWorld(out);
}

/** A particle: a wide soft aura, a coloured halo and a small white-hot core. */
function particle(color, size) {
  const g = new THREE.Group();
  const aura = new THREE.Sprite(glowMat(color, 0.12)); aura.scale.setScalar(1.9);
  const halo = new THREE.Sprite(glowMat(color)); halo.scale.setScalar(1);
  const core = new THREE.Sprite(glowMat(0xffffff, 0.9)); core.scale.setScalar(0.3);
  g.add(aura, halo, core); g.scale.setScalar(size);
  g.userData = { aura, halo, core, color, base: new THREE.Color(color), range: bandsFor(color) };
  return g;
}
/* ---------- colour → frequency ----------
   Each colour family listens to its own part of the spectrum (16 log bands, ~40 Hz–11 kHz):
   greens are the bass, reds the highs. White/grey listens to the whole mix. */
export const FREQ_FAMILIES = [
  { name: "Groen", what: "bas", from: 75, to: 165, bands: [0, 2], swatch: "#2ecc71" },
  { name: "Turquoise", what: "laag", from: 165, to: 200, bands: [3, 5], swatch: "#1dd3b0" },
  { name: "Blauw", what: "laag-midden", from: 200, to: 250, bands: [6, 7], swatch: "#4d7cff" },
  { name: "Paars", what: "midden", from: 250, to: 290, bands: [8, 9], swatch: "#9b6bff" },
  { name: "Roze", what: "hoog-midden", from: 290, to: 340, bands: [10, 11], swatch: "#ff6fb5" },
  { name: "Rood", what: "hoog", from: 340, to: 375, bands: [12, 13], swatch: "#ff5d5d" },
  { name: "Oranje", what: "hoger", from: 15, to: 40, bands: [14, 14], swatch: "#ff9f43" },
  { name: "Geel", what: "hoogst (sissen)", from: 40, to: 75, bands: [15, 15], swatch: "#ffd23f" }
];
const hsl = {};
/** [lo, hi] band range for a colour, or null (white/grey: the whole mix). */
function bandsFor(color) {
  new THREE.Color(color).getHSL(hsl);
  if (hsl.s < 0.25) return null;
  const h = hsl.h * 360;
  for (const f of FREQ_FAMILIES) {
    const hh = f.to > 360 && h < f.from ? h + 360 : h;
    if (hh >= f.from && hh < f.to) return f.bands;
  }
  return null;
}
const isBass = r => r && r[0] <= 2;

function setColor(g, color) {
  if (g.userData.color === color) return;
  g.userData.color = color; g.userData.base.set(color); g.userData.range = bandsFor(color);
  g.userData.halo.material.color.set(color); g.userData.aura.material.color.set(color);
}
/* Bloom: how far each light's glow spreads (0 = only a sharp point, 1 = default, 1.5 = extra soft).
   Lower it when lights start to melt together on a bright beamer. */
let bloom = 1;
try { const v = Number(localStorage.getItem("vm-bloom")); if (v >= 0 && v <= 1.5 && localStorage.getItem("vm-bloom") !== null) bloom = v; } catch {}
export const getBloom = () => bloom;
export function setBloom(v) {
  bloom = Math.max(0, Math.min(1.5, Number(v) || 0));
  try { localStorage.setItem("vm-bloom", String(bloom)); } catch {}
  for (const m of arc.children) if (m.userData && m.userData.aura) applyBloomStatic(m);
}
function applyBloomStatic(g) {
  g.userData.aura.scale.setScalar(1.9 * (0.35 + 0.65 * bloom));
  g.userData.halo.scale.setScalar(0.55 + 0.45 * bloom);
  g.userData.aura.material.opacity = 0.12 * bloom;
}

function setOpacity(g, a, glow) {
  g.userData.halo.material.opacity = a * Math.min(1, 0.55 + 0.45 * bloom);
  g.userData.core.material.opacity = a * 0.9;
  g.userData.aura.material.opacity = Math.min(0.3 * bloom, a * (0.1 + glow * 0.15) * bloom);
}

function buildArc(slots, colors, finale) {
  const key = slots.map(u => (u ? u + (colors[u] || "") : "-")).join(",") + (finale ? "|f" : "");
  if (key === arcKey) return; arcKey = key;
  while (arc.children.length) arc.remove(arc.children[0]);
  const n = slots.length, pts = [];
  const w = finale ? 7 : 6.4, y0 = finale ? 0.6 : 2.9, lift = finale ? 1.3 : 0.55;
  slots.forEach((uid, i) => {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const p = new THREE.Vector3((t - 0.5) * w, y0 + Math.sin(t * Math.PI) * lift, finale ? 1 : -1);
    let m;
    if (uid) { m = particle(colors[uid] || "#ffffff", finale ? 1.6 : 0.9); applyBloomStatic(m); pts.push(p); }
    else { m = new THREE.Sprite(glowMat(0x4a5088, 0.5)); m.scale.setScalar(0.35); }
    m.position.copy(p); m.userData.base = p.y; m.userData.i = i; arc.add(m);
  });
  if (pts.length > 1) {
    const curve = new THREE.CatmullRomCurve3(pts);
    arc.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(80)),
      new THREE.LineBasicMaterial({ color: 0xf5b829, transparent: true, opacity: 0.6 })));
  }
}

/** v: {phase, round, players[uid], colors{uid: "#rrggbb"}, lobbyQr, authors[], tally{}, winner, votes, chain[uid|null]} */
export function syncSpace(canvas, v) {
  init(canvas);
  phaseNow = v.phase;
  const colors = v.colors || {};
  if (v.round !== lastRound) { lastRound = v.round; lastVotes = 0; authored = new Set(); }

  // One particle per player (and per author, in case a name arrives late).
  const ids = new Set([...(v.players || []), ...v.authors]);
  crowd = Math.min(1, Math.sqrt(24 / Math.max(1, ids.size)));
  sizeK = 0.45 + 0.55 * crowd; opK = 0.4 + 0.6 * crowd; spread = 1 + (1 - crowd) * 0.7;
  for (const uid of ids) {
    const color = colors[uid] || "#ffffff";
    let o = objs.get(uid);
    if (!o) {
      const h = home(uid), g = particle(color, 0.01);
      g.position.set(h.x * 0.4, -7, h.z + 2);
      cluster.add(g);
      const orbit = orbitOf(uid);
      o = { g, target: h, scale: 0.7, cur: 0.01, opacity: 0.6, op: 0.6, wobble: Math.random() * 6, pulse: 0, music: 0,
        orbit, ang: orbit.phase, band: hash(uid + "band") % 16 };
      objs.set(uid, o);
    }
    setColor(o.g, color);
  }
  for (const [uid, o] of objs) if (!ids.has(uid)) { cluster.remove(o.g); objs.delete(uid); }
  sphereSide = !!v.lobbyQr;
  // A stable, shuffled place in each formation.
  const order = [...objs.keys()].sort((a, b) => hash(a + "f") - hash(b + "f"));
  order.forEach((u, i) => { objs.get(u).idx = i; }); formN = order.length;

  // Writing a sentence makes your light flare up once.
  for (const uid of v.authors) if (!authored.has(uid)) { authored.add(uid); const o = objs.get(uid); if (o && v.phase === "write") o.pulse = 1; }

  const max = Math.max(1, ...Object.values(v.tally));
  for (const [uid, o] of objs) {
    const wrote = v.authors.includes(uid);
    if (v.phase === "reveal") {
      const n = v.tally[uid] || 0;
      if (uid === v.winner) { o.target = new THREE.Vector3(0, 0.5, 4.2); o.scale = 2.8; o.opacity = 1; }
      else { o.target = home(uid).multiplyScalar(1.35 * spread); o.scale = 0.6 + n / max * 1.4; o.opacity = wrote ? 0.55 : 0.25; }
    } else if (v.phase === "write" || v.phase === "vote") {
      o.target = home(uid).multiplyScalar(spread); o.scale = wrote ? 1.35 : 0.7; o.opacity = wrote ? 1 : (v.phase === "vote" ? 0.3 : 0.55);
    } else {
      o.target = home(uid).multiplyScalar((v.phase === "finale" ? 1.5 : 1) * spread); o.scale = v.phase === "lobby" ? 1.1 : 0.9; o.opacity = v.phase === "lobby" ? 1 : 0.85;
    }
  }
  if (v.phase === "vote" && v.votes > lastVotes && !reduce) {
    for (let i = 0; i < Math.min(v.votes - lastVotes, 12); i++) spark(v.authors);
  }
  lastVotes = v.votes;
  buildArc(v.chain, colors, v.phase === "finale");
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
}

function spark(authors) {
  const list = authors.map(u => objs.get(u)).filter(Boolean); if (!list.length) return;
  const to = list[Math.floor(Math.random() * list.length)];
  const m = new THREE.Sprite(glowMat(0xf5b829)); m.scale.setScalar(0.3);
  m.position.set((Math.random() - 0.5) * 8, -6, 3);
  cluster.add(m); sparks.push({ m, to, life: 0 });
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const k = reduce ? 1 : 1 - Math.pow(0.02, dt);
  const t = now / 1000;
  const lobby = phaseNow === "lobby";
  const m = levels();
  if (m.beat && !reduce) beatFlash = m.downbeat ? 1.6 : 1;   // the first beat of the bar hits harder
  beatFlash = Math.max(0, beatFlash - dt * 4);
  // The whole group breathes with the bass: quick out, slower back.
  const bassNow = m.on ? m.bass : 0;
  breath += (bassNow - breath) * (bassNow > breath ? 0.85 : 0.12);

  if (phaseNow === "reveal") spin += (Math.round(spin / (Math.PI * 2)) * Math.PI * 2 - spin) * k;
  else if (!reduce) spin += dt * 0.12;
  cluster.rotation.y = spin;

  // The invisible sphere sits beside the big QR code in the lobby, centred otherwise.
  const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z * camera.aspect;
  const sx = sphereSide && halfW > 6 ? Math.min(halfW - 3.4, 5) : 0;
  orbitSys.position.lerp(tmp.set(sx, -0.2, 0), k * 0.5);
  orbitSys.updateMatrixWorld(true); cluster.updateMatrixWorld(true);

  // Camera: optionally circles slowly around the lights. During the result and the finale it
  // eases back to the front, so the winner and the story arc are read straight on.
  const orbiting = camOrbit && !reduce && phaseNow !== "reveal" && phaseNow !== "finale";
  if (orbiting) camAngle += dt * 0.12;
  else camAngle += (Math.round(camAngle / (Math.PI * 2)) * Math.PI * 2 - camAngle) * k * 0.4;
  camLook.lerp(lobby ? tmp.copy(orbitSys.position) : tmp.set(0, -0.3, 0), k * 0.5);
  const R = 9 - (reduce ? 0 : beatFlash * 0.18 + breath * 0.15);
  // Blend between the fixed front view and the orbit; stay in orbit mode until the angle is home.
  const home0 = Math.abs(camAngle - Math.round(camAngle / (Math.PI * 2)) * Math.PI * 2) < 0.02;
  camBlend += ((orbiting || !home0 ? 1 : 0) - camBlend) * k * 0.5;
  if (camBlend < 0.002) { camera.position.set(0, 0.4, R); camera.rotation.set(0, 0, 0); }
  else {
    const orbitPosV = tmp.set(camLook.x + Math.sin(camAngle) * R, 0.4 + Math.sin(camAngle * 0.5) * 1.2, camLook.z + Math.cos(camAngle) * R);
    camera.position.set(0, 0.4, R).lerp(orbitPosV, camBlend);
    camLookNow.set(0, 0.4, 0).lerp(camLook, camBlend);
    camera.lookAt(camLookNow);
  }

  // Formations: a new shape every ~12 s (on a downbeat when music plays), or on request.
  if (lobby && !reduce) {
    if (!formSince) formSince = t;
    const age = t - formSince;
    if (formPending || (objs.size >= 3 && age > 12 && (!m.on || m.downbeat || age > 20))) { pickForm(t); formPending = false; }
  } else if (!lobby && form !== 0) { form = 0; formSince = 0; }

  for (const o of objs.values()) {
    if (lobby) {
      // Orbits speed up with the music and the shape swells with the bass.
      if (!reduce) o.ang += o.orbit.dir * dt * (0.35 + m.level * 1.1) / Math.pow(o.orbit.r / 2, 1.5);
      const grow = (reduce ? 1 : 1 + breath * 0.28 + o.pulse * 0.18) * (1 + (spread - 1) * 0.6);
      const w = FORMS[form].orbit ? orbitPos(o, o.ang, new THREE.Vector3(), grow) : formPos(o, t, grow, new THREE.Vector3());
      o.target = cluster.worldToLocal(w);
      o.g.position.lerp(o.target, k * 0.45);              // a soft glide when the shape changes
    } else {
      // Outside the lobby the lights push outward a little on the music.
      o.g.position.lerp(tmp.copy(o.target).multiplyScalar(reduce ? 1 : 1 + o.music * 0.14 + o.pulse * 0.1), k);
    }

    // Music: each light listens to its own band plus the bass; quick attack, slower release.
    // Music: each colour listens only to its own frequency range (see FREQ_FAMILIES).
    const rg = o.g.userData.range;
    let want = 0;
    if (m.on) {
      // The loudest band in the colour's range, so one clear tone is enough to light it up.
      if (rg) { let top = 0; for (let b = rg[0]; b <= rg[1]; b++) top = Math.max(top, m.bands[b]); want = Math.min(1.2, top * 1.15); }
      else want = Math.min(1.2, m.level);
    }
    o.music += (want - o.music) * (want > o.music ? 1 : 0.15);   // instant attack: no lag on the hit
    // The kick belongs to the bass colours; the rest only feels the first beat of the bar.
    if (m.beat && !reduce) {
      const p = isBass(rg) ? (m.downbeat ? 0.95 : 0.6) + m.bass * 0.4 : (m.downbeat ? 0.35 : 0);
      if (p) o.pulse = Math.max(o.pulse, p);
    }

    o.pulse = Math.max(0, o.pulse - dt * 3);
    o.cur += (o.scale - o.cur) * k;
    const twinkle = reduce ? 1 : 1 + Math.sin(t * 2.3 + o.wobble) * 0.06;
    // The light itself swells strongly; the wide aura grows only a little, so a full
    // class does not melt into one white cloud.
    const u = o.g.userData, boost = o.music * 1.3 + o.pulse * 1.1;
    // The winner (scale 2.8) stays big whatever the crowd.
    o.g.scale.setScalar(o.cur * twinkle * (o.scale > 2 ? 1 : sizeK));
    u.halo.scale.setScalar((1 + boost) * (0.55 + 0.45 * bloom));
    u.core.scale.setScalar(0.3 * (1 + boost * 0.7));
    u.aura.scale.setScalar(1.9 * (1 + boost * 0.25) * (0.35 + 0.65 * bloom));
    // Peaks make the colour burn towards white-hot.
    u.halo.material.color.copy(u.base).lerp(WHITE, Math.min(0.35, o.music * 0.2 + o.pulse * 0.25));
    // Only the phase changes fade slowly; the music part of the brightness is applied directly.
    o.op += (o.opacity - o.op) * k;
    const ok = o.scale > 2 ? 1 : opK;
    setOpacity(o.g, Math.min(1, o.op * (m.on ? 0.55 + o.music * 0.45 : 1) + o.pulse * 0.5) * ok, (o.music + o.pulse) * ok);
    if (!reduce) o.g.position.y += Math.sin(t + o.wobble) * 0.002;
  }
  stars.material.opacity = 0.7 + beatFlash * 0.3;
  stars.material.size = 0.09 * (1 + beatFlash * 0.6 + breath * 0.3);

  sparks = sparks.filter(s => {
    s.life += dt; s.m.position.lerp(s.to.g.position, 1 - Math.pow(0.01, dt));
    s.m.material.opacity = Math.max(0, 1 - s.life / 1.4);
    if (s.life > 1.4) { cluster.remove(s.m); s.to.pulse = Math.max(s.to.pulse, 0.5); return false; }
    return true;
  });
  for (const a of arc.children) if (a.userData.base != null && !reduce) {
    a.position.y = a.userData.base + Math.sin(t * 0.8 + a.userData.i) * 0.06;
  }
  renderer.render(scene, camera);
}
