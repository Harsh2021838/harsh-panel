// Ease Graph (Premiere Pro): After Effects-style value and speed graphs for Premiere keyframes.
// The EaseGraph panel (vendor/*.txt, kept as written) runs in its own shadow root with a small
// document/window, like Sound Kit. Frameshift adds:
//   - its own host global (FrameshiftEG), so the standalone EaseGraph panel can't overwrite it;
//   - every script command goes through Frameshift (plain ASCII, counted, so updates wait for it);
//   - the selection check (every 1.5 s) only runs while this tool is on screen and Premiere isn't
//     busy with another command, and every timer stops when you leave the tool.
import { useEffect, useRef, useState } from "react";
import { extensionPath, evalRaw, hostBusy } from "../../host.js";
import easeSrc from "./vendor/ease.js.txt";
import bridgeSrc from "./vendor/host-bridge.js.txt";
import appSrc from "./vendor/app.js.txt";
import css from "./vendor/style.css.txt";
import body from "./vendor/body.html.txt";

function themedCss() {
  return css
    .replace(/:root\s*\{([^}]*)\}/, (m, vars) => ":host{display:block;" + vars
      .replace(/--bg:[^;]*;/, "--bg:transparent;").replace(/--surface:[^;]*;/, "--surface:var(--raise);")
      .replace(/--raised:[^;]*;/, "--raised:var(--raise-2);").replace(/--text:[^;]*;/, "--text:var(--ink);")
      .replace(/--muted:[^;]*;/, "--muted:var(--ink-2);") + "}")
    .replace(/html,\s*body\s*\{/, ".eg-body{")
    .replace(/(^|\n)body\s*\{[^}]*\}/, "$1.eg-body{padding:0 0 24px;}")
    + ".eg-body .brand{display:none}.eg-body .bar{justify-content:flex-end;margin:-6px 0 4px}";
}

function loadHost() {
  const p = extensionPath() + "/jsx/ease-graph.jsx";
  return evalRaw("$.evalFile(" + JSON.stringify(p) + "); typeof FrameshiftEG").then((r) => {
    if (r !== "object") throw new Error("Couldn't load Ease Graph into Premiere Pro. Restart Premiere Pro and try again.");
  });
}

function run(shadow, root) {
  const timers = new Set(), frames = new Set();
  let alive = true;
  const doc = {
    getElementById: (id) => shadow.getElementById(id),
    querySelector: (s) => shadow.querySelector(s),
    querySelectorAll: (s) => shadow.querySelectorAll(s),
    get body() { return root; },
    get hidden() { return document.hidden || !root.isConnected || !root.offsetParent; },
    get activeElement() { return shadow.activeElement; },
    createElement: (t) => document.createElement(t),
    addEventListener: (...a) => root.addEventListener(...a),
    removeEventListener: (...a) => root.removeEventListener(...a),
  };
  const listeners = [];
  const win = {
    // In the demo page there's no Premiere: EaseGraph's own demo clip is used.
    __adobe_cep__: window.__adobe_cep__ && !window.__DEMO_AEP ? { evalScript: (code, cb) => { evalRaw(code).then((r) => cb && cb(r)); } } : undefined,
    __egQuiet: () => !alive || hostBusy() || !root.offsetParent,
    matchMedia: window.matchMedia && window.matchMedia.bind(window),
    get devicePixelRatio() { return window.devicePixelRatio; },
    get innerWidth() { return root.clientWidth || window.innerWidth; },
    localStorage: window.localStorage,
    addEventListener: (t, f, o) => { listeners.push([t, f, o]); window.addEventListener(t, f, o); },
    removeEventListener: (t, f, o) => window.removeEventListener(t, f, o),
  };
  const si = (f, ms) => { const id = setInterval(() => alive && f(), ms); timers.add(id); return id; };
  const st = (f, ms) => { const id = setTimeout(() => alive && f(), ms); return id; };
  const raf = (f) => { if (!alive) return 0; const id = requestAnimationFrame((t) => { frames.delete(id); if (alive) f(t); }); frames.add(id); return id; };
  // eslint-disable-next-line no-new-func
  new Function("document", "window", "setInterval", "setTimeout", "requestAnimationFrame", "localStorage", "performance",
    easeSrc + "\n" + bridgeSrc + "\n" + appSrc)(doc, win, si, st, raf, window.localStorage, window.performance);
  window.__egTest = win.EaseGraphApp;
  return () => {
    alive = false;
    timers.forEach(clearInterval); frames.forEach(cancelAnimationFrame);
    listeners.forEach(([t, f, o]) => window.removeEventListener(t, f, o));
  };
}

export default function EaseGraph() {
  const host = useRef(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!host.current) return undefined;
    const shadow = host.current.shadowRoot || host.current.attachShadow({ mode: "open" });
    shadow.innerHTML = "<style>" + themedCss() + "</style><div class=\"eg-body\">" + body + "</div>";
    const root = shadow.querySelector(".eg-body");
    let stop = null, cancelled = false;
    (async () => {
      if (window.__adobe_cep__ && !window.__DEMO_AEP) await loadHost().catch((e) => setError(e.message));
      if (cancelled) return;
      try { stop = run(shadow, root); } catch (e) { setError("Ease Graph couldn't start: " + e.message); }
    })();
    return () => { cancelled = true; if (stop) stop(); };
  }, []);
  return (
    <div className="ease-graph">
      {error && <p className="msg bad">{error}</p>}
      <div ref={host} className="ease-graph-host" />
    </div>
  );
}
