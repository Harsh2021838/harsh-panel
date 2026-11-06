// Gap QC: finds short gaps that flash black (or flash the layer below) before export, and in
// Premiere also cuts that don't line up across tracks, audio out of sync, and black or offline clips.
// Host side: jsx/gap-qc.jsx. Each gap is drawn as a tiny timeline so it reads at a glance.
import React, { useEffect, useRef, useState } from "react";
import { makeHost, hostApp, nodeRequire, appSession } from "../../host.js";
import { toolDir, lib } from "../../library.js";
import { Target, Check, Ban, Join } from "../../icons.jsx";
import { timecode } from "../text-qc/premiere-sources.js";
import { analyze } from "./analyze.js";

const call = makeHost("gap-qc.jsx", "HarshGapQC");

// ---- crash guard ----------------------------------------------------------
// Every check and every jump writes its steps to Tools/Gap QC/last-check.log (Premiere writes
// the scan steps itself). If Premiere crashes, the log ends mid-way; next time Gap QC opens it
// reads where it stopped, turns that part off and says so.
const fs = nodeRequire("fs"), pathMod = nodeRequire("path");
let logFile = "";
async function logPath() { if (!logFile) logFile = pathMod.join(await toolDir("Gap QC"), "last-check.log"); return logFile; }
function logLine(line, fresh) { try { if (logFile) (fresh ? fs.writeFileSync : fs.appendFileSync)(logFile, line + "\n"); } catch (e) {} }
const STEP_FIX = [
  [/^read deep/, ["sync", "black", "rate", "dups"], "while reading clip details"],
  [/^audio/, ["sync"], "while reading the audio tracks"],
  [/^sync/, ["sync"], "during the audio sync check"],
  [/^black/, ["black"], "during the black and offline clip check"],
  [/^rate/, ["rate"], "while reading a clip\u2019s frame rate"],
  [/^dups/, ["dups"], "during the same-moment check"],
  [/^cuts/, ["cuts"], "during the cuts check"],
];
/** What the log says about the last run: null (all fine) or { off: [...], where, file, jump }. */
function lastCrash(text) {
  const lines = String(text || "").split("\n").filter(Boolean);
  if (!lines.length) return null;
  const last = lines[lines.length - 1];
  if (/^(done|panel done|jumped|handled)/.test(last)) return null;
  if (/^jump/.test(last)) return { jump: true };
  for (const [re, off, where] of STEP_FIX) if (re.test(last)) return { off, where, file: /^rate /.test(last) ? last.slice(5) : "" };
  return { off: [], where: "during the check" };
}
const isAE = hostApp === "AEFT";
const SCOPES = isAE ? [["active", "Open comp"], ["all", "All comps"]] : [["active", "Open sequence"], ["all", "All sequences"]];
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
// What Premiere can look for. After Effects only looks for gaps.
const CHECKS = [
  ["gaps", "Gaps"],
  ["cuts", "Cuts & flash frames"],
  ["sync", "Audio out of sync"],
  ["black", "Black or offline clips"],
  ["rate", "Frame rate"],
  ["dups", "Same moment twice"],
];
const GAP_KINDS = { start: 1, between: 1, end: 1 };
const isGap = (g) => !!GAP_KINDS[g.kind];
const MARKER_COLOR = { start: 1, between: 1, end: 1, cut: 3, flash: 3, sync: 5, blackvideo: 0, offline: 0, subframe: 7, fps: 6, dup: 4 }; // red, orange, purple, green

