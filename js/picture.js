/* Photos, screenshots and scans: lift the ink off, rebuild what was behind it, letter the translation. */
(() => {
"use strict";
const IP = window.InPlace;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function plane(points){
  // Least squares for value = a + b*x + c*y, per colour.
  let n = 0, sx = 0, sy = 0, xx = 0, xy = 0, yy = 0;
  for (const p of points){ n++; sx += p[0]; sy += p[1]; }
  const mx = sx / n, my = sy / n;
  for (const p of points){ const x = p[0] - mx, y = p[1] - my; xx += x*x; xy += x*y; yy += y*y; }
  const det = xx*yy - xy*xy;
  const k = [2, 3, 4].map(c => {
    let m = 0; for (const p of points) m += p[c]; m /= n;
    if (n < 12 || det < 1e-3) return [m, 0, 0];
    let a = 0, b = 0; for (const p of points){ a += (p[0]-mx) * (p[c]-m); b += (p[1]-my) * (p[c]-m); }
    return [m, (a*yy - b*xy) / det, (b*xx - a*xy) / det];
  });
  return (x, y) => k.map(([m, a, b]) => m + a*(x - mx) + b*(y - my));
}

// Evens out lighting and turns light-on-colour lettering into dark-on-white for a second read.
function contrastCopy(cv){
  const w = cv.width, h = cv.height, out = IP.canvas(w, h), g = out.getContext("2d");
  g.drawImage(cv, 0, 0);
  const im = g.getImageData(0, 0, w, h), d = im.data, sum = new Float64Array((w + 1) * (h + 1)), r = Math.max(12, Math.round(Math.max(w, h) / 70));
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++){
    let row = 0;
    for (let x = 0; x < w; x++){
      const i = y*w + x; row += lum[i] = .3*d[i*4] + .59*d[i*4+1] + .11*d[i*4+2];
      sum[(y+1)*(w+1) + x+1] = sum[y*(w+1) + x+1] + row;
    }
  }
  for (let y = 0; y < h; y++){
    const a = Math.max(0, y - r), b = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++){
      const l = Math.max(0, x - r), z = Math.min(w, x + r + 1), i = y*w + x;
      const mean = (sum[b*(w+1)+z] - sum[a*(w+1)+z] - sum[b*(w+1)+l] + sum[a*(w+1)+l]) / ((b-a) * (z-l));
      const v = 255 - clamp((Math.abs(lum[i] - mean) - 8) * 3.2, 0, 255);
      d[i*4] = d[i*4+1] = d[i*4+2] = v; d[i*4+3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  return out;
}

// Keeps thin light strokes and drops solid shapes, so white text on buttons and badges can be found.
function lightStrokes(cv){
  const w = cv.width, h = cv.height, out = IP.canvas(w, h), g = out.getContext("2d");
  const im = cv.getContext("2d").getImageData(0, 0, w, h), d = im.data, r = Math.max(5, Math.round(Math.max(w, h) / 170));
  const lum = new Uint8Array(w * h);
  for (let i = 0; i < lum.length; i++) lum[i] = .3*d[i*4] + .59*d[i*4+1] + .11*d[i*4+2];
  const k = 2*r + 1, n = Math.max(w, h) + 2*r, line = new Uint8Array(n), L = new Uint8Array(n), R = new Uint8Array(n);
  // Running max or min over a square, in time independent of its size.
  const extreme = (src, pick) => {
    let from = src;
    for (const across of [true, false]){
      const to = new Uint8Array(w * h), len = across ? w : h, count = across ? h : w, step = across ? 1 : w, m = len + 2*r;
      for (let q = 0; q < count; q++){
        const o = across ? q*w : q;
        for (let i = 0; i < m; i++) line[i] = from[o + clamp(i - r, 0, len - 1) * step];
        for (let i = 0; i < m; i++) L[i] = i % k ? pick(L[i-1], line[i]) : line[i];
        for (let i = m - 1; i >= 0; i--) R[i] = i === m - 1 || i % k === k - 1 ? line[i] : pick(R[i+1], line[i]);
        for (let i = 0; i < len; i++) to[o + i*step] = pick(R[i], L[i + k - 1]);
      }
      from = to;
    }
    return from;
  };
  const max = (a, b) => a > b ? a : b, min = (a, b) => a < b ? a : b;
  const opened = extreme(extreme(lum, min), max);
  for (let i = 0; i < lum.length; i++){
    const v = 255 - Math.min(255, (lum[i] - opened[i]) * 1.8);
    d[i*4] = d[i*4+1] = d[i*4+2] = v; d[i*4+3] = 255;
  }
  g.putImageData(im, 0, 0);
  return out;
}

// On pale paper, the brightest channel makes red and blue stamps fade while black type stays black.
function withoutStamps(cv){
  const w = cv.width, h = cv.height, im = cv.getContext("2d").getImageData(0, 0, w, h), d = im.data, lums = [];
  let coloured = 0;
  for (let i = 0; i < d.length; i += 4){
    const top = Math.max(d[i], d[i+1], d[i+2]);
    if (top - Math.min(d[i], d[i+1], d[i+2]) > 70) coloured++;
    if (i % 388 === 0) lums.push(.3*d[i] + .59*d[i+1] + .11*d[i+2]);
    d[i] = d[i+1] = d[i+2] = top;
  }
  const share = coloured / (w * h);
  if (share < .001 || share > .25 || IP.median(lums) < 165) return null;
  const out = IP.canvas(w, h);
  out.getContext("2d").putImageData(im, 0, 0);
  return out;
}

function turned(cv, deg){
  if (!deg) return cv;
  const side = deg % 180 !== 0, out = IP.canvas(side ? cv.height : cv.width, side ? cv.width : cv.height), g = out.getContext("2d");
  g.translate(out.width / 2, out.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(cv, -cv.width / 2, -cv.height / 2);
  return out;
}

function linesFrom(data, scale, pass){
  const out = [];
  for (const block of data.blocks || []) for (const para of block.paragraphs) for (const line of para.lines){
    let ws = line.words.filter(w => w.text.trim());
    const sure = ws.filter(w => w.confidence > 70).length >= 2;
    // A smudged real word at either end stays when the rest of the line is clear.
    const weak = w => w.confidence < (!/[\p{L}\p{N}]/u.test(w.text) ? 80 : sure && /^\p{L}{4,}/u.test(w.text) ? 15 : 45);
    while (ws.length && weak(ws[0])) ws.shift();
    while (ws.length && weak(ws[ws.length - 1])) ws.pop();
    if (!ws.length) continue;
    const h = IP.median(ws.map(w => w.bbox.y1 - w.bbox.y0)), parts = [];
    let part = [];
    for (const w of ws){
      const last = part[part.length - 1]?.bbox;
      // Right-to-left words arrive in reading order, so the gap can be on either side.
      if (last && Math.max(w.bbox.x0 - last.x1, last.x0 - w.bbox.x1) > h * 1.25){ parts.push(part); part = []; }
      part.push(w);
    }
    parts.push(part);

    for (const p of parts){
      let text = p.map(w => w.text).join(" ").trim();
      if (/^[‘“][^’”]*$/.test(text)) text = text.slice(1).trim();
      if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) text = text.replace(/(?<=[^\x00-\x7f])\s+|\s+(?=[^\x00-\x7f])/g, "");
      // Marks count too: much Indic writing is vowel signs.
      if (/[\uac00-\ud7af]/.test(text)){
        // The Korean reader puts a space after most syllables; trust the gaps in the picture instead.
        text = p.map((w, i) => (i && w.bbox.x0 - p[i-1].bbox.x1 > h * .17 ? " " : "") + w.text).join("").trim();
      }
      const letters = (text.match(/[\p{L}\p{N}\p{M}]/gu) || []).length;
      const conf = p.reduce((a, w) => a + w.confidence * w.text.length, 0) / p.reduce((a, w) => a + w.text.length, 0);
      if (!letters || letters < text.replace(/\s/g, "").length * .55 || conf < (letters < (/[\u3040-\u9fff\uac00-\ud7af]/.test(text) ? 1 : 4) ? (pass === 1 || pass === 2 ? 97 : 82) : 62)) continue;
      const x0 = Math.min(...p.map(w => w.bbox.x0)), y0 = Math.min(...p.map(w => w.bbox.y0));
      const x1 = Math.max(...p.map(w => w.bbox.x1)), y1 = Math.max(...p.map(w => w.bbox.y1));
      if (y1 - y0 < 7) continue;
      let ang = 0;
      const b = line.baseline;
      if (b?.x1 > b?.x0){
        ang = Math.atan2(b.y1 - b.y0, b.x1 - b.x0);
        if (Math.abs(ang) < .009 || Math.abs(ang) > .5 || x1 - x0 < (y1 - y0) * 1.5) ang = 0;
      }
      const s = Math.abs(Math.sin(ang)), c = Math.cos(ang);
      let w = (x1 - x0) / c, h2 = y1 - y0;
      // A word's own box barely changes with tilt, so it bounds the line's true height.
      const floor = Math.min(y1 - y0, IP.median(p.map(q => q.bbox.y1 - q.bbox.y0)) * .95);
      for (let i = 0; i < 3; i++){ h2 = Math.max(floor, (y1 - y0 - w * s) / c); w = (x1 - x0 - h2 * s) / c; }
      out.push({text, conf, ang, pass, cx: (x0 + x1) / 2 / scale, cy: (y0 + y1) / 2 / scale, w: w / scale, h: h2 / scale,
        x0: x0 / scale, y0: y0 / scale, x1: x1 / scale, y1: y1 / scale});
    }
  }
  return out;
}

function bestOf(lines){
  const kept = [], value = l => (l.conf - 40) * Math.sqrt(l.text.replace(/\s/g, "").length) * (l.pass === 1 || l.pass === 2 ? .93 : 1);
  for (const l of lines.sort((a, b) => value(b) - value(a))){
    const clash = kept.some(k => {
      const w = Math.min(l.x1, k.x1) - Math.max(l.x0, k.x0), h = Math.min(l.y1, k.y1) - Math.max(l.y0, k.y0);
      return w > 0 && h > 0 && w * h > .22 * Math.min((l.x1-l.x0) * (l.y1-l.y0), (k.x1-k.x0) * (k.y1-k.y0));
    });
    if (!clash) kept.push(l);
  }
  return kept;
}

// Separates one line's ink from its background, leaving other colours (stamps, rules, pictures) alone.
function inkOf(img, l){
  const {width: W, height: H, data: D} = img, c = Math.cos(l.ang), s = Math.sin(l.ang);
  const pad = Math.max(2, l.h * .22), hw = l.w / 2, hh = l.h / 2;
  const X = Math.abs(c) * (hw + pad) + Math.abs(s) * (hh + pad), Y = Math.abs(s) * (hw + pad) + Math.abs(c) * (hh + pad);
  const x0 = Math.max(0, Math.floor(l.cx - X)), y0 = Math.max(0, Math.floor(l.cy - Y));
  const w = Math.min(W, Math.ceil(l.cx + X)) - x0, h = Math.min(H, Math.ceil(l.cy + Y)) - y0;
  if (w < 3 || h < 3) return null;

  const zone = new Uint8Array(w * h), ring = [], inner = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const dx = x + x0 + .5 - l.cx, dy = y + y0 + .5 - l.cy, u = dx*c + dy*s, v = dy*c - dx*s;
    if (Math.abs(u) > hw + pad || Math.abs(v) > hh + pad) continue;
    const i = ((y+y0)*W + x+x0) * 4, p = [x, y, D[i], D[i+1], D[i+2], u, v];
    if (Math.abs(u) <= hw + 1.2 && Math.abs(v) <= hh + 1.2){ zone[y*w + x] = 1; inner.push(p); }
    else { zone[y*w + x] = 2; ring.push(p); }
  }
  if (ring.length < 8 || inner.length < 8) return null;
  const err = (p, f) => { const q = f(p[0], p[1]); return Math.hypot(p[2]-q[0], p[3]-q[1], p[4]-q[2]); };
  let keep = ring, bg = plane(ring);
  for (const share of [.8, .75]){
    keep = keep.map(p => [err(p, bg), p]).sort((a, b) => a[0] - b[0]).slice(0, Math.max(8, Math.floor(keep.length * share))).map(e => e[1]);
    bg = plane(keep);
  }
  // Lighting is rarely a straight ramp: follow it along the line in short steps.
  const flatBg = bg, step = Math.max(6, l.h * .6), span = hw + pad, n = Math.ceil(2 * span / step) + 1;
  const buckets = Array.from({length: n}, () => []);
  for (const p of ring){
    if (err(p, flatBg) > 90) continue;
    const q = flatBg(p[0], p[1]);
    buckets[clamp(Math.round((p[5] + span) / step), 0, n - 1)].push([p[2]-q[0], p[3]-q[1], p[4]-q[2]]);
  }
  const shift = buckets.map(b => b.length > 4 ? [0, 1, 2].map(k => IP.median(b.map(v => v[k]))) : [0,0,0]);
  bg = (x, y) => {
    const u = (x + x0 + .5 - l.cx) * c + (y + y0 + .5 - l.cy) * s, at = clamp((u + span) / step, 0, n - 1);
    const i = Math.floor(at), j = Math.min(n - 1, i + 1), t = at - i, q = flatBg(x, y);
    return [0, 1, 2].map(k => q[k] + shift[i][k] * (1 - t) + shift[j][k] * t);
  };
  keep = ring.map(p => [err(p, bg), p]).sort((a, b) => a[0] - b[0]).slice(0, Math.max(8, Math.floor(ring.length * .65))).map(e => e[1]);
  const noise = IP.median(keep.map(p => err(p, bg)));

  const diffs = inner.map(p => { const q = bg(p[0], p[1]); return [p[2]-q[0], p[3]-q[1], p[4]-q[2]]; });
  const strength = diffs.map(d => Math.hypot(...d)), peak = [...strength].sort((a, b) => a - b)[Math.floor(strength.length * .96)];
  if (peak < 28) return null;
  // The commonest strong colour is the lettering; a stamp crossing it is the minority.
  const bins = new Map();
  diffs.forEach((d, i) => {
    if (strength[i] < peak * .55) return;
    const key = d.map(v => Math.round(v / 48)).join();
    if (!bins.has(key)) bins.set(key, {n: 0, sum: [0,0,0]});
    const b = bins.get(key); b.n++; d.forEach((v, k) => b.sum[k] += v);
  });
  const top = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  let dir = top.sum.map(v => v / top.n);
  const near = diffs.filter((d, i) => strength[i] >= peak * .55 && Math.hypot(d[0]-dir[0], d[1]-dir[1], d[2]-dir[2]) < 60);
  if (near.length) dir = [0, 1, 2].map(k => IP.median(near.map(d => d[k])));
  const strong = diffs.filter(d => Math.hypot(d[0]-dir[0], d[1]-dir[1], d[2]-dir[2]) < 75 && Math.hypot(...d) >= Math.hypot(...dir));
  if (strong.length > 3) dir = [0, 1, 2].map(k => IP.median(strong.map(d => d[k])));
  const len = Math.hypot(...dir);

  const classify = d => {
    const t = (d[0]*dir[0] + d[1]*dir[1] + d[2]*dir[2]) / (len*len);
    const off = Math.hypot(d[0]-t*dir[0], d[1]-t*dir[1], d[2]-t*dir[2]);
    const size = Math.hypot(...d);
    if (off > Math.max(30, len * .22, noise * 2.5) && off > size * .3) return 2;
    return t > Math.max(.13, Math.min(.4, noise * 2 / len)) ? 1 : 0;
  };
  const core = new Uint8Array(w * h), solid = new Uint8Array(w * h), foreign = new Uint8Array(w * h);
  inner.forEach((p, i) => {
    const k = classify(diffs[i]), at = p[1]*w + p[0];
    if (k === 1){ core[at] = 1; if ((diffs[i][0]*dir[0] + diffs[i][1]*dir[1] + diffs[i][2]*dir[2]) / (len*len) > .5) solid[at] = 1; }
    if (k === 2) foreign[at] = 1;
  });
  const edge = new Uint8Array(w * h), where = new Array(w * h);
  for (const p of inner) where[p[1]*w + p[0]] = p;
  for (const p of ring){
    const q = bg(p[0], p[1]), d = [p[2]-q[0], p[3]-q[1], p[4]-q[2]], k = classify(d), at = p[1]*w + p[0];
    where[at] = p;
    if (k === 2) foreign[at] = 1;
    else if (k === 1 && Math.abs(p[6]) < hh + l.h * .2 && Math.abs(p[5]) < hw + l.h * .12)
      edge[at] = (d[0]*dir[0] + d[1]*dir[1] + d[2]*dir[2]) / (len*len) > .5 ? 2 : 1;
  }
  // Follow tails of letters that poke out of the box the reader reported.
  const todo = [];
  for (let i = 0; i < core.length; i++) if (core[i]) todo.push(i);
  while (todo.length){
    const i = todo.pop(), x = i % w;
    for (const j of [x ? i-1 : -1, x < w-1 ? i+1 : -1, i-w, i+w]){
      if (j < 0 || j >= core.length || !edge[j] || core[j]) continue;
      core[j] = 1; if (edge[j] === 2) solid[j] = 1;
      zone[j] = 1; todo.push(j);
    }
  }
  // Long thin shapes are underlines and table rules, not letters.
  const seen = new Uint8Array(w * h);
  for (let i = 0; i < core.length; i++){
    if (!core[i] || seen[i]) continue;
    const part = [i]; seen[i] = 1;
    let a = Infinity, z = -Infinity, t = Infinity, b = -Infinity;
    for (let k = 0; k < part.length; k++){
      const at = part[k], x = at % w, p = where[at];
      a = Math.min(a, p[5]); z = Math.max(z, p[5]); t = Math.min(t, p[6]); b = Math.max(b, p[6]);
      for (const j of [x ? at-1 : -1, x < w-1 ? at+1 : -1, at-w, at+w])
        if (j >= 0 && j < core.length && core[j] && !seen[j]){ seen[j] = 1; part.push(j); }
    }
    if (z - a > l.h * 1.1 && b - t < Math.max(4, l.h * .28)) for (const j of part){ core[j] = solid[j] = 0; foreign[j] = 1; }
  }

  let mask = core.slice();
  const grow = Math.max(1, Math.min(3, Math.round(l.h * .045)));
  for (let n = 0; n < grow; n++){
    const next = mask.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = y*w + x;
      if (mask[i] || !zone[i] || foreign[i]) continue;
      if ((x && mask[i-1]) || (x < w-1 && mask[i+1]) || (y && mask[i-w]) || (y < h-1 && mask[i+w])) next[i] = 1;
    }
    mask = next;
  }

  // Exact extent of the lettering, along and across the line.
  let a = Infinity, z = -Infinity, t = Infinity, b = -Infinity;
  for (const p of [...inner, ...ring]) if (solid[p[1]*w + p[0]]){ a = Math.min(a, p[5]); z = Math.max(z, p[5]); t = Math.min(t, p[6]); b = Math.max(b, p[6]); }
  if (z - a < 2 || b - t < 3) return null;

  return {x0, y0, w, h, mask, solid, foreign, bg, noise, box: {a: a - .5, z: z + .5, t: t - .5, b: b + .5},
    grain: keep.map(p => { const q = bg(p[0], p[1]); return [p[2]-q[0], p[3]-q[1], p[4]-q[2]]; }),
    color: bg(w / 2, h / 2).map((v, k) => Math.round(clamp(v + dir[k], 0, 255))), back: bg(w / 2, h / 2)};
}

// Tries common typefaces on the original words and keeps the one whose ink lines up best.
function matchFont(l, ink){
  const {a, z, t, b} = ink.box, bw = z - a, bh = b - t, zoom = Math.min(1, 90 / bh), W = Math.ceil(bw * zoom), H = Math.ceil(bh * zoom);
  const real = new Uint8Array(W * H), c = Math.cos(l.ang), s = Math.sin(l.ang);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const u = a + (x + .5) / zoom, v = t + (y + .5) / zoom;
    const px = Math.floor(l.cx + u*c - v*s - ink.x0), py = Math.floor(l.cy + u*s + v*c - ink.y0);
    if (px >= 0 && py >= 0 && px < ink.w && py < ink.h) real[y*W + x] = ink.solid[py*ink.w + px];
  }
  const cv = IP.canvas(W, H), g = cv.getContext("2d", {willReadFrequently: true});
  let best = null;
  for (const family of ["sans", "serif", "narrow", "heavy", "mono"]) for (const bold of family === "heavy" ? [true] : [false, true]){
    const f = {family, bold, italic: false};
    g.font = IP.css(f, 100);
    const m = g.measureText(l.text), asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
    const tw = m.actualBoundingBoxRight + m.actualBoundingBoxLeft;
    if (asc + desc < 2 || tw < 2) continue;
    const size = bh * 100 / (asc + desc), sx = bw / (tw * size / 100);
    g.clearRect(0, 0, W, H); g.save();
    g.scale(zoom * sx * size / 100, zoom * size / 100); g.fillText(l.text, m.actualBoundingBoxLeft, asc); g.restore();
    const d = g.getImageData(0, 0, W, H).data;
    let both = 0, any = 0;
    for (let i = 0; i < real.length; i++){ const q = d[i*4+3] > 127; if (q && real[i]) both++; if (q || real[i]) any++; }
    const score = both / (any || 1) - Math.abs(Math.log(sx)) * .45 - ({mono: .05, heavy: .045, serif: .01, narrow: .02}[family] || 0)
      // Without the original's typeface a stroke comparison overrates bold.
      - (bold && !/[A-Za-z\u00c0-\u024f]/.test(l.text) ? .07 : 0);
    if (!best || score > best.score) best = {score, font: f, size, sx, base: t + asc * size / 100};
  }
  return best;
}

