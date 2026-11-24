// Pack: planning, lossless trimming, copying and the report. Runs in the panel (Node), not in Premiere.
import { nodeRequire } from "../../host.js";
const fs = nodeRequire("fs");
const path = nodeRequire("path");
const os = nodeRequire("os");
const cp = nodeRequire("child_process");

const TICKS = 254016000000;

const EXT = {
  video: ['mp4', 'mov', 'm4v', 'mxf', 'mts', 'm2ts', 'mkv', 'avi', 'webm', 'mpg', 'mpeg', '3gp', 'braw', 'r3d', 'crm', 'ari', 'insv'],
  audio: ['wav', 'mp3', 'aif', 'aiff', 'm4a', 'aac', 'flac', 'ogg', 'bwf'],
  graphics: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'psd', 'ai', 'eps', 'gif', 'svg', 'bmp', 'exr', 'dpx', 'webp', 'heic', 'tga', 'mogrt'],
  ae: ['aep', 'aepx'],
};
// Containers ffmpeg can stream-copy cleanly and Premiere reads back without fuss
const TRIMMABLE = ['mp4', 'mov', 'm4v'];
// Codecs where every frame is a keyframe: cut on the exact frame
const INTRA = ['prores', 'dnxhd', 'mjpeg', 'cfhd', 'v210', 'rawvideo', 'png', 'qtrle', 'hap', 'r210', 'v410'];
const IMAGE_SEQ_EXT = ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'exr', 'dpx', 'tga', 'bmp'];

function ext(p) { return path.extname(p).slice(1).toLowerCase(); }
function category(p) {
  const e = ext(p);
  if (EXT.video.includes(e)) return 'Footage';
  if (EXT.audio.includes(e)) return 'Audio';
  if (EXT.graphics.includes(e)) return 'Graphics';
  if (EXT.ae.includes(e)) return 'After Effects';
  return 'Other';
}

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}
function fmtTime(s) {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(2);
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + sec.padStart(5, '0');
}

// ---------- ffmpeg ----------
function findFFmpeg(extra) {
  const home = os.homedir();
  const dirs = [];
  if (extra) dirs.push(path.dirname(extra));
  dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
    '/Applications/Shutter Encoder.app/Contents/Resources/Library',
    path.join(home, 'Applications/Shutter Encoder.app/Contents/Resources/Library'),
    path.join(home, 'Shutter Encoder/Shutter Encoder.app/Contents/Resources/Library'));
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    dirs.push(path.join(pf, 'ffmpeg', 'bin'), 'C:\\ffmpeg\\bin', path.join(pf, 'Shutter Encoder', 'Library'));
    (process.env.PATH || '').split(';').forEach((d) => d && dirs.push(d));
  } else {
    (process.env.PATH || '').split(':').forEach((d) => d && dirs.push(d));
  }
  const exe = process.platform === 'win32' ? '.exe' : '';
  for (const d of dirs) {
    const ff = path.join(d, 'ffmpeg' + exe), fp = path.join(d, 'ffprobe' + exe);
    if (fs.existsSync(ff) && fs.existsSync(fp)) return { ffmpeg: ff, ffprobe: fp };
  }
  return null;
}

function run(bin, args, signal) {
  return new Promise((resolve) => {
    const p = cp.spawn(bin, args);
    if (signal) signal.child = p;
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    p.on('close', (code) => { if (signal && signal.child === p) signal.child = null; resolve({ code, out, err }); });
  });
}

async function probe(ff, file) {
  const r = await run(ff.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.code !== 0) return null;
  try {
    const j = JSON.parse(r.out);
    const v = (j.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
    const dur = parseFloat((v && v.duration) || (j.format && j.format.duration) || '0');
    let fps = 0;
    if (v && v.r_frame_rate) { const [a, b] = v.r_frame_rate.split('/').map(Number); if (a && b) fps = a / b; }
    return {
      duration: dur,
      start: parseFloat((v && v.start_time) || '0') || 0,
      codec: v ? v.codec_name : null,
      fps,
      hasVideo: !!v,
    };
  } catch (e) { return null; }
}

// Latest keyframe at or before `rel` seconds (relative to the first frame)
async function keyframeBefore(ff, file, info, rel) {
  if (rel <= 0) return 0;
  if (INTRA.includes(info.codec) && info.fps) return Math.floor(rel * info.fps + 1e-6) / info.fps;
  for (const win of [30, 120, Infinity]) {
    const absTarget = info.start + rel;
    const from = win === Infinity ? 0 : Math.max(0, absTarget - win);
    const r = await run(ff.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey',
      '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', '-read_intervals', from + '%' + (absTarget + 0.5), file]);
    const kfs = r.out.split(/\s+/).map(parseFloat).filter((x) => !isNaN(x) && x <= absTarget + 1e-6);
    if (kfs.length) return Math.max(0, Math.max(...kfs) - info.start);
  }
  return 0;
}

