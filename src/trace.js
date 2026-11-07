// A short diary of what the panel did, written to disk as it happens:
//   Documents/Frameshift Library/Logs/panel-steps.log
// If Premiere's panel engine crashes, the last lines say what the panel was doing at that moment,
// even when Adobe's crash report shows nothing. Polling commands are left out to keep it short.
const nodeRequire = typeof window.require === "function" ? window.require : window.cep_node && window.cep_node.require ? window.cep_node.require : null;

const fs = nodeRequire && nodeRequire("fs");
const path = nodeRequire && nodeRequire("path");
const os = nodeRequire && nodeRequire("os");
let file = null, last = "", previous = null;

function where() {
  if (file || !fs) return file;
  try {
    const dir = path.join(os.homedir(), "Documents", "Frameshift Library", "Logs");
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, "panel-steps.log");
  } catch (e) { file = null; }
  return file;
}

/** Lines from the end of the last run (read once, at start). */
export function lastRun() {
  if (previous !== null) return previous;
  previous = [];
  try {
    const f = where(); if (!f || !fs.existsSync(f)) return previous;
    const lines = fs.readFileSync(f, "utf8").trim().split("\n");
    previous = lines.slice(-12);
  } catch (e) {}
  return previous;
}

export function trace(step) {
  const f = where(); if (!f) return;
  const s = String(step).replace(/\s+/g, " ").slice(0, 160);
  if (s === last) return;
  last = s;
  try {
    if (fs.existsSync(f) && fs.statSync(f).size > 300 * 1024) {
      const keep = fs.readFileSync(f, "utf8").split("\n").slice(-400).join("\n");
      fs.writeFileSync(f, keep + "\n");
    }
    fs.appendFileSync(f, new Date().toISOString().slice(11, 23) + " " + s + "\n");
  } catch (e) {}
}
