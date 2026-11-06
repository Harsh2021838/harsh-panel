// Installs a newer Frameshift (formerly Harsh) from a zip (the Frameshift-x_y_z.zip the build makes),
// either picked by hand or found in the library's Updates folder.
//
// Steps: read the zip -> find com.harsh.panel/ inside -> check its version -> copy the
// installed panel to _Removed as a backup -> write the new files over it -> reload.
import { nodeRequire, extensionPath } from "./host.js";
import { libraryDir } from "./library.js";

const fs = nodeRequire("fs");
const path = nodeRequire("path");
const zlib = nodeRequire("zlib");
const Buffer = nodeRequire("buffer").Buffer;

export const MODE_KEY = "harsh.updates"; // "auto" | "ask"
export function updateMode() { try { return localStorage.getItem(MODE_KEY) || "ask"; } catch (e) { return "ask"; } }
export function setUpdateMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) {} }

export function compareVersions(a, b) {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
  return 0;
}

// ------------------------------------------------------------------- zip
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That isn’t a zip file.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("The zip file is damaged.");
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({ name, method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    entries,
    read(e) {
      const lh = e.local;
      const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
      const data = buf.subarray(start, start + e.size);
      if (e.method === 0) return data;
      if (e.method === 8) return zlib.inflateRawSync(data);
      throw new Error("The zip uses a compression this panel can’t open.");
    },
  };
}

/** Look inside a Harsh zip. Returns { version, prefix, zip } or throws a readable error. */
export function inspectUpdate(file) {
  const zip = readZip(fs.readFileSync(file));
  const man = zip.entries.find((e) => /(^|\/)com\.harsh\.panel\/CSXS\/manifest\.xml$/.test(e.name) && e.name.indexOf("__MACOSX") === -1);
  if (!man) throw new Error(path.basename(file) + " isn’t a Frameshift update (no com.harsh.panel folder inside).");
  const xml = zip.read(man).toString("utf8");
  const version = (/ExtensionBundleVersion="([^"]+)"/.exec(xml) || [])[1];
  if (!version) throw new Error("Couldn’t read the version inside " + path.basename(file) + ".");
  return { version, prefix: man.name.replace(/CSXS\/manifest\.xml$/, ""), zip, file };
}

/** The newest Harsh zip in <library>/Updates that's newer than `current`, or null. */
export async function findUpdate(current) {
  const dir = path.join(await libraryDir(), "Updates");
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  let best = null;
  for (const n of fs.readdirSync(dir)) {
    if (!/\.zip$/i.test(n)) continue;
    try {
      const u = inspectUpdate(path.join(dir, n));
      if (compareVersions(u.version, current) > 0 && (!best || compareVersions(u.version, best.version) > 0)) best = u;
    } catch (e) {}
  }
  return best;
}
export async function updatesDir() { return path.join(await libraryDir(), "Updates"); }

function copyDir(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    const a = path.join(src, n), b = path.join(dst, n);
    if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

/** Install an inspected update over the running panel. Returns the backup folder. */
export async function installUpdate(u, current) {
  const ext = extensionPath();
  try { fs.accessSync(ext, fs.constants.W_OK); }
  catch (e) { throw new Error("The panel is installed in a folder this account can’t change. Run the installer from the new zip instead."); }
  const removed = path.join(await libraryDir(), "_Removed");
  const backup = path.join(removed, "Frameshift " + current + " backup " + Date.now());
  copyDir(ext, backup);
  let written = 0;
  for (const e of u.zip.entries) {
    if (e.name.indexOf(u.prefix) !== 0 || e.name.indexOf("__MACOSX") !== -1) continue;
    const rel = e.name.slice(u.prefix.length);
    if (!rel || rel.indexOf("..") !== -1) continue;
    const target = path.join(ext, rel);
    if (/\/$/.test(e.name)) { if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true }); continue; }
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, u.zip.read(e));
    written++;
  }
  if (!written) throw new Error("Nothing was installed; the zip looks empty.");
  try { localStorage.setItem("harsh.justUpdated", JSON.stringify({ from: current, to: u.version })); } catch (e) {}
  return backup;
}

// ------------------------------------------------------- online updates
// The update source is either a GitHub repo ("owner/name", newest release with a
// Harsh-*.zip attached) or a link to a JSON file: { "version": "2.6.0", "url": "https://.../Harsh-2_6_0.zip" }.
export const FEED_KEY = "harsh.updateFeed";
export const DEFAULT_FEED = "Harsh2021838/harsh-panel"; // GitHub releases: newest release with a Harsh-*.zip attached
export function updateFeed() { try { const v = localStorage.getItem(FEED_KEY); return v === null ? DEFAULT_FEED : v; } catch (e) { return DEFAULT_FEED; } }
export function setUpdateFeed(v) { try { localStorage.setItem(FEED_KEY, String(v || "").trim()); } catch (e) {} }

function get(url, asBuffer, hops = 0) {
  const https = nodeRequire("https"), http = nodeRequire("http");
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === "http:" ? http : https).get({
      hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search,
      headers: { "User-Agent": "Frameshift-panel-updater", Accept: asBuffer ? "application/octet-stream" : "application/json" },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), asBuffer, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("The update source answered " + res.statusCode + ".")); }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const b = Buffer.concat(chunks); resolve(asBuffer ? b : b.toString("utf8")); });
    });
    req.on("error", (e) => reject(new Error("Couldn’t reach the update source (" + e.message + ").")));
    req.setTimeout(60000, () => req.destroy(new Error("timed out")));
  });
}

/** What the update source says is newest: { version, url } or null. */
export async function latestOnline(feed = updateFeed()) {
  if (!feed) return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(feed)) {
    const rel = JSON.parse(await get("https://api.github.com/repos/" + feed + "/releases/latest"));
    const asset = (rel.assets || []).find((a) => /^Frameshift-.*\.zip$/i.test(a.name)) || (rel.assets || []).find((a) => /^Harsh-.*\.zip$/i.test(a.name));
    if (!asset) return null;
    return { version: String(rel.tag_name || "").replace(/^v/i, ""), url: asset.browser_download_url };
  }
  const j = JSON.parse(await get(feed));
  return j && j.version && j.url ? { version: String(j.version), url: j.url } : null;
}

/**
 * If the update source has something newer than `current`, download it into the
 * Updates folder (once). Returns the inspected update, or null.
 */
export async function downloadUpdate(current) {
  const info = await latestOnline();
  if (!info || compareVersions(info.version, current) <= 0) return null;
  const dir = await updatesDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "Frameshift-" + info.version.replace(/\./g, "_") + ".zip");
  if (!fs.existsSync(file)) {
    const data = await get(info.url, true);
    fs.writeFileSync(file + ".part", data);
    inspectUpdate(file + ".part"); // throws if it isn't a Harsh zip
    fs.renameSync(file + ".part", file);
  }
  try { localStorage.setItem("harsh.updateChecked", String(Date.now())); } catch (e) {}
  return inspectUpdate(file);
}
export function lastChecked() { try { return Number(localStorage.getItem("harsh.updateChecked")) || 0; } catch (e) { return 0; } }
