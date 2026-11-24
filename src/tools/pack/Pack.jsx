// Pack: a PlumePack-style project packer for Premiere.
// Collects every file the project uses into one archive folder, trims the unused part of each
// clip without re-encoding (handles either side), sorts the files, saves a relinked copy of the
// project and writes a report. The original project and media are never changed.
// Host side: jsx/pack.jsx. File work: ./engine.js.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { makeHost, nodeRequire, pickFolder } from "../../host.js";
import { toolDir, lib } from "../../library.js";
import { Folder, Scissors, Copy, Close } from "../../icons.jsx";
import * as E from "./engine.js";

const call = makeHost("pack.jsx", "HarshPack");
const fs = nodeRequire("fs"), path = nodeRequire("path"), os = nodeRequire("os");

const KEY = "harsh.pack.";
const lsGet = (k, d) => { try { const v = localStorage.getItem(KEY + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} };
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
const pct = (a, b) => (b ? Math.max(0, Math.round((1 - a / b) * 100)) : 0);

const HANDLES = [0, 2, 5, 10];
const FILTERS = [
  ["all", "All"],
  ["trim", "Trimmed"],
  ["copy", "Copied"],
  ["missing", "Missing"],
  ["skip", "Not packed"],
];
const ACTION_LABEL = { trim: "Trim", copy: "Copy", sequence: "Copy", missing: "Missing", skip: "Not packed" };
const TAG_CLASS = { Footage: "video", Audio: "music", Graphics: "mogrt", "After Effects": "ae", Other: "" };
const inFilter = (e, f) => f === "all" || (f === "copy" ? e.action === "copy" || e.action === "sequence" : e.action === f);

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
}
const shortPath = (p) => { const h = os.homedir(); return p && p.indexOf(h) === 0 ? "~" + p.slice(h.length) : p || ""; };
function openFile(p) {
  const url = "file://" + encodeURI(p);
  try { window.cep.util.openURLInDefaultBrowser(url); } catch (e) { window.open(url); }
}

/** The whole clip as a bar: the part kept (soft), the parts the sequences use (solid). */
function UseStrip({ e }) {
  const d = e.duration;
  if (!d || !e.used) return null;
  const x = (t) => Math.max(0, Math.min(100, (t / d) * 100)) + "%";
  const w = (a, b) => Math.max(0.6, ((Math.min(b, d) - Math.max(0, a)) / d) * 100) + "%";
  const keepA = e.action === "trim" ? e.trimStart : e.keepStart, keepB = e.action === "trim" ? e.trimEnd : e.keepEnd;
  return (
    <span className="pack-strip" aria-hidden="true">
      {keepA != null && <i className="keep" style={{ left: x(keepA), width: w(keepA, keepB) }} />}
      {(e.used.spans || [[e.used.min, e.used.max]]).map((s, i) => <i key={i} className="use" style={{ left: x(s[0]), width: w(s[0], s[1]) }} />)}
    </span>
  );
}

function SizeBars({ before, after, live }) {
  const r = before ? Math.max(0.02, Math.min(1, after / before)) : 0;
  return (
    <div className="pack-bars">
      <div className="pack-bar"><span className="lbl">Now</span><span className="track"><i style={{ width: "100%" }} className="was" /></span><span className="num">{E.fmtBytes(before)}</span></div>
      <div className="pack-bar"><span className="lbl">Archive</span><span className="track"><i style={{ width: r * 100 + "%" }} /></span><span className="num">{live ? "" : "~"}{E.fmtBytes(after)}</span></div>
    </div>
  );
}

