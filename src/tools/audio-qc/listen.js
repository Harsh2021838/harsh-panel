// Audio QC: listens to the files on the timeline and turns them into a loudness picture.
// Only the parts the timeline uses are read. Long camera files (MP4/MOV) and long WAVs are read
// straight from disk in pieces, so a 4 GB clip costs only its audio, never the whole file.
//
// listen(path, ranges, edges, onProgress) -> {
//   hop,            seconds per value
//   ms: Float32Array   mean square (mono) per hop, NaN where not read
//   pk: Float32Array   absolute peak per hop
//   edges: { "<ms>": dBFS }  level of the 10 ms right after (start edge) or before (end edge) each time
// }
export const HOP = 0.05;
// Node's Buffer (in the panel it comes from require; in tests it's global).
function Buf() { try { return (typeof window !== "undefined" && window.require && window.require("buffer").Buffer) || globalThis.Buffer; } catch (e) { return globalThis.Buffer; } }

let ctx = null;
function audioCtx() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; ctx = new C(); }
  return ctx;
}
const decodeAB = (ab) => new Promise((res, rej) => audioCtx().decodeAudioData(ab, res, rej));

// ---------------------------------------------------------------- whole-file decode
function wholeReader(fs, path) {
  let buf = null;
  return {
    async open() {
      const b = fs.readFileSync(path);
      buf = await decodeAB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      this.duration = buf.duration; this.sr = buf.sampleRate;
    },
    async read(t0, t1) {
      const sr = buf.sampleRate, s0 = Math.max(0, Math.floor(t0 * sr)), s1 = Math.min(buf.length, Math.ceil(t1 * sr));
      const chans = [];
      for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).subarray(s0, Math.max(s0, s1)));
      return { sr, t0: s0 / sr, chans };
    },
    close() { buf = null; },
  };
}

// ---------------------------------------------------------------- WAV straight from disk
function wavReader(fs, path) {
  let fd = -1, fmt = null, dataOff = 0, dataLen = 0;
  return {
    async open() {
      fd = fs.openSync(path, "r");
      const head = Buf().alloc(12); fs.readSync(fd, head, 0, 12, 0);
      if (head.toString("ascii", 0, 4) !== "RIFF" && head.toString("ascii", 0, 4) !== "RF64") throw new Error("not wav");
      let pos = 12;
      const size = fs.fstatSync(fd).size;
      while (pos + 8 <= size) {
        const h = Buf().alloc(8); fs.readSync(fd, h, 0, 8, pos);
        const id = h.toString("ascii", 0, 4); let len = h.readUInt32LE(4);
        if (id === "fmt ") {
          const f = Buf().alloc(Math.min(len, 40)); fs.readSync(fd, f, 0, f.length, pos + 8);
          let tag = f.readUInt16LE(0);
          fmt = { tag, ch: f.readUInt16LE(2), sr: f.readUInt32LE(4), align: f.readUInt16LE(12), bits: f.readUInt16LE(14) };
          if (tag === 0xfffe && f.length >= 26) fmt.tag = f.readUInt16LE(24);
        } else if (id === "data") {
          dataOff = pos + 8; dataLen = len === 0xffffffff || pos + 8 + len > size ? size - pos - 8 : len; break;
        }
        pos += 8 + len + (len & 1);
      }
      if (!fmt || !dataOff || (fmt.tag !== 1 && fmt.tag !== 3)) throw new Error("unsupported wav");
      this.sr = fmt.sr; this.duration = dataLen / fmt.align / fmt.sr;
    },
    async read(t0, t1) {
      const { sr, ch, align, bits, tag } = fmt;
      const f0 = Math.max(0, Math.floor(t0 * sr)), f1 = Math.min(Math.floor(dataLen / align), Math.ceil(t1 * sr));
      const n = Math.max(0, f1 - f0), raw = Buf().alloc(n * align);
      fs.readSync(fd, raw, 0, raw.length, dataOff + f0 * align);
      const chans = []; for (let c = 0; c < ch; c++) chans.push(new Float32Array(n));
      const bps = bits / 8;
      for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
        const o = i * align + c * bps; let v;
        if (tag === 3) v = bits === 64 ? raw.readDoubleLE(o) : raw.readFloatLE(o);
        else if (bits === 16) v = raw.readInt16LE(o) / 32768;
        else if (bits === 24) v = raw.readIntLE(o, 3) / 8388608;
        else if (bits === 32) v = raw.readInt32LE(o) / 2147483648;
        else v = (raw[o] - 128) / 128;
        chans[c][i] = v;
      }
      return { sr, t0: f0 / sr, chans };
    },
    close() { try { fs.closeSync(fd); } catch (e) {} },
  };
}