// ---------- planning ----------
function imageSequence(p) {
  const e = ext(p);
  if (!IMAGE_SEQ_EXT.includes(e)) return null;
  const base = path.basename(p);
  const m = base.match(/^(.*?)(\d+)(\.[^.]+)$/);
  if (!m) return null;
  const [, prefix, digits, dotExt] = m;
  let names;
  try { names = fs.readdirSync(path.dirname(p)); } catch (e2) { return null; }
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\d{' + digits.length + '}' + dotExt.replace('.', '\\.') + '$', 'i');
  const frames = names.filter((n) => re.test(n)).sort();
  return frames.length > 1 ? { prefix: prefix.replace(/[_\-. ]+$/, '') || 'sequence', frames } : null;
}

function uniqueName(taken, dir, name) {
  const e = path.extname(name), b = path.basename(name, e);
  let n = name, i = 2;
  while (taken.has(path.join(dir, n).toLowerCase())) n = b + '_' + (i++) + e;
  taken.add(path.join(dir, n).toLowerCase());
  return n;
}

/**
 * items: [{name, path, bin, offline, used:{min,max,count,seqs}|null}] from host.jsx
 * opts: {handles, trim, organize, includeUnused}
 */
async function buildPlan(items, opts, ff, onProgress, signal) {
  // merge project items that point at the same file
  const byPath = new Map();
  for (const it of items) {
    let g = byPath.get(it.path);
    if (!g) { g = { path: it.path, names: [], used: null, offline: false }; byPath.set(it.path, g); }
    g.names.push(it.name);
    g.offline = g.offline || it.offline;
    if (it.used) {
      if (!g.used) g.used = { min: it.used.min, max: it.used.max, count: 0, seqs: [], spans: [] };
      if (it.used.spans) g.used.spans = g.used.spans.concat(it.used.spans).slice(0, 80);
      g.used.min = Math.min(g.used.min, it.used.min);
      g.used.max = Math.max(g.used.max, it.used.max);
      g.used.count += it.used.count;
      for (const s of it.used.seqs) if (!g.used.seqs.includes(s)) g.used.seqs.push(s);
    }
  }

  const plan = [];
  let i = 0;
  for (const g of byPath.values()) {
    if (signal && signal.stopped) throw new Error('Stopped.');
    onProgress && onProgress(++i, byPath.size, path.basename(g.path));
    const e = { src: g.path, name: path.basename(g.path), names: g.names, category: category(g.path), used: g.used, action: 'copy', size: 0, estSize: 0, note: '' };
    plan.push(e);

    const seq = imageSequence(g.path);
    if (!fs.existsSync(g.path)) { e.action = 'missing'; e.note = 'File not found on disk — left as is'; continue; }
    if (!g.used && !opts.includeUnused) { e.action = 'skip'; e.note = 'Not used in any sequence'; e.size = fs.statSync(g.path).size; continue; }

    if (seq) {
      e.action = 'sequence';
      e.frames = seq.frames;
      e.seqPrefix = seq.prefix;
      e.size = seq.frames.reduce((s, f) => { try { return s + fs.statSync(path.join(path.dirname(g.path), f)).size; } catch (x) { return s; } }, 0);
      e.estSize = e.size;
      e.note = seq.frames.length + ' frames';
      continue;
    }

    e.size = fs.statSync(g.path).size;
    e.estSize = e.size;
    if (!opts.trim || !g.used || e.category !== 'Footage' || !TRIMMABLE.includes(ext(g.path))) {
      if (opts.trim && g.used && e.category === 'Footage') e.note = '.' + ext(g.path) + ' is copied whole (not safe to stream-trim)';
      continue;
    }

    const info = await probe(ff, g.path);
    if (!info || !info.hasVideo || !info.duration) { e.note = 'Could not read with ffprobe — copied whole'; continue; }
    e.info = info;
    e.duration = info.duration;
    const h = Math.max(0, Number(opts.handles) || 0);
    const want0 = Math.max(0, g.used.min - h);
    const want1 = Math.min(info.duration, g.used.max + h);
    const kf = await keyframeBefore(ff, g.path, info, want0);
    const keep = want1 - kf;
    e.keepStart = kf; e.keepEnd = want1;
    if (keep / info.duration > 0.85) { e.note = 'Uses ' + Math.round(keep / info.duration * 100) + '% of the clip, copied whole'; continue; }
    e.action = 'trim';
    e.trimStart = kf;
    e.trimEnd = want1;
    e.estSize = Math.round(e.size * keep / info.duration);
    e.note = 'Keeps ' + fmtTime(kf) + ' \u2013 ' + fmtTime(want1) + ' of ' + fmtTime(info.duration);
  }
  return plan;
}

