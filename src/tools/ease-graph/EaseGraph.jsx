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
    + LOOK;
}

// Frameshift's look: the graph is the hero, drawn on the panel itself with yellow handles; the
// rest is quiet, one accent (Frameshift yellow) for what's chosen.
const LOOK = `
.eg-body{position:relative;font:12.5px/1.45 var(--font);color:var(--ink);--accent:var(--mark);--accent-hi:var(--mark-hover);--handle:var(--mark)}
.eg-body .brand{display:none}
.eg-body .bar{position:absolute;right:56px;top:-4px;margin:0;z-index:2}
.eg-body button{background:var(--raise);border-color:var(--line);border-radius:7px;color:var(--ink)}
.eg-body button:hover{background:var(--raise-2);border-color:rgba(255,255,255,.16)}
.eg-body button.icon{background:transparent;border-color:transparent;color:var(--ink-2);width:26px;height:26px;font-size:14px}
.eg-body button.link{background:none;border:0;color:var(--ink-3)}
.eg-body input,.eg-body select{background:var(--sunk);border-color:var(--line);border-radius:7px;color:var(--ink)}
.eg-body input:focus-visible,.eg-body select:focus-visible{border-color:var(--mark);box-shadow:0 0 0 2px var(--mark-soft)}
.eg-body :focus-visible{outline-color:var(--mark)}
.eg-body .top-row{align-items:center;min-height:26px;margin-bottom:6px;padding-right:2px}
.eg-body .detected{margin:0;font-size:12px;color:var(--ink-2)}
.eg-body .detected b{color:var(--ink)}
.eg-body .detected.none{background:transparent;border:1px dashed var(--line);color:var(--ink-2)}
.eg-body .switch{color:var(--ink-2)}
.eg-body .switch .track{background:rgba(255,255,255,.16)}
.eg-body .switch input:checked + .track{background:var(--mark)}
.eg-body .switch input:checked + .track::after{background:var(--mark-ink)}
.eg-body .gwrap{background:var(--sunk);border-radius:10px;box-shadow:inset 0 0 0 1px var(--line)}
.eg-body .gwrap canvas{height:200px}
.eg-body .presets{gap:5px;margin-top:10px}
.eg-body .preset{background:transparent;border-color:var(--line);padding:7px 2px 6px;color:var(--ink-2);font-size:11px}
.eg-body .preset svg{color:var(--ink-3);height:20px}
.eg-body .preset:hover{background:var(--raise);color:var(--ink)}
.eg-body .preset[aria-pressed="true"],.eg-body .preset.smart[aria-pressed="true"]{background:var(--mark-soft);border-color:var(--mark);color:var(--ink)}
.eg-body .preset[aria-pressed="true"] svg{color:var(--mark)}
.eg-body .manual{margin-top:12px;gap:6px}
.eg-body .manual label,.eg-body .field-grid label{color:var(--ink-3);font-size:11px}
.eg-body .num-in i{color:var(--ink-3)}
.eg-body .ph-row{gap:6px}
.eg-body .ph-row button{background:transparent}
.eg-body .status{color:var(--ink-3)} .eg-body .status.ok{color:var(--good)} .eg-body .status.err{color:var(--bad)}
.eg-body .more{border-top-color:var(--line)}
.eg-body .more summary{color:var(--ink-2)}
.eg-body .more h3{color:var(--ink-2)}
.eg-body .tbl-wrap,.eg-body th{background:var(--sunk)}
.eg-body th{color:var(--ink-3)}
.eg-body td{border-bottom-color:var(--line)}
`;

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
  // module/exports/require are hidden: inside Premiere the panel also has Node's, and ease.js would
  // then hand itself to Node instead of the page ("Cannot read properties of undefined").
  new Function("document", "window", "setInterval", "setTimeout", "requestAnimationFrame", "localStorage", "performance", "module", "exports", "require",
    easeSrc + "\n" + bridgeSrc + "\n" + appSrc)(doc, win, si, st, raf, window.localStorage, window.performance, undefined, undefined, undefined);
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
