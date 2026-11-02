import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot, setDoc, updateDoc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const configured = !String(firebaseConfig.apiKey || "").startsWith("VUL");
export const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const fs = app ? getFirestore(app) : null;
export { signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut, doc, collection, onSnapshot, setDoc, updateDoc, getDoc, deleteDoc };

export const DEFAULT_ROUNDS = [
  { label: "Personage", prompt: "Wie is de hoofdpersoon? Beschrijf die in één zin." },
  { label: "Wereld", prompt: "Waar en wanneer speelt ons verhaal zich af?" },
  { label: "Verlangen", prompt: "Wat wil de hoofdpersoon meer dan wat ook?" },
  { label: "Conflict", prompt: "Wat gaat er mis, of wie staat in de weg?" },
  { label: "Keerpunt", prompt: "Welke onverwachte wending verandert alles?" },
  { label: "Ontknoping", prompt: "Hoe loopt het af?" }
];
export const MAX = 240;
export const NAME_MAX = 30;

/* ---------- DOM helpers ---------- */
export const $ = id => document.getElementById(id);
export function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
export function btn(text, cls, onclick, disabled) { const b = el("button", cls, text); b.type = "button"; b.onclick = onclick; b.disabled = !!disabled; return b; }
export function banner(parent, msg, ms = 5000) { const b = el("div", "banner", msg); parent.prepend(b); setTimeout(() => b.remove(), ms); }

export function codeFromUrl() {
  const c = new URLSearchParams(location.search).get("g");
  return c ? c.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) : "";
}
export function joinUrl(code) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  return base + "?g=" + code;
}

/* ---------- colours: the same per player on phone and beamer ---------- */
export const hash = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
export const hueOf = uid => hash(uid) % 360;
export const cssColor = uid => `hsl(${hueOf(uid)} 72% 58%)`;

/* ---------- live game state ---------- */
export function watchGame(code, onChange, onError) {
  const S = { code, game: null, loaded: false, entries: {}, votes: {}, players: {} };
  const fire = () => onChange(S);
  const unsubs = [
    onSnapshot(doc(fs, "games", code), s => { S.game = s.exists() ? s.data() : null; S.loaded = true; fire(); }, onError)
  ];
  for (const k of ["entries", "votes", "players"]) {
    unsubs.push(onSnapshot(collection(fs, "games", code, k), s => {
      const m = {}; s.forEach(d => { m[d.id] = d.data(); }); S[k] = m; fire();
    }, onError));
  }
  return () => unsubs.forEach(u => u());
}

export const rounds = S => (S.game && S.game.rounds) || DEFAULT_ROUNDS;
export const cur = S => (S.game ? S.game.current : 0);
export const phase = S => (S.game ? S.game.phase : "lobby");
export const textOf = (S, uid, r) => S.entries[uid] && S.entries[uid].texts && S.entries[uid].texts[r];
export const authorsFor = (S, r) => Object.keys(S.entries).filter(uid => textOf(S, uid, r));
export const votersFor = (S, r) => Object.keys(S.votes).filter(uid => S.votes[uid].picks && S.votes[uid].picks[r]);
export const nameOf = (S, uid) => (S.players[uid] && S.players[uid].name) || "Anoniem";
export function tally(S, r) {
  const t = {};
  for (const uid of Object.keys(S.votes)) {
    const pick = S.votes[uid].picks && S.votes[uid].picks[r];
    if (pick && pick !== uid && textOf(S, pick, r)) t[pick] = (t[pick] || 0) + 1;
  }
  return t;
}
/** The chosen sentences that are already part of the story. */
export function chain(S) {
  const w = (S.game && S.game.winners) || {}, p = phase(S), r = cur(S);
  return rounds(S).map((rd, i) => {
    const uid = w[i];
    const visible = uid && textOf(S, uid, i) && (p === "finale" || i < r || (i === r && p === "reveal"));
    return visible ? { i, label: rd.label, uid, text: textOf(S, uid, i) } : null;
  });
}
export function shuffleStable(ids, r) {
  return [...ids].sort((a, b) => hash(a + ":" + r) - hash(b + ":" + r));
}

/* ---------- shared renderers ---------- */
export function renderArc(node, S) {
  node.replaceChildren();
  const p = phase(S), r = cur(S);
  rounds(S).forEach((rd, i) => {
    const s = el("div", "step", rd.label);
    if (p === "finale" || i < r) s.classList.add("done");
    else if (i === r && p !== "lobby") s.classList.add("now");
    node.append(s);
  });
}
export function renderManuscript(node, S, title) {
  node.replaceChildren();
  const parts = chain(S).filter(Boolean);
  node.append(el("h2", null, title));
  if (!parts.length) { node.append(el("p", "empty", "Nog geen zinnen gekozen. Na elke ronde groeit hier het verhaal.")); return; }
  for (const x of parts) {
    const d = el("div", "para");
    d.append(el("span", "tag", x.label), el("p", null, x.text), el("span", "by", "— " + nameOf(S, x.uid)));
    node.append(d);
  }
}
export function storyAsText(S) {
  return ((S.game && S.game.title) || "Ons verhaal") + "\n\n" + chain(S).filter(Boolean).map(x => x.text).join("\n\n");
}