// ---------------------------------------------------------------- MP4 / MOV audio track
function boxes(buf, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p); const type = buf.toString("ascii", p + 4, p + 8); let hdr = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; }
    else if (size === 0) size = end - p;
    if (size < hdr) break;
    out.push({ type, start: p, body: p + hdr, end: Math.min(end, p + size) });
    p += size;
  }
  return out;
}
const child = (buf, box, type) => boxes(buf, box.body, box.end).find((b) => b.type === type);
function path(buf, box, types) { let b = box; for (const t of types) { b = b && child(buf, b, t); } return b; }

/** Reads `moov` from the file: top-level boxes are walked with small reads only. */
function readMoov(fs, fd, size) {
  let p = 0;
  const h = Buf().alloc(16);
  while (p + 8 <= size) {
    fs.readSync(fd, h, 0, 16, p);
    let len = h.readUInt32BE(0); const type = h.toString("ascii", 4, 8);
    if (len === 1) len = Number(h.readBigUInt64BE(8)); else if (len === 0) len = size - p;
    if (len < 8) break;
    if (type === "moov") {
      if (len > 200 * 1024 * 1024) throw new Error("moov too big");
      const b = Buf().alloc(len); fs.readSync(fd, b, 0, len, p);
      return b;
    }
    p += len;
  }
  throw new Error("no moov");
}
function esdsConfig(buf, esds) {
  let p = esds.body + 4; // version + flags
  function desc() {
    const tag = buf[p++]; let len = 0, b;
    do { b = buf[p++]; len = (len << 7) | (b & 0x7f); } while (b & 0x80);
    return { tag, len, start: p };
  }
  let d = desc(); if (d.tag !== 3) return null;
  p += 2; const flags = buf[p++];
  if (flags & 0x80) p += 2; if (flags & 0x40) p += 1 + buf[p]; if (flags & 0x20) p += 2;
  d = desc(); if (d.tag !== 4) return null;
  p += 13;
  d = desc(); if (d.tag !== 5) return null;
  return buf.slice(d.start, d.start + d.len);
}
function mp4Reader(fs, filePath) {
  let fd = -1, t = null;
  return {
    async open() {
      fd = fs.openSync(filePath, "r");
      const size = fs.fstatSync(fd).size;
      const moov = readMoov(fs, fd, size), root = { body: 8, end: moov.length };
      const traks = boxes(moov, root.body, root.end).filter((b) => b.type === "trak");
      for (const trak of traks) {
        const hdlr = path(moov, trak, ["mdia", "hdlr"]);
        if (!hdlr || moov.toString("ascii", hdlr.body + 8, hdlr.body + 12) !== "soun") continue;
        const mdhd = path(moov, trak, ["mdia", "mdhd"]);
        const v1 = moov[mdhd.body] === 1;
        const timescale = moov.readUInt32BE(mdhd.body + (v1 ? 20 : 12));
        const duration = v1 ? Number(moov.readBigUInt64BE(mdhd.body + 24)) : moov.readUInt32BE(mdhd.body + 16);
        const stbl = path(moov, trak, ["mdia", "minf", "stbl"]);
        const stsd = child(moov, stbl, "stsd");
        const entry = boxes(moov, stsd.body + 8, stsd.end)[0];
        const fmt = entry.type, eb = entry.body;
        const ver = moov.readUInt16BE(eb + 8);
        let ch = moov.readUInt16BE(eb + 16), bits = moov.readUInt16BE(eb + 18), sr = moov.readUInt32BE(eb + 24) >>> 16;
        let after = eb + 28 + (ver === 1 ? 16 : ver === 2 ? 36 : 0);
        let lpcmFloat = false, lpcmLE = false;
        if (ver === 2) {
          sr = Math.round(moov.readDoubleBE(eb + 32)); ch = moov.readUInt32BE(eb + 40);
          bits = moov.readUInt32BE(eb + 48); const fl = moov.readUInt32BE(eb + 52);
          lpcmFloat = !!(fl & 1); lpcmLE = !(fl & 2);
        }
        // sample tables
        const stsz = child(moov, stbl, "stsz"), stsc = child(moov, stbl, "stsc");
        const stco = child(moov, stbl, "stco") || child(moov, stbl, "co64"), co64 = stco.type === "co64";
        const fixed = moov.readUInt32BE(stsz.body + 4), count = moov.readUInt32BE(stsz.body + 8);
        const nChunks = moov.readUInt32BE(stco.body + 4);
        const chunkOff = new Float64Array(nChunks);
        for (let i = 0; i < nChunks; i++) chunkOff[i] = co64 ? Number(moov.readBigUInt64BE(stco.body + 8 + i * 8)) : moov.readUInt32BE(stco.body + 8 + i * 4);
        const nsc = moov.readUInt32BE(stsc.body + 4), sc = [];
        for (let i = 0; i < nsc; i++) sc.push([moov.readUInt32BE(stsc.body + 8 + i * 12) - 1, moov.readUInt32BE(stsc.body + 12 + i * 12)]);
        const perChunk = new Uint32Array(nChunks);
        for (let i = 0; i < sc.length; i++) { const end = i + 1 < sc.length ? sc[i + 1][0] : nChunks; for (let c = sc[i][0]; c < end; c++) perChunk[c] = sc[i][1]; }
        if (fmt === "mp4a") {
          const esds = boxes(moov, after, entry.end).find((b) => b.type === "esds") ||
            (boxes(moov, after, entry.end).find((b) => b.type === "wave") && boxes(moov, boxes(moov, after, entry.end).find((b) => b.type === "wave").body, entry.end).find((b) => b.type === "esds"));
          const asc = esds && esdsConfig(moov, esds);
          if (!asc) throw new Error("no AAC config");
          const aot = asc[0] >> 3, sfi = ((asc[0] & 7) << 1) | (asc[1] >> 7), cc = (asc[1] >> 3) & 15;
          const off = new Float64Array(count), sz = new Uint32Array(count);
          let s = 0;
          for (let c = 0; c < nChunks && s < count; c++) {
            let o = chunkOff[c];
            for (let k = 0; k < perChunk[c] && s < count; k++, s++) { sz[s] = fixed || moov.readUInt32BE(stsz.body + 12 + s * 4); off[s] = o; o += sz[s]; }
          }
          const srTab = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
          t = { kind: "aac", off, sz, count, aot: Math.min(aot, 4), sfi, cc: cc || ch, sr: srTab[sfi] || sr, dur: duration / timescale };
        } else {
          const bpsMap = { sowt: [16, true], twos: [16, false], in24: [24, false], in32: [32, false], fl32: [32, false, true], raw: [8, true] };
          let b = bits, le = true, fl = false;
          if (bpsMap[fmt]) { [b, le, fl] = bpsMap[fmt]; fl = !!fl; if (fmt === "in24" || fmt === "in32") le = false; }
          else if (fmt === "lpcm" || fmt === "ipcm") { le = lpcmLE; fl = lpcmFloat; }
          else throw new Error("audio format " + fmt);
          const frameBytes = ch * b / 8, chunkFirst = new Float64Array(nChunks);
          let f = 0;
          for (let c = 0; c < nChunks; c++) { chunkFirst[c] = f; f += perChunk[c]; }
          t = { kind: "pcm", chunkOff, chunkFirst, perChunk, frameBytes, bits: b, le, float: fl, ch, sr, dur: duration / timescale, frames: f };
        }
        this.sr = t.sr; this.duration = t.dur;
        return;
      }
      throw new Error("no audio track");
    },
    async read(t0, t1) {
      if (t.kind === "aac") {
        const fpp = 1024 / t.sr; // seconds per AAC packet
        const warm = 2; // packets decoded first and thrown away, so the decoder has settled
        const p0 = Math.max(0, Math.floor(t0 / fpp) - warm), p1 = Math.min(t.count, Math.ceil(t1 / fpp) + 1);
        if (p1 <= p0) return { sr: t.sr, t0, chans: [new Float32Array(0)] };
        let total = 0; for (let i = p0; i < p1; i++) total += t.sz[i] + 7;
        const out = Buf().alloc(total); let o = 0;
        for (let i = p0; i < p1; i++) {
          const len = t.sz[i] + 7;
          out[o] = 0xff; out[o + 1] = 0xf1;
          out[o + 2] = ((t.aot - 1) << 6) | (t.sfi << 2) | ((t.cc >> 2) & 1);
          out[o + 3] = ((t.cc & 3) << 6) | ((len >> 11) & 3);
          out[o + 4] = (len >> 3) & 0xff; out[o + 5] = ((len & 7) << 5) | 0x1f; out[o + 6] = 0xfc;
          fs.readSync(fd, out, o + 7, t.sz[i], t.off[i]);
          o += len;
        }
        const ab = await decodeAB(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
        const sr = ab.sampleRate, skip = Math.round(((p0 + (p0 > 0 ? warm : 0)) * fpp - p0 * fpp) * sr);
        const chans = []; for (let c = 0; c < ab.numberOfChannels; c++) chans.push(ab.getChannelData(c).subarray(skip));
        return { sr, t0: (p0 + (p0 > 0 ? warm : 0)) * fpp, chans };
      }
      // PCM: find the chunks covering the frames
      const f0 = Math.max(0, Math.floor(t0 * t.sr)), f1 = Math.min(t.frames, Math.ceil(t1 * t.sr));
      const n = Math.max(0, f1 - f0), chans = []; for (let c = 0; c < t.ch; c++) chans.push(new Float32Array(n));
      let c = 0; while (c + 1 < t.chunkFirst.length && t.chunkFirst[c + 1] <= f0) c++;
      let f = f0;
      while (f < f1 && c < t.chunkFirst.length) {
        const inChunk = f - t.chunkFirst[c], take = Math.min(t.perChunk[c] - inChunk, f1 - f);
        if (take > 0) {
          const raw = Buf().alloc(take * t.frameBytes);
          fs.readSync(fd, raw, 0, raw.length, t.chunkOff[c] + inChunk * t.frameBytes);
          const bps = t.bits / 8;
          for (let i = 0; i < take; i++) for (let k = 0; k < t.ch; k++) {
            const o = i * t.frameBytes + k * bps; let v;
            if (t.float) v = t.bits === 64 ? (t.le ? raw.readDoubleLE(o) : raw.readDoubleBE(o)) : (t.le ? raw.readFloatLE(o) : raw.readFloatBE(o));
            else if (t.bits === 16) v = (t.le ? raw.readInt16LE(o) : raw.readInt16BE(o)) / 32768;
            else if (t.bits === 24) v = (t.le ? raw.readIntLE(o, 3) : raw.readIntBE(o, 3)) / 8388608;
            else if (t.bits === 32) v = (t.le ? raw.readInt32LE(o) : raw.readInt32BE(o)) / 2147483648;
            else v = (raw[o] - 128) / 128;
            chans[k][f - f0 + i] = v;
          }
          f += take;
        }
        c++;
      }
      return { sr: t.sr, t0: f0 / t.sr, chans };
    },
    close() { try { fs.closeSync(fd); } catch (e) {} },
  };
}

const WHOLE_LIMIT = 300 * 1024 * 1024;
const VIDEO = /\.(mp4|mov|m4v|m4a|3gp)$/i;
async function openReader(fs, file) {
  const size = fs.statSync(file).size;
  const tries = [];
  if (/\.(wav|wave|bwf)$/i.test(file)) tries.push(wavReader);
  if (VIDEO.test(file)) tries.push(mp4Reader);
  if (size <= WHOLE_LIMIT) tries.push(wholeReader);
  let last = null;
  for (const make of tries) {
    const r = make(fs, file);
    try { await r.open(); return r; } catch (e) { last = e; r.close(); }
  }
  throw new Error(size > WHOLE_LIMIT ? "too big to listen to" : (last && last.message) || "can't read this file");
}

/** Merge [a, b] ranges (seconds) that touch or overlap. */
export function mergeRanges(ranges) {
  const r = ranges.filter((x) => x[1] > x[0]).map((x) => x.slice()).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const x of r) { const last = out[out.length - 1]; if (last && x[0] <= last[1] + 0.5) last[1] = Math.max(last[1], x[1]); else out.push(x); }
  return out;
}

