// Builds the installable panel into dist/Harsh <version>/ and zips it.
//   npm run build
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const out = path.join("dist", "Harsh " + pkg.version);
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
fs.chmodSync(path.join(out, "Install Harsh (Mac).command"), 0o755);
fs.copyFileSync(path.join(ext, "guide", "index.html"), path.join(out, "Read me first.html"));

const zip = "Harsh-" + pkg.version.replace(/\./g, "_") + ".zip";
execSync(`cd dist && zip -qr -X "${zip}" "Harsh ${pkg.version}"`);
console.log("Built", out, "and dist/" + zip);