function group(lines){
  const groups = [];
  for (const l of lines.sort((a, b) => a.by - b.by)){
    let best = null;
    for (const g of groups){
      const p = g[g.length - 1], c = Math.cos(p.ang), s = Math.sin(p.ang), dx = l.bx - p.bx, dy = l.by - p.by;
      const u = dx*c + dy*s, v = dy*c - dx*s, S = p.size;
      if (Math.abs(p.ang - l.ang) > .03 || Math.abs(Math.log(l.size / S)) > (/[\p{Lu}\p{Ll}]/u.test(l.text) ? .2 : .38) || v < S * .75 || v > S * (/[\p{Lu}\p{Ll}]/u.test(l.text) ? 1.65 : 2.2)) continue;
      if (Math.hypot(...p.color.map((x, k) => x - l.color[k])) > 75) continue;
      const sl = Math.abs(u) < S * .6, sc = Math.abs(u + l.len/2 - p.len/2) < S * .6, sr = Math.abs(u + l.len - p.len) < S * .6;
      if (!sl && !sc && !sr) continue;
      if (/^([•●▪■*\-–]|\d{1,2}[.)])\s/.test(l.text) || /[:]$/.test(p.text)) continue;
      const lower = /^\p{Ll}/u.test(l.text) && !/[.!?]$/.test(p.text);
      const first = (/[\u3040-\u9fff]/.test(l.text) ? 1 : l.text.split(" ")[0].length) / l.text.length * l.len;
      const full = p.len > S * 11 && p.len + first + S * .3 >= Math.max(u + l.len, ...g.map(q => q.len));
      if (lower || full){ best = g; break; }
    }
    best ? best.push(l) : groups.push([l]);
  }
  return groups.map(g => {
    const o = g[0], c = Math.cos(o.ang), s = Math.sin(o.ang);
    const lines = g.map(l => { const dx = l.bx - o.bx, dy = l.by - o.by; return {u: dx*c + dy*s, v: dy*c - dx*s, w: l.len}; });
    const main = g.reduce((a, b) => b.text.length > a.text.length ? b : a), size = IP.median(g.map(l => l.size));
    let text = "";
    g.forEach((l, i) => {
      if (i && /\p{Ll}-$/u.test(text) && /^\p{Ll}/u.test(l.text)) text = text.slice(0, -1);
      else if (i && !/[぀-鿿]$/.test(text) && !(/[\uac00-\ud7af]$/.test(text) && /^[\uac00-\ud7af](?:[\s.]|$)/.test(l.text))) text += " ";
      text += l.text;
    });
    let align = "left";
    if (g.length > 1){
      const spread = f => Math.max(...lines.map(f)) - Math.min(...lines.map(f));
      if (spread(l => l.u) > size * .45 && spread(l => l.u + l.w/2) < size * .45) align = "center";
      else if (spread(l => l.u) > size * .45 && spread(l => l.u + l.w) < size * .45) align = "right";
    }
    return {x: o.bx, y: o.by, ang: o.ang, size, lines, align, src: g, out: null, extra: 0, room: {left: 0, right: 0},
      lead: g.length > 1 ? (lines[lines.length-1].v - lines[0].v) / (g.length - 1) : size * 1.2,
      styles: [{...main.font, color: main.color}], spans: [{text, style: 0}]};
  });
}

