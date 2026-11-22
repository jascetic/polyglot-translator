/* The screen for a file: original beside translation, wording fixes, download. */
(() => {
"use strict";
const IP = window.InPlace, $ = s => document.querySelector(s);
const jsd = p => "https://cdn.jsdelivr.net/npm/" + p;
const LIBS = {
  pdf: [jsd("pdf-lib@1.17.1/dist/pdf-lib.min.js")],
  docx: [jsd("jszip@3.10.1/dist/jszip.min.js"), jsd("docx-preview@0.3.5/dist/docx-preview.min.js")],
  image: [],
};
const loaded = new Map();
const script = src => {
  if (!loaded.has(src)) loaded.set(src, new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = src; s.crossOrigin = "anonymous"; s.onload = ok;
    s.onerror = () => { loaded.delete(src); s.remove(); no({code: "lib"}); };
    document.head.append(s);
  }));
  return loaded.get(src);
};

IP.kindOf = f =>
  /\.pdf$/i.test(f.name) || f.type === "application/pdf" ? "pdf" :
  /\.docx$/i.test(f.name) ? "docx" :
  /^image\/(png|jpeg|webp|gif|bmp)$/.test(f.type) ? "image" : null;

const MSG = {
  locked: "This file is password-protected. Save an unlocked copy and upload that.",
  damaged: "This file couldn't be opened. It may be damaged, or not really the type its name says.",
  lib: "The document tools couldn't load. Check your connection and try again.",
  "ocr-load": "The text reader couldn't load. Check your connection and try again.",
  empty: "No readable words were found. Try a sharper, closer picture, or choose the language in the From menu.",
};
const SCRIPT_MODEL = {Latin: "eng", Cyrillic: "rus", Arabic: "ara", Hebrew: "heb", Japanese: "jpn", Hiragana: "jpn", Katakana: "jpn", Han: "chi_sim", Korean: "kor", Hangul: "kor", Devanagari: "hin", Bengali: "ben", Gurmukhi: "pan", Gujarati: "guj", Tamil: "tam", Telugu: "tel", Kannada: "kan", Malayalam: "mal", Sinhala: "sin", Thai: "tha", Lao: "lao", Myanmar: "mya", Khmer: "khm", Georgian: "kat", Armenian: "hye", Greek: "ell", Ethiopic: "amh"};
// Languages outside the Latin alphabet that share a starter model.
const FAMILY = {ru: "rus", uk: "rus", be: "rus", bg: "rus", mk: "rus", kk: "rus", ar: "ara", fa: "ara", ur: "ara", zh: "chi_sim", ja: "jpn", ko: "kor", hi: "hin", mr: "hin", ne: "hin"};
const NON_LATIN = new Set(Object.values(SCRIPT_MODEL).filter(m => m !== "eng").concat("chi_tra", "ukr", "bel", "bul", "mkd", "kaz", "fas", "urd", "mar", "nep"));
const words = d => (d.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)));
function fixNumbers(reads, numbers){
  for (const d of reads){
    // Every read is compared in the coordinates of the first.
    const k = d.ratio || 1;
    for (const w of words(d)){
      if (!/^\d[\d.,:\/-]*$/.test(w.text)) continue;
      const a = {x0: w.bbox.x0 * k, x1: w.bbox.x1 * k, y0: w.bbox.y0 * k, y1: w.bbox.y1 * k}, hit = numbers.find(n => {
        const b = n.bbox, x = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), y = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        return x > .6 * (a.x1 - a.x0) && x > .6 * (b.x1 - b.x0) && y > .5 * (a.y1 - a.y0);
      });
      if (hit && hit.text.replace(/\D/g, "").length >= w.text.replace(/\D/g, "").length) w.text = hit.text;
    }
  }
}
const join = spans => spans.map(s => s.text).join("").trim();

