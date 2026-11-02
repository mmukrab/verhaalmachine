// Student view: join with a code, pick a name, write a sentence per round, vote.
import {
  configured, auth, fs, signInAnonymously, onAuthStateChanged, doc, setDoc,
  $, el, btn, banner, codeFromUrl, cssColor, watchGame,
  rounds, cur, phase, textOf, authorsFor, tally, nameOf, shuffleStable,
  renderArc, renderManuscript, MAX, NAME_MAX
} from "./common.js";

const stage = $("stage");
const code = codeFromUrl();
let me = null, S = null, draft = { r: -1, text: "" };

if (!configured) {
  stage.replaceChildren(el("h2", null, "Nog niet ingesteld"), el("p", "muted", "De docent moet eerst js/firebase-config.js invullen. Zie README.md."));
} else if (!code) {
  renderCodeForm();
} else {
  onAuthStateChanged(auth, u => {
    if (!u) { signInAnonymously(auth).catch(e => fail(e)); return; }
    if (me) return;
    me = u.uid;
    watchGame(code, s => { S = s; render(); }, fail);
  });
}

function fail(e) {
  console.error(e);
  stage.replaceChildren(el("h2", null, "Verbinden lukt niet"),
    el("p", "muted", "Controleer je internetverbinding en scan de QR-code opnieuw. (" + (e.code || e.message || "fout") + ")"));
}

function renderCodeForm() {
  $("title").textContent = "Doe mee";
  const f = el("form");
  const l = el("label", null, "Spelcode van het scherm"); l.htmlFor = "code";
  const i = el("input"); i.type = "text"; i.id = "code"; i.autocomplete = "off"; i.placeholder = "Bijv. K7QX"; i.maxLength = 8;
  i.style.textTransform = "uppercase"; i.style.letterSpacing = "0.15em"; i.style.fontSize = "1.4rem";
  const b = el("button", "primary", "Meedoen"); b.type = "submit";
  f.append(l, i, b);
  f.onsubmit = e => { e.preventDefault(); const c = i.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); if (c) location.search = "?g=" + c; };
  stage.replaceChildren(f);
  i.focus();
}

/* ---------- writes ---------- */
async function saveName(name) {
  name = name.trim().slice(0, NAME_MAX); if (!name) return;
  try { localStorage.setItem("vm-name", name); } catch {}
  try { await setDoc(doc(fs, "games", code, "players", me), { name, at: Date.now() }); }
  catch (e) { banner(stage, "Naam opslaan lukte niet. Probeer het opnieuw.", 4000); console.error(e); }
}
async function submitEntry(text) {
  const r = cur(S); text = text.trim().slice(0, MAX); if (!text) return;
  const texts = { ...((S.entries[me] && S.entries[me].texts) || {}), [r]: text };
  try { await setDoc(doc(fs, "games", code, "entries", me), { texts, at: Date.now() }); }
  catch (e) { banner(stage, "Insturen lukte niet. Misschien is de schrijfronde al gesloten.", 4000); console.error(e); }
}
async function castVote(uid) {
  const r = cur(S);
  const picks = { ...((S.votes[me] && S.votes[me].picks) || {}), [r]: uid };
  try { await setDoc(doc(fs, "games", code, "votes", me), { picks }); }
  catch (e) { banner(stage, "Stemmen lukte niet. Misschien is de stemronde al gesloten.", 4000); console.error(e); }
}

