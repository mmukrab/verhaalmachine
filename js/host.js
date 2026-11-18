// Teacher view: log in, start a game, run the rounds on the beamer.
import {
  configured, auth, fs, onAuthStateChanged, signInWithEmailAndPassword, signOut, doc, setDoc, updateDoc, getDoc,
  $, el, btn, banner, codeFromUrl, joinUrl, colorOf, watchGame,
  rounds, cur, phase, textOf, authorsFor, votersFor, tally, nameOf, chain,
  renderArc, renderManuscript, storyAsText, DEFAULT_ROUNDS
} from "./common.js?v=4";
import { syncSpace } from "./space.js?v=4";

const stage = $("stage");
let code = codeFromUrl(), S = null, unwatch = null, hostUser = null;
let busy = false, showQr = true, confirmNew = false, setupOpen = false, qrFor = "";

if (!configured) {
  stage.replaceChildren(panel(el("h2", null, "Nog niet ingesteld"), el("p", "muted", "Vul eerst js/firebase-config.js in. Zie README.md voor de stappen.")));
} else {
  onAuthStateChanged(auth, u => {
    if (!u || u.isAnonymous) { hostUser = null; stopWatching(); renderLogin(); return; }
    hostUser = u;
    if (code) open(code); else renderStart();
  });
}
syncSpace($("space"), { phase: "lobby", round: 0, players: [], colors: {}, authors: [], tally: {}, winner: null, votes: 0, chain: DEFAULT_ROUNDS.map(() => null) });

function panel(...kids) { const p = el("div", "panel-box"); p.append(...kids); return p; }
function stopWatching() { if (unwatch) unwatch(); unwatch = null; S = null; $("regie").hidden = true; $("join").hidden = true; }

/* ---------- login & start ---------- */
function renderLogin(err) {
  $("title").textContent = "Regie";
  const f = el("form");
  const le = el("label", null, "E-mailadres spelleider"); le.htmlFor = "email";
  const ie = el("input"); ie.type = "email"; ie.id = "email"; ie.autocomplete = "username"; ie.required = true;
  const lp = el("label", null, "Wachtwoord"); lp.htmlFor = "password";
  const ip = el("input"); ip.type = "password"; ip.id = "password"; ip.autocomplete = "current-password"; ip.required = true;
  const b = el("button", "primary", "Inloggen"); b.type = "submit";
  f.append(le, ie, lp, ip, b);
  if (err) f.append(el("div", "banner error", err));
  f.onsubmit = async e => {
    e.preventDefault(); b.disabled = true;
    try { await signInWithEmailAndPassword(auth, ie.value.trim(), ip.value); }
    catch (x) { renderLogin("Inloggen lukte niet. Controleer je e-mailadres en wachtwoord. (" + (x.code || "fout") + ")"); }
  };
  stage.replaceChildren(panel(el("h2", null, "Inloggen als spelleider"), f));
}

function renderStart(err) {
  $("title").textContent = "Nieuw verhaal";
  const f = el("form");
  const l = el("label", null, "Of open een bestaand spel"); l.htmlFor = "open-code";
  const i = el("input"); i.type = "text"; i.id = "open-code"; i.placeholder = "Spelcode"; i.maxLength = 8; i.style.textTransform = "uppercase";
  const b = el("button", "", "Openen"); b.type = "submit";
  f.append(l, i, b);
  f.onsubmit = e => { e.preventDefault(); const c = i.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); if (c) open(c); };
  const kids = [el("h2", null, "Start een spel"), btn("Nieuw spel maken", "primary", () => newGame(), busy), f,
    el("p", "note", "Ingelogd als " + (hostUser.email || "") + "."), btn("Uitloggen", "", () => signOut(auth))];
  if (err) kids.splice(1, 0, el("div", "banner error", err));
  stage.replaceChildren(panel(...kids));
}

function genCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c = "";
  const r = crypto.getRandomValues(new Uint32Array(4));
  for (const x of r) c += A[x % A.length];
  return c;
}
function hostHint() {
  return "Is jouw UID als spelleider in firestore.rules gezet en zijn de regels gepubliceerd? Jouw UID: " + (hostUser ? hostUser.uid : "?");
}
async function newGame() {
  busy = true;
  try {
    let c = genCode();
    if ((await getDoc(doc(fs, "games", c))).exists()) c = genCode();
    const prev = S && S.game;
    await setDoc(doc(fs, "games", c), {
      title: (prev && prev.title) || "Ons verhaal", rounds: (prev && prev.rounds) || DEFAULT_ROUNDS,
      current: 0, phase: "lobby", winners: {}, createdAt: Date.now(), host: hostUser.uid
    });
    busy = false; confirmNew = false;
    open(c);
  } catch (e) {
    busy = false; console.error(e);
    renderStart(e.code === "permission-denied" ? "Je mag geen spel maken. " + hostHint() : "Spel maken lukte niet (" + (e.code || "fout") + ").");
  }
}
function open(c) {
  stopWatching();
  code = c;
  history.replaceState(null, "", "?g=" + c);
  unwatch = watchGame(c, s => { S = s; render(); }, e => {
    console.error(e);
    banner(stage, "Verbinding met het spel verbroken (" + (e.code || "fout") + "). Herlaad de pagina.", 10000);
  });
}

