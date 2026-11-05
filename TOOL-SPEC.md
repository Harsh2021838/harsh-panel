# How to build a new tool for the Harsh panel

Give this whole file to any AI (or developer) together with the source project
(`harsh-panel-source.zip`) and a short description of the tool you want
(the "Your tool" section at the end). Everything here is a requirement unless it says "optional".

---

## 1. What the Harsh panel is

- An Adobe CEP extension (HTML panel) that runs inside **Premiere Pro (host id `PPRO`)** and **After Effects (host id `AEFT`)**, version 2022 and later, on Mac and Windows.
- Built with **React 19 + esbuild**. `npm install`, then `npm run build` makes `dist/Harsh <version>/` (with installers) and a zip.
- The panel's browser is an old Chromium (treat it as Chrome 74): no `?.`, no `??` in hand-written plain JS files (the React source is compiled down, so it's fine there). Node.js is available through `window.require` (fs, path, https, child_process...).
- Folders on the home screen: `tools`, `assets`, `client-dna`, `qc`. Every tool lives in one of them. Don't add folders without asking.

## 2. Where a tool's files go

| What | Where |
|---|---|
| The screen (React component, default export) | `src/tools/<tool-id>/<ToolName>.jsx` |
| Logic that runs in the panel (checks, network, files, reports) | `src/tools/<tool-id>/*.js` |
| Code that runs inside Premiere / After Effects (ExtendScript) | `static/jsx/<tool-id>.jsx` |
| Register the tool | add it to the right folder in `FOLDERS` in `src/main.jsx` |
| Instructions for editors | a section in `static/guide/index.html` |

Register like Text QC does:

```js
{ id: "my-tool", name: "My Tool", description: "One line, what it does for the editor",
  icon: SomeIcon, hosts: ["AEFT", "PPRO"], Component: MyTool }
```

Quick, no-build alternative (optional): a single file in `static/plugins/` using `Harsh.register(...)` (see `static/plugins/README.md`). Use this only for small experiments.

## 3. Talking to Premiere / After Effects

- Panel side: `import { makeHost, hostApp } from "../../host.js"`, then
  `const call = makeHost("my-tool.jsx", "HarshMyTool");` and `await call("collect", { mode: "all" })`.
  `hostApp` is `"PPRO"` or `"AEFT"`; show only what works in the current app.
- ExtendScript side (`static/jsx/my-tool.jsx`) must:
  - define `$.HarshMyTool = { call: function (name, arg) { ... } }` that returns a JSON **string** `{ "ok": true, "data": ... }` or `{ "ok": false, "error": "message for the editor" }` (copy the `ser()` helper and `call` dispatcher from `text-qc.jsx`);
  - be **ES3** (no `let`, `const`, arrow functions, `forEach`, `JSON` guaranteed) and **ASCII only** (write `\u2026`, never the character);
  - **read everything in one call**, return it, and do the heavy work in the panel. Never loop over network calls or `$.sleep` inside ExtendScript: it freezes the app.
- Any change to the project: wrap it in `app.beginUndoGroup("Harsh <Tool> ...")` / `app.endUndoGroup()` in After Effects, so Ctrl/Cmd+Z undoes it. Check the thing you're changing is still what you scanned (text changed? layer deleted?) and fail with a clear message if not.
- Never save, close or switch the user's project without asking first in the panel. Never call `alert()` / `confirm()`; show messages in the panel.
- Reusable readers already in the project:
  - `src/tools/text-qc/aep-reader.js`: read comps, layers and text from any .aep file without After Effects.
  - `static/jsx/text-qc.jsx`: walk all sequences/clips/MOGRT fields (Premiere) and all comps/layers (After Effects).

## 4. Where a tool saves its data (the Harsh Library)

Everything goes in the one **Harsh Library** folder the user picks in Settings. Never write to Documents or anywhere else directly.

```
Harsh Library/
  Clients/<Client name>/client.json, logo, Assets/, SFX/, Compositions/, <your kind>/
  Common/Assets/, SFX/, Compositions/, <your kind>/
  Tools/<Tool name>/       the tool's own settings, lists, reports, caches
  _Removed/                move things here instead of deleting them
```

Use the helpers in `src/library.js`:

