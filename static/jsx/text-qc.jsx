// Frameshift - Text QC, host side (After Effects + Premiere Pro).
// ExtendScript is ES3: plain loops, no Array helpers. Keep this file ASCII.
// The panel calls: $.HarshTextQC.call("name", {args}) and gets a JSON string.
(function () {
    var api = {};

    // ------------------------------------------------------------ helpers
    function hex4(n) { var h = n.toString(16); while (h.length < 4) h = "0" + h; return h; }
    function ser(v) {
        if (v === null || v === undefined) return "null";
        var t = typeof v;
        if (t === "number") return isFinite(v) ? String(v) : "null";
        if (t === "boolean") return v ? "true" : "false";
        if (t === "string") {
            var out = '"';
            for (var i = 0; i < v.length; i++) {
                var c = v.charCodeAt(i), ch = v.charAt(i);
                if (ch === '"') out += '\\"';
                else if (ch === "\\") out += "\\\\";
                else if (c < 32 || c > 126) out += "\\u" + hex4(c);
                else out += ch;
            }
            return out + '"';
        }
        if (v instanceof Array) {
            var a = [];
            for (var j = 0; j < v.length; j++) a.push(ser(v[j]));
            return "[" + a.join(",") + "]";
        }
        var parts = [];
        for (var k in v) if (v.hasOwnProperty(k)) parts.push(ser(k) + ":" + ser(v[k]));
        return "{" + parts.join(",") + "}";
    }
    // Decode a JSON string body (the part between quotes).
    function unescapeJson(s) {
        return s.replace(/\\(u[0-9a-fA-F]{4}|["\\\/bfnrt])/g, function (m, g) {
            if (g.charAt(0) === "u") return String.fromCharCode(parseInt(g.substr(1), 16));
            var map = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
            return map[g];
        });
    }
    function isAE() { return typeof CompItem !== "undefined"; }

    api.info = function () {
        var docs = Folder.myDocuments.fsName;
        var proj = "";
        try {
            if (isAE()) proj = app.project && app.project.file ? app.project.file.name : "(unsaved project)";
            else proj = app.project ? app.project.name : "";
        } catch (e) {}
        return { host: isAE() ? "AEFT" : "PPRO", documents: docs, project: proj, os: $.os };
    };

    // Open a file/folder with the system default app (dictionary, reports).
    api.openPath = function (a) {
        var f = new File(a.path);
        if (f.exists) { f.execute(); return true; }
        var d = new Folder(a.path);
        if (d.exists) { d.execute(); return true; }
        return false;
    };

    // ================================================================ AE
    function textProp(layer) {
        try {
            return layer.property("ADBE Text Properties").property("ADBE Text Document");
        } catch (e) { return null; }
    }

    function pushLayerTexts(out, comp, layer, j, projectName, projectPath) {
        var st = textProp(layer);
        if (!st) return;
        var base = {
            project: projectName, projectPath: projectPath,
            container: comp.name, containerId: comp.id,
            layer: layer.name, layerIndex: j, keyIndex: 0
        };
        function add(text, keyIndex, time) {
            if (!text || !/\S/.test(text)) return;
            var o = {};
            for (var k in base) o[k] = base[k];
            o.text = text; o.keyIndex = keyIndex;
            if (time !== undefined) o.time = time;
            o.key = comp.id + ":" + j + ":" + keyIndex;
            out.push(o);
        }
        try {
            if (st.numKeys > 0) {
                for (var k = 1; k <= st.numKeys; k++) add(st.keyValue(k).text, k, st.keyTime(k));
            } else {
                add(st.value.text, 0);
            }
        } catch (e) {}
    }

    function aeCollectComps(comps) {
        var out = [];
        var projectName = app.project.file ? app.project.file.name : "(unsaved project)";
        var projectPath = app.project.file ? app.project.file.fsName : "";
        for (var i = 0; i < comps.length; i++) {
            var comp = comps[i];
            for (var j = 1; j <= comp.numLayers; j++) {
                var layer = comp.layer(j);
                if (layer instanceof TextLayer) pushLayerTexts(out, comp, layer, j, projectName, projectPath);
            }
        }
        return { project: projectName, projectPath: projectPath, comps: comps.length, items: out };
    }

    function compsIn(folder, out) {
        for (var i = 1; i <= folder.numItems; i++) {
            var it = folder.item(i);
            if (it instanceof CompItem) out.push(it);
            else if (it instanceof FolderItem) compsIn(it, out);
        }
        return out;
    }

    // Top-level project folders, for the "Pick folders" scope.
    api.aeListFolders = function () {
        var res = [];
        var root = app.project.rootFolder;
        var rootComps = 0;
        for (var i = 1; i <= root.numItems; i++) {
            var it = root.item(i);
            if (it instanceof CompItem) rootComps++;
            else if (it instanceof FolderItem) {
                var n = compsIn(it, []).length;
                if (!n) continue;
                var l = it.name.toLowerCase();
                var skip = /import|old|asset|ref|backup|archive/.test(l);
                res.push({ id: it.id, name: it.name, comps: n, checked: !skip });
            }
        }
        if (rootComps) res.unshift({ id: 0, name: "[Root level]", comps: rootComps, checked: true });
        return res;
    };

    // a.mode: "all" | "selected" | "folders"; a.folderIds for "folders"
    api.aeCollect = function (a) {
        if (!app.project) throw new Error("No project open.");
        var comps = [];
        var i;
        if (a.mode === "selected") {
            var sel = app.project.selection;
            for (i = 0; i < sel.length; i++) if (sel[i] instanceof CompItem) comps.push(sel[i]);
            if (!comps.length) throw new Error("Select one or more comps in the Project panel first.");
        } else if (a.mode === "folders") {
            var seen = {};
            var want = {};
            for (i = 0; i < a.folderIds.length; i++) want[a.folderIds[i]] = true;
            var root = app.project.rootFolder;
            for (i = 1; i <= root.numItems; i++) {
                var it = root.item(i);
                var list = null;
                if (it instanceof CompItem && want[0]) list = [it];
                else if (it instanceof FolderItem && want[it.id]) list = compsIn(it, []);
                if (!list) continue;
                for (var j = 0; j < list.length; j++) {
                    if (!seen[list[j].id]) { seen[list[j].id] = true; comps.push(list[j]); }
                }
            }
        } else {
            for (i = 1; i <= app.project.numItems; i++) {
                if (app.project.item(i) instanceof CompItem) comps.push(app.project.item(i));
            }
        }
        return aeCollectComps(comps);
    };

    // Batch mode: open a .aep (AE asks to save the current one if needed) and read all comps.
    api.aeOpenAndCollect = function (a) {
        var f = new File(a.path);
        if (!f.exists) throw new Error("File not found: " + a.path);
        var cur = app.project && app.project.file ? app.project.file.fsName : "";
        if (cur !== f.fsName) {
            var p = app.open(f);
            if (!p) throw new Error("Could not open (cancelled?): " + f.name);
        }
        return api.aeCollect({ mode: "all" });
    };

    function ensureProject(path) {
        if (!path) return;
        var cur = app.project && app.project.file ? app.project.file.fsName : "";
        if (cur !== new File(path).fsName) app.open(new File(path));
    }
    function compById(id) {
        try { var c = app.project.itemByID(id); if (c) return c; } catch (e) {}
        for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).id === id) return app.project.item(i);
        return null;
    }

    api.aeJump = function (a) {
        ensureProject(a.projectPath);
        var comp = compById(a.containerId);
        if (!comp) throw new Error("Comp not found. Was it deleted or renamed?");
        comp.openInViewer();
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        var layer = comp.layer(a.layerIndex);
        layer.selected = true;
        var st = textProp(layer);
        if (a.keyIndex && st && st.numKeys >= a.keyIndex) comp.time = st.keyTime(a.keyIndex);
        else if (layer.inPoint > comp.time || layer.outPoint < comp.time) comp.time = layer.inPoint;
        return true;
    };

    // Replace one flagged word with a suggestion. One undo step.
    api.aeFix = function (a) {
        ensureProject(a.projectPath);
        var comp = compById(a.containerId);
        if (!comp) throw new Error("Comp not found.");
        var layer = comp.layer(a.layerIndex);
        var st = textProp(layer);
        if (!st) throw new Error("Layer is no longer a text layer.");
        if (st.expressionEnabled && st.expression) throw new Error("This text comes from an expression. Fix it in the expression.");
        var td = a.keyIndex ? st.keyValue(a.keyIndex) : st.value;
        var t = td.text;
        if (t.substr(a.offset, a.length) !== a.expected) throw new Error("The text changed since the scan. Run the check again.");
        app.beginUndoGroup("Frameshift Text QC fix");
        try {
            td.text = t.substr(0, a.offset) + a.replacement + t.substr(a.offset + a.length);
            if (a.keyIndex) st.setValueAtKey(a.keyIndex, td);
            else st.setValue(td);
        } finally { app.endUndoGroup(); }
        return { text: td.text };
    };

    // ========================================================== PREMIERE
    // Text in Premiere lives in Essential Graphics: native "Text" components
    // (Source Text value is a JSON string with "textEditValue") and MOGRT
    // parameters. Caption tracks and legacy titles are not reachable from scripts.
    function textFromValue(v, allowPlain) {
        if (typeof v !== "string" || !v) return null;
        if (v.indexOf("textEditValue") !== -1) {
            var m = v.match(/"textEditValue"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (m) return unescapeJson(m[1]);
            return null;
        }
        if (allowPlain && !/^\s*[\[{]/.test(v) && /[A-Za-z\u00C0-\uFFFF]/.test(v) && !/^[\d.,\s-]+$/.test(v)) return v;
        return null;
    }

    var SKIP_COMPONENTS = { "AE.ADBE Motion": 1, "AE.ADBE Opacity": 1, "AE.ADBE Time Remapping": 1 };
    function looksLikeText(comp) {
        var s = (comp.matchName || "") + " " + (comp.displayName || "");
        return /text|graphic|title|capsule/i.test(s);
    }

    function clipTexts(clip, deep) {
        var out = [];
        var seen = {};
        function add(label, text, kind) {
            if (!text || !/\S/.test(text) || seen[label + "|" + text]) return;
            seen[label + "|" + text] = true;
            out.push({ label: label, text: text, kind: kind });
        }
        var c, p, comp, prop;
        try {
            for (c = 0; c < clip.components.numItems; c++) {
                comp = clip.components[c];
                if (SKIP_COMPONENTS[comp.matchName]) continue;
                if (!deep && !looksLikeText(comp)) continue;
                for (p = 0; p < comp.properties.numItems; p++) {
                    prop = comp.properties[p];
                    try { add(comp.displayName, textFromValue(prop.getValue(), false), "title"); } catch (e1) {}
                }
            }
        } catch (e) {}
        try {
            var mgt = clip.getMGTComponent ? clip.getMGTComponent() : null;
            if (mgt) {
                for (p = 0; p < mgt.properties.numItems; p++) {
                    prop = mgt.properties[p];
                    try { add(prop.displayName, textFromValue(prop.getValue(), true), "mogrt"); } catch (e2) {}
                }
            }
        } catch (e3) {}
        return out;
    }

    // Step log: each step is written to disk (open, write, close) before it runs, so if the app
    // crashes the panel can see where. Path comes from the panel (Tools/Text QC/last-check.log).
    var LOG = "";
    function step(name) {
        if (!LOG) return;
        try { var f = new File(LOG); f.encoding = "UTF-8"; f.open("a"); f.writeln(name); f.close(); } catch (e) {}
    }

    function mediaPath(pi) {
        try { return pi && pi.getMediaPath ? String(pi.getMediaPath() || "") : ""; } catch (e) { return ""; }
    }

    // Caption files (.srt / .vtt) imported anywhere in the project.
    function captionFiles(item, out, depth) {
        if (!item || depth > 30) return out;
        try {
            for (var i = 0; i < item.children.numItems; i++) {
                var ch = item.children[i];
                if (ch.type === 2) captionFiles(ch, out, depth + 1); // bin
                else {
                    var mp = mediaPath(ch);
                    if (/\.(srt|vtt)$/i.test(mp)) out.push({ path: mp, name: ch.name });
                }
            }
        } catch (e) {}
        return out;
    }

    // Everything on screen in Premiere:
    //   items      - Essential Graphics titles and MOGRT text fields
    //   aeClips    - After Effects comps placed with Dynamic Link (the panel reads their .aep)
    //   captions   - caption files imported into the project
    // a.mode: "all" | "active"; a.deep: check every effect, not just graphics
    api.prCollect = function (a) {
        LOG = a.logPath || "";
        step("start");
        if (!app.project) throw new Error("No project open.");
        var all = [];
        for (var s = 0; s < app.project.sequences.numSequences; s++) all.push(app.project.sequences[s]);
        var byItem = {};
        for (s = 0; s < all.length; s++) {
            try { byItem[all[s].projectItem.nodeId] = all[s]; } catch (e) {}
        }
        var seqs;
        if (a.mode === "active") {
            if (!app.project.activeSequence) throw new Error("Open a sequence in the timeline first.");
            seqs = [app.project.activeSequence];
        } else seqs = all;

        var items = [], aeClips = [], fps = {}, done = {};
        var projectName = app.project.name, projectPath = app.project.path;

        function scan(seq, via, depth) {
            if (done[seq.sequenceID] || depth > 10) return;
            done[seq.sequenceID] = true;
            try { fps[seq.sequenceID] = 254016000000 / Number(seq.timebase); } catch (e) {}
            var vts = seq.videoTracks, nv = vts.numTracks;
            for (var t = 0; t < nv; t++) {
                step("read " + seq.name + " V" + (t + 1));
                // read the collection once: asking for track.clips in the loop builds a new one every time
                var clipsCol = vts[t].clips, nc = clipsCol.numItems;
                for (var c = 0; c < nc; c++) {
                    var clip = clipsCol[c];
                    if (!clip) continue;
                    var base = {
                        project: projectName, projectPath: projectPath,
                        container: seq.name, containerId: seq.sequenceID, via: via,
                        track: t, clipIndex: c, clipName: clip.name,
                        startTicks: String(clip.start.ticks), time: clip.start.seconds
                    };
                    var pi = null;
                    try { pi = clip.projectItem; } catch (e0) {}
                    var mp = mediaPath(pi);
                    // An After Effects clip: linked (media is an .aep) or unlinked (named "Comp/x.aep"
                    // but offline), so a broken link is reported instead of silently skipped.
                    // (No isOffline() here: on a Dynamic Link clip it makes Premiere query After Effects'
                    // link server, and that is the prime suspect for crashes while reading.)
                    var aeName = false;
                    try { aeName = /\.aep(\s|$)/i.test(String(pi ? pi.name : clip.name)); } catch (en) {}
                    if (/\.aep$/i.test(mp) || aeName) {
                        var ae = {};
                        for (var k in base) ae[k] = base[k];
                        ae.aepPath = mp; ae.itemName = pi ? pi.name : clip.name;
                        ae.offline = !/\.aep$/i.test(mp); // named like an AE comp but its media isn't an .aep: unlinked
                        try { ae.binPath = String(pi.treePath || ""); ae.nodeId = String(pi.nodeId || ""); } catch (eb) {}
                        ae.key = seq.sequenceID + ":" + t + ":" + c;
                        aeClips.push(ae);
                        continue;
                    }
                    // A nested sequence: when checking only the open sequence, look inside it too.
                    if (a.mode === "active" && pi) {
                        var nested = null;
                        try { if (pi.isSequence && pi.isSequence()) nested = byItem[pi.nodeId]; } catch (e1) {}
                        if (nested) { scan(nested, seq.name, depth + 1); continue; }
                    }
                    var texts = clipTexts(clip, a.deep);
                    for (var n = 0; n < texts.length; n++) {
                        var it = {};
                        for (var k2 in base) it[k2] = base[k2];
                        it.key = seq.sequenceID + ":" + t + ":" + c + ":" + n;
                        it.kind = texts[n].kind;
                        it.layer = clip.name + (texts[n].label && texts.length > 1 ? " / " + texts[n].label : "");
                        it.text = texts[n].text;
                        items.push(it);
                    }
                }
            }
        }
        for (var i = 0; i < seqs.length; i++) scan(seqs[i], "", 0);
        step("captions");
        var caps = captionFiles(app.project.rootItem, [], 0);
        step("done");
        return { project: projectName, projectPath: projectPath, comps: seqs.length, items: items, aeClips: aeClips,
            fps: fps, captions: caps };
    };

    // Select a project item in the Project panel (by nodeId) so it can be found by hand.
    api.prReveal = function (a) {
        function find(bin, depth) {
            if (!bin || !bin.children || depth > 30) return null;
            for (var i = 0; i < bin.children.numItems; i++) {
                var it = bin.children[i];
                if (String(it.nodeId) === String(a.nodeId)) return it;
                if (it.type === 2) { var r = find(it, depth + 1); if (r) return r; }
            }
            return null;
        }
        var item = find(app.project.rootItem, 0);
        if (!item) throw new Error("That clip is no longer in the project.");
        try { item.select(); } catch (e) { throw new Error("Premiere couldn't select it. Look in " + a.binPath); }
        return { ok: true };
    };

    // Go to a time in a sequence, in two separate steps, because opening a sequence and moving
    // its playhead in the same script call can crash Premiere (the sequence opens in the
    // background, so the playhead move hits a sequence that isn't ready yet):
    //   - the sequence is already the open one: move the playhead -> { moved: true }
    //   - it isn't, and a.open: only open it -> { opened: true }; the panel waits and calls again
    //   - it isn't, and not a.open (automatic jumps): do nothing -> { other: name }
    api.prJump = function (a) {
        var seq = app.project.activeSequence;
        if (seq && seq.sequenceID === a.containerId) {
            seq.setPlayerPosition(String(a.startTicks));
            return { moved: true };
        }
        var target = null;
        for (var s = 0; s < app.project.sequences.numSequences; s++) {
            if (app.project.sequences[s].sequenceID === a.containerId) { target = app.project.sequences[s]; break; }
        }
        if (!target) throw new Error("Sequence not found. Was it deleted?");
        if (!a.open) return { other: target.name };
        app.project.openSequence(target.sequenceID);
        return { opened: true, name: target.name };
    };

    // ---------------------------------------------------------- dispatcher
    $.HarshTextQC = {
        version: 1,
        call: function (name, arg) {
            try {
                if (!api[name]) throw new Error("Unknown command: " + name);
                return ser({ ok: true, data: api[name](arg || {}) });
            } catch (e) {
                return ser({ ok: false, error: String(e.message || e) + (e.line ? " (line " + e.line + ")" : "") });
            }
        }
    };
})();
