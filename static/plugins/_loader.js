/*
 * Harsh plugin loader: every .js file in this folder (except names starting
 * with "_") is loaded before the panel starts. A plugin adds a tool with:
 *
 *   Harsh.register({
 *     folder: "tools",                 // tools | assets | client-dna | qc
 *     hosts: ["AEFT", "PPRO"],         // apps it shows in (optional)
 *     tool: { id, name, description },
 *     create: function (React) { return MyComponent; }
 *   });
 */
(function () {
  var H = (window.Harsh = window.Harsh || {});
  H.plugins = [];
  H.register = function (p) { H.plugins.push(p); };
  H.require = typeof require === "function" ? require : (window.cep_node && window.cep_node.require) || null;
  var dir = decodeURIComponent(new URL("../plugins/", location.href).pathname);
  if (/^\/[A-Za-z]:/.test(dir)) dir = dir.slice(1);
  H.pluginDir = dir.replace(/\/$/, "");

  // Called by the panel while it builds the folder list.
  H.apply = function (folders, React) {
    H.plugins.forEach(function (p) {
      try {
        var folder = folders.filter(function (f) { return f.id === p.folder; })[0];
        if (!folder) return console.error("Frameshift plugin: unknown folder", p.folder);
        var tool = Object.assign({ hosts: p.hosts }, p.tool);
        tool.Component = p.create(React, H);
        folder.tools.push(tool);
      } catch (e) { console.error("Frameshift plugin failed:", p && p.tool && p.tool.id, e); }
    });
    return folders;
  };

  try {
    H.require("fs").readdirSync(H.pluginDir)
      // library.js was the "Harsh Library" plugin; it's built in now as Tools > Comp Vault.
      // Loading the old copy too would add a second tool and clash with Harsh's own scripts.
      .filter(function (n) { return /\.js$/i.test(n) && n.charAt(0) !== "_" && n.toLowerCase() !== "library.js"; })
      .sort()
      .forEach(function (n) { document.write('<script src="../plugins/' + encodeURIComponent(n) + '"><\/script>'); });
  } catch (e) { console.error("Frameshift: could not list plugins", e); }
})();
