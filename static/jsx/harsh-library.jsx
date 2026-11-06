// Harsh - Library commands inside Premiere Pro / After Effects.
// ES3, ASCII only. Called as $.HarshLibrary.call("name", {args}) -> JSON string.
(function () {
    var api = {};
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
                if (ch === '"') out += '\\"'; else if (ch === "\\") out += "\\\\";
                else if (c < 32 || c > 126) out += "\\u" + hex4(c); else out += ch;
            }
            return out + '"';
        }
        if (v instanceof Array) { var a = []; for (var j = 0; j < v.length; j++) a.push(ser(v[j])); return "[" + a.join(",") + "]"; }
        var parts = [];
        for (var k in v) if (v.hasOwnProperty(k)) parts.push(ser(k) + ":" + ser(v[k]));
        return "{" + parts.join(",") + "}";
    }
    function isAE() { return typeof CompItem !== "undefined"; }

    // ---------------------------------------------------------------- import
    // a.paths: files; a.bin: "Harsh / Brightline" style bin path (created if missing)
    api.importFiles = function (a) {
        if (!app.project) throw new Error("Open a project first.");
        var names = String(a.bin || "Frameshift").split(" / ");
        var done = 0, failed = [];
        if (isAE()) {
            var parent = app.project.rootFolder;
            for (var n = 0; n < names.length; n++) {
                var found = null;
                for (var i = 1; i <= parent.numItems; i++) {
                    if (parent.item(i) instanceof FolderItem && parent.item(i).name === names[n]) { found = parent.item(i); break; }
                }
                parent = found || lastFolder(names[n], parent);
            }
            app.beginUndoGroup("Frameshift import");
            try {
                for (var p = 0; p < a.paths.length; p++) {
                    try {
                        var io = new ImportOptions(new File(a.paths[p]));
                        var item = app.project.importFile(io);
                        item.parentFolder = parent;
                        done++;
                    } catch (e) { failed.push(String(a.paths[p]).split(/[\\\/]/).pop()); }
                }
            } finally { app.endUndoGroup(); }
        } else {
            var bin = app.project.rootItem;
            for (var b = 0; b < names.length; b++) {
                var hit = null;
                for (var c = 0; c < bin.children.numItems; c++) {
                    if (bin.children[c].type === 2 && bin.children[c].name === names[b]) { hit = bin.children[c]; break; }
                }
                bin = hit || bin.createBin(names[b]);
            }
            var ok = app.project.importFiles(a.paths, true, bin, false);
            if (ok === false) throw new Error("Premiere couldn\u2019t import those files.");
            done = a.paths.length;
        }
        return { imported: done, failed: failed };
    };
    // AE: addFolder always adds at the root; move it under the parent we want.
    function lastFolder(name, parent) {
        var f = app.project.items.addFolder(name);
        f.parentFolder = parent;
        return f;
    }

    // Premiere: put a motion graphics template at the playhead on the lowest free-looking track.
    api.placeMogrt = function (a) {
        if (isAE()) throw new Error("Templates are placed from Premiere Pro.");
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("Open a sequence in the timeline first.");
        var t = seq.getPlayerPosition().ticks;
        var track = Math.max(0, seq.videoTracks.numTracks - 1);
        var clip = seq.importMGT(a.path, t, track, Math.max(0, seq.audioTracks.numTracks - 1));
        if (!clip) throw new Error("Premiere couldn\u2019t place that template.");
        return { track: track + 1 };
    };

    // Show a folder (or a file's folder) in Finder / Explorer.
    api.openFolder = function (a) {
        var f = new Folder(a.path);
        if (!f.exists) f = new File(a.path).parent;
        if (!f || !f.exists) throw new Error("That folder doesn't exist any more.");
        f.execute();
        return true;
    };

    // ------------------------------------------------------------- colours
    // After Effects: set the fill colour of the selected text and shape layers.
    api.applyColor = function (a) {
        if (!isAE()) throw new Error("Colours can be applied in After Effects only.");
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) throw new Error("Open a comp and select the layers to colour.");
        var layers = comp.selectedLayers;
        if (!layers.length) throw new Error("Select one or more text or shape layers first.");
        var rgb = [a.rgb[0] / 255, a.rgb[1] / 255, a.rgb[2] / 255];
        var count = 0;
        function fills(group) {
            for (var i = 1; i <= group.numProperties; i++) {
                var p = group.property(i);
                if (p.matchName === "ADBE Vector Graphic - Fill") {
                    var col = p.property("ADBE Vector Fill Color");
                    if (col.numKeys === 0) { col.setValue(rgb); count++; }
                } else if (p.numProperties && p.numProperties > 0) fills(p);
            }
        }
        app.beginUndoGroup("Frameshift brand colour");
        try {
            for (var l = 0; l < layers.length; l++) {
                var layer = layers[l];
                if (layer instanceof TextLayer) {
                    var st = layer.property("ADBE Text Properties").property("ADBE Text Document");
                    if (st.numKeys === 0 && !(st.expressionEnabled && st.expression)) {
                        var td = st.value; td.applyFill = true; td.fillColor = rgb; st.setValue(td); count++;
                    }
                } else if (layer.matchName === "ADBE Vector Layer") {
                    fills(layer.property("ADBE Root Vectors Group"));
                }
            }
        } finally { app.endUndoGroup(); }
        if (!count) throw new Error("Nothing changed. Select text or shape layers without keyframed colour.");
        return { changed: count };
    };

    $.HarshLibrary = {
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
