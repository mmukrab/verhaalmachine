// 3D story space for the beamer: every player is a glowing particle in their own
// colour, drifting in a night sky. Writing makes your light brighter, votes fly to
// it as sparks, the winner comes to the front. Chosen sentences form the story arc
// (verhaalboog) along the top. While players join (lobby), the lights circle a
// planet like moons, each on its own tilted orbit.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { hash } from "./common.js?v=4";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let renderer, scene, camera, cluster, arc, GLOW, raf = 0, spin = 0, last = 0;
const objs = new Map();
let sparks = [], lastRound = -1, lastVotes = 0, arcKey = "", phaseNow = "lobby", authored = new Set();
let planet, orbitSys, planetSide = false, planetShow = 1;
const tmp = new THREE.Vector3();

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
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xc9cdf0, size: 0.09 })));

  scene.add(new THREE.AmbientLight(0x8890c8, 0.6));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6); sun.position.set(-6, 4, 6); scene.add(sun);
  buildPlanet();

  cluster = new THREE.Group(); cluster.position.y = -0.9; scene.add(cluster);
  arc = new THREE.Group(); scene.add(arc);
  addEventListener("resize", resize); resize();
}
/* ---------- planet with moons (lobby) ---------- */
function bandTexture() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 256;
  const x = c.getContext("2d");
  const cols = ["#2a2f6e", "#3b3f8f", "#5b4fa8", "#2f3a7a", "#7a5fb8", "#3a4590", "#c99a3a", "#4a3f8c", "#2a2f6e"];
  let y = 0;
  while (y < 256) {
    const h = 8 + Math.random() * 30;
    x.fillStyle = cols[Math.floor(Math.random() * cols.length)];
    x.globalAlpha = 0.55 + Math.random() * 0.45; x.fillRect(0, y, 512, h); y += h;
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildPlanet() {
  planet = new THREE.Group(); scene.add(planet);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshStandardMaterial({ map: bandTexture(), roughness: 0.85, metalness: 0, emissive: 0x141838, transparent: true }));
  ball.rotation.z = 0.35;
  const atmo = new THREE.Sprite(glowMat(0x6c7cff, 0.45)); atmo.scale.setScalar(3.4); atmo.renderOrder = -1;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.45, 2.05, 96),
    new THREE.MeshBasicMaterial({ color: 0xf5b829, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = Math.PI / 2;
  // Moons orbit in this tilted frame, so their circles read as ellipses.
  orbitSys = new THREE.Group(); orbitSys.rotation.set(0.42, 0, -0.18);
  orbitSys.add(ring);
  planet.add(atmo, ball, orbitSys);
  planet.userData = { ball, atmo, ring };
}
function orbitOf(uid) {
  const h = hash(uid + "orbit");
  return {
    r: 2.25 + (h % 1000) / 1000 * 0.85,
    incl: (((h >>> 10) % 1000) / 1000 - 0.5) * 0.7,
    node: ((h >>> 20) % 1000) / 1000 * Math.PI * 2,
    phase: (hash(uid) % 1000) / 1000 * Math.PI * 2
  };
}
/** World position of a moon at time t (seconds). */
function moonPos(o, t, out) {
  const b = o.orbit, a = b.phase + (reduce ? 0 : t * 0.75 / Math.pow(b.r, 1.5));
  out.set(Math.cos(a) * b.r, 0, Math.sin(a) * b.r);
  out.applyAxisAngle(X_AXIS, b.incl).applyAxisAngle(Y_AXIS, b.node);
  return orbitSys.localToWorld(out);
}
const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0);
function orbitLine(o, color) {
  const pts = [];
  for (let i = 0; i <= 96; i++) {
    const a = i / 96 * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * o.r, 0, Math.sin(a) * o.r).applyAxisAngle(X_AXIS, o.incl).applyAxisAngle(Y_AXIS, o.node));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.22, depthWrite: false }));
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

/** A particle: a coloured halo with a small white-hot core. */
function particle(color, size) {
  const g = new THREE.Group();
  const halo = new THREE.Sprite(glowMat(color)); halo.scale.setScalar(1);
  const core = new THREE.Sprite(glowMat(0xffffff, 0.9)); core.scale.setScalar(0.28);
  g.add(halo, core); g.scale.setScalar(size);
  g.userData = { halo, core, color };
  return g;
}
function setColor(g, color) {
  if (g.userData.color === color) return;
  g.userData.color = color; g.userData.halo.material.color.set(color);
}
function setOpacity(g, a) { g.userData.halo.material.opacity = a; g.userData.core.material.opacity = a * 0.9; }

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
    if (uid) { m = particle(colors[uid] || "#ffffff", finale ? 1.6 : 0.9); pts.push(p); }
    else { m = new THREE.Sprite(glowMat(0x4a5088, 0.5)); m.scale.setScalar(0.35); }
    m.position.copy(p); m.userData.base = p.y; m.userData.i = i; arc.add(m);
  });
  if (pts.length > 1) {
    const curve = new THREE.CatmullRomCurve3(pts);
    arc.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(80)),
      new THREE.LineBasicMaterial({ color: 0xf5b829, transparent: true, opacity: 0.6 })));
  }
}

