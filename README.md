# Harsh panel

Panel for Premiere Pro and After Effects: Text QC, Client DNA, Assets, and a shared Harsh Library.

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
2. Commit, then push a tag: `git tag v2.6.0 && git push origin main v2.6.0`.
3. GitHub Actions builds it and publishes the release; every panel picks it up within a few hours.

## Layout

- `src/main.jsx`: the shell (tabs, client switcher, settings, updates).
- `src/tools/text-qc/`: Text QC (screen, checker, .aep and .prproj readers).
- `src/sections/`: Client DNA, Assets, Settings.
- `src/library.js`: the Harsh Library folder; `src/updater.js`: updates.
- `static/`: manifest, page, ExtendScript (`jsx/`), fonts, guide, plugins.
- `scripts/`: installers. `demo/`: clickable web preview.
- Adding a tool: read `TOOL-SPEC.md`.
