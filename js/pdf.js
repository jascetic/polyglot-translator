/* PDF: same file, same artwork, new words. Scanned pages are handed to the image engine. */
(() => {
"use strict";
const IP = window.InPlace;
const MAX_READ = 20;
const CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/";

// isEvalSupported:false closes CVE-2024-4367, which lets a crafted PDF run script in this page.
IP.openPdf = bytes => window.pdfjsLib.getDocument({
  data: bytes.slice(), isEvalSupported: false, fontExtraProperties: true,
  cMapUrl: CDN + "cmaps/", cMapPacked: true, standardFontDataUrl: CDN + "standard_fonts/",
}).promise;

IP.renderPage = async (page, scale, withoutNotes) => {
  let vp = page.getViewport({scale});
  const area = vp.width * vp.height;
  if (area > 12e6) vp = page.getViewport({scale: scale * Math.sqrt(12e6 / area)});
  const cv = IP.canvas(vp.width, vp.height);
  await page.render({canvasContext: cv.getContext("2d", {willReadFrequently: true}), viewport: vp,
    annotationMode: withoutNotes ? window.pdfjsLib.AnnotationMode.DISABLE : window.pdfjsLib.AnnotationMode.ENABLE}).promise;
  return {cv, vp};
};

const mul = (m, n) => [m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1], m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3], m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]];

function fontStyle(f){
  const n = String(f.name || "").replace(/^[A-Z]{6}\+/, ""), fb = f.fallbackName;
  let family = "sans";
  if (f.isMonospace || fb === "monospace" || /courier|mono|consol|menlo/i.test(n)) family = "mono";
  else if (/arial|helvet|calibri|carlito|verdana|tahoma|sans|segoe|roboto|inter|aptos|lato|montserrat|poppins|gothic|futura|avenir|myriad|univers/i.test(n)) family = "sans";
  else if (f.isSerifFont || fb === "serif" || /times|georgia|serif|garamond|cambria|book|palatino|minion|caslon|roman|baskerville/i.test(n)) family = "serif";
  return {family, bold: !!(f.bold || f.black || /bold|black|heavy|semibd|demi/i.test(n)), italic: !!(f.italic || /italic|oblique/i.test(n))};
}

