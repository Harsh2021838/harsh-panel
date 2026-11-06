import React, { useEffect, useRef, useState } from "react";
import { host, hostApp, hostName, pickFiles, pickFolder, appSession, premiereGoTo } from "../../host.js";
import { Gear, Close, Back, Forward, Target } from "../../icons.jsx";
import { expandPremiere } from "./premiere-sources.js";
import {
  sleep, fmtSecs, lsGet, lsSet, getPaths, getPathsSync, reportDir, loadDict, addToDict, loadCache, saveCache, resetCache,
  normalize, checkTexts, CATS, CAT_BY_ID, buildGroups, writeReport, findAeps, pathMod, fs, lastError,
  ignoreKey, loadHandled, saveHandled, REMEMBER_HOURS,
} from "./engine.js";

const isAE = hostApp === "AEFT";
const isDone = (v) => v === "fixed" || v === "corrected";
const SCOPES = isAE
  ? [["all", "All comps"], ["selected", "Selected"], ["folders", "Folders"], ["batch", "Other projects"]]
  : [["all", "All sequences"], ["active", "Open sequence"]];
const LANGS = [["en-US", "English (US)"], ["en-GB", "English (UK)"], ["en-AU", "English (Australia)"], ["en-CA", "English (Canada)"],
  ["de-DE", "German"], ["fr", "French"], ["es", "Spanish"], ["pt-BR", "Portuguese (Brazil)"], ["it", "Italian"], ["nl", "Dutch"], ["auto", "Detect automatically"]];
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
const KIND = { title: "Title", mogrt: "Template", ae: "AE comp", caption: "Caption" };

function coverageText(c) {
  const parts = [];
  if (c.titles) parts.push(plural(c.titles, "title"));
  if (c.mogrts) parts.push(plural(c.mogrts, "template field"));
  if (c.comps) parts.push(plural(c.compLayers, "layer") + " in " + plural(c.comps, "After Effects comp"));
  if (c.captions) parts.push(plural(c.captions, "caption"));
  if (!parts.length) return "";
  const last = parts.pop();
  return "Checked " + (parts.length ? parts.join(", ") + " and " + last : last) + ".";
}

/** Where a mistake is: source, sequence/comp, timecode, layer. */
function Where({ p, onGo, compact }) {
  const canGo = !!p.containerId;
  return (
    <div className={"where" + (compact ? " compact" : "")}>
      <div className="where-text">
        <div className="trunc" title={p.project}>
          {p.kind && <span className={"tag " + p.kind}>{KIND[p.kind]}</span>}
          {p.container}{p.tc && <span className="tc num"> {p.tc}</span>}
          {p.via && <span className="dim"> (inside {p.via})</span>}
        </div>
        <div className="trunc sub" title={p.layer}>{p.layer}</div>
      </div>
      {canGo && onGo && <button className="ghost tight" onClick={onGo}><Target /> Go to</button>}
    </div>
  );
}

/** The flagged text, marked like a proofreader would: the problem gets a wavy underline in its category colour. */
function Proofed({ g, big }) {
  const t = g.text.replace(/[\r\u0003]/g, " ");
  const s = Math.max(0, g.offset - 60), e = Math.min(t.length, g.offset + g.length + 60);
  let bad = t.substr(g.offset, g.length);
  if (g.cat === "garbage") {
    bad = bad.replace(/[\s\S]/g, (ch) => {
      const c = ch.charCodeAt(0);
      if (c === 32) return "␣";
      return c < 32 || c === 127 || (c >= 0x200b && c <= 0x200f) || c === 0x2060 || c === 0xfeff || c === 0xfffd ? "▯" : ch;
    });
  }
  return (
    <p className={"proof" + (big ? " big" : "")}>
      {s > 0 && "…"}{t.slice(s, g.offset)}
      <mark style={{ "--c": CAT_BY_ID[g.cat].color }}>{bad || "␣"}</mark>
      {t.slice(g.offset + g.length, e)}{e < t.length && "…"}
    </p>
  );
}

