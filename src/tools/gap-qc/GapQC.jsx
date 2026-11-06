// Gap QC: finds short gaps that flash black (or flash the layer below) before export, and in
// Premiere also cuts that don't line up across tracks, audio out of sync, and black or offline clips.
// Host side: jsx/gap-qc.jsx. Each gap is drawn as a tiny timeline so it reads at a glance.
import React, { useEffect, useState } from "react";
import { makeHost, hostApp } from "../../host.js";
import { Target, Forward } from "../../icons.jsx";
import { timecode } from "../text-qc/premiere-sources.js";

const call = makeHost("gap-qc.jsx", "HarshGapQC");
const isAE = hostApp === "AEFT";
const SCOPES = isAE ? [["active", "Open comp"], ["all", "All comps"]] : [["all", "All sequences"], ["active", "Open sequence"]];
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
// What Premiere can look for. After Effects only looks for gaps.
const CHECKS = [
  ["gaps", "Gaps"],
  ["cuts", "Cuts that don\u2019t line up"],
  ["sync", "Audio out of sync"],
  ["black", "Black or offline clips"],
];
const GAP_KINDS = { start: 1, between: 1, end: 1 };
const isGap = (g) => !!GAP_KINDS[g.kind];
const MARKER_COLOR = { start: 1, between: 1, end: 1, cut: 3, sync: 5, blackvideo: 0, offline: 0 }; // red, orange, purple, green