// Replays pdf.js's instruction list to learn where each piece of text is and how it looks.
async function readRuns(page){
  const {OPS, AnnotationMode} = window.pdfjsLib;
  const {fnArray, argsArray} = await page.getOperatorList({annotationMode: AnnotationMode.DISABLE});
  const names = new Set();
  fnArray.forEach((fn, i) => {
    if (fn === OPS.setFont) names.add(argsArray[i][0]);
    if (fn === OPS.setGState) for (const [k, v] of argsArray[i][0]) if (k === "Font") names.add(v[0]);
  });
  const fonts = {};
  await Promise.all([...names].map(n => new Promise(done => {
    const timer = setTimeout(done, 3000);
    try { page.commonObjs.get(n, f => { fonts[n] = f; clearTimeout(timer); done(); }); } catch { clearTimeout(timer); done(); }
  })));

  let s = {m: [1,0,0,1,0,0], tc: 0, tw: 0, th: 1, tl: 0, rise: 0, mode: 0, color: [0,0,0], stroke: [0,0,0], alpha: 1, font: null, size: 0};
  let tm = [1,0,0,1,0,0], x = 0, y = 0, lx = 0, ly = 0;
  const stack = [], ops = [], runs = [], view = page.view;
  const move = (dx, dy) => { x = lx += dx; y = ly += dy; };
  const setFont = (name, size) => { s.font = name; s.size = size; };

  const show = glyphs => {
    const f = fonts[s.font] || {}, size = s.size, wf = f.isType3Font ? f.fontMatrix[0] : .001;
    const m = mul(s.m, tm), kx = Math.hypot(m[0], m[1]), ky = Math.abs(m[0]*m[3] - m[1]*m[2]) / (kx || 1);
    const op = {i: ops.length, adv: null}; ops.push(op);
    const ok = !f.vertical && size && kx && ky && s.mode !== 3 && s.mode !== 7 && s.alpha > .02;
    const dir = size < 0 ? -1 : 1, th = s.th, look = fontStyle(f);
    let adv = 0, run = null, cur = 0;
    for (const g of glyphs || []){
      if (g === null) continue;
      if (typeof g === "number"){
        const d = -g * .001 * size;
        adv += d;
        if (run && d * dir > Math.abs(size) * .16) cur = d * dir;
        continue;
      }
      const u = g.unicode || "", w = (g.width || 0) * wf * size + s.tc + (g.isSpace ? s.tw : 0);
      const blank = !u.trim();
      if (ok && !blank){
        if (run && cur > Math.abs(size) * .95) run = null;
        if (!run){
          const px = x + adv * th, py = y + s.rise;
          run = {
            op, text: "", glyphs: [], x: m[0]*px + m[2]*py + m[4], y: m[1]*px + m[3]*py + m[5], w: 0, from: adv,
            ang: Math.atan2(m[1] * dir * th, m[0] * dir * th), size: Math.abs(size) * ky,
            font: {...look, color: s.mode === 1 ? s.stroke : s.color, alpha: s.alpha},
          };
          runs.push(run);
        } else if (cur){ run.text += " "; run.glyphs.push(" "); }
        run.text += u; run.glyphs.push(u); cur = 0;
        run.w = Math.abs((adv + w - s.tc - run.from) * th) * kx;
      } else if (blank && run){
        run.text += " "; run.glyphs.push(" ");
      }
      adv += w;
    }
    if (size) op.adv = -adv * 1000 / size;
    x += adv * th;
  };

  fnArray.forEach((fn, i) => {
    const a = argsArray[i];
    switch (fn){
      case OPS.save: stack.push({...s}); break;
      case OPS.restore: if (stack.length) s = stack.pop(); break;
      case OPS.transform: s.m = mul(s.m, a); break;
      case OPS.paintFormXObjectBegin: stack.push({...s}); if (a[0]) s.m = mul(s.m, a[0]); break;
      case OPS.paintFormXObjectEnd: if (stack.length) s = stack.pop(); break;
      case OPS.beginText: tm = [1,0,0,1,0,0]; x = y = lx = ly = 0; break;
      case OPS.setCharSpacing: s.tc = a[0]; break;
      case OPS.setWordSpacing: s.tw = a[0]; break;
      case OPS.setHScale: s.th = a[0] / 100; break;
      case OPS.setLeading: s.tl = -a[0]; break;
      case OPS.setTextRise: s.rise = a[0]; break;
      case OPS.setTextRenderingMode: s.mode = a[0] & 7; break;
      case OPS.setFont: setFont(a[0], a[1]); break;
      case OPS.setGState:
        for (const [k, v] of a[0]){ if (k === "Font") setFont(v[0], v[1]); if (k === "ca") s.alpha = v; }
        break;
      case OPS.setFillRGBColor: s.color = [a[0], a[1], a[2]].map(Math.round); break;
      case OPS.setStrokeRGBColor: s.stroke = [a[0], a[1], a[2]].map(Math.round); break;
      case OPS.moveText: move(a[0], a[1]); break;
      case OPS.setLeadingMoveText: s.tl = a[1]; move(a[0], a[1]); break;
      case OPS.setTextMatrix: tm = [...(a.length === 1 ? a[0] : a)]; x = y = lx = ly = 0; break;
      case OPS.nextLine: move(0, s.tl); break;
      case OPS.showText: case OPS.showSpacedText: show(a[0]); break;
      case OPS.nextLineShowText: move(0, s.tl); show(a[0]); break;
      case OPS.nextLineSetSpacingShowText: s.tw = a[0]; s.tc = a[1]; move(0, s.tl); show(a[2]); break;
    }
  });

  return {ops, runs: runs.filter(r => r.size > 1 && r.x > view[0] - 5 && r.x < view[2] + 5 && r.y > view[1] - 5 && r.y < view[3] + 5)};
}

// Right-to-left lines are stored as they look. Turn them round glyph by glyph, then spell them normally.
function readRightToLeft(l){
  const g = l.glyphs.slice().reverse(), ltr = s => /^[A-Za-z0-9\u00c0-\u024f\u0660-\u0669\u06f0-\u06f9]+$/.test(s);
  for (let i = 0; i < g.length; i++){
    if (!ltr(g[i])) continue;
    let end = i;
    for (let j = i + 1; j < g.length; j++){
      if (ltr(g[j])) end = j;
      else if (!/^[ .,:@_\/+-]$/.test(g[j])) break;
    }
    g.splice(i, end - i + 1, ...g.slice(i, end + 1).reverse());
    i = end;
  }
  let text = g.join("").normalize("NFKC");
  // Arabic fonts often report Persian look-alikes for ordinary yeh and heh.
  if (!/[\u067e\u0686\u0698\u06af\u0679\u0688\u0691\u06ba\u06d2]/.test(text)) text = text.replace(/\u06cc/g, "\u064a").replace(/\u06be/g, "\u0647");
  l.text = text.replace(/\s+/g, " ").replace(/\s+([.,،؟:])/g, "$1").trim();
  const longest = l.spans.reduce((a, b) => b.text.length > a.text.length ? b : a);
  l.spans = [{text: l.text, font: longest.font}];
}

