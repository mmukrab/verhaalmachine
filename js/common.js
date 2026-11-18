import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot, setDoc, updateDoc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=18";
import { moderate, normName } from "./moderation.js?v=18";

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
/** Ready-made sets of rounds the host can start from. */
export const PRESETS = [
  { name: "Innovatie in de mediaberoepen (2036)", title: "Media in 2036", rounds: [
    { label: "Aanleiding", prompt: "Welk probleem zie jij in je vakgebied of in de wereld dat media in 2036 kunnen oplossen?" },
    { label: "Innovatie", prompt: "Welk nieuw mediaproduct of welke nieuwe techniek lost dat in 2036 op?" },
    { label: "Makers", prompt: "Welke vakmensen (AV, fotografie, vormgeving, redactie, immersief) werkten eraan, en wat deed ieder?" },
    { label: "Werking", prompt: "Hoe werkt het, en wat ervaart de gebruiker?" },
    { label: "Risico", prompt: "Wat kan er misgaan, of welk nadeel heeft het?" },
    { label: "Vakmanschap", prompt: "Wat kan alleen een mens hieraan bijdragen, wat de techniek niet kan?" },
    { label: "Impact", prompt: "Hoe verandert dit het werkveld, of de wereld?" }
  ] },
  { name: "Klassiek verhaal", title: "Ons verhaal", rounds: DEFAULT_ROUNDS }
];
export const MAX_ROUNDS = 12, LABEL_MAX = 30, PROMPT_MAX = 200;
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
// Bright colours that stay readable as glowing particles on the dark beamer sky.
export const PALETTE = [
  "#ff5d5d", "#ff9f43", "#ffd23f", "#b8f25a", "#2ecc71", "#1dd3b0",
  "#3ec7ff", "#4d7cff", "#9b6bff", "#e46bff", "#ff6fb5", "#f4f4f8"
];
export const isColor = c => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);
export const defaultColor = uid => PALETTE[hash(uid) % PALETTE.length];
/** The colour a player picked, or a stable default from their id. */
export const colorOf = (S, uid) => {
  const c = S && S.players && S.players[uid] && S.players[uid].color;
  return isColor(c) ? c.toLowerCase() : defaultColor(uid);
};

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
/* ---------- moderation ---------- */
export const otherNames = (S, uid) => Object.keys(S.players).filter(u => u !== uid).map(u => S.players[u].name || "");
// With a big class the filter runs for every sentence on every update, so results are cached
// per players-snapshot (a new object whenever someone joins or renames) and per sentence text.
const modCache = new WeakMap();
function cachedModerate(S, uid, text) {
  let c = modCache.get(S.players);
  if (!c) {
    const names = new Map(Object.keys(S.players).map(u => [u, normName(S.players[u].name || "")]));
    c = { names, results: new Map() };
    modCache.set(S.players, c);
  }
  const key = uid + "|" + text;
  let m = c.results.get(key);
  if (!m) {
    const others = []; for (const [u, n] of c.names) if (u !== uid) others.push(n);
    m = moderate(text, others, true);
    c.results.set(key, m);
  }
  return m;
}
/** {hidden, by: "docent"|"auto"|"", approved, reasons[]} for one sentence. The teacher's choice wins. */
export function modState(S, uid, r) {
  const set = S.game && S.game.hidden && S.game.hidden[r] && S.game.hidden[r][uid];
  const m = cachedModerate(S, uid, textOf(S, uid, r) || "");
  if (set === true) return { hidden: true, by: "docent", approved: false, reasons: m.reasons };
  if (set === false) return { hidden: false, by: "", approved: true, reasons: m.reasons };
  const auto = m.block || m.flag;
  return { hidden: auto, by: auto ? "auto" : "", approved: false, reasons: m.reasons };
}
export const isHidden = (S, uid, r) => modState(S, uid, r).hidden;
/** Authors whose sentence may be voted on and can win. */
export const visibleAuthors = (S, r) => authorsFor(S, r).filter(uid => !isHidden(S, uid, r));

export function tally(S, r) {
  const t = {};
  for (const uid of Object.keys(S.votes)) {
    const pick = S.votes[uid].picks && S.votes[uid].picks[r];
    if (pick && pick !== uid && textOf(S, pick, r) && !isHidden(S, pick, r)) t[pick] = (t[pick] || 0) + 1;
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
