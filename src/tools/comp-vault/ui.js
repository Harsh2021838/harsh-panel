// Comp Vault UI (was the Harsh Library plugin). Plain React.createElement.
var media = require("./media.js");
var colorsLib = require("./colors.js");

var SIZES = [
  { id: "original", label: "Keep original size" },
  { id: "1920x1080", label: "1920 × 1080 (landscape)", w: 1920, h: 1080 },
  { id: "1080x1920", label: "1080 × 1920 (vertical)", w: 1080, h: 1920 },
  { id: "1080x1080", label: "1080 × 1080 (square)", w: 1080, h: 1080 },
  { id: "3840x2160", label: "3840 × 2160 (4K)", w: 3840, h: 2160 },
  { id: "custom", label: "Custom…" }
];
var FILTERS = [
  { id: "all", label: "All" },
  { id: "animation", label: "Animations" },
  { id: "layers", label: "Layers" },
  { id: "effects", label: "Effects" },
  { id: "code", label: "Code" },
  { id: "image", label: "Media" },
  { id: "font", label: "Fonts" }
];
// Which filter chip a kind belongs to.
var FILTER_OF = { clip: "image", preset: "effects", ffx: "effects", expression: "code", script: "code" };
function filterOf(kind) { return FILTER_OF[kind] || kind; }
var KIND_LABEL = { animation: "Animation", layers: "Layers", image: "Image", clip: "Clip", preset: "Effects & Animation", ffx: "Effect preset", expression: "Expression", script: "Script", font: "Font" };
var KIND_ICON = { animation: "film", layers: "layers", image: "image", clip: "clip", preset: "spark", ffx: "spark", expression: "code", script: "code", font: "type" };
// Kinds that only make sense inside After Effects.
var AE_ONLY = { preset: 1, ffx: 1, expression: 1, script: 1 };
function fmtBytes(b) {
  var u = ["bytes", "KB", "MB", "GB", "TB"], i = 0;
  while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
  var n;
  try { n = new Intl.NumberFormat(undefined, { maximumFractionDigits: b < 10 && i ? 1 : 0 }).format(b); } catch (e) { n = String(Math.round(b)); }
  return n + "\u00a0" + u[i];
}
function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
function readPref(k, d) { try { var v = window.localStorage.getItem("harshLibrary." + k); return v === null ? d : v; } catch (e) { return d; } }
function writePref(k, v) { try { window.localStorage.setItem("harshLibrary." + k, v); } catch (e) {} }

