// Client Sound Kit inside Harsh.
//
// The original panel (vendor/*.txt, kept as written) runs in its own shadow root, so its
// styles and Harsh's never touch. Its script gets a small `document`/`window` that point
// at that shadow root, and its ExtendScript (jsx/client-sound-kit.jsx) is loaded into
// Premiere the first time the tool opens. Its library lives in
// <Harsh Library>/Tools/Sound Kit/library.json (copied once from Documents/ClientSoundKit).
import { useEffect, useRef, useState } from "react";
import { followSize, rem } from "../../density.js";
import { nodeRequire, extensionPath, evalRaw, hostName, asciiScript } from "../../host.js";
import { toolDir } from "../../library.js";
import source from "./vendor/main.js.txt";
import css from "./vendor/style.css.txt";
import body from "./vendor/body.html.txt";

const fs = nodeRequire && nodeRequire("fs");
const path = nodeRequire && nodeRequire("path");

// Make the original stylesheet follow Harsh's colours and font, and scope it to the shadow root.
function themedCss() {
  return css
    .replace(/:root\s*\{[^}]*\}/, ":host { display: block; height: 100%; --panel: var(--raise); --panel-2: var(--raise-2); --text: var(--ink); --muted: var(--ink-2); --accent: #2d8ceb; --ok: var(--good); --err: var(--bad); }")
    .replace(/html,\s*body\s*\{[^}]*\}/, "")
    .replace(/(^|\n)body\s*\{/, "$1.csk-body { height: 100%; margin: 0; ")
    .replace(/font:\s*12px\/1\.35[^;]*;/, "font: 12px/1.35 var(--font);");
}

// The library file moves into the Harsh Library; copy the old one over the first time.
function moveOldLibrary(dir) {
  if (!fs) return;
  const next = path.join(dir, "library.json");
  const old = path.join(nodeRequire("os").homedir(), "Documents", "ClientSoundKit", "library.json");
  try { if (!fs.existsSync(next) && fs.existsSync(old)) fs.copyFileSync(old, next); } catch (e) {}
}


// Premiere panels can't show the browser's prompt()/confirm() boxes, so those calls are
// rewritten to an in-panel box (askBox) that calls back when the person answers.
const PATCHES = [
  ["nodePath.join(window.require('os').homedir(), 'Documents', 'ClientSoundKit')", "window.__cskDir"],
  ["$('#addClient').addEventListener('click', function () {\n    var name = window.prompt('New client name');",
   "$('#addClient').addEventListener('click', function () { window.ask('New client name', '', function (name) {"],
  ["setStatus('Created ' + c.name + '.', 'ok');\n  });", "setStatus('Created ' + c.name + '.', 'ok');\n  }); });"],
  ["var c = client(); var name = window.prompt('Rename client', c.name);", "var c = client(); window.ask('Rename client', c.name, function (name) {"],
  ["setStatus('Renamed to ' + c.name + '.', 'ok');\n  });", "setStatus('Renamed to ' + c.name + '.', 'ok');\n  }); });"],
  ["if (!window.confirm('Delete ' + c.name + ' and its ' + c.assets.length + ' saved sounds? Audio files stay on disk.')) return;",
   "window.askYes('Delete ' + c.name + ' and its ' + c.assets.length + ' saved sounds? Audio files stay on disk.', function () {"],
  ["setStatus('Deleted ' + c.name + '.');\n  });", "setStatus('Deleted ' + c.name + '.');\n  }); });"],
  ["if (!window.confirm('Remove \u201C' + a.name + '\u201D from ' + client().name + '? The audio file stays on disk.')) return;",
   "window.askYes('Remove \u201C' + a.name + '\u201D from ' + client().name + '? The audio file stays on disk.', function () {"],
  ["' Its WAV was removed from the library folder.' : ''));\n    }", "' Its WAV was removed from the library folder.' : ''));\n    });\n    }"],
];
function patchSource(src) {
  let out = src;
  for (const [a, b] of PATCHES) {
    if (out.indexOf(a) === -1) throw new Error("Sound Kit changed; update PATCHES for: " + a.slice(0, 50));
    out = out.replace(a, () => b);
  }
  return out;
}

