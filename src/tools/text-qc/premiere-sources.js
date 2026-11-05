// Turns what Premiere reports into one flat list of on-screen texts:
// titles/MOGRTs (already text), After Effects comps (read from their .aep),
// and caption files (.srt / .vtt).
import { readAep, compTexts, allTexts } from "./aep-reader.js";
import { fs, pathMod } from "./engine.js";
import { readDynamicLinks } from "./prproj-reader.js";

/** HH:MM:SS:FF for a time in seconds. */
export function timecode(sec, fps) {
  const f = Math.round(fps || 25);
  let frames = Math.max(0, Math.round((sec || 0) * (fps || 25)));
  const ff = frames % f; frames = (frames - ff) / f;
  const ss = frames % 60; frames = (frames - ss) / 60;
  const mm = frames % 60; const hh = (frames - mm) / 60;
  const p = (n) => (n < 10 ? "0" : "") + n;
  return p(hh) + ":" + p(mm) + ":" + p(ss) + ":" + p(ff);
}

function toSec(t) {
  const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(t);
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +("0." + m[4]);
}

/** Cues from an .srt or .vtt file: [{ n, start, text }] */
export function parseCaptions(raw) {
  const cues = [];
  const blocks = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim() !== "");
    const ti = lines.findIndex((l) => l.indexOf("-->") !== -1);
    if (ti === -1) continue;
    const text = lines.slice(ti + 1).join("\n")
      .replace(/<[^>]+>/g, "")      // <i>, <b>, <font ...>
      .replace(/\{\\[^}]*\}/g, ""); // {\an8}
    if (!/\S/.test(text)) continue;
    cues.push({ n: cues.length + 1, start: toSec(lines[ti].split("-->")[0]), text });
  }
  return cues;
}

const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const samePath = (a, b) => !a || !b || norm(a) === norm(b) || pathMod.basename(a) === pathMod.basename(b);
function findByName(project, name) {
  const n = norm(name);
  if (!n) return null;
  for (const c of project.comps.values()) if (c.name === name) return c;
  for (const c of project.comps.values()) if (norm(c.name) === n) return c;
  return null;
}
/** Find a clip's link entries whether Premiere reports "Comp" or "Comp/File.aep". */
function lookupLink(links, clip) {
  const name = String(clip.itemName || clip.clipName || "");
  const file = pathMod.basename(clip.aepPath || "");
  const hit = links.get(name) || links.get(name + "/" + file);
  if (hit) return hit;
  const want = norm(name.replace(/\/[^/]*\.aep(\s.*)?$/i, ""));
  for (const [k, v] of links) if (norm(k.replace(/\/[^/]*\.aep(\s.*)?$/i, "")) === want) return v;
  return null;
}
// \\Project\\AE comps\\Comp 1/x.aep -> "AE comps" (the bin the clip sits in)
const binOf = (tree) => {
  const parts = String(tree || "").split("\\").filter(Boolean);
  return parts.length > 2 ? parts.slice(1, -1).join(" \u203A ") : parts.length ? "Top of the project" : "";
};
const compNameFor = (clip) => String(clip.itemName || clip.clipName || "").replace(/\/[^/]*\.aep(\s.*)?$/i, "").trim();

/**
 * @param pr       result of the host's prCollect
 * @param extra    caption file paths the user added by hand
 * @returns { items, stats: { titles, mogrts, comps, compLayers, captions }, warnings: [] }
 */
