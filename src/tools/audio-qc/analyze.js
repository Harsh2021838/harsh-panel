// Audio QC: from the clips (jsx/audio-qc.jsx prDump) and what each file sounds like (listen.js),
// rebuild the timeline's sound and find what would spoil the final render:
//   distortion: a clip or the mix going over 0 dB
//   cover:      music or an SFX loud enough to cover the voice while someone talks
//   sfx:        SFX much louder or quieter than the others (or than the same sound elsewhere)
//   click:      sound that starts or stops abruptly at a cut, with no fade (a pop)
// Track volume in the Audio Track Mixer and the master fader aren't visible to scripts, so the
// clip volumes (level, keyframes, fades) are what's measured.
export const VIDEO_FILE = /\.(mp4|mov|mxf|m4v|avi|mts|m2ts|mpg|mpeg|wmv|webm|mkv|r3d|braw|crm|3gp)$/i;
const VOICE_NAME = /\b(vo|voice|voiceover|dialog(ue)?|interview|narrat|podcast|mic|lav|talk|speech|host|zoom|rode|tascam|zh\d|dji)\b|^(audio|rec|record)/i;
const MUSIC_NAME = /music|\bbgm\b|song|\bes_|epidemic|artlist|soundstripe|musicbed|audiojungle|instrumental|\bscore\b|\bbeat\b|lofi|lo-fi|ambient|cinematic/i;
const SFX_NAME = /sfx|whoosh|swoosh|swish|\bhit\b|impact|riser|click|\bpop\b|ding|boom|swipe|typing|notification|\bbell\b|shutter|glitch|transition|thud|sweep|stinger|\bfx\b/i;
const TRACK_VOICE = /dialog|voice|\bvo\b|\bmic\b|speech|narrat/i, TRACK_MUSIC = /music|bgm|song|score/i, TRACK_SFX = /sfx|\bfx\b|effects?/i;

export const ROLE_NAMES = { voice: "Voice", sfx: "SFX", music: "Music", skip: "Skip" };

/** Guess what each audio track holds: { trackIndex: "voice" | "sfx" | "music" }. */
export function detectRoles(dump) {
  const roles = {};
  for (const T of dump.tracks) {
    if (!T.clips.length) continue;
    const total = T.clips.reduce((s, c) => s + (c.end - c.start), 0) || 1;
    const frac = (re) => T.clips.reduce((s, c) => s + (re.test(c.name) || re.test(c.path.split(/[\\/]/).pop()) ? c.end - c.start : 0), 0) / total;
    const video = T.clips.reduce((s, c) => s + (VIDEO_FILE.test(c.path) ? c.end - c.start : 0), 0) / total;
    const lens = T.clips.map((c) => c.end - c.start).sort((a, b) => a - b), median = lens[lens.length >> 1];
    let role;
    if (TRACK_VOICE.test(T.name)) role = "voice";
    else if (TRACK_MUSIC.test(T.name)) role = "music";
    else if (TRACK_SFX.test(T.name)) role = "sfx";
    else if (video >= 0.5 || frac(VOICE_NAME) >= 0.5) role = "voice";
    else if (frac(MUSIC_NAME) >= 0.4 || median >= 20) role = "music";
    else if (median < 8 || frac(SFX_NAME) >= 0.3) role = "sfx";
    else role = "music";
    roles[T.index] = role;
  }
  return roles;
}

const db10 = (x) => (x > 1e-12 ? 10 * Math.log10(x) : -120);
const db20 = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -120);
const fmt = (d) => (d > 0 ? "+" : "") + d.toFixed(1) + " dB";

/** The clip's volume in dB at `rel` seconds into it: level/keyframes plus transition fades. */
export function gainDb(c, rel) {
  let g = c.db || 0;
  const k = c.keys;
  if (k && k.length) {
    if (rel <= k[0][0]) g = k[0][1];
    else if (rel >= k[k.length - 1][0]) g = k[k.length - 1][1];
    else for (let i = 1; i < k.length; i++) if (rel <= k[i][0]) { const sp = k[i][0] - k[i - 1][0] || 1; g = k[i - 1][1] + (k[i][1] - k[i - 1][1]) * (rel - k[i - 1][0]) / sp; break; }
  }
  const len = c.end - c.start;
  if (c.fadeIn > 0 && rel < c.fadeIn) g += db20(Math.sin((Math.PI / 2) * Math.max(0, rel) / c.fadeIn));
  if (c.fadeOut > 0 && rel > len - c.fadeOut) g += db20(Math.sin((Math.PI / 2) * Math.max(0, len - rel) / c.fadeOut));
  return Math.max(-120, g);
}