// These alphabets, and fonts with no character map, can't be trusted as stored text: read them by eye.
function unreadable(runs){
  const t = runs.map(r => r.text).join("").replace(/\s/g, "");
  const complex = (t.match(/[\u0900-\u0dff\u1000-\u109f\u1780-\u17ff]/g) || []).length;
  const junk = (t.match(/[\u0000-\u001f\u007f-\u009f\ue000-\uf8ff\ufffd]/g) || []).length;
  return complex > t.length * .25 || junk > t.length * .25;
}

function toLines(runs){
  const groups = [];
  for (const r of runs){
    r.c = Math.cos(r.ang); r.s = Math.sin(r.ang);
    r.u = r.x * r.c + r.y * r.s; r.v = r.x * r.s - r.y * r.c;
    let g = groups.find(g => Math.abs(g.ang - r.ang) < .012);
    if (!g) groups.push(g = {ang: r.ang, runs: []});
    g.runs.push(r);
  }
  const lines = [];
  for (const g of groups){
    const rows = [];
    for (const r of g.runs.sort((a, b) => a.v - b.v)){
      let row = rows.slice(-6).find(q => Math.abs(q.v - r.v) < .22 * Math.min(q.size, r.size));
      if (!row) rows.push(row = {v: r.v, size: r.size, runs: []});
      row.runs.push(r);
    }
    for (const row of rows){
      let line = null;
      for (const r of row.runs.sort((a, b) => a.u - b.u)){
        const gap = line ? r.u - line.right : 0, last = line?.runs[line.runs.length - 1];
        // Some files fake bold by printing the same words twice.
        if (last && last.text === r.text && Math.abs(last.u - r.u) < r.size * .12){ last.twins = [...(last.twins || []), r.op]; continue; }
        const size = line?.size, bullet = line && !/[\p{L}\p{N}]/u.test(line.text) && gap > r.size * .2;
        if (!line || bullet || gap > Math.max(size, r.size) * .95 || gap < -size * .6 || Math.max(size, r.size) / Math.min(size, r.size) > 1.45){
          line = {u: r.u, v: r.v, right: r.u, size: r.size, ang: r.ang, runs: [], spans: [], text: "", glyphs: []};
          lines.push(line);
        } else if (gap > r.size * .14 && !line.text.endsWith(" ")){
          line.text += " "; line.spans[line.spans.length - 1].text += " "; line.glyphs.push(" ");
        }
        // Some fonts report look-alike code points (radicals, joined letters) in place of the real ones.
        const t = r.text.replace(/\s+/g, " ").replace(/[\u2e80-\u2fdf\uf900-\ufaff\ufb00-\ufb06]/g, c => c.normalize("NFKC"));
        line.glyphs.push(...r.glyphs);
        line.runs.push(r); line.text += t; line.spans.push({text: t, font: r.font});
        line.right = Math.max(line.right, r.u + r.w);
      }
    }
  }
  for (const l of lines){
    l.w = l.right - l.u;
    if (IP.RTL.test(l.text)) readRightToLeft(l);
  }
  return lines;
}