/* ---------- render ---------- */
function render() {
  const g = S.game;
  $("title").textContent = (g && g.title) || "De Verhaalmachine";
  renderArc($("arc"), S);
  renderManuscript($("manuscript"), S, phase(S) === "finale" ? ((g && g.title) || "Ons verhaal") : "Het verhaal tot nu toe");

  const meBox = $("me"); meBox.replaceChildren();
  if (S.players[me]) {
    const chip = el("span", "me"); const gem = el("span", "gem"); gem.style.background = cssColor(me);
    chip.append(gem, el("span", null, S.players[me].name + " · jouw kleur op het scherm"));
    meBox.append(chip);
  }

  // Only rebuild the stage when what this student sees changes, so typing
  // (and the phone keyboard) is never interrupted by other players' activity.
  const key = stageKey();
  if (key === lastKey) return;
  lastKey = key;
  const ta = $("entry"); if (ta) draft = { r: draft.r, text: ta.value };

  stage.replaceChildren();
  if (!S.loaded) { stage.append(el("p", "muted", "Laden…")); return; }
  if (!g) { stage.append(el("h2", null, "Spel " + code + " niet gevonden"), el("p", "muted", "Controleer de code op het scherm.")); renderCodeFormBelow(); return; }
  if (!S.players[me]) { renderNameForm(); return; }

  const p = phase(S), r = cur(S), rd = rounds(S)[r];
  if (p === "lobby") {
    stage.append(el("span", "eyebrow", "Je bent binnen"), el("div", "prompt", "Kijk naar het grote scherm. Zo meteen begint ronde 1."),
      el("p", "muted", Object.keys(S.players).length + " spelers in dit spel."));
    return;
  }
  if (p === "finale") {
    stage.append(el("span", "eyebrow", "Finale"), el("div", "prompt", "Dit is ons verhaal."), el("p", "muted", "Bedankt voor het meeschrijven!"));
    return;
  }

  stage.append(el("span", "eyebrow", "Ronde " + (r + 1) + " van " + rounds(S).length + " · " + rd.label), el("div", "prompt", rd.prompt));

  if (p === "write") {
    const mine = textOf(S, me, r);
    const t = el("textarea"); t.id = "entry"; t.maxLength = MAX; t.placeholder = "Schrijf jouw zin…";
    t.value = draft.r === r ? draft.text : (mine || "");
    draft.r = r;
    const row = el("div", "row");
    const cnt = el("span", "count", t.value.length + " / " + MAX);
    t.oninput = () => { cnt.textContent = t.value.length + " / " + MAX; };
    if (mine) row.append(el("span", "pill good", "Ingestuurd"));
    row.append(btn(mine ? "Aanpassen" : "Insturen", "primary", () => submitEntry(t.value)), cnt);
    stage.append(t, row);
    return;
  }

  const authors = authorsFor(S, r);
  if (p === "vote") {
    const myPick = S.votes[me] && S.votes[me].picks && S.votes[me].picks[r];
    stage.append(el("p", "muted", myPick ? "Je hebt gestemd. Je mag nog wisselen tot de docent de uitslag toont." : "Tik op de zin die jij het beste vindt."));
    const list = el("div", "cards");
    for (const uid of shuffleStable(authors, r)) {
      if (uid === me) continue;
      const c = el("button", "card" + (uid === myPick ? " picked" : "")); c.type = "button";
      c.append(el("span", null, textOf(S, uid, r)));
      if (uid === myPick) c.append(el("span", "meta", "Jouw stem"));
      c.onclick = () => castVote(uid);
      list.append(c);
    }
    if (!list.children.length) list.append(el("p", "empty", "Er zijn nog geen zinnen van anderen."));
    stage.append(list);
    return;
  }

  if (p === "reveal") {
    const w = S.game.winners && S.game.winners[r];
    const t = tally(S, r);
    if (w) {
      const c = el("div", "card win");
      c.append(el("span", null, textOf(S, w, r)), el("span", "meta", (w === me ? "Jouw zin is gekozen! · " : "Geschreven door " + nameOf(S, w) + " · ") + (t[w] || 0) + " stemmen"));
      stage.append(c);
    }
    if (textOf(S, me, r) && w !== me) stage.append(el("p", "muted", "Jouw zin kreeg " + (t[me] || 0) + (t[me] === 1 ? " stem." : " stemmen.")));
  }
}

let lastKey = "";
function stageKey() {
  if (!S.loaded) return "loading";
  if (!S.game) return "missing";
  if (!S.players[me]) return "name";
  const p = phase(S), r = cur(S), g = S.game;
  const base = [p, r, g.rounds && JSON.stringify(g.rounds[r])];
  if (p === "lobby") return [...base, Object.keys(S.players).length].join("|");
  if (p === "write") return [...base, textOf(S, me, r) || ""].join("|");
  if (p === "vote") {
    const pick = S.votes[me] && S.votes[me].picks && S.votes[me].picks[r];
    return [...base, pick || "", authorsFor(S, r).map(u => u + ":" + textOf(S, u, r)).join("¦")].join("|");
  }
  if (p === "reveal") { const w = g.winners && g.winners[r]; return [...base, w, JSON.stringify(tally(S, r)), S.players[w] && S.players[w].name].join("|"); }
  return p;
}

function renderNameForm() {
  const f = el("form");
  const l = el("label", null, "Hoe wil je heten in dit spel?"); l.htmlFor = "name";
  const i = el("input"); i.type = "text"; i.id = "name"; i.maxLength = NAME_MAX; i.autocomplete = "nickname"; i.placeholder = "Naam of bijnaam";
  try { i.value = localStorage.getItem("vm-name") || ""; } catch {}
  const b = el("button", "primary", "Meedoen"); b.type = "submit";
  f.append(l, i, b, el("p", "note", "Je naam is zichtbaar op het grote scherm als jouw zin wordt gekozen."));
  f.onsubmit = e => { e.preventDefault(); saveName(i.value); };
  stage.append(el("span", "eyebrow", "Spel " + code), f);
}
function renderCodeFormBelow() {
  stage.append(btn("Andere code invullen", "", () => { location.search = ""; }));
}
