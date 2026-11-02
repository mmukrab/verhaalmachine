// 3D story space for the beamer: each sentence is a gem in a night sky,
// chosen sentences form the story arc (verhaalboog) along the top.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { hash, hueOf } from "./common.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let renderer, scene, camera, cluster, arc, GEO, raf = 0, spin = 0, last = 0;
const objs = new Map();
let sparks = [], lastRound = -1, lastVotes = 0, arcKey = "", phaseNow = "lobby";

const colorFor = uid => new THREE.Color().setHSL(hueOf(uid) / 360, 0.72, 0.58);

function init(canvas) {
  if (renderer) return;
  GEO = [
    new THREE.IcosahedronGeometry(0.3, 0), new THREE.OctahedronGeometry(0.32, 0), new THREE.TetrahedronGeometry(0.36, 0),
    new THREE.DodecahedronGeometry(0.29, 0), new THREE.BoxGeometry(0.38, 0.38, 0.38)
  ];
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d22);
  scene.fog = new THREE.FogExp2(0x0b0d22, 0.045);
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
  camera.position.set(0, 0.4, 9);
  scene.add(new THREE.AmbientLight(0x9098d0, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(4, 6, 8); scene.add(key);
  const warm = new THREE.PointLight(0xf5b829, 60, 40, 1.6); warm.position.set(-4, -3, 5); scene.add(warm);

  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 18 + Math.random() * 30, a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1);
    pos.set([r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a)], i * 3);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xc9cdf0, size: 0.09 })));

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
function gem(uid, size) {
  const m = new THREE.Mesh(GEO[hash(uid + "g") % GEO.length],
    new THREE.MeshStandardMaterial({ color: colorFor(uid), flatShading: true, roughness: 0.35, metalness: 0.15, transparent: true, opacity: 1 }));
  m.scale.setScalar(size); return m;
}
function clearCluster() { for (const o of objs.values()) cluster.remove(o.m); objs.clear(); }

function buildArc(slots, finale) {
  const key = slots.join(",") + (finale ? "|f" : "");
  if (key === arcKey) return; arcKey = key;
  while (arc.children.length) arc.remove(arc.children[0]);
  const n = slots.length, pts = [];
  const w = finale ? 7 : 6.4, y0 = finale ? 0.6 : 2.9, lift = finale ? 1.3 : 0.55;
  slots.forEach((uid, i) => {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const p = new THREE.Vector3((t - 0.5) * w, y0 + Math.sin(t * Math.PI) * lift, finale ? 1 : -1);
    let m;
    if (uid) { m = gem(uid, finale ? 1.5 : 0.75); pts.push(p); }
    else { m = new THREE.Mesh(GEO[0], new THREE.MeshBasicMaterial({ color: 0x4a5088, wireframe: true })); m.scale.setScalar(0.55); }
    m.position.copy(p); m.userData.base = p.y; m.userData.i = i; arc.add(m);
  });
  if (pts.length > 1) {
    const curve = new THREE.CatmullRomCurve3(pts);
    arc.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(80)),
      new THREE.LineBasicMaterial({ color: 0xf5b829, transparent: true, opacity: 0.8 })));
  }
}

/** v: {phase, round, authors[], tally{}, winner, votes, chain[uid|null]} */
export function syncSpace(canvas, v) {
  init(canvas);
  phaseNow = v.phase;
  if (v.round !== lastRound || v.phase === "lobby" || v.phase === "finale") { clearCluster(); lastRound = v.round; lastVotes = 0; }
  if (v.phase !== "finale" && v.phase !== "lobby") {
    for (const uid of v.authors) if (!objs.has(uid)) {
      const h = home(uid), m = gem(uid, 0.01);
      m.position.set(h.x * 0.4, -7, h.z + 2);
      cluster.add(m);
      objs.set(uid, { m, target: h, scale: 1, opacity: 1, wobble: Math.random() * 6 });
    }
    for (const [uid, o] of objs) if (!v.authors.includes(uid)) { cluster.remove(o.m); objs.delete(uid); }
  }
  const max = Math.max(1, ...Object.values(v.tally));
  for (const [uid, o] of objs) {
    if (v.phase === "reveal") {
      const n = v.tally[uid] || 0;
      if (uid === v.winner) { o.target = new THREE.Vector3(0, 0.5, 4.2); o.scale = 2.4; o.opacity = 1; }
      else { o.target = home(uid).multiplyScalar(1.35); o.scale = 0.6 + n / max * 1.4; o.opacity = 0.35; }
    } else { o.target = home(uid); o.scale = 1; o.opacity = 1; }
  }
  if (v.phase === "vote" && v.votes > lastVotes && !reduce) {
    for (let i = 0; i < Math.min(v.votes - lastVotes, 12); i++) spark();
  }
  lastVotes = v.votes;
  buildArc(v.chain, v.phase === "finale");
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
}

function spark() {
  const list = [...objs.values()]; if (!list.length) return;
  const to = list[Math.floor(Math.random() * list.length)];
  const m = new THREE.Mesh(GEO[2], new THREE.MeshBasicMaterial({ color: 0xf5b829, transparent: true }));
  m.scale.setScalar(0.25); m.position.set((Math.random() - 0.5) * 8, -6, 3);
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
  for (const o of objs.values()) {
    o.m.position.lerp(o.target, k);
    o.m.scale.setScalar(o.m.scale.x + (o.scale - o.m.scale.x) * k);
    o.m.material.opacity += (o.opacity - o.m.material.opacity) * k;
    if (!reduce) { o.m.rotation.x += dt * 0.4; o.m.rotation.y += dt * 0.6; o.m.position.y += Math.sin(t + o.wobble) * 0.002; }
  }
  sparks = sparks.filter(s => {
    s.life += dt; s.m.position.lerp(s.to.m.position, 1 - Math.pow(0.01, dt));
    s.m.material.opacity = Math.max(0, 1 - s.life / 1.4);
    if (s.life > 1.4) { cluster.remove(s.m); s.to.m.scale.multiplyScalar(1.15); return false; }
    return true;
  });
  for (const m of arc.children) if (m.userData.base != null && !reduce) {
    m.position.y = m.userData.base + Math.sin(t * 0.8 + m.userData.i) * 0.06; m.rotation.y += dt * 0.5;
  }
  renderer.render(scene, camera);
}