function sameScope(a, b) { return (a.client || "") === (b.client || "") && (a.project || "") === (b.project || ""); }
function scopeLabel(s) { return !s.client ? "Common" : s.project ? s.client + " › " + s.project : s.client; }
function scopeKey(s) { return (s.client || "") + "/" + (s.project || ""); }
function fmtTime(sec) {
  if (!(sec >= 0)) return "";
  var m = Math.floor(sec / 60), s = sec - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
}
function prefersReducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
}
function copyText(text) {
  var ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  var ok = false;
  try { ok = document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
  return ok;
}

module.exports = function makeUI(React, deps) {
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef, useCallback = React.useCallback, useMemo = React.useMemo;
  var store = deps.store, call = deps.call, app = deps.app, fs = deps.fs, path = deps.path;
  var isAE = app === "AEFT";

  // ---------------------------------------------------------------- icons
  function Icon(props) {
    var d = {
      gear: "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM8 1.75v1.9M8 12.35v1.9M1.75 8h1.9M12.35 8h1.9M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3",
      more: "M4 8.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm4 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm4 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
      plus: "M8 3.5v9M3.5 8h9",
      back: "M10 3.5 5.5 8l4.5 4.5",
      chevron: "M6 3.5 10.5 8 6 12.5",
      folder: "M2.5 4.5h4l1.5 1.5h5.5v6.5h-11Z",
      film: "M3 3.5h10v9H3Zm2 0v9m6-9v9M3 6h2m6 0h2M3 10h2m6 0h2",
      layers: "M8 2.5 13.5 5.5 8 8.5 2.5 5.5Zm-5.5 5L8 10.5l5.5-3M2.5 10 8 13l5.5-3",
      x: "M4 4l8 8M12 4l-8 8",
      search: "M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm3 7 3 3",
      pin: "M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5",
      file: "M4 2.5h5l3 3v8H4Zm5 0v3h3",
      image: "M2.5 3.5h11v9h-11ZM2.5 10.5l3-3 3 3 2-2 3 3M10 6.2a.7.7 0 1 0 0 .1",
      home: "M2.5 7.5 8 3l5.5 4.5M4 6.5v6h8v-6",
      add: "M8 3.5v6M5 6.5l3 3 3-3M3 12.5h10",
      gridS: "M2.5 2.5h3v3h-3Zm4 0h3v3h-3Zm4 0h3v3h-3Zm-8 4h3v3h-3Zm4 0h3v3h-3Zm4 0h3v3h-3Zm-8 4h3v3h-3Zm4 0h3v3h-3Zm4 0h3v3h-3Z",
      gridL: "M2.5 2.5h5v5h-5Zm6 0h5v5h-5Zm-6 6h5v5h-5Zm6 0h5v5h-5Z",
      clip: "M2.5 4.5h8v7h-8Zm8 2.5 3-2v6l-3-2",
      check: "M3.5 8.5 6.5 11.5 12.5 4.5",
      tag: "M2.5 2.5h5l6 6-5 5-6-6Zm3 2.2a.6.6 0 1 0 0 .1",
      code: "M6 4.5 2.5 8 6 11.5M10 4.5 13.5 8 10 11.5",
      spark: "M8 2v3.2M8 10.8V14M2 8h3.2M10.8 8H14M4 4l2.2 2.2M9.8 9.8 12 12M4 12l2.2-2.2M9.8 6.2 12 4",
      type: "M3.5 5V3.5h9V5M8 3.5v9M6 12.5h4"
    }[props.name];
    var fill = props.name === "more";
    return h("svg", { width: props.size || 16, height: props.size || 16, viewBox: "0 0 16 16", "aria-hidden": "true", className: "hl-icon" },
      h("path", fill ? { d: d, fill: "currentColor" } : { d: d, fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }));
  }

  // ---------------------------------------------------------------- thumbnail with hover scrub
  function Thumb(props) {
    var item = props.item;
    var frames = item.framePaths || [];
    var mid = Math.floor(frames.length / 2);
    var _a = useState(mid), idx = _a[0], setIdx = _a[1];
    var _b = useState(false), hot = _b[0], setHot = _b[1];
    var timer = useRef(null), hold = useRef(0), box = useRef(null);
    var v = item.createdAt;

    function stop() { if (timer.current) { clearInterval(timer.current); timer.current = null; } }
    function play() {
      stop();
      if (frames.length < 2 || prefersReducedMotion()) return;
      var fps = Math.min(24, frames.length / Math.max(item.duration || 1, 0.1));
      timer.current = setInterval(function () {
        if (Date.now() < hold.current) return;
        setIdx(function (i) { return (i + 1) % frames.length; });
      }, 1000 / fps);
    }
    useEffect(function () { return stop; }, []);
    useEffect(function () {
      if (!hot || !frames.length) return;
      frames.forEach(function (f) { var i = new Image(); i.src = media.fileURL(f, v); });
    }, [hot]);

    useEffect(function () {
      if (props.autoplay) { setHot(true); play(); }
      return stop;
    }, [props.autoplay]);
    var onEnter = function () { setHot(true); play(); };
    var onLeave = function () { if (props.autoplay) return; setHot(false); stop(); setIdx(mid); };
    var onMove = function (e) {
      if (frames.length < 2 || !box.current) return;
      var r = box.current.getBoundingClientRect();
      var i = Math.max(0, Math.min(frames.length - 1, Math.floor((e.clientX - r.left) / r.width * frames.length)));
      hold.current = Date.now() + 700;
      setIdx(i);
    };

    var src = frames.length ? frames[Math.min(idx, frames.length - 1)] : (item.kind === "image" ? item.filePath : null);
    var badge = item.kind === "animation" || item.kind === "layers" ? fmtTime(hot && frames.length ? item.duration * idx / Math.max(frames.length - 1, 1) : item.duration)
      : item.width ? item.width + "×" + item.height : "";
    var fontFamily = useFontFace(item);
    var body = src ? h("img", { src: media.fileURL(src, v), alt: "", width: 160, height: 90, draggable: false, loading: props.autoplay ? "eager" : "lazy" })
      : item.kind === "expression" ? h("pre", { className: "hl-thumb-code" }, String(item.expression || "").slice(0, 220))
      : item.kind === "font" ? h("span", { className: "hl-thumb-font", style: fontFamily ? { fontFamily: fontFamily } : null }, "Aa")
      : h("span", { className: "hl-thumb-icon" }, h(Icon, { name: KIND_ICON[item.kind] || "film", size: 22 }));
    return h("span", { className: "hl-thumb" + (item.kind === "image" ? " is-image" : ""), ref: box, onPointerEnter: onEnter, onPointerLeave: onLeave, onPointerMove: onMove, onFocus: onEnter, onBlur: onLeave },
      body,
      hot && frames.length > 1 ? h("span", { className: "hl-playhead", style: { left: (idx / (frames.length - 1)) * 100 + "%" } }) : null,
      badge ? h("span", { className: "hl-badge num" }, badge) : null);
  }

  // A saved font previews in itself.
  var loadedFonts = {};
  function useFontFace(item) {
    var fam = item.kind === "font" && item.filePath ? "hlfont_" + String(item.dir).replace(/[^a-z0-9]/gi, "").slice(-24) : "";
    var _a = useState(fam && loadedFonts[fam] ? fam : ""), ready = _a[0], setReady = _a[1];
    useEffect(function () {
      if (!fam || loadedFonts[fam] || typeof FontFace === "undefined") return;
      try {
        var bytes = fs.readFileSync(item.filePath);
        var ff = new FontFace(fam, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        ff.load().then(function (f) { document.fonts.add(f); loadedFonts[fam] = true; setReady(fam); }, function () {});
      } catch (e) {}
    }, [fam]);
    return ready;
  }

  // ---------------------------------------------------------------- item card
  function blockedIn(item) { return !isAE && ((item.kind === "animation" || item.kind === "layers") && !item.aepPath && !item.videoPath || !!AE_ONLY[item.kind]); }
  var ADD_LABEL = isAE ? "Add to Comp" : "Add to Sequence";
  function Card(props) {
    var item = props.item;
    var blocked = blockedIn(item);
    var selecting = !!props.onSelect, selected = !!props.selected;
    return h("div", { className: "hl-card" + (blocked ? " is-blocked" : "") + (selecting ? " is-selecting" : "") + (selected ? " is-selected" : "") },
      h("div", { className: "hl-card-media" },
        h("button", {
          type: "button", className: "hl-card-open",
          onClick: function (e) {
            if (selecting) return props.onSelect(item);
            if ((e.metaKey || e.ctrlKey) && props.onStartSelect) return props.onStartSelect(item);
            props.onOpen(item);
          },
          "aria-pressed": selecting ? selected : undefined,
          "aria-label": selecting ? (selected ? "Unselect " : "Select ") + item.name : item.name + ", " + (KIND_LABEL[item.kind] || "item") + ". Show details"
        }, h(Thumb, { item: item })),
        selecting ? h("span", { className: "hl-check", "aria-hidden": "true" }, selected ? h(Icon, { name: "check", size: 13 }) : null) : null,
        !blocked && !selecting ? h("button", { type: "button", className: "hl-card-add", onClick: function () { props.onInsert(item); }, "aria-label": ADD_LABEL + ": " + item.name },
          h(Icon, { name: AE_ONLY[item.kind] ? "spark" : item.kind === "font" ? "type" : "add", size: 13 }), h("span", null, item.kind === "script" ? "Run" : AE_ONLY[item.kind] ? "Apply" : item.kind === "font" ? "Install" : "Add")) : null,
        item.pinned ? h("span", { className: "hl-pin", title: "Pinned to Home" }, h(Icon, { name: "pin", size: 12 })) : null),
      h("div", { className: "hl-card-meta" },
        h("span", { className: "hl-card-type", title: KIND_LABEL[item.kind] }, h(Icon, { name: KIND_ICON[item.kind] || "file", size: 13 })),
        h("span", { className: "hl-card-text" },
          h("span", { className: "hl-card-name trunc", title: item.name }, item.name),
          props.place || blocked ? h("span", { className: "hl-card-place trunc" }, blocked ? "Needs After Effects" : props.place) : null),
        h("button", { type: "button", className: "hl-card-more", "aria-label": "More for " + item.name, "aria-haspopup": "menu", onClick: function (e) { props.onMenu(item, e.currentTarget); } }, h(Icon, { name: "more" }))));
  }

  // Horizontal shelf for Pinned / Recent on Home.
  function Shelf(props) {
    if (!props.items.length) return null;
    return h("section", { className: "hl-shelf", "aria-label": props.title },
      h("div", { className: "hl-section-head" }, h("h2", null, props.title), props.side || null),
      h("div", { className: "hl-shelf-row" }, props.items.map(function (it) {
        return h(Card, { key: it.dir, item: it, place: scopeLabel(it.scope || {}), onOpen: props.onOpen, onInsert: props.onInsert, onMenu: props.onMenu });
      })));
  }

  // While AE works: what's happening and how long it has taken, so it never looks frozen.
  function Progress(props) {
    var _a = useState(0), sec = _a[0], setSec = _a[1];
    useEffect(function () {
      var t0 = Date.now(), id = setInterval(function () { setSec(Math.floor((Date.now() - t0) / 1000)); }, 500);
      return function () { clearInterval(id); };
    }, []);
    return h("div", { className: "hl-progress", role: "status" },
      h("div", { className: "meter" }, h("div", { className: "fill indeterminate" })),
      h("div", { className: "hl-progress-head" }, h("strong", null, props.title), h("span", { className: "dim num" }, sec + " s")),
      h("ul", null, props.steps.map(function (st) { return h("li", { key: st }, st); })),
      h("p", { className: "help" }, "After Effects is busy until this finishes. Big comps take longer."));
  }

  // ---------------------------------------------------------------- small menu
  function Menu(props) {
    var ref = useRef(null);
    useEffect(function () {
      var first = ref.current && ref.current.querySelector("button");
      if (first) first.focus();
      function off(e) { if (ref.current && !ref.current.contains(e.target)) props.onClose(); }
      function key(e) { if (e.key === "Escape") props.onClose(); }
      document.addEventListener("pointerdown", off, true);
      document.addEventListener("keydown", key);
      return function () { document.removeEventListener("pointerdown", off, true); document.removeEventListener("keydown", key); };
    }, []);
    return h("div", { className: "hl-menu", ref: ref, role: "menu", style: props.pos },
      props.items.map(function (it) {
        return h("button", { key: it.label, role: "menuitem", className: it.danger ? "is-danger" : "", onClick: function () { props.onClose(); it.run(); } }, it.label);
      }));
  }

  // ---------------------------------------------------------------- sheets
  function Sheet(props) {
    useEffect(function () {
      function key(e) { if (e.key === "Escape" && !props.busy) props.onClose(); }
      document.addEventListener("keydown", key);
      return function () { document.removeEventListener("keydown", key); };
    }, [props.busy]);
    return h("div", { className: "hl-sheet-wrap" },
      h("button", { className: "hl-scrim", "aria-label": "Close", tabIndex: -1, onClick: function () { if (!props.busy) props.onClose(); } }),
      h("form", { className: "hl-sheet" + (props.tall ? " is-tall" : ""), onSubmit: function (e) { e.preventDefault(); if (!props.busy) props.onSubmit(); } },
        h("div", { className: "hl-sheet-head" },
          h("h2", null, props.title),
          h("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: props.onClose, disabled: props.busy }, h(Icon, { name: "x" }))),
        props.children,
        props.error ? h("p", { className: "hl-error", role: "alert" }, props.error) : null,
        props.submit ? h("div", { className: "hl-sheet-foot" },
          h("button", { type: "submit", className: "primary", disabled: props.busy || props.disabled }, props.busy ? props.busyLabel : props.submit)) : null));
  }
  function Field(props) {
    return h("label", { className: "field" }, h("span", null, props.label), props.children, props.hint ? h("span", { className: "hl-hint" }, props.hint) : null);
  }
  // "Save to" list. The last option makes a new client right here, without leaving the sheet.
  function ScopeSelect(props) {
    var _a = useState(false), adding = _a[0], setAdding = _a[1];
    var _b = useState(""), name = _b[0], setName = _b[1];
    var _c = useState(""), err = _c[0], setErr = _c[1];
    var _d = useState([]), extra = _d[0], setExtra = _d[1];
    var list = props.scopes.concat(extra.filter(function (x) { return !props.scopes.some(function (s) { return sameScope(s, x); }); }));
    function create() {
      try {
        var c = store.createClient(name);
        var sc = { client: c };
        setExtra(extra.concat([sc])); props.onChange(sc); setAdding(false); setName(""); setErr("");
      } catch (e) { setErr(e.message); }
    }
    if (adding) {
      return h(Field, { label: "New client" },
        h("div", { className: "hl-inline-new" },
          h("input", { value: name, onChange: function (e) { setName(e.target.value); }, placeholder: "Client name…", autoFocus: true, autoComplete: "off", spellCheck: false, name: "new-client",
            onKeyDown: function (e) { if (e.key === "Enter") { e.preventDefault(); create(); } if (e.key === "Escape") { e.stopPropagation(); setAdding(false); } } }),
          h("button", { type: "button", className: "ghost tight", onClick: create }, "Create"),
          h("button", { type: "button", className: "ghost tight", onClick: function () { setAdding(false); setErr(""); } }, "Cancel")),
        err ? h("span", { className: "hl-error" }, err) : null);
    }
    return h(Field, { label: props.label || "Save to" },
      h("select", { value: scopeKey(props.value), onChange: function (e) {
        if (e.target.value === "__new") return setAdding(true);
        props.onChange(list.filter(function (s) { return scopeKey(s) === e.target.value; })[0]);
      } },
        list.map(function (s) { return h("option", { key: scopeKey(s), value: scopeKey(s) }, scopeLabel(s)); }),
        h("option", { value: "__new" }, "+ New client…")));
  }

  function SaveSheet(props) {
    var info = props.info || {};
    var comp = info.comp;
    var _a = useState(props.kind === "layers" || props.kind === "preset" ? "" : comp ? comp.name : ""), name = _a[0], setName = _a[1];
    var _f = useState(readPref("still", "0") === "1"), still = _f[0], setStill = _f[1];
    var _b = useState(props.scope), to = _b[0], setTo = _b[1];
    var _c = useState(false), video = _c[0], setVideo = _c[1];
    var _d = useState(false), busy = _d[0], setBusy = _d[1];
    var _e = useState(""), err = _e[0], setErr = _e[1];
    var what = props.kind === "preset"
      ? (info.selectedLayers ? "The effects and animation of the first selected layer in " + comp.name + ". Apply them to any layer later." : "Select the layer whose effects and animation you want to save.")
      : props.kind === "layers"
      ? (info.selectedLayers ? info.selectedLayers + (info.selectedLayers === 1 ? " layer" : " layers") + " from " + comp.name : "Select layers in the timeline first.")
      : (comp ? comp.name + ", " + comp.width + "×" + comp.height + ", " + fmtTime(comp.duration) : "Open a comp, or select one in the Project panel.");
    var ready = props.kind === "layers" || props.kind === "preset" ? info.selectedLayers > 0 : !!comp;

    function submit() {
      var n = store.cleanName(name);
      if (!n) return setErr("Type a name, like “Subscribe button”.");
      setBusy(true); setErr("");
      var dir = store.newItem(to, n);
      writePref("still", still ? "1" : "0");
      call("saveItem", { kind: props.kind, dir: dir, name: n, video: props.kind === "animation" && video, still: still }).then(function (r) {
        store.saveItem(dir, Object.assign({ kind: props.kind, name: n, aep: "item.aep" }, r));
        props.onDone(n, to, Object.assign({ wantedVideo: props.kind === "animation" && video }, r));
      }, function (e) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (x) {}
        setBusy(false); setErr(e.message);
      });
    }
    return h(Sheet, {
      title: props.kind === "preset" ? "Save Effects & Animation" : props.kind === "layers" ? "Save Layers" : "Save Comp", submit: props.kind === "preset" ? "Save" : props.kind === "layers" ? "Save Layers" : "Save Comp",
      busy: busy, busyLabel: "Saving…", disabled: !ready, error: err, onClose: props.onClose, onSubmit: submit
    },
      busy ? h(Progress, { title: "Saving " + name, steps: ["Saving your project", "Copying the comp and every file and font it uses", (still ? "Saving a still frame" : "Rendering the hover preview") + (props.kind === "animation" && video ? " and the Premiere video" : ""), "Reopening your project"] }) : null,
      busy ? null : h("p", { className: "hl-what" + (ready ? "" : " is-warn") }, what),
      busy ? null : h(Field, { label: "Name" }, h("input", { value: name, onChange: function (e) { setName(e.target.value); }, placeholder: "Subscribe button…", autoFocus: true, autoComplete: "off", spellCheck: false, name: "item-name" })),
      busy ? null : h(ScopeSelect, { scopes: props.scopes, value: to, onChange: setTo }),
      busy ? null : h(Field, { label: "Preview" }, h("div", { className: "seg", role: "radiogroup", "aria-label": "Preview" },
        h("button", { type: "button", role: "radio", "aria-checked": !still, className: !still ? "on" : "", onClick: function () { setStill(false); } }, "Plays on hover"),
        h("button", { type: "button", role: "radio", "aria-checked": still, className: still ? "on" : "", onClick: function () { setStill(true); } }, "Still frame (faster)"))),
      !busy && props.kind === "animation" ? h("label", { className: "check-inline" }, h("input", { type: "checkbox", checked: video, onChange: function (e) { setVideo(e.target.checked); } }), "Also make a video for Premiere (only needed if Dynamic Link isn’t available)") : null,
      busy ? null : h("p", { className: "help" }, "Your project is saved first. The library keeps its own copy of every file this uses, so you can delete the original project later."));
  }

  function FilesSheet(props) {
    var start = props.size || { w: 1920, h: 1080, mode: "crop" };
    var startId = start.mode === "original" ? "original" : (SIZES.filter(function (s) { return s.w === start.w && s.h === start.h; })[0] || { id: "custom" }).id;
    var single = props.files.length === 1;
    var base = function (f) { return path.basename(f, path.extname(f)); };
    var _a = useState(single ? base(props.files[0]) : ""), name = _a[0], setName = _a[1];
    var _b = useState(startId), sizeId = _b[0], setSizeId = _b[1];
    var _c = useState(String(start.w || 1920)), cw = _c[0], setCw = _c[1];
    var _d = useState(String(start.h || 1080)), ch = _d[0], setCh = _d[1];
    var _e = useState(start.mode === "tall" ? "tall" : "crop"), mode = _e[0], setMode = _e[1];
    var _f = useState(props.scope), to = _f[0], setTo = _f[1];
    var _g = useState(false), busy = _g[0], setBusy = _g[1];
    var _h = useState(""), err = _h[0], setErr = _h[1];
    var anyImage = props.files.some(function (f) { return /\.(png|jpe?g|webp|bmp|gif)$/i.test(f); });

    function size() {
      if (sizeId === "original") return { mode: "original" };
      var s = SIZES.filter(function (x) { return x.id === sizeId; })[0];
      var w = s && s.w ? s.w : parseInt(cw, 10), hh = s && s.h ? s.h : parseInt(ch, 10);
      return { w: w, h: hh, mode: mode };
    }
    function submit() {
      var sz = size();
      if (sz.mode !== "original" && !(sz.w >= 16 && sz.w <= 8192 && sz.h >= 16 && sz.h <= 8192)) return setErr("Use a width and height between 16 and 8192 pixels.");
      setBusy(true); setErr("");
      var done = 0, notes = [];
      var chain = Promise.resolve();
      props.files.forEach(function (f) {
        chain = chain.then(function () {
          var n = store.cleanName(single && name ? name : base(f)) || "Image";
          var dir = store.newItem(to, n);
          return media.addFile({ fs: fs, path: path }, f, dir, sz).then(function (r) {
            if (r.trimmed) notes.push(n + " was cut at 16384 px tall");
            store.saveItem(dir, Object.assign({ name: n }, r));
            done++;
          }, function (e) {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (x) {}
            notes.push(e.message);
          });
        });
      });
      chain.then(function () {
        if (to.client) store.setClientMeta(to.client, { imageSize: sz });
        props.onDone(done, to, notes);
      });
    }
    return h(Sheet, { title: single ? "Add File" : "Add " + props.files.length + " Files", submit: "Add to Library", busy: busy, busyLabel: "Adding…", error: err, onClose: props.onClose, onSubmit: submit },
      h("ul", { className: "hl-files" }, props.files.map(function (f) { return h("li", { key: f, className: "trunc" }, path.basename(f)); })),
      single ? h(Field, { label: "Name" }, h("input", { value: name, onChange: function (e) { setName(e.target.value); }, autoComplete: "off", spellCheck: false, name: "file-name" })) : null,
      anyImage ? h(Field, { label: "Image size", hint: "The file itself is resized, so it always comes in at 100%." },
        h("select", { value: sizeId, onChange: function (e) { setSizeId(e.target.value); } }, SIZES.map(function (s) { return h("option", { key: s.id, value: s.id }, s.label); }))) : null,
      anyImage && sizeId === "custom" ? h("div", { className: "hl-row2" },
        h(Field, { label: "Width" }, h("input", { value: cw, inputMode: "numeric", onChange: function (e) { setCw(e.target.value.replace(/\D/g, "")); }, name: "w", autoComplete: "off" })),
        h(Field, { label: "Height" }, h("input", { value: ch, inputMode: "numeric", onChange: function (e) { setCh(e.target.value.replace(/\D/g, "")); }, name: "h", autoComplete: "off" }))) : null,
      anyImage && sizeId !== "original" ? h("div", { className: "seg", role: "radiogroup", "aria-label": "When the shape is different" },
        h("button", { type: "button", role: "radio", "aria-checked": mode === "crop", className: mode === "crop" ? "on" : "", onClick: function () { setMode("crop"); } }, "Crop to Size"),
        h("button", { type: "button", role: "radio", "aria-checked": mode === "tall", className: mode === "tall" ? "on" : "", onClick: function () { setMode("tall"); } }, "Keep Full Height")) : null,
      anyImage && sizeId !== "original" ? h("p", { className: "help" }, mode === "crop"
        ? "Fills the size exactly. Tall website shots keep the top of the page."
        : "Width is fixed, height follows the image. Good for scrolling website shots.") : null,
      h(ScopeSelect, { scopes: props.scopes, value: to, onChange: setTo }));
  }

  function ExpressionSheet(props) {
    var _a = useState(props.expr.prop + " expression"), name = _a[0], setName = _a[1];
    var _b = useState(props.scope), to = _b[0], setTo = _b[1];
    var _c = useState(""), err = _c[0], setErr = _c[1];
    function submit() {
      var n = store.cleanName(name);
      if (!n) return setErr("Type a name, like \u201CWiggle 2 per second\u201D.");
      var dir = store.newItem(to, n);
      store.saveItem(dir, { kind: "expression", name: n, expression: props.expr.expression, prop: props.expr.prop, matchName: props.expr.matchName });
      props.onDone(n, to);
    }
    return h(Sheet, { title: "Save Expression", submit: "Save Expression", error: err, onClose: props.onClose, onSubmit: submit },
      h("pre", { className: "hl-code" }, props.expr.expression),
      h(Field, { label: "Name" }, h("input", { value: name, onChange: function (e) { setName(e.target.value); }, autoFocus: true, autoComplete: "off", spellCheck: false, name: "expr-name" })),
      h(ScopeSelect, { scopes: props.scopes, value: to, onChange: setTo }));
  }

  function ColorSheet(props) {
    var _a = useState(""), name = _a[0], setName = _a[1];
    var _b = useState("#"), hex = _b[0], setHex = _b[1];
    var _c = useState(""), err = _c[0], setErr = _c[1];
    var valid = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim());
    var preview = valid ? store.normalHex(hex) : "#000000";
    function submit() {
      try { store.addColor(props.scope, name, hex); props.onDone(); } catch (e) { setErr(e.message); }
    }
    return h(Sheet, { title: "Add Colour", submit: "Add Colour", error: err, onClose: props.onClose, onSubmit: submit, disabled: !valid },
      h("p", { className: "hl-what" }, "For " + scopeLabel(props.scope)),
      h("div", { className: "hl-color-row" },
        h("input", { type: "color", value: preview, "aria-label": "Pick a colour", onChange: function (e) { setHex(e.target.value.toUpperCase()); } }),
        h(Field, { label: "Colour code" }, h("input", { value: hex, onChange: function (e) { setHex(e.target.value); }, placeholder: "#1C83FF…", autoFocus: true, spellCheck: false, autoComplete: "off", name: "hex", className: "num" }))),
      h(Field, { label: "Name" }, h("input", { value: name, onChange: function (e) { setName(e.target.value); }, placeholder: "Brand blue…", autoComplete: "off", name: "color-name" })));
  }

  function NameSheet(props) {
    var _a = useState(props.value || ""), name = _a[0], setName = _a[1];
    var _b = useState(""), err = _b[0], setErr = _b[1];
    function submit() { try { props.onSubmit(name); } catch (e) { setErr(e.message); } }
    return h(Sheet, { title: props.title, submit: props.submit, error: err, onClose: props.onClose, onSubmit: submit },
      h(Field, { label: props.label }, h("input", { value: name, onChange: function (e) { setName(e.target.value); }, placeholder: props.placeholder, autoFocus: true, autoComplete: "off", spellCheck: false, name: "name" })));
  }

  function MoveSheet(props) {
    var _a = useState(props.scopes.filter(function (s) { return !sameScope(s, props.from); })[0] || props.from), to = _a[0], setTo = _a[1];
    return h(Sheet, { title: "Move " + props.item.name, submit: "Move", onClose: props.onClose, onSubmit: function () { props.onSubmit(to); } },
      h(ScopeSelect, { scopes: props.scopes, value: to, onChange: setTo, label: "Move to" }));
  }

  var LAYER_KIND = { text: "Text", shape: "Shape", camera: "Camera", light: "Light", "null": "Null", adjustment: "Adjustment", precomp: "Precomp", solid: "Solid", image: "Image", audio: "Audio", video: "Video", layer: "Layer" };

  function ProjectFileSheet(props) {
    var fileName = path.basename(props.file);
    var _a = useState(null), scan = _a[0], setScan = _a[1];
    var _b = useState(""), err = _b[0], setErr = _b[1];
    var _c = useState(""), q = _c[0], setQ = _c[1];
    var _d = useState(null), comp = _d[0], setComp = _d[1];
    var _e = useState({}), checked = _e[0], setChecked = _e[1];
    var _f = useState(""), name = _f[0], setName = _f[1];
    var _g = useState("animation"), kind = _g[0], setKind = _g[1];
    var _h = useState(props.scope), to = _h[0], setTo = _h[1];
    var _i = useState(false), video = _i[0], setVideo = _i[1];
    var _j = useState(false), busy = _j[0], setBusy = _j[1];

    useEffect(function () {
      call("scanProjectFile", { path: props.file }).then(function (r) {
        setScan(r);
        if (r.comps.length === 1) pick(r.comps[0]);
      }, function (e) { setErr(e.message); setScan({ comps: [] }); });
    }, []);

    function pick(c) {
      var all = {};
      c.layers.forEach(function (l) { all[l.index] = true; });
      setComp(c); setChecked(all); setName(c.name); setKind("animation"); setErr("");
    }
    var chosen = comp ? comp.layers.filter(function (l) { return checked[l.index]; }) : [];
    var allOn = comp && chosen.length === comp.layers.length;
    function toggle(i) { var n = Object.assign({}, checked); n[i] = !n[i]; setChecked(n); }
    function toggleAll() {
      var n = {};
      if (!allOn) comp.layers.forEach(function (l) { n[l.index] = true; });
      setChecked(n);
    }

    function submit() {
      if (!comp) return;
      if (!chosen.length) return setErr("Tick at least one layer.");
      var n = store.cleanName(name);
      if (!n) return setErr("Type a name, like “Link in description”.");
      setBusy(true); setErr("");
      var dir = store.newItem(to, n);
      var wantVideo = kind === "animation" && video;
      call("saveFromFile", {
        path: props.file, compIndex: comp.index, compName: comp.name,
        layers: allOn ? [] : chosen.map(function (l) { return l.index; }),
        kind: kind, dir: dir, name: n, video: wantVideo
      }).then(function (r) {
        store.saveItem(dir, Object.assign({ kind: kind, name: n, aep: "item.aep", source: fileName }, r));
        props.onDone(n, to, Object.assign({ wantedVideo: wantVideo }, r));
      }, function (e) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (x) {}
        setBusy(false); setErr(e.message);
      });
    }

    var body;
    if (busy) {
      body = h(Progress, { title: "Saving " + name, steps: ["Saving your project", "Reading " + fileName, "Copying " + (allOn ? "the comp" : plural(chosen.length, "layer")) + " and every file it uses", "Rendering the hover preview", "Reopening your project"] });
    } else if (!scan) {
      body = h("div", { className: "hl-loading" },
        h("div", { className: "meter" }, h("div", { className: "fill indeterminate" })),
        h("p", { className: "help" }, "Reading " + fileName + "… Big projects take a moment. Your project isn’t changed."));
    } else if (!comp) {
      var list = scan.comps.filter(function (c) {
        return !q || (c.name + " " + c.folder).toLowerCase().indexOf(q.toLowerCase()) !== -1;
      });
      body = h("div", null,
        scan.comps.length ? h("label", { className: "hl-search" }, h(Icon, { name: "search", size: 14 }),
          h("input", { type: "search", value: q, onChange: function (e) { setQ(e.target.value); }, placeholder: "Search " + scan.comps.length + " comps…", "aria-label": "Search comps", autoFocus: true, autoComplete: "off", spellCheck: false, name: "comp-q" })) : null,
        h("div", { className: "hl-pick-list", role: "list" }, list.map(function (c) {
          return h("button", { key: c.index, type: "button", role: "listitem", className: "hl-pick", onClick: function () { pick(c); } },
            h("span", { className: "row-text" },
              h("span", { className: "row-name trunc" }, c.name),
              h("span", { className: "row-desc trunc" }, (c.folder ? c.folder + ", " : "") + c.width + "×" + c.height + ", " + fmtTime(c.duration) + ", " + c.layers.length + (c.layers.length === 1 ? " layer" : " layers"))),
            h(Icon, { name: "chevron", size: 12 }));
        }), scan.comps.length && !list.length ? h("p", { className: "empty" }, "No comp matches “" + q + "”.") : null));
    } else {
      body = h("div", null,
        h("div", { className: "hl-pick-head" },
          scan.comps.length > 1 ? h("button", { type: "button", className: "ghost tight", onClick: function () { setComp(null); }, disabled: busy }, h(Icon, { name: "back", size: 12 }), "All Comps") : null,
          h("span", { className: "trunc" }, comp.name, h("span", { className: "dim" }, "  " + comp.width + "×" + comp.height + ", " + fmtTime(comp.duration)))),
        h("div", { className: "hl-layers" },
          h("label", { className: "hl-layer is-all" }, h("input", { type: "checkbox", checked: !!allOn, onChange: toggleAll, disabled: busy }),
            h("span", { className: "grow" }, "All layers"), h("span", { className: "dim num" }, chosen.length + " of " + comp.layers.length)),
          comp.layers.map(function (l) {
            return h("label", { key: l.index, className: "hl-layer" },
              h("input", { type: "checkbox", checked: !!checked[l.index], onChange: function () { toggle(l.index); }, disabled: busy }),
              h("span", { className: "hl-layer-num num dim" }, l.index),
              h("span", { className: "grow trunc" }, l.name),
              h("span", { className: "dim" }, LAYER_KIND[l.kind] || ""));
          })),
        h(Field, { label: "Name" }, h("input", { value: name, onChange: function (e) { setName(e.target.value); }, autoComplete: "off", spellCheck: false, name: "pf-name" })),
        h("div", { className: "seg", role: "radiogroup", "aria-label": "When you add it" },
          h("button", { type: "button", role: "radio", "aria-checked": kind === "animation", className: kind === "animation" ? "on" : "", onClick: function () { setKind("animation"); } }, "Add as One Precomp"),
          h("button", { type: "button", role: "radio", "aria-checked": kind === "layers", className: kind === "layers" ? "on" : "", onClick: function () { setKind("layers"); } }, "Add as Layers")),
        h(ScopeSelect, { scopes: props.scopes, value: to, onChange: setTo }),
        kind === "animation" ? h("label", { className: "check-inline" }, h("input", { type: "checkbox", checked: video, onChange: function (e) { setVideo(e.target.checked); } }), "Also make a video for Premiere") : null,
        h("p", { className: "help" }, busy
          ? "After Effects is copying this comp and every file it uses out of " + fileName + " into the library, then rendering a preview. Your project reopens when it’s done."
          : "Videos, images and other files this uses are copied into the library, so they stay even if you delete " + fileName + "."));
    }
    return h(Sheet, {
      title: "From " + fileName, submit: "Save to Library", busy: busy, busyLabel: "Saving…",
      disabled: !comp || !chosen.length, error: err, onClose: props.onClose, onSubmit: submit, tall: true
    }, body);
  }

  // Text fields + colour swaps applied while adding (After Effects only).
  function ChangesPanel(props) {
    var item = props.item, insp = props.inspect;
    if (props.error) return h("p", { className: "hl-what is-warn" }, props.error);
    if (!insp) return h("div", { className: "hl-changes is-loading" }, h("div", { className: "meter" }, h("div", { className: "fill indeterminate" })), h("p", { className: "help" }, "Reading text and colours…"));
    var texts = insp.texts || [], colors = insp.colors || [];
    if (!texts.length && !colors.length) return null;
    var multiComp = texts.some(function (t) { return t.comp !== texts[0].comp; });
    var brandOpts = props.brands;
    var brand = brandOpts.filter(function (b) { return b.key === props.brandKey; })[0] || brandOpts[0];
    var pal = brand ? brand.palette : [];
    return h("div", { className: "hl-changes" },
      h("h3", { className: "hl-sub" }, "Change before adding"),
      texts.length ? h("div", { className: "hl-texts" }, texts.map(function (t, i) {
        var key = t.comp + "#" + t.index;
        return h("label", { key: key, className: "field" },
          h("span", null, t.name + (multiComp ? "  (" + t.comp + ")" : ""), t.animated ? h("span", { className: "hl-hint" }, "  animated, can’t be changed here") : null),
          t.animated ? h("input", { value: t.text, disabled: true, title: "This text is animated, so it isn't changed here." })
            : h("input", { value: props.textVals[key] !== undefined ? props.textVals[key] : t.text, onChange: function (e) { props.onText(key, e.target.value); }, autoComplete: "off", spellCheck: false, name: "t" + i }));
      })) : null,
      colors.length ? h("div", { className: "hl-recolor" },
        h("div", { className: "hl-recolor-head" },
          h("span", { className: "hl-recolor-label" }, "Colours"),
          brandOpts.length ? h("select", { value: brand ? brand.key : "", onChange: function (e) { props.onBrand(e.target.value); }, "aria-label": "Brand colours from" },
            brandOpts.map(function (b) { return h("option", { key: b.key, value: b.key }, b.label); })) : null,
          brandOpts.length ? h("button", { type: "button", className: "ghost tight", onClick: function () { props.onMatch(pal); }, disabled: !pal.length }, "Match") : null,
          h("button", { type: "button", className: "ghost tight", onClick: props.onReset }, "Reset")),
        !brandOpts.length ? h("p", { className: "help" }, "Add brand colours to a client to swap these in one click.") : null,
        h("div", { className: "hl-swaps" }, colors.map(function (c) {
          var to = props.colorVals[c.hex] || "";
          return h("div", { key: c.hex, className: "hl-swap" },
            h("span", { className: "hl-chipcolor", style: { background: c.hex }, title: c.hex }),
            h(Icon, { name: "chevron", size: 12 }),
            h("span", { className: "hl-chipcolor" + (to ? "" : " is-keep"), style: to ? { background: to } : null, title: to || "Keep" }),
            h("select", { value: to, onChange: function (e) { props.onColor(c.hex, e.target.value); }, "aria-label": "Replace " + c.hex },
              h("option", { value: "" }, "Keep " + c.hex),
              pal.map(function (p, i) { return h("option", { key: i + p.hex, value: p.hex }, (p.name || p.hex) + " " + p.hex); })));
        }))) : null);
  }

  var dateFmt = (function () { try { return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return null; } })();
  var timeFmt = (function () { try { return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch (e) { return null; } })();

  function TagEditor(props) {
    var _a = useState(props.tags || []), tags = _a[0], setTags = _a[1];
    var _b = useState(""), text = _b[0], setText = _b[1];
    function save(next) { setTags(next); props.onChange(next); }
    function add(v) {
      var parts = String(v).split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      if (!parts.length) return;
      save(tags.concat(parts.filter(function (p) { return !tags.some(function (t) { return t.toLowerCase() === p.toLowerCase(); }); })));
      setText("");
    }
    var listId = "hl-tags-" + props.id;
    var unused = props.suggestions.filter(function (sg) { return !tags.some(function (t) { return t.toLowerCase() === sg.tag.toLowerCase(); }); });
    return h("div", { className: "hl-tag-editor" },
      h("h3", { className: "hl-sub" }, "Tags"),
      h("div", { className: "hl-tag-row" },
        tags.map(function (t) {
          return h("span", { key: t, className: "hl-tag" }, t,
            h("button", { type: "button", "aria-label": "Remove tag " + t, onClick: function () { save(tags.filter(function (x) { return x !== t; })); } }, h(Icon, { name: "x", size: 10 })));
        }),
        h("input", { value: text, list: listId, placeholder: tags.length ? "Add tag…" : "Add tags like CTA, lower third…", autoComplete: "off", spellCheck: false, name: "tag", "aria-label": "Add tag",
          onChange: function (e) { if (/,$/.test(e.target.value)) add(e.target.value); else setText(e.target.value); },
          onKeyDown: function (e) {
            if (e.key === "Enter") { e.preventDefault(); add(text); }
            if (e.key === "Backspace" && !text && tags.length) save(tags.slice(0, -1));
          },
          onBlur: function () { if (text) add(text); } }),
        h("datalist", { id: listId }, unused.slice(0, 30).map(function (sg) { return h("option", { key: sg.tag, value: sg.tag }); }))),
      unused.length ? h("div", { className: "hl-tag-suggest" }, unused.slice(0, 6).map(function (sg) {
        return h("button", { key: sg.tag, type: "button", className: "hl-tag is-suggest", onClick: function () { add(sg.tag); } }, h(Icon, { name: "plus", size: 10 }), sg.tag);
      })) : null);
  }

  function Versions(props) {
    var list = props.versions;
    if (!list.length) return null;
    return h("div", { className: "hl-versions" },
      h("h3", { className: "hl-sub" }, "Older versions"),
      h("ul", null, list.map(function (v) {
        return h("li", { key: v.id },
          h("span", { className: "grow" }, timeFmt ? timeFmt.format(new Date(v.savedAt)) : v.id,
            h("span", { className: "dim" }, (v.duration ? "  " + fmtTime(v.duration) : "") + (v.layers ? ", " + plural(v.layers, "layer") : ""))),
          h("button", { type: "button", className: "ghost tight", onClick: function () { props.onRestore(v); } }, "Restore"));
      })),
      h("p", { className: "help" }, "Restoring keeps the current version here too, so nothing is lost."));
  }

  function UpdateSheet(props) {
    var item = props.item, info = props.info || {}, comp = info.comp;
    var layersKind = item.kind === "layers";
    var _a = useState(!!item.video), video = _a[0], setVideo = _a[1];
    var _b = useState(false), busy = _b[0], setBusy = _b[1];
    var _c = useState(""), err = _c[0], setErr = _c[1];
    var ready = layersKind ? info.selectedLayers > 0 : !!comp;
    var what = layersKind
      ? (info.selectedLayers ? plural(info.selectedLayers, "layer") + " from " + comp.name : "Select the layers to save in the timeline first.")
      : (comp ? comp.name + ", " + comp.width + "×" + comp.height + ", " + fmtTime(comp.duration) : "Open the comp to save, or select it in the Project panel.");
    function submit() {
      setBusy(true); setErr("");
      var keep;
      try { keep = store.beginUpdate(item.dir); } catch (e) { setBusy(false); return setErr(e.message); }
      call("saveItem", { kind: item.kind, dir: item.dir, name: item.name, video: !layersKind && video }).then(function (r) {
        store.finishUpdate(item.dir, keep, Object.assign({ kind: item.kind, aep: "item.aep" }, r));
        props.onDone(r);
      }, function (e) {
        try { store.cancelUpdate(item.dir); } catch (x) {}
        setBusy(false); setErr(e.message + " Your saved version wasn’t changed.");
      });
    }
    return h(Sheet, { title: "Update " + item.name, submit: "Update " + (layersKind ? "Layers" : "Comp"), busy: busy, busyLabel: "Updating…", disabled: !ready, error: err, onClose: props.onClose, onSubmit: submit },
      busy ? h(Progress, { title: "Updating " + item.name, steps: ["Saving your project", "Keeping the current version as an older version", "Copying the " + (layersKind ? "layers" : "comp") + " and every file it uses", "Rendering the hover preview", "Reopening your project"] }) : null,
      busy ? null : h("p", { className: "hl-what" + (ready ? "" : " is-warn") }, what),
      !busy && !layersKind ? h("label", { className: "check-inline" }, h("input", { type: "checkbox", checked: video, onChange: function (e) { setVideo(e.target.checked); } }), "Also make a video for Premiere") : null,
      busy ? null : h("p", { className: "help" }, "This replaces " + item.name + " with what you have open now. The current version is kept under Older versions, so you can restore it."));
  }
  function DetailsSheet(props) {
    var item = props.item;
    var canChange = isAE && (item.kind === "animation" || item.kind === "layers") && item.aepPath;
    var _a = useState(item.inspect || null), insp = _a[0], setInsp = _a[1];
    var _b = useState(""), inspErr = _b[0], setInspErr = _b[1];
    var _c = useState({}), textVals = _c[0], setTextVals = _c[1];
    var _d = useState({}), colorVals = _d[0], setColorVals = _d[1];
    var brands = props.brands;
    var defaultBrand = (brands.filter(function (b) { return b.key === props.brandKey; })[0] || brands[0] || {}).key || "";
    var _e = useState(defaultBrand), brandKey = _e[0], setBrandKey = _e[1];
    var _f = useState(function () { try { return store.listVersions(item.dir); } catch (e) { return []; } }), versions = _f[0];
    useEffect(function () {
      if (!canChange || insp) return;
      call("inspectItem", { aep: item.aepPath }).then(function (r) {
        var v = { v: 1, texts: r.texts, colors: r.colors };
        try { store.saveItem(item.dir, { inspect: v }); } catch (e) {}
        setInsp(v);
      }, function (e) { setInspErr("Couldn't read this item’s text and colours: " + e.message); });
    }, []);
    var texts = [];
    Object.keys(textVals).forEach(function (k) {
      var orig = (insp && insp.texts || []).filter(function (t) { return t.comp + "#" + t.index === k; })[0];
      if (orig && textVals[k] !== orig.text) texts.push({ comp: orig.comp, index: orig.index, text: textVals[k] });
    });
    var colors = Object.keys(colorVals).filter(function (k) { return colorVals[k]; }).map(function (k) { return { from: k, to: colorVals[k] }; });
    var changes = texts.length + colors.length;

    var rows = [];
    function row(k, v) { if (v || v === 0) rows.push(h("div", { key: k, className: "hl-detail-row" }, h("dt", null, k), h("dd", null, v))); }
    row("Type", KIND_LABEL[item.kind]);
    row("In", scopeLabel(props.scope));
    if (item.width) row("Size", item.width + " × " + item.height + (item.fps ? ", " + Math.round(item.fps * 100) / 100 + " fps" : ""));
    if (item.duration) row("Length", fmtTime(item.duration));
    if (item.layers) row("Layers", item.layers);
    if (item.copied !== undefined) row("Files kept", plural(item.copied, "file") + " copied into the library");
    if (item.missing && item.missing.length) row("Missing", item.missing.join(", "));
    if (item.fonts && item.fonts.length) row("Fonts needed", item.fonts.join(", "));
    if (item.source) row("From", item.source);
    if (item.createdAt && dateFmt) row("Saved", dateFmt.format(new Date(item.createdAt)));
    if (item.updatedAt && dateFmt) row("Updated", dateFmt.format(new Date(item.updatedAt)));
    var blocked = blockedIn(item);
    function act(label, fn, cls) { return h("button", { type: "button", className: "ghost" + (cls ? " " + cls : ""), onClick: fn }, label); }
    return h(Sheet, {
      title: item.name, submit: blocked ? null : changes ? "Add with " + plural(changes, "Change") : ADD_LABEL,
      onClose: props.onClose, onSubmit: function () { props.onInsert(item, changes ? { texts: texts, colors: colors } : null); }, tall: true
    },
      h("div", { className: "hl-detail-preview" }, h(Thumb, { item: item, autoplay: true })),
      blocked ? h("p", { className: "hl-what is-warn" }, "This item has no project file. Save it again in After Effects.") : null,
      canChange ? h(ChangesPanel, {
        item: item, inspect: insp, error: inspErr, textVals: textVals, colorVals: colorVals, brands: brands, brandKey: brandKey,
        onText: function (k, v) { var n = Object.assign({}, textVals); n[k] = v; setTextVals(n); },
        onColor: function (k, v) { var n = Object.assign({}, colorVals); n[k] = v; setColorVals(n); },
        onBrand: setBrandKey,
        onMatch: function (pal) {
          var n = {};
          colorsLib.autoMatch(insp.colors, pal).forEach(function (m) { if (m.to) n[m.from] = m.to; });
          setColorVals(n);
        },
        onReset: function () { setColorVals({}); setTextVals({}); }
      }) : null,
      h(TagEditor, { id: item.dir.length, tags: item.tags || [], suggestions: props.tagSuggestions, onChange: props.onTags }),
      h("dl", { className: "hl-details" }, rows),
      h("div", { className: "hl-detail-actions" },
        canChange ? h("button", { type: "button", className: "ghost", onClick: props.onUpdate, title: "Replace this item with the comp or layers you have open now" }, "Update…") : null,
        act(item.pinned ? "Unpin" : "Pin to Home", props.onPin),
        act("Rename…", props.onRename),
        act("Move To…", props.onMove),
        act("Export…", props.onExport),
        act("Show in Folder", props.onShow),
        act("Delete", props.onDelete, "is-danger")),
      h(Versions, { versions: versions, onRestore: props.onRestore }));
  }

  function SettingsSheet(props) {
    var _a = useState(store.root()), root = _a[0], setRoot = _a[1];
    var _b = useState("all"), what = _b[0], setWhat = _b[1];
    var _c = useState(""), note = _c[0], setNote = _c[1];
    var _d = useState(null), out = _d[0], setOut = _d[1];
    var choices = [{ key: "all", label: "Everything" }].concat(props.scopes.map(function (sc) { return { key: scopeKey(sc), label: scopeLabel(sc), scope: sc }; }));
    function pick() {
      deps.pickFolder(root, "Choose the library folder").then(function (p) { if (p) setRoot(p); });
    }
    function doExport() {
      var c = choices.filter(function (x) { return x.key === what; })[0];
      deps.pickFolder("", "Choose where to save the export").then(function (dest) {
        if (!dest) return;
        try {
          var dir = store.exportTo(c.scope || null, dest);
          setOut(dir); setNote("Exported " + c.label + " to “" + path.basename(dir) + "”. Copy that folder to another computer or send it to a friend, then use Import from Folder there.");
        } catch (e) { setOut(null); setNote(e.message); }
      });
    }
    function doImport() {
      deps.pickFolder("", "Pick a Comp Vault export folder").then(function (src) {
        if (!src) return;
        try {
          var n = store.importFrom(src);
          setOut(null); setNote(n ? "Added " + n + (n === 1 ? " item" : " items") + " to your library. Items you already had were skipped." : "Nothing new: you already have everything in that folder.");
          props.onChanged();
        } catch (e) { setOut(null); setNote(e.message); }
      });
    }
    return h(Sheet, { title: "Settings", submit: root === store.root() ? "Done" : "Use This Folder", onClose: props.onClose, onSubmit: function () { if (root !== store.root()) store.setRoot(root); props.onDone(); }, tall: true },
      h("h3", { className: "hl-sub" }, "Comp Vault folder"),
      h("p", { className: "hl-path", translate: "no" }, root),
      h("div", { className: "inline" },
        h("button", { type: "button", className: "ghost", onClick: pick }, "Choose Folder…"),
        h("button", { type: "button", className: "ghost", onClick: function () { deps.openFolder(root); } }, "Show Folder")),
      h("p", { className: "help" }, "Every After Effects and Premiere window reads this folder, so a save shows up everywhere. Put it in Google Drive or Dropbox to share one library between your computers. Changing it doesn’t move what’s already saved."),
      h("h3", { className: "hl-sub" }, "Export and import"),
      h(Field, { label: "Export" }, h("select", { value: what, onChange: function (e) { setWhat(e.target.value); } }, choices.map(function (c) { return h("option", { key: c.key, value: c.key }, c.label); }))),
      h("div", { className: "inline" },
        h("button", { type: "button", className: "ghost", onClick: doExport }, "Export to Folder…"),
        h("button", { type: "button", className: "ghost", onClick: doImport }, "Import from Folder…")),
      h("p", { className: "help" }, "Exports are normal folders: each animation is an After Effects project (.aep) with its footage beside it, so it opens on any computer. Logos and screenshots stay as image files."),
      note ? h("div", { className: "hl-what", role: "status" }, note, out ? h("button", { type: "button", className: "ghost tight hl-note-btn", onClick: function () { deps.openFolder(out); } }, "Show") : null) : null,
      h(StoragePanel, { onChanged: props.onChanged }));
  }

  function StoragePanel(props) {
    var _a = useState(null), rep = _a[0], setRep = _a[1];
    var _b = useState(null), dup = _b[0], setDup = _b[1];
    var _c = useState(""), msg = _c[0], setMsg = _c[1];
    var _d = useState(false), confirmTrash = _d[0], setConfirmTrash = _d[1];
    var _e = useState(false), working = _e[0], setWorking = _e[1];
    function later(fn) { setWorking(true); setTimeout(function () { try { fn(); } catch (e) { setMsg(e.message); } setWorking(false); }, 30); }
    function check() { later(function () { setRep(store.storageReport()); setDup(null); setMsg(""); }); }
    function empty() { later(function () { var f = store.emptyTrash(); setConfirmTrash(false); setRep(store.storageReport()); setMsg("Emptied the Trash and freed " + fmtBytes(f) + "."); }); }
    function findDup() { later(function () { setDup(store.findDuplicates()); }); }
    function storeOnce() {
      later(function () {
        var r = store.dedupe();
        setDup(store.findDuplicates()); setRep(store.storageReport());
        setMsg(r.saved ? "Freed " + fmtBytes(r.saved) + ". Every item still has its files." : "Nothing to free.") ;
        if (r.failed) setMsg("Freed " + fmtBytes(r.saved) + ". " + plural(r.failed, "file") + " couldn’t be linked (different drive or cloud folder) and were left as they are.");
      });
    }
    var max = rep ? Math.max.apply(null, rep.places.map(function (p) { return p.bytes; }).concat([1])) : 1;
    return h("div", { className: "hl-storage" },
      h("h3", { className: "hl-sub" }, "Storage"),
      !rep ? h("div", null,
        h("p", { className: "help" }, "See how much space each client takes, empty the Trash and keep one copy of videos you saved more than once."),
        h("button", { type: "button", className: "ghost", onClick: check, disabled: working }, working ? "Checking…" : "Check Storage")) :
      h("div", null,
        h("div", { className: "hl-storage-total" }, h("strong", { className: "num" }, fmtBytes(rep.total)), h("span", { className: "dim" }, " in your library")),
        h("ul", { className: "hl-bars" }, rep.places.slice().sort(function (a, b) { return b.bytes - a.bytes; }).map(function (p) {
          return h("li", { key: p.label },
            h("span", { className: "hl-bar-label trunc" }, p.label),
            h("span", { className: "hl-bar" }, h("span", { style: { width: Math.max(2, p.bytes / max * 100) + "%" } })),
            h("span", { className: "hl-bar-n num" }, fmtBytes(p.bytes)));
        })),
        rep.largest.length ? h("details", { className: "hl-largest" },
          h("summary", null, "Largest items"),
          h("ul", null, rep.largest.map(function (it) {
            return h("li", { key: it.dir }, h("span", { className: "trunc grow" }, it.name, h("span", { className: "dim" }, "  " + scopeLabel(it.scope))), h("span", { className: "num dim" }, fmtBytes(it.bytes)));
          }))) : null,
        h("div", { className: "hl-storage-row" },
          h("span", { className: "grow" }, "Trash ", h("span", { className: "dim num" }, fmtBytes(rep.trash))),
          rep.trash ? (confirmTrash
            ? h("span", { className: "inline" },
                h("button", { type: "button", className: "ghost tight is-danger", onClick: empty, disabled: working }, "Delete " + fmtBytes(rep.trash) + " for Good"),
                h("button", { type: "button", className: "ghost tight", onClick: function () { setConfirmTrash(false); } }, "Cancel"))
            : h("button", { type: "button", className: "ghost tight", onClick: function () { setConfirmTrash(true); } }, "Empty Trash…")) : h("span", { className: "dim" }, "Empty")),
        h("div", { className: "hl-storage-row" },
          h("span", { className: "grow" }, "Duplicate files ",
            dup ? h("span", { className: "dim num" }, dup.groups ? plural(dup.groups, "video or image", "videos or images") + " saved more than once, " + fmtBytes(dup.bytes) + " extra" : "none") : null),
          !dup ? h("button", { type: "button", className: "ghost tight", onClick: findDup, disabled: working }, working ? "Checking…" : "Find")
            : dup.groups ? h("button", { type: "button", className: "ghost tight", onClick: storeOnce, disabled: working }, "Store Once") : null),
        h("p", { className: "help" }, "Store Once keeps one copy on disk and links the others to it. Every item still opens on its own. Links don’t work across drives, and cloud folders like Google Drive may still upload each copy."),
        h("button", { type: "button", className: "ghost tight", onClick: check, disabled: working }, "Check Again")),
      msg ? h("p", { className: "hl-what", role: "status" }, msg) : null);
  }

  // ---------------------------------------------------------------- palette strip
  function Palette(props) {
    var _a = useState(-1), open = _a[0], setOpen = _a[1];
    var colors = props.colors;
    var sel = colors[open];
    return h("section", { className: "hl-palette", "aria-label": "Colours" },
      h("div", { className: "hl-swatches" },
        colors.map(function (c, i) {
          return h("button", { key: i + c.hex, className: "hl-swatch" + (open === i ? " is-open" : ""), style: { background: c.hex }, title: c.name + " " + c.hex, "aria-label": c.name + " " + c.hex, "aria-expanded": open === i, onClick: function () { setOpen(open === i ? -1 : i); } });
        }),
        h("button", { className: "hl-swatch is-add", "aria-label": "Add colour", title: "Add colour", onClick: props.onAdd }, h(Icon, { name: "plus", size: 12 })),
        !colors.length ? h("span", { className: "hl-swatch-hint" }, props.hint) : null),
      sel ? h("div", { className: "hl-swatch-panel" },
        h("span", { className: "hl-swatch-name trunc" }, sel.name, " ", h("span", { className: "num dim", translate: "no" }, sel.hex)),
        h("button", { className: "ghost tight", onClick: function () { props.onCopy(sel); } }, "Copy"),
        isAE ? h("button", { className: "ghost tight", onClick: function () { props.onApply(sel, "fill"); }, title: "Add a Fill effect with this colour to the selected layers" }, "Fill Layers") : null,
        isAE ? h("button", { className: "ghost tight", onClick: function () { props.onApply(sel, "solid"); } }, "New Solid") : null,
        h("button", { className: "icon-btn", "aria-label": "Remove " + sel.name, title: "Remove", onClick: function () { setOpen(-1); props.onRemove(open); } }, h(Icon, { name: "x", size: 14 }))) : null);
  }

  // ---------------------------------------------------------------- main
  return function Library() {
    var _a = useState(null), scope = _a[0], setScope = _a[1]; // null = home
    var _b = useState("all"), filter = _b[0], setFilter = _b[1];
    var _c = useState(""), query = _c[0], setQuery = _c[1];
    var _d = useState(0), tick = _d[0], setTick = _d[1];
    var _e = useState(null), sheet = _e[0], setSheet = _e[1];
    var _f = useState(null), toast = _f[0], setToast = _f[1];
    var _g = useState(null), menu = _g[0], setMenu = _g[1];
    var _h = useState(false), dragging = _h[0], setDragging = _h[1];
    var _i = useState({}), info = _i[0], setInfo = _i[1];
    var _j = useState(readPref("grid", "l")), grid = _j[0], setGrid = _j[1];
    var searchRef = useRef(null);
    var _k = useState(null), selected = _k[0], setSelected = _k[1]; // null = not selecting; else [items]
    var _l = useState(readPref("addMode", "after")), addMode = _l[0], setAddMode = _l[1];
    var _m = useState(""), tagFilter = _m[0], setTagFilter = _m[1];
    useEffect(function () { writePref("addMode", addMode); }, [addMode]);
    useEffect(function () {
      if (!selected) return;
      function key(e) { if (e.key === "Escape" && !sheet) setSelected(null); }
      document.addEventListener("keydown", key);
      return function () { document.removeEventListener("keydown", key); };
    }, [selected, sheet]);
    useEffect(function () { writePref("grid", grid); }, [grid]);
    // "/" jumps to search, like most file browsers.
    useEffect(function () {
      function key(e) {
        if (e.key !== "/" || sheet || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || "")) return;
        if (searchRef.current) { e.preventDefault(); searchRef.current.focus(); }
      }
      document.addEventListener("keydown", key);
      return function () { document.removeEventListener("keydown", key); };
    }, [sheet]);
    var toastTimer = useRef(null), sig = useRef(""), rootRef = useRef(null), fileInput = useRef(null);

    var refresh = useCallback(function () { setTick(function (t) { return t + 1; }); }, []);
    var say = useCallback(function (text, opts) {
      clearTimeout(toastTimer.current);
      setToast(Object.assign({ text: text }, opts || {}));
      toastTimer.current = setTimeout(function () { setToast(null); }, (opts && opts.error) ? 9000 : (opts && (opts.undo || opts.action)) ? 8000 : 3200);
    }, []);

    // Watch the folder: refresh when anything changes (other windows, other PCs).
    useEffect(function () {
      function check() {
        if (document.hidden) return;
        var s = "";
        try {
          s = store.signature(scope || {});
          if (!scope) s += store.listPinned().map(function (p) { return p.dir + p.name; }).join("|");
        } catch (e) {}
        if (s !== sig.current) { sig.current = s; refresh(); }
      }
      var id = setInterval(check, 2500);
      window.addEventListener("focus", check);
      check();
      return function () { clearInterval(id); window.removeEventListener("focus", check); };
    }, [scope]);

    var data = useMemo(function () {
      var out = { clients: [], projects: [], items: [], palette: [], common: { items: 0, palette: [] } };
      try {
        out.clients = store.listClients();
        if (!scope) {
          out.common = { items: store.listItems({}).length, palette: store.palette({}) };
          out.pinned = store.listPinned();
          out.recent = store.listRecent(8);
        } else {
          out.items = store.listItems(scope);
          out.palette = store.palette(scope.client ? { client: scope.client } : {});
          if (scope.client && !scope.project) out.projects = store.listProjects(scope.client);
        }
      } catch (e) { out.error = e.message; }
      return out;
    }, [tick, scope]);

    var scopes = useMemo(function () {
      var list = [{}];
      data.clients.forEach(function (c) {
        list.push({ client: c.name });
        try { store.listProjects(c.name).forEach(function (p) { list.push({ client: c.name, project: p.name }); }); } catch (e) {}
      });
      return list;
    }, [data.clients, sheet]);

    useEffect(function () { setFilter("all"); setQuery(""); setTagFilter(""); setSelected(null); }, [scopeKey(scope || {})]);
    var shown = data.items.filter(function (it) {
      if (filter !== "all" && filterOf(it.kind) !== filter) return false;
      if (tagFilter && !(it.tags || []).some(function (t) { return t.toLowerCase() === tagFilter.toLowerCase(); })) return false;
      if (!query) return true;
      var q = query.toLowerCase();
      return it.name.toLowerCase().indexOf(q) !== -1 || (it.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) !== -1; });
    });

    function openSave(kind) {
      call("info").then(function (i) { setInfo(i); setSheet({ type: "save", kind: kind }); }, function (e) { say(e.message, { error: true }); });
    }
    function openFiles(files) {
      if (!files || !files.length) return;
      setSheet({ type: "files", files: files });
    }
    function chooseFiles() {
      deps.pickFiles().then(function (files) {
        if (files === null) { if (fileInput.current) fileInput.current.click(); return; }
        openFiles(files);
      });
    }
    function insert(item, changes, opts) {
      var p, at = opts && opts.at !== undefined ? opts.at : null;
      var special = insertSpecial(item);
      if (special) {
        if (opts && opts.quiet) return special;
        special.then(function (msg) { say(msg); }, function (e) { say(e.message, { error: true }); });
        return special;
      }
      if (isAE && (item.kind === "animation" || item.kind === "layers") && item.fonts && item.fonts.length && !(opts && opts.fontsChecked)) {
        var checked = ensureFonts(item).then(function (note) {
          var q = insert(item, changes, Object.assign({}, opts || {}, { fontsChecked: true, quiet: true }));
          if (opts && opts.quiet) return q;
          q.then(function (r) {
            say((r && r.into ? "Added " + item.name + " to " + r.into : "Added " + item.name + " to the project") + (changes ? " with your changes" : "") + (note ? ". " + note : ""), note && /missing/i.test(note) ? { error: true } : null);
          }, function (e) { say(e.message, { error: true }); });
          return q;
        });
        return checked;
      }
      if (isAE) {
        if (item.kind === "animation" || item.kind === "layers") p = call("insertItem", { aep: item.aepPath, compName: item.compName, name: item.name, kind: item.kind, texts: changes ? changes.texts : null, colors: changes ? changes.colors : null, at: at });
        else p = call("importFile", { path: item.filePath, name: item.name, at: at });
      } else {
        if (item.kind === "animation" || item.kind === "layers") {
          var hasVideo = item.videoPath && fs.existsSync(item.videoPath);
          p = item.aepPath && fs.existsSync(item.aepPath)
            ? call("ppInsertAEComp", { aep: item.aepPath, compName: item.compName, name: item.name, at: at }).catch(function (e) {
                if (hasVideo) return call("importFile", { path: item.videoPath, name: item.name, at: at });
                throw e;
              })
            : hasVideo ? call("importFile", { path: item.videoPath, name: item.name, at: at }) : Promise.reject(new Error("This item has no project file. Save it again in After Effects."));
        } else p = call("importFile", { path: item.filePath, name: item.name, at: at });
      }
      if (opts && opts.quiet) return p;
      p.then(function (r) {
        say((r && r.into ? "Added " + item.name + " to " + r.into + (r.track ? ", " + r.track : "") : "Added " + item.name + " to the project") + (changes ? " with your changes" : ""));
      }, function (e) { say(e.message, { error: true }); });
      return p;
    }
    // Effects & animation, expressions, scripts, .ffx presets and fonts: applied, not inserted.
    function insertSpecial(item) {
      var k = item.kind;
      if (k === "font") return Promise.resolve().then(function () { return installFonts([{ name: item.name, path: item.filePath }]); });
      if (!AE_ONLY[k]) return null;
      if (!isAE) return Promise.reject(new Error(KIND_LABEL[k] + " only works in After Effects."));
      var p = k === "preset" ? call("applyPreset", { aep: item.aepPath, compName: item.compName, name: item.name })
        : k === "ffx" ? call("applyFfx", { path: item.filePath, name: item.name })
        : k === "expression" ? call("applyExpression", { expression: item.expression, name: item.name })
        : call("runScript", { path: item.filePath });
      return p.then(function (r) {
        try { store.touch && store.touch(item.dir); } catch (e) {}
        if (k === "script") return "Ran " + item.name;
        return "Applied " + item.name + " to " + plural(r.applied, k === "expression" ? "property" : "layer", k === "expression" ? "properties" : "layers") + (r.into ? " in " + r.into : "");
      });
    }
    // Fonts the item needs that this computer doesn't have: install the copies saved with it.
    function ensureFonts(item) {
      return call("checkFonts", { names: item.fonts }).then(function (r) {
        if (!r.known || !r.missing.length) return "";
        var files = (item.fontFiles || []).filter(function (f) { return r.missing.indexOf(f.name) !== -1; })
          .map(function (f) { return { name: f.name, path: path.join(item.dir, f.file) }; })
          .filter(function (f) { return fs.existsSync(f.path); });
        var have = files.map(function (f) { return f.name; });
        var still = r.missing.filter(function (n) { return have.indexOf(n) === -1; });
        var note = files.length ? installFonts(files) : "";
        if (still.length) note += (note ? " " : "") + "Missing fonts: " + still.join(", ") + ". Install them before rendering.";
        return note;
      }, function () { return ""; });
    }
    // Copies font files into the user's own font folder (no admin needed).
    function installFonts(files) {
      var os = window.require ? window.require("os") : null;
      var home = os ? os.homedir() : "";
      var mac = !os || os.platform() === "darwin";
      if (!mac) {
        files.forEach(function (f) { deps.openFolder(path.dirname(f.path)); });
        return "Opened the font" + (files.length === 1 ? "" : "s") + ": double-click to install " + files.map(function (f) { return f.name; }).join(", ") + ".";
      }
      var dest = path.join(home, "Library", "Fonts"), done = [];
      fs.mkdirSync(dest, { recursive: true });
      files.forEach(function (f) {
        var to = path.join(dest, path.basename(f.path));
        if (!fs.existsSync(to)) fs.copyFileSync(f.path, to);
        done.push(f.name);
      });
      return "Installed " + done.join(", ") + (done.length ? ". If it doesn\u2019t show yet, restart " + (isAE ? "After Effects" : "Premiere") + "." : "");
    }
    // Saves the expression on the selected property.
    function saveExpression() {
      call("readExpression").then(function (r) { setSheet({ type: "expression", expr: r }); }, function (e) { say(e.message, { error: true }); });
    }
    // Several at once: one after another (each starts where the last ends) or all at the playhead.
    function insertMany(items, mode) {
      var at = null, done = 0, into = "";
      var chain = Promise.resolve();
      items.forEach(function (it) {
        chain = chain.then(function () {
          return insert(it, null, { quiet: true, at: mode === "after" ? at : null }).then(function (r) {
            done++; into = (r && r.into) || into;
            if (mode === "after" && r && typeof r.end === "number") at = r.end;
          });
        });
      });
      chain.then(function () {
        setSelected(null);
        say("Added " + plural(done, "item") + (into ? " to " + into : "") + (mode === "after" ? ", one after another" : ", all at the playhead"));
      }, function (e) {
        say((done ? "Added " + done + " of " + items.length + ", then: " : "") + e.message, { error: true });
      });
    }
    function toggleSel(item) {
      var cur = selected || [];
      var has = cur.some(function (x) { return x.dir === item.dir; });
      setSelected(has ? cur.filter(function (x) { return x.dir !== item.dir; }) : cur.concat([item]));
    }
    function trash(item) {
      try {
        var undo = store.trashItem(item.dir);
        refresh();
        say("Deleted " + item.name, { undo: function () { undo(); refresh(); say("Restored " + item.name); } });
      } catch (e) { say(e.message, { error: true }); }
    }
    function openMenu(item, el) {
      var r = el.getBoundingClientRect(), host = rootRef.current.getBoundingClientRect();
      setMenu({
        pos: r.bottom + 260 > window.innerHeight ? { bottom: host.bottom - r.top + 2, right: host.right - r.right } : { top: r.bottom - host.top + 2, right: host.right - r.right },
        items: [
          { label: item.kind === "script" ? "Run Script" : AE_ONLY[item.kind] ? "Apply to Selected" : item.kind === "font" ? "Install Font" : ADD_LABEL, run: function () { insert(item); } },
          { label: "Details", run: function () { openDetails(item); } },
          { label: "Select", run: function () { setSelected([item]); } },
          { label: item.pinned ? "Unpin from Home" : "Pin to Home", run: function () { togglePin(item); } },
          { label: "Rename…", run: function () { setSheet({ type: "rename", item: item }); } },
          { label: "Move To…", run: function () { setSheet({ type: "move", item: item }); } },
          { label: "Show in Folder", run: function () { deps.openFolder(item.dir); } },
          { label: "Export to Folder…", run: function () { exportItem(item); } },
          { label: "Delete", danger: true, run: function () { trash(item); } }
        ]
      });
    }
    function openScopeMenu(el) {
      var r = el.getBoundingClientRect(), host = rootRef.current.getBoundingClientRect();
      var cur = scope, items = [{ label: "New Client…", run: function () { setSheet({ type: "client" }); } }];
      if (cur.client && !cur.project) items.push(
        { label: "New Project…", run: function () { setSheet({ type: "project" }); } },
        { label: "Rename Client…", run: function () { setSheet({ type: "rename-scope", scope: cur }); } },
        { label: "Delete Client", danger: true, run: function () { trashScope(cur); } });
      if (cur.project) items.push(
        { label: "Rename Project…", run: function () { setSheet({ type: "rename-scope", scope: cur }); } },
        { label: "Delete Project", danger: true, run: function () { trashScope(cur); } });
      items.push({ label: "Show in Folder", run: function () { deps.openFolder(store.scopeDir(cur)); } });
      setMenu({ pos: { top: r.bottom - host.top + 2, right: host.right - r.right }, items: items });
    }
    function trashScope(sc) {
      var label = sc.project || sc.client;
      try {
        var count = store.listItems(sc).length;
        var undo = sc.project ? store.trashProject(sc.client, sc.project) : store.trashClient(sc.client);
        setScope(sc.project ? { client: sc.client } : null); refresh();
        say("Deleted " + label + (count ? " and its " + plural(count, "item") : ""), { undo: function () {
          try { undo(); setScope(sc); refresh(); say("Restored " + label); } catch (e) { say(e.message, { error: true }); }
        } });
      } catch (e) { say(e.message, { error: true }); }
    }
    function brandList() {
      var out = [];
      data.clients.forEach(function (c) { if (c.palette.length) out.push({ key: c.name, label: c.name, palette: c.palette }); });
      var common = store.palette({});
      if (common.length) out.push({ key: "", label: "Common colours", palette: common });
      return out;
    }
    function togglePin(item) {
      store.setPinned(item.dir, !item.pinned); refresh();
      say(item.pinned ? "Unpinned " + item.name : "Pinned " + item.name + " to Home");
    }
    function openDetails(item) {
      var fresh = null;
      try { fresh = store.readItem(item.dir); } catch (e) {}
      setSheet({ type: "details", item: fresh ? Object.assign(fresh, { scope: item.scope }) : item, scope: item.scope || scope || {} });
    }
    function openProjectFile(file) {
      if (!isAE) return say("Taking comps from a project file works in After Effects. Open the Library there.");
      if (file) return setSheet({ type: "project-file", file: file });
      deps.pickProject().then(function (files) {
        if (files === null) return say("Drop the .aep or .prproj file onto this panel instead.");
        if (files && files[0]) setSheet({ type: "project-file", file: files[0] });
      });
    }
    function openAddMenu(el) {
      var r = el.getBoundingClientRect(), host = rootRef.current.getBoundingClientRect();
      setMenu({
        pos: { bottom: host.bottom - r.top + 4, right: host.right - r.right },
        items: [
          { label: "Effects & Animation of Selected Layer…", run: function () { openSave("preset"); } },
          { label: "Expression of Selected Property…", run: saveExpression },
          { label: "Logos, Clips, Fonts, Scripts or .ffx…", run: chooseFiles },
          { label: "Comps from a Project File…", run: function () { openProjectFile(); } }
        ]
      });
    }
    function exportItem(item) {
      var from = item.scope || scope || {};
      deps.pickFolder("", "Choose where to export " + item.name).then(function (dest) {
        if (!dest) return;
        try {
          var out = store.exportItems([{ dir: item.dir, scope: from }], dest);
          say("Exported " + item.name + " to " + path.basename(out), { action: { label: "Show", run: function () { deps.openFolder(out); } } });
        } catch (e) { say(e.message, { error: true }); }
      });
    }
    function applyColor(c, mode) {
      call("applyColor", { hex: c.hex, name: c.name, mode: mode }).then(function (r) {
        say(mode === "solid" ? "Added solid " + c.name : "Filled " + r.count + (r.count === 1 ? " layer" : " layers") + " with " + c.name);
      }, function (e) { say(e.message, { error: true }); });
    }
    var paletteScope = scope && scope.client ? { client: scope.client } : {};

    // Drag files from Finder / Explorer onto the panel.
    function onDrop(e) {
      e.preventDefault(); setDragging(false);
      var files = [].slice.call(e.dataTransfer.files || []).map(function (f) { return f.path; }).filter(Boolean);
      var proj = files.filter(function (f) { return /\.(aep|aepx|prproj)$/i.test(f); });
      if (proj.length) return openProjectFile(proj[0]);
      openFiles(files);
    }

    var closeSheet = function () { setSheet(null); };
    var clientColor = scope && scope.client && data.palette[0] ? data.palette[0].hex : null;

    // ------------------------------------------------ views
    function Crumbs() {
      var parts = [h("button", { key: "home", className: "hl-crumb is-home", onClick: function () { setScope(null); }, "aria-label": "Comp Vault home", title: "Comp Vault home", "aria-current": !scope ? "page" : undefined }, h(Icon, { name: "home", size: 15 }), !scope ? h("span", null, "All folders") : null)];
      if (scope) {
        parts.push(h(Icon, { key: "c1", name: "chevron", size: 12 }));
        if (scope.project) {
          parts.push(h("button", { key: "s1", className: "hl-crumb", onClick: function () { setScope({ client: scope.client }); } }, scope.client));
          parts.push(h(Icon, { key: "c2", name: "chevron", size: 12 }));
          parts.push(h("span", { key: "s2", className: "hl-crumb", "aria-current": "page" }, scope.project));
        } else parts.push(h("span", { key: "s1", className: "hl-crumb", "aria-current": "page" }, scope.client || "Common"));
      }
      return h("nav", { className: "hl-crumbs", "aria-label": "Where you are" }, parts,
        h("button", { className: "icon-btn hl-gear", "aria-label": "Settings: library folder, export and import", title: "Settings", onClick: function () { setSheet({ type: "settings" }); } }, h(Icon, { name: "gear" })));
    }

    function Band(props) {
      var cols = props.palette || [];
      return h("span", { className: "hl-band" + (cols.length ? "" : " is-empty"), "aria-hidden": "true" },
        cols.slice(0, 6).map(function (c, i) { return h("span", { key: i, style: { background: c.hex } }); }));
    }

    function Home() {
      var pinned = data.pinned || [], recent = (data.recent || []).filter(function (r) { return !r.pinned; }).slice(0, 8);
      var fresh = !data.clients.length && !data.common.items;
      var found = query ? store.search(query) : null;
      var searchBox = fresh ? null : h("div", { className: "hl-tools is-home" },
        h("label", { className: "hl-search" }, h(Icon, { name: "search", size: 14 }),
          h("input", { ref: searchRef, type: "search", value: query, onChange: function (e) { setQuery(e.target.value); }, placeholder: "Search every client and Common…", "aria-label": "Search everything", autoComplete: "off", spellCheck: false, name: "q-all" }),
          !query ? h("kbd", { "aria-hidden": "true" }, "/") : null));
      if (found) {
        return h("div", { className: "hl-home" }, searchBox,
          found.length ? h("div", null,
            h("div", { className: "hl-section-head" }, h("h2", null, plural(found.length, "result"))),
            h("div", { className: "hl-grid is-" + grid }, found.map(function (it) { return h(Card, { key: it.dir, item: it, place: scopeLabel(it.scope), onOpen: openDetails, onInsert: insert, onMenu: openMenu }); })))
            : h("p", { className: "empty" }, "Nothing in your library matches “" + query + "”."));
      }
      return h("div", { className: "hl-home" }, searchBox,
        fresh ? h("div", { className: "hl-welcome" },
          h("h2", null, "Save something once, use it in every project"),
          h("p", null, isAE ? "Start with a comp you reuse a lot, or make a folder for a client."
            : "Add a client’s logos and screenshots here. Animations are saved from After Effects.")) : null,
        h(Shelf, { title: "Pinned", items: pinned, onOpen: openDetails, onInsert: insert, onMenu: openMenu }),
        h(Shelf, { title: "Recent", items: recent, onOpen: openDetails, onInsert: insert, onMenu: openMenu }),
        h("div", { className: "hl-section-head" },
          h("h2", null, "Folders"),
          h("button", { className: "ghost tight", onClick: function () { setSheet({ type: "client" }); } }, h(Icon, { name: "plus", size: 12 }), "New Client")),
        h("div", { className: "hl-folders" },
          h("button", { className: "hl-folder is-common", onClick: function () { setScope({}); } },
            h(Band, { palette: data.common.palette }),
            h("span", { className: "hl-folder-name" }, "Common"),
            h("span", { className: "hl-folder-desc" }, data.common.items ? plural(data.common.items, "item") : "For every client")),
          data.clients.map(function (c) {
            return h("button", { key: c.name, className: "hl-folder", onClick: function () { setScope({ client: c.name }); } },
              h(Band, { palette: c.palette }),
              h("span", { className: "hl-folder-name trunc" }, c.name),
              h("span", { className: "hl-folder-desc" }, plural(c.items, "item") + (c.projects ? ", " + plural(c.projects, "project") : "")));
          })));
    }

    function EmptyScope() {
      return h("div", { className: "hl-empty-scope" },
        h("h2", null, "Nothing in " + (scope.project || scope.client || "Common") + " yet"),
        h("p", null, isAE ? "Save a comp or layers from the open project, take comps from another project file, or drop logos and screenshots here."
          : "Drop logos and screenshots here. Animations are saved from After Effects."),
        h("div", { className: "hl-empty-actions" },
          isAE ? h("button", { className: "ghost", onClick: function () { openSave("animation"); } }, h(Icon, { name: "film", size: 14 }), "Save Comp") : null,
          isAE ? h("button", { className: "ghost", onClick: function () { openSave("layers"); } }, h(Icon, { name: "layers", size: 14 }), "Save Layers") : null,
          isAE ? h("button", { className: "ghost", onClick: function () { openProjectFile(); } }, h(Icon, { name: "file", size: 14 }), "From Project File") : null,
          h("button", { className: "ghost", onClick: chooseFiles }, h(Icon, { name: "image", size: 14 }), "Add Files")));
    }

    function ScopeView() {
      var empty = !data.items.length;
      var counts = { all: data.items.length };
      data.items.forEach(function (it) { var k = filterOf(it.kind); counts[k] = (counts[k] || 0) + 1; });
      var chips = FILTERS.filter(function (f) { return f.id === "all" || counts[f.id]; });
      var tagCount = {}, tagLabel = {};
      data.items.forEach(function (it) { (it.tags || []).forEach(function (t) { var k = t.toLowerCase(); tagLabel[k] = tagLabel[k] || t; tagCount[k] = (tagCount[k] || 0) + 1; }); });
      var tagsHere = Object.keys(tagCount).map(function (k) { return { tag: tagLabel[k], count: tagCount[k] }; }).sort(function (a, b) { return b.count - a.count || a.tag.localeCompare(b.tag); });
      var title = scope.project || scope.client || "Common";
      return h("div", { className: "hl-scope" },
        h("header", { className: "hl-scope-head" },
          h("div", { className: "hl-scope-title" },
            h("h1", { className: "trunc" }, title),
            h("span", { className: "dim num" }, plural(data.items.length, "item")),
            h("button", { className: "hl-card-more hl-scope-more", "aria-label": "More for " + title, "aria-haspopup": "menu", onClick: function (e) { openScopeMenu(e.currentTarget); } }, h(Icon, { name: "more" }))),
          h(Palette, {
            colors: data.palette, hint: scope.client ? "Add " + scope.client + "’s brand colours" : "Add colours you use everywhere",
            onAdd: function () { setSheet({ type: "color" }); },
            onCopy: function (c) { say(copyText(c.hex) ? "Copied " + c.hex : c.hex); },
            onApply: applyColor,
            onRemove: function (i) { store.removeColor(paletteScope, i); refresh(); }
          }),
          scope.client && !scope.project ? h("div", { className: "hl-chips", role: "list", "aria-label": "Projects" },
            data.projects.map(function (p) {
              return h("button", { key: p.name, role: "listitem", className: "hl-chip", onClick: function () { setScope({ client: scope.client, project: p.name }); } },
                h(Icon, { name: "folder", size: 13 }), h("span", { className: "trunc" }, p.name), p.items ? h("span", { className: "hl-chip-n num" }, p.items) : null);
            }),
            h("button", { className: "hl-chip is-add", onClick: function () { setSheet({ type: "project" }); } }, h(Icon, { name: "plus", size: 12 }), "Project")) : null),
        !empty ? h("div", { className: "hl-tools" },
          h("div", { className: "hl-tools-row" },
            h("label", { className: "hl-search" }, h(Icon, { name: "search", size: 14 }),
              h("input", { ref: searchRef, type: "search", value: query, onChange: function (e) { setQuery(e.target.value); }, placeholder: "Search " + title + "…", "aria-label": "Search", autoComplete: "off", spellCheck: false, name: "q" }),
              !query ? h("kbd", { "aria-hidden": "true" }, "/") : null),
            h("button", { className: "hl-select-btn" + (selected ? " on" : ""), "aria-pressed": !!selected, onClick: function () { setSelected(selected ? null : []); }, title: "Select several to add at once (or Ctrl/Cmd-click a card)" }, selected ? "Done" : "Select"),
            h("div", { className: "hl-size", role: "radiogroup", "aria-label": "Thumbnail size" },
              h("button", { role: "radio", "aria-checked": grid === "s", className: grid === "s" ? "on" : "", "aria-label": "Small thumbnails", title: "Small thumbnails", onClick: function () { setGrid("s"); } }, h(Icon, { name: "gridS", size: 14 })),
              h("button", { role: "radio", "aria-checked": grid === "l", className: grid === "l" ? "on" : "", "aria-label": "Large thumbnails", title: "Large thumbnails", onClick: function () { setGrid("l"); } }, h(Icon, { name: "gridL", size: 14 })))),
          tagsHere.length ? h("div", { className: "hl-filters is-tags", role: "group", "aria-label": "Tags" }, tagsHere.map(function (t) {
            var on = tagFilter.toLowerCase() === t.tag.toLowerCase();
            return h("button", { key: t.tag, "aria-pressed": on, className: "hl-filter is-tag" + (on ? " on" : ""), onClick: function () { setTagFilter(on ? "" : t.tag); } },
              h(Icon, { name: "tag", size: 11 }), t.tag, h("span", { className: "num" }, t.count));
          })) : null,
          chips.length > 2 ? h("div", { className: "hl-filters", role: "tablist", "aria-label": "Show" }, chips.map(function (f) {
            return h("button", { key: f.id, role: "tab", "aria-selected": filter === f.id, className: "hl-filter" + (filter === f.id ? " on" : ""), onClick: function () { setFilter(f.id); } },
              f.label, h("span", { className: "num" }, counts[f.id]));
          })) : null) : null,
        empty ? EmptyScope() :
          shown.length ? h("div", { className: "hl-grid is-" + grid }, shown.map(function (it) {
            return h(Card, {
              key: it.dir, item: it, onOpen: openDetails, onInsert: insert, onMenu: openMenu,
              onSelect: selected ? toggleSel : null, selected: selected ? selected.some(function (x) { return x.dir === it.dir; }) : false,
              onStartSelect: function (x) { setSelected([x]); }
            });
          }))
            : h("p", { className: "empty" }, "Nothing matches “" + query + "”."));
    }

    // ------------------------------------------------ sheets
    var sheetEl = null;
    if (sheet) {
      var here = scope || {};
      if (sheet.type === "save") sheetEl = h(SaveSheet, {
        kind: sheet.kind, info: info, scope: here, scopes: scopes, onClose: closeSheet,
        onDone: function (n, to, r) {
          closeSheet(); setScope(to); refresh();
          var warn = [];
          if (r.missing && r.missing.length) warn.push(r.missing.length + " missing file" + (r.missing.length === 1 ? "" : "s") + " left out (" + r.missing.slice(0, 2).join(", ") + ")");
          if (r.fonts && r.fonts.length) warn.push("needs fonts: " + r.fonts.slice(0, 3).join(", "));
          if (r.wantedVideo && !r.video) warn.push("no Premiere video (this AE has no H.264 output)");
          say("Saved " + n + " to " + scopeLabel(to) + ", " + (r.copied || 0) + (r.copied === 1 ? " file" : " files") + " copied into the library" + (warn.length ? ". Note: " + warn.join("; ") + "." : "."), warn.length ? { error: true } : null);
        }
      });
      if (sheet.type === "files") sheetEl = h(FilesSheet, {
        files: sheet.files, scope: here, scopes: scopes, onClose: closeSheet,
        size: here.client ? store.clientMeta(here.client).imageSize : null,
        onDone: function (n, to, notes) {
          closeSheet(); setScope(to); refresh();
          say("Added " + n + (n === 1 ? " file" : " files") + " to " + scopeLabel(to) + (notes.length ? ". " + notes.join(". ") + "." : ""), notes.length ? { error: true } : null);
        }
      });
      if (sheet.type === "expression") sheetEl = h(ExpressionSheet, {
        expr: sheet.expr, scope: here, scopes: scopes, onClose: closeSheet,
        onDone: function (n, to) { closeSheet(); setScope(to); refresh(); say("Saved the expression " + n + " to " + scopeLabel(to) + ". Select properties and click it to apply."); }
      });
      if (sheet.type === "color") sheetEl = h(ColorSheet, { scope: paletteScope, onClose: closeSheet, onDone: function () { closeSheet(); refresh(); } });
      if (sheet.type === "client") sheetEl = h(NameSheet, {
        title: "New Client", label: "Client name", placeholder: "Acme Studio…", submit: "Create Client", onClose: closeSheet,
        onSubmit: function (n) { var c = store.createClient(n); closeSheet(); setScope({ client: c }); }
      });
      if (sheet.type === "project") sheetEl = h(NameSheet, {
        title: "New Project for " + here.client, label: "Project name", placeholder: "Website launch…", submit: "Create Project", onClose: closeSheet,
        onSubmit: function (n) { var p = store.createProject(here.client, n); closeSheet(); setScope({ client: here.client, project: p }); }
      });
      if (sheet.type === "rename-scope") {
        var rs = sheet.scope;
        sheetEl = h(NameSheet, {
          title: rs.project ? "Rename Project" : "Rename Client", label: rs.project ? "Project name" : "Client name", value: rs.project || rs.client, submit: "Rename", onClose: closeSheet,
          onSubmit: function (n) {
            if (rs.project) { var p2 = store.renameProject(rs.client, rs.project, n); setScope({ client: rs.client, project: p2 }); }
            else { var c2 = store.renameClient(rs.client, n); setScope({ client: c2 }); }
            closeSheet(); refresh();
          }
        });
      }
      if (sheet.type === "rename") sheetEl = h(NameSheet, {
        title: "Rename", label: "Name", value: sheet.item.name, submit: "Rename", onClose: closeSheet,
        onSubmit: function (n) { store.renameItem(sheet.item.dir, n); closeSheet(); refresh(); }
      });
      if (sheet.type === "move") sheetEl = h(MoveSheet, {
        item: sheet.item, from: sheet.from || sheet.item.scope || here, scopes: scopes, onClose: closeSheet,
        onSubmit: function (to) { store.moveItem(sheet.item.dir, to); closeSheet(); refresh(); say("Moved " + sheet.item.name + " to " + scopeLabel(to)); }
      });
      if (sheet.type === "project-file") sheetEl = h(ProjectFileSheet, {
        file: sheet.file, scope: here, scopes: scopes, onClose: closeSheet,
        onDone: function (n, to, r) {
          closeSheet(); setScope(to); refresh();
          var warn = [];
          if (r.missing && r.missing.length) warn.push(r.missing.length + " missing file" + (r.missing.length === 1 ? "" : "s") + " left out (" + r.missing.slice(0, 2).join(", ") + ")");
          if (r.fonts && r.fonts.length) warn.push("needs fonts: " + r.fonts.slice(0, 3).join(", "));
          if (r.wantedVideo && !r.video) warn.push("no Premiere video (this AE has no H.264 output)");
          say("Saved " + n + " to " + scopeLabel(to) + ", " + (r.copied || 0) + (r.copied === 1 ? " file" : " files") + " copied into the library" + (warn.length ? ". Note: " + warn.join("; ") + "." : "."), warn.length ? { error: true } : null);
        }
      });
      if (sheet.type === "details") {
        var it = sheet.item;
        sheetEl = h(DetailsSheet, {
          item: it, scope: sheet.scope, onClose: closeSheet,
          brands: brandList(), brandKey: (scope && scope.client) || (sheet.scope && sheet.scope.client) || "",
          onInsert: function (x, changes) { closeSheet(); insert(it, changes); },
          tagSuggestions: store.allTags(),
          onTags: function (t) { store.setTags(it.dir, t); refresh(); },
          onUpdate: function () { call("info").then(function (i) { setInfo(i); setSheet({ type: "update", item: it, scope: sheet.scope }); }, function (e) { say(e.message, { error: true }); }); },
          onRestore: function (v) {
            try { store.restoreVersion(it.dir, v.id); refresh(); openDetails(Object.assign({}, it, { scope: sheet.scope })); say("Restored the version from " + (timeFmt ? timeFmt.format(new Date(v.savedAt)) : v.id)); }
            catch (e) { say(e.message, { error: true }); }
          },
          onPin: function () { closeSheet(); togglePin(it); },
          onRename: function () { setSheet({ type: "rename", item: it }); },
          onMove: function () { setSheet({ type: "move", item: Object.assign({}, it), from: sheet.scope }); },
          onExport: function () { closeSheet(); exportItem(Object.assign({ scope: sheet.scope }, it)); },
          onShow: function () { deps.openFolder(it.dir); },
          onDelete: function () { closeSheet(); trash(it); }
        });
      }
      if (sheet.type === "update") sheetEl = h(UpdateSheet, {
        item: sheet.item, info: info, onClose: closeSheet,
        onDone: function (r) {
          closeSheet(); refresh();
          say("Updated " + sheet.item.name + ". The previous version is under Older versions in Details.");
        }
      });
      if (sheet.type === "settings") sheetEl = h(SettingsSheet, { scopes: scopes, onChanged: refresh, onClose: closeSheet, onDone: function () { closeSheet(); setScope(null); refresh(); } });
    }

    return h("div", {
      className: "hl has-actions" + (dragging ? " is-dragging" : ""), ref: rootRef,
      style: clientColor ? { "--hl-client": clientColor } : null,
      onDragOver: function (e) { e.preventDefault(); if (!dragging) setDragging(true); },
      onDragLeave: function (e) { if (e.currentTarget === e.target) setDragging(false); },
      onDrop: onDrop
    },
      Crumbs(),
      h("main", { className: "hl-body" }, data.error ? h("p", { className: "hl-error" }, data.error) : scope ? ScopeView() : Home()),
      selected && scope ? h("div", { className: "hl-actions is-select", role: "region", "aria-label": "Selected items" },
        h("span", { className: "hl-sel-n num" }, plural(selected.length, "selected", "selected")),
        h("select", { value: addMode, onChange: function (e) { setAddMode(e.target.value); }, "aria-label": "How to add them" },
          h("option", { value: "after" }, "One after another"),
          h("option", { value: "together" }, "All at the playhead")),
        h("button", { className: "hl-action is-primary", disabled: !selected.length, onClick: function () { insertMany(selected, addMode); } }, h(Icon, { name: "add", size: 14 }), "Add " + (selected.length || "")),
        h("button", { className: "hl-action is-narrow", onClick: function () { setSelected(null); } }, "Cancel")) :
      h("div", { className: "hl-actions" },
        isAE ? h("button", { className: "hl-action is-primary", onClick: function () { openSave("animation"); }, title: "Save the active comp with all its files" }, h(Icon, { name: "film" }), "Save Comp") : null,
        isAE ? h("button", { className: "hl-action", onClick: function () { openSave("layers"); }, title: "Save the selected layers, like a gradient solid" }, h(Icon, { name: "layers" }), "Save Layers") : null,
        isAE ? h("button", { className: "hl-action", onClick: function (e) { openAddMenu(e.currentTarget); }, title: "Add files, or comps from another project file", "aria-haspopup": "menu" }, h(Icon, { name: "plus" }), "Add")
          : h("button", { className: "hl-action is-primary", onClick: chooseFiles, title: "Add logos, screenshots or clips" }, h(Icon, { name: "plus" }), "Add Files")),
      h("input", { type: "file", multiple: true, ref: fileInput, hidden: true, "aria-hidden": "true", tabIndex: -1, onChange: function (e) { openFiles([].slice.call(e.target.files).map(function (f) { return f.path; }).filter(Boolean)); e.target.value = ""; } }),
      dragging ? h("div", { className: "hl-drop", "aria-hidden": "true" }, h("span", null, scope ? "Drop to add to " + scopeLabel(scope) : "Drop to add to Common")) : null,
      menu ? h(Menu, { pos: menu.pos, items: menu.items, onClose: function () { setMenu(null); } }) : null,
      sheetEl,
      h("div", { className: "hl-toast-slot", "aria-live": "polite" }, toast ? h("div", { className: "hl-toast" + (toast.error ? " is-warn" : "") },
        h("span", { className: "grow" }, toast.text),
        toast.undo ? h("button", { className: "ghost tight", onClick: function () { var u = toast.undo; setToast(null); u(); } }, "Undo") : null,
        toast.action ? h("button", { className: "ghost tight", onClick: function () { var a = toast.action; setToast(null); a.run(); } }, toast.action.label) : null,
        h("button", { className: "icon-btn", "aria-label": "Dismiss", onClick: function () { setToast(null); } }, h(Icon, { name: "x", size: 12 }))) : null));
  };
};
