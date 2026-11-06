// Frameshift - Comp Vault, host side (After Effects + Premiere Pro). Global: $.HarshCompVault.
// ExtendScript is ES3: plain loops, no Array helpers, no JSON object. Keep this file ASCII.
// The panel calls: $.HarshCompVault.call("name", {args}) and gets a JSON string back:
//   {"ok":true,"data":...}  or  {"ok":false,"error":"message for the editor"}
(function () {
    var api = {};
    var LIB_FOLDER = "Comp Vault";

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
    function fail(msg) { var e = new Error(msg); e.forEditor = true; throw e; }
    function isAE() { return typeof CompItem !== "undefined"; }
    function hexToRgb(hex) {
        var h = String(hex).replace("#", "");
        return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255];
    }
    function samePath(a, b) {
        var x = String(a).replace(/\\/g, "/"), y = String(b).replace(/\\/g, "/");
        if ($.os.indexOf("Windows") !== -1) { x = x.toLowerCase(); y = y.toLowerCase(); }
        return x === y;
    }
    function ensureFolder(p) { var f = new Folder(p); if (!f.exists) f.create(); return f; }

    // ------------------------------------------------------------ shared
    api.info = function () {
        if (!isAE()) {
            var seq = app.project ? app.project.activeSequence : null;
            return { host: "PPRO", project: app.project ? app.project.name : "", sequence: seq ? seq.name : "" };
        }
        var p = app.project, comp = p ? p.activeItem : null, out = { host: "AEFT" };
        out.projectSaved = !!(p && p.file);
        out.project = p && p.file ? p.file.name : "";
        if (comp && comp instanceof CompItem) {
            out.comp = { id: comp.id, name: comp.name, width: comp.width, height: comp.height, duration: comp.duration, fps: comp.frameRate };
            out.selectedLayers = comp.selectedLayers.length;
        } else {
            out.selectedLayers = 0;
            var sel = p ? p.selection : [];
            for (var i = 0; i < sel.length; i++) {
                if (sel[i] instanceof CompItem) { out.comp = { id: sel[i].id, name: sel[i].name, width: sel[i].width, height: sel[i].height, duration: sel[i].duration, fps: sel[i].frameRate, fromProjectPanel: true }; break; }
            }
        }
        return out;
    };

    api.openPath = function (a) {
        var f = new File(a.path);
        if (f.exists) { f.parent.execute(); return true; }
        var d = new Folder(a.path);
        if (d.exists) { d.execute(); return true; }
        return false;
    };

    // ------------------------------------------------------------ AE: save
    function libFolderItem() {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof FolderItem && it.name === LIB_FOLDER && it.parentFolder === app.project.rootFolder) return it;
        }
        return app.project.items.addFolder(LIB_FOLDER);
    }

    var STILL_EXT = /\.(png|jpe?g|tiff?|tga|exr|dpx|psd|bmp|gif|webp|cin|sgi|hdr|iff)$/i;

    // Copy every file the reduced project uses into <dir>/Footage and relink to the copy.
    function collectFootage(dir) {
        var dest = ensureFolder(dir + "/Footage"), missing = [], copied = 0, used = {};
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (!(it instanceof FootageItem) || !(it.mainSource instanceof FileSource)) continue;
            var src = it.mainSource.file;
            if (!src || !src.exists) { missing.push(it.name); continue; }
            var isSeq = !it.mainSource.isStill && STILL_EXT.test(src.name);
            if (isSeq) {
                var stem = src.name.replace(/\d+\.[^.]+$/, ""), ext = src.name.replace(/^.*\./, "");
                var seqDir = ensureFolder(dest.fsName + "/" + it.id + "_" + stem.replace(/[_\-. ]+$/, ""));
                var files = src.parent.getFiles(), first = null;
                for (var f = 0; f < files.length; f++) {
                    var n = files[f].name;
                    if (files[f] instanceof File && n.indexOf(stem) === 0 && n.replace(/^.*\./, "") === ext && /\d+\.[^.]+$/.test(n)) {
                        files[f].copy(seqDir.fsName + "/" + n);
                        if (n === src.name) first = new File(seqDir.fsName + "/" + n);
                    }
                }
                if (first) { it.replaceWithSequence(first, false); copied++; }
            } else {
                var name = src.name;
                if (used[name.toLowerCase()]) name = it.id + "_" + name;
                used[name.toLowerCase()] = true;
                var target = new File(dest.fsName + "/" + name);
                if (!src.copy(target.fsName)) { missing.push(it.name); continue; }
                it.replace(target);
                copied++;
            }
        }
        return { missing: missing, copied: copied };
    }

    function fontsUsed() {
        var seen = {}, out = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var c = app.project.item(i);
            if (!(c instanceof CompItem)) continue;
            for (var l = 1; l <= c.numLayers; l++) {
                var lay = c.layer(l);
                if (!(lay instanceof TextLayer)) continue;
                try {
                    var font = lay.property("ADBE Text Properties").property("ADBE Text Document").value.font;
                    if (font && !seen[font]) { seen[font] = true; out.push(font); }
                } catch (e) {}
            }
        }
        return out;
    }

    function skipOtherRenders() {
        var rq = app.project.renderQueue;
        for (var i = rq.numItems; i >= 1; i--) { try { rq.item(i).remove(); } catch (e) {} }
    }
    function findTemplate(om, re) {
        var t = om.templates;
        for (var i = 0; i < t.length; i++) if (re.test(t[i])) return t[i];
        return null;
    }

    // Small PNG flipbook for hover previews. Returns number of frames written.
    function renderFrames(comp, dir) {
        var W = 360, H = Math.max(2, Math.round(W * comp.height / comp.width / 2) * 2);
        var maxFrames = 48, fps = Math.max(1, Math.min(12, maxFrames / Math.max(comp.duration, 0.1)));
        var pv = app.project.items.addComp("__harsh_preview", W, H, 1, comp.duration, fps);
        var lay = pv.layers.add(comp);
        var s = 100 * W / comp.width;
        lay.property("ADBE Transform Group").property("ADBE Scale").setValue([s, s]);
        var folder = ensureFolder(dir + "/preview"), count = 0, rqi = null;
        try {
            rqi = app.project.renderQueue.items.add(pv);
            var om = rqi.outputModule(1);
            om.setSettings({ "Format": "PNG Sequence" });
            om.file = new File(folder.fsName + "/f_[###].png");
            app.project.renderQueue.render();
            count = folder.getFiles("*.png").length;
            try { rqi.remove(); } catch (e0) {}
        } catch (e) {
            if (rqi) { try { rqi.remove(); } catch (e1) {} }
            // Older AE: fall back to single frames.
            var n = Math.max(1, Math.round(comp.duration * fps));
            for (var i = 0; i < n; i++) {
                try { pv.saveFrameToPng((i + 0.5) / fps, new File(folder.fsName + "/f_" + ("00" + i).slice(-3) + ".png")); count++; } catch (e2) { break; }
            }
        }
        pv.remove();
        return count;
    }

    function renderVideo(comp, dir) {
        var rqi = app.project.renderQueue.items.add(comp), om = rqi.outputModule(1);
        var tpl = findTemplate(om, /H\.?264/i);
        if (!tpl) { rqi.remove(); return ""; }
        om.applyTemplate(tpl);
        om.file = new File(dir + "/video.mp4");
        app.project.renderQueue.render();
        try { rqi.remove(); } catch (e) {}
        var out = new File(dir + "/video.mp4");
        return out.exists ? "video.mp4" : "";
    }

    // a: { kind: "animation" | "layers", dir, name, video: bool }
    api.saveItem = function (a) {
        var p = app.project;
        if (!p) fail("Open a project first.");
        if (!p.file) fail("Save your project once (File > Save), then save to the library.");
        var info = api.info();
        if (!info.comp) fail(a.kind === "layers" ? "Open a comp and select the layers to save." : "Open the comp you want to save, or select it in the Project panel.");
        if (a.kind === "layers" && !info.selectedLayers) fail("Select the layers you want to save in the timeline.");

        var origFile = p.file, compId = info.comp.id, layerIdx = [];
        if (a.kind === "layers") {
            var sl = p.activeItem.selectedLayers;
            for (var i = 0; i < sl.length; i++) layerIdx.push(sl[i].index);
            layerIdx.sort(function (x, y) { return x - y; });
        }

        p.save(); // your project, saved in place, so nothing is lost
        var result = null, err = null;
        try {
            p.save(new File(a.dir + "/item.aep")); // from here on we work on the library copy
            result = buildCopy(p.itemByID(compId), layerIdx, a);
        } catch (e) { err = e; }
        app.open(origFile); // back to your project
        if (err) throw err;
        return result;
    };

    // Runs on the library copy (already saved as <dir>/item.aep): keep only the comp
    // (or a new comp made of the chosen layers), copy its files in, render previews.
    function buildCopy(src, layerIdx, a) {
        var p = app.project, target = src;
        if (layerIdx && layerIdx.length && layerIdx.length < src.numLayers) {
            target = p.items.addComp(a.name, src.width, src.height, src.pixelAspect, src.duration, src.frameRate);
            for (var j = layerIdx.length - 1; j >= 0; j--) src.layer(layerIdx[j]).copyToComp(target);
        }
        target.name = a.name;
        p.reduceProject([target]);
        skipOtherRenders();
        var col = collectFootage(a.dir);
        var frames = 0, video = "";
        try { frames = renderFrames(target, a.dir); } catch (eF) {}
        if (a.video) { try { video = renderVideo(target, a.dir); } catch (eV) {} }
        var result = {
            compName: target.name, width: target.width, height: target.height,
            duration: target.duration, fps: target.frameRate, layers: target.numLayers,
            missing: col.missing, copied: col.copied, fonts: fontsUsed(), frames: frames, video: video
        };
        p.save();
        return result;
    }

    // ------------------------------------------------------------ AE: from a project file
    function suppress(on) {
        try { if (on) app.beginSuppressDialogs(); else app.endSuppressDialogs(false); } catch (e) {}
    }
    function importSource(path) {
        var f = new File(path);
        if (!f.exists) fail("Can't find that project file: " + path);
        if (!/\.(aep|aepx|prproj)$/i.test(f.name)) fail("Pick an After Effects (.aep) or Premiere Pro (.prproj) project.");
        var item = app.project.importFile(new ImportOptions(f));
        if (!(item instanceof FolderItem)) {
            if (item) { try { item.remove(); } catch (e) {} }
            fail("After Effects couldn't read the comps in " + f.name + ".");
        }
        return item;
    }
    // Comps in a stable order, so the same file always gives the same numbering.
    function compsIn(folder, out, prefix) {
        for (var i = 1; i <= folder.numItems; i++) {
            var it = folder.item(i);
            if (it instanceof CompItem) out.push({ comp: it, folder: prefix });
            else if (it instanceof FolderItem) compsIn(it, out, prefix ? prefix + " / " + it.name : it.name);
        }
        return out;
    }
    function layerKind(l) {
        if (l instanceof TextLayer) return "text";
        if (l instanceof ShapeLayer) return "shape";
        if (l instanceof CameraLayer) return "camera";
        if (l instanceof LightLayer) return "light";
        if (l.nullLayer) return "null";
        if (l.adjustmentLayer) return "adjustment";
        var s = l.source;
        if (s instanceof CompItem) return "precomp";
        if (s instanceof FootageItem) {
            if (s.mainSource instanceof SolidSource) return "solid";
            if (s.mainSource.isStill) return "image";
            if (s.hasAudio && !s.hasVideo) return "audio";
            return "video";
        }
        return "layer";
    }

    // a: { path } -> { file, comps: [{ index, name, folder, width, height, duration, fps, layers: [{ index, name, kind }] }] }
    api.scanProjectFile = function (a) {
        if (!app.project) app.newProject();
        var out = [], folder = null;
        suppress(true);
        app.beginUndoGroup("Comp Vault: read project file");
        try {
            folder = importSource(a.path);
            var list = compsIn(folder, [], "");
            for (var i = 0; i < list.length; i++) {
                var c = list[i].comp, layers = [];
                for (var l = 1; l <= c.numLayers && l <= 300; l++) {
                    var lay = c.layer(l);
                    layers.push({ index: l, name: lay.name, kind: layerKind(lay) });
                }
                out.push({ index: i, name: c.name, folder: list[i].folder, width: c.width, height: c.height, duration: c.duration, fps: c.frameRate, layers: layers });
            }
        } finally {
            if (folder) { try { folder.remove(); } catch (e) {} }
            app.endUndoGroup();
            suppress(false);
        }
        return { file: new File(a.path).name, comps: out };
    };

    // a: { path, compIndex, compName, layers: [index], kind, dir, name, video }
    api.saveFromFile = function (a) {
        var p = app.project;
        if (p && !p.file && p.numItems > 0) fail("Save your current project once (File > Save) first, so it can come back after this.");
        if (!p) p = app.newProject();
        var origFile = p.file, result = null, err = null;
        if (origFile) p.save();
        suppress(true);
        try {
            var folder = importSource(a.path);
            var entry = compsIn(folder, [], "")[a.compIndex];
            if (!entry || entry.comp.name !== a.compName) fail("That project file changed since it was read. Pick it again.");
            p.save(new File(a.dir + "/item.aep"));
            var idx = (a.layers || []).slice(0);
            idx.sort(function (x, y) { return x - y; });
            result = buildCopy(entry.comp, idx, a);
        } catch (e) { err = e; }
        suppress(false);
        if (origFile) app.open(origFile); else app.newProject();
        if (err) throw err;
        return result;
    };

    // ------------------------------------------------------------ AE: text + colours inside an item
    function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
    function hex2(n) { var v = Math.round(clamp01(n) * 255).toString(16).toUpperCase(); return v.length < 2 ? "0" + v : v; }
    function rgbToHex(c) { return "#" + hex2(c[0]) + hex2(c[1]) + hex2(c[2]); }
    function eachProp(group, fn) {
        var n = 0;
        try { n = group.numProperties; } catch (e) { return; }
        for (var i = 1; i <= n; i++) {
            var p = null;
            try { p = group.property(i); } catch (e1) { continue; }
            if (!p) continue;
            if (p.propertyType === PropertyType.PROPERTY) fn(p); else eachProp(p, fn);
        }
    }
    function isColor(p) { try { return p.propertyValueType === PropertyValueType.COLOR; } catch (e) { return false; } }
    function textProp(lay) { return lay.property("ADBE Text Properties").property("ADBE Text Document"); }
    function allComps(folder) { var l = compsIn(folder, [], ""), out = []; for (var i = 0; i < l.length; i++) out.push(l[i].comp); return out; }

    // a: { aep } -> { texts: [{ comp, index, name, text, animated }], colors: [{ hex, count }] }
    api.inspectItem = function (a) {
        if (!app.project) app.newProject();
        var f = new File(a.aep);
        if (!f.exists) fail("The library file is missing: " + a.aep);
        var folder = null, texts = [], counts = {}, order = [];
        function seen(c) {
            var h = rgbToHex(c);
            if (!counts[h]) { counts[h] = 0; order.push(h); }
            counts[h]++;
        }
        suppress(true);
        app.beginUndoGroup("Comp Vault: read item");
        try {
            folder = app.project.importFile(new ImportOptions(f));
            var comps = allComps(folder);
            for (var c = 0; c < comps.length; c++) {
                var comp = comps[c];
                for (var l = 1; l <= comp.numLayers; l++) {
                    var lay = comp.layer(l);
                    if (lay instanceof TextLayer) {
                        var st = textProp(lay), td = st.value;
                        texts.push({ comp: comp.name, index: l, name: lay.name, text: td.text, animated: st.numKeys > 0 });
                        try { if (td.applyFill) seen(td.fillColor); } catch (eT) {}
                    }
                    try { if (lay.source && lay.source.mainSource instanceof SolidSource) seen(lay.source.mainSource.color); } catch (eS) {}
                    eachProp(lay, function (p) {
                        if (!isColor(p)) return;
                        if (p.numKeys > 0) { for (var k = 1; k <= p.numKeys; k++) seen(p.keyValue(k)); }
                        else seen(p.value);
                    });
                }
            }
        } finally {
            if (folder) { try { folder.remove(); } catch (eR) {} }
            app.endUndoGroup();
            suppress(false);
        }
        order.sort(function (x, y) { return counts[y] - counts[x]; });
        var colors = [];
        for (var i = 0; i < order.length && i < 16; i++) colors.push({ hex: order[i], count: counts[order[i]] });
        return { texts: texts, colors: colors };
    };

    // texts: [{ comp, index, text }], colors: [{ from: "#RRGGBB", to: "#RRGGBB" }]
    function applyChanges(folder, texts, colors) {
        var comps = allComps(folder), byName = {}, i;
        for (i = 0; i < comps.length; i++) if (!byName[comps[i].name]) byName[comps[i].name] = comps[i];
        var changed = 0;
        for (i = 0; texts && i < texts.length; i++) {
            var t = texts[i], comp = byName[t.comp];
            if (!comp || t.index > comp.numLayers) continue;
            var lay = comp.layer(t.index);
            if (!(lay instanceof TextLayer)) continue;
            var st = textProp(lay);
            if (st.numKeys > 0) continue;
            var td = st.value; td.text = t.text; st.setValue(td); changed++;
        }
        var map = {}, any = false;
        for (i = 0; colors && i < colors.length; i++) if (colors[i].to && colors[i].to !== colors[i].from) { map[colors[i].from] = hexToRgb(colors[i].to); any = true; }
        if (!any) return changed;
        function swap(v) { var to = map[rgbToHex(v)]; if (!to) return null; return v.length > 3 ? [to[0], to[1], to[2], v[3]] : to; }
        for (var c = 0; c < comps.length; c++) {
            for (var l = 1; l <= comps[c].numLayers; l++) {
                var layer = comps[c].layer(l);
                if (layer instanceof TextLayer) {
                    var sp = textProp(layer);
                    if (sp.numKeys === 0) {
                        var doc = sp.value;
                        try { if (doc.applyFill) { var nf = swap(doc.fillColor); if (nf) { doc.fillColor = [nf[0], nf[1], nf[2]]; sp.setValue(doc); changed++; } } } catch (eT) {}
                    }
                }
                try {
                    if (layer.source && layer.source.mainSource instanceof SolidSource) {
                        var ns = swap(layer.source.mainSource.color);
                        if (ns) { layer.source.mainSource.color = [ns[0], ns[1], ns[2]]; changed++; }
                    }
                } catch (eS) {}
                eachProp(layer, function (p) {
                    if (!isColor(p)) return;
                    try {
                        if (p.numKeys > 0) {
                            for (var k = 1; k <= p.numKeys; k++) { var nk = swap(p.keyValue(k)); if (nk) { p.setValueAtKey(k, nk); changed++; } }
                        } else { var nv = swap(p.value); if (nv) { p.setValue(nv); changed++; } }
                    } catch (eP) {}
                });
            }
        }
        return changed;
    }

    // ------------------------------------------------------------ AE: insert
    function findComp(folder, name) {
        var fallback = null;
        for (var i = 1; i <= folder.numItems; i++) {
            var it = folder.item(i);
            if (it instanceof CompItem) { if (it.name === name) return it; if (!fallback) fallback = it; }
            if (it instanceof FolderItem) { var r = findComp(it, name); if (r && r.name === name) return r; if (r && !fallback) fallback = r; }
        }
        return fallback;
    }

    // a: { aep, compName, name, kind }
    api.insertItem = function (a) {
        if (!app.project) fail("Open a project first.");
        var f = new File(a.aep);
        if (!f.exists) fail("The library file is missing: " + a.aep);
        var target = app.project.activeItem;
        app.beginUndoGroup("Comp Vault: insert " + a.name);
        try {
            var imported = app.project.importFile(new ImportOptions(f));
            imported.parentFolder = libFolderItem();
            imported.name = a.name;
            var comp = findComp(imported, a.compName);
            if (!comp) fail("Couldn't find the comp inside the saved item.");
            var changed = (a.texts && a.texts.length) || (a.colors && a.colors.length) ? applyChanges(imported, a.texts, a.colors) : 0;
            if (!(target instanceof CompItem)) { comp.openInViewer(); return { into: "", changed: changed }; }
            var at = (a.at !== undefined && a.at !== null) ? a.at : target.time, end = at;
            if (a.kind === "layers") {
                var n = comp.numLayers;
                for (var i = n; i >= 1; i--) comp.layer(i).copyToComp(target);
                for (var k = 1; k <= n; k++) {
                    target.layer(k).startTime += at;
                    if (target.layer(k).outPoint > end) end = target.layer(k).outPoint;
                }
                comp.remove();
            } else {
                var lay = target.layers.add(comp);
                lay.startTime = at;
                end = lay.outPoint;
            }
            return { into: target.name, changed: changed, end: end };
        } finally { app.endUndoGroup(); }
    };

    // a: { path, name }
    api.importFile = function (a) {
        if (isAE()) {
            if (!app.project) fail("Open a project first.");
            var f = new File(a.path);
            if (!f.exists) fail("The file is missing: " + a.path);
            app.beginUndoGroup("Comp Vault: add " + a.name);
            try {
                var item = null;
                for (var i = 1; i <= app.project.numItems; i++) {
                    var it = app.project.item(i);
                    if (it instanceof FootageItem && it.mainSource instanceof FileSource && it.mainSource.file && samePath(it.mainSource.file.fsName, f.fsName)) { item = it; break; }
                }
                if (!item) { item = app.project.importFile(new ImportOptions(f)); item.parentFolder = libFolderItem(); }
                var comp = app.project.activeItem;
                if (comp instanceof CompItem) {
                    var lay = comp.layers.add(item);
                    lay.startTime = (a.at !== undefined && a.at !== null) ? a.at : comp.time;
                    return { into: comp.name, end: lay.outPoint };
                }
                return { into: "" };
            } finally { app.endUndoGroup(); }
        }
        return ppInsertFile(a);
    };

    // a: { hex, name, mode: "fill" | "solid" }
    api.applyColor = function (a) {
        var comp = app.project ? app.project.activeItem : null;
        if (!(comp instanceof CompItem)) fail("Open a comp first.");
        var rgb = hexToRgb(a.hex);
        app.beginUndoGroup("Comp Vault: " + a.name);
        try {
            if (a.mode === "solid") {
                var s = comp.layers.addSolid(rgb, a.name, comp.width, comp.height, comp.pixelAspect, comp.duration);
                return { count: 1, solid: s.name };
            }
            var sel = comp.selectedLayers, n = 0;
            if (!sel.length) fail("Select the layers to colour first.");
            for (var i = 0; i < sel.length; i++) {
                var fx = sel[i].property("ADBE Effect Parade");
                if (!fx || !fx.canAddProperty("ADBE Fill")) continue;
                var fill = fx.addProperty("ADBE Fill");
                fill.property("ADBE Fill-0002").setValue([rgb[0], rgb[1], rgb[2], 1]);
                n++;
            }
            if (!n) fail("Those layers can't take a Fill effect (cameras and lights can't).");
            return { count: n };
        } finally { app.endUndoGroup(); }
    };

    // ------------------------------------------------------------ Premiere
    function ppBin() {
        var root = app.project.rootItem;
        for (var i = 0; i < root.children.numItems; i++) {
            var c = root.children[i];
            if (c.type === ProjectItemType.BIN && c.name === LIB_FOLDER) return c;
        }
        return root.createBin(LIB_FOLDER);
    }
    function ppFind(bin, p) {
        var hit = null;
        for (var i = 0; i < bin.children.numItems; i++) {
            var c = bin.children[i];
            try { if (c.type !== ProjectItemType.BIN && samePath(c.getMediaPath(), p)) hit = c; } catch (e) {}
        }
        return hit;
    }
    function ppInsertFile(a) {
        if (!app.project) fail("Open a project first.");
        var f = new File(a.path);
        if (!f.exists) fail("The file is missing: " + a.path);
        var bin = ppBin(), item = ppFind(bin, f.fsName);
        if (!item) {
            app.project.importFiles([f.fsName], true, bin, false);
            item = ppFind(bin, f.fsName);
        }
        if (!item) fail("Premiere couldn't import " + f.name + ".");
        return ppPlace(item, a.at);
    }
    // Put a project item at the playhead on the lowest free video track.
    function ppPlace(item, atSec) {
        var seq = app.project.activeSequence;
        if (!seq) return { into: "" };
        var t = seq.getPlayerPosition();
        if (atSec !== undefined && atSec !== null) { t = new Time(); t.seconds = atSec; }
        var at = t.seconds;
        var tracks = seq.videoTracks;
        for (var k = 0; k < tracks.numTracks; k++) {
            var tr = tracks[k], busy = false;
            for (var c = 0; c < tr.clips.numItems; c++) {
                var cl = tr.clips[c];
                if (cl.start.seconds <= at + 0.0001 && cl.end.seconds > at + 0.0001) { busy = true; break; }
            }
            if (!busy) {
                tr.overwriteClip(item, t);
                var end = at;
                for (var e = 0; e < tr.clips.numItems; e++) {
                    var nc = tr.clips[e];
                    if (Math.abs(nc.start.seconds - at) < 0.01 && nc.end.seconds > end) end = nc.end.seconds;
                }
                return { into: seq.name, track: "V" + (k + 1), end: end };
            }
        }
        fail("Every video track has a clip at the playhead. Add a video track, then try again.");
    }
    // Saved animations come into Premiere straight from their .aep (Dynamic Link), no render needed.
    // a: { aep, compName, name }
    api.ppInsertAEComp = function (a) {
        if (!app.project) fail("Open a project first.");
        var f = new File(a.aep);
        if (!f.exists) fail("The library file is missing: " + a.aep);
        var bin = ppBin(), before = {}, i;
        for (i = 0; i < bin.children.numItems; i++) before[bin.children[i].nodeId] = true;
        var ok = app.project.importAEComps(f.fsName, [a.compName], bin);
        var item = null;
        for (i = 0; i < bin.children.numItems; i++) {
            var c = bin.children[i];
            if (!before[c.nodeId] && c.type !== ProjectItemType.BIN) item = c;
        }
        if (!item) {
            for (i = 0; i < bin.children.numItems; i++) if (bin.children[i].name === a.compName) item = bin.children[i];
        }
        if (!item) fail(ok === false ? "Premiere couldn't open the After Effects comp. Is After Effects installed on this computer?" : "Premiere imported the comp but couldn't find it in the Comp Vault bin.");
        return ppPlace(item, a.at);
    };

    // ------------------------------------------------------------ dispatcher
    $.HarshCompVault = {
        call: function (name, args) {
            try {
                if (!api[name]) fail("Unknown command " + name);
                return ser({ ok: true, data: api[name](args || {}) });
            } catch (e) {
                return ser({ ok: false, error: e.forEditor ? e.message : (e.message || String(e)) + (e.line ? " (line " + e.line + ")" : "") });
            }
        }
    };
})();
