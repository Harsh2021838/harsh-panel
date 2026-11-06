// Audio QC (Premiere): listens to the open sequence before export and lists what would spoil the
// sound of the final video: distortion, music or SFX covering the voice, SFX at uneven levels,
// and clicks at hard cuts. Host side: jsx/audio-qc.jsx. Listening: listen.js. Checks: analyze.js.
import React, { useEffect, useRef, useState } from "react";
import { makeHost, nodeRequire, appSession } from "../../host.js";
import { toolDir } from "../../library.js";
import { Check, Ban } from "../../icons.jsx";
import { timecode } from "../text-qc/premiere-sources.js";
import { listen } from "./listen.js";
import { analyze, detectRoles, wants, ROLE_NAMES } from "./analyze.js";

const call = makeHost("audio-qc.jsx", "HarshAudioQC");
const fs = nodeRequire("fs"), pathMod = nodeRequire("path");

const CHECKS = [
  ["distortion", "Distortion"],
  ["cover", "Music/SFX over voice"],
  ["sfx", "SFX levels"],
  ["click", "Clicks at cuts"],
];
const KIND_TAG = { clip: "Distortion", mix: "Distortion", music: "Over voice", cover: "Over voice", sfx: "SFX level", click: "Click" };
const KEY = "harsh.audioqc.";
const REMEMBER_HOURS = 5;
const lsGet = (k, d) => { try { const v = localStorage.getItem(KEY + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} };
function remembered(scope) {
  const raw = lsGet(scope, {}), out = {};
  if (raw && !Array.isArray(raw)) for (const k in raw) if (raw[k] && Date.now() - raw[k].t < REMEMBER_HOURS * 3600e3) out[k] = raw[k];
  return out;
}
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
const baseName = (p) => String(p).split(/[\\/]/).pop();

// Files already listened to (same file, same date, same parts): a second check is instant.
const heard = new Map();

export default function AudioQC({ report = () => {} }) {
  const [checks, setChecks] = useState(() => ({ distortion: true, cover: true, sfx: true, click: true, ...lsGet("checks", {}) }));
  const [musicGap, setMusicGap] = useState(() => lsGet("musicGap", 10));
  const [sfxSpread, setSfxSpread] = useState(() => lsGet("sfxSpread", 6));
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState("");
  const [run, setRun] = useState(null);
  const [state, setState] = useState({});
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [editSetup, setEditSetup] = useState(false);
  const [editTracks, setEditTracks] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [autoGo, setAutoGo] = useState(() => lsGet("autoGo", true));
  const listRef = useRef(null);
  useEffect(() => { lsSet("checks", checks); }, [checks]);
  useEffect(() => { lsSet("musicGap", musicGap); }, [musicGap]);
  useEffect(() => { lsSet("sfxSpread", sfxSpread); }, [sfxSpread]);
  useEffect(() => { lsSet("autoGo", autoGo); }, [autoGo]);

  const scope = run ? "ignored:" + run.dump.project + "@" + run.session : "";
  const issues = run ? run.result.issues : [];
  const todo = issues.filter((g) => !state[g.key]);
  const ignored = issues.filter((g) => state[g.key] === "ignored");
  const handled = issues.filter((g) => state[g.key] === "corrected");
  const current = todo.find((g) => g.key === sel) || null;
  useEffect(() => { report(phase === "checking" ? { running: true } : run ? { count: todo.length, at: run.at } : null); }, [phase, run, todo.length]);

  async function check(rolesOverride) {
    setErr(""); setNote(""); setPhase("checking"); setEditSetup(false); setProgress("Reading the sequence…");
    const t0 = performance.now();
    try {
      const logPath = pathMod.join(await toolDir("Audio QC"), "last-check.log");
      try { fs.writeFileSync(logPath, "check " + new Date().toISOString() + "\n"); } catch (e) {}
      const dump = await call("prDump", { logPath });
      const saved = lsGet("roles:" + dump.id, {});
      const roles = { ...detectRoles(dump), ...saved, ...(rolesOverride || {}) };
      const w = wants(dump, roles), files = Object.keys(w), envs = {};
      for (let i = 0; i < files.length; i++) {
        const p = files[i];
        setProgress("Listening " + (i + 1) + " of " + files.length + ": " + baseName(p));
        let stamp = "";
        try { stamp = String(fs.statSync(p).mtimeMs); } catch (e) { envs[p] = { error: "missing" }; continue; }
        const key = p + "|" + stamp + "|" + JSON.stringify(w[p].ranges.map((r) => r.map((x) => Math.round(x * 10))).sort());
        if (heard.has(key)) { envs[p] = heard.get(key); continue; }
        try { envs[p] = await listen(fs, p, w[p].ranges, w[p].edges); heard.set(key, envs[p]); }
        catch (e) { envs[p] = { error: /ENOENT/.test(e.message) ? "file not found" : e.message }; }
      }
      setProgress("Checking…");
      const result = analyze(dump, envs, roles, { checks, musicGap, sfxSpread });
      result.issues.forEach((g) => { g.tc = timecode(g.t, dump.fps); });
      const session = await appSession();
      const kept = remembered("ignored:" + dump.project + "@" + session), st = {};
      result.issues.forEach((g) => { if (kept[g.key]) st[g.key] = kept[g.key].s; });
      setState(st);
      setRun({ dump, roles, result, envs, session, at: Date.now(), ms: performance.now() - t0 });
      setSel((result.issues.find((g) => !st[g.key]) || {}).key || null);
      setPhase("done");
    } catch (e) { setErr(e.message); setPhase(run ? "done" : "idle"); }
    setProgress("");
  }

  function setRole(track, role) {
    const roles = { ...run.roles, [track]: role };
    const saved = lsGet("roles:" + run.dump.id, {}); saved[track] = role; lsSet("roles:" + run.dump.id, saved);
    setRun({ ...run, roles });
  }

  function setMark(g, v) {
    setState((s) => { const n = { ...s }; if (v) n[g.key] = v; else delete n[g.key]; return n; });
    const map = remembered(scope);
    if (v) map[g.key] = { s: v, t: Date.now() }; else delete map[g.key];
    lsSet(scope, map);
  }
  const busyGo = useRef(false);
  function go(g) {
    if (busyGo.current) return;
    busyGo.current = true;
    call("prGo", { id: run.dump.id, t: g.t, track: g.track, i: g.i, start: g.start })
      .catch((e) => setErr(e.message)).then(() => { busyGo.current = false; });
  }
  function pick(g, jump) { setSel(g ? g.key : null); if (g && jump) go(g); }
  function done(g, v) {
    setMark(g, v);
    const idx = todo.indexOf(g), rest = todo.filter((x) => x.key !== g.key);
    pick(rest[Math.min(idx, rest.length - 1)] || null, autoGo);
  }

  useEffect(() => {
    if (!run) return undefined;
    const onKey = (e) => {
      if (/input|select|textarea/i.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!listRef.current || !listRef.current.offsetParent) return;
      const i = todo.indexOf(current), k = e.key.toLowerCase();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = todo[Math.max(0, Math.min(todo.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (n) pick(n, autoGo);
      } else if (!current) return;
      else if (e.key === "Enter") go(current);
      else if (k === "c") done(current, "corrected");
      else if (k === "i") done(current, "ignored");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector(".gap-row.sel");
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const busy = phase === "checking";
  const tracks = run ? run.dump.tracks.filter((t) => t.clips.length || run.roles[t.index]) : [];
  const roleLine = run ? ["voice", "sfx", "music"].map((r) => {
    const ts = tracks.filter((t) => run.roles[t.index] === r).map((t) => "A" + (t.index + 1));
    return ts.length ? ROLE_NAMES[r] + " " + ts.join(", ") : null;
  }).filter(Boolean).join(" · ") : "";
  const r = run && run.result;

  return (
    <div className="tool gap-qc audio-qc">
      {run && !editSetup ? (
        <div className="setup-line">
          <span className="grow trunc">{run.dump.name}{run.dump.inS > 0 || run.dump.outS < run.dump.end ? " (In to Out)" : ""}, {plural(CHECKS.filter(([id]) => checks[id]).length, "check")}</span>
          <button className="ghost tight" disabled={busy} onClick={() => setEditSetup(true)}>Change</button>
          <button className="primary tight" disabled={busy} onClick={() => check()}>{busy ? "Checking…" : "Check again"}</button>
        </div>
      ) : (
        <div className="controls">
          <p className="help">Listens to the open sequence (between In and Out if you set them) and finds what would spoil the sound of the final video.</p>
          <div className="chips look-for" role="group" aria-label="Look for">
            {CHECKS.map(([id, label]) => (
              <button key={id} className={"chip" + (checks[id] ? " on" : "")} aria-pressed={!!checks[id]} disabled={busy}
                onClick={() => setChecks({ ...checks, [id]: !checks[id] })}>{label}</button>
            ))}
          </div>
          {checks.cover && (
            <div className="gap-size">
              <span className="gap-size-label">Music under the voice by</span>
              <div className="seg small" role="radiogroup" aria-label="How far under the voice music must sit">
                {[6, 10, 15].map((n) => <button key={n} role="radio" aria-checked={musicGap === n} className={musicGap === n ? "on" : ""} disabled={busy} onClick={() => setMusicGap(n)}>{n}</button>)}
              </div>
              <span className="gap-size-label">dB or more</span>
            </div>
          )}
          {checks.sfx && (
            <div className="gap-size">
              <span className="gap-size-label">SFX may differ by</span>
              <div className="seg small" role="radiogroup" aria-label="How much SFX levels may differ">
                {[4, 6, 8].map((n) => <button key={n} role="radio" aria-checked={sfxSpread === n} className={sfxSpread === n ? "on" : ""} disabled={busy} onClick={() => setSfxSpread(n)}>{n}</button>)}
              </div>
              <span className="gap-size-label">dB</span>
            </div>
          )}
          <button className="primary" disabled={busy || !CHECKS.some(([id]) => checks[id])} onClick={() => check()}>{busy ? "Checking…" : run ? "Check again" : "Check audio"}</button>
        </div>
      )}

      <div aria-live="polite">
        {busy && progress && <p className="help trunc">{progress}</p>}
        {err && <p className="msg bad">{err}</p>}
        {note && <p className="msg good">{note}</p>}
      </div>

      {run && (
        <div className="setup-line roles-line">
          <span className="grow trunc" title="What each audio track holds, guessed from its clips">{roleLine || "No audio clips"}</span>
          <button className="ghost tight" disabled={busy} onClick={() => setEditTracks(!editTracks)}>{editTracks ? "Done" : "Tracks"}</button>
        </div>
      )}
      {run && editTracks && (
        <div className="track-roles">
          {tracks.map((t) => (
            <div key={t.index} className="gap-size">
              <span className="gap-size-label track-name">A{t.index + 1}{t.name && !/^audio \d+$/i.test(t.name) ? " " + t.name : ""}</span>
              <div className="seg small" role="radiogroup" aria-label={"What A" + (t.index + 1) + " holds"}>
                {["voice", "sfx", "music", "skip"].map((role) => (
                  <button key={role} role="radio" aria-checked={(run.roles[t.index] || "skip") === role} className={(run.roles[t.index] || "skip") === role ? "on" : ""}
                    disabled={busy} onClick={() => setRole(t.index, role)}>{ROLE_NAMES[role]}</button>
                ))}
              </div>
            </div>
          ))}
          <button className="primary" disabled={busy} onClick={() => { setEditTracks(false); check(run.roles); }}>Check again with these</button>
        </div>
      )}

      {run && (
        <section className="summary" aria-label="Result">
          <div className="score">
            <span className={"score-num num" + (todo.length || r.unread.length ? " warn" : " ok")}>{todo.length || "✓"}</span>
            <div className="score-text">
              <b>{todo.length ? (todo.length === 1 ? "thing to fix" : "things to fix") : r.unread.length ? "Nothing found in what could be heard" : "Sounds clean"}</b>
              <span>{plural(r.clips, "audio clip")} listened to in {(run.ms / 1000).toFixed(1)}s.</span>
            </div>
          </div>
          {todo.length > 0 && <label className="check-inline auto-go"><input type="checkbox" checked={autoGo} onChange={() => setAutoGo(!autoGo)} /> Go to the next one automatically</label>}
        </section>
      )}
      {run && checks.cover && !r.hasVoice && <p className="msg warn">No voice track found, so music and SFX over the voice weren't checked. Press Tracks and mark the voice track.</p>}
      {run && r.unread.length > 0 && (
        <p className="msg warn">Couldn't listen to {plural(r.unread.length, "file")}: {r.unread.slice(0, 3).map((p) => baseName(p) + (run.envs[p] && run.envs[p].error ? " (" + run.envs[p].error + ")" : "")).join(", ")}{r.unread.length > 3 ? "…" : ""}. Their clips weren't checked.</p>
      )}
      {run && (run.dump.nested > 0) && <p className="help">{plural(run.dump.nested, "nested sequence")} on audio tracks {run.dump.nested === 1 ? "isn't" : "aren't"} listened to. Check {run.dump.nested === 1 ? "it" : "them"} on their own.</p>}

      {run && todo.length > 0 && (
        <p className="keys gap-keys"><span><Check size={13} /> corrected <kbd>C</kbd></span><span><Ban size={13} /> ignore <kbd>I</kbd></span><span><kbd>&uarr;</kbd><kbd>&darr;</kbd> move</span><span>go to <kbd>Enter</kbd></span></p>
      )}
      {run && todo.length > 0 && (
        <ol className="rows gap-list" ref={listRef}>
          {todo.slice(0, 200).map((g) => {
            const on = current === g;
            return (
              <li key={g.key} className={"gap-row" + (on ? " sel" : "")}>
                <button className="gap-pick" aria-current={on ? "true" : undefined} onClick={() => pick(g, true)} title="Go to it">
                  <span className={"aq-kind " + g.kind} aria-hidden="true">{g.kind === "click" ? "⌇" : g.kind === "sfx" ? "⇅" : g.kind === "clip" || g.kind === "mix" ? "!" : "♪"}</span>
                  <span className="row-main">
                    <span className="row-word">{g.what}</span>
                    <span className="row-where">
                      <span className="num">{g.tc}</span>
                      <span>{g.trackName}</span>
                      <span className="dim">{KIND_TAG[g.kind]}</span>
                    </span>
                    {on && <span className="gap-detail">{g.detail}</span>}
                  </span>
                </button>
                <span className="gap-acts">
                  <button className="act good" onClick={() => done(g, "corrected")} title="Corrected: I fixed it (C)" aria-label="Corrected"><Check size={16} /></button>
                  <button className="act" onClick={() => done(g, "ignored")} title="Ignore (I)" aria-label="Ignore"><Ban /></button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {handled.length > 0 && (
        <div className="ignored">
          <button className="disclose" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>{showDone ? "Hide done" : plural(handled.length, "done item") + ". Show"}</button>
          {showDone && (
            <ul className="ignored-list">
              {handled.map((g) => <li key={g.key}><span className="trunc grow"><b>{g.what}</b> <span className="dim">{g.trackName} {g.tc}</span></span><button className="ghost tight" onClick={() => setMark(g, null)}>Undo</button></li>)}
            </ul>
          )}
        </div>
      )}
      {ignored.length > 0 && (
        <div className="ignored">
          <button className="disclose" aria-expanded={showIgnored} onClick={() => setShowIgnored(!showIgnored)}>{showIgnored ? "Hide ignored" : plural(ignored.length, "ignored item") + ", hidden. Show"}</button>
          {showIgnored && (
            <ul className="ignored-list">
              {ignored.map((g) => <li key={g.key}><span className="trunc grow"><b>{g.what}</b> <span className="dim">{g.trackName} {g.tc}</span></span><button className="ghost tight" onClick={() => setMark(g, null)}>Show again</button></li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
