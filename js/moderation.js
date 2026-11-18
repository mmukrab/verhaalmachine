// Automatic moderation of student sentences, entirely in the browser (no text leaves Firebase).
// "block": the phone refuses to send it. "flag": it arrives, but stays hidden from voting
// until the teacher allows it. A word filter cannot read context, so the teacher's
// Verbergen/Toestaan buttons remain the safety net.

// Each term: [text, where] — "pre" = a word starting with it, "word" = the whole word, "any" = anywhere.
const BLOCK = [
  ["tyfus", "pre"], ["tiefus", "pre"], ["tering", "pre"], ["kut", "pre"], ["neuk", "pre"], ["hoer", "pre"],
  ["slet", "word"], ["sletten", "word"], ["flikker", "pre"], ["klootzak", "pre"], ["kankerlijer", "any"],
  ["kankerhoer", "any"], ["kankermongool", "any"], ["kkr", "word"], ["fuck", "any"], ["fck", "pre"], ["fuk", "pre"], ["kt", "word"], ["motherf", "any"],
  ["cunt", "pre"], ["bitch", "pre"], ["whore", "pre"], ["nigg", "any"], ["neger", "pre"], ["mongool", "pre"],
  ["piemel", "pre"], ["lul", "word"], ["pik", "word"], ["porn", "pre"], ["godver", "pre"], ["pedo", "pre"],
  ["hoerenjong", "any"], ["sukkelhoer", "any"]
];
const FLAG = [
  ["kanker", "pre"], ["knker", "pre"], ["kenker", "pre"], ["homo", "word"], ["gay", "word"], ["dick", "word"], ["shit", "pre"], ["hitler", "pre"],
  ["nazi", "pre"], ["jood", "word"], ["joden", "word"], ["seks", "pre"], ["sex", "pre"], ["naakt", "pre"],
  ["verkracht", "pre"], ["zelfmoord", "pre"], ["mongol", "word"], ["sukkel", "pre"], ["idioot", "pre"],
  ["debiel", "pre"], ["retard", "pre"], ["autist", "word"], ["lelijkerd", "word"], ["dikzak", "pre"],
  ["vermoord", "pre"]
];

const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i" };
const squash = s => s.replace(/(.)\1+/g, "$1");                 // "kaaanker" → "kanker"
export function normalize(s) {
  s = String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[*#]/g, "");                                   // "f*ck" → "fck", "k#t" → "kt"
  s = s.replace(/[0134578@$!]/g, c => LEET[c]);
  s = s.replace(/[^a-z]+/g, " ");
  // "k a n k e r" or "k.a.n.k.e.r" → "kanker"
  s = s.replace(/\b(?:[a-z] ){2,}[a-z]\b/g, m => m.replace(/ /g, ""));
  return " " + squash(s.trim()) + " ";
}
const prep = list => list.map(([t, w]) => [squash(t), w]);
const BLOCK_N = prep(BLOCK), FLAG_N = prep(FLAG);
function hits(n, list) {
  const out = [];
  for (const [t, w] of list) {
    const ok = w === "any" ? n.includes(t) : w === "pre" ? n.includes(" " + t) : n.includes(" " + t + " ");
    if (ok) out.push(t);
  }
  return out;
}

/** {block, flag, reasons[]} for a sentence; otherNames = names of the other players. */
export function moderate(text, otherNames = []) {
  const n = normalize(text);
  const b = hits(n, BLOCK_N), f = hits(n, FLAG_N), reasons = [];
  if (b.length) reasons.push("grof woord");
  if (f.length) reasons.push("gevoelig woord");
  // Naming a classmate is how bullying slips past a word list: let the teacher look first.
  for (const name of otherNames) {
    const nn = normalize(name).trim();
    if (nn.length >= 3 && n.includes(" " + nn + " ")) { reasons.push("noemt een klasgenoot"); break; }
  }
  return { block: b.length > 0, flag: !b.length && reasons.length > 0, reasons };
}