function summarize(plan) {
  const s = { files: plan.length, trim: 0, copy: 0, missing: 0, skip: 0, before: 0, after: 0 };
  for (const e of plan) {
    if (e.action === 'trim') s.trim++;
    else if (e.action === 'copy' || e.action === 'sequence') s.copy++;
    else if (e.action === 'missing') s.missing++;
    else if (e.action === 'skip') s.skip++;
    if (e.action !== 'missing' && e.action !== 'skip') { s.before += e.size; s.after += e.estSize; }
  }
  return s;
}

// ---------- execution ----------
async function execute(plan, root, opts, ff, onProgress, signal) {
  const mediaRoot = path.join(root, 'Media');
  const taken = new Set();
  const work = plan.filter((e) => ['trim', 'copy', 'sequence'].includes(e.action));
  const total = work.reduce((s, e) => s + (e.estSize || 1), 0) || 1;
  let n = 0, doneBytes = 0;
  for (const e of work) {
    if (signal && signal.stopped) throw new Error('Stopped. Files already written stay in the archive folder; your project was not changed.');
    onProgress && onProgress(++n, work.length, e.name, e.action, doneBytes / total);
    doneBytes += e.estSize || 1;
    const dir = opts.organize ? path.join(mediaRoot, e.category) : mediaRoot;
    fs.mkdirSync(dir, { recursive: true });

    try {
      if (e.action === 'sequence') {
        const sub = path.join(dir, uniqueName(taken, dir, e.seqPrefix + '_seq'));
        fs.mkdirSync(sub, { recursive: true });
        const srcDir = path.dirname(e.src);
        for (const f of e.frames) await fs.promises.copyFile(path.join(srcDir, f), path.join(sub, f));
        e.dest = path.join(sub, path.basename(e.src));
        e.finalSize = e.size;
        e.offsetTicks = 0;
        e.done = true;
        continue;
      }

      const outName = uniqueName(taken, dir, e.name);
      e.dest = path.join(dir, outName);

      if (e.action === 'trim') {
        const args = ['-hide_banner', '-nostdin', '-y', '-v', 'error',
          '-ss', e.trimStart.toFixed(6), '-i', e.src, '-t', (e.trimEnd - e.trimStart).toFixed(6),
          '-map', '0:v?', '-map', '0:a?', '-c', 'copy', '-map_metadata', '0',
          '-avoid_negative_ts', 'disabled', e.dest];
        const r = await run(ff.ffmpeg, args, signal);
        if (signal && signal.stopped) { try { fs.unlinkSync(e.dest); } catch (x) {} throw new Error('Stopped. Files already written stay in the archive folder; your project was not changed.'); }
        const check = r.code === 0 ? await probe(ff, e.dest) : null;
        const expected = e.trimEnd - e.trimStart;
        // video must start exactly at 0 so Premiere's clip times line up
        if (!check || !check.duration || check.duration < expected - 1.0 || Math.abs(check.start) > 0.001) {
          e.note += ' \u00b7 trim failed (' + (r.err.trim().split('\n').pop() || 'bad output') + '), copied whole instead';
          try { fs.unlinkSync(e.dest); } catch (x) {}
          e.action = 'copy';
        } else {
          e.offsetTicks = Math.round(e.trimStart * TICKS);
          e.finalSize = fs.statSync(e.dest).size;
          e.done = true;
          continue;
        }
      }

      await fs.promises.copyFile(e.src, e.dest);
      e.offsetTicks = 0;
      e.finalSize = e.size;
      e.done = true;
    } catch (err) {
      if (signal && signal.stopped) throw err;
      e.error = String(err.message || err);
      e.done = false;
    }
  }
  onProgress && onProgress(work.length, work.length, '', 'done', 1);
  return plan;
}

function relinkPlan(plan) {
  return plan.filter((e) => e.done).map((e) => ({ orig: e.src, newPath: e.dest, offsetTicks: e.offsetTicks || 0 }));
}