function FileRow({ e, open, toggle }) {
  const err = e.error || (e.done === false && e.action !== "missing" && e.action !== "skip");
  const label = e.error ? "Error" : ACTION_LABEL[e.action];
  const after = e.done ? e.finalSize : e.action === "missing" || e.action === "skip" ? null : e.estSize;
  return (
    <li className={"row pack-row" + (open ? " open" : "") + (e.action === "skip" ? " done" : "")}>
      <button className="row-head" onClick={toggle} aria-expanded={open}>
        <span className={"pack-act " + (err ? "bad" : e.action)} title={label}>{e.action === "trim" ? <Scissors size={13} /> : e.action === "missing" || err ? "!" : e.action === "skip" ? "–" : <Copy size={12} />}</span>
        <span className="row-main">
          <span className="row-word">{e.name}</span>
          <span className="row-where">
            <span className={"tag " + (TAG_CLASS[e.category] || "")}>{e.category}</span>
            {e.action === "missing" ? <span className="bad-text">Not found</span> : <span className="num">{E.fmtBytes(e.size)}{after != null && after !== e.size ? " → " + (e.done ? "" : "~") + E.fmtBytes(after) : ""}</span>}
            {e.used && e.used.seqs.length > 0 && <span className="trunc">{e.used.seqs.join(", ")}</span>}
          </span>
          {(e.action === "trim" || e.keepStart != null) && <UseStrip e={e} />}
        </span>
      </button>
      {open && (
        <div className="row-body pack-detail">
          {(e.error || e.note) && <p className={e.error ? "msg bad" : "help"}>{e.error || e.note}</p>}
          {e.action !== "missing" && <p className="help num">{E.fmtBytes(e.size) + (after != null && after !== e.size ? " → " + (e.done ? "" : "~") + E.fmtBytes(after) : "")}</p>}
          <p className="help trunc" title={e.src}>{shortPath(e.src)}</p>
          {e.dest && <p className="help trunc" title={e.dest}>{"→ " + shortPath(e.dest)}</p>}
          {e.names && e.names.length > 1 && <p className="help">{"Used by " + e.names.length + " project items: " + e.names.join(", ")}</p>}
        </div>
      )}
    </li>
  );
}