IP.Picture = class {
  async read(original, o){
    const {turn, script} = await o.look(original);
    this.turn = turn;
    const canvas = this.base = turned(original, turn);
    const W = canvas.width, H = canvas.height, long = Math.max(W, H);
    const img = this.img = canvas.getContext("2d", {willReadFrequently: true}).getImageData(0, 0, W, H);
    let scale = long < 2000 ? Math.min(3, 2000 / long) : 1;
    scale = Math.min(scale, Math.sqrt(9e6 / (W * H)));
    const big = IP.canvas(W * scale, H * scale), g = big.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, big.width, big.height);
    g.imageSmoothingQuality = "high"; g.drawImage(canvas, 0, 0, big.width, big.height);

    const passes = [{image: big, mode: "3"}, {image: contrastCopy(big), mode: "11"}, {image: lightStrokes(big), mode: "11"}];
    const clean = withoutStamps(big);
    if (clean) passes.push({image: clean, mode: "3"});
    // Page analysis loses parts of dense Korean, Japanese and Indic lines; this reads straight down the page.
    if (scale > 1.2) passes.push({image: canvas, mode: "6", scale: 1, nonLatin: true});
    const found = await o.ocr(passes, o.label, script);
    const lines = [];
    for (const l of bestOf(found.flatMap((d, i) => linesFrom(d, d.scale || scale, i)))){
      o.check();
      const ink = inkOf(img, l); if (!ink) continue;
      const m = matchFont(l, ink); if (!m) continue;
      const c = Math.cos(l.ang), s = Math.sin(l.ang);
      lines.push({...l, ink, font: m.font, size: m.size, color: ink.color, len: ink.box.z - ink.box.a,
        bx: l.cx + ink.box.a*c - m.base*s, by: l.cy + ink.box.a*s + m.base*c});
    }
    this.lines = lines;
    this.blocks = group(lines).filter(b => IP.worth(b.spans[0].text));
    for (const b of this.blocks) this.findRoom(b);
    return this;
  }

  findRoom(b){
    const {width: W, height: H, data: D} = this.img, c = Math.cos(b.ang), s = Math.sin(b.ang), S = b.size;
    const left = Math.min(...b.lines.map(l => l.u)), right = Math.max(...b.lines.map(l => l.u + l.w));
    const at = (u, v) => [b.x + u*c - v*s, b.y + u*s + v*c];
    const others = this.lines.filter(l => !b.src.includes(l));
    const reach = side => {
      let far = S * 45;
      b.lines.forEach((l, i) => {
        const back = b.src[i].ink.back, limit = Math.max(48, b.src[i].ink.noise * 4);
        const edge = side > 0 ? right : left, from = side > 0 ? l.u + l.w : l.u, step = Math.max(1, S * .08);
        let d = S * .12;
        for (; d < far + Math.abs(edge - from); d += step){
          const blocked = [-.65, -.45, -.25, -.05].some(k => {
            const [x, y] = at(from + side * d, l.v + k * S);
            if (x < 2 || y < 0 || x >= W - 2 || y >= H) return true;
            if (others.some(o => x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1)) return true;
            const j = (Math.floor(y) * W + Math.floor(x)) * 4;
            return Math.hypot(D[j]-back[0], D[j+1]-back[1], D[j+2]-back[2]) > limit;
          });
          if (blocked) break;
        }
        far = Math.min(far, Math.max(0, d - S * .35 - Math.abs(edge - from)));
      });
      return far;
    };
    b.room = {left: reach(-1), right: reach(1)};
    const rtl = IP.RTL.test(b.spans[0].text), along = l => (l.bx - b.x)*c + (l.by - b.y)*s;
    const ml = Math.min(...this.lines.map(along)), mr = Math.max(...this.lines.map(l => along(l) + l.len));
    const centre = (W / 2 - b.x)*c + (H / 2 - b.y)*s;
    b.margin = {left: Math.min(ml, 2 * centre - mr), right: Math.max(mr, 2 * centre - ml)};
    if (rtl && b.align === "left") b.align = "right";
    if (b.lines.length > 1){
      // A paragraph may widen only as far as the widest line already on the picture.
      const margin = Math.max(...this.lines.map(l => (l.bx - b.x)*c + (l.by - b.y)*s + l.len));
      b.room.right = Math.min(b.room.right, Math.max(0, margin - right));
      if (rtl) b.room.left = Math.min(b.room.left, Math.max(0, left - b.margin.left));
      return;
    }
    if (b.lines[0].w > (b.margin.right - b.margin.left) * .75) b.room.right = Math.min(b.room.right, Math.max(0, b.margin.right - right));
    const {left: l, right: r} = b.room, mid = b.x + b.lines[0].w / 2;
    if ((l > S * .25 && Math.abs(l - r) < S * .5) || (Math.abs(mid - W / 2) < W * .012 && b.lines[0].w < W * .7 && b.x > W * .12)) b.align = "center";
    else if (r < S * .5 && l > S * 4 && b.x > W * .5) b.align = "right";
  }

  draw(){
    const {width: W, height: H, data: D} = this.img, layer = IP.canvas(W, H), g = layer.getContext("2d");
    const patch = g.createImageData(W, H), P = patch.data, done = this.blocks.filter(b => b.out);
    let seed = 7; const rand = () => (seed = seed * 16807 % 2147483647) / 2147483647;

    for (const b of done) for (const {ink} of b.src){
      const {x0, y0, w, h, mask, foreign, bg, noise, grain} = ink;
      const flat = noise < 16, blocked = i => mask[i] || foreign[i];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
        const i = y*w + x; if (!mask[i]) continue;
        let col;
        if (flat){
          const q = bg(x, y), n = noise > 1 ? grain[Math.floor(rand() * grain.length)] : [0,0,0];
          col = q.map((v, k) => v + clamp(n[k], -noise * 1.6, noise * 1.6));
        } else {
          // Busy backgrounds: blend the nearest clean pixel in each direction.
          const sum = [0,0,0]; let total = 0;
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){
            let px = x + dx, py = y + dy, d = 1;
            while (px >= 0 && py >= 0 && px < w && py < h && blocked(py*w + px)){ px += dx; py += dy; d++; }
            if (px < 0 || py < 0 || px >= w || py >= h) continue;
            const j = ((py+y0)*W + px+x0) * 4, wt = 1 / (d*d*(dx*dx + dy*dy));
            for (let k = 0; k < 3; k++) sum[k] += D[j+k] * wt;
            total += wt;
          }
          col = total ? sum.map(v => v / total) : bg(x, y);
        }
        const j = ((y+y0)*W + x+x0) * 4;
        P[j] = col[0]; P[j+1] = col[1]; P[j+2] = col[2]; P[j+3] = 255;
      }
    }
    g.putImageData(patch, 0, 0);
    this.shrunk = 0;
    for (const b of done){
      const fit = IP.fit(b, b.out, IP.measure);
      if (fit.scale < .7) this.shrunk++;
      g.save(); g.translate(b.x, b.y); g.rotate(b.ang); IP.paint(g, b, fit); g.restore();
    }
    const full = IP.canvas(W, H), f = full.getContext("2d");
    f.drawImage(this.base, 0, 0); f.drawImage(layer, 0, 0);
    // Hand it back facing the way it arrived.
    const back = (360 - this.turn) % 360;
    return {layer: turned(layer, back), full: turned(full, back)};
  }
};