function askBox(shadow, message, value, withInput, done) {
  const wrap = document.createElement("div");
  wrap.className = "ask";
  wrap.innerHTML = '<form class="ask-box" role="dialog" aria-modal="true"><p class="ask-msg"></p>' +
    (withInput ? '<input class="ask-input" autocomplete="off" spellcheck="false">' : "") +
    '<div class="ask-acts"><button type="button" class="ask-no">Cancel</button><button type="submit" class="ask-yes">' +
    (withInput ? "OK" : "Yes") + "</button></div></form>";
  wrap.querySelector(".ask-msg").textContent = message;
  const input = wrap.querySelector(".ask-input");
  if (input) input.value = value || "";
  const close = () => wrap.remove();
  wrap.querySelector(".ask-no").onclick = close;
  wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  wrap.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const v = input ? input.value : true;
    if (input && !v.trim()) return input.focus();
    close(); done(v);
  };
  shadow.querySelector(".csk-body").appendChild(wrap);
  setTimeout(() => (input || wrap.querySelector(".ask-yes")).focus(), 0);
}

// Frameshift's look over the original stylesheet: flat surfaces, the Premiere label colour as each
// sound's identity (a full-height stripe and its waveform), one yellow accent for what's chosen.
const LOOK_CSS = `
.csk-body{font:12.5px/1.4 var(--font);--accent:var(--mark);--line:rgba(255,255,255,.09);--panel:var(--raise);--panel-2:var(--raise-2);background:transparent}
.csk-body button,.csk-body input,.csk-body select{border-radius:7px;border-color:var(--line);background:var(--raise);color:var(--ink);height:28px}
.csk-body button:hover{background:var(--raise-2);border-color:rgba(255,255,255,.16)}
.csk-body input:focus,.csk-body select:focus{border-color:var(--mark)}
.csk-body :focus-visible{outline-color:var(--mark)!important}
.csk-body .top{padding:4px 0 0}
.csk-body .row{gap:4px;align-items:center}
.csk-body #clientSelect{height:30px;font-weight:600;background:var(--sunk)}
.csk-body .icon{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border-color:transparent;color:var(--ink-2)}
.csk-body .icon:hover{background:var(--raise);color:var(--ink)}
.csk-body{padding:4px 12px 0;box-sizing:border-box}
.csk-body .tabs{margin-top:10px;border:0;gap:2px;padding:2px;border-radius:8px;background:var(--sunk)}
.csk-body .tab{height:28px;border:0;background:transparent;color:var(--ink-2);font-weight:500;border-radius:6px}
.csk-body .tab:hover{background:transparent;color:var(--ink)}
.csk-body .tab.active{color:var(--ink);font-weight:600;background:var(--raise-2);box-shadow:inset 0 0 0 1px var(--line)}
.csk-body .list{padding:10px 0;gap:8px}
.csk-body .card{background:var(--raise);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:9px;padding:9px 10px 9px 11px;gap:7px}
.csk-body .card:hover{background:var(--raise-2)}
.csk-body .card.editing{background:var(--raise-2);border-color:rgba(255,255,255,.16);border-left-color:var(--c)}
.csk-body .dot{display:none}
.csk-body .name{font-size:13px;letter-spacing:-.005em}
.csk-body .badge{background:var(--sunk);border-color:transparent;color:var(--ink-2);border-radius:5px;font-variant-numeric:tabular-nums}
.csk-body .wave{background:var(--sunk);border:0;border-radius:6px;height:56px}
.csk-body .hint-text{color:var(--ink-3)}
.csk-body .place{height:26px;background:transparent;border-color:var(--line)}
.csk-body .place:hover{border-color:var(--c);background:var(--raise-2)}
.csk-body .group{color:var(--ink-3);text-transform:none;letter-spacing:0;font-size:11.5px}
/* wide panel: sounds side by side instead of one long column, buttons stay a normal size */
:host-context(.fs-wide) .csk-body #list{display:grid;grid-template-columns:repeat(auto-fill,minmax(17rem,1fr));align-content:start;align-items:start}
:host-context(.fs-wide) .csk-body #list>.group,:host-context(.fs-wide) .csk-body #list>.empty,:host-context(.fs-wide) .csk-body #list>.card.editing,:host-context(.fs-wide) .csk-body #list>.card.bgm{grid-column:1/-1}
:host-context(.fs-wide) .csk-body .drop-row{justify-content:flex-start}
:host-context(.fs-wide) .csk-body .drop-row button{flex:0 1 15rem}
.csk-body .empty{border:1px dashed var(--line);border-radius:10px;padding:26px 16px;color:var(--ink-2);line-height:1.55;margin-top:4px}
.csk-body .dropzone{border-top:1px solid var(--line);padding:10px 0 8px}
.csk-body .dropzone.over{background:var(--mark-soft);outline:2px dashed var(--mark)}
.csk-body .drop-row{display:flex;gap:6px}
.csk-body .drop-row button{flex:1;min-height:32px;height:auto;padding:5px 8px;margin:0;font-weight:600;min-width:0;line-height:1.2;white-space:normal}
.csk-body .primary{background:var(--mark);border:1px solid var(--mark);color:var(--mark-ink)}
.csk-body .primary:hover{background:var(--mark-hover);border-color:var(--mark-hover)}
.csk-body .capture{background:var(--raise);border:1px solid var(--line)}
.csk-body .hint{color:var(--ink-3);margin-top:6px}
.csk-body .status{background:transparent;border-top:1px solid var(--line);color:var(--ink-3);padding:6px 0 0}
.csk-body .status.ok{color:var(--good)} .csk-body .status.err{color:var(--bad)}
.csk-body .save{background:var(--mark);border-color:var(--mark);color:var(--mark-ink)}
.csk-body .swatch{border-radius:5px}
.csk-body .fader-track{background:var(--sunk);border-color:transparent;border-radius:6px}
`;