function toBlocks(lines){
  const groups = [];
  const main = l => l.spans.reduce((a, b) => b.text.length > a.text.length ? b : a).font;
  for (const l of lines.sort((a, b) => a.v - b.v || a.u - b.u)){
    let best = null;
    for (const g of groups){
      const p = g[g.length - 1], dv = l.v - p.v, size = p.size, f = main(p), n = main(l);
      if (Math.abs(p.ang - l.ang) > .012 || Math.abs(l.size - size) > size * .08 || dv < size * .85 || dv > size * 1.75) continue;
      if (g.length > 1 && Math.abs(dv - (p.v - g[g.length - 2].v)) > size * .2) continue;
      if (f.family !== n.family || f.color.join() !== n.color.join()) continue;
      if (f.bold !== n.bold && p.spans.every(s => s.font.bold === f.bold) && l.spans.every(s => s.font.bold === n.bold)) continue;
      const sameL = Math.abs(p.u - l.u) < size * .5 || (g.length === 1 && p.u > l.u && p.u - l.u < size * 3.5);
      const sameC = Math.abs(p.u + p.w / 2 - l.u - l.w / 2) < size * .5, sameR = Math.abs(p.right - l.right) < size * .5;
      if (!sameL && !sameC && !sameR) continue;
      if (/^\s*([•●▪■◦‣➢✓]|[-–*]\s|\(?\d{1,2}[.)]\s)/.test(l.text)) continue;
      const prev = p.text.trim(), next = l.text.trim();
      const continues = /^\p{Ll}/u.test(next) && !/[.!?:]$/.test(prev);
      const first = (/[\u3040-\u9fff]/.test(next) ? 1 : next.split(" ")[0].length) / Math.max(1, next.length) * l.w;
      const edge = Math.max(l.right, ...g.map(q => q.right));
      const prose = p.w > size * 18 && !/:$/.test(prev) && p.right + first + size * .25 >= edge;
      if (continues || prose){ best = g; break; }
    }
    best ? best.push(l) : groups.push([l]);
  }

  return groups.filter(g => IP.worth(g.map(l => l.text).join(" "))).map(g => {
    const first = g[0], styles = [], keys = new Map(), spans = [];
    g.forEach((l, i) => l.spans.forEach((s, j) => {
      const k = JSON.stringify(s.font);
      if (!keys.has(k)){ keys.set(k, styles.length); styles.push(s.font); }
      let t = s.text;
      if (i < g.length - 1 && j === l.spans.length - 1){
        // Undo hyphenation at line ends.
        if (/\p{Ll}-\s*$/u.test(t) && /^\s*\p{Ll}/u.test(g[i + 1].text)) t = t.replace(/-\s*$/, "");
        else if (/[\uac00-\ud7af]\s*$/.test(t) && /^[\uac00-\ud7af](?:[\s.]|$)/.test(g[i + 1].text)) t = t.trimEnd();
        else if (!/\s$/.test(t) && !/[\u3040-\u9fff]$/.test(t)) t += " ";
      }
      const last = spans[spans.length - 1], style = keys.get(k);
      if (last && (last.style === style || !t.trim())) last.text += t; else spans.push({text: t, style});
    }));
    return {
      x: first.runs[0].x, y: first.runs[0].y, ang: first.ang, u0: first.u, v0: first.v,
      size: IP.median(g.map(l => l.size)), styles, spans, out: null, align: "left",
      lines: g.map(l => ({u: l.u - first.u, v: l.v - first.v, w: l.w})),
      lead: g.length > 1 ? (g[g.length - 1].v - first.v) / (g.length - 1) : first.size * 1.2,
      ops: g.flatMap(l => l.runs.flatMap(r => [r.op, ...(r.twins || [])])), src: g, room: {left: 0, right: 0}, extra: 0,
    };
  });
}

