/* Reads and rewrites PDF drawing instructions, so text can be lifted out and nothing else changes. */
(() => {
"use strict";
const IP = window.InPlace;
const white = c => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const delim = c => "()<>[]{}/%".includes(String.fromCharCode(c));
const str = b => { let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; };
const raw = s => Uint8Array.from(s, c => c.charCodeAt(0));

// Every operator, with the byte range of its operands.
function scan(b){
  const ops = []; let i = 0, args = [], start = -1;
  while (i < b.length){
    const c = b[i];
    if (white(c)){ i++; continue; }
    if (c === 37){ while (i < b.length && b[i] !== 10 && b[i] !== 13) i++; continue; }
    const s = i;
    if (start < 0) start = s;
    if (c === 40){
      let depth = 1; i++;
      while (i < b.length && depth){ if (b[i] === 92) i++; else if (b[i] === 40) depth++; else if (b[i] === 41) depth--; i++; }
    } else if ((c === 60 && b[i + 1] === 60) || (c === 62 && b[i + 1] === 62)) i += 2;
    else if (c === 60){ while (i < b.length && b[i] !== 62) i++; i++; }
    else if (c === 47){ i++; while (i < b.length && !white(b[i]) && !delim(b[i])) i++; }
    else if (delim(c)) i++;
    else {
      while (i < b.length && !white(b[i]) && !delim(b[i])) i++;
      const word = str(b.subarray(s, i));
      if (!/^([+-]?[\d.]+(?:-?\d*)|true|false|null)$/.test(word)){
        if (word === "BI"){ i = skipInlineImage(b, i); }
        ops.push({op: word, args, start, end: i});
        args = []; start = -1;
        continue;
      }
    }
    args.push([s, i]);
  }
  return ops;
}

function skipInlineImage(b, i){
  while (i < b.length && !(b[i] === 73 && b[i + 1] === 68 && white(b[i - 1]) && white(b[i + 2]))) i++;
  for (i += 3; i < b.length; i++){
    if (b[i] !== 69 || b[i + 1] !== 73 || !white(b[i - 1]) || !(i + 2 >= b.length || white(b[i + 2]))) continue;
    // "EI" can occur inside image data; real ones are followed by readable operators.
    if (b.subarray(i + 2, i + 22).every(x => white(x) || (x >= 32 && x < 127))) return i + 2;
  }
  return b.length;
}

function read(stream, ctx){
  const {PDFRawStream, decodePDFRawStream} = window.PDFLib;
  const s = ctx.lookup(stream);
  if (!s) return new Uint8Array(0);
  return s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getUnencodedContents();
}
function contents(page){
  const {PDFArray} = window.PDFLib, c = page.node.Contents();
  if (!c) return new Uint8Array(0);
  const list = c instanceof PDFArray ? c.asArray() : [c];
  return raw(list.map(x => str(read(x, page.doc.context))).join("\n"));
}

// Walks the page and the forms it uses, in drawing order, which is the order pdf.js reports text in.
// edit(n) returns null to keep the n-th text instruction, or the advance that must remain in its place.
IP.rewriteText = (page, edit) => {
  const {PDFName, PDFDict} = window.PDFLib, ctx = page.doc.context;
  let n = 0;
  const walk = (bytes, res, depth) => {
    if (depth > 24) throw new Error("pdf-nesting");
    const changes = [], forms = [];
    let open = 0;
    for (const o of scan(bytes)){
      const arg = k => str(bytes.subarray(...o.args[k]));
      if (o.op === "q") open++;
      else if (o.op === "Q") open--;
      else if (["Tj", "TJ", "'", '"'].includes(o.op)){
        const adv = edit(n++);
        if (adv === null || adv === undefined) continue;
        let before = o.op === "'" ? "T* " : "";
        if (o.op === '"') before = `${arg(0)} Tw ${arg(1)} Tc T* `;
        changes.push([o.start, o.end, `${before}[${(+adv).toFixed(3)}] TJ`]);
      } else if ((o.op === "BDC" || o.op === "DP") && o.args.length > 2){
        const t = str(bytes.subarray(o.args[1][0], o.args[o.args.length - 1][1]));
        // Hidden "actual text" would keep the old language in copy and search.
        if (t.includes("/ActualText")) changes.push([o.start, o.end, `${arg(0)} <<>> ${o.op}`]);
      } else if (o.op === "Do" && o.args.length && res){
        const xs = res.lookup(PDFName.of("XObject"));
        if (!(xs instanceof PDFDict)) continue;
        const name = arg(0).slice(1).replace(/#([\da-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
        const form = ctx.lookup(xs.get(PDFName.of(name)));
        if (String(form?.dict?.get(PDFName.of("Subtype"))) !== "/Form") continue;
        const formRes = form.dict.lookup(PDFName.of("Resources"));
        const r = walk(read(form, ctx), formRes || res, depth + 1);
        if (!r.changed) continue;
        // Forms can be shared between pages, so this use gets its own copy.
        const copy = ctx.flateStream(r.bytes);
        for (const [k, v] of form.dict.entries())
          if (!["/Length", "/Filter", "/DecodeParms"].includes(String(k))) copy.dict.set(k, v);
        if (r.res) copy.dict.set(PDFName.of("Resources"), r.res);
        const alias = `PolyX${ctx.largestObjectNumber + 1}`;
        forms.push([alias, ctx.register(copy)]);
        changes.push([o.start, o.end, `/${alias} Do`]);
      }
    }
    let nextRes = null;
    if (forms.length){
      nextRes = res.clone(ctx);
      const xs = res.lookup(PDFName.of("XObject")).clone(ctx);
      for (const [name, ref] of forms) xs.set(PDFName.of(name), ref);
      nextRes.set(PDFName.of("XObject"), xs);
    }
    let out = bytes;
    if (changes.length){
      let s = "", p = 0;
      for (const [a, b, t] of changes){ s += str(bytes.subarray(p, a)) + ` ${t} `; p = b; }
      out = raw(s + str(bytes.subarray(p)));
    }
    return {bytes: out, changed: changes.length > 0, res: nextRes, open};
  };

  const r = walk(contents(page), page.node.Resources(), 0);
  return {
    count: n,
    commit(){
      if (r.res) page.node.set(PDFName.of("Resources"), r.res);
      // Isolate the original's drawing state from what is added afterwards.
      const body = "q\n".repeat(1 + Math.max(0, -r.open)) + str(r.bytes) + "\n" + "Q\n".repeat(1 + Math.max(0, r.open));
      page.node.set(PDFName.of("Contents"), ctx.register(ctx.flateStream(raw(body))));
    },
  };
};

// Delete replaced objects, so the old wording is not left inside the file.
IP.sweep = doc => {
  const {PDFRef, PDFDict, PDFArray, PDFStream} = window.PDFLib, ctx = doc.context, seen = new Set();
  const todo = [ctx.trailerInfo.Root, ctx.trailerInfo.Info];
  while (todo.length){
    let o = todo.pop();
    if (o instanceof PDFRef){ if (seen.has(o.toString())) continue; seen.add(o.toString()); o = ctx.lookup(o); }
    if (o instanceof PDFStream) o = o.dict;
    if (o instanceof PDFDict) for (const [, v] of o.entries()) todo.push(v);
    else if (o instanceof PDFArray) todo.push(...o.asArray());
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.toString())) ctx.delete(ref);
};
})();
