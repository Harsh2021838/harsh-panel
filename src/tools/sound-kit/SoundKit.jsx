// Client Sound Kit inside Harsh.
//
// The original panel (vendor/*.txt, kept as written) runs in its own shadow root, so its
// styles and Harsh's never touch. Its script gets a small `document`/`window` that point
// at that shadow root, and its ExtendScript (jsx/client-sound-kit.jsx) is loaded into
// Premiere the first time the tool opens. Its library lives in
// <Harsh Library>/Tools/Sound Kit/library.json (copied once from Documents/ClientSoundKit).
import { useEffect, useRef, useState } from "react";
import { nodeRequire, extensionPath, evalRaw, hostName } from "../../host.js";
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

const ASK_CSS = ".csk-body { position: relative; }" +
  ".ask { position: absolute; inset: 0; z-index: 50; display: flex; align-items: flex-start; justify-content: center; padding: 64px 12px; background: rgba(0,0,0,.45); }" +
  ".ask-box { width: 100%; max-width: 320px; background: var(--bg); background-image: linear-gradient(var(--panel), var(--panel)); border: 1px solid var(--line); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.4); }" +
  ".ask-msg { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text); }" +
  ".ask-input { height: 30px; width: 100%; }" +
  ".ask-acts { display: flex; justify-content: flex-end; gap: 6px; } .ask-acts button { height: 28px; padding: 0 12px; }" +
  ".ask-yes { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; } .ask-yes:hover { filter: brightness(1.1); }";

function loadHostScript() {
  const p = extensionPath() + "/jsx/client-sound-kit.jsx";
  return evalRaw("$.evalFile(" + JSON.stringify(p) + "); typeof CSK").then((r) => {
    if (r !== "object") throw new Error("Couldn't load Sound Kit into " + hostName + ". Restart " + hostName + " and try again.");
  });
}

function run(shadow, root, dir) {
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
    require: window.require, cep: window.cep, __adobe_cep__: window.__adobe_cep__,
    AudioContext: window.AudioContext, webkitAudioContext: window.webkitAudioContext,
    ResizeObserver: window.ResizeObserver, localStorage: window.localStorage,
    get devicePixelRatio() { return window.devicePixelRatio; },
    ask: (m, d, cb) => askBox(shadow, m, d, true, cb),
    askYes: (m, cb) => askBox(shadow, m, "", false, () => cb()),
    addEventListener: (...a) => window.addEventListener(...a),
    removeEventListener: (...a) => window.removeEventListener(...a),
    __cskDir: dir,
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

  useEffect(() => {
    if (started.current || !host.current) return;
    started.current = true;
    const shadow = host.current.attachShadow({ mode: "open" });
    shadow.innerHTML = "<style>" + themedCss() + ASK_CSS + "</style><div class=\"csk-body\">" + body + "</div>";
    const root = shadow.querySelector(".csk-body");
    (async () => {
      try {
        const dir = await toolDir("Sound Kit");
        moveOldLibrary(dir);
        await loadHostScript().catch((e) => setError(e.message));
        run(shadow, root, dir);
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
