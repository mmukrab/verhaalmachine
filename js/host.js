// Teacher view: log in, start a game, run the rounds on the beamer.
import {
  configured, auth, fs, onAuthStateChanged, signInWithEmailAndPassword, signOut, doc, setDoc, updateDoc, getDoc,
  $, el, btn, banner, codeFromUrl, joinUrl, colorOf, watchGame,
  rounds, cur, phase, textOf, authorsFor, votersFor, tally, nameOf, chain,
  renderArc, renderManuscript, storyAsText, DEFAULT_ROUNDS, PRESETS, MAX_ROUNDS, LABEL_MAX, PROMPT_MAX,
  modState, visibleAuthors, PALETTE
} from "./common.js?v=17";
import { syncSpace, nextFormation, FREQ_FAMILIES, getBloom, setBloom } from "./space.js?v=17";
import { playFile, listenMic, stopMusic, musicMode, musicName, musicInfo, nudgeSync } from "./audio.js?v=17";

const stage = $("stage");
let code = codeFromUrl(), S = null, unwatch = null, hostUser = null;
const TEST_STEPS = [0, 10, 30, 100, 200];
let testLights = 0;
let busy = false, showQr = true, confirmNew = false, setupOpen = false, modOpen = false, qrFor = "";

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
  start: () => writeState({ phase: "write", current: 0, winners: {}, ties: {}, hidden: {} }),
  toVote: () => writeState({ phase: "vote" }),
  // Most votes wins. A tie (also: nobody voted) is settled by a fair lottery among the
  // tied sentences; the host can then pick another of them on the beamer.
  reveal() {
    const r = cur(S), t = tally(S, r), ids = visibleAuthors(S, r);
    const top = Math.max(0, ...ids.map(u => t[u] || 0));
    const tied = ids.filter(u => (t[u] || 0) === top);
    const win = tied.length ? tied[crypto.getRandomValues(new Uint32Array(1))[0] % tied.length] : null;
    writeState({ phase: "reveal", ["winners." + r]: win, ["ties." + r]: tied.length > 1 ? { ids: tied, by: "lot" } : null });
  },
  pick(uid) {
    const r = cur(S), tie = S.game.ties && S.game.ties[r];
    writeState({ ["winners." + r]: uid, ...(tie ? { ["ties." + r + ".by"]: "docent" } : {}) });
  },
  nextCandidate() {
    const r = cur(S), t = tally(S, r), ids = visibleAuthors(S, r).sort((a, b) => (t[b] || 0) - (t[a] || 0));
    if (ids.length < 2) return;
    const i = ids.indexOf(S.game.winners && S.game.winners[r]);
    writeState({ ["winners." + r]: ids[(i + 1) % ids.length] });
  },
  setHidden: (uid, hide) => writeState({ ["hidden." + cur(S) + "." + uid]: hide }),
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
  const mod = $("moderation"), showMod = modOpen && !!g && (p === "write" || p === "vote" || p === "reveal");
  mod.hidden = !showMod;
  if (showMod) mod.replaceChildren(renderModeration());
  const w = (g && g.winners) || {};
  const players = Object.keys(S.players), colors = {};
  for (const uid of players) colors[uid] = colorOf(S, uid);
  for (const x of chain(S)) if (x) colors[x.uid] = colorOf(S, x.uid);
  // Test lights: only on this beamer, never stored in the game. About 70% of them "write".
  const authors = authorsFor(S, r);
  for (let i = 0; i < testLights; i++) {
    const id = "testlicht-" + i; players.push(id); colors[id] = PALETTE[(i * 5) % PALETTE.length];
    if (p !== "lobby" && (i * 7) % 10 < 7) authors.push(id);
  }
  renderLegend();
  syncSpace($("space"), {
    phase: p, round: r, players, colors, lobbyQr: p === "lobby" && showQr && !setupOpen && !!g, authors, tally: tally(S, r), winner: w[r] || null,
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
      bar.append(btn(setupOpen ? "Instellingen sluiten" : "Rondes instellen", "", () => { setupOpen = !setupOpen; draftRounds = null; render(); }));
      bar.append(btn("Start ronde 1", "primary", host.start, busy));
    }
    if (p === "write") bar.append(btn("Naar stemmen", "primary", host.toVote, busy || !authorsFor(S, r).length));
    if (p === "vote") bar.append(btn("Toon winnaar", "primary", host.reveal, busy));
    if (p === "reveal") {
      if (visibleAuthors(S, r).length > 1) bar.append(btn("Andere winnaar", "", host.nextCandidate, busy));
      bar.append(btn(last ? "Naar de finale" : "Volgende ronde", "primary", host.next, busy));
    }
    if (p === "write" || p === "vote") if (!last) bar.append(btn("Direct naar finale", "", host.finale, busy));
    if (p === "write" || p === "vote" || p === "reveal") {
      const waiting = authorsFor(S, r).filter(u => modState(S, u, r).by === "auto").length;
      const b = btn((modOpen ? "Controle sluiten" : "Zinnen controleren") + (waiting ? " (" + waiting + ")" : ""), waiting ? "warn" : "", () => { modOpen = !modOpen; render(); });
      bar.append(b);
    }
    if (p === "finale") bar.append(btn("Kopieer verhaal", "", () => {
      navigator.clipboard.writeText(storyAsText(S)).then(() => banner(stage, "Verhaal gekopieerd", 3000), () => banner(stage, "Kopiëren lukte niet", 3000));
    }));
    bar.append(btn(showQr ? "QR verbergen" : "QR tonen", "", () => { showQr = !showQr; render(); }));
  }
  musicButtons(bar);
  bar.append(bloomControl);
  // Testing the beamer with more lights, and skipping to another formation.
  bar.append(btn("Testlichtjes: " + testLights, "", () => {
    testLights = TEST_STEPS[(TEST_STEPS.indexOf(testLights) + 1) % TEST_STEPS.length]; render();
  }));
  if (phase(S) === "lobby") bar.append(btn("Andere vorm", "", () => { nextFormation(); }));
  bar.append(btn("Volledig scherm", "", () => { document.documentElement.requestFullscreen?.().catch(() => {}); }));
  if (!confirmNew) bar.append(btn("Nieuw spel", "", () => { confirmNew = true; render(); }, busy));
  else bar.append(btn("Ja, nieuw spel", "primary", () => newGame(), busy), btn("Annuleer", "", () => { confirmNew = false; render(); }));
  bar.append(btn("Uitloggen", "", () => signOut(auth)));
  bar.append(el("span", "lbl", "Toets H verbergt deze balk"));
}

