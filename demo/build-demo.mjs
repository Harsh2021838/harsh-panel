// Builds demo/dist/harsh-demo.html: the real panel plus fake Premiere / After Effects,
// in one self-contained page.   node demo/build-demo.mjs
import * as esbuild from "esbuild";
import fs from "node:fs";

const css = (await esbuild.build({ entryPoints: ["src/styles.css"], bundle: true, minify: true, write: false })).outputFiles[0].text;
const js = (await esbuild.build({
  entryPoints: ["src/main.jsx"], bundle: true, minify: true, format: "iife", target: ["chrome90"], jsx: "automatic",
  charset: "ascii", define: { "process.env.NODE_ENV": '"production"' }, write: false, loader: { ".css": "empty", ".txt": "text" },
})).outputFiles[0].text;
const poly = (await esbuild.build({
  stdin: { contents: 'window.__NodeBuffer = require("buffer").Buffer;', resolveDir: process.cwd() },
  bundle: true, minify: true, format: "iife", write: false,
})).outputFiles[0].text;

// The panel's CSS styles the whole document; in the demo it applies to the docked panel only.
const scoped = css
  .replace(":root[data-theme=light]", "[data-panel-root][data-theme=light]")
  .replace(/:root\{/, "[data-panel-root]{")
  .replace(/html,body\{[^}]*\}/, "[data-panel-root]{background:var(--bg)}")
  .replace(/body\{font:/, "[data-panel-root]{font:")
  // :where() keeps these as weak as the originals, so the panel's own classes still win.
  .replace(/:focus\{outline:none\}/, ":where([data-panel-root]) :focus{outline:none}")
  .replace(/\*\{box-sizing:border-box\}/, ":where([data-panel-root]),:where([data-panel-root]) *{box-sizing:border-box}")
  .replace(/button,input,select\{/, ":where([data-panel-root]) :where(button,input,select){")
  .replace(/button\{cursor/, ":where([data-panel-root]) button{cursor")
  .replace(/p\{margin:0\}/, ":where([data-panel-root]) p{margin:0}");

const fonts = [400, 500, 600, 700].map((w) => '@font-face{font-family:"Archivo";font-weight:' + w + ';font-display:swap;src:url(data:font/woff2;base64,' +
  fs.readFileSync("static/fonts/archivo-latin-" + w + "-normal.woff2").toString("base64") + ') format("woff2")}').join("");
const logo = "data:image/png;base64," + fs.readFileSync("static/assets/logo.png").toString("base64");
function readTree(dir, base = dir, out = {}) {
  for (const n of fs.readdirSync(dir)) {
    const f = dir + "/" + n;
    if (fs.statSync(f).isDirectory()) readTree(f, base, out); else out[f.slice(base.length + 1)] = fs.readFileSync(f, "utf8");
  }
  return out;
}
const safe = (s) => s.replace(/<\/script/gi, "<\\/script");
const data = "window.__DEMO_AEP=" + JSON.stringify(fs.readFileSync("demo/sample.aep").toString("base64")) +
  ";window.__HOST_FILES=" + JSON.stringify({
    "text-qc.jsx": fs.readFileSync("static/jsx/text-qc.jsx", "utf8"),
    "harsh-library.jsx": fs.readFileSync("static/jsx/harsh-library.jsx", "utf8"),
    "gap-qc.jsx": fs.readFileSync("static/jsx/gap-qc.jsx", "utf8"),
    "comp-vault.jsx": fs.readFileSync("static/jsx/comp-vault.jsx", "utf8"),
    "client-sound-kit.jsx": fs.readFileSync("static/jsx/client-sound-kit.jsx", "utf8"),
  }) + ";window.__LIBRARY=" + JSON.stringify(readTree("demo/library")) + ";";

const panel =
  "<style>" + fonts + scoped + "</style>\n" +
  "<script>" + safe(poly) + "</script>\n" +
  "<script>" + safe(data) + "</script>\n" +
  "<script>" + safe(fs.readFileSync("demo/demo-mocks.js", "utf8")) + "</script>\n" +
  "<script>" + safe(js.replace(/\.\.\/assets\/logo\.png/g, () => logo)) + "</script>\n";

fs.mkdirSync("demo/dist", { recursive: true });
fs.writeFileSync("demo/dist/harsh-demo.html", fs.readFileSync("demo/page.html", "utf8").replace("<!--PANEL-->", () => panel));
console.log("demo/dist/harsh-demo.html", Math.round(fs.statSync("demo/dist/harsh-demo.html").size / 1024) + " KB");
