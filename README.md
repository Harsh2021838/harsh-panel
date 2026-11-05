# Harsh panel

Panel for Premiere Pro and After Effects: Text QC, Sound Kit, Client DNA, Assets, and a shared Harsh Library.

## Install

Download the newest `Harsh-x_y_z.zip` from [Releases](../../releases), unzip it and run the installer
for Mac or Windows. After that the panel updates itself from this page (Settings > Updates).

## Build

```
npm install
npm run build
```

Makes `dist/Harsh <version>/` and `dist/Harsh-<version>.zip`.

## Release a new version

1. Change the version in `package.json`, `static/CSXS/manifest.xml` and `VERSION` in `src/main.jsx`.
2. Commit and push to `main`.
3. GitHub Actions sees a version with no release yet, builds it and publishes release `v<version>`
   with the zip attached. Every panel picks it up within a few hours (or at once with Check now).

## Layout

- `src/main.jsx`: the shell (tabs, client switcher, settings, updates).
- `src/tools/text-qc/`: Text QC (screen, checker, .aep and .prproj readers).
- `src/tools/sound-kit/`: Sound Kit (Client Sound Kit, run inside a shadow root; original files in `vendor/`, ExtendScript in `static/jsx/client-sound-kit.jsx`). Its data: `Harsh Library/Tools/Sound Kit/`.
- `src/sections/`: Client DNA, Assets, Settings.
- `src/library.js`: the Harsh Library folder; `src/updater.js`: updates.
- `static/`: manifest, page, ExtendScript (`jsx/`), fonts, guide, plugins.
- `scripts/`: installers. `demo/`: clickable web preview.
- Adding a tool: read `TOOL-SPEC.md`.