/* ---------- bloom slider: one persistent element, so re-rendering the bar doesn't reset it ---------- */
const bloomControl = el("label", "bloom");
const bloomInput = el("input"); bloomInput.type = "range"; bloomInput.min = "0"; bloomInput.max = "150"; bloomInput.step = "5";
bloomInput.value = String(Math.round(getBloom() * 100));
bloomInput.setAttribute("aria-label", "Gloed van de lichtjes");
const bloomValue = el("span", "bloom-value", bloomInput.value + "%");
bloomInput.oninput = () => { setBloom(Number(bloomInput.value) / 100); bloomValue.textContent = bloomInput.value + "%"; };
bloomControl.append(el("span", null, "Gloed"), bloomInput, bloomValue);

/* ---------- colour legend (only while music plays) ---------- */
function renderLegend() {
  const box = $("legend"), on = !!musicMode();
  box.hidden = !on;
  if (!on || box.childElementCount) return;
  box.append(el("span", "legend-title", "Kleur = toonhoogte"));
  for (const f of FREQ_FAMILIES) {
    const item = el("span", "legend-item"); const dot = el("span", "gem"); dot.style.background = f.swatch;
    item.append(dot, document.createTextNode(f.name + " · " + f.what)); box.append(item);
  }
  const w = el("span", "legend-item"); const d = el("span", "gem"); d.style.background = "#f4f4f8";
  w.append(d, document.createTextNode("Wit · alles")); box.append(w);
}

