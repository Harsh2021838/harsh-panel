// Reads every text layer out of an After Effects .aep file, without After Effects.
//
// An .aep is a RIFX file (big-endian RIFF). Comps are LIST "Item" chunks
// (idta type 4), layers are LIST "Layr" chunks, and a text layer's Source Text
// lives in a LIST "btdk" holding a small PDF-like (COS) document whose
// ["1"]["1"][n]["0"]["0"] entries are the text, one per keyframe.
// Format notes: github.com/forticheprod/aep_parser (aep.ksy) and lottie-docs.

// Node's Buffer: a global in plain Node, reached through require() inside the Adobe panel.
const Buffer = (typeof window !== "undefined" && typeof window.require === "function" && window.require("buffer").Buffer) || globalThis.Buffer;

const ITEM_FOLDER = 1, ITEM_COMP = 4;
const LAYER_TEXT = 3;

// ------------------------------------------------------------------ RIFX
function readChunks(buf, start, end, out) {
  let p = start;
  while (p + 8 <= end) {
    const type = buf.toString("latin1", p, p + 4);
    let len = buf.readUInt32BE(p + 4);
    const dataStart = p + 8;
    if (dataStart + len > end) len = end - dataStart;
    const chunk = { type, start: dataStart, end: dataStart + len };
    if (type === "LIST" && len >= 4) {
      chunk.listType = buf.toString("latin1", dataStart, dataStart + 4);
      if (chunk.listType !== "btdk") {
        chunk.children = [];
        readChunks(buf, dataStart + 4, dataStart + len, chunk.children);
      }
    }
    out.push(chunk);
    p = dataStart + len + (len % 2);
  }
  return out;
}

const utf8 = (buf, c) => buf.toString("utf8", c.start, c.end).replace(/\0+$/, "");
const find = (list, type, listType) => list && list.find((c) => c.type === type && (!listType || c.listType === listType));

function findAll(list, pred, out = []) {
  if (!list) return out;
  for (const c of list) {
    if (pred(c)) out.push(c);
    else if (c.children) findAll(c.children, pred, out);
  }
  return out;
}

// ------------------------------------------------------------------- COS
function parseCos(buf, start, end) {
  let p = start;
  const isWs = (b) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0x00;
  const isDelim = (b) => isWs(b) || b === 0x2f || b === 0x28 || b === 0x29 || b === 0x3c || b === 0x3e || b === 0x5b || b === 0x5d || b === 0x25;

  function skip() {
    for (;;) {
      while (p < end && isWs(buf[p])) p++;
      if (p < end && buf[p] === 0x25) { while (p < end && buf[p] !== 0x0a) p++; continue; } // % comment
      return;
    }
  }
  function str() { // after "("
    const bytes = [];
    let depth = 0;
    while (p < end) {
      let b = buf[p++];
      if (b === 0x5c) { // backslash escape
        const n = buf[p++];
        const map = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c };
        if (map[n] !== undefined) bytes.push(map[n]);
        else if (n >= 0x30 && n <= 0x37) {
          let v = n - 0x30, k = 0;
          while (k < 2 && buf[p] >= 0x30 && buf[p] <= 0x37) { v = v * 8 + buf[p++] - 0x30; k++; }
          bytes.push(v & 0xff);
        } else if (n === 0x0d) { if (buf[p] === 0x0a) p++; } // line continuation
        else if (n !== 0x0a) bytes.push(n);
        continue;
      }
      if (b === 0x28) depth++;
      if (b === 0x29) { if (depth === 0) break; depth--; }
      bytes.push(b);
    }
    let raw = Buffer.from(bytes);
    if (raw[0] === 0xfe && raw[1] === 0xff) {
      raw = raw.subarray(2);
      const sw = Buffer.alloc(raw.length - (raw.length % 2));
      for (let i = 0; i + 1 < raw.length; i += 2) { sw[i] = raw[i + 1]; sw[i + 1] = raw[i]; }
      return sw.toString("utf16le");
    }
    if (raw[0] === 0xff && raw[1] === 0xfe) return raw.subarray(2).toString("utf16le");
    if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) raw = raw.subarray(3);
    return raw.toString("utf8");
  }
  function value() {
    skip();
    if (p >= end) return undefined;
    const b = buf[p];
    if (b === 0x3c && buf[p + 1] === 0x3c) { p += 2; return dict(); }
    if (b === 0x3c) { // <hex>
      p++; let s = p; while (p < end && buf[p] !== 0x3e) p++;
      const hex = buf.toString("latin1", s, p); p++;
      return Buffer.from(hex.replace(/\s/g, ""), "hex");
    }
    if (b === 0x5b) { p++; const a = []; for (;;) { skip(); if (p >= end || buf[p] === 0x5d) { p++; return a; } const v = value(); if (v === undefined) return a; a.push(v); } }
    if (b === 0x28) { p++; return str(); }
    if (b === 0x2f) { p++; const s = p; while (p < end && !isDelim(buf[p])) p++; return { name: buf.toString("latin1", s, p) }; }
    const s = p; while (p < end && !isDelim(buf[p])) p++;
    const word = buf.toString("latin1", s, p);
    if (p === s) { p++; return null; } // stray delimiter, skip it
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    const n = Number(word);
    return isNaN(n) ? word : n;
  }
  function dict() {
    const o = {};
    for (;;) {
      skip();
      if (p >= end) return o;
      if (buf[p] === 0x3e && buf[p + 1] === 0x3e) { p += 2; return o; }
      const k = value();
      if (!k || typeof k !== "object" || !("name" in k)) continue;
      o[k.name] = value();
    }
  }
  skip();
  if (buf[p] === 0x2f) return dict(); // top level is a bare dict body
  return value();
}

