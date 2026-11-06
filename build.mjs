// Builds the installable panel into dist/Frameshift <version>/ and zips it.
// The internal extension id stays com.harsh.panel, so updates and settings carry over.
//   npm run build
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const out = path.join("dist", "Frameshift " + pkg.version);
const ext = path.join(out, "com.harsh.panel");

fs.rmSync("dist", { recursive: true, force: true });
fs.cpSync("static", ext, { recursive: true });

await esbuild.build({
  entryPoints: ["src/main.jsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome74"], // oldest Chromium in Premiere / After Effects 2022 panels
  jsx: "automatic",
  charset: "ascii",     // keep the bundle pure ASCII
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".txt": "text" },
  outfile: path.join(ext, "app", "main.js"),
  logLevel: "warning",
});

for (const f of fs.readdirSync("scripts")) fs.copyFileSync(path.join("scripts", f), path.join(out, f));
fs.chmodSync(path.join(out, "Install Frameshift (Mac).command"), 0o755);
fs.copyFileSync(path.join(ext, "guide", "index.html"), path.join(out, "Read me first.html"));

const zip = "Frameshift-" + pkg.version.replace(/\./g, "_") + ".zip";
execSync(`cd dist && zip -qr -X "${zip}" "Frameshift ${pkg.version}"`);
// Panels from before the rename (Harsh <= 2.13) only look for a "Harsh-*.zip" in a release,
// so every release also carries the same zip under that name. They update to Frameshift with it.
const legacy = "Harsh-" + pkg.version.replace(/\./g, "_") + ".zip";
fs.copyFileSync(path.join("dist", zip), path.join("dist", legacy));
console.log("Built", out, "and dist/" + zip, "(+ dist/" + legacy + " for older panels)");
