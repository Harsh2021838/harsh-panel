import React, { useEffect, useState } from "react";
import { hostApp, pickFiles } from "../host.js";
import { Plus, Folder, Download, Film, Wave, Shapes, Image, Close } from "../icons.jsx";
import { listAssets, addAssets, removeAsset, assetsDir, previewable, fileUrl, lib, path } from "../library.js";

const isAE = hostApp === "AEFT";
const TYPES = [["all", "All"], ["image", "Images"], ["video", "Video"], ["audio", "Audio"], ["template", "Templates"]];
const ICON = { video: Film, audio: Wave, template: Shapes, image: Image, other: Shapes };
const ext = (n) => (n.split(".").pop() || "").toUpperCase();

function Thumb({ a }) {
  const [broken, setBroken] = useState(false);
  if (previewable(a.name) && !broken) return <img src={fileUrl(a.path)} alt="" loading="lazy" onError={() => setBroken(true)} />;
  const I = ICON[a.kind] || Shapes;
  return <span className={"thumb-icon " + a.kind}><I /><span className="thumb-ext">{ext(a.name)}</span></span>;
}

export default function Assets({ active, goDNA }) {
  const [owner, setOwner] = useState(active ? "client" : "common");
  const [items, setItems] = useState(null);
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [dragging, setDragging] = useState(false);
  const client = owner === "client" ? active : null;
  const label = client ? client.name : "Common";

  useEffect(() => { if (!active && owner === "client") setOwner("common"); }, [active]);
  const load = () => listAssets(client).then((a) => { setItems(a); setSel([]); setConfirm(false); }).catch((e) => setErr(e.message));
  useEffect(() => { setItems(null); load(); }, [owner, active && active.id]);

  const say = (m) => { setErr(""); setNote(m); };
  const fail = (e) => { setNote(""); setErr(e.message || String(e)); };

  async function add(files) {
    if (!files.length) return;
    try { const n = await addAssets(client, files); say("Added " + n + (n === 1 ? " file" : " files") + " to " + label + "."); await load(); }
    catch (e) { fail(e); }
  }
  const counts = {}; TYPES.forEach(([t]) => { counts[t] = 0; });
  (items || []).forEach((a) => { counts.all++; if (counts[a.kind] !== undefined) counts[a.kind]++; });
  const ql = q.trim().toLowerCase();
  const shown = (items || []).filter((a) => (type === "all" || a.kind === type) && (!ql || (a.name + " " + a.group).toLowerCase().indexOf(ql) !== -1));
  const selected = (items || []).filter((a) => sel.indexOf(a.path) !== -1);
  const toggle = (a) => setSel((s) => (s.indexOf(a.path) === -1 ? s.concat([a.path]) : s.filter((x) => x !== a.path)));
  const mogrt = selected.length === 1 && /\.mogrt$/i.test(selected[0].name) && !isAE;

  const importSel = () => lib("importFiles", { paths: selected.map((a) => a.path), bin: "Frameshift / " + label })
    .then((r) => say("Imported " + r.imported + (r.imported === 1 ? " file" : " files") + " into the “Frameshift / " + label + "” " + (isAE ? "folder" : "bin") + "." + (r.failed && r.failed.length ? " Couldn’t import: " + r.failed.join(", ") : "")))
    .catch(fail);
  const place = () => lib("placeMogrt", { path: selected[0].path }).then((r) => say("Placed at the playhead on V" + r.track + ".")).catch(fail);
  const reveal = async () => lib("openFolder", { path: selected.length === 1 ? selected[0].path : await assetsDir(client) }).catch(fail);
  async function remove() {
    try { for (const a of selected) await removeAsset(a); say("Moved " + selected.length + (selected.length === 1 ? " file" : " files") + " to the library’s _Removed folder."); await load(); }
    catch (e) { fail(e); }
  }

  return (
    <div className={"screen assets" + (dragging ? " dragging" : "")}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); add(Array.from(e.dataTransfer.files || []).map((f) => f.path).filter(Boolean)); }}>

      <div className="seg" role="radiogroup" aria-label="Whose assets">
        <button role="radio" aria-checked={owner === "client"} className={owner === "client" ? "on" : ""} disabled={!active} onClick={() => setOwner("client")}>
          {active ? active.name : "No client chosen"}
        </button>
        <button role="radio" aria-checked={owner === "common"} className={owner === "common" ? "on" : ""} onClick={() => setOwner("common")}>Common</button>
      </div>
      {!active && <p className="help">Pick a client at the top to see their own assets. <button className="link-btn" onClick={goDNA}>Add a client</button></p>}

      <div className="assets-bar">
        <div className="chips" role="group" aria-label="Type">
          {TYPES.map(([t, l]) => (
            <button key={t} className={"chip" + (type === t ? " on" : "")} aria-pressed={type === t} onClick={() => setType(t)} disabled={t !== "all" && !counts[t]}>
              {l}<span className="num">{counts[t]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="inline assets-tools">
        <button className="ghost tight" onClick={() => add(pickFiles("Add files to " + label, ""))}><Plus /> Add files…</button>
        <button className="ghost tight" onClick={async () => lib("openFolder", { path: await assetsDir(client) }).catch(fail)}><Folder /> Open folder</button>
      </div>
      {items && items.length > 12 && (
        <input className="search" type="search" name="asset-filter" autoComplete="off" spellCheck={false} aria-label="Filter assets" placeholder="Filter by name…" value={q} onChange={(e) => setQ(e.target.value)} />
      )}

      <div aria-live="polite">
        {note && <p className="msg good">{note}</p>}
        {err && <p className="msg bad">{err}</p>}
      </div>

      {items === null ? <p className="help pad">Loading…</p> : !items.length ? (
        <div className="empty drop-hint">
          <p className="empty-title">No {label} assets yet</p>
          <p className="dim">Add the things you reuse: stick figures, logos, icons, sounds, templates. Drag files here or use Add files.</p>
        </div>
      ) : (
        <ul className="grid">
          {shown.map((a) => {
            const on = sel.indexOf(a.path) !== -1;
            return (
              <li key={a.path}>
                <button className={"card" + (on ? " on" : "")} aria-pressed={on} onClick={() => toggle(a)} onDoubleClick={() => { setSel([a.path]); lib("importFiles", { paths: [a.path], bin: "Frameshift / " + label }).then(() => say("Imported " + a.name + ".")).catch(fail); }} title={a.name}>
                  <span className="thumb"><Thumb a={a} /></span>
                  <span className="card-name trunc">{a.name.replace(/\.[^.]+$/, "")}</span>
                  <span className="card-sub trunc">{a.group || ext(a.name)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {items && items.length > 0 && !shown.length && <p className="help pad">Nothing matches.</p>}

      {selected.length > 0 && (
        <div className="action-bar" role="region" aria-label="Selected assets">
          {!confirm ? (
            <>
              <span className="sel-count">{selected.length} selected</span>
              <button className="primary" onClick={importSel}><Download /> Import</button>
              {mogrt && <button className="ghost" onClick={place}>At playhead</button>}
              <button className="icon-btn" onClick={reveal} aria-label="Show in folder" title="Show in folder"><Folder /></button>
              <button className="icon-btn" onClick={() => setConfirm(true)} aria-label="Remove" title="Remove"><Close /></button>
            </>
          ) : (
            <>
              <span className="sel-count">Remove {selected.length === 1 ? selected[0].name : selected.length + " files"}?</span>
              <button className="ghost tight danger-btn" onClick={remove}>Remove</button>
              <button className="ghost tight" onClick={() => setConfirm(false)}>Keep</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