// Looks at the page with its text lifted out, to see how far each phrase may grow.
function findRoom(blocks, lines, img, vp, view){
  const D = img.data;
  const pixel = (b, u, v) => {
    const c = Math.cos(b.ang), s = Math.sin(b.ang), x = b.x + u*c + v*s, y = b.y + u*s - v*c;
    if (x < view[0] + 3 || x > view[2] - 3 || y < view[1] + 3 || y > view[3] - 3) return -1;
    const [px, py] = vp.convertToViewportPoint(x, y);
    const i = Math.floor(py) * img.width + Math.floor(px);
    return px < 0 || py < 0 || i * 4 >= D.length || px >= img.width ? -1 : i * 4;
  };
  const differs = (i, bg) => i < 0 || Math.abs(D[i]-bg[0]) + Math.abs(D[i+1]-bg[1]) + Math.abs(D[i+2]-bg[2]) > 75;
  const bands = [-.65, -.45, -.25, -.06];
  const pageLeft = Math.min(...lines.map(l => l.u)), pageRight = Math.max(...lines.map(l => l.right));
  // Margins are usually symmetrical, even if every line on the page hugs one side.
  const marginL = Math.min(pageLeft, view[0] + view[2] - pageRight), marginR = Math.max(pageRight, view[0] + view[2] - pageLeft);

  for (const b of blocks){
    const S = b.size, L = b.lines, left = Math.min(...L.map(l => l.u)), right = Math.max(...L.map(l => l.u + l.w));
    const others = lines.filter(l => !b.src.includes(l) && Math.abs(l.ang - b.ang) < .012)
      .map(l => ({a: l.u - b.u0, b: l.right - b.u0, v: l.v - b.v0, size: l.size}));
    const reach = side => {
      const max = Math.min(620, S * 52), step = Math.max(.7, S * .1);
      let far = max;
      for (const l of L){
        const edge = side > 0 ? right : left, i0 = pixel(b, side > 0 ? l.u + l.w : l.u, l.v - S * .3);
        if (i0 < 0) return 0;
        const bg = [D[i0], D[i0+1], D[i0+2]];
        for (const o of others){
          if (o.v - .85*o.size > l.v + .15*S || o.v + .15*o.size < l.v - .85*S) continue;
          if (side > 0 && o.a > l.u + l.w - 1) far = Math.min(far, o.a - edge - S * .55);
          if (side < 0 && o.b < l.u + 1) far = Math.min(far, edge - o.b - S * .55);
        }
        for (let d = step; d <= far + step; d += step){
          if (bands.some(k => differs(pixel(b, edge + side * d, l.v + k * S), bg))){ far = Math.min(far, d - S * .35); break; }
        }
      }
      return Math.max(0, far);
    };
    b.room = {left: reach(-1), right: reach(1)};

    if (Math.abs(b.ang) < .01) b.margin = {left: marginL - b.u0, right: marginR - b.u0};
    const rtl = IP.RTL.test(b.spans.map(s => s.text).join(""));
    if (L.length > 1){
      const spread = f => Math.max(...L.map(f)) - Math.min(...L.map(f));
      const el = spread(l => l.u), er = spread(l => l.u + l.w), ec = spread(l => l.u + l.w / 2);
      if (L.length > 2 && Math.max(...L.slice(0, -1).map(l => l.u + l.w)) - Math.min(...L.slice(0, -1).map(l => l.u + l.w)) < S * .25 && el < S * 3.5) b.align = "justify";
      else if (el > S * .5 && ec < S * .5) b.align = "center";
      else if (el > S * .5 && er < S * .5) b.align = "right";
      // Paragraphs stay inside the page's margins.
      if (Math.abs(b.ang) < .01) b.room.right = Math.min(b.room.right, Math.max(0, pageRight - b.u0 - right));
      if (b.align === "justify") b.room.right = 0;
      if (rtl && b.align === "left") b.align = "right";
      if (rtl) b.room.left = Math.min(b.room.left, Math.max(0, b.u0 + left - marginL));
    } else {
      // Lines after a bullet keep to it, whichever way they read.
      b.marked = others.some(o => Math.abs(o.v - L[0].v) < S * .3 && o.b < 1 && o.b > -S * 3);
      if (b.margin && L[0].w > (marginR - marginL) * .5){
        b.room.right = Math.min(b.room.right, Math.max(0, b.margin.right - right));
        if (rtl) b.room.left = Math.min(b.room.left, Math.max(0, left - b.margin.left));
      }
      const a = b.u0, z = a + L[0].w, pageMid = (view[0] + view[2]) / 2;
      const {left: rl, right: rr} = b.room;
      const boxed = rl > S * .2 && rl < S * 12 && Math.abs(rl - rr) < S * .5;
      const level = Math.abs(b.ang) < .01;
      if ((level && Math.abs((a + z) / 2 - pageMid) < 3 && a - pageLeft > S) || (boxed && (!level || a - pageLeft > S))) b.align = "center";
      else if (level && a > pageMid && (Math.abs(z - pageRight) < 3 || (rr < S * 1.2 && rl > S * 2.5))) b.align = "right";
      if (rtl && b.align === "left") b.align = "right";
    }

    if (L.length < 2) continue;
    // One more line is allowed only where the space below is truly empty.
    const v = L[L.length - 1].v + b.lead, i0 = pixel(b, left, v), top = v - S, low = v + S * .75;
    if (i0 < 0 || others.some(o => o.a < right && o.b > left && o.v > top && o.v - o.size * .8 < low)) continue;
    const bg = [D[i0], D[i0+1], D[i0+2]];
    let clear = true;
    for (let u = left; u <= right && clear; u += S * .25)
      for (let w = top + S * .2; w <= low; w += S * .2) if (differs(pixel(b, u, w), bg)){ clear = false; break; }
    b.extra = clear ? 1 : 0;
  }
}