function textsFromBtdk(buf, chunk) {
  try {
    const cos = parseCos(buf, chunk.start + 4, chunk.end);
    const docs = cos && cos["1"] && cos["1"]["1"];
    if (!Array.isArray(docs)) return [];
    return docs.map((d) => (d && d["0"] && typeof d["0"]["0"] === "string" ? d["0"]["0"] : "")).filter((t) => /\S/.test(t));
  } catch (e) { return []; }
}

// ------------------------------------------------------------------ public
/**
 * Read an .aep file buffer. Returns
 *   { comps: Map<id, { id, name, layers: [{ index, name, enabled, guide, sourceId, isText, texts: [] }] }> }
 */
export function readAep(buf) {
  if (buf.toString("latin1", 0, 4) !== "RIFX") throw new Error("Not an After Effects project");
  const top = readChunks(buf, 12, Math.min(buf.length, 8 + buf.readUInt32BE(4)), []);
  const comps = new Map();
  const items = findAll(top, (c) => c.type === "LIST" && c.listType === "Item");
  // Items nest (folders contain items), so walk each folder's direct children too.
  const queue = items.slice();
  const seen = new Set();
  while (queue.length) {
    const it = queue.shift();
    if (seen.has(it)) continue;
    seen.add(it);
    const idta = find(it.children, "idta");
    if (!idta) continue;
    const type = buf.readUInt16BE(idta.start);
    const id = buf.readUInt32BE(idta.start + 16);
    if (type === ITEM_FOLDER) {
      findAll(it.children, (c) => c.type === "LIST" && c.listType === "Item").forEach((c) => queue.push(c));
      continue;
    }
    if (type !== ITEM_COMP) continue;
    const nameChunk = find(it.children, "Utf8");
    const comp = { id, name: nameChunk ? utf8(buf, nameChunk) : "Comp " + id, layers: [] };
    const layers = (it.children || []).filter((c) => c.type === "LIST" && c.listType === "Layr");
    layers.forEach((l, i) => {
      const ldta = find(l.children, "ldta");
      const nm = find(l.children, "Utf8");
      const layer = { index: i + 1, name: nm ? utf8(buf, nm) : "", enabled: true, guide: false, sourceId: 0, isText: false, texts: [] };
      if (ldta && ldta.end - ldta.start > 131) {
        layer.sourceId = buf.readUInt32BE(ldta.start + 40);
        layer.enabled = (buf[ldta.start + 39] & 1) === 1;
        layer.guide = (buf[ldta.start + 37] & 2) === 2;
        layer.isText = buf[ldta.start + 131] === LAYER_TEXT;
      }
      findAll(l.children, (c) => c.type === "LIST" && c.listType === "btdk").forEach((b) => {
        textsFromBtdk(buf, b).forEach((t) => layer.texts.push(t));
      });
      if (layer.texts.length) layer.isText = true;
      comp.layers.push(layer);
    });
    comps.set(id, comp);
  }
  return { comps };
}

/**
 * All text shown by one comp, including text inside its precomps.
 * Returns [{ path: ["Main", "Lower third"], layer, layerIndex, text, keyIndex }]
 */
export function compTexts(project, compNameOrId) {
  let root = null;
  for (const c of project.comps.values()) {
    if (c.id === compNameOrId || c.name === compNameOrId) { root = c; break; }
  }
  if (!root) return null;
  const out = [];
  (function walk(comp, path, depth) {
    if (depth > 20) return;
    for (const l of comp.layers) {
      if (l.guide) continue; // guide layers never render
      if (l.texts.length) {
        l.texts.forEach((t, k) => out.push({ path, comp: comp.name, layer: l.name || "Text " + l.index, layerIndex: l.index, text: t,
          keyIndex: l.texts.length > 1 ? k + 1 : 0, enabled: l.enabled }));
      } else if (l.sourceId && project.comps.has(l.sourceId)) {
        const sub = project.comps.get(l.sourceId);
        walk(sub, path.concat([sub.name]), depth + 1);
      }
    }
  })(root, [root.name], 0);
  return out;
}

/** Every text layer in every comp (for a whole-project check). */
export function allTexts(project) {
  const out = [];
  for (const comp of project.comps.values()) {
    for (const l of comp.layers) {
      l.texts.forEach((t, k) => out.push({ path: [comp.name], comp: comp.name, compId: comp.id, layer: l.name || "Text " + l.index, layerIndex: l.index, text: t, keyIndex: l.texts.length > 1 ? k + 1 : 0, enabled: l.enabled }));
    }
  }
  return out;
}
