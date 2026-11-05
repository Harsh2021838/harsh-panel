// The Harsh Library: one folder that holds everything the panel saves, so you can
// choose where it lives (Settings), back it up, or share it on a team drive.
//
//   Harsh Library/
//     Clients/<Client name>/client.json    Client DNA: brand name, founder, website, colours, fonts, notes
//     Clients/<Client name>/<logo file>
//     Clients/<Client name>/Assets/         that client's assets
//     Clients/<Client name>/SFX/            (for the SFX tool)
//     Clients/<Client name>/Compositions/   (for saved, reusable comps)
//     Common/Assets/  Common/SFX/  Common/Compositions/   the same, for every client
//     Tools/<Tool name>/                    each tool's own data (Text QC: dictionary, reports)
//     _Removed/                             removed things go here instead of being deleted
//
// New tools: use clientDir(client, "SFX") / commonDir("SFX") for per-client data,
// and toolDir("My Tool") for the tool's own settings and files.
import { nodeRequire, makeHost } from "./host.js";

const fs = nodeRequire("fs");
const path = nodeRequire("path");
const info = makeHost("text-qc.jsx", "HarshTextQC");
export const lib = makeHost("harsh-library.jsx", "HarshLibrary");

const LS = "harsh.libraryDir";
let root = null;

export async function libraryDir() {
  if (root) return root;
  let saved = null;
  try { saved = localStorage.getItem(LS); } catch (e) {}
  if (saved && fs.existsSync(saved)) root = saved;
  else root = path.join((await info("info")).documents, "Harsh Library");
  ensure(root);
  ensure(path.join(root, "Clients"));
  ["Assets", "SFX", "Compositions"].forEach((k) => ensure(path.join(root, "Common", k)));
  ensure(path.join(root, "Tools"));
  // Libraries made by v2.3.0 kept common assets in "Common Assets".
  const old = path.join(root, "Common Assets");
  try {
    if (fs.existsSync(old)) {
      for (const n of fs.readdirSync(old)) {
        const to = path.join(root, "Common", "Assets", n);
        if (!fs.existsSync(to)) fs.renameSync(path.join(old, n), to);
      }
      if (!fs.readdirSync(old).length) fs.rmdirSync(old);
    }
  } catch (e) {}
  return root;
}
export function setLibraryDir(dir) {
  try { localStorage.setItem(LS, dir); } catch (e) {}
  root = null;
}
function ensure(dir) { try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) {} }

// Client folders use the client's name, minus characters Mac and Windows don't allow.
const slug = (s) => String(s || "Client").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "") || "Client";

/** A client's folder for one kind of data ("Assets", "SFX", "Compositions", ...). */
export function clientDir(client, kind) { const d = path.join(client.dir, kind); ensure(d); return d; }
/** The shared folder for one kind of data. */
export async function commonDir(kind) { const d = path.join(await libraryDir(), "Common", kind); ensure(d); return d; }
/** A tool's own folder, for its settings, dictionaries, reports. */
export async function toolDir(name) { const d = path.join(await libraryDir(), "Tools", name); ensure(d); return d; }

// ----------------------------------------------------------------- clients
export async function listClients() {
  const dir = path.join(await libraryDir(), "Clients");
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name, "client.json");
    if (!fs.existsSync(file)) continue;
    try {
      const c = JSON.parse(fs.readFileSync(file, "utf8"));
      c.id = name; c.dir = path.join(dir, name);
      out.push(c);
    } catch (e) {}
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function saveClient(c, logoSource) {
  const base = path.join(await libraryDir(), "Clients");
  let id = c.id;
  if (!id) {
    id = slug(c.name);
    let n = 2;
    while (fs.existsSync(path.join(base, id))) id = slug(c.name) + "-" + n++;
  }
  const dir = path.join(base, id);
  ensure(dir);
  ensure(path.join(dir, "Assets"));
  const data = {
    name: c.name || "", founder: c.founder || "", website: c.website || "",
    logo: c.logo || "", colors: (c.colors || []).filter((x) => x.hex), highlight: c.highlight && c.highlight.hex ? c.highlight : null,
    fonts: (c.fonts || []).filter((f) => f.name && f.name.trim()), notes: c.notes || "", updated: new Date().toISOString(),
  };
  if (logoSource) {
    const ext = path.basename(logoSource).split(".").pop().toLowerCase();
    data.logo = "logo." + ext;
    fs.copyFileSync(logoSource, path.join(dir, data.logo));
  }
  fs.writeFileSync(path.join(dir, "client.json"), JSON.stringify(data, null, 2), "utf8");
  return id;
}