/** The edges listen() should measure for each file: { path: [{ t, side }] }, and the ranges. */
export function wants(dump, roles) {
  const out = {};
  for (const T of dump.tracks) {
    if (!roles[T.index] || roles[T.index] === "skip") continue;
    for (const c of T.clips) {
      const w = out[c.path] || (out[c.path] = { ranges: [], edges: [] });
      w.ranges.push([c.inS, c.outS]);
      w.edges.push({ t: c.inS, side: "start" }, { t: c.outS, side: "end" });
    }
  }
  return out;
}

/**
 * dump: from prDump. envs: { path: listen() result | { error } }. roles: from detectRoles (maybe edited).
 * opts: { checks: { distortion, cover, sfx, click }, musicGap (dB), sfxSpread (dB) }
 */
export function analyze(dump, envs, roles, opts) {
  const HOP = 0.05, t0 = dump.inS, N = Math.max(1, Math.ceil((dump.outS - dump.inS) / HOP));
  const pow = { voice: new Float64Array(N), music: new Float64Array(N), sfx: new Float64Array(N) };
  const pSum = new Float64Array(N), pSq = new Float64Array(N);
  const issues = [], keys = new Map(), frame = 1 / (dump.fps || 25);
  const checks = opts.checks;
  const add = (it) => {
    const base = it.kind + "|" + it.track + "|" + it.name + "|" + (it.inS === undefined ? "" : Math.round(it.inS * 10)) + "|" + (it.other || "");
    const n = keys.get(base) || 0; keys.set(base, n + 1);
    it.key = n ? base + "#" + n : base;
    issues.push(it);
  };
  const clips = [];
  for (const T of dump.tracks) {
    const role = roles[T.index];
    if (!role || role === "skip") continue;
    for (const c of T.clips) clips.push({ ...c, track: T.index, trackName: "A" + (T.index + 1), role });
  }

  // ---- rebuild the timeline's sound, hop by hop
  for (const c of clips) {
    const env = envs[c.path];
    c.series = [];
    if (!env || env.error) { c.unread = true; continue; }
    const h0 = Math.max(0, Math.floor((c.start - t0) / HOP)), h1 = Math.min(N, Math.ceil((c.end - t0) / HOP));
    let maxPk = 0, maxAt = c.start;
    for (let h = h0; h < h1; h++) {
      const t = t0 + (h + 0.5) * HOP;
      if (t < c.start || t >= c.end) continue;
      const rel = t - c.start, idx = Math.floor((c.inS + rel) / env.hop);
      const ms = env.ms[idx], pk = env.pk[idx];
      if (!(ms >= 0)) continue;
      const g = Math.pow(10, gainDb(c, rel) / 20), p = ms * g * g, k = pk * g;
      pow[c.role][h] += p; pSum[h] += k; pSq[h] += k * k;
      c.series.push([h, p]);
      if (k > maxPk) { maxPk = k; maxAt = t; }
    }
    c.maxPk = maxPk; c.maxAt = maxAt;
  }

  // ---- distortion: a clip over 0 dB, or the mix adding up to over 0 dB
  if (checks.distortion) {
    const hot = new Uint8Array(N);
    for (const c of clips) {
      if (c.unread || !(c.maxPk > 1.0)) continue;
      add({ kind: "clip", t: c.maxAt, track: c.track, trackName: c.trackName, i: c.i, start: c.start, name: c.name, inS: c.inS, value: db20(c.maxPk),
        what: "Too loud: peaks at " + fmt(db20(c.maxPk)), detail: "“" + c.name + "” goes over 0 dB, so it will distort in the render. Turn its volume down by about " + Math.ceil(db20(c.maxPk) + 1) + " dB." });
      for (let h = Math.max(0, Math.floor((c.start - t0) / HOP)); h < Math.min(N, Math.ceil((c.end - t0) / HOP)); h++) hot[h] = 1;
    }
    let h = 0;
    while (h < N) {
      if (!(pSum[h] > 1.12 && Math.sqrt(pSq[h]) > 0.89) || hot[h]) { h++; continue; }
      let e = h, peak = 0;
      while (e < N && pSum[e] > 1.0 && !hot[e]) { peak = Math.max(peak, pSum[e]); e++; }
      const at = t0 + h * HOP;
      add({ kind: "mix", t: at, track: -1, trackName: "Mix", i: -1, start: at, name: "mix@" + Math.round(at), value: db20(peak),
        what: "Mix too loud: up to about " + fmt(db20(peak)), detail: "Several sounds play loud at once here and add up to over 0 dB, so it may distort. Lower the music or SFX here, or put a limiter on the mix." });
      h = e + 1;
    }
  }

  // ---- music or an SFX covering the voice
  const smooth = (arr, w) => { const out = new Float64Array(N); let s = 0; for (let i = 0; i < N; i++) { s += arr[i]; if (i >= w) s -= arr[i - w]; out[i] = s / Math.min(i + 1, w); } return out; };
  const hasVoice = clips.some((c) => c.role === "voice" && !c.unread);
  if (checks.cover && hasVoice) {
    // Levels over 2 seconds for voice against music (a pause between words isn't a problem),
    // 100 ms for SFX, which are short.
    const v = smooth(pow.voice, 40), m = smooth(pow.music, 40), vs = smooth(pow.voice, 8), s = smooth(pow.sfx, 2);
    const talking = (h) => db10(v[h]) > -40;
    const tooLoud = (h) => talking(h) && pow.music[h] > 0 && db10(m[h]) > db10(v[h]) - opts.musicGap;
    // music: needs to stay musicGap dB under the voice; stretches less than 2 s apart are one
    let h = 0;
    while (h < N) {
      if (!tooLoud(h)) { h++; continue; }
      let e = h, worst = -99, quiet = 0;
      while (e < N && quiet < 40) {
        if (tooLoud(e)) { worst = Math.max(worst, db10(m[e]) - db10(v[e])); quiet = 0; } else quiet++;
        e++;
      }
      e -= quiet;
      if ((e - h) * HOP >= 1.0) {
        const at = t0 + h * HOP, c = loudestAt(clips, "music", h);
        add({ kind: "music", t: at, track: c ? c.track : -1, trackName: c ? c.trackName : "Music", i: c ? c.i : -1, start: c ? c.start : at, name: c ? c.name : "music", inS: c ? c.inS : 0, other: Math.round(at), value: worst,
          what: worst >= 0 ? "Music as loud as the voice" : "Music only " + Math.round(-worst) + " dB under the voice",
          detail: "For " + secs((e - h) * HOP) + (c ? " \u201C" + c.name + "\u201D" : " the music") + " is too close to the voice level, so words get lost. Keep music at least " + opts.musicGap + " dB under the voice (lower it about " + Math.ceil(worst + opts.musicGap) + " dB here)." });
      }
      h = e + 1;
    }
    // SFX: clearly louder than the voice while someone talks. One row per SFX.
    const seen = new Set();
    for (h = 0; h < N; h++) {
      if (!(talking(h) && db10(vs[h]) > -45 && pow.sfx[h] > 0 && db10(s[h]) > db10(vs[h]) + 3)) continue;
      const c = loudestAt(clips, "sfx", h);
      if (!c || seen.has(c)) continue;
      seen.add(c);
      let worst = -99;
      for (const [hh] of c.series) if (db10(vs[hh]) > -45) worst = Math.max(worst, db10(s[hh]) - db10(vs[hh]));
      add({ kind: "cover", t: t0 + h * HOP, track: c.track, trackName: c.trackName, i: c.i, start: c.start, name: c.name, inS: c.inS, value: worst,
        what: "SFX over the voice (" + fmt(worst) + ")", detail: "\u201C" + c.name + "\u201D is louder than the voice while someone is talking, so it covers the words. Turn it down about " + Math.ceil(worst + 3) + " dB, or move it off the words." });
    }
  }

  // ---- SFX levels: each SFX's loudest moment against the others
  if (checks.sfx) {
    const sfx = clips.filter((c) => c.role === "sfx" && !c.unread && c.series.length);
    for (const c of sfx) {
      let best = 0;
      for (let i = 0; i < c.series.length; i++) { let sum = 0, n = 0; for (let j = i; j < Math.min(c.series.length, i + 4); j++) { sum += c.series[j][1]; n++; } best = Math.max(best, sum / n); }
      c.loud = db10(best);
    }
    const audible = sfx.filter((c) => c.loud > -70);
    const med = (arr) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
    const byFile = {};
    audible.forEach((c) => (byFile[c.path] = byFile[c.path] || []).push(c));
    const flagged = new Set();
    // the same sound used at different levels
    for (const p in byFile) {
      const g = byFile[p]; if (g.length < 2) continue;
      const m = med(g.map((c) => c.loud));
      for (const c of g) {
        const d = c.loud - m;
        if (Math.abs(d) < 3) continue;
        flagged.add(c);
        add({ kind: "sfx", t: c.start, track: c.track, trackName: c.trackName, i: c.i, start: c.start, name: c.name, inS: c.inS, value: d,
          what: "Same SFX " + Math.round(Math.abs(d)) + " dB " + (d > 0 ? "louder" : "quieter"), detail: "“" + c.name + "” is used " + g.length + " times; here it's " + Math.round(Math.abs(d)) + " dB " + (d > 0 ? "louder" : "quieter") + " than its other uses." });
      }
    }
    // different sounds: compare each sound's usual level with the other sounds'
    const files = Object.keys(byFile);
    if (files.length >= 3) {
      const level = {}; files.forEach((p) => { level[p] = med(byFile[p].map((c) => c.loud)); });
      const m = med(files.map((p) => level[p]));
      for (const p of files) {
        const d = level[p] - m;
        if (Math.abs(d) < opts.sfxSpread) continue;
        const g = byFile[p].filter((c) => !flagged.has(c)), c = g[0];
        if (!c) continue;
        add({ kind: "sfx", t: c.start, track: c.track, trackName: c.trackName, i: c.i, start: c.start, name: c.name, inS: c.inS, value: d,
          what: "SFX " + Math.round(Math.abs(d)) + " dB " + (d > 0 ? "louder" : "quieter") + " than the rest",
          detail: "\u201C" + c.name + "\u201D" + (g.length > 1 ? " (used " + g.length + " times)" : "") + " is " + Math.round(Math.abs(d)) + " dB " + (d > 0 ? "louder" : "quieter") + " than your other SFX, which mostly sit around " + Math.round(m) + " dB." });
      }
    }
  }

  // ---- clicks: sound that starts or stops hard at a cut
  if (checks.click) {
    const byTrack = {};
    clips.forEach((c) => (byTrack[c.track] = byTrack[c.track] || []).push(c));
    const LOUD = -30;
    const edgeDb = (c, side) => {
      const env = envs[c.path]; if (!env || env.error) return null;
      const v = env.edges[Math.round((side === "start" ? c.inS : c.outS) * 1000) + side[0]];
      if (v === undefined) return null;
      return v + gainDb(c, side === "start" ? 0.0005 : c.end - c.start - 0.0005);
    };
    const softEdge = (c, side) => {
      if (side === "start" ? c.fadeIn > 0.004 : c.fadeOut > 0.004) return true;
      // the file's own first or last sound was made that way (an SFX that starts on its hit)
      const env = envs[c.path];
      if (side === "start" && c.inS < 0.02) return true;
      if (side === "end" && env && env.duration && c.outS > env.duration - 0.03) return true;
      const len = c.end - c.start, a = side === "start" ? 0 : len, b = side === "start" ? Math.min(len, 0.06) : Math.max(0, len - 0.06);
      return gainDb(c, a) < gainDb(c, b) - 6 || gainDb(c, a) < -40;
    };
    for (const tr in byTrack) {
      const list = byTrack[tr].sort((a, b) => a.start - b.start);
      for (let i = 0; i < list.length; i++) {
        const c = list[i], prev = list[i - 1], next = list[i + 1];
        const touchesPrev = prev && Math.abs(prev.end - c.start) < frame / 2;
        const touchesNext = next && Math.abs(next.start - c.end) < frame / 2;
        if (touchesPrev) {
          if (prev.path === c.path && Math.abs(prev.outS - c.inS) < frame) continue; // the same sound carries on
          if (softEdge(prev, "end") || softEdge(c, "start")) continue;
          const a = edgeDb(prev, "end"), b = edgeDb(c, "start");
          if (a === null || b === null || Math.max(a, b) < LOUD) continue;
          add({ kind: "click", t: c.start, track: c.track, trackName: c.trackName, i: c.i, start: c.start, name: c.name, inS: c.inS, other: prev.name, value: Math.max(a, b),
            what: "Hard cut in the sound", detail: "“" + prev.name + "” cuts straight into “" + c.name + "” with sound on both sides, which can click. Add a short audio crossfade (a few frames) on the cut." });
        } else if (!softEdge(c, "start")) {
          const b = edgeDb(c, "start");
          if (b !== null && b >= LOUD) add({ kind: "click", t: c.start, track: c.track, trackName: c.trackName, i: c.i, start: c.start, name: c.name, inS: c.inS, other: "in", value: b,
            what: "Sound starts abruptly", detail: "“" + c.name + "” starts in the middle of a sound, which can pop. Add a short fade in." });
        }
        if (!touchesNext && !softEdge(c, "end")) {
          const a = edgeDb(c, "end");
          if (a !== null && a >= LOUD) add({ kind: "click", t: c.end - 0.04, track: c.track, trackName: c.trackName, i: c.i, start: c.start, name: c.name, inS: c.inS, other: "out", value: a,
            what: "Sound stops abruptly", detail: "“" + c.name + "” is cut off in the middle of a sound, which can pop. Add a short fade out." });
        }
      }
    }
  }

  const unread = clips.filter((c) => c.unread);
  issues.sort((a, b) => a.t - b.t);
  return { issues, unread: [...new Set(unread.map((c) => c.path))], hasVoice, clips: clips.length };
}

function loudestAt(clips, role, h) {
  let best = null, bp = 0;
  for (const c of clips) {
    if (c.role !== role || !c.series) continue;
    for (const [hh, p] of c.series) if (hh === h && p > bp) { bp = p; best = c; }
  }
  return best;
}
function secs(s) { return s >= 60 ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : s.toFixed(1) + " s"; }