export default function Pack({ report = () => {} }) {
  const [ff, setFF] = useState(() => E.findFFmpeg(lsGet("ffmpeg", "")));
  const [dest, setDest] = useState(() => lsGet("dest", ""));
  const [handles, setHandles] = useState(() => lsGet("handles", 5));
  const [opts, setOpts] = useState(() => lsGet("opts", { trim: true, organize: true, includeUnused: false }));
  const [phase, setPhase] = useState("idle"); // idle | analyzing | ready | confirm | packing | done
  const [prog, setProg] = useState({ frac: 0, label: "" });
  const [scan, setScan] = useState(null);   // what Premiere said
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");
  const [openRow, setOpenRow] = useState(null);
  const [shown, setShown] = useState(120);
  const [history, setHistory] = useState([]);
  const [editSetup, setEditSetup] = useState(false);
  const signal = useRef(null);
  const t0 = useRef(0);

  const busy = phase === "analyzing" || phase === "packing";
  useEffect(() => { lsSet("dest", dest); }, [dest]);
  useEffect(() => { lsSet("handles", handles); }, [handles]);
  useEffect(() => { lsSet("opts", opts); }, [opts]);
  useEffect(() => { report(busy ? { running: true } : null); }, [busy]);
  useEffect(() => { readHistory().then(setHistory).catch(() => {}); }, []);

  // Changing a setting makes the analysis stale.
  const change = (fn) => { fn(); if (phase === "ready" || phase === "confirm") { setPhase("idle"); setPlan(null); setEditSetup(false); } };

  const sum = useMemo(() => (plan ? E.summarize(plan) : null), [plan]);
  const counts = useMemo(() => {
    const c = {};
    if (plan) FILTERS.forEach(([id]) => { c[id] = plan.filter((e) => inFilter(e, id)).length; });
    return c;
  }, [plan]);
  const rows = useMemo(() => {
    if (!plan) return [];
    const order = { missing: 0, trim: 1, copy: 2, sequence: 2, skip: 3 };
    return plan.filter((e) => inFilter(e, filter))
      .sort((a, b) => (order[a.action] - order[b.action]) || (b.size - a.size));
  }, [plan, filter]);

  function pickFF() {
    const r = window.cep.fs.showOpenDialogEx(false, false, "Select the ffmpeg program (ffprobe must be next to it)", "/opt/homebrew/bin", []);
    const p = r && r.data && r.data[0];
    if (!p) return;
    const found = E.findFFmpeg(p);
    if (found) { lsSet("ffmpeg", p); setFF(found); setErr(""); }
    else setErr("ffprobe wasn't found next to that ffmpeg. Pick an ffmpeg that has ffprobe in the same folder.");
  }

  function stop() {
    if (!signal.current) return;
    signal.current.stopped = true;
    try { if (signal.current.child) signal.current.child.kill("SIGTERM"); } catch (e) {}
    setProg((p) => ({ ...p, label: "Stopping…" }));
  }

  async function analyze() {
    setErr(""); setResult(null); setPlan(null); setOpenRow(null); setShown(120); setFilter("all"); setEditSetup(false);
    if (!ff) { setErr("Pack needs ffmpeg to trim footage. Install it (brew install ffmpeg) or pick one, then try again."); return; }
    setPhase("analyzing"); t0.current = Date.now();
    signal.current = { stopped: false };
    setProg({ frac: 0, label: "Reading the project…" });
    try {
      const s = await call("analyze");
      setScan(s);
      if (!s.items.length) throw new Error("This project has no media files to pack.");
      const p = await E.buildPlan(s.items, { ...opts, handles }, ff,
        (i, n, name) => setProg({ frac: i / n, label: "Looking at " + name + "…" }), signal.current);
      setPlan(p);
      setPhase("ready");
    } catch (e) {
      setErr(e.message);
      setPhase("idle");
    }
    signal.current = null;
  }

  async function pack() {
    setErr("");
    if (!dest || !fs.existsSync(dest)) { setErr("Choose where the archive should go first."); setPhase("ready"); return; }
    setPhase("packing"); t0.current = Date.now();
    signal.current = { stopped: false };
    const projName = String(scan.projectName || "Project").replace(/\.prproj$/i, "");
    const root = path.join(dest, projName.replace(/[\/\\:*?"<>|]/g, "-") + "_Archive_" + stamp());
    const o = { ...opts, handles };
    try {
      fs.mkdirSync(path.join(root, "Project"), { recursive: true });
      const work = plan.map((e) => ({ ...e }));
      await E.execute(work, root, o, ff, (i, n, name, action, frac) => setProg({
        frac: frac * 0.92,
        label: action === "done" ? "Files done" : (action === "trim" ? "Trimming " : "Copying ") + name + "  " + i + "/" + n,
      }), signal.current);
      setPlan(work);

      setProg({ frac: 0.95, label: "Saving the archive project and relinking…" });
      const planFile = path.join(os.tmpdir(), "frameshift-pack-" + Date.now() + ".json");
      fs.writeFileSync(planFile, JSON.stringify(E.relinkPlan(work)));
      const newProject = path.join(root, "Project", projName + "_Archive.prproj");
      let res;
      try { res = await call("pack", { planFile, newProject, expectProject: scan.projectPath }); }
      catch (e) { res = { error: e.message, adjusted: 0, relinked: 0, adjustFailed: [], relinkFailed: [] }; }
      try { fs.unlinkSync(planFile); } catch (e) {}

      const rep = E.writeReport(root, projName, work, res, o);
      const r = { root, report: rep.htmlPath, project: res.projectPath || newProject, original: scan.projectPath, res, before: rep.before, after: rep.after,
        problems: rep.problems, files: work.filter((e) => e.done).length, ms: Date.now() - t0.current, at: Date.now(), name: projName };
      setResult(r);
      setPhase("done");
      setProg({ frac: 1, label: "" });
      addHistory(r).then(setHistory).catch(() => {});
    } catch (e) {
      setErr(e.message);
      setPhase("ready");
    }
    signal.current = null;
  }

  async function backToOriginal() {
    try { await call("openProject", { path: result.original }); } catch (e) { setErr(e.message); }
  }

  const trimDisabled = !opts.trim;
  return (
    <div className="tool pack">
      {!ff && (
        <div className="msg warn">
          Pack uses ffmpeg to trim footage without re-encoding. Install it with <b>brew install ffmpeg</b> (or Shutter Encoder), then reopen Pack.{" "}
          <button className="link-btn" onClick={pickFF}>Pick ffmpeg…</button>
        </div>
      )}

      {plan && !editSetup ? (
        <div className="setup-line">
          <span className="grow trunc" title={dest}>
            {(opts.trim ? handles + "s handles" : "No trim") + (opts.organize ? ", sorted" : "") + (opts.includeUnused ? ", + unused" : "") + " → " + (dest ? path.basename(dest) : "no folder")}
          </span>
          <button className="ghost tight" disabled={busy || phase === "done"} onClick={() => setEditSetup(true)}>Change</button>
        </div>
      ) : (
      <div className="controls">
        <div className="pane pack-dest">
          <Folder size={15} />
          <span className="grow trunc" title={dest}>{dest ? shortPath(dest) : <span className="dim">Choose where the archive goes</span>}</span>
          <button className="ghost tight" disabled={busy} onClick={() => { const d = pickFolder("Where should the archive go?"); if (d) setDest(d); }}>{dest ? "Change" : "Choose…"}</button>
        </div>

        <div className="chips" role="group" aria-label="Options">
          <button className={"chip" + (opts.trim ? " on" : "")} aria-pressed={opts.trim} disabled={busy} onClick={() => change(() => setOpts({ ...opts, trim: !opts.trim }))}>Trim unused footage</button>
          <button className={"chip" + (opts.organize ? " on" : "")} aria-pressed={opts.organize} disabled={busy} onClick={() => change(() => setOpts({ ...opts, organize: !opts.organize }))}>Sort into folders</button>
          <button className={"chip" + (opts.includeUnused ? " on" : "")} aria-pressed={opts.includeUnused} disabled={busy} onClick={() => change(() => setOpts({ ...opts, includeUnused: !opts.includeUnused }))}>Copy unused media</button>
        </div>

        <div className={"pack-handles" + (trimDisabled ? " off" : "")}>
          <span className="gap-size-label">Handles</span>
          <div className="seg small" role="radiogroup" aria-label="Seconds kept before and after each used part">
            {HANDLES.map((n) => (
              <button key={n} role="radio" aria-checked={handles === n} className={handles === n ? "on" : ""} disabled={busy || trimDisabled} onClick={() => change(() => setHandles(n))}>{n}</button>
            ))}
          </div>
          <span className="gap-size-label">sec each side</span>
        </div>

        <p className="help">{opts.trim
          ? "Keeps only the parts your sequences use, plus handles. No re-encode: same codec, same pixels. Your original project and media stay untouched."
          : "Copies every used file whole into one folder and relinks a copy of the project. Your original stays untouched."}</p>

        {phase !== "ready" && phase !== "confirm" && phase !== "done" && (
          <button className="primary" disabled={busy || !ff} onClick={analyze}>{phase === "analyzing" ? "Analyzing…" : "Analyze project"}</button>
        )}
        {plan && editSetup && <button className="ghost tight" onClick={() => setEditSetup(false)}>Done</button>}
      </div>
      )}

      {busy && (
        <div className="pack-run" aria-live="polite">
          <div className="meter"><div className="fill" style={{ transform: "scaleX(" + Math.max(0.02, prog.frac) + ")" }} /></div>
          <div className="running-row">
            <span className="status trunc">{prog.label}</span>
            <button className="ghost tight" onClick={stop} disabled={!signal.current || signal.current.stopped}><Close size={12} /> Stop</button>
          </div>
        </div>
      )}

      <div aria-live="polite">{err && <p className="msg bad">{err}</p>}</div>

      {plan && sum && phase !== "done" && (
        <section className="summary" aria-label="Analysis">
          <div className="score">
            <span className="score-num num ok">{pct(sum.after, sum.before)}<small>%</small></span>
            <div className="score-text">
              <b>{sum.before - sum.after > 0 ? "~" + E.fmtBytes(sum.before - sum.after) + " smaller" : "Ready to collect"}</b>
              <span>{plural(sum.trim + sum.copy, "file")} from {plural(scan.sequences, "sequence")} {"·"} {plural(scan.clips, "clip")}</span>
            </div>
          </div>
          <SizeBars before={sum.before} after={sum.after} />
          {sum.missing > 0 && <p className="msg warn">{sum.missing === 1 ? "1 file is missing on disk. It stays offline" : sum.missing + " files are missing on disk. They stay offline"} in the archive copy. Relink first if you need {sum.missing === 1 ? "it" : "them"}.</p>}

          {phase === "confirm" ? (
            <div className="confirm-box">
              <p>Premiere will <b>save your project</b>, then open the archive copy in its place. Your original project and media aren't changed.</p>
              <p className="help trunc" title={dest}>{"Into " + shortPath(dest)}</p>
              <div className="inline">
                <button className="ghost tight strong" onClick={pack}>Pack now</button>
                <button className="ghost tight" onClick={() => setPhase("ready")}>Cancel</button>
              </div>
            </div>
          ) : phase === "ready" && (
            <div className="summary-acts">
              <button className="primary" disabled={!dest} onClick={() => setPhase("confirm")}>{dest ? "Pack project" : "Choose a folder first"}</button>
              <button className="ghost" onClick={analyze}>Analyze again</button>
            </div>
          )}
        </section>
      )}

      {phase === "done" && result && (
        <section className="summary" aria-label="Packed">
          <div className="score">
            <span className={"score-num num" + (result.problems.length ? " warn" : " ok")}>{result.problems.length || "✓"}</span>
            <div className="score-text">
              <b>{result.problems.length ? plural(result.problems.length, "thing") + " to check" : "Packed"}</b>
              <span>{plural(result.files, "file")} {"·"} {plural(result.res.adjusted || 0, "clip")} re-timed {"·"} {(result.ms / 1000).toFixed(0)}s</span>
            </div>
          </div>
          <SizeBars before={result.before} after={result.after} live />
          {result.problems.length > 0 && (
            <div className="msg warn pack-problems">
              {result.problems.slice(0, 4).map((p, i) => <div key={i}>{p}</div>)}
              {result.problems.length > 4 && <div>{"+ " + (result.problems.length - 4) + " more in the report"}</div>}
            </div>
          )}
          {!result.res.error && <p className="help">Premiere has the archive copy open now. Scrub it once before you delete anything.</p>}
          <div className="summary-acts">
            <button className="primary" onClick={() => lib("openFolder", { path: result.root }).catch((e) => setErr(e.message))}><Folder size={14} /> Open archive</button>
            <button className="ghost" onClick={() => openFile(result.report)}>Report</button>
          </div>
          <div className="inline">
            <button className="ghost tight" onClick={backToOriginal}>Back to original project</button>
            <button className="ghost tight" onClick={() => { setPhase("idle"); setPlan(null); setResult(null); }}>Pack another</button>
          </div>
        </section>
      )}

      {plan && (
        <>
          <div className="chips pack-filter" role="group" aria-label="Show">
            {FILTERS.filter(([id]) => id === "all" || counts[id]).map(([id, label]) => (
              <button key={id} className={"chip" + (filter === id ? " on" : "")} aria-pressed={filter === id} onClick={() => { setFilter(id); setShown(120); }}>
                {label} <span className="num">{counts[id]}</span>
              </button>
            ))}
          </div>
          <ol className="rows pack-list">
            {rows.slice(0, shown).map((e) => (
              <FileRow key={e.src} e={e} open={openRow === e.src} toggle={() => setOpenRow(openRow === e.src ? null : e.src)} />
            ))}
          </ol>
          {rows.length > shown && <button className="ghost show-more" onClick={() => setShown(shown + 200)}>Show {Math.min(200, rows.length - shown)} more of {rows.length}</button>}
          {opts.trim && <p className="help pack-legend"><i className="k" /> kept <i className="u" /> used in a sequence. MP4, MOV and M4V are trimmed; MXF, MTS, BRAW, R3D, audio and graphics are copied whole.</p>}
        </>
      )}

      {!plan && !busy && history.length > 0 && (
        <section className="pack-history">
          <div className="section-title">Recent packs</div>
          <ul className="rows">
            {history.slice(0, 5).map((h) => (
              <li key={h.root} className="row">
                <div className="row-head">
                  <span className="row-main">
                    <span className="row-word">{h.name}</span>
                    <span className="row-where"><span className="num">{E.fmtBytes(h.before)} {"→"} {E.fmtBytes(h.after)}</span><span>{new Date(h.at).toLocaleDateString()}</span></span>
                  </span>
                  <button className="ghost tight" onClick={() => lib("openFolder", { path: h.root }).catch((e) => setErr(e.message))}><Folder size={13} /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// Recent packs live in the Frameshift Library: Tools/Pack/history.json
async function historyFile() { return path.join(await toolDir("Pack"), "history.json"); }
async function readHistory() {
  const f = await historyFile();
  try { return JSON.parse(fs.readFileSync(f, "utf8")).filter((h) => fs.existsSync(h.root)); } catch (e) { return []; }
}
async function addHistory(r) {
  const list = await readHistory();
  const next = [{ name: r.name, root: r.root, before: r.before, after: r.after, at: r.at }].concat(list.filter((h) => h.root !== r.root)).slice(0, 20);
  fs.writeFileSync(await historyFile(), JSON.stringify(next, null, 2));
  return next;
}