- `clientDir(client, "SFX")`: per-client data (the active client comes from the shell; screens get it as the `active` prop).
- `await commonDir("SFX")`: the shared version for every client.
- `await toolDir("Gap QC")`: the tool's own folder.
- `listClients()`, `fileUrl(path)` (thumbnails), `lib("importFiles", { paths, bin })` (import into the project), `lib("openFolder", { path })`.

Data must be plain files (JSON, images, audio, .aep, .mogrt) so Backup, Export client and team sharing work without extra code.

## 5. QC tools: the shape every QC tool should follow

So all QC tools feel the same:

1. **Scope at the top** (segmented control):
   After Effects `All comps | Selected | Folders | Other projects`; Premiere `All sequences | Open sequence`. Drop options that don't apply.
2. **One primary button** ("Check …"), then a progress bar with a **Stop** button while it runs. The app must stay usable while the panel works.
3. **Summary first**: the count of things to look at, how many are serious, what was checked ("Checked 12 comps and 40 layers"), how long it took.
4. **Findings list**, each finding has:
   - `severity`: `serious` (must fix) / `check` (worth a look) / `info`;
   - what's wrong, in plain words, and the expected value (e.g. "Font is Arial, brand font is Inter");
   - **where**: kind tag (Title / Template / AE comp / Caption / Layer / Clip...), sequence or comp name, **timecode**, layer name;
   - a **Go to** button (jump to the clip or select the layer);
   - a **Fix** button when the fix is safe and obvious, and **Ignore**.
   Group identical findings ("Also in 3 other places") instead of repeating them.
5. Filter chips per category, a search box, and **Export Report** (HTML file in the reports folder).
6. Remember what's already been checked where possible, so a second run is instant.
7. Say clearly what the tool **can't** check (e.g. "Legacy Titles can't be read").

## 6. Look, words and behaviour

- Use the shell's CSS classes; don't bring a new design or CSS framework. Wrap the tool in `<div className="tool">`.
  Buttons `primary` (one per screen), `ghost`, `ghost tight`; scope `seg`; boxes `pane`; small notes `help`;
  messages `msg good|bad|warn`; chips `chips`/`chip`; inputs `field`; checkbox rows `check-inline`; button rows `inline`.
- Colours come from CSS variables (`--ink`, `--ink-2`, `--ink-3`, `--line`, `--raise`, `--accent`, `--good`, `--bad`) so it works in Adobe's dark and light themes. No hard-coded colours except category colours.
- Must work docked as narrow as **320 px**: things wrap, long names truncate with "…".
- Words: short and plain, written for an editor. Buttons say exactly what happens ("Check Text", "Export Report"). Running states end with "…". Errors say what went wrong **and what to do** ("After Effects is busy, probably with a dialog open. Close it and try again.").
- Small preferences in `localStorage` under `harsh.<tool-id>.`; anything the user would miss (lists, dictionaries, reports, saved items) in the Harsh Library (section 4).
- Works offline unless the tool needs a service; if it does, say so in the panel and handle "no internet" with a clear message.

## 7. Before it's done

- `npm run build` works with no errors.
- Tested with fake data the same way `demo/demo-mocks.js` fakes Premiere and After Effects; ideally added to the demo page (`node demo/build-demo.mjs`).
- Tested once in real Premiere and/or After Effects: run, Go to, Fix, Undo, Export Report.
- Guide section written. Version bumped in **both** `package.json` and `static/CSXS/manifest.xml` (and `VERSION` in `src/main.jsx`).
- List every file added or changed.

---

## Your tool (fill this in each time)

```
Tool name:
Folder: qc / tools / assets / client-dna
Saves data? (per client / common / tool only, and what):
Works in: Premiere Pro / After Effects / both
What it checks or does (one or two sentences):
What counts as SERIOUS vs worth a look:
What it should be able to fix by itself (if anything):
Where the rules come from (e.g. client fonts/colours list, a checklist file, fixed values):
Example of a problem it should catch:
Things it must NOT touch:
```

Example:

```
Tool name: Font QC
Folder: qc
Works in: both
What it checks: every text layer / title uses only the client's brand fonts and sizes.
Serious: a font that isn't in the client's list, or a missing font. Worth a look: size outside the allowed range.
Fix by itself: no, just report with Go to.
Rules from: the client's fonts in Client DNA (until that exists, a list in Settings).
Example: lower third in 02_Features uses Arial; brand font is Inter.
Must not touch: anything; read only.
```