IP.workspace = app => {
  let file = null, kind = null, doc = null, gen = 0, readWith = null, result = null, target = null, stopped = null, busy = false;

  const state = v => {
    busy = v;
    $("#docDownload").disabled = v || !result;
    $("#docEdit").hidden = v || !result;
    app.setBusy(v);
  };
  const fail = e => {
    if (!e?.code || e.code === "damaged") console.warn(e?.cause || e);
    app.status(MSG[e?.code] || MSG[e?.message] || app.errors[e?.code] || "Something went wrong with this file. Try again, or upload another copy.", false, e?.code !== "cancelled");
  };
  function reset(){
    result = null;
    $("#docEditor").hidden = true; $("#docEdit").setAttribute("aria-expanded", "false");
    const p = document.createElement("p");
    p.className = "doc-empty"; p.textContent = "The translated file will appear here, laid out like the original.";
    $("#docAfter").replaceChildren(p);
  }

  function reader(mine, check, langNow){
    let worker = null, scout = null, lang = null, label = "", share = 0, steps = 3;
    const use = async code => {
      const T = await app.loadTesseract();
      check();
      if (!worker) worker = await T.createWorker(code, 1, {logger: m => {
        if (mine === gen && m.status === "recognizing text") app.progress(`Reading the words on ${label}`, share + m.progress / steps);
      }});
      else if (code !== lang) await worker.reinitialize(code);
      lang = code;
    };
    const read = async p => {
      await worker.setParameters({tessedit_pageseg_mode: p.mode});
      return (await worker.recognize(p.image, {}, {blocks: true, text: true})).data;
    };
    // Which alphabet is this, and which way is up?
    async function look(canvas){
      const T = await app.loadTesseract();
      app.status("Working out what this document is", true);
      scout ||= await T.createWorker("osd", 0, {legacyCore: true, legacyLang: true});
      const best = {turn: 0, script: null};
      for (const side of [2000, 1100]){
        const k = side / Math.max(canvas.width, canvas.height), cv = IP.canvas(canvas.width * k, canvas.height * k), g = cv.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(canvas, 0, 0, cv.width, cv.height);
        check();
        let d;
        // It throws when there is too little writing to judge.
        try { d = (await scout.detect(cv)).data; } catch { continue; }
        if (!d?.script) continue;
        best.script = d.script;
        if (d.orientation_confidence >= 6) best.turn = d.orientation_degrees || 0;
        break;
      }
      return best;
    }

    // Reads once with the likeliest alphabet, and tries others only if that makes no sense.
    async function firstRead(pass, script){
      const chosen = app.ocrLang(langNow);
      if (chosen){ await use(chosen); return read(pass); }
      const likely = SCRIPT_MODEL[script], tried = new Set();
      let best = null;
      const attempt = async code => {
        if (tried.has(code)) return;
        tried.add(code);
        await use(code);
        const data = await read(pass); check();
        if (!best || data.confidence > best.data.confidence) best = {code, data};
      };
      await attempt(likely || "eng");
      const good = () => best.data.confidence >= 70;
      if (!good() && script === "Han") await attempt("jpn");
      if (!good()) await attempt("eng");
      if (!good() && best.data.text.replace(/\s/g, "").length > 5)
        for (const code of ["hin", "ara", "rus", "chi_sim", "jpn", "kor"]){ if (good()) break; await attempt(code); }

      let code = best.code;
      // One alphabet serves many languages; the accents need the right model.
      if (["eng", "rus", "ara", "chi_sim", "hin"].includes(code) && best.data.confidence > 25){
        const found = await app.detect(best.data.text), family = found && FAMILY[found.split("-")[0].toLowerCase()];
        if (found && (code === "eng" ? !family : family === code)) code = app.ocrLang(found) || code;
      }
      await use(code);
      return code === best.code ? best.data : read(pass);
    }

    return {
      look,
      end: () => Promise.all([worker?.terminate(), scout?.terminate()]),
      async run(passes, name, script){
        label = name; share = 0; steps = passes.length;
        const out = [await firstRead(passes[0], script)];
        const rest = passes.slice(1).filter(p => !p.nonLatin || NON_LATIN.has(lang));
        steps = rest.length + 1;
        for (const [i, p] of rest.entries()){ check(); share = (i + 1) / steps; out.push({...await read(p), scale: p.scale, ratio: passes[0].image.width / p.image.width}); }
        if (NON_LATIN.has(lang)){
          // Non-Latin models drop digits (2019 becomes 209), so numbers get a second opinion.
          const own = lang;
          await use("eng");
          const second = await read(passes[0]); check();
          fixNumbers(out, words(second).filter(w => /^\d[\d.,:\/-]*$/.test(w.text) && w.confidence >= 75));
          await use(own);
        }
        return out;
      },
    };
  }

  async function analyse(){
    const mine = ++gen, signal = app.begin();
    stopped = null;
    const check = () => { if (mine !== gen || signal.aborted) throw {code: "cancelled"}; };
    doc?.close(); doc = null; reset(); state(true);
    readWith = app.from();
    const ocr = reader(mine, check, readWith);
    try {
      app.status(`Opening ${file.name}`, true);
      // In order: the Word viewer needs JSZip to exist when it loads.
      for (const src of LIBS[kind]) await script(src);
      check();
      if (kind === "pdf" && !window.pdfjsLib) throw {code: "lib"};
      const Type = {pdf: IP.PdfFile, docx: IP.WordFile, image: IP.ImageFile}[kind];
      const d = await new Type().load(file, {check, progress: app.progress, ocr: ocr.run, look: ocr.look});
      check();
      await d.preview($("#docBefore"), null); check();
      doc = d;
      if (!d.blocks.length) throw {code: "empty"};
      app.status(`Ready. Press Translate to put this into ${app.to().name}.` + (d.notes.length ? " " + d.notes.join(" ") : ""));
    } catch (e){
      if (mine === gen){ stopped = e; fail(e); }
    } finally {
      await ocr.end();
      if (mine === gen) state(false);
    }
  }

  async function show(){
    result = await doc.build(target);
    await doc.preview($("#docAfter"), result);
  }
  function summary(){
    const notes = [...doc.notes];
    if (doc.fieldsLeft) notes.push(`${doc.fieldsLeft} filled-in form field${doc.fieldsLeft > 1 ? "s" : ""} couldn't hold the translation and kept the original words.`);
    if (doc.shrunk) notes.push(`${doc.shrunk} longer phrase${doc.shrunk > 1 ? "s were" : " was"} set smaller to fit.`);
    if (doc.usedOcr) notes.push("Words were read from a picture, so check them with Edit wording.");
    return notes.length ? " " + notes.join(" ") : "";
  }

  async function translate(){
    if (busy) return;
    if (!doc || (doc.usedOcr && readWith !== app.from())){
      await analyse();
      // A language pack can only start downloading straight after a click, so wait for the next one.
      if (stopped || !doc || navigator.userActivation?.isActive === false) return;
    }
    if (!doc.blocks.length) return fail({code: "empty"});
    const mine = gen, signal = app.begin();
    reset(); state(true);
    for (const b of doc.blocks) b.out = null;
    target = app.to();
    let error = null, done = 0;
    try {
      const job = await app.translator(doc.blocks.map(b => join(b.spans)).join("\n"), signal);
      if (job.same){ app.status(`This file is already in ${target.name}.`); return; }
      let next = 0;
      const work = async () => {
        while (next < doc.blocks.length && !error && mine === gen){
          const b = doc.blocks[next++];
          try { b.out = await IP.translateSpans(b.spans, job.tr); }
          catch (e){ error ||= e; return; }
          app.progress(`Translating into ${target.name}`, ++done / doc.blocks.length);
        }
      };
      await Promise.all(Array.from({length: job.concurrency}, work));
      job.finish();
      if (mine !== gen) return;
      if (!done) throw error;
      app.status("Putting the words back in place", true);
      await show();
      if (error){
        const why = app.errors[error.code] || "Translation was interrupted.";
        app.status(`Only ${done} of ${doc.blocks.length} passages were translated; the rest are still in the original language. ${why}`, false, true);
      } else app.status(`Done. Translated into ${target.name}.${summary()}`);
    } catch (e){
      if (mine === gen) fail(e);
    } finally {
      if (mine === gen) state(false);
    }
  }

  $("#docEdit").addEventListener("click", () => {
    const box = $("#docEditor"), open = box.hidden;
    box.hidden = !open; $("#docEdit").setAttribute("aria-expanded", open);
    if (!open) return;
    $("#docFields").replaceChildren(...doc.blocks.map((b, i) => {
      const row = document.createElement("label"), from = document.createElement("span"), t = document.createElement("textarea");
      row.className = "doc-field"; from.textContent = join(b.spans);
      t.value = join(b.out || b.spans); t.dataset.i = i; t.rows = Math.min(4, Math.ceil(t.value.length / 55) || 1);
      row.append(from, t);
      return row;
    }));
    box.scrollIntoView({block: "nearest"});
  });
  $("#docApply").addEventListener("click", async () => {
    if (busy || !doc) return;
    for (const t of $("#docFields").querySelectorAll("textarea")){
      const b = doc.blocks[t.dataset.i], v = t.value.replace(/\s+/g, " ").trim();
      if (v === join(b.out || b.spans)) continue;
      // Emptying a field, or retyping the original, leaves that passage untouched.
      b.out = !v || v === join(b.spans) ? null : [{text: v, style: b.spans.reduce((a, c) => c.text.length > a.text.length ? c : a).style}];
    }
    state(true);
    try { await show(); app.status(`Wording updated.${summary()}`); }
    catch (e){ fail(e); }
    finally { state(false); }
  });
  $("#docDownload").addEventListener("click", () => {
    if (!result) return;
    const ext = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[result.type] || "docx";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(result);
    a.download = `${file.name.replace(/\.[^.]+$/, "")}-${target.code}.${ext}`;
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });

  function close(){
    gen++; app.stop();
    doc?.close(); doc = file = null; reset(); state(false);
    $("#docView").hidden = true; $("#textView").hidden = false;
    app.status("");
  }
  $("#docClose").addEventListener("click", close);

  return {
    active: () => !!file,
    close, translate,
    open(f){
      file = f; kind = IP.kindOf(f);
      $("#docName").textContent = f.name;
      $("#textView").hidden = true; $("#docView").hidden = false;
      $("#docBefore").replaceChildren();
      return analyse();
    },
  };
};
})();