/* ---------- game control ---------- */
async function writeState(patch) {
  if (busy) return; busy = true; render();
  try { await updateDoc(doc(fs, "games", code), patch); }
  catch (e) {
    console.error(e);
    const b = el("div", "banner error", e.code === "permission-denied" ? "Opslaan geweigerd. " + hostHint() : "Opslaan lukte niet (" + (e.code || "fout") + ").");
    stage.prepend(b); setTimeout(() => b.remove(), 8000);
  }
  busy = false; render();
}
const host = {
  start: () => writeState({ phase: "write", current: 0, winners: {} }),
  toVote: () => writeState({ phase: "vote" }),
  reveal() {
    const r = cur(S), t = tally(S, r), ids = authorsFor(S, r).sort((a, b) => (t[b] || 0) - (t[a] || 0));
    writeState({ phase: "reveal", ["winners." + r]: ids[0] || null });
  },
  nextCandidate() {
    const r = cur(S), t = tally(S, r), ids = authorsFor(S, r).sort((a, b) => (t[b] || 0) - (t[a] || 0));
    if (ids.length < 2) return;
    const i = ids.indexOf(S.game.winners && S.game.winners[r]);
    writeState({ ["winners." + r]: ids[(i + 1) % ids.length] });
  },
  next: () => cur(S) + 1 < rounds(S).length ? writeState({ phase: "write", current: cur(S) + 1 }) : writeState({ phase: "finale" }),
  finale: () => writeState({ phase: "finale" })
};

/* ---------- render ---------- */
function render() {
  if (!S) return;
  const g = S.game, p = phase(S), r = cur(S);
  $("title").textContent = (g && g.title) || "Ons verhaal";
  renderArc($("arc"), S);
  renderRegie();
  renderJoin();
  const m = $("manuscript"); m.hidden = p !== "finale";
  if (p === "finale") renderManuscript(m, S, (g && g.title) || "Ons verhaal");
  renderStage();
  // The setup form lives outside the stage so players joining don't wipe what you type.
  const setup = $("setup"), want = setupOpen && p === "lobby" && !!g;
  if (want && setup.hidden) setup.replaceChildren(renderSetup());
  setup.hidden = !want;
  const w = (g && g.winners) || {};
  const players = Object.keys(S.players), colors = {};
  for (const uid of players) colors[uid] = colorOf(S, uid);
  for (const x of chain(S)) if (x) colors[x.uid] = colorOf(S, x.uid);
  syncSpace($("space"), {
    phase: p, round: r, players, colors, lobbyQr: p === "lobby" && showQr && !setupOpen && !!g, authors: authorsFor(S, r), tally: tally(S, r), winner: w[r] || null,
    votes: votersFor(S, r).length, chain: chain(S).map(x => (x ? x.uid : null))
  });
}

function renderRegie() {
  const bar = $("regie"); bar.hidden = false; bar.replaceChildren();
  const g = S.game, p = phase(S), r = cur(S), last = r + 1 >= rounds(S).length;
  const names = { lobby: "wachten op spelers", write: "ronde " + (r + 1) + " · schrijven", vote: "ronde " + (r + 1) + " · stemmen", reveal: "ronde " + (r + 1) + " · uitslag", finale: "finale" };
  bar.append(el("span", "lbl", "Spel " + code + " · " + (g ? names[p] : "niet gevonden")));
  if (g) {
    if (p === "lobby") {
      bar.append(btn(setupOpen ? "Instellingen sluiten" : "Rondes instellen", "", () => { setupOpen = !setupOpen; render(); }));
      bar.append(btn("Start ronde 1", "primary", host.start, busy));
    }
    if (p === "write") bar.append(btn("Naar stemmen", "primary", host.toVote, busy || !authorsFor(S, r).length));
    if (p === "vote") bar.append(btn("Toon winnaar", "primary", host.reveal, busy));
    if (p === "reveal") {
      if (authorsFor(S, r).length > 1) bar.append(btn("Andere winnaar", "", host.nextCandidate, busy));
      bar.append(btn(last ? "Naar de finale" : "Volgende ronde", "primary", host.next, busy));
    }
    if (p === "write" || p === "vote") if (!last) bar.append(btn("Direct naar finale", "", host.finale, busy));
    if (p === "finale") bar.append(btn("Kopieer verhaal", "", () => {
      navigator.clipboard.writeText(storyAsText(S)).then(() => banner(stage, "Verhaal gekopieerd", 3000), () => banner(stage, "Kopiëren lukte niet", 3000));
    }));
    bar.append(btn(showQr ? "QR verbergen" : "QR tonen", "", () => { showQr = !showQr; render(); }));
  }
  bar.append(btn("Volledig scherm", "", () => { document.documentElement.requestFullscreen?.().catch(() => {}); }));
  if (!confirmNew) bar.append(btn("Nieuw spel", "", () => { confirmNew = true; render(); }, busy));
  else bar.append(btn("Ja, nieuw spel", "primary", () => newGame(), busy), btn("Annuleer", "", () => { confirmNew = false; render(); }));
  bar.append(btn("Uitloggen", "", () => signOut(auth)));
  bar.append(el("span", "lbl", "Toets H verbergt deze balk"));
}

