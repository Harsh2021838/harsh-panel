// Frameshift - Pack, host side (Premiere Pro).
// analyze: every file the project points at, and which part of it the sequences use.
// pack:    save, Save As the archive copy, shift clip in/out points for trimmed files, relink, save.
// ES3 only, ASCII only. The panel calls $.HarshPack.call("name", {args}) and gets a JSON string.
(function () {
    var api = {};

    function hex4(n) { var h = n.toString(16); while (h.length < 4) h = "0" + h; return h; }
    function ser(v) {
        if (v === null || v === undefined) return "null";
        var t = typeof v;
        if (t === "number") return isFinite(v) ? String(v) : "null";
        if (t === "boolean") return v ? "true" : "false";
        if (t === "string") {
            if (!/["\\\x00-\x1f\x7f-\uffff]/.test(v)) return '"' + v + '"';
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

    function isSeq(pi) { try { return pi.isSequence(); } catch (e) { return false; } }
    function mediaPath(pi) { try { return pi.getMediaPath() || ""; } catch (e) { return ""; } }
    function makeTime(ticks) { var t = new Time(); t.ticks = String(Math.round(ticks)); return t; }
    function fileName(p) { return p ? new File(p).name : ""; }

    function walk(item, bin, out) {
        for (var i = 0; i < item.children.numItems; i++) {
            var c = item.children[i];
            if (c.type === 2) walk(c, bin + "/" + c.name, out);
            else if (!isSeq(c)) out.push({ item: c, bin: bin });
        }
    }

    function eachClip(proj, fn) {
        for (var s = 0; s < proj.sequences.numSequences; s++) {
            var seq = proj.sequences[s];
            var groups = [seq.videoTracks, seq.audioTracks];
            for (var g = 0; g < 2; g++) {
                for (var t = 0; t < groups[g].numTracks; t++) {
                    var tr = groups[g][t];
                    for (var k = 0; k < tr.clips.numItems; k++) {
                        var clip = tr.clips[k];
                        if (!clip || !clip.projectItem || isSeq(clip.projectItem)) continue;
                        fn(clip, seq, (g === 0 ? "V" : "A") + (t + 1));
                    }
                }
            }
        }
    }

    api.analyze = function () {
        var proj = app.project;
        if (!proj || !proj.rootItem) throw new Error("Open a project first.");
        var list = [];
        walk(proj.rootItem, "", list);
        var usage = {}, clips = 0;
        eachClip(proj, function (clip, seq) {
            var p = mediaPath(clip.projectItem);
            if (!p) return;
            clips++;
            var a = clip.inPoint.seconds, b = clip.outPoint.seconds;
            var lo = Math.min(a, b), hi = Math.max(a, b);
            var u = usage[p];
            if (!u) u = usage[p] = { min: lo, max: hi, count: 0, seqs: {}, spans: [] };
            if (lo < u.min) u.min = lo;
            if (hi > u.max) u.max = hi;
            u.count++;
            u.seqs[seq.name] = true;
            if (u.spans.length < 60) u.spans.push([lo, hi]);
        });
        var items = [];
        for (var i = 0; i < list.length; i++) {
            var it = list[i].item, p2 = mediaPath(it);
            if (!p2) continue;
            var off = false;
            try { off = it.isOffline(); } catch (e) {}
            var u2 = usage[p2], used = null;
            if (u2) {
                var names = [];
                for (var n in u2.seqs) if (u2.seqs.hasOwnProperty(n)) names.push(n);
                used = { min: u2.min, max: u2.max, count: u2.count, seqs: names, spans: u2.spans };
            }
            items.push({ name: it.name, path: p2, bin: list[i].bin, offline: off, used: used });
        }
        return { projectName: proj.name, projectPath: proj.path, sequences: proj.sequences.numSequences, clips: clips, items: items };
    };

    api.pack = function (a) {
        var res = { adjusted: 0, relinked: 0, adjustFailed: [], relinkFailed: [] };
        var f = new File(a.planFile);
        f.encoding = "UTF-8";
        if (!f.open("r")) throw new Error("Couldn't read the pack plan. Try again.");
        var plan = eval("(" + f.read() + ")");
        f.close();
        var byOrig = {};
        for (var i = 0; i < plan.length; i++) byOrig[plan[i].orig] = plan[i];

        if (app.project.path !== a.expectProject) throw new Error("A different project is open now. Open " + fileName(a.expectProject) + " and analyze again.");
        app.project.save();
        app.project.saveAs(a.newProject);

        var proj = null, want = fileName(a.newProject);
        for (var j = 0; j < app.projects.numProjects; j++) {
            if (fileName(app.projects[j].path) === want) { proj = app.projects[j]; break; }
        }
        if (!proj) throw new Error("Premiere didn't open the archive copy, so nothing was relinked. Your original project is unchanged.");

        // 1) clips on trimmed files: shift in/out by the trim offset, keep their place on the timeline
        eachClip(proj, function (clip, seq, track) {
            var e = byOrig[mediaPath(clip.projectItem)];
            if (!e || !e.offsetTicks) return;
            var off = Number(e.offsetTicks);
            var st = Number(clip.start.ticks), en = Number(clip.end.ticks);
            var ni = Number(clip.inPoint.ticks) - off, no = Number(clip.outPoint.ticks) - off;
            try {
                clip.inPoint = makeTime(ni);
                clip.outPoint = makeTime(no);
                var okPos = Number(clip.start.ticks) === st && Number(clip.end.ticks) === en;
                if (!okPos) {
                    try { clip.start = makeTime(st); clip.end = makeTime(en); } catch (e2) {}
                    okPos = Number(clip.start.ticks) === st && Number(clip.end.ticks) === en;
                }
                var okIn = Math.abs(Number(clip.inPoint.ticks) - ni) < 1000 && Math.abs(Number(clip.outPoint.ticks) - no) < 1000;
                if (okIn && okPos) res.adjusted++;
                else res.adjustFailed.push({ seq: seq.name, track: track, clip: clip.name, reason: "in/out or position didn't take" });
            } catch (err) {
                res.adjustFailed.push({ seq: seq.name, track: track, clip: clip.name, reason: String(err.message || err) });
            }
        });

        // 2) relink every project item to its archived file
        var list = [];
        walk(proj.rootItem, "", list);
        for (var m = 0; m < list.length; m++) {
            var it = list[m].item, e3 = byOrig[mediaPath(it)];
            if (!e3) continue;
            try {
                if (it.canChangeMediaPath() && it.changeMediaPath(e3.newPath, true)) {
                    res.relinked++;
                    if (e3.offsetTicks) { try { it.clearInPoint(); it.clearOutPoint(); } catch (e4) {} }
                } else res.relinkFailed.push({ name: it.name, path: e3.orig });
            } catch (e5) {
                res.relinkFailed.push({ name: it.name, path: e3.orig, reason: String(e5.message || e5) });
            }
        }
        proj.save();
        res.projectPath = proj.path;
        return res;
    };

    api.openProject = function (a) {
        if (!new File(a.path).exists) throw new Error("That project isn't there any more: " + a.path);
        app.openDocument(a.path, true, false, false, true);
        return true;
    };

    api.info = function () { return { project: app.project ? app.project.name : "", path: app.project ? app.project.path : "" }; };

    $.HarshPack = {
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