// ---------- report ----------
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function csvCell(s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

function writeReport(root, projectName, plan, packResult, opts) {
  const dir = path.join(root, 'Report');
  fs.mkdirSync(dir, { recursive: true });
  const done = plan.filter((e) => e.done);
  const before = done.reduce((s, e) => s + e.size, 0);
  const after = done.reduce((s, e) => s + (e.finalSize || 0), 0);
  const label = { trim: 'Trimmed', copy: 'Copied', sequence: 'Copied (sequence)', missing: 'Missing', skip: 'Not packed' };

  const rows = plan.map((e) => ({
    file: e.name, category: e.category, action: e.error ? 'Error' : label[e.action],
    before: e.size, after: e.done ? e.finalSize : '', note: e.error || e.note,
    sequences: e.used ? e.used.seqs.join(', ') : '', src: e.src, dest: e.dest || '',
  }));

  const csv = [['File', 'Category', 'Action', 'Original bytes', 'Archive bytes', 'Used in', 'Note', 'Original path', 'Archive path']]
    .concat(rows.map((r) => [r.file, r.category, r.action, r.before, r.after, r.sequences, r.note, r.src, r.dest]))
    .map((r) => r.map(csvCell).join(',')).join('\n');
  fs.writeFileSync(path.join(dir, 'report.csv'), csv);

  const pr = packResult || {};
  const problems = [];
  if (pr.error) problems.push(pr.error);
  (pr.adjustFailed || []).forEach((f) => problems.push('Clip timing not updated: "' + f.clip + '" on ' + f.track + ' in "' + f.seq + '" — ' + f.reason));
  (pr.relinkFailed || []).forEach((f) => problems.push('Could not relink "' + f.name + '"' + (f.reason ? ' — ' + f.reason : '')));
  plan.filter((e) => e.action === 'missing').forEach((e) => problems.push('Missing on disk: ' + e.src));
  plan.filter((e) => e.error).forEach((e) => problems.push('Error with ' + e.name + ': ' + e.error));

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(projectName)} — Frameshift Pack report</title>
<style>body{font:13px/1.5 Archivo,-apple-system,Helvetica,sans-serif;background:#1b1b1b;color:#edebe6;margin:32px}h1{font-weight:600;color:#fff;margin:0}
.sub{color:#888;margin:4px 0 24px}.cards{display:flex;gap:12px;margin-bottom:24px}.c{background:#1c1c1e;border:1px solid #2c2c2e;border-radius:10px;padding:14px 18px}
.c b{display:block;font-size:22px;color:#fff}.c span{color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #262628;vertical-align:top}
th{color:#888;font-weight:500;text-transform:uppercase;font-size:10.5px;letter-spacing:.5px}td.n{text-align:right;white-space:nowrap}
.t{color:#f4d23c}.m,.e{color:#ff8a70}.s{color:#777}.p{background:#2a1c18;border:1px solid #553326;border-radius:10px;padding:12px 16px;margin-bottom:24px}
.p li{margin:3px 0}.ok{background:#16281e;border-color:#265a3a;color:#8fe0ad}code{color:#aaa;font-size:11px;word-break:break-all}</style></head><body>
<h1>${esc(projectName)}</h1><div class="sub">Packed ${esc(new Date().toLocaleString())} · handles ${esc(opts.handles)}s · ${opts.trim ? 'trim on' : 'trim off'}</div>
<div class="cards"><div class="c"><b>${fmtBytes(before)}</b><span>Original media</span></div><div class="c"><b>${fmtBytes(after)}</b><span>Archive media</span></div>
<div class="c"><b>${before ? Math.round((1 - after / before) * 100) : 0}%</b><span>Saved</span></div><div class="c"><b>${done.length}</b><span>Files packed</span></div>
<div class="c"><b>${pr.adjusted || 0}</b><span>Clips re-timed</span></div></div>
${problems.length ? '<div class="p"><b>Check these</b><ul>' + problems.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul></div>' : '<div class="p ok">Everything packed and relinked.</div>'}
<table><tr><th>File</th><th>Type</th><th>Action</th><th>Original</th><th>Archive</th><th>Used in</th><th>Note</th></tr>
${rows.map((r) => `<tr><td>${esc(r.file)}<br><code>${esc(r.src)}</code></td><td>${esc(r.category)}</td><td class="${r.action === 'Trimmed' ? 't' : r.action === 'Missing' ? 'm' : r.action === 'Error' ? 'e' : r.action === 'Not packed' ? 's' : ''}">${esc(r.action)}</td>
<td class="n">${fmtBytes(r.before)}</td><td class="n">${r.after === '' ? '—' : fmtBytes(r.after)}</td><td>${esc(r.sequences)}</td><td>${esc(r.note)}</td></tr>`).join('')}
</table></body></html>`;
  const htmlPath = path.join(dir, 'report.html');
  fs.writeFileSync(htmlPath, html);
  return { htmlPath, problems, before, after };
}

export { TICKS, findFFmpeg, probe, buildPlan, summarize, execute, relinkPlan, writeReport, fmtBytes, fmtTime, category };