export async function removeClient(c) {
  const removed = path.join(await libraryDir(), "_Removed");
  ensure(removed);
  fs.renameSync(c.dir, path.join(removed, c.id + "-" + Date.now()));
}

// ------------------------------------------------------------------ assets
const KINDS = [
  ["image", /\.(png|jpe?g|gif|webp|svg|psd|ai|tiff?|bmp|heic)$/i],
  ["video", /\.(mov|mp4|m4v|mxf|avi|webm|mkv|prores)$/i],
  ["audio", /\.(wav|mp3|aif|aiff|m4a|aac|flac|ogg)$/i],
  ["template", /\.(mogrt|aep|prproj|ffx)$/i],
];
export const kindOf = (file) => { for (const [k, re] of KINDS) if (re.test(file)) return k; return "other"; };
export const previewable = (file) => /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(file);

export async function assetsDir(client) {
  return client ? clientDir(client, "Assets") : commonDir("Assets");
}

/** Files in an assets folder (one level of sub-folders is shown as a group name). */
export async function listAssets(client) {
  const dir = await assetsDir(client);
  const out = [];
  const walk = (d, group, depth) => {
    for (const name of fs.readdirSync(d)) {
      if (name.charAt(0) === "." || name === "Thumbs.db") continue;
      const full = path.join(d, name);
      let st; try { st = fs.statSync(full); } catch (e) { continue; }
      if (st.isDirectory()) { if (depth < 3) walk(full, group ? group + " / " + name : name, depth + 1); continue; }
      out.push({ path: full, name, group, kind: kindOf(name), size: st.size, mtime: st.mtimeMs || 0 });
    }
  };
  walk(dir, "", 0);
  return out.sort((a, b) => (a.group || "").localeCompare(b.group || "") || a.name.localeCompare(b.name));
}

export async function addAssets(client, files) {
  const dir = await assetsDir(client);
  let added = 0;
  for (const f of files) {
    let name = path.basename(f), target = path.join(dir, name), n = 2;
    while (fs.existsSync(target)) {
      const dot = name.lastIndexOf(".");
      target = path.join(dir, (dot > 0 ? name.slice(0, dot) : name) + " " + n++ + (dot > 0 ? name.slice(dot) : ""));
    }
    fs.copyFileSync(f, target);
    added++;
  }
  return added;
}

export async function removeAsset(a) {
  const removed = path.join(await libraryDir(), "_Removed");
  ensure(removed);
  fs.renameSync(a.path, path.join(removed, Date.now() + " " + a.name));
}

