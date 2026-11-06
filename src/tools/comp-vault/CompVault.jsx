// Comp Vault: save comps, layers, logos, screenshots and client colours once, reuse them anywhere.
// This is the former "Harsh Library" plugin (1.4), built into Harsh. Its UI and storage code are
// in this folder as written (ui.js, store.js, media.js ...); this file wires them into the panel:
//   - its data lives in <Harsh Library>/Tools/Comp Vault, never in the Clients folders that Client DNA
//     owns (deleting a client in Comp Vault used to move that whole folder, DNA included);
//   - its ExtendScript is jsx/comp-vault.jsx with its own global, $.HarshCompVault (it used
//     $.HarshLibrary, the same name as Harsh's own harsh-library.jsx);
//   - every command goes through Harsh's evalRaw: plain ASCII, and the updater waits for it.
import React, { useEffect, useState } from "react";
import { nodeRequire, extensionPath, evalRaw } from "../../host.js";
import { toolDir } from "../../library.js";
import bridge from "./bridge.js";
import createStore from "./store.js";
import makeUI from "./ui.js";
import css from "./styles.css.txt";

bridge.setEval(evalRaw);

// Things saved with the old plugin sat straight in Documents/Harsh Library (Common/Items,
// Clients/<name>/Items, Projects, palette.json). Move them into Comp Vault's own folder once.
// Same disk, so it's a rename: instant, and nothing is copied twice.
function moveOldItems(fs, path, oldRoot, newRoot) {
  const moved = [];
  const move = (from, to) => {
    if (!fs.existsSync(from) || fs.existsSync(to)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    moved.push(to);
  };
  try {
    move(path.join(oldRoot, "Common", "Items"), path.join(newRoot, "Common", "Items"));
    const clients = path.join(oldRoot, "Clients");
    if (fs.existsSync(clients)) {
      for (const c of fs.readdirSync(clients)) {
        const from = path.join(clients, c), to = path.join(newRoot, "Clients", c);
        if (!fs.statSync(from).isDirectory()) continue;
        move(path.join(from, "Items"), path.join(to, "Items"));
        move(path.join(from, "Projects"), path.join(to, "Projects"));
        move(path.join(from, "palette.json"), path.join(to, "palette.json"));
      }
    }
    move(path.join(oldRoot, ".Trash"), path.join(newRoot, ".Trash"));
  } catch (e) { console.error("Comp Vault: moving old items", e); }
  return moved;
}

let built = null; // the UI component, made once
async function build() {
  if (built) return built;
  const fs = nodeRequire("fs"), path = nodeRequire("path"), os = nodeRequire("os"), cp = nodeRequire("child_process");
  let crypto = null;
  try { crypto = nodeRequire("crypto"); } catch (e) {}
  const root = await toolDir("Comp Vault");
  const settingsFile = path.join(root, "settings.json");
  // The old plugin's default folder was the Harsh Library itself.
  const oldSettings = path.join(os.homedir(), ".harsh", "library.json");
  let oldRoot = path.join(os.homedir(), "Documents", "Harsh Library");
  try { const s = JSON.parse(fs.readFileSync(oldSettings, "utf8")); if (s.root) oldRoot = s.root; } catch (e) {}
  if (!fs.existsSync(path.join(root, ".moved")) && path.resolve(oldRoot) !== path.resolve(root)) {
    const moved = moveOldItems(fs, path, oldRoot, root);
    try { fs.writeFileSync(path.join(root, ".moved"), JSON.stringify({ from: oldRoot, moved, at: new Date().toISOString() }, null, 2)); } catch (e) {}
  }
  const store = createStore({ fs, path, crypto, home: os.homedir(), defaultRoot: root, settingsFile });
  const call = bridge.createHost(extensionPath() + "/jsx/comp-vault.jsx");
  if (!document.getElementById("comp-vault-css")) {
    const st = document.createElement("style");
    st.id = "comp-vault-css";
    st.textContent = css;
    document.head.appendChild(st);
  }
  const dialog = (multi, folder, title, start, types) => new Promise((resolve) => {
    const c = window.cep && window.cep.fs;
    if (!c) return resolve(null);
    const r = c.showOpenDialogEx ? c.showOpenDialogEx(multi, folder, title, start || "", types || []) : c.showOpenDialog(multi, folder, title, start || "", types || []);
    resolve(r && !r.err ? (r.data || []) : []);
  });
  built = makeUI(React, {
    store, call, app: bridge.hostApp(), fs, path,
    pickFiles: () => dialog(true, false, "Add logos, screenshots or clips"),
    pickProject: () => dialog(false, false, "Pick an After Effects or Premiere project", "", ["aep", "aepx", "prproj"]),
    pickFolder: (start, title) => dialog(false, true, title || "Choose a folder", start).then((d) => d && d[0]),
    openFolder: (p) => {
      try {
        fs.mkdirSync(p, { recursive: true });
        if (process.platform === "darwin") cp.spawn("open", [p], { detached: true });
        else cp.spawn("explorer", [p.replace(/\//g, "\\")], { detached: true });
      } catch (e) { console.error("Comp Vault: open folder", e); }
    },
  });
  return built;
}

export default function CompVault() {
  const [UI, setUI] = useState(() => built);
  const [err, setErr] = useState("");
  useEffect(() => { if (!UI) build().then((c) => setUI(() => c)).catch((e) => setErr("Comp Vault couldn’t start: " + e.message)); }, []);
  if (err) return <p className="msg bad">{err}</p>;
  if (!UI) return <p className="help">Opening Comp Vault&hellip;</p>;
  return <UI />;
}
