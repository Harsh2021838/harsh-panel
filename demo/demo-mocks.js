/* Demo only: pretends to be Premiere Pro / After Effects and the spelling server,
 * so the real panel code can run in a web page. Loaded before the panel bundle. */
(function () {
  var HOST = /after-effects/.test(location.hash) ? "AEFT" : "PPRO";
  try { if (!localStorage.getItem("harsh.client")) localStorage.setItem("harsh.client", "Brightline"); } catch (e) {}
  var B = window.__NodeBuffer;
  var log = function (m) { if (window.__demoLog) window.__demoLog(m); };

  // ---------------------------------------------------------------- files
  var mem = {};
  mem["/Users/harsh/Projects/Brightline/Brightline_GFX.aep"] = B.from(window.__DEMO_AEP, "base64");
  mem["/Users/harsh/Projects/Brightline/Captions_EN.srt"] =
    "1\n00:00:01,200 --> 00:00:03,400\nManaging money shouldn't be hard.\n\n" +
    "2\n00:00:03,600 --> 00:00:06,000\nWith Brightline, every bill is tracked  automatically.\n\n" +
    "3\n00:00:06,200 --> 00:00:08,500\nGet a alert before you overspend.\n\n" +
    "4\n00:00:08,700 --> 00:00:11,000\nJoin 50,000 people saving every month.\n\n" +
    "5\n00:00:11,200 --> 00:00:13,000\nDownload Brightline todya.\n";
  mem["/Users/harsh/Exports/Reel_captions.srt"] =
    "1\n00:00:00,500 --> 00:00:02,000\nYour money, sorted.\n\n2\n00:00:02,200 --> 00:00:04,000\nTry it free for 30 dyas.\n";
  // A small in-memory file system with folders, holding the sample Harsh Library.
  var dirs = {};
  function addDir(d) { while (d && d !== "/" && !dirs[d]) { dirs[d] = 1; d = d.replace(/\/[^\/]*$/, "") || "/"; } }
  var LIB = "/Users/harsh/Documents/Harsh Library";
  Object.keys(window.__LIBRARY || {}).forEach(function (rel) { mem[LIB + "/" + rel] = window.__LIBRARY[rel]; });
  Object.keys(mem).forEach(function (f) { addDir(f.replace(/\/[^\/]*$/, "")); });
  addDir(LIB + "/Clients/Northpeak Studio/Assets");
  function children(d) {
    var out = {}, pre = d.replace(/\/$/, "") + "/";
    Object.keys(mem).concat(Object.keys(dirs)).forEach(function (k) { if (k.indexOf(pre) === 0) out[k.slice(pre.length).split("/")[0]] = 1; });
    return Object.keys(out);
  }
  var fs = {
    existsSync: function (p) { return p in mem || !!dirs[p] || /AE_TextQC$/.test(p); },
    mkdirSync: function (p) { addDir(p); },
    rmdirSync: function (p) { delete dirs[p]; },
    readFileSync: function (p, enc) { if (!(p in mem)) throw new Error("ENOENT " + p); var v = mem[p]; return enc && typeof v !== "string" ? v.toString(enc) : v; },
    writeFileSync: function (p, d) { mem[p] = String(d); addDir(p.replace(/\/[^\/]*$/, "")); },
    appendFileSync: function (p, d) { mem[p] = (mem[p] || "") + String(d); addDir(p.replace(/\/[^\/]*$/, "")); },
    copyFileSync: function (a, b) { mem[b] = mem[a] !== undefined ? mem[a] : "x"; addDir(b.replace(/\/[^\/]*$/, "")); },
    renameSync: function (a, b) {
      Object.keys(mem).forEach(function (k) { if (k === a || k.indexOf(a + "/") === 0) { mem[b + k.slice(a.length)] = mem[k]; delete mem[k]; } });
      Object.keys(dirs).forEach(function (k) { if (k === a || k.indexOf(a + "/") === 0) { delete dirs[k]; } });
      addDir(b.replace(/\/[^\/]*$/, ""));
    },
    statSync: function (p) { var d = !!dirs[p]; return { isDirectory: function () { return d; }, size: d ? 0 : String(mem[p] || "").length, mtimeMs: 0 }; },
    readdirSync: function (d, o) {
      if (o && o.withFileTypes && /Projects$/.test(d)) return ["Brightline_GFX.aep", "Brightline_GFX_v2.aep"].map(function (n) { return { name: n, isDirectory: function () { return false; } }; });
      if (o && o.withFileTypes) return children(d).map(function (n) { var full = d.replace(/\/$/, "") + "/" + n; return { name: n, isDirectory: function () { return !!dirs[full]; }, isFile: function () { return !dirs[full]; } }; });
      return children(d);
    },
    lstatSync: function (p) { return fs.statSync(p); },
    rmSync: function (p) { Object.keys(mem).forEach(function (k) { if (k === p || k.indexOf(p + "/") === 0) delete mem[k]; }); Object.keys(dirs).forEach(function (k) { if (k === p || k.indexOf(p + "/") === 0) delete dirs[k]; }); },
    unlinkSync: function (p) { delete mem[p]; }
  };
  window.__demoFs = fs; window.__demoMem = mem; // lets tests add files
  // Show sample SVGs as images.
  window.__fileUrl = function (p) { var v = mem[p]; return typeof v === "string" && /^<svg/.test(v) ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(v) : ""; };
  mem["/Users/harsh/Projects/Brightline_GFX_v2.aep"] = mem["/Users/harsh/Projects/Brightline/Brightline_GFX.aep"];
  var path = {
    join: function () { return Array.prototype.join.call(arguments, "/").replace(/\/+/g, "/"); },
    basename: function (p, ext) { var b = String(p).split(/[\\/]/).pop(); return ext && b.slice(-ext.length) === ext ? b.slice(0, -ext.length) : b; },
    dirname: function (p) { return String(p).replace(/\/[^\/]*$/, "") || "/"; },
    extname: function (p) { var m = /\.[^.\/]*$/.exec(String(p)); return m ? m[0] : ""; },
    resolve: function (p) { return String(p).replace(/\/+$/, ""); },
    sep: "/"
  };

  // --------------------------------------------------- fake spelling server
  var known = {};
  ("a be been at as about all alert alerts instant an and app are automatically available before bill bills brightline's by card cards day days do download " +
   "end every for free from get hard head here in instant introducing is it join just learn managing minutes money month more " +
   "new now of on only or our overspend people product save saving saves shouldn't sign smarter sorted spend start the this " +
   "to today track tracked try up with you your ios android tag button cta product 50,000 30 more meet team marketing lead " +
   "receive alerts track every bill spend smarter money sorted plans faster better").split(" ").forEach(function (w) { known[w] = 1; });
  var sugg = { andriod: ["Android"], recieve: ["receive"], prodcut: ["Product", "product"], evrey: ["every"], smater: ["smarter"],
    todya: ["today"], dyas: ["days"], downlod: ["Download", "download"], minuts: ["minutes"] };
  function check(text) {
    var out = [], m, re = /[A-Za-z']+/g;
    while ((m = re.exec(text))) {
      var w = m[0], lw = w.toLowerCase();
      if (known[lw] || /^\d/.test(w)) continue;
      out.push({ offset: m.index, length: w.length, message: "Possible spelling mistake found.",
        replacements: (sugg[lw] || []).map(function (v) { return { value: v }; }),
        rule: { id: "MORFOLOGIK_RULE_EN_US", category: { id: "TYPOS" } } });
    }
    var sp = / {2,}/g;
    while ((m = sp.exec(text))) out.push({ offset: m.index, length: m[0].length, message: "Two spaces in a row.", replacements: [{ value: " " }], rule: { id: "WHITESPACE_RULE", category: { id: "TYPOGRAPHY" } } });
    var an = /\ba (?=[aeiouAEIOU])/g;
    while ((m = an.exec(text))) out.push({ offset: m.index, length: 1, message: "Use “an” instead of “a” before a vowel sound.", replacements: [{ value: "an" }], rule: { id: "EN_A_VS_AN", category: { id: "MISC" } } });
    return out;
  }
  var https = { request: function (opts, cb) {
    var body = "";
    return { on: function () {}, setTimeout: function () {}, write: function (b) { body += b; }, end: function () {
      var text = new URLSearchParams(body).get("text");
      setTimeout(function () {
        var data = B.from(JSON.stringify({ matches: check(text) }));
        cb({ statusCode: 200, on: function (ev, f) { if (ev === "data") f(data); if (ev === "end") setTimeout(f, 0); } });
      }, 450);
    } };
  } };
  var os = { platform: function () { return "darwin"; }, homedir: function () { return "/Users/harsh"; }, tmpdir: function () { return "/tmp"; } };
  window.require = function (n) { return { fs: fs, path: path, https: https, http: https, os: os, buffer: { Buffer: B } }[n]; };

  // ------------------------------------------------------- CEP + dialogs
  window.cep = {
    fs: { showOpenDialogEx: function (multi, dir, title, init, types) {
      if (dir) return { data: ["/Users/harsh/Projects"] };
      if (types && types[0] === "aep") return { data: ["/Users/harsh/Projects/Brightline/Brightline_GFX.aep"] };
      return { data: ["/Users/harsh/Exports/Reel_captions.srt"] };
    } },
    util: { openURLInDefaultBrowser: function () { log("Opens the Harsh guide in your browser."); } }
  };
  window.__adobe_cep__ = {
    getHostEnvironment: function () { return JSON.stringify({ appName: HOST, appSkinInfo: { panelBackgroundColor: { color: { red: 35, green: 35, blue: 35 } } } }); },
    addEventListener: function () {},
    evalScript: function (code, cb) { setTimeout(function () { var r; try { r = (0, eval)(code); } catch (e) { r = "EvalScript error."; } cb(String(r)); }, 120); }
  };

  // ------------------------------------------------- ExtendScript world
  window.$ = { os: "Macintosh", evalFile: function (p) { (0, eval)(window.__HOST_FILES[String(p).split("/").pop()]); } };
  window.Folder = function (p) { this.fsName = p; this.exists = true; this.execute = function () { log("Opens \u201C" + String(p).replace(/^.*\/Documents\//, "") + "\u201D in Finder."); }; };
  window.Folder.myDocuments = { fsName: "/Users/harsh/Documents" };
  window.File = function (p) {
    this.fsName = p; this.name = String(p).split("/").pop(); this.exists = true;
    this.execute = function () {
      if (/\.html$/.test(p)) log("Report saved and opened in your browser: " + this.name);
      else if (/dictionary/.test(p)) log("Opens your dictionary file for editing.");
      else log("Opens " + this.name + ".");
    };
  };

  function tcAt(sec) {
    var f = Math.round(sec * 24), ff = f % 24, s = (f - ff) / 24, p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(Math.floor(s / 3600)) + ":" + p(Math.floor(s / 60) % 60) + ":" + p(s % 60) + ":" + p(ff);
  }

  if (HOST === "AEFT") {
    // -------------------------------------------------- After Effects
    function FolderItem(name, items) { this.name = name; this.items = items; this.id = Math.floor(Math.random() * 1e6); }
    FolderItem.prototype = { get numItems() { return this.items.length; }, item: function (i) { return this.items[i - 1]; } };
    function TextLayer(name, text, keys, inP, outP) { this.name = name; this._t = text; this.keys = keys; this.selected = false; this.enabled = true; this.inPoint = inP || 0; this.outPoint = outP === undefined ? 10 : outP; }
    TextLayer.prototype.property = function () {
      var L = this;
      return { property: function () { return {
        get numKeys() { return L.keys ? L.keys.length : 0; },
        keyValue: function (k) { return { text: L.keys[k - 1] }; }, keyTime: function (k) { return k * 2; },
        expressionEnabled: false, expression: "",
        get value() { return { text: L._t }; },
        setValue: function (td) { L._t = td.text; log("After Effects changed “" + L.name + "” to “" + td.text.replace(/\r/g, " ") + "”."); },
        setValueAtKey: function (k, td) { L.keys[k - 1] = td.text; log("After Effects changed keyframe " + k + " of “" + L.name + "” to “" + td.text + "”."); }
      }; } };
    };
    function CompItem(name, layers) { this.name = name; this.layers = layers; this.id = Math.floor(Math.random() * 1e6); this.time = 0; this.frameDuration = 1 / 24; this.duration = 10; }
    CompItem.prototype = { get numLayers() { return this.layers.length; }, layer: function (i) { return this.layers[i - 1]; },
      openInViewer: function () { var sel = this.layers.filter(function (l) { return l.selected; }); var c = this; setTimeout(function () {
        var s = c.layers.filter(function (l) { return l.selected; })[0];
        log("After Effects opened “" + c.name + "”" + (s ? " and selected “" + s.name + "”." : "."));
      }, 0); } };
    window.CameraLayer = function () {}; window.LightLayer = function () {}; window.CompItem = CompItem; window.FolderItem = FolderItem; window.TextLayer = TextLayer;
    var lower = function () { return new TextLayer("Lower third", "Priya Raman\rHead of Prodcut"); };
    var comps = [
      new CompItem("01_Intro", [new TextLayer("Title", "Introducing Brightline", null, 0, 9.875), new TextLayer("Subtitle", "Your money,​ sorted in minutes", null, 0, 9.875), new TextLayer("Lower third", "Priya Raman\rHead of Prodcut", null, 0, 9.875)]),
      new CompItem("02_Features", [new TextLayer("Feature 1", "Track evrey bill", null, 0, 4), new TextLayer("Feature 2", "Get a alert before you overspend", null, 4 + 2 / 24, 10), new TextLayer("Switch", "", ["Save more", "Spend smater"]), lower()]),
      new CompItem("03_End_Card", [new TextLayer("Stores", "Available on iOS  and Andriod"), new TextLayer("CTA", "Download now", null, 0, 10 - 3 / 24), lower()])
    ];
    var root = new FolderItem("root", [new FolderItem("Comps", comps), new FolderItem("Old imports", [new CompItem("v1_Title", [new TextLayer("x", "Recieve instant alerts")])])]);
    var all = [];
    (function walk(f) { f.items.forEach(function (i) { all.push(i); if (i instanceof FolderItem) walk(i); }); })(root);
    window.app = {
      project: { file: { name: "Brightline_GFX.aep", fsName: "/Users/harsh/Projects/Brightline/Brightline_GFX.aep" }, rootFolder: root,
        get numItems() { return all.length; }, item: function (i) { return all[i - 1]; }, selection: [comps[1]],
        itemByID: function (id) { return all.filter(function (x) { return x.id === id; })[0]; } },
      beginUndoGroup: function () {}, endUndoGroup: function () {},
      open: function (f) { log("After Effects opened " + f.name + "."); return true; }
    };
    window.ImportOptions = function (f) { this.file = f; };
    app.project.items = { addFolder: function (n) { var f = new FolderItem(n, []); return f; } };
    app.project.importFile = function (io) { log("After Effects imported \u201C" + io.file.name + "\u201D into the Harsh folder."); return {}; };
    app.project.activeItem = comps[0];
    comps[0].selectedLayers = [comps[0].layers[0]];
    TextLayer.prototype.matchName = "ADBE Text Layer";
    var td0 = TextLayer.prototype.property;
    TextLayer.prototype.property = function (n) {
      var L = this, inner = td0.call(this, n).property();
      Object.defineProperty(inner, "value", { get: function () { return { text: L._t }; } });
      inner.setValue = function (td) {
        if (td.fillColor) { var c = td.fillColor.map(function (v) { return ("0" + Math.round(v * 255).toString(16)).slice(-2); }).join("").toUpperCase(); log("After Effects set the colour of \u201C" + L.name + "\u201D in \u201C01_Intro\u201D to #" + c + "."); }
        else { L._t = td.text; log("After Effects changed \u201C" + L.name + "\u201D to \u201C" + td.text.replace(/\r/g, " ") + "\u201D."); }
      };
      return { property: function () { return inner; } };
    };
  } else {
    // ----------------------------------------------------- Premiere Pro
    window.Time = function () { this.ticks = "0"; };
    var arr = function (a) { a.numItems = a.length; return a; };
    function textComp(t) { return { matchName: "AE.ADBE Text", displayName: "Text", properties: arr([{ displayName: "Source Text", getValue: function () { return JSON.stringify({ textEditValue: t }); } }]) }; }
    function clip(name, at, comps, mgt, item, dur) {
      return { name: name, start: { ticks: String(Math.round(254016000000 * at)), seconds: at }, end: { ticks: String(Math.round(254016000000 * (at + (dur || 3)))) }, inPoint: { ticks: "0" }, outPoint: { ticks: String(Math.round(254016000000 * (dur || 3))) },
        components: arr([{ matchName: "AE.ADBE Motion", displayName: "Motion", properties: arr([]) }].concat(comps || [])),
        getMGTComponent: function () { return mgt ? { properties: arr(mgt.map(function (p) { return { displayName: p[0], getValue: function () { return p[1]; } }; })) } : null; },
        projectItem: item || { name: name, getMediaPath: function () { return ""; }, isSequence: function () { return false; } },
        setSelected: function () {} };
    }
    function seq(name, tracks) {
      var vt = arr(tracks.map(function (c) { return { clips: arr(c) }; })); vt.numTracks = vt.length;
      var at = arr([{ clips: arr(name === "Main Edit 16x9" ? [{ name: "Interview_A.mp4", start: { ticks: String(254016000000 * 2 / 24) }, end: { ticks: String(254016000000 * (20 + 2 / 24)) }, inPoint: { ticks: "0" }, projectItem: itemA, setSelected: function () {} }] : []) }, { clips: arr([]) }]); at.numTracks = 2;
      return { name: name, sequenceID: name + "-id", timebase: "10584000000", videoTracks: vt, end: String(254016000000 * 41.5),
        projectItem: { nodeId: name + "-node" }, getSelection: function () { return []; }, markers: { createMarker: function (t) { var m = { setColorByIndex: function () {} }; setTimeout(function () { log("Premiere added a marker at " + tcAt(t) + ": " + m.name); }, 0); return m; } },
        audioTracks: at, getPlayerPosition: function () { return { ticks: String(254016000000 * 12) }; },
        importMGT: function (p, t, v) { log("Premiere placed \u201C" + p.split("/").pop() + "\u201D at the playhead (00:00:12:00) on V" + (v + 1) + "."); return {}; },
        setPlayerPosition: function (t) { log("Premiere moved the playhead to " + tcAt(Number(t) / 254016000000) + " in “" + name + "” and selected the clip."); } };
    }
    var aep = { name: "End Tag/Brightline_GFX.aep", getMediaPath: function () { return "/Users/harsh/Projects/Brightline/Brightline_GFX.aep"; }, isSequence: function () { return false; } };
    var ghost = { type: 1, name: "Old Title Card/Brightline_GFX.aep", nodeId: "ghost-1", treePath: "\\Brightline_Launch_v4.prproj\\AE Comps\\Old Title Card/Brightline_GFX.aep",
      getMediaPath: function () { return "/Users/harsh/Projects/Brightline/Brightline_GFX.aep"; }, isSequence: function () { return false; },
      select: function () { log("Premiere selected \u201COld Title Card\u201D in the AE Comps bin of the Project panel."); } };
    var itemA = { name: "Interview_A.mp4", nodeId: "ia-1", getMediaPath: function () { return "/Footage/Interview_A.mp4"; }, isSequence: function () { return false; } };
    var drone = { name: "Drone_01.mp4", nodeId: "dr-1", getMediaPath: function () { return "/Footage/Drone_01.mp4"; }, isSequence: function () { return false; },
      getFootageInterpretation: function () { return { frameRate: 29.97 }; } };
    var blackItem = { name: "Black Video", nodeId: "bv-1", getMediaPath: function () { return ""; }, isSequence: function () { return false; } };
    var unlinked = { type: 1, name: "Intro Comp/Brightline_GFX.aep", nodeId: "unl-1", treePath: "\\Brightline_Launch_v4.prproj\\AE Comps\\Intro Comp/Brightline_GFX.aep",
      getMediaPath: function () { return ""; }, isSequence: function () { return false; }, isOffline: function () { return true; }, select: function () {} };
    var seqs = arr([
      seq("Main Edit 16x9", [
        [clip("Interview_A.mp4", 0, null, null, itemA, 20), clip("Interview_B.mp4", 20 + 3 / 24, null, null, null, 21.375)],
        [clip("Graphic", 2, [textComp("Introducing the new Brightline app")]), clip("Graphic", 9.5, [textComp("Your money,​ sorted in minutes")]),
         clip("Lower Third", 15, [], [["Name", "Priya Raman"], ["Title", "Head of Prodcut"], ["Opacity", 100]]),
         clip("B-roll_Phone.mp4", 20 + 1 / 24, null, null, null, 1.9), clip("Black Video", 30, null, null, blackItem, 0.5), clip("Drone_01.mp4", 25, null, null, drone, 2), clip("Intro Comp", 27, [], null, unlinked, 1.5), clip("Flash_Cut.mp4", 33, null, null, null, 2 / 24),
         clip("Drone_01.mp4", 35 + 0.3 / 24, null, null, drone, 2)],
        [clip("Graphic", 22, [textComp("Recieve instant alerts")], null, null, 9 - 2 / 24), clip("End Tag", 38.5, [], null, aep), clip("Old Title Card", 31, [], null, ghost, 7.5 - 1 / 24)]
      ]),
      seq("Reel 9x16", [
        [clip("Graphic", 1, [textComp("Available now on iOS and Andriod")]), clip("Lower Third", 6, [], [["Name", "Priya Raman"], ["Title", "Head of Prodcut"]])],
        [clip("End Tag", 27, [], null, aep)]
      ])
    ]);
    seqs.numSequences = seqs.length;
    window.app = { project: { name: "Brightline_Launch_v4.prproj", path: "/Users/harsh/Projects/Brightline/Brightline_Launch_v4.prproj",
      sequences: seqs, activeSequence: seqs[0],
      rootItem: { children: arr([{ type: 2, name: "AE Comps", children: arr([ghost]) }, { type: 1, name: "Captions_EN.srt", getMediaPath: function () { return "/Users/harsh/Projects/Brightline/Captions_EN.srt"; } }]),
        createBin: function (n) { var b = { type: 2, name: n, children: arr([]), createBin: function (m) { return { type: 2, name: n + " / " + m, children: arr([]), createBin: this.createBin }; } }; return b; } },
      importFiles: function (paths, x, bin) { log("Premiere imported " + paths.map(function (q) { return q.split("/").pop(); }).join(", ") + " into the \u201C" + bin.name + "\u201D bin."); return true; },
      openSequence: function (id) { var t = seqs.filter(function (q) { return q.sequenceID === id; })[0]; if (t) window.app.project.activeSequence = t; } } };
  }
})();