/* ---------- music ---------- */
const musicInput = el("input"); musicInput.type = "file"; musicInput.accept = "audio/*"; musicInput.hidden = true;
document.body.append(musicInput);
musicInput.onchange = async () => {
  const f = musicInput.files && musicInput.files[0]; musicInput.value = "";
  if (!f) return;
  const note = el("div", "banner", "Muziek analyseren… (tempo en beats)"); stage.prepend(note);
  try { await playFile(f); } catch (e) { console.error(e); banner(stage, "Dit muziekbestand kan niet worden afgespeeld.", 5000); }
  note.remove();
  if (S) render();
};
function musicButtons(bar) {
  const m = musicMode();
  if (!m) {
    bar.append(btn("Muziek kiezen", "", () => musicInput.click()));
    bar.append(btn("Microfoon", "", async () => {
      try { await listenMic(); } catch (e) { console.error(e); banner(stage, "De microfoon is niet beschikbaar of geen toestemming gegeven.", 6000); }
      if (S) render();
    }));
  } else {
    const info = musicInfo();
    const what = m === "mic" ? "♪ luistert via microfoon" : "♪ " + musicName() + (info.grid ? " · " + info.bpm + " BPM" : " · live beatdetectie");
    bar.append(el("span", "lbl", what + " · sync met [ en ]"));
    bar.append(btn("Muziek stoppen", "", () => { stopMusic(); if (S) render(); }));
  }
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
    const tie = S.game.ties && S.game.ties[r];
    if (tie && tie.ids && tie.ids.length > 1) {
      const n = t[w] || 0;
      stage.append(el("p", "tie-note", "Gelijkspel: " + tie.ids.length + " zinnen met " + n + (n === 1 ? " stem" : " stemmen") + " · " +
        (tie.by === "docent" ? "gekozen door de docent" : "winnaar gekozen door loting") + ". Klik een andere zin om die te kiezen."));
      const others = el("div", "cards tie-cards");
      // Show at most 6 alternatives; with a big tie the rest is reachable via "Andere winnaar".
      const alts = tie.ids.filter(uid => uid !== w && textOf(S, uid, r));
      for (const uid of alts.slice(0, 6)) {
        const b = el("button", "card"); b.type = "button"; b.disabled = busy;
        b.append(el("span", null, textOf(S, uid, r)), el("span", "meta", nameOf(S, uid) + " · Kies deze zin"));
        b.onclick = () => host.pick(uid);
        others.append(b);
      }
      stage.append(others);
      if (alts.length > 6) stage.append(el("p", "note", "En nog " + (alts.length - 6) + " andere zinnen met evenveel stemmen: gebruik Andere winnaar om ze langs te lopen."));
    }
  }
}

/* ---------- moderation panel ---------- */
function renderModeration() {
  const r = cur(S), ids = authorsFor(S, r);
  const box = panel(el("h3", null, "Zinnen controleren · ronde " + (r + 1)),
    el("p", "note", "De tekst is vervaagd zodat de klas hem op de beamer niet leest: beweeg de muis erover of tik erop om te lezen. " +
      "Verborgen zinnen doen niet mee met stemmen en kunnen niet winnen. Tip: open de regie ook op je telefoon."));
  box.classList.add("mod-box");
  if (!ids.length) { box.append(el("p", "empty", "Nog geen zinnen ingestuurd.")); return box; }
  // Waiting for review first, then hidden by you, then the rest.
  const rank = u => { const m = modState(S, u, r); return m.by === "auto" ? 0 : m.by === "docent" ? 1 : 2; };
  const list = el("div", "mod-list");
  for (const uid of [...ids].sort((a, b) => rank(a) - rank(b))) {
    const m = modState(S, uid, r);
    const row = el("div", "mod-row" + (m.hidden ? " is-hidden" : ""));
    const status = m.by === "auto" ? "Wacht op controle · " + m.reasons.join(", ")
      : m.by === "docent" ? "Verborgen door jou"
      : m.approved ? "Toegestaan door jou" : "Zichtbaar";
    const txt = el("span", "mod-text", textOf(S, uid, r)); txt.tabIndex = 0;
    const meta = el("span", "mod-meta", nameOf(S, uid) + " · " + status);
    const acts = el("div", "row");
    if (m.hidden) acts.append(btn("Toestaan", "", () => host.setHidden(uid, false), busy));
    if (!m.hidden || m.by === "auto") acts.append(btn("Verbergen", m.by === "auto" ? "primary" : "", () => host.setHidden(uid, true), busy));
    row.append(meta, txt, acts);
    list.append(row);
  }
  box.append(list);
  return box;
}

