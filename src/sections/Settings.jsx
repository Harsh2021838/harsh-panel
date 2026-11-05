import React, { useEffect, useState } from "react";
import { pickFolder } from "../host.js";
import { Folder, Book } from "../icons.jsx";
import {
  libraryStats, backupLibrary, exportClient, importClient, looksLikeLibrary, moveLibrary, lib, path,
} from "../library.js";
import { forgetPaths } from "../tools/text-qc/engine.js";
import { updateMode, setUpdateMode, findUpdate, inspectUpdate, installUpdate, compareVersions, updatesDir, updateFeed, setUpdateFeed, downloadUpdate, lastChecked } from "../updater.js";
import { pickFiles } from "../host.js";

const LAYOUT = [
  ["Clients", "One folder per client: Client DNA, logo, Assets, SFX and Compositions."],
  ["Common", "Assets, SFX and Compositions for every client."],
  ["Tools", "Each tool’s own data, like the Text QC dictionary and reports."],
  ["_Removed", "Anything you remove, so nothing is ever lost."],
];

// Long paths keep their end (the part that tells you where it is): "\u2026/Dropbox/Team/Harsh Library".
const shortPath = (p) => (p.length > 44 ? "\u2026" + p.slice(-43) : p);

export default function Settings({ clients, active, onLibraryChanged, openGuide, version }) {
  const [stats, setStats] = useState(null);
  const [pending, setPending] = useState(null); // folder picked for a new location
  const [exportId, setExportId] = useState(active ? active.id : "");
  const [busy, setBusy] = useState("");
  const [mode, setMode] = useState(updateMode());
  const [found, setFound] = useState(null);
  const [older, setOlder] = useState(null);
  const [feed, setFeed] = useState(updateFeed());
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const refresh = () => libraryStats().then(setStats).catch((e) => setErr(e.message));
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (!exportId && clients[0]) setExportId(clients[0].id); }, [clients]);

  const say = (m) => { setErr(""); setNote(m); };
  const fail = (e) => { setNote(""); setErr(e.message || String(e)); };
  async function run(label, fn) {
    setBusy(label); setErr(""); setNote("");
    await new Promise((r) => setTimeout(r, 30));
    try { await fn(); } catch (e) { fail(e); }
    setBusy("");
  }

  async function install(u) {
    setBusy("Installing Harsh " + u.version + "\u2026");
    await new Promise((r) => setTimeout(r, 30));
    const backup = await installUpdate(u, version);
    say("Installed " + u.version + ". The old version is saved in " + backup + ". Reloading\u2026");
    setTimeout(() => location.reload(), 900);
  }

  async function move(mode) {
    const dir = pending; setPending(null);
    await run(mode === "copy" ? "Copying your library…" : "Switching library…", async () => {
      const now = await moveLibrary(dir, mode);
      forgetPaths();
      await onLibraryChanged();
      await refresh();
      say("The library is now at " + now + ". The old folder wasn’t changed.");
    });
  }
  const size = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : mb >= 1 ? Math.round(mb) + " MB" : "under 1 MB");
  const exporting = clients.find((c) => c.id === exportId);

  return (
    <div className="screen settings-screen">
      <div aria-live="polite">
        {busy && <p className="msg">{busy}</p>}
        {note && <p className="msg good">{note}</p>}
        {err && <p className="msg bad">{err}</p>}
      </div>

      <section className="block first">
        <h3 className="block-title">Harsh Library</h3>
        <p className="help">One folder for everything the panel saves: every client&rsquo;s DNA, assets, SFX and comps, and each tool&rsquo;s data.</p>
        <div className="lib-card">
          <span className="lib-icon"><Folder size={18} /></span>
          <div className="lib-text">
            <span className="lib-path" title={stats ? stats.dir : ""}>{stats ? shortPath(stats.dir) : "Loading\u2026"}</span>
            {stats && <span className="lib-stats">{stats.clients} {stats.clients === 1 ? "client" : "clients"}, {stats.files} files ({size(stats.mb)})</span>}
          </div>
        </div>
        <div className="inline">
          <button className="ghost tight" disabled={!stats} onClick={() => lib("openFolder", { path: stats.dir }).catch(fail)}><Folder /> Open folder</button>
          <button className="ghost tight" disabled={!!busy} onClick={() => { const d = pickFolder("Choose where the Harsh Library should live"); if (d) setPending(d); }}>Change location…</button>
        </div>
        {pending && (
          <div className="confirm-box">
            {looksLikeLibrary(pending) ? (
              <>
                <p>That folder already has a Harsh Library. Use it? Your current library stays where it is.</p>
                <div className="inline">
                  <button className="ghost tight strong" onClick={() => move("use")}>Use this library</button>
                  <button className="ghost tight" onClick={() => setPending(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <p>Move to <b>{pending}</b>?</p>
                <div className="inline">
                  <button className="ghost tight strong" onClick={() => move("copy")}>Copy my library there</button>
                  <button className="ghost tight" onClick={() => move("use")}>Start an empty one</button>
                  <button className="ghost tight" onClick={() => setPending(null)}>Cancel</button>
                </div>
                <p className="help">Copying keeps the old folder as it is, so nothing can get lost.</p>
              </>
            )}
          </div>
        )}
        <p className="help">Put it in Dropbox, Google Drive or on a server to share clients and assets with your team.</p>
      </section>

      <section className="block">
        <h3 className="block-title">Updates</h3>
        <p className="help">You have Harsh {version}. New versions download by themselves from the update source below, or you can drop a Harsh zip in the library&rsquo;s Updates folder.</p>
        <label className="field feed"><span>Update source</span>
          <input name="feed" autoComplete="off" spellCheck={false} value={feed} placeholder="GitHub repo, like harsh/harsh-panel\u2026"
            onChange={(e) => setFeed(e.target.value)} onBlur={() => setUpdateFeed(feed)} />
        </label>
        <p className="help">{feed ? (lastChecked() ? "Last checked " + new Date(lastChecked()).toLocaleString() + "." : "Not checked yet.") : "No update source yet, so only the Updates folder is used."}</p>
        <div className="seg" role="radiogroup" aria-label="When an update is found">
          {[["ask", "Ask me first"], ["auto", "Install automatically"]].map(([id, label]) => (
            <button key={id} role="radio" aria-checked={mode === id} className={mode === id ? "on" : ""} onClick={() => { setUpdateMode(id); setMode(id); }}>{label}</button>
          ))}
        </div>
        {found && (
          <div className="confirm-box">
            <p>Harsh <b>{found.version}</b> is ready to install.</p>
            <div className="inline"><button className="ghost tight strong" disabled={!!busy} onClick={() => install(found)}>Install {found.version}</button></div>
          </div>
        )}
        <div className="inline">
          <button className="ghost tight" disabled={!!busy} onClick={() => run("Looking for updates\u2026", async () => { setUpdateFeed(feed); await downloadUpdate(version); const u = await findUpdate(version); setFound(u); if (!u) say("You have the newest version."); })}>Check now</button>
          <button className="ghost tight" disabled={!!busy} onClick={() => { const f = pickFiles("Choose a Harsh zip", "zip")[0]; if (f) run("Reading " + path.basename(f) + "\u2026", async () => {
            const u = inspectUpdate(f);
            if (compareVersions(u.version, version) <= 0 && !older) { setOlder(u); return; }
            await install(u);
          }); }}>Install from file…</button>
          <button className="ghost tight" onClick={async () => lib("openFolder", { path: await updatesDir() }).catch(fail)}><Folder /> Updates folder</button>
        </div>
        {older && (
          <div className="confirm-box">
            <p>That zip is Harsh <b>{older.version}</b>, and you already have {version}. Install it anyway?</p>
            <div className="inline">
              <button className="ghost tight strong" onClick={() => { const u = older; setOlder(null); run("Installing\u2026", () => install(u)); }}>Install {older.version}</button>
              <button className="ghost tight" onClick={() => setOlder(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <section className="block">
        <h3 className="block-title">Back up</h3>
        <p className="help">Saves a dated copy of the whole library: clients, assets, SFX, comps and tool data.</p>
        <div className="inline">
          <button className="ghost tight" disabled={!!busy} onClick={() => { const d = pickFolder("Where should the backup go?"); if (d) run("Saving a backup…", async () => say("Backup saved: " + (await backupLibrary(d)))); }}>Save a backup…</button>
        </div>
      </section>

      <section className="block">
        <h3 className="block-title">Move a client between computers</h3>
        <p className="help">Export makes one folder with everything for that client. Import brings such a folder into this library.</p>
        <div className="picker">
          <label className="sr" htmlFor="export-pick">Client to export</label>
          <select id="export-pick" value={exportId} onChange={(e) => setExportId(e.target.value)} disabled={!clients.length}>
            {!clients.length && <option value="">No clients yet</option>}
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="ghost" disabled={!exporting || !!busy} onClick={() => { const d = pickFolder("Where should " + exporting.name + " go?"); if (d) run("Exporting…", () => say(exporting.name + " exported to " + exportClient(exporting, d))); }}>Export…</button>
        </div>
        <div className="inline">
          <button className="ghost tight" disabled={!!busy} onClick={() => { const d = pickFolder("Choose the client folder to import"); if (d) run("Importing…", async () => { const id = await importClient(d); await onLibraryChanged(id); await refresh(); say("Imported " + id + "."); }); }}>Import a client folder…</button>
        </div>
      </section>

      <section className="block">
        <h3 className="block-title">Inside the library</h3>
        <dl className="layout">
          {LAYOUT.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
        </dl>
      </section>

      <section className="block about">
        <span className="dim">Harsh v{version}</span>
        <button className="ghost tight" onClick={openGuide}><Book /> Open the guide</button>
      </section>
    </div>
  );
}