const ASK_CSS = ".csk-body { position: relative; }" +
  ".ask { position: absolute; inset: 0; z-index: 50; display: flex; align-items: flex-start; justify-content: center; padding: 64px 12px; background: rgba(0,0,0,.45); }" +
  ".ask-box { width: 100%; max-width: 320px; background: var(--bg); background-image: linear-gradient(var(--panel), var(--panel)); border: 1px solid var(--line); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.4); }" +
  ".ask-msg { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text); }" +
  ".ask-input { height: 30px; width: 100%; }" +
  ".ask-acts { display: flex; justify-content: flex-end; gap: 6px; } .ask-acts button { height: 28px; padding: 0 12px; }" +
  ".ask-yes { background: var(--mark); border-color: var(--mark); color: var(--mark-ink); font-weight: 600; } .ask-yes:hover { filter: brightness(1.06); }";

function loadHostScript() {
  const p = extensionPath() + "/jsx/client-sound-kit.jsx";
  return evalRaw("$.evalFile(" + JSON.stringify(p) + "); typeof FrameshiftSK").then((r) => {
    if (r !== "object") throw new Error("Couldn't load Sound Kit into " + hostName + ". Restart " + hostName + " and try again.");
  });
}

// Premiere's label names and colours (Preferences > Labels can rename and recolour all 16).
// Read through Premiere first; if that gives nothing, from its preferences file.
function labelColour(v) {
  v = String(v == null ? "" : v).trim();
  if (/^#?[0-9a-f]{6}$/i.test(v)) return "#" + v.replace("#", "").toLowerCase();
  const n = Number(v);
  if (!isFinite(n) || v === "") return "";
  // Stored as a number with red in the low byte (0xBBGGRR).
  const x = n >>> 0, r = x & 255, g = (x >> 8) & 255, b = (x >> 16) & 255;
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}
function labelsFromPrefsFile() {
  if (!fs) return [];
  try {
    const base = path.join(nodeRequire("os").homedir(), "Documents", "Adobe", "Premiere Pro");
    const files = [];
    for (const ver of fs.readdirSync(base)) {
      const vdir = path.join(base, ver);
      let subs = [];
      try { subs = fs.readdirSync(vdir); } catch (e) { continue; }
      for (const prof of subs) {
        if (!/^Profile/i.test(prof)) continue;
        const f = path.join(vdir, prof, "Adobe Premiere Pro Prefs");
        try { files.push({ f, t: fs.statSync(f).mtimeMs }); } catch (e) {}
      }
    }
    files.sort((a, b) => b.t - a.t);
    if (!files.length) return [];
    const text = fs.readFileSync(files[0].f, "utf8");
    const out = [];
    for (let i = 0; i < 16; i++) {
      const n = text.match(new RegExp("LabelNames\\." + i + "\\b[^>]*>([^<]*)<"));
      const c = text.match(new RegExp("LabelColors\\." + i + "\\b[^>]*>([^<]*)<"));
      out.push([n ? n[1] : "", c ? c[1] : ""]);
    }
    return out;
  } catch (e) { return []; }
}
async function readLabels() {
  let raw = [];
  try {
    const r = await evalRaw("FrameshiftSK.labels()");
    if (String(r).indexOf("OK|") === 0) raw = JSON.parse(String(r).slice(3));
  } catch (e) {}
  if (!raw.some((l) => l && (l[0] || l[1]))) raw = labelsFromPrefsFile();
  return raw.map((l) => {
    const name = l && l[0] && !/^\$\$\$/.test(l[0]) ? String(l[0]).trim() : "";
    return { name, hex: labelColour(l && l[1]) };
  });
}

function run(shadow, root, dir, labels) {
  const doc = {
    getElementById: (id) => shadow.getElementById(id),
    querySelector: (s) => shadow.querySelector(s),
    querySelectorAll: (s) => shadow.querySelectorAll(s),
    get body() { return root; },
    get activeElement() { return shadow.activeElement; },
    createElement: (t) => document.createElement(t),
    addEventListener: (...a) => root.addEventListener(...a),
    removeEventListener: (...a) => root.removeEventListener(...a),
  };
  const win = {
    require: window.require, cep: window.cep,
    // Same protection as the rest of Harsh: script commands go to Premiere in plain ASCII.
    __adobe_cep__: window.__adobe_cep__ && Object.assign(Object.create(window.__adobe_cep__), {
      evalScript: (code, cb) => window.__adobe_cep__.evalScript(asciiScript(code), cb),
    }),
    AudioContext: window.AudioContext, webkitAudioContext: window.webkitAudioContext,
    ResizeObserver: window.ResizeObserver, localStorage: window.localStorage,
    get devicePixelRatio() { return window.devicePixelRatio; },
    ask: (m, d, cb) => askBox(shadow, m, d, true, cb),
    askYes: (m, cb) => askBox(shadow, m, "", false, () => cb()),
    addEventListener: (...a) => window.addEventListener(...a),
    removeEventListener: (...a) => window.removeEventListener(...a),
    __cskDir: dir,
    __cskLabels: labels,
  };
  const code = patchSource(source);
  // eslint-disable-next-line no-new-func
  new Function("document", "window", code)(doc, win);
  window.__cskTest = win.__cskTest;
}

export default function SoundKit() {
  const host = useRef(null);
  const started = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => (host.current ? followSize(host.current) : undefined), []);
  useEffect(() => {
    if (started.current || !host.current) return;
    started.current = true;
    const shadow = host.current.attachShadow({ mode: "open" });
    shadow.innerHTML = "<style>" + rem(themedCss() + ASK_CSS + LOOK_CSS) + "</style><div class=\"csk-body\">" + body + "</div>";
    const root = shadow.querySelector(".csk-body");
    (async () => {
      try {
        const dir = await toolDir("Sound Kit");
        moveOldLibrary(dir);
        await loadHostScript().catch((e) => setError(e.message));
        const labels = await readLabels();
        window.__cskLabelsRead = labels;
        run(shadow, root, dir, labels);
      } catch (e) {
        setError("Sound Kit couldn't start: " + e.message);
      }
    })();
  }, []);

  return (
    <div className="sound-kit">
      {error && <p className="msg bad">{error}</p>}
      <div ref={host} className="sound-kit-host" />
    </div>
  );
}