/** v: {phase, round, players[uid], colors{uid: "#rrggbb"}, authors[], tally{}, winner, votes, chain[uid|null]} */
export function syncSpace(canvas, v) {
  init(canvas);
  phaseNow = v.phase;
  const colors = v.colors || {};
  if (v.round !== lastRound) { lastRound = v.round; lastVotes = 0; authored = new Set(); }

  // One particle per player (and per author, in case a name arrives late).
  const ids = new Set([...(v.players || []), ...v.authors]);
  for (const uid of ids) {
    const color = colors[uid] || "#ffffff";
    let o = objs.get(uid);
    if (!o) {
      const h = home(uid), g = particle(color, 0.01);
      g.position.set(h.x * 0.4, -7, h.z + 2);
      cluster.add(g);
      o = { g, target: h, scale: 0.7, opacity: 0.6, wobble: Math.random() * 6, pulse: 0, orbit: orbitOf(uid) };
      o.line = orbitLine(o.orbit, color); orbitSys.add(o.line);
      objs.set(uid, o);
    }
    if (o.g.userData.color !== color) o.line.material.color.set(color);
    setColor(o.g, color);
  }
  for (const [uid, o] of objs) if (!ids.has(uid)) { cluster.remove(o.g); orbitSys.remove(o.line); objs.delete(uid); }
  planetSide = !!v.lobbyQr;

  // Writing a sentence makes your light flare up once.
  for (const uid of v.authors) if (!authored.has(uid)) { authored.add(uid); const o = objs.get(uid); if (o && v.phase === "write") o.pulse = 1; }

  const max = Math.max(1, ...Object.values(v.tally));
  for (const [uid, o] of objs) {
    const wrote = v.authors.includes(uid);
    if (v.phase === "reveal") {
      const n = v.tally[uid] || 0;
      if (uid === v.winner) { o.target = new THREE.Vector3(0, 0.5, 4.2); o.scale = 2.8; o.opacity = 1; }
      else { o.target = home(uid).multiplyScalar(1.35); o.scale = 0.6 + n / max * 1.4; o.opacity = wrote ? 0.55 : 0.25; }
    } else if (v.phase === "write" || v.phase === "vote") {
      o.target = home(uid); o.scale = wrote ? 1.35 : 0.7; o.opacity = wrote ? 1 : (v.phase === "vote" ? 0.3 : 0.55);
    } else {
      o.target = home(uid).multiplyScalar(v.phase === "finale" ? 1.5 : 1); o.scale = v.phase === "lobby" ? 1.15 : 0.9; o.opacity = v.phase === "lobby" ? 1 : 0.85;
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
  if (phaseNow === "reveal") spin += (Math.round(spin / (Math.PI * 2)) * Math.PI * 2 - spin) * k;
  else if (!reduce) spin += dt * 0.12;
  cluster.rotation.y = spin;
  const t = now / 1000;
  const lobby = phaseNow === "lobby";

  // Planet: in view during the lobby (next to the QR code when it is big), then it sinks away.
  planetShow += ((lobby ? 1 : 0) - planetShow) * k * 0.6;
  const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z * camera.aspect;
  const px = planetSide && halfW > 6 ? Math.min(halfW - 3.6, 5) : 0;
  planet.position.lerp(tmp.set(px, lobby ? -0.3 : -6, 0), k * 0.5);
  planet.scale.setScalar(0.35 + planetShow * 0.65);
  planet.visible = planetShow > 0.02;
  planet.userData.ball.material.opacity = planetShow;
  planet.userData.atmo.material.opacity = 0.45 * planetShow;
  planet.userData.ring.material.opacity = 0.28 * planetShow;
  if (!reduce) planet.userData.ball.rotation.y += dt * 0.08;
  planet.updateMatrixWorld(true); cluster.updateMatrixWorld(true);
  for (const o of objs.values()) {
    o.line.material.opacity = 0.22 * planetShow;
    if (lobby) o.target = cluster.worldToLocal(moonPos(o, t, new THREE.Vector3()));
  }

  for (const o of objs.values()) {
    o.g.position.lerp(o.target, k);
    o.pulse = Math.max(0, o.pulse - dt * 1.2);
    const twinkle = reduce ? 1 : 1 + Math.sin(t * 2.3 + o.wobble) * 0.06;
    const want = o.scale * twinkle * (1 + o.pulse * 1.2);
    o.g.scale.setScalar(o.g.scale.x + (want - o.g.scale.x) * k);
    const a = o.g.userData.halo.material.opacity;
    setOpacity(o.g, a + (Math.min(1, o.opacity + o.pulse) - a) * k);
    if (!reduce) o.g.position.y += Math.sin(t + o.wobble) * 0.002;
  }
  sparks = sparks.filter(s => {
    s.life += dt; s.m.position.lerp(s.to.g.position, 1 - Math.pow(0.01, dt));
    s.m.material.opacity = Math.max(0, 1 - s.life / 1.4);
    if (s.life > 1.4) { cluster.remove(s.m); s.to.pulse = Math.max(s.to.pulse, 0.5); return false; }
    return true;
  });
  for (const m of arc.children) if (m.userData.base != null && !reduce) {
    m.position.y = m.userData.base + Math.sin(t * 0.8 + m.userData.i) * 0.06;
  }
  renderer.render(scene, camera);
}