function renderJoin() {
  const p = phase(S), on = !!S.game && showQr && (p === "lobby" || p === "write");
  const box = $("join"); box.hidden = !on;
  box.classList.toggle("big", p === "lobby" && !setupOpen);
  if (!on) return;
  const url = joinUrl(code);
  if (qrFor !== url && window.QRCode) {
    $("qr").replaceChildren();
    new QRCode($("qr"), { text: url, width: 512, height: 512, colorDark: "#1a1d38", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
    qrFor = url;
  }
  $("join-code").textContent = code;
  $("join-url").textContent = "of ga naar " + url.replace(/^https?:\/\//, "").replace(/\?g=.*$/, "") + " en vul de code in";
}

function renderStage() {
  stage.replaceChildren();
  if (!S.loaded) { stage.append(el("p", "muted", "Laden…")); return; }
  if (!S.game) { stage.append(panel(el("h2", null, "Spel " + code + " bestaat niet"), btn("Nieuw spel maken", "primary", () => newGame(), busy))); return; }
  const p = phase(S), r = cur(S), rd = rounds(S)[r];
  const players = Object.keys(S.players);

  if (p === "lobby") {
    stage.append(el("span", "eyebrow", players.length + (players.length === 1 ? " speler" : " spelers") + " binnen"),
      el("div", "prompt", "Scan de code en doe mee"));
    const chips = el("div", "names");
    for (const uid of players) { const s = el("span"); const gm = el("span", "gem"); gm.style.background = colorOf(S, uid); s.append(gm, document.createTextNode(nameOf(S, uid))); chips.append(s); }
    stage.append(chips);
    return;
  }
  if (p === "finale") { stage.append(el("span", "eyebrow", "Finale"), el("div", "prompt", "Dit is ons verhaal.")); return; }

  stage.append(el("span", "eyebrow", "Ronde " + (r + 1) + " van " + rounds(S).length + " · " + rd.label), el("div", "prompt", rd.prompt));
  const authors = authorsFor(S, r);
  if (p === "write") stage.append(el("span", "pill", authors.length + " van " + players.length + " ingestuurd"));
  if (p === "vote") stage.append(el("span", "pill", votersFor(S, r).length + " van " + players.length + " gestemd"));
  if (p === "reveal") {
    const w = S.game.winners && S.game.winners[r], t = tally(S, r);
    if (!w) { stage.append(el("p", "empty", "Geen bijdragen in deze ronde.")); return; }
    const c = el("div", "card win");
    c.append(el("span", null, textOf(S, w, r)), el("span", "meta", nameOf(S, w) + " · " + (t[w] || 0) + ((t[w] || 0) === 1 ? " stem" : " stemmen")));
    stage.append(c);
  }
}

function renderSetup() {
  const g = S.game;
  const ti = el("input"); ti.type = "text"; ti.id = "setup-title"; ti.value = g.title || "Ons verhaal";
  const lt = el("label", null, "Titel van het verhaal"); lt.htmlFor = "setup-title";
  const ta = el("textarea"); ta.id = "setup-rounds"; ta.rows = 7; ta.style.fontFamily = "var(--display)"; ta.style.fontSize = "0.95rem";
  ta.value = rounds(S).map(x => x.label + " | " + x.prompt).join("\n");
  const lr = el("label", null, "Rondes: één per regel, als  Label | vraag"); lr.htmlFor = "setup-rounds";
  const save = btn("Opslaan", "primary", async () => {
    if (busy) return;
    const rs = ta.value.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
      const [a, ...b] = l.split("|"); return b.length ? { label: a.trim().slice(0, 30), prompt: b.join("|").trim().slice(0, 200) } : { label: "Ronde", prompt: a.trim().slice(0, 200) };
    }).slice(0, 12);
    if (!rs.length) return;
    setupOpen = false;
    await writeState({ title: ti.value.trim().slice(0, 80) || "Ons verhaal", rounds: rs });
  }, busy);
  return panel(el("h3", null, "Spel instellen"), lt, ti, lr, ta, save);
}

addEventListener("keydown", e => {
  if (e.target.closest("input, textarea")) return;
  if (e.key === "h" || e.key === "H") $("regie").classList.toggle("tucked");
});
