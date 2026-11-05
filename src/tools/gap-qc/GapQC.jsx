// Gap QC: finds 1 to 5 frame gaps that flash black (or flash the layer below) before export.
// Host side: jsx/gap-qc.jsx. Each gap is drawn as a tiny timeline so it reads at a glance.
import React, { useEffect, useState } from "react";
import { makeHost, hostApp } from "../../host.js";
import { Target, Forward } from "../../icons.jsx";
import { timecode } from "../text-qc/premiere-sources.js";

const call = makeHost("gap-qc.jsx", "HarshGapQC");
const isAE = hostApp === "AEFT";
const SCOPES = isAE ? [["active", "Open comp"], ["all", "All comps"]] : [["all", "All sequences"], ["active", "Open sequence"]];
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");

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
  return g.frames + "-frame gap";
}
function detail(g) {
  const q = (s) => "“" + s + "”";
  if (g.kind === "start") return "Nothing before " + q(g.next) + ".";
  if (g.kind === "end") {
    if (g.names && g.names.length > 1) return g.names.map(q).join(", ") + " stop before the comp ends.";
    return q(g.prev) + (isAE ? " stops before the comp ends." : " stops before the sequence ends.");
  }
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

  useEffect(() => { lsSet("scope", scope); }, [scope]);
  useEffect(() => { lsSet("max", maxFrames); }, [maxFrames]);
  useEffect(() => { lsSet("audio", audio); }, [audio]);

  const ignoreScope = run ? "ignored:" + run.project : "";
  const live = run ? run.gaps.filter((g) => state[g.key] !== "ignored") : [];
  const todo = live.filter((g) => state[g.key] !== "fixed");
  const ignored = run ? run.gaps.filter((g) => state[g.key] === "ignored") : [];
  const blacks = todo.filter((g) => g.black).length;
  useEffect(() => { report(phase === "checking" ? { running: true } : run ? { count: todo.length, at: run.at } : null); }, [phase, run, todo.length]);

  async function check() {
    setErr(""); setNote(""); setOpen({}); setPhase("checking");
    const t0 = performance.now();
    try {
      const r = await call(isAE ? "aeScan" : "prScan", { scope, maxFrames, audio });
      r.gaps.forEach((g) => { g.tc = timecode(g.time, g.fps); });
      // Black flashes first, then by place in the edit.
      r.gaps.sort((a, b) => (b.black - a.black) || (a.container < b.container ? -1 : a.container > b.container ? 1 : a.time - b.time));
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
  const jump = (g) => { setErr(""); call(isAE ? "aeJump" : "prJump", g).catch((e) => setErr(e.message)); };
  async function fix(g) {
    setErr(""); setNote("");
    try { await call(isAE ? "aeFix" : "prFix", g); setMark(g, "fixed"); setNote("Closed. " + (isAE ? "Cmd/Ctrl+Z in After Effects undoes it." : "Cmd/Ctrl+Z in Premiere undoes it.")); }
    catch (e) { setErr(e.message); }
  }
  async function fixAll() {
    setErr(""); setNote("");
    let ok = 0; const failed = [];
    // Last gap first, so earlier fixes don't shift the clips later ones point at.
    for (const g of todo.slice().sort((a, b) => b.time - a.time)) {
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

        <div className="gap-size">
          <span className="gap-size-label">Gaps up to</span>
          <div className="seg small" role="radiogroup" aria-label="Largest gap to look for, in frames">
            {[1, 2, 3, 4, 5, 10].map((n) => (
              <button key={n} role="radio" aria-checked={maxFrames === n} className={maxFrames === n ? "on" : ""} disabled={busy} onClick={() => setMaxFrames(n)}>{n}</button>
            ))}
          </div>
          <span className="gap-size-label">frames</span>
        </div>
        {!isAE && <label className="check-inline"><input type="checkbox" checked={audio} disabled={busy} onChange={() => setAudio(!audio)} /> Audio tracks too</label>}

        <button className="primary" disabled={busy} onClick={check}>{busy ? "Checking…" : run ? "Check again" : "Find gaps"}</button>
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
              <b>{todo.length ? (todo.length === 1 ? "gap to close" : "gaps to close") : "No gaps found"}</b>
              <span>{blacks ? (blacks === 1 ? "1 flash to black. " : blacks + " flashes to black. ") : ""}{plural(run.containers, isAE ? "comp" : "sequence")} checked in {(run.ms / 1000).toFixed(1)}s.</span>
            </div>
          </div>
          {todo.length > 1 && (
            <div className="summary-acts">
              <button className="primary" onClick={fixAll}>Close all {todo.length}</button>
            </div>
          )}
        </section>
      )}

      {run && live.length > 0 && (
        <ol className="rows gap-rows">
          {live.map((g) => {
            const fixed = state[g.key] === "fixed", isOpen = !!open[g.key];
            return (
              <li key={g.key} className={"row" + (fixed ? " done" : "") + (isOpen ? " open" : "")}>
                <button className="row-head" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [g.key]: !isOpen })}>
                  <GapPicture g={g} />
                  <span className="row-main">
                    <span className="row-word">
                      {what(g)}
                      {g.black && !fixed && <span className="tag black">Black</span>}
                      {fixed && <span className="fixed"> Closed</span>}
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
                      {!fixed && <button className="ghost tight" onClick={() => fix(g)}>Close gap</button>}
                      {!fixed && <button className="ghost tight" onClick={() => setMark(g, "ignored")}>Ignore</button>}
                    </div>
                    {!fixed && <p className="help">{fixHelp(g)}</p>}
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
            {showIgnored ? "Hide ignored" : plural(ignored.length, "ignored gap") + ", hidden. Show"}
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