export async function listen(fs, file, ranges, edges) {
  const r = await openReader(fs, file);
  try {
    const n = Math.ceil(r.duration / HOP) + 1;
    const ms = new Float32Array(n).fill(NaN), pk = new Float32Array(n).fill(NaN), edgeOut = {};
    const want = mergeRanges(ranges.map((x) => [Math.max(0, x[0] - HOP), Math.min(r.duration, x[1] + HOP)]));
    const edgeList = edges.slice().sort((a, b) => a.t - b.t);
    for (const [a, b] of want) {
      for (let s = a; s < b; s += 20) {
        const e = Math.min(b, s + 20);
        const seg = await r.read(s, e + 0.02);
        const sr = seg.sr, ch = seg.chans, len = ch[0] ? ch[0].length : 0;
        for (let h = Math.floor(s / HOP); h * HOP < e; h++) {
          const i0 = Math.round((h * HOP - seg.t0) * sr), i1 = Math.round(((h + 1) * HOP - seg.t0) * sr);
          if (i0 < 0 || i0 >= len) continue;
          let sum = 0, peak = 0, cnt = 0;
          for (let i = i0; i < Math.min(i1, len); i++) {
            let m = 0;
            for (let c = 0; c < ch.length; c++) { const v = ch[c][i]; m += v; const av = v < 0 ? -v : v; if (av > peak) peak = av; }
            m /= ch.length; sum += m * m; cnt++;
          }
          if (cnt) { ms[h] = sum / cnt; pk[h] = peak; }
        }
        for (const ed of edgeList) {
          if (ed.t < s || ed.t >= e) continue;
          const w = Math.round(0.01 * sr), at = Math.round((ed.t - seg.t0) * sr);
          const i0 = ed.side === "start" ? at : at - w, i1 = ed.side === "start" ? at + w : at;
          let sum = 0, cnt = 0;
          for (let i = Math.max(0, i0); i < Math.min(len, i1); i++) { for (let c = 0; c < ch.length; c++) sum += ch[c][i] * ch[c][i]; cnt += ch.length; }
          if (cnt) edgeOut[Math.round(ed.t * 1000) + ed.side[0]] = 10 * Math.log10(sum / cnt + 1e-12);
        }
        await new Promise((res) => setTimeout(res, 0)); // let the panel breathe
      }
    }
    return { hop: HOP, ms, pk, edges: edgeOut, duration: r.duration };
  } finally { r.close(); }
}
export const _test = { mp4Reader, wavReader };
