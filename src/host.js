// Bridge between the panel and the Adobe app it is docked in.

export const nodeRequire =
  typeof window.require === "function" ? window.require
  : window.cep_node && window.cep_node.require ? window.cep_node.require
  : null;

import { trace } from "./trace.js";
const cep = window.__adobe_cep__;

function hostEnv() {
  try { return JSON.parse(cep.getHostEnvironment()); } catch (e) { return {}; }
}

/** "PPRO" or "AEFT" */
export const hostApp = hostEnv().appName || "PPRO";
export const hostName = hostApp === "AEFT" ? "After Effects" : "Premiere Pro";

/** Filesystem path of the installed extension folder. */
export function extensionPath() {
  let dir = decodeURIComponent(new URL("../", location.href).pathname).replace(/\/$/, "");
  if (/^\/[A-Za-z]:/.test(dir)) dir = dir.slice(1); // Windows: /C:/... -> C:/...
  return dir;
}

/** Panel background colour from the app, so the panel matches the user's brightness setting. */
export function hostBackground() {
  try {
    const c = hostEnv().appSkinInfo.panelBackgroundColor.color;
    return { r: Math.round(c.red), g: Math.round(c.green), b: Math.round(c.blue) };
  } catch (e) { return { r: 35, g: 35, b: 35 }; }
}
export function onThemeChange(fn) {
  try { cep.addEventListener("com.adobe.csxs.events.ThemeColorChanged", fn); } catch (e) {}
}

/** A script with every non-ASCII character written as \uXXXX (they only ever appear inside string literals). */
export function asciiScript(code) {
  return String(code).replace(/[\u007f-\uffff]/g, (c) => "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4));
}

// How many script commands are running in the app right now, and whether any ever ran in this
// panel load. The updater uses these: it must never reload the panel while a command is still
// running in Premiere (tearing the panel down mid-command can crash the app).
let inFlight = 0;
let hostUsed = false;
export function hostWasUsed() { return hostUsed; }
export function hostBusy() { return inFlight > 0; }
export function hostIdle() {
  return new Promise((resolve) => { const t = () => (inFlight === 0 ? resolve() : setTimeout(t, 200)); t(); });
}

export function evalRaw(code) {
  hostUsed = true;
  inFlight++;
  const label = /selSignature/.test(code) ? "" : String(code).replace(/\$\.evalFile\([^)]*\);?/g, "load script; ").slice(0, 90);
  if (label) trace("-> " + label);
  return new Promise((resolve) => cep.evalScript(asciiScript(code), (r) => {
    inFlight = Math.max(0, inFlight - 1);
    if (label) trace("<- " + String(r).slice(0, 40));
    resolve(r);
  }));
}

// The current app session: an id kept in the app's script engine, which lives exactly as long as
// Premiere / After Effects stays open (it survives panel reloads, not a restart). Things that should
// only last "for this session", like ignored mistakes, are stored under it.
let sessionPromise = null;
const pageSession = String(Date.now());
export function appSession() {
  if (!sessionPromise) {
    sessionPromise = evalRaw("(function(){if(!$.global.__harshSession)$.global.__harshSession=String(new Date().getTime())+String(Math.floor(Math.random()*1e6));return $.global.__harshSession;})()")
      .then((r) => (/^\d{10,}$/.test(String(r)) ? String(r) : pageSession), () => pageSession);
  }
  return sessionPromise;
}

/**
 * JSON for a script command, in plain ASCII. Every character above 0x7E (accents, curly quotes,
 * emoji, zero-width spaces, U+2028...) is written as a \uXXXX escape, which ExtendScript reads
 * back as the same text. Sending those characters raw inside evalScript can crash Premiere,
 * and on-screen text is full of them.
 */
export function toScript(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4));
}

const loaded = {};
/** Load an ExtendScript file from <extension>/jsx once per session. */
function ensureScript(file, globalName) {
  if (loaded[file]) return Promise.resolve();
  const p = extensionPath() + "/jsx/" + file;
  return evalRaw("$.evalFile(" + toScript(p) + "); typeof $." + globalName).then((r) => {
    if (r !== "object") throw new Error("Couldn't load " + file + " into " + hostName + ". Restart " + hostName + " and try again.");
    loaded[file] = true;
  });
}

/**
 * Make a caller for one tool's ExtendScript file.
 *   const call = makeHost("my-tool.jsx", "HarshMyTool");
 *   const data = await call("collect", { mode: "all" });
 * The .jsx must define $.HarshMyTool = { call: function (name, arg) { ... return JSON string {ok, data|error} } }.
 */
export function makeHost(file, globalName) {
  return function (name, arg) {
    return ensureScript(file, globalName)
      .then(() => evalRaw("$." + globalName + ".call(" + JSON.stringify(name) + "," + toScript(arg || {}) + ")"))
      .then((raw) => {
        let r;
        try { r = JSON.parse(raw); } catch (e) {
          throw new Error(raw === "EvalScript error."
            ? hostName + " is busy, probably with a dialog open. Close it and try again."
            : "Unexpected reply from " + hostName + ": " + String(raw).slice(0, 120));
        }
        if (!r.ok) throw new Error(r.error);
        return r.data;
      });
  };
}

/**
 * Premiere: go to a time in a sequence, safely. `call` is a tool's makeHost caller whose jsx has
 * prJump. If the sequence isn't the open one: an automatic jump (explicit false) does nothing and
 * returns { other: name }; a Go to click opens it, waits until Premiere says it's open, and only
 * then moves the playhead (both in one script call can crash Premiere).
 */
export async function premiereGoTo(call, containerId, startTicks, explicit) {
  let r = await call("prJump", { containerId, startTicks, open: !!explicit });
  if (!r || !r.opened) return r || {};
  for (let i = 0; i < 12; i++) {
    await new Promise((res) => setTimeout(res, 350));
    r = await call("prJump", { containerId, startTicks, open: false });
    if (r && r.moved) return r;
  }
  return { opened: true, waiting: true };
}

/** Text QC's commands. */
export const host = makeHost("text-qc.jsx", "HarshTextQC");

export function pickFiles(title, ext) {
  const r = window.cep.fs.showOpenDialogEx(true, false, title, null, ext ? [ext] : []);
  return r && r.data ? r.data : [];
}
export function pickFolder(title) {
  const r = window.cep.fs.showOpenDialogEx(false, true, title, null, []);
  return r && r.data && r.data[0] ? r.data[0] : null;
}
