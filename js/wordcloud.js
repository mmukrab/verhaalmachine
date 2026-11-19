// Word cloud of what the class wrote: count the meaningful words, then place them on a
// canvas along a spiral from the centre (biggest first) so nothing overlaps.

const STOP = new Set((
  "de het een en van in is op te dat die voor met zijn er aan als ook om door naar bij maar of uit " +
  "je ze hij zij wij we hun haar zich dit deze dan wat wie hoe waar wanneer waarom wordt worden werd " +
  "kan kunnen kon heeft hebben had hadden was waren is ben bent zal zullen zou zouden moet moeten " +
  "mag mogen wil willen gaat gaan ging doet doen deed maakt maken krijgt krijgen komt komen " +
  "nog niet geen wel al meer veel zo tot over onder na zonder tegen tussen elke elk alle alles iets " +
  "niets iemand niemand ons onze mijn jouw jij ik u hen men daar hier dus toen nu straks heel erg " +
  "zelf eigen andere ander één twee drie eens even echt gewoon steeds altijd nooit toch want omdat " +
  "terwijl zodat waardoor waarmee waarin welke welk wiens zoals per via vanaf sinds binnen buiten " +
  "boven achter voor naast langs rond zich zichzelf elkaar ieder iedereen beetje vaak soms the and " +
  "laat laten liet zien ziet zag staat staan stond geeft geven gaf neemt nemen houdt houden zegt zeggen " +
  "brengt brengen helpt helpen vindt vinden zit zitten ligt liggen loopt lopen kijkt kijken " +
  "of to a in is for with on that this it are be by an as at from"
).split(/\s+/));

/** [{text, count}] sorted by count, most frequent first. */
export function countWords(sentences, max = 70) {
  const counts = new Map();
  for (const s of sentences) {
    for (const raw of String(s || "").match(/[\p{L}][\p{L}'’-]*/gu) || []) {
      const w = raw.toLowerCase().replace(/['’-]+$/, "");
      if (w.length < 3 || STOP.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts].map(([w, c]) => ({ text: w, count: c }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "nl"))
    .slice(0, max);
}

/** Draw the cloud on a canvas (its width/height set by the caller). Returns how many words fitted. */
export function drawCloud(canvas, words, { colors, font = "Oswald, 'Bricolage Grotesque', sans-serif", bg = "#0b0d22", title = "" } = {}) {
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext("2d");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (title) {
    ctx.fillStyle = "rgba(241,242,251,0.85)"; ctx.font = `600 ${Math.round(H * 0.045)}px ${font}`;
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(title, W * 0.03, H * 0.035);
  }
  if (!words.length) {
    ctx.fillStyle = "rgba(170,176,214,0.9)"; ctx.font = `400 ${Math.round(H * 0.04)}px ${font}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("Nog geen woorden", W / 2, H / 2);
    return 0;
  }
  const maxC = words[0].count, minC = words[words.length - 1].count;
  const big = H * 0.16, small = H * 0.035;
  // All words equally frequent (e.g. few words): show them large, a bit smaller as the list grows.
  const size = c => maxC === minC ? Math.max(small * 1.5, big * Math.min(0.7, 3 / Math.sqrt(words.length))) : small + (big - small) * Math.sqrt((c - minC) / (maxC - minC));
  const placed = [], pad = H * 0.008, cx = W / 2, cy = H * 0.54;
  const hit = (r) => r.x < W * 0.02 || r.y < (title ? H * 0.11 : H * 0.03) || r.x + r.w > W * 0.98 || r.y + r.h > H * 0.97 ||
    placed.some(p => r.x < p.x + p.w + pad && r.x + r.w + pad > p.x && r.y < p.y + p.h + pad && r.y + r.h + pad > p.y);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  let fitted = 0;
  words.forEach((wd, i) => {
    const fs = Math.round(size(wd.count));
    ctx.font = `${i < 5 ? 700 : 500} ${fs}px ${font}`;
    const m = ctx.measureText(wd.text), w = m.width, h = fs * 0.92;
    // Archimedean spiral, slightly wider than tall to fill a 16:9 screen.
    for (let a = 0; a < 260; a += 0.12) {
      const r = 3 + a * (H * 0.0105);
      const x = cx + Math.cos(a + i) * r * 1.6 - w / 2, y = cy + Math.sin(a + i) * r - h / 2;
      const rect = { x, y, w, h };
      if (!hit(rect)) {
        placed.push(rect);
        ctx.fillStyle = colors[i % colors.length];
        ctx.globalAlpha = i < 12 ? 1 : 0.85;
        ctx.fillText(wd.text, x, y + h * 0.82);
        ctx.globalAlpha = 1;
        fitted++;
        return;
      }
    }
  });
  return fitted;
}
