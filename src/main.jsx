import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { startSizing } from "./density.js";
import SizeSwitch from "./tools/SizeSwitch.jsx";
import { hostApp, hostName, hostBackground, onThemeChange, extensionPath, host } from "./host.js";
import { Wrench, Image, Helix, Check, Proof, Back, Chevron, Gear, Caret, Plus, Wave, GapIcon, VaultIcon, EaseIcon } from "./icons.jsx";
import Settings from "./sections/Settings.jsx";
import { findUpdate, installUpdate, updateMode, downloadUpdate } from "./updater.js";
import { hostIdle } from "./host.js";
import { trace, lastRun } from "./trace.js";
import ClientDNA, { ClientLogo } from "./sections/ClientDNA.jsx";
import Assets from "./sections/Assets.jsx";
import { listClients } from "./library.js";
import TextQC from "./tools/text-qc/TextQC.jsx";
import SoundKit from "./tools/sound-kit/SoundKit.jsx";
import EaseGraph from "./tools/ease-graph/EaseGraph.jsx";
import GapQC from "./tools/gap-qc/GapQC.jsx";
import AudioQC from "./tools/audio-qc/AudioQC.jsx";
import CompVault from "./tools/comp-vault/CompVault.jsx";
import "./styles.css";

const VERSION = "2.24.0";

// The four sections. Add a tool by putting it in a section's `tools` list
// (or drop a plugin file into /plugins, see plugins/README.md).
const SECTIONS = [
  { id: "tools", name: "Tools", icon: Wrench, empty: "Editing helpers you add will show up here.", tools: [
    { id: "comp-vault", name: "Comp Vault", description: "Save comps, layers, logos and client colours once; add them to any project", icon: VaultIcon, hosts: ["AEFT", "PPRO"], Component: CompVault },
    { id: "sound-kit", name: "Sound Kit", description: "Each client's SFX and BGM, levelled and coloured, placed in one click", icon: () => <Wave size={18} />, hosts: ["PPRO"], fill: true, Component: SoundKit },
    { id: "ease-graph", name: "Ease Graph", description: "After Effects-style value and speed graphs for Premiere keyframes, with Smart ease", icon: () => <EaseIcon size={18} />, hosts: ["PPRO"], fill: true, Component: EaseGraph },
  ] },
  { id: "assets", name: "Assets", icon: Image, screen: "assets", tools: [] },
  { id: "client-dna", name: "Client DNA", icon: Helix, screen: "dna", tools: [] },
  {
    id: "qc", name: "QC", icon: Check, empty: "Checks you run before export.", tools: [
      { id: "text-qc", name: "Text QC", description: "Spelling, grammar and spacing in every piece of on-screen text", icon: Proof, hosts: ["AEFT", "PPRO"], Component: TextQC },
      { id: "gap-qc", name: "Gap QC", description: "Gaps, flash frames, cuts that don\u2019t line up, audio sync, black, offline and frame-rate problems", icon: GapIcon, hosts: ["AEFT", "PPRO"], Component: GapQC },
      { id: "audio-qc", name: "Audio QC", description: "Distortion, music or SFX covering the voice, uneven SFX levels and clicks at cuts", icon: () => <Wave size={18} />, hosts: ["PPRO"], Component: AudioQC },
    ],
  },
];

function buildSections() {
  const sections = SECTIONS.map((f) => ({ ...f, tools: f.tools.slice() }));
  if (window.Harsh && window.Harsh.apply) window.Harsh.apply(sections, React);
  sections.forEach((f) => { f.tools = f.tools.filter((t) => !t.hosts || t.hosts.indexOf(hostApp) !== -1); });
  return sections;
}

function useHostTheme() {
  const [bg, setBg] = useState(hostBackground());
  useEffect(() => onThemeChange(() => setBg(hostBackground())), []);
  useEffect(() => {
    const light = (bg.r + bg.g + bg.b) / 3 > 128;
    const root = document.querySelector("[data-panel-root]") || document.documentElement;
    root.style.setProperty("--bg", `rgb(${bg.r}, ${bg.g}, ${bg.b})`);
    root.dataset.theme = light ? "light" : "dark";
  }, [bg]);
}