export function expandPremiere(pr, extra) {
  const items = [];
  const warnings = [];
  const fpsOf = (id) => (pr.fps && pr.fps[id]) || 25;
  const stats = { titles: 0, mogrts: 0, comps: 0, compLayers: 0, captions: 0 };

  for (const it of pr.items) {
    it.tc = timecode(it.time, fpsOf(it.containerId));
    it.kind = it.kind || "title";
    if (it.kind === "mogrt") stats.mogrts++; else stats.titles++;
    items.push(it);
  }

  // After Effects comps. Each .aep is read once. The saved .prproj tells us which comp each
  // clip really is (by After Effects id), even after comps are renamed in After Effects.
  const aeps = new Map();
  const readProject = (file) => {
    if (aeps.has(file)) return aeps.get(file);
    let project = null;
    try {
      if (!fs.existsSync(file)) warnings.push("Couldn\u2019t find " + pathMod.basename(file) + " (moved or renamed?), so its comps weren\u2019t checked.");
      else project = readAep(fs.readFileSync(file));
    } catch (e) { warnings.push("Couldn\u2019t read " + pathMod.basename(file) + ": " + e.message); }
    aeps.set(file, project);
    return project;
  };
  let links = null;
  if ((pr.aeClips || []).length && pr.projectPath) {
    try { links = readDynamicLinks(pr.projectPath); } catch (e) { links = null; }
  }
  const findComps = (project, clip) => {
    const byLink = links && lookupLink(links, clip);
    if (byLink) {
      // Prefer the After Effects id; fall back to the comp's current name from the link.
      for (const l of byLink) if (l.compId && project.comps.has(l.compId) && samePath(l.aepPath, clip.aepPath)) return [l.compId];
      for (const l of byLink) { const c = findByName(project, l.compName); if (c) return [c.id]; }
    }
    const c = findByName(project, compNameFor(clip));
    return c ? [c.id] : null;
  };
  const unmatched = new Map(); // aep path -> [{ clip, linkedTo }]
  for (const clip of pr.aeClips || []) {
    const project = readProject(clip.aepPath);
    if (!project) continue;
    const ids = findComps(project, clip);
    if (!ids) {
      if (!unmatched.has(clip.aepPath)) unmatched.set(clip.aepPath, []);
      const byLink = links && lookupLink(links, clip);
      const linkedTo = byLink && byLink.length ? byLink.map((l) => l.compName).filter(Boolean)[0] || "" : "";
      unmatched.get(clip.aepPath).push({ clip, linkedTo, saved: !!byLink });
      continue;
    }
    stats.comps++;
    compTexts(project, ids[0]).forEach((t, i) => {
      stats.compLayers++;
      items.push({
        ...clip, key: clip.key + ":ae:" + i, kind: "ae",
        layer: t.path.concat([t.layer]).join(" \u203A "),
        text: t.text, tc: timecode(clip.time, fpsOf(clip.containerId)),
        project: pathMod.basename(clip.aepPath),
      });
    });
  }
  // Clips we couldn't match: check their .aep once (not once per clip), without a timeline position.
  for (const [file, names] of unmatched) {
    const project = aeps.get(file);
    const seen = new Set(items.filter((x) => x.kind === "ae" && x.aepPath === file).map((x) => x.text));
    const rest = allTexts(project).filter((t) => !seen.has(t.text));
    rest.forEach((t, i) => {
      stats.compLayers++;
      items.push({ key: "aep:" + file + ":" + i, kind: "ae", project: pathMod.basename(file), aepPath: file,
        container: pathMod.basename(file), layer: t.path.concat([t.layer]).join(" \u203A "), text: t.text, time: 1e9 });
    });
    const clips = names.map(({ clip, linkedTo, saved }) => ({
      ...clip,
      name: compNameFor(clip),
      tc: timecode(clip.time, fpsOf(clip.containerId)),
      trackName: "V" + (Number(clip.track) + 1),
      bin: binOf(clip.binPath),
      why: !saved ? "Not in the saved project file yet. Save the Premiere project and check again."
        : linkedTo ? "Premiere links it to \u201C" + linkedTo + "\u201D, which isn\u2019t in " + pathMod.basename(file) + " any more (deleted, or the .aep was saved over)."
        : "Its comp isn\u2019t in " + pathMod.basename(file) + " any more.",
    }));
    warnings.push({
      text: plural(clips.length, "After Effects clip") + " couldn\u2019t be matched to a comp in " + pathMod.basename(file) +
        ". The rest of " + pathMod.basename(file) + " was still checked once; those results have no timecode. Check these by hand:",
      clips,
    });
  }

  // Captions: files in the project plus files added by hand.
  const files = new Map();
  (pr.captions || []).forEach((c) => files.set(c.path, c.name));
  (extra || []).forEach((p) => { if (!files.has(p)) files.set(p, pathMod.basename(p)); });
  for (const [file, label] of files) {
    let cues;
    try { cues = parseCaptions(fs.readFileSync(file, "utf8")); }
    catch (e) { warnings.push("Couldn’t read captions from " + pathMod.basename(file) + "."); continue; }
    cues.forEach((c) => {
      stats.captions++;
      items.push({
        key: "cap:" + file + ":" + c.n, kind: "caption", project: pr.project,
        container: label, layer: "Caption " + c.n, text: c.text,
        time: c.start, tc: timecode(c.start, 25).slice(0, 8),
      });
    });
  }
  return { items, stats, warnings };
}
