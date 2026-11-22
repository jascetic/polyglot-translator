/* Shared by every format: deciding what to translate, and fitting it where the original was. */
(() => {
"use strict";
const IP = window.InPlace = {};

IP.RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
IP.RTL_LANG = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi", "dv", "ckb"]);
IP.median = a => a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0;
IP.canvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
};
IP.blob = (cv, type = "image/png", q) => new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error("canvas-export")), type, q));
IP.png = async cv => new Uint8Array(await (await IP.blob(cv)).arrayBuffer());

// Numbers, addresses on the web and codes such as INV-2041 must come through untouched.
IP.worth = s => {
  const t = s.trim();
  if (!/\p{L}/u.test(t)) return false;
  if (/^(https?:\/\/|www\.)\S+$/i.test(t) || /^\S+@\S+\.\S+$/.test(t)) return false;
  if (/^(?=\S*\d)[A-Z\d][A-Z\d\-\/.#:]*$/.test(t)) return false;
  // Amounts such as 22g or 500ml.
  if (/^\d[\d.,]*\s?[a-z]{1,3}$/i.test(t)) return false;
  return [...t.matchAll(/\p{L}/gu)].length > 1 || /[぀-鿿가-힯]/.test(t);
};

// spans: [{text, style}]. Returns the same shape, translated, with bold/italic phrases found again.
IP.translateSpans = async (spans, tr) => {
  const whole = spans.map(s => s.text).join("");
  const marker = whole.match(/^\s*(?:[•●▪■◦○‣➢✓–*\-]\s+|\(?(?:\d{1,2}|[a-z])[.)]\s+)/)?.[0] || whole.match(/^\s*/)[0];
  const tail = whole.match(/\s*$/)[0];
  const body = whole.slice(marker.length, whole.length - tail.length);
  if (!IP.worth(body)) return spans;

  // Translators treat ALL-CAPS phrases as names, so send those in sentence case.
  const one = async s => {
    if (/\p{Ll}/u.test(s)){
      // Translation memories sometimes answer an ordinary phrase in capitals.
      const t = await tr(s);
      return !/\p{Ll}/u.test(t) && /\p{Lu}{3}.*\s.*\p{Lu}{3}/u.test(t) ? t.trim()[0] + t.trim().slice(1).toLowerCase() : t;
    }
    if (!/\p{Lu}{4}|\p{Lu}.*\s.*\p{Lu}/u.test(s)) return tr(s);
    return (await tr(s[0] + s.slice(1).toLowerCase())).toUpperCase();
  };

  // A bold label before a colon is its own phrase.
  let at = 0;
  for (let i = 0; i < spans.length - 1; i++){
    at += spans[i].text.length;
    if (spans[i].style !== spans[i + 1].style && /[:：]\s*$/.test(whole.slice(0, at)))
      return [...await IP.translateSpans(spans.slice(0, i + 1), tr), ...await IP.translateSpans(spans.slice(i + 1), tr)];
  }

  let out = (await one(body)).trim();
  // An email, link or reference number that comes back altered is worse than a clumsy sentence.
  const fixed = body.match(/https?:\/\/[^\s<>"]*[\w\/]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b(?=[A-Z\d-]*\d)(?=[A-Z\d-]*[A-Z])[A-Z\d]+(?:-[A-Z\d]+)*\b/g) || [];
  if (fixed.some(f => !out.includes(f))){
    out = ""; let rest = body;
    for (const f of fixed){
      const i = rest.indexOf(f), before = rest.slice(0, i);
      out += (IP.worth(before) ? (await one(before.trim())).trim() + " " : before) + f + " ";
      rest = rest.slice(i + f.length).trimStart();
    }
    out = (out + (IP.worth(rest) ? (await one(rest)).trim() : rest)).replace(/ +([.,;:!?])/g, "$1").trim();
  }
  const weight = new Map();
  for (const s of spans) weight.set(s.style, (weight.get(s.style) || 0) + s.text.trim().length);
  const main = [...weight].sort((a, b) => b[1] - a[1])[0][0];
  const found = [];
  for (const s of spans){
    const phrase = s.text.trim();
    if (s.style === main || !phrase || phrase.split(/\s+/).length > 8) continue;
    const t = IP.worth(phrase) ? (await one(phrase)).trim().replace(/[.。]$/, "") : phrase;
    let i = out.toLowerCase().indexOf(t.toLowerCase()), len = t.length;
    if (i < 0){ i = out.indexOf(phrase); len = phrase.length; }
    if (i >= 0 && len && !found.some(f => i < f.b && i + len > f.a)) found.push({a: i, b: i + len, style: s.style});
  }
  found.sort((a, b) => a.a - b.a);
  const res = []; let p = 0;
  if (marker) res.push({text: marker, style: spans[0].style});
  for (const f of found){
    if (f.a > p) res.push({text: out.slice(p, f.a), style: main});
    res.push({text: out.slice(f.a, f.b), style: f.style}); p = f.b;
  }
  if (p < out.length || tail) res.push({text: out.slice(p) + tail, style: main});
  return res;
};

IP.STACK = {
  sans: 'Arial,"Helvetica Neue","Noto Sans",sans-serif',
  serif: '"Times New Roman",Times,"Noto Serif",serif',
  mono: '"Courier New",Courier,monospace',
  narrow: '"Arial Narrow","Roboto Condensed",Arial,sans-serif',
  heavy: '"Arial Black","Helvetica Neue",Arial,sans-serif',
};
IP.css = (f, size) => `${f.italic ? "italic " : ""}${f.bold ? "700" : "400"} ${size}px ${IP.STACK[f.family]}`;

const mctx = IP.canvas(4, 4).getContext("2d");
IP.measure = (s, f) => { mctx.font = IP.css(f, 100); return mctx.measureText(s).width / 100; };

function tokens(spans){
  const out = [];
  for (const s of spans){
    for (const part of s.text.split(/(\s+)/)){
      if (!part) continue;
      // These scripts wrap without spaces.
      if (/[฀-໿က-႟ក-៿぀-鿿]/.test(part) && Intl.Segmenter){
        for (const g of new Intl.Segmenter(undefined, {granularity: "word"}).segment(part)){
          if (out.length && /^[、。，．！？：；）」』】]+$/.test(g.segment)) out[out.length - 1].text += g.segment;
          else out.push({text: g.segment, style: s.style});
        }
      } else out.push({text: /^\s+$/.test(part) ? " " : part, style: s.style, space: /^\s+$/.test(part)});
    }
  }
  return out;
}

function wrap(toks, size, slots){
  const lines = []; let cur = [], w = 0;
  const push = () => {
    while (cur.length && cur[cur.length - 1].space) w -= cur.pop().em * size;
    lines.push({toks: cur, w}); cur = []; w = 0;
  };
  for (const t of toks){
    if (!cur.length && t.space) continue;
    const limit = slots[Math.min(lines.length, slots.length - 1)].max;
    if (cur.length && !t.space && w + t.em * size > limit * 1.004){
      // Punctuation and style changes inside a word must not start a line.
      let from = cur.length;
      if (!/[฀-໿぀-鿿]/.test(t.text)) while (from && !cur[from - 1].space) from--;
      const carry = from ? cur.splice(from) : [];
      for (const c of carry) w -= c.em * size;
      push();
      for (const c of carry){ cur.push(c); w += c.em * size; }
    }
    cur.push(t); w += t.em * size;
  }
  if (cur.length) push();
  return lines;
}

/*
  block: {size, align, styles:[font], lines:[{u,v,w}], room:{left,right}, lead, extra}
  u runs along the text, v runs down the page; both start at the block's first baseline.
*/
IP.fit = (block, spans, measure, limit = 1) => {
  const toks = tokens(spans);
  for (const t of toks) t.em = measure(t.text, block.styles[t.style] || block.styles[0]);
  const {room} = block, L = block.lines;
  let {align} = block;
  // Paragraphs start on the side the new language is written from.
  const nowRtl = IP.RTL.test(spans.map(s => s.text).join(""));
  const flip = block.spans && !block.marked && nowRtl !== IP.RTL.test(block.spans.map(s => s.text).join(""));
  if (flip && nowRtl && (align === "left" || align === "justify")) align = "flip-right";
  else if (flip && !nowRtl && align === "right") align = "flip-left";
  const left = Math.min(...L.map(l => l.u)), right = Math.max(...L.map(l => l.u + l.w)), mid = (left + right) / 2;
  let a = left, b = right;
  if (align === "center"){ const r = Math.min(room.left, room.right); a -= r; b += r; }
  else if (align === "right" || align === "flip-left") a -= room.left;
  else b += room.right;
  let anchor = right;
  // The new starting edge is the document's margin, not the far side of the empty space.
  if (align === "flip-right"){ anchor = b = Math.min(b, Math.max(right, block.margin?.right ?? right)); }
  if (align === "flip-left"){ a = Math.max(a, Math.min(left, block.margin?.left ?? left)); }
  if (align === "flip-right") align = "right";
  if (align === "flip-left") align = "left";

  const slots = L.map((l, i) => {
    const indent = (align === "left" || align === "justify") && (i === 0 || L.length < 3) ? l.u - left : 0;
    return {v: l.v, a: a + indent, max: b - a - indent};
  });
  for (let i = 1; i <= (block.extra || 0); i++) slots.push({v: L[L.length - 1].v + i * block.lead, a, max: b - a});

  const place = (lines, size, sx, vs) => lines.map((ln, i) => {
    const s = vs[i], w = ln.w * sx;
    let u = align === "center" ? mid - w / 2 : align === "right" ? anchor - w : s.a, gap = 0;
    if (align === "justify" && i < lines.length - 1){
      const n = ln.toks.filter(t => t.space).length, extra = (s.max - w) / n;
      if (n && extra > 0 && extra < size * .8) gap = extra;
    }
    return {u, v: s.v, w, gap, toks: ln.toks};
  });

  for (let scale = limit; scale >= .16; scale -= .02){
    const size = block.size * scale;
    for (const sx of scale > .7 ? [1, .96, .92] : [.92]){
      const vs = slots.map(s => ({...s, max: s.max / sx}));
      const lines = wrap(toks, size, vs);
      if (lines.length <= slots.length && lines.every((l, i) => l.w <= vs[i].max * 1.006))
        return {size, sx, scale, lines: place(lines, size, sx, slots)};
    }
    // A short label may become two smaller lines inside the same height.
    if (L.length === 1 && !block.extra && scale < .68 && scale > .3){
      const two = [-.5, .5].map(d => ({...slots[0], v: slots[0].v + d * size * 1.05 - (block.size - size) * .3}));
      const lines = wrap(toks, size, two);
      if (lines.length === 2 && lines.every(l => l.w <= two[0].max)) return {size, sx: 1, scale, lines: place(lines, size, 1, two)};
    }
  }
  const w = toks.reduce((n, t) => n + t.em, 0) || 1, size = Math.min(block.size * .16, slots[0].max / w);
  return {size, sx: 1, scale: .16, lines: place([{toks, w: w * size}], size, 1, slots)};
};

// Draws a fitted block into a canvas whose x/y already equal the block's u/v.
IP.paint = (g, block, fit) => {
  const rtl = IP.RTL.test(fit.lines.map(l => l.toks.map(t => t.text).join("")).join(""));
  g.direction = rtl ? "rtl" : "ltr"; g.textAlign = rtl ? "right" : "left"; g.textBaseline = "alphabetic";
  for (const ln of fit.lines){
    g.save(); g.translate(ln.u, ln.v); g.scale(fit.sx, 1);
    // Neighbouring tokens of one style are drawn together so joined scripts shape correctly.
    const runs = [];
    for (const t of ln.toks){
      const last = runs[runs.length - 1];
      if (last && last.style === t.style && !ln.gap){ last.text += t.text; last.em += t.em; }
      else runs.push({...t});
    }
    let x = rtl ? ln.w / fit.sx : 0;
    for (const r of runs){
      const f = block.styles[r.style] || block.styles[0];
      g.font = IP.css(f, fit.size); g.fillStyle = `rgb(${f.color.join(",")})`; g.globalAlpha = f.alpha ?? 1;
      g.fillText(r.text, x, 0);
      x += (rtl ? -1 : 1) * (r.em * fit.size + (r.space ? ln.gap / fit.sx : 0));
    }
    g.restore();
  }
};
})();