/** Name of the open project, refreshed whenever the panel gets focus. */
function useProjectName() {
  const [name, setName] = useState("");
  useEffect(() => {
    const read = () => host("info").then((i) => setName(String(i.project || "").replace(/\.(prproj|aep)$/i, ""))).catch(() => {});
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);
  return name;
}

function openGuide() {
  const url = "file://" + encodeURI(extensionPath() + "/guide/index.html");
  try { window.cep.util.openURLInDefaultBrowser(url); } catch (e) { window.open(url); }
}

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago";
};

function statusLine(s) {
  if (!s) return "Not checked yet";
  if (s.running) return "Checking…";
  return (s.count ? s.count + " to look at" : "All clear") + ", " + ago(s.at);
}

function App() {
  useHostTheme();
  const project = useProjectName();
  const [sections] = useState(buildSections);
  const [tab, setTab] = useState(() => { try { return localStorage.getItem("harsh.tab") || "qc"; } catch (e) { return "qc"; } });
  const [openTool, setOpenTool] = useState({}); // section id -> tool id
  const [mounted, setMounted] = useState([]);   // tools stay alive once opened, so a running check keeps going
  const [status, setStatus] = useState({});     // tool id -> { count, at, running }
  const [, tick] = useState(0);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(() => { try { return localStorage.getItem("harsh.client") || null; } catch (e) { return null; } });
  const [menu, setMenu] = useState(false);
  const [intent, setIntent] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libKey, setLibKey] = useState(0); // bumped when the library moves, so screens reload
  const [update, setUpdate] = useState(null);   // a newer version waiting in the Updates folder
  const [updated, setUpdated] = useState(() => { try { const j = localStorage.getItem("harsh.justUpdated"); localStorage.removeItem("harsh.justUpdated"); return j ? JSON.parse(j) : null; } catch (e) { return null; } });
  const [updating, setUpdating] = useState("");
  // Did the panel stop without closing last time? The step log says what it was doing.
  const [stopped, setStopped] = useState(() => {
    const prev = lastRun(), end = prev[prev.length - 1] || "";
    trace("open Frameshift " + VERSION + " in " + hostName);
    return prev.length && !/ (closed|open Frameshift)/.test(end) ? prev : null;
  });
  useEffect(() => { const bye = () => trace("closed"); window.addEventListener("beforeunload", bye); return () => window.removeEventListener("beforeunload", bye); }, []);
  // Install, but only once Premiere has finished every command Harsh sent it: reloading the panel
  // while a command is still running inside the app can crash it.
  // The panel is never reloaded: reloading a running panel is what crashed Premiere's panel engine
  // (CEPHtmlEngine). The new files are written now and start the next time the panel opens.
  const install = (u) => {
    setUpdating("Installing Frameshift " + u.version + "\u2026");
    hostIdle()
      .then(() => installUpdate(u, VERSION))
      .then(() => { try { localStorage.setItem("harsh.installedNext", u.version); } catch (e) {} setUpdate(null); setUpdating("Frameshift " + u.version + " is installed. It starts the next time you open this panel."); })
      .catch((e) => setUpdating("Couldn\u2019t update: " + e.message));
  };
  useEffect(() => {
    // Look for a newer version once the panel is up, and again every 4 hours.
    // "Install automatically" only installs right after the panel opens, before any tool has
    // talked to Premiere. Found later, while you work, an update is only downloaded and offered
    // in the bar at the top (or it installs the next time the panel opens).
    const check = () => downloadUpdate(VERSION).catch(() => null)
      .then(() => findUpdate(VERSION))
      .then((u) => {
        if (!u) return;
        let waiting = ""; try { waiting = localStorage.getItem("harsh.installedNext") || ""; } catch (e) {}
        if (waiting === u.version) { setUpdating("Frameshift " + u.version + " is installed. It starts the next time you open this panel."); return; }
        if (updateMode() === "auto") install(u); else setUpdate(u);
      })
      .catch(() => {});
    const t = setTimeout(check, 1500);
    const iv = setInterval(check, 4 * 3600 * 1000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, []);
  const menuRef = useRef(null);
  const reload = () => listClients().then(setClients).catch(() => {});
  useEffect(() => { reload(); }, []);
  useEffect(() => { try { clientId ? localStorage.setItem("harsh.client", clientId) : localStorage.removeItem("harsh.client"); } catch (e) {} }, [clientId]);
  useEffect(() => {
    if (!menu) return;
    const off = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [menu]);
  const active = clients.find((c) => c.id === clientId) || null;

  useEffect(() => { try { localStorage.setItem("harsh.tab", tab); } catch (e) {} }, [tab]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t); }, []);

  const section = sections.find((s) => s.id === tab) || sections[0];
  const current = section.tools.find((t) => t.id === openTool[section.id]);
  const open = (t) => {
    trace("tool " + t.id);
    if (mounted.indexOf(t) === -1) setMounted(mounted.concat([t]));
    setOpenTool({ ...openTool, [section.id]: t.id });
  };
  const close = () => { trace("back from tool"); setOpenTool({ ...openTool, [section.id]: null }); };
  const report = (id) => (s) => setStatus((all) => ({ ...all, [id]: s }));
  const badge = (sec) => sec.tools.reduce((n, t) => n + ((status[t.id] && status[t.id].count) || 0), 0);

  return (
    <div className="app">
      <header className="top">
        <img className="mark" src="../assets/logo.png" width="18" height="18" alt="Frameshift" title={"Frameshift v" + VERSION} />
        <div className="top-text">
          <span className="top-project" title={project}>{project || "No project open"}</span>
          <span className="top-app">{hostName}</span>
        </div>
        <div className="client-menu" ref={menuRef}>
          <button className={"client-chip" + (active ? "" : " none")} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} title="Active client">
            {active ? <ClientLogo client={active} size={16} /> : null}
            <span className="trunc">{active ? active.name : "Client"}</span><Caret />
          </button>
          {menu && (
            <div className="menu" role="menu">
              {clients.map((c) => (
                <button key={c.id} role="menuitemradio" aria-checked={c.id === clientId} className={"menu-item" + (c.id === clientId ? " on" : "")} onClick={() => { setClientId(c.id); setMenu(false); }}>
                  <ClientLogo client={c} size={18} /><span className="trunc">{c.name}</span>
                </button>
              ))}
              {clients.length > 0 && <div className="menu-sep" />}
              <button role="menuitem" className="menu-item" onClick={() => { setMenu(false); setTab("client-dna"); setIntent({ type: "new", n: Date.now() }); }}><Plus /> New client</button>
              {active && <button role="menuitem" className="menu-item" onClick={() => { setClientId(null); setMenu(false); }}>No client</button>}
            </div>
          )}
        </div>
        <button className={"icon-btn" + (settingsOpen ? " on" : "")} onClick={() => setSettingsOpen(!settingsOpen)} aria-label="Settings" aria-pressed={settingsOpen} title="Settings"><Gear size={15} /></button>
      </header>

      {stopped && (
        <div className="banner" role="status">
          <span className="grow">The panel stopped unexpectedly last time, right after: <b>{(stopped[stopped.length - 1] || "").slice(13)}</b></span>
          <button className="ghost tight strong" onClick={() => { try { navigator.clipboard.writeText(stopped.join("\n")); } catch (e) {} setStopped(null); }}>Copy details</button>
          <button className="icon-btn small" onClick={() => setStopped(null)} aria-label="Dismiss">&times;</button>
        </div>
      )}
      {(update || updated || updating) && (
        <div className={"banner" + (updated && !update && !updating ? " done" : "")} role="status">
          {updating ? <span className="grow">{updating}</span>
            : update ? (<>
              <span className="grow">Frameshift {update.version} is ready.</span>
              <button className="ghost tight strong" onClick={() => install(update)}>Install now</button>
              <button className="ghost tight" onClick={() => setUpdate(null)}>Later</button>
            </>) : (<>
              <span className="grow">Updated to Frameshift {updated.to}. If anything looks odd, restart {hostName}.</span>
              <button className="icon-btn small" onClick={() => setUpdated(null)} aria-label="Dismiss">&times;</button>
            </>)}
        </div>
      )}
      <main className="body">
        {settingsOpen && (
          <section className="section" aria-labelledby="settings-title">
            <h1 id="settings-title" className="section-title">Settings</h1>
            <Settings clients={clients} active={active} version={VERSION} openGuide={openGuide}
              onLibraryChanged={async (id) => { await reload(); if (id) setClientId(id); setLibKey((k) => k + 1); }} />
          </section>
        )}
        {!settingsOpen && section.screen === "dna" && (
          <section className="section" aria-labelledby="section-title" key={"dna" + libKey}>
            <h1 id="section-title" className="section-title">Client DNA</h1>
            <ClientDNA clients={clients} active={active} onSelect={setClientId} reload={reload} intent={intent} goAssets={() => setTab("assets")} />
          </section>
        )}
        {!settingsOpen && section.screen === "assets" && (
          <section className="section" aria-labelledby="section-title" key={"assets" + libKey}>
            <h1 id="section-title" className="section-title">Assets</h1>
            <Assets active={active} goDNA={() => { setTab("client-dna"); setIntent({ type: "new", n: Date.now() }); }} />
          </section>
        )}
        {!settingsOpen && !current && !section.screen && (
          <section className="section" aria-labelledby="section-title">
            <h1 id="section-title" className="section-title">{section.name}</h1>
            {section.tools.length ? (
              <ul className="tool-list">
                {section.tools.map((t) => {
                  const Icon = t.icon || Proof;
                  const s = status[t.id];
                  return (
                    <li key={t.id}>
                      <button className="tool-row" onClick={() => open(t)}>
                        <span className="tool-icon"><Icon /></span>
                        <span className="tool-text">
                          <span className="tool-name">{t.name}</span>
                          {t.description && <span className="tool-desc">{t.description}</span>}
                          {section.id === "qc" && <span className={"tool-status" + (s && s.count ? " has" : s ? " ok" : "")}>{statusLine(s)}</span>}
                        </span>
                        <Chevron />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="empty">
                <span className="empty-icon">{React.createElement(section.icon, { size: 26 })}</span>
                <p>Nothing here yet.</p>
                <p className="dim">{section.empty}</p>
              </div>
            )}
          </section>
        )}

        {mounted.map((t) => {
          const C = t.Component;
          const on = current === t && !settingsOpen;
          return (
            <div key={t.id} hidden={!on} className={"tool-screen" + (t.fill ? " fill" : "")}>
              <div className="tool-head">
                <button className="icon-btn" onClick={close} aria-label={"Back to " + section.name}><Back /></button>
                <h1 className="tool-title">{t.name}</h1>
                <SizeSwitch />
              </div>
              <C report={report(t.id)} client={active} />
            </div>
          );
        })}
      </main>

      <nav className="tabs" aria-label="Sections">
        {sections.map((s) => {
          const Icon = s.icon;
          const n = badge(s);
          return (
            <button key={s.id} className={"tab" + (s.id === tab && !settingsOpen ? " on" : "")} aria-current={s.id === tab && !settingsOpen ? "page" : undefined}
              onClick={() => { if (s.id === tab && !settingsOpen) close(); setTab(s.id); setSettingsOpen(false); }}>
              <span className="tab-icon"><Icon size={18} />{n > 0 && <span className="badge num">{n > 99 ? "99+" : n}</span>}</span>
              <span className="tab-label">{s.name}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

createRoot(document.getElementById("app")).render(<App />);
startSizing();