// ------------------------------------------------------------------- helpers
/** URL an <img> can load for a local file. */
export function fileUrl(p) {
  if (window.__fileUrl) return window.__fileUrl(p);
  const s = String(p).replace(/\\/g, "/");
  return "file://" + (s.charAt(0) === "/" ? "" : "/") + encodeURI(s).replace(/#/g, "%23");
}

/** Copy text to the clipboard (works in the Adobe panel, where navigator.clipboard often doesn't). */
export function copyText(text) {
  try {
    const t = document.createElement("textarea");
    t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy");
    t.remove();
    if (ok) return true;
  } catch (e) {}
  try { navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}

/** Is a font installed on this computer? Compares text widths against fallback fonts. */
export function fontInstalled(name) {
  try {
    const c = document.createElement("canvas").getContext("2d");
    const sample = "mmmmmmmmmmlli1WQ@#";
    return ["monospace", "serif", "sans-serif"].some((fb) => {
      c.font = "72px " + fb; const a = c.measureText(sample).width;
      c.font = "72px \"" + name + "\", " + fb; const b = c.measureText(sample).width;
      return a !== b;
    });
  } catch (e) { return false; }
}

export function openUrl(url) {
  if (!url) return;
  const u = /^https?:\/\//i.test(url) ? url : "https://" + url;
  try { window.cep.util.openURLInDefaultBrowser(u); } catch (e) { window.open(u); }
}

export const hostOf = (url) => String(url || "").replace(/^https?:\/\//i, "").replace(/\/$/, "");
export const validHex = (h) => /^#?[0-9a-f]{6}$/i.test(String(h || "").trim());
export const normHex = (h) => { const s = String(h || "").trim().replace(/^#?/, "#").toUpperCase(); return validHex(s) ? s : ""; };
export function hexToRgb(h) { const n = parseInt(normHex(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
/** Black or white text on a colour, whichever reads better. */
export function inkOn(h) { const [r, g, b] = hexToRgb(h); return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#141414" : "#ffffff"; }
export { path };

// ---------------------------------------------------------- whole library
function copyDir(src, dst) {
  ensure(dst);
  for (const n of fs.readdirSync(src)) {
    const a = path.join(src, n), b = path.join(dst, n);
    if (fs.statSync(a).isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}
function stamp() {
  const d = new Date(), p = (n) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + "." + p(d.getMinutes());
}
function freeName(dir, name) {
  let out = path.join(dir, name), n = 2;
  while (fs.existsSync(out)) out = path.join(dir, name + " " + n++);
  return out;
}

/** What's in the library, for the Settings screen. */
export async function libraryStats() {
  const r = await libraryDir();
  let files = 0, bytes = 0;
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); const st = fs.statSync(f); if (st.isDirectory()) { if (n !== "_Removed") walk(f); } else { files++; bytes += st.size || 0; } } };
  try { walk(r); } catch (e) {}
  const clients = (await listClients()).length;
  return { dir: r, clients, files, mb: bytes / 1048576 };
}

/** Copy the whole library into a dated folder inside `dest`. */
export async function backupLibrary(dest) {
  const out = freeName(dest, "Harsh Library backup " + stamp());
  copyDir(await libraryDir(), out);
  return out;
}

/** Copy one client's folder (DNA, logo, assets, SFX, comps) into `dest`. */
export function exportClient(client, dest) {
  const out = freeName(dest, client.name);
  copyDir(client.dir, out);
  return out;
}

/** Bring in a client folder exported from another computer (it must contain client.json). */
export async function importClient(src) {
  if (!fs.existsSync(path.join(src, "client.json"))) throw new Error("That folder isn\u2019t a Harsh client. Choose the folder that has client.json inside.");
  const out = freeName(path.join(await libraryDir(), "Clients"), path.basename(src));
  copyDir(src, out);
  return path.basename(out);
}

/** Does this folder already hold a Harsh Library? */
export function looksLikeLibrary(dir) { return fs.existsSync(path.join(dir, "Clients")) || fs.existsSync(path.join(dir, "Common")); }

/**
 * Point the panel at another folder.
 *   mode "use":  the folder already is a library (or should start empty)
 *   mode "copy": copy the current library into <dir>/Harsh Library and use that
 * The old folder is left untouched.
 */
export async function moveLibrary(dir, mode) {
  let target = dir;
  if (mode === "copy") {
    target = path.basename(dir) === "Harsh Library" ? dir : freeName(dir, "Harsh Library");
    copyDir(await libraryDir(), target);
  }
  setLibraryDir(target);
  return libraryDir();
}
