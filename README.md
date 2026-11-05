# Harsh panel

Panel for Premiere Pro and After Effects. Folders: Tools, Assets, Client DNA, QC.
Tools so far: **Text QC** (QC folder).

## Build

```
npm install
npm run build
```

This makes `dist/Harsh <version>/` (installer + panel) and `dist/Harsh-<version>.zip`.
Change the version in `package.json` and `static/CSXS/manifest.xml` together.

## Layout

- `src/main.jsx`: the shell (folders, navigation). Add a tool to a folder's `tools` list here.
- `src/tools/text-qc/`: Text QC screen (`TextQC.jsx`) and checker (`engine.js`).
- `src/host.js`: talks to Premiere / After Effects.
- `src/styles.css`: all styling.
- `static/jsx/text-qc.jsx`: the ExtendScript that runs inside the app (ES3, ASCII only).
- `static/plugins/`: drop-in tools that don't need a rebuild (see the README there).
- `scripts/`: the Mac and Windows installers.
- `demo/`: a clickable web preview with fake Premiere / After Effects (`node demo/build-demo.mjs`).

Adding a tool: read `TOOL-SPEC.md`.