// A patch over a scan must share the scan's colour profile, or it shows as a paler rectangle.
function imageProfile(page){
  const {PDFName, PDFDict, PDFArray} = window.PDFLib, ctx = page.doc.context;
  const xs = page.node.Resources()?.lookup(PDFName.of("XObject"));
  if (!(xs instanceof PDFDict)) return null;
  for (const [, ref] of xs.entries()){
    const cs = ctx.lookup(ref)?.dict?.get(PDFName.of("ColorSpace")), v = cs && ctx.lookup(cs);
    if (!(v instanceof PDFArray) || String(v.get(0)) !== "/ICCBased") continue;
    if (String(ctx.lookup(v.get(1))?.dict?.get(PDFName.of("N"))) === "3") return cs;
  }
  return null;
}

IP.PdfFile = class {
  async load(file, o){
    this.name = file.name; this.type = "application/pdf";
    this.bytes = new Uint8Array(await file.arrayBuffer());
    const L = window.PDFLib;
    let doc;
    try { doc = await L.PDFDocument.load(this.bytes, {updateMetadata: false}); }
    catch (e){ throw {code: /encrypt/i.test(e.message) ? "locked" : "damaged", cause: e}; }
    const pdf = this.original = await IP.openPdf(this.bytes);
    this.pages = []; this.notes = [];
    const edited = doc.getPages();

    for (let n = 1; n <= pdf.numPages; n++){
      o.check(); o.progress(`Studying the layout of page ${n} of ${pdf.numPages}`, (n - 1) / pdf.numPages);
      const page = await pdf.getPage(n), p = {n, page, blocks: [], scan: null};
      this.pages.push(p);
      const {ops, runs} = await readRuns(page);
      p.ops = ops;
      const chars = runs.reduce((a, r) => a + r.text.replace(/\s/g, "").length, 0);
      const {fnArray} = await page.getOperatorList();
      const {OPS} = window.pdfjsLib;
      const hasImage = fnArray.some(f => [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(f));
      if (chars < 15 && (hasImage || fnArray.includes(OPS.constructPath))){ p.needsOcr = true; continue; }
      if (!chars) continue;
      if (unreadable(runs)){ p.needsOcr = true; continue; }

      const rw = IP.rewriteText(edited[n - 1], i => ops[i]?.adv ?? null);
      // If the two readers disagree about the page, changing its instructions is unsafe.
      if (rw.count !== ops.length){ p.needsOcr = true; continue; }
      rw.commit();
      p.lines = toLines(runs); p.blocks = toBlocks(p.lines); p.hasImage = hasImage; p.bare = true;
    }

    let looked = 0;
    if (this.pages.some(p => p.blocks.length || p.hasImage)){
      const bare = await IP.openPdf(await doc.save());
      for (const p of this.pages){
        if (!p.bare || (!p.blocks.length && !p.hasImage)) continue;
        o.check(); o.progress(`Measuring the space on page ${p.n} of ${pdf.numPages}`, (p.n - 1) / pdf.numPages);
        const {cv, vp} = await IP.renderPage(await bare.getPage(p.n), 2);
        findRoom(p.blocks, p.lines, cv.getContext("2d").getImageData(0, 0, cv.width, cv.height), vp, p.page.view);
        if (!p.hasImage || looked >= MAX_READ) continue;
        // With the page's own text lifted out, whatever writing is left is inside its pictures.
        looked++;
        const view = await IP.renderPage(await bare.getPage(p.n), 3, true);
        const art = await new IP.Picture().read(view.cv, {...o, label: `the pictures on page ${p.n}`});
        if (!art.blocks.length) continue;
        p.art = art; p.vp = view.vp;
      }
      await bare.destroy();
    }

    const scans = this.pages.filter(p => p.needsOcr);
    for (const [i, p] of scans.slice(0, MAX_READ).entries()){
      o.check();
      const {cv, vp} = await IP.renderPage(p.page, 3);
      p.vp = vp;
      p.scan = await new IP.Picture().read(cv, {...o, label: `scanned page ${p.n}` + (scans.length > 1 ? ` (${i + 1} of ${Math.min(scans.length, MAX_READ)})` : "")});
      p.blocks = p.scan.blocks;
    }
    if (scans.length > 20) this.notes.push(`Only the first 20 scanned pages can be read at once; ${scans.length - 20} were left in the original language.`);
    const withImages = this.pages.filter(p => p.bare && p.hasImage).length;
    if (withImages > MAX_READ) this.notes.push(`Pictures were translated on the first ${MAX_READ} illustrated pages only.`);
    this.usedOcr = scans.length > 0 || this.pages.some(p => p.art);

    this.fields = [];
    for (const f of doc.getForm().getFields()){
      if (!(f instanceof L.PDFTextField)) continue;
      let value;
      // Rich-text fields refuse to be read.
      try { value = f.getText(); } catch { continue; }
      if (value && IP.worth(value)) this.fields.push({name: f.getName(), spans: [{text: value, style: 0}], out: null});
    }
    this.blocks = this.pages.flatMap(p => [...p.blocks, ...(p.art?.blocks || [])]).concat(this.fields);
    return this;
  }

  async build(target){
    const L = window.PDFLib, doc = await L.PDFDocument.load(this.bytes, {updateMetadata: false});
    const names = {sans: ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"], serif: ["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"], mono: ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"]};
    const cache = {}, pages = doc.getPages();
    const font = async f => {
      const k = names[f.family][(f.bold ? 1 : 0) + (f.italic ? 2 : 0)];
      return cache[k] ||= await doc.embedFont(L.StandardFonts[k]);
    };
    const charset = new Set((await font({family: "sans"})).getCharacterSet());
    this.shrunk = 0;
    const profiles = [];

    for (const p of this.pages){
      const page = pages[p.n - 1], done = p.blocks.filter(b => b.out);
      const artDone = !!p.art?.blocks.some(b => b.out);
      if (!done.length && !artDone) continue;
      const overlay = async pic => {
        const layer = await doc.embedPng(await IP.png(pic.draw().layer)), {vp} = p;
        this.shrunk += pic.shrunk;
        const cs = imageProfile(page);
        if (cs) profiles.push([layer.ref, cs]);
        const at = (x, y) => vp.convertToPdfPoint(x, y), o = at(0, vp.height), r = at(vp.width, vp.height), t = at(0, 0);
        page.drawImage(layer, {
          x: o[0], y: o[1], width: Math.hypot(r[0]-o[0], r[1]-o[1]), height: Math.hypot(t[0]-o[0], t[1]-o[1]),
          rotate: L.radians(Math.atan2(r[1]-o[1], r[0]-o[0])),
        });
      };
      if (p.scan){ await overlay(p.scan); continue; }

      // One instruction can hold several table cells: lifting it out means redrawing all of them.
      const out = new Set(done.flatMap(b => b.ops)), draw = new Set(done);
      for (let grew = true; grew;){
        grew = false;
        for (const b of p.blocks){
          if (draw.has(b) || !b.ops.some(o => out.has(o))) continue;
          draw.add(b); b.ops.forEach(o => out.add(o)); grew = true;
        }
      }
      const gone = new Set([...out].map(o => o.i));
      IP.rewriteText(page, i => gone.has(i) ? p.ops[i]?.adv ?? null : null).commit();
      if (artDone) await overlay(p.art);
      const owned = new Set(p.blocks.flatMap(b => b.src));
      const items = [...draw];
      for (const l of p.lines){
        if (owned.has(l) || !l.runs.some(r => out.has(r.op))) continue;
        for (const r of l.runs)
          if (out.has(r.op)) items.push({x: r.x, y: r.y, ang: r.ang, size: r.size, styles: [r.font], spans: [{text: r.text, style: 0}], lines: [{u: 0, v: 0, w: r.w}], align: "left", room: {left: 0, right: 0}, lead: r.size});
      }

      const jobs = [];
      for (const b of items){
        const spans = b.out || b.spans, text = spans.map(s => s.text).join("").replace(/\s/g, " ");
        const vector = [...text].every(c => charset.has(c.codePointAt(0)));
        const fonts = vector ? await Promise.all(b.styles.map(font)) : null;
        const measure = vector ? (s, f) => fonts[b.styles.indexOf(f)].widthOfTextAtSize(s.replace(/\s/g, " "), 1000) / 1000 : IP.measure;
        jobs.push({b, spans, fonts, measure, fit: IP.fit(b, spans, measure)});
      }
      // Body paragraphs of one size should stay one size.
      const body = jobs.filter(j => j.b.lines.length > 1);
      for (const j of body){
        const low = Math.min(...body.filter(k => Math.abs(k.b.size - j.b.size) < .3 && k.fit.scale >= .78).map(k => k.fit.scale));
        if (low < j.fit.scale) j.shared = low;
      }

      for (const j of jobs){
        const {b, fonts} = j, fit = j.shared ? IP.fit(b, j.spans, j.measure, j.shared) : j.fit;
        const c = Math.cos(b.ang), s = Math.sin(b.ang), at = (u, v) => ({x: b.x + u*c + v*s, y: b.y + u*s - v*c});
        if (b.out && fit.scale < .7) this.shrunk++;
        if (fonts){
          for (const ln of fit.lines){
            let u = ln.u; const pieces = [];
            for (const t of ln.toks){
              const last = pieces[pieces.length - 1];
              if (last && last.style === t.style && !ln.gap) last.text += t.text;
              else pieces.push({text: t.text, style: t.style, u});
              u += t.em * fit.size * fit.sx + (t.space ? ln.gap : 0);
            }
            for (const t of pieces){
              const f = b.styles[t.style] || b.styles[0];
              page.pushOperators(L.pushGraphicsState(), L.setCharacterSqueeze(fit.sx * 100));
              page.drawText(t.text.replace(/\s/g, " "), {
                ...at(t.u, ln.v), size: fit.size, font: fonts[t.style] || fonts[0],
                color: L.rgb(...f.color.map(v => v / 255)), opacity: f.alpha ?? 1, rotate: L.radians(b.ang),
              });
              page.pushOperators(L.popGraphicsState());
            }
          }
        } else {
          // The built-in PDF fonts lack these alphabets, so the browser shapes them.
          const S = fit.size, a = Math.min(...fit.lines.map(l => l.u)) - S * .3, z = Math.max(...fit.lines.map(l => l.u + l.w)) + S * .3;
          const top = fit.lines[0].v - S * 1.35, low = fit.lines[fit.lines.length - 1].v + S * .6;
          const k = Math.min(6, 8000 / (z - a), 8000 / (low - top)), cv = IP.canvas((z - a) * k, (low - top) * k), g = cv.getContext("2d");
          g.scale(k, k); g.translate(-a, -top); IP.paint(g, b, fit);
          page.drawImage(await doc.embedPng(await IP.png(cv)), {...at(a, low), width: z - a, height: low - top, rotate: L.radians(b.ang)});
        }
      }
    }
    const filled = this.fields.filter(f => f.out);
    if (filled.length){
      const form = doc.getForm(), plain = await font({family: "sans"});
      this.fieldsLeft = 0;
      for (const f of filled){
        const text = f.out.map(s => s.text).join("");
        // A field can only show letters its font has.
        if (![...text.replace(/\s/g, " ")].every(c => charset.has(c.codePointAt(0)))){ this.fieldsLeft++; continue; }
        const field = form.getTextField(f.name);
        const max = field.getMaxLength();
        if (max !== undefined && text.length > max){ this.fieldsLeft++; continue; }
        field.setText(text); field.setFontSize(0); field.updateAppearances(plain);
      }
    } else this.fieldsLeft = 0;
    if (target){
      // Readers, screen readers and search treat the file as written in the new language.
      doc.setLanguage(target.code);
      // The old accessibility tree describes text that is no longer there.
      for (const key of ["StructTreeRoot", "MarkInfo"]) doc.catalog.delete(L.PDFName.of(key));
    }
    await doc.flush();
    for (const [ref, cs] of profiles) doc.context.lookup(ref).dict.set(L.PDFName.of("ColorSpace"), cs);
    IP.sweep(doc);
    return new Blob([await doc.save()], {type: this.type});
  }

  async preview(box, blob){
    const pdf = blob ? await IP.openPdf(new Uint8Array(await blob.arrayBuffer())) : this.original;
    const shown = [];
    for (let n = 1; n <= Math.min(pdf.numPages, 40); n++) shown.push((await IP.renderPage(await pdf.getPage(n), 1.6)).cv);
    box.replaceChildren(...shown);
    if (blob) await pdf.destroy();
  }
  close(){ this.original?.destroy(); }
};
})();
