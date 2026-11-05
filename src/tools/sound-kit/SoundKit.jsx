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
    confirm: (m) => window.confirm(m), prompt: (m, d) => window.prompt(m, d),
    addEventListener: (...a) => window.addEventListener(...a),
    removeEventListener: (...a) => window.removeEventListener(...a),
    __cskDir: dir,
  };
  const code = source.replace(
    "nodePath.join(window.require('os').homedir(), 'Documents', 'ClientSoundKit')",
    "window.__cskDir"
  );
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
    shadow.innerHTML = "<style>" + themedCss() + "</style><div class=\"csk-body\">" + body + "</div>";
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