const KEY = "harsh.gapqc.";
const lsGet = (k, d) => { try { const v = localStorage.getItem(KEY + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} };

function what(g) {
  const f = plural(g.frames, "frame");
  if (g.kind === "start") return f + " empty at the start";
  if (g.kind === "end") {
    if (!isAE) return g.trackName + " ends " + f + " early";
    return (g.layers && g.layers.length > 1 ? g.layers.length + " layers end " : "Ends ") + f + " before the comp";
  }
  if (g.kind === "cut") return "Cuts " + plural(g.frames, "frame") + " apart";
  if (g.kind === "sync") return "Audio " + plural(g.frames, "frame") + (g.audioEarly ? " early" : " late");
  if (g.kind === "blackvideo") return "Black Video clip";
  if (g.kind === "offline") return "Media offline";
  return g.frames + "-frame gap";
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
  if (g.kind === "blackvideo" || g.kind === "offline") {
    return <span className={"gap-pic solo " + g.kind} aria-hidden="true"><i className="clip" /><i className="bad-clip">{g.kind === "offline" ? "?" : ""}</i><i className="clip" /></span>;
  }
  return (
    <span className={"gap-pic" + (g.black ? " black" : "")} aria-hidden="true">
      <i className={"clip" + (g.kind === "start" ? " none" : "")} />
      <i className="hole" style={{ width: w }}><b className="num">{g.frames}</b></i>
      <i className={"clip" + (g.kind === "end" ? " none" : "")} />
    </span>
  );
}

export default function GapQC({ report = () => {} }) {
  const [scope, setScope] = useState(() => lsGet("scope", SCOPES[0][0]));
  const [maxFrames, setMaxFrames] = useState(() => lsGet("max", 5));
  const [audio, setAudio] = useState(() => lsGet("audio", false));
  const [phase, setPhase] = useState("idle"); // idle | checking | done
  const [run, setRun] = useState(null);
  const [open, setOpen] = useState({});
  const [state, setState] = useState({}); // key -> "fixed" | "ignored"
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);
  const [checks, setChecks] = useState(() => ({ gaps: true, cuts: true, sync: true, black: true, ...lsGet("checks", {}) }));
  const [autoGo, setAutoGo] = useState(() => lsGet("autoGo", true));
  useEffect(() => { lsSet("checks", checks); }, [checks]);
  useEffect(() => { lsSet("autoGo", autoGo); }, [autoGo]);

  useEffect(() => { lsSet("scope", scope); }, [scope]);
  useEffect(() => { lsSet("max", maxFrames); }, [maxFrames]);
  useEffect(() => { lsSet("audio", audio); }, [audio]);

  const ignoreScope = run ? "ignored:" + run.project : "";
  const live = run ? run.gaps.filter((g) => state[g.key] !== "ignored") : [];
  const todo = live.filter((g) => !state[g.key]);
  const gapsTodo = todo.filter(isGap);
  const ignored = run ? run.gaps.filter((g) => state[g.key] === "ignored") : [];
  const blacks = todo.filter((g) => g.black).length;
  useEffect(() => { report(phase === "checking" ? { running: true } : run ? { count: todo.length, at: run.at } : null); }, [phase, run, todo.length]);

  async function check() {
    setErr(""); setNote(""); setOpen({}); setPhase("checking");
    const t0 = performance.now();
    try {
      const r = await call(isAE ? "aeScan" : "prScan", { scope, maxFrames, audio, checks: isAE ? { gaps: true } : checks });
      r.gaps.forEach((g) => { g.tc = timecode(g.time, g.fps); });
      // Black flashes first, then by place in the edit.
      const rank = (g) => (g.kind === "offline" ? 0 : g.black ? 1 : 2);
      r.gaps.sort((a, b) => (rank(a) - rank(b)) || (a.container < b.container ? -1 : a.container > b.container ? 1 : a.time - b.time));
      const saved = lsGet("ignored:" + r.project, []);
      const st = {};
      r.gaps.forEach((g) => { if (saved.indexOf(g.key) !== -1) st[g.key] = "ignored"; });
      setState(st);
      setRun({ ...r, ms: performance.now() - t0, at: Date.now() });
      setPhase("done");
    } catch (e) { setErr(e.message); setPhase(run ? "done" : "idle"); }
  }

  function setMark(g, v) {
    setState((s) => { const n = { ...s }; if (v) n[g.key] = v; else delete n[g.key]; return n; });
    if (v === "ignored" || v === null) {
      const list = lsGet(ignoreScope, []).filter((k) => k !== g.key);
      if (v) list.push(g.key);
      lsSet(ignoreScope, list);
    }
  }
  // After a row is handled, open the next one (and go to it).
  function next(g) {
    const rest = todo.filter((x) => x.key !== g.key);
    const after = rest.find((x) => live.indexOf(x) > live.indexOf(g)) || rest[0];
    setOpen(after ? { [after.key]: true } : {});
    if (after && autoGo) jump(after);
  }
  function openRow(g, isOpen) {
    setOpen({ ...open, [g.key]: !isOpen });
    if (!isOpen && autoGo) jump(g);
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
  const jump = (g) => { setErr(""); call(isAE ? "aeJump" : "prJump", g).catch((e) => setErr(e.message)); };
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

  const busy = phase === "checking";
  return (
    <div className="tool gap-qc">
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
            {[1, 2, 3, 4, 5, 10].map((n) => (
              <button key={n} role="radio" aria-checked={maxFrames === n} className={maxFrames === n ? "on" : ""} disabled={busy} onClick={() => setMaxFrames(n)}>{n}</button>
            ))}
          </div>
          <span className="gap-size-label">frames</span>
        </div>
        {!isAE && checks.gaps && <label className="check-inline"><input type="checkbox" checked={audio} disabled={busy} onChange={() => setAudio(!audio)} /> Gaps on audio tracks too</label>}

        <button className="primary" disabled={busy || (!isAE && !CHECKS.some(([id]) => checks[id]))} onClick={check}>{busy ? "Checking\u2026" : run ? "Check again" : isAE ? "Find gaps" : "Check timeline"}</button>
      </div>

      <div aria-live="polite">
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
            </div>
          )}
          {todo.length > 0 && <label className="check-inline auto-go"><input type="checkbox" checked={autoGo} onChange={() => setAutoGo(!autoGo)} /> Go to each one when I open it</label>}
        </section>
      )}

      {run && live.length > 0 && (
        <ol className="rows gap-rows">
          {live.map((g) => {
            const fixed = !!state[g.key], isOpen = !!open[g.key];
            return (
              <li key={g.key} className={"row" + (fixed ? " done" : "") + (isOpen ? " open" : "")}>
                <button className="row-head" aria-expanded={isOpen} onClick={() => openRow(g, isOpen)}>
                  <GapPicture g={g} />
                  <span className="row-main">
                    <span className="row-word">
                      {what(g)}
                      {g.black && !fixed && <span className="tag black">Black</span>}
                      {g.kind === "offline" && !fixed && <span className="tag black">Offline</span>}
                      {fixed && <span className="fixed"> {state[g.key] === "fixed" ? "Closed" : "Corrected"}</span>}
                    </span>
                    <span className="row-where">
                      <span className="trunc">{g.container}</span>
                      {!isAE && <span>{g.trackName}</span>}
                      <span className="num">{g.tc}</span>
                    </span>
                  </span>
                  <Forward size={14} />
                </button>
                {isOpen && (
                  <div className="row-body">
                    <p className="gap-detail">{detail(g)}</p>
                    <p className="gap-where"><span className="trunc">{g.container}</span>{!isAE && <span>{g.trackName}</span>}<span className="num">{g.tc}</span></p>
                    <div className="inline">
                      <button className="ghost tight" onClick={() => jump(g)}><Target /> Go to</button>
                      {!fixed && isGap(g) && <button className="ghost tight" onClick={() => fix(g)}>Close gap</button>}
                      {!fixed && <button className="ghost tight" onClick={() => done(g, "corrected")} title="You fixed it yourself">Corrected</button>}
                      {!fixed && <button className="ghost tight" onClick={() => done(g, "ignored")}>Ignore</button>}
                      {state[g.key] === "corrected" && <button className="ghost tight" onClick={() => setMark(g, null)}>Undo</button>}
                    </div>
                    {!fixed && isGap(g) && <p className="help">{fixHelp(g)}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
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