IP.ImageFile = class {
  async load(file, o){
    this.name = file.name; this.usedOcr = true; this.notes = [];
    // Keep JPEG and WebP as they are; formats a canvas cannot write become PNG.
    this.type = ["image/jpeg", "image/webp"].includes(file.type) ? file.type : "image/png";
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e){ throw {code: "damaged", cause: e}; }
    const k = Math.min(1, Math.sqrt(16e6 / (bmp.width * bmp.height)));
    const cv = this.original = IP.canvas(bmp.width * k, bmp.height * k);
    cv.getContext("2d", {willReadFrequently: true}).drawImage(bmp, 0, 0, cv.width, cv.height);
    bmp.close();
    if (k < 1) this.notes.push("This very large picture was reduced to 16 megapixels.");
    this.pic = await new IP.Picture().read(cv, {...o, label: file.name});
    this.blocks = this.pic.blocks;
    return this;
  }
  async build(){
    this.result = this.pic.draw().full; this.shrunk = this.pic.shrunk;
    return IP.blob(this.result, this.type, .95);
  }
  async preview(box, blob){
    const from = blob ? this.result : this.original, cv = IP.canvas(from.width, from.height);
    cv.getContext("2d").drawImage(from, 0, 0);
    box.replaceChildren(cv);
  }
  close(){}
};
})();