/* ---------- round editor (lobby) ---------- */
let draftRounds = null, draftTitle = "";
function renderSetup() {
  const g = S.game;
  if (!draftRounds) { draftRounds = rounds(S).map(x => ({ label: x.label, prompt: x.prompt })); draftTitle = g.title || "Ons verhaal"; }
  const redraw = () => $("setup").replaceChildren(renderSetup());

  const ti = el("input"); ti.type = "text"; ti.id = "setup-title"; ti.maxLength = 80; ti.value = draftTitle;
  ti.oninput = () => { draftTitle = ti.value; };
  const lt = el("label", null, "Titel van het verhaal"); lt.htmlFor = "setup-title";

  // Start from a ready-made set.
  const ps = el("select"); ps.id = "setup-preset";
  ps.append(new Option("Kies een kant-en-klare set…", ""));
  PRESETS.forEach((p, i) => ps.append(new Option(p.name + " · " + p.rounds.length + " rondes", String(i))));
  ps.onchange = () => {
    const p = PRESETS[Number(ps.value)]; if (!p) return;
    draftRounds = p.rounds.map(x => ({ ...x })); draftTitle = p.title; redraw();
  };
  const lp = el("label", null, "Kant-en-klare set"); lp.htmlFor = "setup-preset";

  const list = el("ol", "round-list");
  draftRounds.forEach((rd, i) => {
    const li = el("li", "round-row");
    const num = el("span", "round-num", String(i + 1));
    const lab = el("input"); lab.type = "text"; lab.maxLength = LABEL_MAX; lab.value = rd.label; lab.placeholder = "Label";
    lab.setAttribute("aria-label", "Label ronde " + (i + 1)); lab.oninput = () => { rd.label = lab.value; };
    const q = el("textarea"); q.rows = 2; q.maxLength = PROMPT_MAX; q.value = rd.prompt; q.placeholder = "Vraag aan de studenten";
    q.setAttribute("aria-label", "Vraag ronde " + (i + 1)); q.oninput = () => { rd.prompt = q.value; };
    const move = (d) => { const j = i + d; [draftRounds[i], draftRounds[j]] = [draftRounds[j], draftRounds[i]]; redraw(); };
    const tools = el("div", "round-tools");
    const up = btn("↑", "icon", () => move(-1), i === 0); up.setAttribute("aria-label", "Ronde " + (i + 1) + " omhoog");
    const down = btn("↓", "icon", () => move(1), i === draftRounds.length - 1); down.setAttribute("aria-label", "Ronde " + (i + 1) + " omlaag");
    const del = btn("✕", "icon", () => { draftRounds.splice(i, 1); redraw(); }, draftRounds.length <= 1); del.setAttribute("aria-label", "Ronde " + (i + 1) + " verwijderen");
    tools.append(up, down, del);
    li.append(num, lab, q, tools);
    list.append(li);
  });
  const add = btn("+ Ronde toevoegen", "", () => { draftRounds.push({ label: "", prompt: "" }); redraw(); }, draftRounds.length >= MAX_ROUNDS);
  const count = el("span", "note", draftRounds.length + " van max. " + MAX_ROUNDS + " rondes");

  const err = el("p", "note");
  const save = btn("Opslaan", "primary", async () => {
    if (busy) return;
    const rs = draftRounds
      .map(x => ({ label: x.label.trim().slice(0, LABEL_MAX), prompt: x.prompt.trim().slice(0, PROMPT_MAX) }))
      .filter(x => x.prompt)
      .map((x, i) => ({ label: x.label || "Ronde " + (i + 1), prompt: x.prompt }))
      .slice(0, MAX_ROUNDS);
    if (!rs.length) { err.textContent = "Vul minstens één vraag in."; return; }
    setupOpen = false; draftRounds = null;
    await writeState({ title: draftTitle.trim().slice(0, 80) || "Ons verhaal", rounds: rs });
  }, busy);
  const cancel = btn("Annuleren", "", () => { setupOpen = false; draftRounds = null; render(); });
  const row = el("div", "row"); row.append(add, count);
  const actions = el("div", "row"); actions.append(save, cancel, err);
  const box = panel(el("h3", null, "Rondes instellen"), lt, ti, lp, ps, el("label", null, "Rondes (lege vragen worden overgeslagen)"), list, row, actions);
  box.classList.add("setup-box");
  return box;
}

addEventListener("keydown", e => {
  if (e.target.closest("input, textarea")) return;
  if (e.key === "h" || e.key === "H") $("regie").classList.toggle("tucked");
  // Music sync: [ = lights earlier, ] = lights later (20 ms per press).
  if ((e.key === "[" || e.key === "]") && musicMode()) {
    const d = nudgeSync(e.key === "]" ? 20 : -20);
    banner(stage, "Muzieksync: lichtjes " + Math.round(d) + " ms na de analyse", 1500);
  }
});