export default function TextQC({ report = () => {} }) {
  const [scope, setScope] = useState(() => {
    const s = lsGet("scope", "all");
    return SCOPES.some((o) => o[0] === s) ? s : "all";
  });
  const [settings, setSettings] = useState(() => ({ lang: "en-US", server: "", username: "", apiKey: "", deep: false, recursive: true, ...lsGet("settings", {}) }));
  const [folders, setFolders] = useState(null);
  const [files, setFiles] = useState(() => lsGet("files", []));
  const [phase, setPhase] = useState("idle"); // idle | reading | checking | done
  const [prog, setProg] = useState({ done: 0, total: 0, label: "" });
  const [run, setRun] = useState(null);
  const [groups, setGroups] = useState([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [cats, setCats] = useState(() => lsGet("cats", CATS.filter((c) => c.on).map((c) => c.id)));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState({});
  const [marks, setMarks] = useState({}); // group id -> "fixed" | "ignored"
  const [showSettings, setShowSettings] = useState(false);
  const [limit, setLimit] = useState(80);
  const [capFiles, setCapFiles] = useState(() => lsGet("captionFiles", []));
  const [review, setReview] = useState(null); // index into the review list, or null
  const token = useRef({ cancelled: false });

  useEffect(() => { lsSet("scope", scope); if (scope === "folders" && !folders) loadFolders(); }, [scope]);
  useEffect(() => { lsSet("settings", settings); }, [settings]);
  useEffect(() => { lsSet("files", files); }, [files]);
  useEffect(() => { lsSet("captionFiles", capFiles); }, [capFiles]);
  useEffect(() => { lsSet("cats", cats); }, [cats]);

  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const fail = (e) => { setErr(e.message || String(e)); setPhase((p) => (p === "done" ? p : "idle")); };
  const mark = (ids, value) => {
    setMarks((m) => { const n = { ...m }; ids.forEach((id) => { if (value) n[id] = value; else delete n[id]; }); return n; });
    // Remember Ignore and Corrected (and undo) for this project, so checking again keeps them
    // hidden, until the app is restarted or REMEMBER_HOURS have passed.
    if (run && (value === "ignored" || value === "corrected" || value === null)) {
      saveHandled(run.ignoreScope, groups.filter((g) => ids.indexOf(g.id) !== -1).map(ignoreKey), value);
    }
  };
  const [showIgnored, setShowIgnored] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [autoGo, setAutoGo] = useState(() => lsGet("autoGo", true));
  // Crash guard: each jump is written to Tools/Text QC/last-jump.log before it's sent. If the
  // app went down during one, the log ends on "jump"; then auto Go to is turned off and we say so.
  const [jumpNote, setJumpNote] = useState("");
  const jumpLog = useRef("");
  useEffect(() => {
    getPaths().then((p) => {
      const fs = window.require("fs"), path = window.require("path");
      jumpLog.current = path.join(p.work, "last-jump.log");
      let last = "";
      try { last = fs.readFileSync(jumpLog.current, "utf8").trim().split("\n").pop(); } catch (e) { return; }
      if (/^jump /.test(last)) {
        setAutoGo(false);
        setJumpNote(hostName + " stopped last time while Text QC was going to a mistake. \u201CGo to\u201D automatically is off for now; use the Go to button.");
      }
      try { fs.writeFileSync(jumpLog.current, "ok\n"); } catch (e) {}
    }).catch(() => {});
  }, []);
  const logJump = (line) => { try { if (jumpLog.current) window.require("fs").appendFileSync(jumpLog.current, line + "\n"); } catch (e) {} };
  useEffect(() => { lsSet("autoGo", autoGo); }, [autoGo]);
  const manualRef = useRef(null);

  function loadFolders() {
    setErr("");
    host("aeListFolders").then((f) => {
      if (!f.length) setErr("This project has no comps.");
      setFolders(f);
    }).catch(fail);
  }
  function addFiles(list) { setFiles((cur) => cur.concat(list.filter((p) => cur.indexOf(p) === -1))); }
  function addFolderOfProjects() {
    const dir = pickFolder("Choose a folder with .aep files");
    if (!dir) return;
    const found = findAeps(dir, settings.recursive);
    if (!found.length) setErr("No .aep files in that folder. Auto-saves and copies are skipped.");
    addFiles(found);
  }

  // Reading the project waits for the app's script engine, which answers nothing while a dialog is
  // open (after a crash Premiere often shows "Link Media" or a recovered-project box). Say so after
  // 15 seconds, and stop waiting after 3 minutes instead of loading forever.
  function waitForApp(promise) {
    const hint = setTimeout(() => setProg((p) => ({ ...(p || { done: 0, total: 0 }), label: "Still waiting for " + hostName + ". If a box is open there (Link Media, a recovered project, Save), close it." })), 15000);
    const limit = new Promise((_, rej) => setTimeout(() => rej(new Error(hostName + " didn\u2019t answer for 3 minutes. Close any open box in " + hostName + " (Link Media, a recovered project), then press Check again.")), 180000));
    return Promise.race([promise, limit]).finally(() => clearTimeout(hint));
  }

  async function start() {
    setErr(""); setNote(""); setRun(null); setGroups([]); setMarks({}); setOpen({}); setLimit(80); setReview(null);
    token.current = { cancelled: false };
    const t0 = performance.now();
    try {
      setPhase("reading");
      setProg({ done: 0, total: 0, label: "Reading text from " + (isAE ? "After Effects" : "Premiere Pro") + "…" });
      await sleep(30);
      await getPaths();
      let items = [], project = "", coverage = null, warnings = [];
      if (isAE && scope === "batch") {
        if (!files.length) throw new Error("Add the projects to check first.");
        for (let i = 0; i < files.length && !token.current.cancelled; i++) {
          setProg({ done: i, total: files.length, label: "Opening " + pathMod.basename(files[i]) + "…" });
          await sleep(30);
          try { items = items.concat((await host("aeOpenAndCollect", { path: files[i] })).items); }
          catch (e) { setNote("Skipped " + pathMod.basename(files[i]) + ": " + e.message); }
        }
      } else if (isAE) {
        const arg = { mode: scope };
        if (scope === "folders") {
          if (!folders) throw new Error("The folder list is still loading.");
          arg.folderIds = folders.filter((f) => f.checked).map((f) => f.id);
          if (!arg.folderIds.length) throw new Error("Tick at least one folder.");
        }
        const r = await waitForApp(host("aeCollect", arg));
        items = r.items; project = r.project;
      } else {
        const r = await waitForApp(host("prCollect", { mode: scope === "active" ? "active" : "all", deep: !!settings.deep }));
        setProg({ done: 0, total: 0, label: "Reading After Effects comps and captions\u2026" });
        await sleep(20);
        const x = expandPremiere(r, capFiles);
        items = x.items; project = r.project; coverage = x.stats; warnings = x.warnings;
      }
      if (!items.length) {
        setPhase("idle");
        setErr(isAE ? "No text layers in that selection."
          : "No text found in this project. Captions made inside Premiere need exporting first (use Add .srt). Legacy Titles can\u2019t be read. If titles are missing, turn on Deep scan in Settings.");
        return;
      }

      const cache = loadCache(), lang = settings.lang || "en-US";
      const uniq = Array.from(new Set(items.map((it) => normalize(it.text))));
      const results = {}, todo = [];
      uniq.forEach((t) => { const c = cache[lang + "|" + t]; if (c) results[t] = c; else todo.push(t); });
      const cached = uniq.length - todo.length;

      setPhase("checking");
      let failed = 0, batches = 0;
      if (todo.length) {
        setProg({ done: 0, total: todo.length, label: "Checking spelling…" });
        const out = await checkTexts(todo, settings, (d, tot, label) => setProg({ done: d, total: tot, label }), token.current);
        failed = out.failed; batches = out.batches;
        Object.keys(out.results).forEach((t) => { results[t] = out.results[t]; cache[lang + "|" + t] = out.results[t]; });
        saveCache();
      }
      const gs = buildGroups(items, results, loadDict());
      gs.forEach((g) => g.places.sort((a, b) => (a.time || 0) - (b.time || 0)));
      const order = { typo: 0, garbage: 1, grammar: 2, caps: 3, unknown: 4 };
      gs.sort((a, b) => order[a.cat] - order[b.cat] || (a.places[0].time || 0) - (b.places[0].time || 0));
      // Hide what was ignored in earlier checks of this project.
      const ignoreScope = ((items[0] && items[0].projectPath) || project || "*") + "@" + (await appSession());
      const handled = loadHandled(ignoreScope), pre = {};
      gs.forEach((g) => { const h = handled.get(ignoreKey(g)); if (h) pre[g.id] = h; });
      setMarks(pre); setShowIgnored(false);
      setRun({ host: hostApp, items, unique: uniq.length, cached, failed, batches, ms: performance.now() - t0,
        finished: new Date(), project, cancelled: token.current.cancelled, coverage, warnings, ignoreScope });
      setGroups(gs);
      setPhase("done");
      if (failed) setErr(plural(failed, "text") + " couldn’t be checked (" + (lastError.message || "no connection") + "). Check again to retry them.");
    } catch (e) { fail(e); }
  }

  // One jump at a time, latest wins, so fast clicking or auto go to never stacks calls in the app.
  const jumping = useRef({ busy: false, next: null });
  // explicit: a Go to click (may open another sequence). Automatic jumps stay in the open one.
  const [where, setWhere] = useState("");
  const jump = (it, explicit = false) => {
    setErr(""); setWhere("");
    const q = jumping.current;
    q.next = { it, explicit };
    if (q.busy) return;
    const runNext = () => {
      const nx = q.next; q.next = null;
      if (!nx) { q.busy = false; return; }
      const a = nx.it;
      q.busy = true;
      // Send only what a jump needs (never the on-screen text), and never let one slow call block the rest.
      const arg = isAE ? { containerId: a.containerId, layerIndex: a.layerIndex, keyIndex: a.keyIndex, projectPath: a.projectPath }
        : { containerId: a.containerId, startTicks: a.startTicks };
      logJump("jump " + JSON.stringify(arg));
      const go = isAE ? host("aeJump", arg) : premiereGoTo(host, arg.containerId, arg.startTicks, nx.explicit);
      Promise.race([go, new Promise((res) => setTimeout(res, 8000))])
        .then((r) => {
          logJump("ok");
          if (r && r.other) setWhere("This one is in \u201C" + r.other + "\u201D. Press Go to to open that sequence.");
          if (r && r.waiting) setWhere("Opened the sequence. Press Go to again to move the playhead.");
        }, (e) => { logJump("ok"); fail(e); }).then(() => setTimeout(runNext, 60));
    };
    runNext();
  };

  async function fix(g, replacement) {
    setErr("");
    let ok = 0, last = "";
    for (const it of g.places) {
      try {
        await host("aeFix", { projectPath: it.projectPath, containerId: it.containerId, layerIndex: it.layerIndex, keyIndex: it.keyIndex,
          offset: g.offset, length: g.length, expected: g.text.substr(g.offset, g.length), replacement });
        ok++;
      } catch (e) { last = e.message; }
    }
    if (ok) { mark([g.id], "fixed"); setNote("Changed in " + plural(ok, "layer") + ". Cmd/Ctrl+Z in After Effects undoes it."); }
    return ok > 0;
    if (last) setErr(last);
  }
  function addWord(g) {
    try {
      addToDict(g.bad);
      const w = g.bad.toLowerCase();
      mark(groups.filter((x) => x.bad.toLowerCase() === w && x.ruleId !== "HARSH_INVISIBLE").map((x) => x.id), "ignored");
      setNote("“" + g.bad + "” won’t be flagged again.");
    } catch (e) { fail(e); }
  }
  function exportReport() {
    try {
      const file = writeReport(run, groups.filter((g) => marks[g.id] !== "ignored"));
      host("openPath", { path: file });
      setNote("Report saved to " + file);
    } catch (e) { fail(e); }
  }
  function util(what) {
    setErr(""); setNote("");
    getPaths().then(() => {
      const p = getPathsSync();
      if (what === "dict") return host("openPath", { path: p.dict });
      if (what === "reports") return host("openPath", { path: reportDir() });
      if (what === "cache") { resetCache(); setNote("Cleared. Every text will be checked again next time."); }
      if (what === "loc") {
        const dir = pickFolder("Where should reports be saved?");
        if (dir) { fs.writeFileSync(p.reportPref, dir, "utf8"); setNote("Reports will be saved to " + dir); }
      }
      if (what === "test") {
        setNote("Testing the connection…");
        return checkTexts(["helo wrld"], settings, () => {}, { cancelled: false }).then((o) => {
          const m = o.results["helo wrld"];
          if (!m) { setNote(""); setErr("Couldn’t reach the spelling server: " + (lastError.message || "no reply")); }
          else setNote("Connected. The test sentence had " + plural(m.length, "mistake") + ", as expected.");
        });
      }
    }).catch(fail);
  }

  // ---------------------------------------------------------------- derived
  const busy = phase === "reading" || phase === "checking";
  const live = groups.filter((g) => marks[g.id] !== "ignored");
  const ignoredGroups = groups.filter((g) => marks[g.id] === "ignored");
  const open_ = live.filter((g) => !isDone(marks[g.id]));
  const counts = {}; CATS.forEach((c) => { counts[c.id] = 0; });
  // Warnings from the last check: plain notes, and After Effects clips that need a look by hand.
  const manual = { notes: [], groups: [], count: 0 };
  ((run && run.warnings) || []).forEach((w) => {
    if (typeof w === "string") { manual.notes.push(w); manual.count++; }
    else { manual.groups.push(w); manual.count += w.clips.length; }
  });
  open_.forEach((g) => { counts[g.cat] += g.places.length; });
  const total = CATS.reduce((a, c) => a + counts[c.id], 0);
  const serious = counts.typo + counts.garbage;
  const ql = q.trim().toLowerCase();
  const shown = live.filter((g) => cats.indexOf(g.cat) !== -1 && (!ql ||
    (g.text + " " + g.places.map((p) => p.container + " " + p.layer).join(" ")).toLowerCase().indexOf(ql) !== -1));
  const queue = shown.filter((g) => !isDone(marks[g.id]));
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : null;
  const cur = review !== null ? queue[Math.min(review, queue.length - 1)] : null;
  // Go to each mistake as it comes up in review.
  useEffect(() => { if (cur && autoGo && cur.places[0].containerId) jump(cur.places[0]); }, [cur && cur.id, autoGo]);

  useEffect(() => { report(busy ? { running: true } : run ? { count: total, at: run.finished.getTime() } : null); }, [busy, run, total]);
  useEffect(() => { if (review !== null && !queue.length) setReview(null); }, [queue.length, review]);

  // Review shortcuts: Right/Left move, Enter applies the first suggestion (After Effects), G goes to it, I ignores.
  useEffect(() => {
    if (!cur) return;
    const onKey = (e) => {
      if (/input|select|textarea/i.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); setReview((r) => Math.min(r + 1, queue.length - 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setReview((r) => Math.max(r - 1, 0)); }
      else if (e.key === "Escape") setReview(null);
      else if (e.key === "Enter" && isAE && cur.suggestions.length) { e.preventDefault(); fix(cur, cur.suggestions[0]); }
      else if (e.key.toLowerCase() === "g" && cur.places[0].containerId) jump(cur.places[0], true);
      else if (e.key.toLowerCase() === "i") mark([cur.id], "ignored");
      else if (e.key.toLowerCase() === "c") mark([cur.id], "corrected");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const scopeHelp = isAE
    ? { all: "Every text layer in every comp of the open project.", selected: "Only the comps selected in the Project panel.", folders: "Only comps inside the folders you tick.", batch: "Several .aep files, opened one after another." }[scope]
    : scope === "active" ? "The sequence open in the timeline, including sequences nested in it." : "Every sequence in the project.";

  function Actions({ g, big }) {
    const fixed = isDone(marks[g.id]);
    const more = g.places.length - 1;
    if (fixed) return <div className="acts"><span className="fixed">{marks[g.id] === "fixed" ? "Changed" : "Corrected"}</span>{marks[g.id] === "corrected" && <button className="ghost tight" onClick={() => mark([g.id], null)}>Undo</button>}</div>;
    return (
      <div className={"acts" + (big ? " big" : "")}>
        {g.suggestions.map((s, i) => {
          const label = s === "" ? "Delete it" : s;
          return isAE
            ? <button key={i} className="sugg" onClick={() => fix(g, s)} title={more ? "Change it in all " + g.places.length + " layers" : "Change it in the layer"}>{label}{more ? <span className="times"> ×{g.places.length}</span> : null}</button>
            : <span key={i} className="sugg-text">Use <b>{label}</b></span>;
        })}
        {(g.cat === "unknown" || g.cat === "typo") && <button className="ghost tight" onClick={() => addWord(g)}>Add to dictionary</button>}
        <button className="ghost tight" onClick={() => mark([g.id], "corrected")} title="You fixed it yourself">Corrected</button>
        <button className="ghost tight" onClick={() => mark([g.id], "ignored")}>Ignore</button>
      </div>
    );
  }

  // ---------------------------------------------------------------- review
  if (cur) {
    const idx = queue.indexOf(cur);
    const cat = CAT_BY_ID[cur.cat];
    return (
      <div className="tool review" style={{ "--c": cat.color }}>
        <div className="review-head">
          <span className="review-count num"><b>{idx + 1}</b> of {queue.length}</span>
          <span className="review-cat"><i />{cat.label}</span>
          <button className="icon-btn" onClick={() => setReview(null)} aria-label="Close review"><Close /></button>
        </div>
        <div className="review-bar" aria-hidden="true"><div style={{ transform: `scaleX(${(idx + 1) / queue.length})` }} /></div>
        <Where p={cur.places[0]} onGo={() => jump(cur.places[0], true)} />
        {cur.places.length > 1 && <p className="also">Same text in {plural(cur.places.length - 1, "other place")}{isAE ? "; a change applies to all of them." : "."}</p>}
        <Proofed g={cur} big />
        {cur.cat !== "typo" && cur.cat !== "unknown" && cur.message && <p className="why">{cur.message}</p>}
        <Actions g={cur} big />
        <div className="review-nav">
          <button className="ghost" disabled={idx === 0} onClick={() => setReview(idx - 1)}><Back size={14} /> Previous</button>
          <button className="ghost" disabled={idx >= queue.length - 1} onClick={() => setReview(idx + 1)}>Next <Forward size={14} /></button>
        </div>
        <label className="check-inline auto-go"><input type="checkbox" checked={autoGo} onChange={() => setAutoGo(!autoGo)} /> Go to each one automatically</label>
        <p className="keys">Keys: <kbd>&larr;</kbd> <kbd>&rarr;</kbd> move{isAE ? <>, <kbd>Enter</kbd> use the first suggestion</> : null}, <kbd>G</kbd> go to, <kbd>C</kbd> corrected, <kbd>I</kbd> ignore, <kbd>Esc</kbd> close.</p>
        {jumpNote && <p className="msg warn">{jumpNote} <button className="link-btn" onClick={() => setJumpNote("")}>OK</button></p>}
        {where && <p className="msg">{where}</p>}
        {err && <p className="msg bad">{err}</p>}
        {note && <p className="msg good">{note}</p>}
      </div>
    );
  }

  // ------------------------------------------------------------------ main
  return (
    <div className="tool">
      <div className="controls">
        <div className="seg" role="radiogroup" aria-label="What to check">
          {SCOPES.map(([id, label]) => (
            <button key={id} role="radio" aria-checked={scope === id} className={scope === id ? "on" : ""} disabled={busy} onClick={() => setScope(id)}>{label}</button>
          ))}
        </div>
        <p className="help">{scopeHelp}</p>

        {isAE && scope === "folders" && (
          <fieldset className="pane">
            <legend className="sr">Folders to check</legend>
            {!folders ? <p className="help">Loading folders…</p> : (
              <>
                <div className="checks">
                  {folders.map((f, i) => (
                    <label key={f.id}>
                      <input type="checkbox" checked={f.checked} onChange={() => setFolders(folders.map((x, j) => (j === i ? { ...x, checked: !x.checked } : x)))} />
                      <span className="grow trunc">{f.name}</span>
                      <span className="dim num">{f.comps}</span>
                    </label>
                  ))}
                </div>
                <div className="inline">
                  <button className="ghost tight" onClick={() => setFolders(folders.map((x) => ({ ...x, checked: true })))}>All</button>
                  <button className="ghost tight" onClick={() => setFolders(folders.map((x) => ({ ...x, checked: false })))}>None</button>
                  <button className="ghost tight" onClick={loadFolders}>Reload</button>
                </div>
                <p className="help">Imported, old, ref and backup folders start unticked.</p>
              </>
            )}
          </fieldset>
        )}

        {isAE && scope === "batch" && (
          <div className="pane">
            {files.length ? (
              <ul className="files">
                {files.map((p) => (
                  <li key={p} title={p}>
                    <span className="grow trunc">{pathMod.basename(p)}</span>
                    <button className="icon-btn" disabled={busy} onClick={() => setFiles(files.filter((x) => x !== p))} aria-label={"Remove " + pathMod.basename(p)}><Close size={13} /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="help">No projects added yet.</p>}
            <div className="inline">
              <button className="ghost tight" disabled={busy} onClick={() => addFiles(pickFiles("Choose .aep files", "aep"))}>Add projects…</button>
              <button className="ghost tight" disabled={busy} onClick={addFolderOfProjects}>Add a folder…</button>
              <label className="check-inline"><input type="checkbox" checked={settings.recursive} onChange={() => set("recursive", !settings.recursive)} /> Subfolders</label>
            </div>
          </div>
        )}

        {!isAE && (
          <div className="captions-row">
            <span className="grow trunc">{capFiles.length ? "Captions: " + capFiles.map((p) => pathMod.basename(p)).join(", ") : "Captions: files in the project are found automatically"}</span>
            {capFiles.length > 0 && <button className="icon-btn" disabled={busy} onClick={() => setCapFiles([])} aria-label="Remove added caption files"><Close size={13} /></button>}
            <button className="ghost tight" disabled={busy} title="For captions made in Premiere: File > Export > Captions as .srt, then add the file here." onClick={() => {
              const f = pickFiles("Choose caption files (.srt or .vtt)", "");
              const ok = f.filter((x) => /\.(srt|vtt)$/i.test(x));
              if (f.length && !ok.length) setErr("Choose an .srt or .vtt file.");
              setCapFiles(capFiles.concat(ok.filter((x) => capFiles.indexOf(x) === -1)));
            }}>Add .srt</button>
          </div>
        )}

        {busy ? (
          <div className="running" aria-live="polite">
            <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === null ? undefined : pct}>
              <div className={pct === null ? "fill indeterminate" : "fill"} style={pct === null ? undefined : { transform: `scaleX(${Math.max(0.02, pct / 100)})` }} />
            </div>
            <div className="running-row">
              <span className="status">{prog.label}{prog.total ? " " + prog.done + " of " + prog.total : ""}</span>
              <button className="ghost tight" onClick={() => { token.current.cancelled = true; setProg((p) => ({ ...p, label: "Stopping…" })); }}>Stop</button>
            </div>
          </div>
        ) : (
          <button className="primary" onClick={start}>{run ? "Check again" : "Check text"}</button>
        )}
      </div>

      <div aria-live="polite">
        {jumpNote && <p className="msg warn">{jumpNote} <button className="link-btn" onClick={() => setJumpNote("")}>OK</button></p>}
        {where && <p className="msg">{where}</p>}
        {err && <p className="msg bad">{err}</p>}
        {note && <p className="msg good">{note}</p>}
      </div>

      {run && (
        <section className="summary" aria-label="Result">
          <div className="score">
            <span className={"score-num num" + (serious ? " warn" : total ? "" : " ok")}>{serious || total || "\u2713"}</span>
            <div className="score-text">
              <b>{serious ? (serious === 1 ? "mistake to fix" : "mistakes to fix") : total ? (total === 1 ? "thing to look at" : "things to look at") : "No mistakes found"}</b>
              <span>{serious && total > serious ? (total - serious) + " more worth a look. " : ""}{plural(run.items.length, isAE ? "text layer" : "piece of text", isAE ? "text layers" : "pieces of text")} checked in {fmtSecs(run.ms)}.</span>
            </div>
          </div>
          {total > 0 && (
            <div className="spread" aria-hidden="true">
              {CATS.filter((c) => counts[c.id]).map((c) => <i key={c.id} style={{ flexGrow: counts[c.id], background: c.color }} />)}
            </div>
          )}
          {run.coverage && <p className="help">{coverageText(run.coverage)}</p>}
          {run.cancelled && <p className="help">Stopped early, so some text wasn’t checked.</p>}
          {manual.count > 0 && (
            <button className="manual-flag" onClick={() => { setShowManual(true); setTimeout(() => manualRef.current && manualRef.current.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }}>
              <i aria-hidden="true" />{manual.count === 1 ? "1 thing to check by hand" : manual.count + " things to check by hand"}
            </button>
          )}
          {total > 0 && (
            <div className="summary-acts">
              <button className="primary" disabled={!queue.length} onClick={() => setReview(0)}>Review one by one</button>
              <button className="ghost" onClick={exportReport}>Export report</button>
            </div>
          )}
          {total > 0 && (
            <label className="check-inline auto-go"><input type="checkbox" checked={autoGo} onChange={() => setAutoGo(!autoGo)} /> Go to each mistake when I open it</label>
          )}
        </section>
      )}

      {run && live.length > 0 && (
        <section className="results" aria-label="Mistakes">
          <div className="chips" role="group" aria-label="Show">
            {CATS.map((c) => {
              const on = cats.indexOf(c.id) !== -1;
              return (
                <button key={c.id} className={"chip" + (on ? " on" : "")} aria-pressed={on} title={c.hint} style={{ "--c": c.color }}
                  onClick={() => setCats(on ? cats.filter((x) => x !== c.id) : cats.concat([c.id]))}>
                  <i aria-hidden="true" />{c.label}<span className="num">{counts[c.id]}</span>
                </button>
              );
            })}
          </div>
          {live.length > 6 && (
            <input className="search" type="search" name="filter" autoComplete="off" spellCheck={false} aria-label="Filter results"
              placeholder={"Filter by word, " + (isAE ? "comp" : "sequence") + " or layer…"} value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          {!shown.length && <p className="help">Nothing in the categories you picked. Turn on more above.</p>}
          <ol className="rows">
            {shown.slice(0, limit).map((g) => {
              const first = g.places[0], fixed = isDone(marks[g.id]), more = g.places.length - 1, isOpen = !!open[g.id];
              const cat = CAT_BY_ID[g.cat];
              return (
                <li key={g.id} className={"row" + (fixed ? " done" : "") + (isOpen ? " open" : "")} style={{ "--c": cat.color }}>
                  <button className="row-head" aria-expanded={isOpen} onClick={() => { setOpen({ ...open, [g.id]: !isOpen }); if (!isOpen && autoGo && first.containerId) jump(first); }}>
                    <i className="dot" aria-hidden="true" />
                    <span className="row-main">
                      <span className="row-word">
                        <span className="bad">{g.cat === "garbage" ? cat.label.replace(/s$/, "") : g.bad}</span>
                        {g.suggestions.length > 0 && g.suggestions[0] !== "" && g.cat !== "garbage" && <span className="to"> → {g.suggestions[0]}</span>}
                        {fixed && <span className="fixed"> {marks[g.id] === "fixed" ? "Changed" : "Corrected"}</span>}
                      </span>
                      <span className="row-where">
                        {first.kind && <span className={"tag " + first.kind}>{KIND[first.kind]}</span>}
                        <span className="trunc">{first.container}{first.tc ? " " + first.tc : ""}{more ? " +" + more : ""}</span>
                      </span>
                    </span>
                    <Forward size={14} />
                  </button>
                  {isOpen && (
                    <div className="row-body">
                      <Proofed g={g} />
                      {g.cat !== "typo" && g.cat !== "unknown" && g.message && <p className="why">{g.message}</p>}
                      {g.places.map((p, i) => <Where key={i} p={p} onGo={() => jump(p, true)} />)}
                      <Actions g={g} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {shown.length > limit && <button className="ghost wide" onClick={() => setLimit(limit + 200)}>Show {Math.min(200, shown.length - limit)} more</button>}
          {ignoredGroups.length > 0 && (
            <div className="ignored">
              <button className="disclose" aria-expanded={showIgnored} onClick={() => setShowIgnored(!showIgnored)}>
                {showIgnored ? "Hide ignored" : plural(ignoredGroups.length, "ignored mistake") + ", hidden. Show"}
              </button>
              {showIgnored && (
                <ul className="ignored-list">
                  {ignoredGroups.map((g) => (
                    <li key={g.id}>
                      <span className="trunc grow"><b>{g.bad || CAT_BY_ID[g.cat].label}</b> <span className="dim">in {g.places[0].container}</span></span>
                      <button className="ghost tight" onClick={() => mark([g.id], null)}>Show again</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {run && manual.count > 0 && (
        <section className="manual" ref={manualRef} aria-label="Check by hand">
          <button className="manual-head" aria-expanded={showManual} onClick={() => setShowManual(!showManual)}>
            <span className="grow">Check by hand <span className="num dim">{manual.count}</span></span>
            <Forward size={14} />
          </button>
          {showManual && (
            <div className="manual-body">
              {manual.notes.map((w, i) => <p key={"n" + i} className="manual-note">{w}</p>)}
              {manual.groups.map((w, i) => (
                <div key={"g" + i}>
                  <p className="manual-note">{w.text}</p>
                  <ul className="lost-clips">
                    {w.clips.map((c) => (
                      <li key={c.key}>
                        <span className="lost-name">{c.name}</span>
                        <span className="lost-where"><span>{c.container}</span><span>{c.trackName}</span><span className="num">{c.tc}</span></span>
                        {c.bin && <span className="lost-bin">In the {c.bin} bin</span>}
                        <span className="lost-why">{c.why}</span>
                        <span className="lost-acts">
                          <button className="ghost tight" onClick={() => jump(c, true)}><Target /> Go to</button>
                          {c.nodeId && <button className="ghost tight" onClick={() => { setErr(""); host("prReveal", { nodeId: c.nodeId, binPath: c.bin }).catch(fail); }}>Show in project</button>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="foot-tools">
        <button className="ghost tight" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}><Gear /> Settings</button>
        <button className="ghost tight" onClick={() => util("dict")}>Dictionary</button>
        <button className="ghost tight" onClick={() => util("reports")}>Reports</button>
      </div>

      {showSettings && (
        <div className="pane settings">
          <label className="field"><span>Language</span>
            <select name="lang" value={settings.lang} onChange={(e) => set("lang", e.target.value)}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field"><span>Spelling server</span>
            <input name="server" type="url" autoComplete="off" spellCheck={false} value={settings.server} placeholder="Free LanguageTool (leave blank)…" onChange={(e) => set("server", e.target.value.trim())} />
          </label>
          <p className="help">The free server checks about 65,000 characters a minute and waits on its own if a job goes over. For no limit, run LanguageTool on your computer and enter its address, like http://localhost:8081.</p>
          <label className="field"><span>Premium username</span>
            <input name="lt-user" autoComplete="off" spellCheck={false} value={settings.username} placeholder="Optional…" onChange={(e) => set("username", e.target.value.trim())} />
          </label>
          <label className="field"><span>Premium API key</span>
            <input name="lt-key" type="password" autoComplete="off" value={settings.apiKey} placeholder="Optional…" onChange={(e) => set("apiKey", e.target.value.trim())} />
          </label>
          {!isAE && (
            <label className="check-inline"><input type="checkbox" checked={!!settings.deep} onChange={() => set("deep", !settings.deep)} /> Deep scan: look in every effect, not just graphics (slower)</label>
          )}
          <div className="inline">
            <button className="ghost tight" onClick={() => util("test")}>Test connection</button>
            <button className="ghost tight" onClick={() => util("loc")}>Change report folder…</button>
            <button className="ghost tight" onClick={() => util("cache")}>Forget checked text</button>
          </div>
        </div>
      )}
    </div>
  );
}