const KEY = "harsh.gapqc.";
const REMEMBER_HOURS = 5;
/** { key: { s: "ignored" | "corrected", t } } still fresh for this scope. */
function remembered(scope) {
  const raw = lsGet(scope, {}), out = {};
  if (raw && !Array.isArray(raw)) for (const k in raw) if (raw[k] && Date.now() - raw[k].t < REMEMBER_HOURS * 3600e3) out[k] = raw[k];
  return out;
}
const lsGet = (k, d) => { try { const v = localStorage.getItem(KEY + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} };

// Short lengths in frames, long ones (gaps of any length) in seconds.
const len = (g) => (g.frames > g.fps * 1.5 ? (g.frames / g.fps).toFixed(1) + " sec" : plural(g.frames, "frame"));
function what(g) {
  const f = len(g);
  if (g.kind === "start") return f + " empty at the start";
  if (g.kind === "end") {
    if (!isAE) return g.trackName + " ends " + f + " early";
    return (g.layers && g.layers.length > 1 ? g.layers.length + " layers end " : "Ends ") + f + " before the comp";
  }
  if (g.kind === "cut") return "Cuts " + plural(g.frames, "frame") + " apart";
  if (g.kind === "sync") return "Audio " + plural(g.frames, "frame") + (g.audioEarly ? " early" : " late");
  if (g.kind === "flash") return g.frames + "-frame clip (flash frame)";
  if (g.kind === "subframe") return "Not on a whole frame";
  if (g.kind === "fps") return g.rate + " fps clip in a " + g.seqRate + " fps sequence";
  if (g.kind === "dup") return "Same moment used twice (" + len(g) + ")";
  if (g.kind === "blackvideo") return "Black Video clip";
  if (g.kind === "offline") return "Media offline";
  return g.frames > g.fps * 1.5 ? f + " gap" : g.frames + "-frame gap";
}
function detail(g) {
  const q = (s) => "“" + s + "”";
  if (g.kind === "start") return "Nothing before " + q(g.next) + ".";
  if (g.kind === "end") {
    if (g.names && g.names.length > 1) return g.names.map(q).join(", ") + " stop before the comp ends.";
    return q(g.prev) + (isAE ? " stops before the comp ends." : " stops before the sequence ends.");
  }
  if (g.kind === "cut") return q(g.prev) + " and " + q(g.next) + " cut " + plural(g.frames, "frame") + " apart, so the wrong shot flashes between them. Line the cuts up.";
  if (g.kind === "sync") return "The audio of " + q(g.prev) + " plays " + plural(g.frames, "frame") + (g.audioEarly ? " before" : " after") + " its picture. Slip or move it back into sync.";
  if (g.kind === "flash") return q(g.prev) + " is only " + plural(g.frames, "frame") + " long, so it flashes on screen. Delete it or make it longer.";
  if (g.kind === "subframe") return q(g.prev) + " starts " + g.part + "% of the way into a frame, which can cause a flash or a blend at the cut. Nudge it onto the frame.";
  if (g.kind === "fps") return q(g.prev) + " is " + g.rate + " fps; the sequence is " + g.seqRate + " fps. Fine for slow motion, otherwise it may stutter.";
  if (g.kind === "dup") return "The same " + len(g) + " of " + q(g.prev) + " plays here and again at " + g.againTrack + " " + g.againTc + ". Check that\u2019s on purpose.";
  if (g.kind === "blackvideo") return q(g.prev) + " is a Black Video clip. Check it\u2019s meant to be there.";
  if (g.kind === "offline") return "The media for " + q(g.prev) + " is offline. Relink it before export.";
  return "Between " + q(g.prev) + " and " + q(g.next) + ".";
}

function fixHelp(g) {
  const q = (x) => "\u201C" + x + "\u201D";
  if (g.kind === "start") return "Close gap moves " + q(g.next) + " back to the start.";
  if (g.kind === "end") return "Close gap stretches " + (g.names && g.names.length > 1 ? "these layers" : q(g.prev)) + " to the end.";
  return "Close gap stretches " + q(g.prev) + " to meet " + q(g.next) + ".";
}

/** A tiny timeline: the clip before, the hole, the clip after. */
function GapPicture({ g }) {
  const w = Math.min(10 + g.frames * 5, 34);
  if (g.kind === "cut" || g.kind === "sync") {
    // two stacked tracks whose cuts don't line up
    return (
      <span className={"gap-pic stack " + g.kind} aria-hidden="true">
        <span className="lane"><i className="clip" /><i className="cut" /><i className="clip" style={{ flex: "0 0 26px" }} /></span>
        <span className="lane"><i className="clip" /><i className="hole thin" style={{ width: Math.min(4 + g.frames * 3, 20) }} /><i className="clip" style={{ flex: "0 0 26px" }} /></span>
      </span>
    );
  }
  if (g.kind === "flash" || g.kind === "subframe" || g.kind === "fps" || g.kind === "dup") {
    return (
      <span className={"gap-pic solo " + g.kind} aria-hidden="true">
        <i className="clip" />
        {g.kind === "flash" ? <i className="hole" style={{ width: Math.min(6 + g.frames * 4, 26) }}><b className="num">{g.frames}</b></i>
          : <i className="mark-clip">{g.kind === "fps" ? "fps" : g.kind === "dup" ? "\u00D72" : "\u00BD"}</i>}
        <i className="clip" />
      </span>
    );
  }
  if (g.kind === "blackvideo" || g.kind === "offline") {
    return <span className={"gap-pic solo " + g.kind} aria-hidden="true"><i className="clip" /><i className="bad-clip">{g.kind === "offline" ? "?" : ""}</i><i className="clip" /></span>;
  }
  return (
    <span className={"gap-pic" + (g.black ? " black" : "")} aria-hidden="true">
      <i className={"clip" + (g.kind === "start" ? " none" : "")} />
      <i className="hole" style={{ width: w }}><b className="num">{g.frames > 99 ? "" : g.frames}</b></i>
      <i className={"clip" + (g.kind === "end" ? " none" : "")} />
    </span>
  );
}

export default function GapQC({ report = () => {} }) {
  const [scope, setScope] = useState(() => lsGet("scope2", SCOPES[0][0]));
  const [sel, setSel] = useState(null); // key of the selected row
  const [editSetup, setEditSetup] = useState(false);
  const [crashNote, setCrashNote] = useState("");
  const [shown, setShown] = useState(100); // rows drawn; more on request, so long lists stay quick
  useEffect(() => {
    if (isAE) return;
    logPath().then((f) => {
      let text = "";
      try { text = fs.readFileSync(f, "utf8"); } catch (e) { return; }
      const c = lastCrash(text);
      if (!c) return;
      if (c.jump) {
        setAutoGo(false);
        setCrashNote("Premiere stopped last time while Gap QC moved the playhead. \u201CGo to the next one automatically\u201D is now off; click a row when you want to go to it.");
      } else {
        const names = CHECKS.filter(([id]) => c.off.indexOf(id) !== -1).map((x) => x[1]);
        if (c.off.length) setChecks((cur) => { const n = { ...cur }; c.off.forEach((id) => { n[id] = false; }); return n; });
        setCrashNote("Premiere stopped last time " + c.where + (c.file ? " (" + pathMod.basename(c.file) + ")" : "") + ". " +
          (names.length ? "Turned off: " + names.join(", ") + ". Everything else still works." : "Try the open sequence only, and tell Harsh\u2019s maker what you checked."));
      }
      logLine("handled");
    });
  }, []);
  const listRef = useRef(null);
  const [maxFrames, setMaxFrames] = useState(() => lsGet("max", 5));
  const [audio, setAudio] = useState(() => lsGet("audio", false));
  const [phase, setPhase] = useState("idle"); // idle | checking | done
  const [run, setRun] = useState(null);
  const [open, setOpen] = useState({});
  const [state, setState] = useState({}); // key -> "fixed" | "ignored"
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);
  const [checks, setChecks] = useState(() => ({ gaps: true, cuts: true, sync: true, black: true, rate: true, dups: false, ...lsGet("checks2", {}) }));
  const [autoGo, setAutoGo] = useState(() => lsGet("autoGo", true));
  useEffect(() => { lsSet("checks2", checks); }, [checks]);
  useEffect(() => { lsSet("autoGo", autoGo); }, [autoGo]);

  useEffect(() => { lsSet("scope2", scope); }, [scope]);
  useEffect(() => { lsSet("max", maxFrames); }, [maxFrames]);
  useEffect(() => { lsSet("audio", audio); }, [audio]);

  // Ignored items last for this Premiere / After Effects session only.
  const ignoreScope = run ? "ignored:" + run.project + "@" + run.session : "";
  const live = run ? run.gaps.filter((g) => state[g.key] !== "ignored") : [];
  const todo = live.filter((g) => !state[g.key]);
  const gapsTodo = todo.filter(isGap);
  const ignored = run ? run.gaps.filter((g) => state[g.key] === "ignored") : [];
  const handled = run ? run.gaps.filter((g) => state[g.key] === "fixed" || state[g.key] === "corrected") : [];
  const current = todo.find((g) => g.key === sel) || null;
  const blacks = todo.filter((g) => g.black).length;
  useEffect(() => { report(phase === "checking" ? { running: true } : run ? { count: todo.length, at: run.at } : null); }, [phase, run, todo.length]);

  async function check() {
    setErr(""); setNote(""); setOpen({}); setPhase("checking"); setEditSetup(false); setShown(100);
    const t0 = performance.now();
    try {
      if (!isAE) { await logPath(); logLine("check " + new Date().toISOString() + " " + JSON.stringify(checks), true); }
      let r;
      if (isAE) r = await call("aeScan", { scope, maxFrames, checks: { gaps: true } });
      else {
        // Premiere reads the timeline once; the checking happens here in the panel.
        const dump = await call("prDump", { scope, audio, checks, logPath: logFile });
        r = { project: dump.project, containers: dump.seqs.length, gaps: analyze(dump, { checks, maxFrames, audio }) };
      }
      if (!isAE) logLine("panel done");
      r.gaps.forEach((g) => { g.tc = timecode(g.time, g.fps); if (g.againAt !== undefined) g.againTc = timecode(g.againAt, g.fps); });
      // Black flashes first, then by place in the edit.
      const rank = (g) => (g.kind === "offline" ? 0 : g.black ? 1 : 2);
      r.gaps.sort((a, b) => (rank(a) - rank(b)) || (a.container < b.container ? -1 : a.container > b.container ? 1 : a.time - b.time));
      r.session = await appSession();
      // forget ignores from earlier sessions
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.indexOf(KEY + "ignored:") === 0 && !k.endsWith("@" + r.session)) localStorage.removeItem(k);
        }
      } catch (e) {}
      const saved = remembered("ignored:" + r.project + "@" + r.session);
      const st = {};
      r.gaps.forEach((g) => { if (saved[g.key]) st[g.key] = saved[g.key].s; });
      setState(st);
      setRun({ ...r, ms: performance.now() - t0, at: Date.now() });
      setSel((r.gaps.find((g) => !st[g.key]) || {}).key || null);
      setPhase("done");
    } catch (e) { setErr(e.message); setPhase(run ? "done" : "idle"); }
  }

  function setMark(g, v) {
    setState((s) => { const n = { ...s }; if (v) n[g.key] = v; else delete n[g.key]; return n; });
    // Ignore and Corrected are remembered until the app is restarted or REMEMBER_HOURS pass.
    if (v === "ignored" || v === "corrected" || v === null) {
      const map = remembered(ignoreScope);
      if (v) map[g.key] = { s: v, t: Date.now() }; else delete map[g.key];
      lsSet(ignoreScope, map);
    }
  }
  // Select a row (and go to it). After a row is handled it leaves the list, and the row that
  // takes its place is selected, so the next one is right under the mouse.
  function pick(g, go = autoGo) {
    setSel(g ? g.key : null);
    if (g && go) jump(g);
  }
  function next(g) {
    const idx = todo.indexOf(g);
    const rest = todo.filter((x) => x.key !== g.key);
    pick(rest[Math.min(idx, rest.length - 1)] || null);
  }
  const done = (g, v) => { setMark(g, v); next(g); };
  async function addMarkers() {
    setErr(""); setNote("");
    const by = {};
    todo.forEach((g) => { (by[g.containerId] = by[g.containerId] || []).push({ time: g.time, name: "Harsh: " + what(g), comment: detail(g), color: MARKER_COLOR[g.kind] || 1 }); });
    let n = 0;
    try { for (const id in by) n += (await call("prMarkers", { containerId: id, items: by[id] })).added; setNote("Added " + plural(n, "marker") + " to the timeline."); }
    catch (e) { setErr(e.message); }
  }
  function saveReport() {
    setErr(""); setNote("");
    try {
      const fs = nodeRequire("fs"), path = nodeRequire("path");
      const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      const rows = [["Problem", "Where", "Track", "Timecode", "Details", "Status"]].concat(run.gaps.map((g) =>
        [what(g), g.container, g.trackName || "", g.tc, detail(g), state[g.key] || "to fix"]));
      toolDir("Gap QC").then((dir) => {
        const out = path.join(dir, "Reports");
        if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
        const file = path.join(out, String(run.project).replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_") + " " + stamp + ".csv");
        fs.writeFileSync(file, "\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n"), "utf8");
        setNote("Saved the report to Harsh Library \u203A Tools \u203A Gap QC \u203A Reports.");
        lib("openFolder", { path: out }).catch(() => {});
      }).catch((e) => setErr(e.message));
    } catch (e) { setErr(e.message); }
  }
  // One jump at a time, and only the latest one: several calls into Premiere at once
  // (clicking fast, or auto go to right after a fix) can make it fall over.
  const jumping = useRef({ busy: false, next: null });
  function jump(g) {
    setErr("");
    const arg = isAE ? { containerId: g.containerId, time: g.time, prevIndex: g.prevIndex, nextIndex: g.nextIndex, layers: g.layers }
      : { containerId: g.containerId, startTicks: g.startTicks };
    const q = jumping.current;
    q.next = arg;
    if (q.busy) return;
    const runNext = () => {
      const a = q.next; q.next = null;
      if (!a) { q.busy = false; return; }
      q.busy = true;
      if (!isAE) logLine("jump " + a.startTicks);
      const timeout = new Promise((res) => setTimeout(res, 8000)); // never let one slow call block the rest
      Promise.race([call(isAE ? "aeJump" : "prJump", a), timeout]).then(() => { if (!isAE) logLine("jumped"); }, (e) => { if (!isAE) logLine("jumped"); setErr(e.message); }).then(() => setTimeout(runNext, 60));
    };
    runNext();
  }
  async function fix(g) {
    setErr(""); setNote("");
    try { await call(isAE ? "aeFix" : "prFix", g); done(g, "fixed"); setNote("Closed. " + (isAE ? "Cmd/Ctrl+Z in After Effects undoes it." : "Cmd/Ctrl+Z in Premiere undoes it.")); }
    catch (e) { setErr(e.message); }
  }
  async function fixAll() {
    setErr(""); setNote("");
    let ok = 0; const failed = [];
    // Last gap first, so earlier fixes don't shift the clips later ones point at.
    for (const g of gapsTodo.slice().sort((a, b) => b.time - a.time)) {
      try { await call(isAE ? "aeFix" : "prFix", g); setMark(g, "fixed"); ok++; } catch (e) { failed.push(g); }
    }
    setNote(ok ? "Closed " + plural(ok, "gap") + "." : "");
    if (failed.length) setErr(plural(failed.length, "gap") + " couldn’t be closed automatically (no extra frames in the clip). Use Go to and close them by hand.");
  }

  // Keys: up/down move, Enter goes to it, C corrected, I ignore, F closes a gap.
  useEffect(() => {
    if (!run) return undefined;
    const onKey = (e) => {
      if (/input|select|textarea/i.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!listRef.current || !listRef.current.offsetParent) return; // Gap QC isn't on screen
      const i = todo.indexOf(current), k = e.key.toLowerCase();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = todo[Math.max(0, Math.min(todo.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (n) pick(n);
      } else if (!current) return;
      else if (e.key === "Enter") jump(current);
      else if (k === "c") done(current, "corrected");
      else if (k === "i") done(current, "ignored");
      else if (k === "f" && isGap(current)) fix(current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector(".gap-row.sel");
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const busy = phase === "checking";
  return (
    <div className="tool gap-qc">
      {run && !editSetup ? (
        // After a check the settings fold into one line, so the list starts near the top.
        <div className="setup-line">
          <span className="grow trunc">
            {SCOPES.find((o) => o[0] === scope)[1]}{!isAE && ", " + plural(CHECKS.filter(([id]) => checks[id]).length, "check")}, {maxFrames ? "up to " + plural(maxFrames, "frame") : "any length"}
          </span>
          <button className="ghost tight" disabled={busy} onClick={() => setEditSetup(true)}>Change</button>
          <button className="primary tight" disabled={busy} onClick={check}>{busy ? "Checking\u2026" : "Check again"}</button>
        </div>
      ) : (
      <div className="controls">
        <div className="seg" role="radiogroup" aria-label="What to check">
          {SCOPES.map(([id, label]) => (
            <button key={id} role="radio" aria-checked={scope === id} className={scope === id ? "on" : ""} disabled={busy} onClick={() => setScope(id)}>{label}</button>
          ))}
        </div>
        <p className="help">{isAE
          ? (scope === "active" ? "The comp open in the timeline, and every comp inside it." : "Every comp in the project.")
          : (scope === "active" ? "The sequence open in the timeline." : "Every sequence in the project.")}</p>

        {!isAE && (
          <div className="chips look-for" role="group" aria-label="Look for">
            {CHECKS.map(([id, label]) => (
              <button key={id} className={"chip" + (checks[id] ? " on" : "")} aria-pressed={!!checks[id]} disabled={busy}
                onClick={() => setChecks({ ...checks, [id]: !checks[id] })}>{label}</button>
            ))}
          </div>
        )}
        <div className="gap-size">
          <span className="gap-size-label">{isAE ? "Gaps up to" : "Up to"}</span>
          <div className="seg small" role="radiogroup" aria-label="Largest gap to look for, in frames">
            {[1, 2, 3, 5, 10, 0].map((n) => (
              <button key={n} role="radio" aria-checked={maxFrames === n} className={maxFrames === n ? "on" : ""} disabled={busy} onClick={() => setMaxFrames(n)}>{n || "Any"}</button>
            ))}
          </div>
          <span className="gap-size-label">{maxFrames ? "frames" : "length"}</span>
        </div>
        {!isAE && checks.gaps && <label className="check-inline"><input type="checkbox" checked={audio} disabled={busy} onChange={() => setAudio(!audio)} /> Gaps on audio tracks too</label>}

        <button className="primary" disabled={busy || (!isAE && !CHECKS.some(([id]) => checks[id]))} onClick={check}>{busy ? "Checking\u2026" : run ? "Check again" : isAE ? "Find gaps" : "Check timeline"}</button>
      </div>
      )}

      <div aria-live="polite">
        {crashNote && <p className="msg warn">{crashNote} <button className="link-btn" onClick={() => setCrashNote("")}>OK</button></p>}
        {err && <p className="msg bad">{err}</p>}
        {note && <p className="msg good">{note}</p>}
      </div>

      {run && (
        <section className="summary" aria-label="Result">
          <div className="score">
            <span className={"score-num num" + (todo.length ? " warn" : " ok")}>{todo.length || "✓"}</span>
            <div className="score-text">
              <b>{todo.length ? (todo.length === 1 ? "thing to fix" : "things to fix") : "All clear"}</b>
              <span>{blacks ? (blacks === 1 ? "1 flash to black. " : blacks + " flashes to black. ") : ""}{plural(run.containers, isAE ? "comp" : "sequence")} checked in {(run.ms / 1000).toFixed(1)}s.</span>
            </div>
          </div>
          {todo.length > 0 && (
            <div className="summary-acts">
              {gapsTodo.length > 1 && <button className="primary" onClick={fixAll}>Close all {gapsTodo.length} gaps</button>}
              {!isAE && <button className="ghost" onClick={addMarkers}>Add markers</button>}
              <button className="ghost" onClick={saveReport}>Save report</button>
            </div>
          )}
          {todo.length > 0 && <label className="check-inline auto-go"><input type="checkbox" checked={autoGo} onChange={() => setAutoGo(!autoGo)} /> Go to the next one automatically</label>}
        </section>
      )}

      {run && todo.length > 0 && (
        <p className="keys gap-keys"><span><Join size={13} /> close gap <kbd>F</kbd></span><span><Check size={13} /> corrected <kbd>C</kbd></span><span><Ban size={13} /> ignore <kbd>I</kbd></span><span><kbd>&uarr;</kbd><kbd>&darr;</kbd> move</span></p>
      )}
      {run && todo.length > 0 && (
        <ol className="rows gap-list" ref={listRef}>
          {todo.slice(0, shown).map((g) => {
            const on = current === g;
            return (
              <li key={g.key} className={"gap-row" + (on ? " sel" : "")}>
                <button className="gap-pick" aria-current={on ? "true" : undefined} onClick={() => pick(g, true)} title="Go to it">
                  <GapPicture g={g} />
                  <span className="row-main">
                    <span className="row-word">
                      {what(g)}
                      {g.black && <span className="tag black">Black</span>}
                      {g.kind === "offline" && <span className="tag black">Offline</span>}
                    </span>
                    <span className="row-where">
                      <span className="num">{g.tc}</span>
                      {!isAE && <span>{g.trackName}</span>}
                      {run.containers > 1 && <span className="trunc">{g.container}</span>}
                    </span>
                    {on && <span className="gap-detail">{detail(g)}</span>}
                  </span>
                </button>
                <span className="gap-acts">
                  {isGap(g) && <button className="act" onClick={() => fix(g)} title={fixHelp(g) + " (F)"} aria-label="Close gap"><Join /></button>}
                  <button className="act good" onClick={() => done(g, "corrected")} title="Corrected: I fixed it (C)" aria-label="Corrected"><Check size={16} /></button>
                  <button className="act" onClick={() => done(g, "ignored")} title="Ignore (I)" aria-label="Ignore"><Ban /></button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {run && todo.length > shown && (
        <button className="ghost show-more" onClick={() => setShown(shown + 200)}>Show {Math.min(200, todo.length - shown)} more of {todo.length}</button>
      )}

      {handled.length > 0 && (
        <div className="ignored">
          <button className="disclose" aria-expanded={!!open.__done} onClick={() => setOpen({ ...open, __done: !open.__done })}>
            {open.__done ? "Hide done" : plural(handled.length, "done item") + ". Show"}
          </button>
          {open.__done && (
            <ul className="ignored-list">
              {handled.map((g) => (
                <li key={g.key}>
                  <span className="trunc grow"><b>{what(g)}</b> <span className="dim">{state[g.key] === "fixed" ? "closed" : "corrected"}, {g.container} {g.tc}</span></span>
                  {state[g.key] === "corrected" && <button className="ghost tight" onClick={() => setMark(g, null)}>Undo</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ignored.length > 0 && (
        <div className="ignored">
          <button className="disclose" aria-expanded={showIgnored} onClick={() => setShowIgnored(!showIgnored)}>
            {showIgnored ? "Hide ignored" : plural(ignored.length, "ignored item") + ", hidden. Show"}
          </button>
          {showIgnored && (
            <ul className="ignored-list">
              {ignored.map((g) => (
                <li key={g.key}>
                  <span className="trunc grow"><b>{what(g)}</b> <span className="dim">in {g.container} {g.tc}</span></span>
                  <button className="ghost tight" onClick={() => setMark(g, null)}>Show again</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
