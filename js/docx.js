/* Word: the same file with only the words inside its text nodes replaced. */
(() => {
"use strict";
const IP = window.InPlace;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|charts\/chart\d+|diagrams\/(data|drawing)\d+)\.xml$/;
// Anything here ends a phrase, so it stays exactly where it was.
const STOPS = new Set(["tab", "br", "cr", "fldChar", "drawing", "pict", "object", "AlternateContent", "oMath", "oMathPara", "sym", "ptab", "footnoteReference", "endnoteReference", "fld"]);

function segments(p){
  const out = []; let cur = [];
  const end = () => { if (cur.length) out.push(cur); cur = []; };
  const walk = el => {
    for (const c of el.children){
      const n = c.localName;
      if (n === "rPr" || n === "pPr" || n === "endParaRPr" || n === "del" || n === "instrText") continue;
      if (STOPS.has(n)){ end(); continue; }
      if (n === "t" && (c.namespaceURI === W || c.namespaceURI === A)) cur.push(c);
      else if (n !== "p") walk(c);
    }
  };
  walk(p); end();
  return out;
}

// Runs that look identical are one style, however Word happened to split them.
function look(t){
  const r = t.parentNode, pr = [...r.children].find(c => c.localName === "rPr"), parts = [];
  if (pr){
    for (const c of pr.children){
      if (["lang", "noProof", "proofErr", "szCs", "bCs", "iCs"].includes(c.localName)) continue;
      if (c.localName === "rFonts" && !c.getAttributeNS(W, "ascii") && !c.getAttributeNS(W, "asciiTheme")) continue;
      parts.push(new XMLSerializer().serializeToString(c));
    }
    if (pr.namespaceURI === A) for (const a of pr.attributes) if (!["lang", "dirty", "err", "altLang"].includes(a.name)) parts.push(a.name + a.value);
  }
  if (r.parentNode.localName === "hyperlink") parts.push("link" + [...r.parentNode.attributes].map(a => a.value).join());
  return parts.sort().join("|");
}

function setText(t, s){
  t.textContent = s;
  if (t.namespaceURI === W) t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
}

function markLtr(t){
  if (t.namespaceURI !== W) return;
  let p = t.parentNode; while (p && p.localName !== "p") p = p.parentNode;
  for (const [host, kid, name] of [[p, "pPr", "bidi"], [t.parentNode, "rPr", "rtl"]]){
    const pr = host && [...host.children].find(c => c.localName === kid);
    if (pr) [...pr.children].filter(c => c.localName === name).forEach(c => c.remove());
  }
}

function setLanguage(doc, code){
  for (const el of [...doc.getElementsByTagNameNS(W, "lang")])
    el.setAttributeNS(W, "w:" + (IP.RTL_LANG.has(code) ? "bidi" : /^(ja|ko|zh)/.test(code) ? "eastAsia" : "val"), code);
}

function markRtl(t){
  if (t.namespaceURI !== W) return;
  let p = t.parentNode; while (p && p.localName !== "p") p = p.parentNode;
  if (!p) return;
  const ensure = (host, name, first) => {
    let el = [...host.children].find(c => c.localName === name);
    if (!el){ el = host.ownerDocument.createElementNS(W, "w:" + name); first ? host.insertBefore(el, host.firstChild) : host.append(el); }
    return el;
  };
  const pr = ensure(p, "pPr", true);
  if (![...pr.children].some(c => c.localName === "bidi")){
    const after = [...pr.children].find(c => ["adjustRightInd","snapToGrid","spacing","ind","contextualSpacing","jc","rPr","sectPr","outlineLvl"].includes(c.localName));
    pr.insertBefore(p.ownerDocument.createElementNS(W, "w:bidi"), after || null);
  }
  ensure(ensure(t.parentNode, "rPr", true), "rtl");
}

function write(nodes, styles, out){
  let pieces = [];
  for (const s of out){
    const last = pieces[pieces.length - 1];
    if (last && (last.style === s.style || !s.text.trim())) last.text += s.text; else pieces.push({...s});
  }
  const owner = [], slots = [];
  nodes.forEach((t, i) => {
    if (slots.length && slots[slots.length - 1].style === styles[i]) slots[slots.length - 1].nodes.push(t);
    else slots.push({style: styles[i], nodes: [t]});
  });
  // Same styles in the same order: every run keeps its place.
  let k = 0;
  for (const pc of pieces){
    while (k < slots.length && slots[k].style !== pc.style) k++;
    if (k === slots.length) break;
    owner.push([pc, slots[k++]]);
  }
  nodes.forEach(t => setText(t, ""));
  if (owner.length === pieces.length){
    for (const [pc, slot] of owner){ setText(slot.nodes[0], pc.text); IP.RTL.test(pc.text) ? markRtl(slot.nodes[0]) : markLtr(slot.nodes[0]); }
    return;
  }
  // The translation reordered the styles, so new runs go in at the head of the phrase.
  const first = nodes[0], run = first.parentNode;
  const head = run.cloneNode(false);
  for (const c of [...run.children]){
    if (c === first) break;
    head.append(c.localName === "rPr" ? c.cloneNode(true) : c);
  }
  let anchor = run;
  if (run.parentNode.localName === "hyperlink") anchor = run.parentNode;
  if ([...head.children].some(c => c.localName !== "rPr")) anchor.parentNode.insertBefore(head, anchor);
  for (const pc of pieces){
    const from = nodes[Math.max(0, styles.indexOf(pc.style))], r = from.parentNode.cloneNode(false);
    for (const c of from.parentNode.children) if (c.localName === "rPr") r.append(c.cloneNode(true));
    const t = from.cloneNode(false); r.append(t); setText(t, pc.text);
    let node = r;
    if (from.parentNode.parentNode.localName === "hyperlink"){ node = from.parentNode.parentNode.cloneNode(false); node.append(r); }
    anchor.parentNode.insertBefore(node, anchor);
    IP.RTL.test(pc.text) ? markRtl(t) : markLtr(t);
  }
}

IP.WordFile = class {
  async load(file, o){
    this.name = file.name; this.notes = []; this.blocks = []; this.shrunk = 0;
    this.type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    this.bytes = await file.arrayBuffer();
    let zip;
    try { zip = await window.JSZip.loadAsync(this.bytes); } catch (e){ throw {code: "locked", cause: e}; }
    if (!zip.file("word/document.xml")) throw {code: "damaged"};
    this.xml = {};
    for (const name of Object.keys(zip.files).filter(n => PARTS.test(n))){
      o.check();
      const xml = this.xml[name] = await zip.file(name).async("string");
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const ps = [...doc.getElementsByTagName("*")].filter(e => e.localName === "p" && (e.namespaceURI === W || e.namespaceURI === A));
      ps.forEach((p, pi) => segments(p).forEach((nodes, si) => {
        const keys = [], spans = [];
        for (const t of nodes){
          const k = look(t);
          if (!keys.includes(k)) keys.push(k);
          const style = keys.indexOf(k), last = spans[spans.length - 1];
          if (last && (last.style === style || !t.textContent.trim())) last.text += t.textContent;
          else spans.push({text: t.textContent, style});
        }
        if (IP.worth(spans.map(s => s.text).join(""))) this.blocks.push({name, pi, si, keys, spans, out: null});
      }));
    }

    this.art = [];
    const media = Object.keys(zip.files).filter(n => /^word\/media\/.+\.(png|jpe?g)$/i.test(n));
    for (const name of media.slice(0, 20)){
      o.check();
      const type = /png$/i.test(name) ? "image/png" : "image/jpeg";
      let bmp;
      // An unreadable picture is left exactly as it is.
      try { bmp = await createImageBitmap(new Blob([await zip.file(name).async("arraybuffer")], {type})); } catch { continue; }
      if (Math.min(bmp.width, bmp.height) < 60 || bmp.width * bmp.height > 16e6){ bmp.close(); continue; }
      const cv = IP.canvas(bmp.width, bmp.height);
      cv.getContext("2d", {willReadFrequently: true}).drawImage(bmp, 0, 0); bmp.close();
      const pic = await new IP.Picture().read(cv, {...o, label: "a picture in the document"});
      if (pic.blocks.length){ this.art.push({name, type, pic}); this.blocks.push(...pic.blocks); this.usedOcr = true; }
    }
    if (media.length > 20) this.notes.push("Only the first 20 pictures in this document were translated.");
    return this;
  }

  async build(target){
    const zip = await window.JSZip.loadAsync(this.bytes);
    this.shrunk = 0;
    for (const [name, xml] of Object.entries(this.xml)){
      const todo = this.blocks.filter(b => b.name === name && b.out);
      if (!todo.length) continue;
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const ps = [...doc.getElementsByTagName("*")].filter(e => e.localName === "p" && (e.namespaceURI === W || e.namespaceURI === A));
      // Find every text node first; writing can add runs.
      const jobs = todo.map(b => {
        const nodes = segments(ps[b.pi])[b.si];
        return [nodes, nodes.map(t => b.keys.indexOf(look(t))), b.out];
      });
      for (const j of jobs) write(...j);
      if (target) setLanguage(doc, target.code);
      zip.file(name, new XMLSerializer().serializeToString(doc));
    }
    for (const {name, type, pic} of this.art){
      if (!pic.blocks.some(b => b.out)) continue;
      zip.file(name, await (await IP.blob(pic.draw().full, type, .95)).arrayBuffer());
      this.shrunk += pic.shrunk;
    }
    return zip.generateAsync({type: "blob", mimeType: this.type, compression: "DEFLATE"});
  }

  async preview(box, blob){
    const frame = document.createElement("iframe");
    frame.title = blob ? "Translated Word document" : "Original Word document";
    // No scripts may run from inside an uploaded document.
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.srcdoc = "<!doctype html><html><head></head><body style='margin:0'></body></html>";
    const ready = new Promise(r => frame.onload = r);
    box.replaceChildren(frame); await ready;
    const d = frame.contentDocument;
    await window.docx.renderAsync(blob || this.bytes, d.body, d.head, {renderAltChunks: false, useBase64URL: true});
    const page = d.querySelector("section.docx");
    if (!page) return;
    const pad = d.querySelector(".docx-wrapper");
    if (pad) pad.style.padding = "12px";
    d.body.style.zoom = Math.min(1, frame.clientWidth / (page.offsetWidth + 28));
  }
  close(){}
};
})();
