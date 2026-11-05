// Harsh - Gap QC, host side (After Effects + Premiere Pro).
// Finds short gaps (1 to N frames) that flash black or flash the layer below:
//   Premiere: between clips on a track, at the start of a track, and a track ending just before the sequence ends.
//   After Effects: moments where no layer is visible, a layer ending just before the comp ends,
//                  and a layer starting just after the layer next to it in the stack ends.
// ES3 only, ASCII only. The panel calls $.HarshGapQC.call("name", {args}) and gets a JSON string.
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
    function isAE() { return typeof CompItem !== "undefined"; }

    // ================================================================ Premiere
    var TICKS = 254016000000;
    function ticks(t) { return Number(t.ticks); }
    function clipList(track) {
        var out = [];
        for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c], off = false;
            try { off = !!clip.disabled; } catch (e) {}
            out.push({ i: c, name: clip.name, start: ticks(clip.start), end: ticks(clip.end), off: off });
        }
        out.sort(function (a, b) { return a.start - b.start; });
        return out;
    }
    // Is [from, to] fully covered by an enabled clip on any of these tracks?
    function covered(tracks, from, to) {
        for (var t = 0; t < tracks.length; t++) {
            var list = tracks[t];
            for (var i = 0; i < list.length; i++) {
                if (!list[i].off && list[i].start <= from && list[i].end >= to) return true;
            }
        }
        return false;
    }

    function prSequence(seq, a, out) {
        var frame = Number(seq.timebase);
        if (!frame) return;
        var max = a.maxFrames * frame + frame / 2;
        var seqEnd = 0;
        try { seqEnd = Number(seq.end); } catch (e) {}
        var fps = TICKS / frame;
        var kinds = [["V", seq.videoTracks]];
        if (a.audio) kinds.push(["A", seq.audioTracks]);
        for (var k = 0; k < kinds.length; k++) {
            var letter = kinds[k][0], tracks = kinds[k][1], all = [];
            for (var t = 0; t < tracks.numTracks; t++) all.push(clipList(tracks[t]));
            for (t = 0; t < all.length; t++) {
                var list = all[t], below = all.slice(0, t);
                if (!list.length) continue;
                var base = { app: "PPRO", container: seq.name, containerId: seq.sequenceID, fps: fps,
                    trackKind: letter, track: t, trackName: letter + (t + 1) };
                var push = function (kind, from, to, prev, next) {
                    var g = {};
                    for (var x in base) g[x] = base[x];
                    g.kind = kind; g.frames = Math.round((to - from) / frame);
                    g.time = from / TICKS; g.startTicks = String(from); g.endTicks = String(to);
                    g.prev = prev ? prev.name : ""; g.prevIndex = prev ? prev.i : -1;
                    g.next = next ? next.name : ""; g.nextIndex = next ? next.i : -1;
                    g.black = letter === "V" ? !covered(below, from, to) : false;
                    g.key = seq.sequenceID + ":" + letter + t + ":" + kind + ":" + from;
                    out.push(g);
                };
                // Start of the track
                if (list[0].start > frame / 2 && list[0].start <= max && t === 0) push("start", 0, list[0].start, null, list[0]);
                // Between clips
                for (var i = 0; i + 1 < list.length; i++) {
                    var gap = list[i + 1].start - list[i].end;
                    if (gap > frame / 2 && gap <= max) push("between", list[i].end, list[i + 1].start, list[i], list[i + 1]);
                }
                // A track ending a few frames before the sequence does
                var last = list[list.length - 1];
                if (seqEnd && seqEnd - last.end > frame / 2 && seqEnd - last.end <= max) push("end", last.end, seqEnd, last, null);
            }
        }
    }

    api.prScan = function (a) {
        if (!app.project) throw new Error("No project open.");
        var out = [], seqs = [];
        if (a.scope === "active") {
            if (!app.project.activeSequence) throw new Error("Open a sequence first.");
            seqs.push(app.project.activeSequence);
        } else {
            for (var s = 0; s < app.project.sequences.numSequences; s++) seqs.push(app.project.sequences[s]);
        }
        for (var i = 0; i < seqs.length; i++) prSequence(seqs[i], a, out);
        return { project: app.project.name, containers: seqs.length, gaps: out };
    };

    function seqById(id) {
        for (var s = 0; s < app.project.sequences.numSequences; s++) {
            if (app.project.sequences[s].sequenceID === id) return app.project.sequences[s];
        }
        throw new Error("Sequence not found. Was it deleted?");
    }
    function prTracks(seq, g) { return g.trackKind === "A" ? seq.audioTracks : seq.videoTracks; }

    api.prJump = function (g) {
        var seq = seqById(g.containerId);
        app.project.openSequence(seq.sequenceID);
        seq = app.project.activeSequence || seq;
        seq.setPlayerPosition(g.startTicks);
        try {
            var sel = seq.getSelection();
            for (var i = 0; i < sel.length; i++) sel[i].setSelected(false, false);
            var tr = prTracks(seq, g)[g.track];
            if (g.prevIndex >= 0) tr.clips[g.prevIndex].setSelected(true, true);
            if (g.nextIndex >= 0) tr.clips[g.nextIndex].setSelected(true, true);
        } catch (e) {}
        return true;
    };

    // Close the gap by stretching the clip before it (or pulling the clip after it back, at the start).
    api.prFix = function (g) {
        var seq = seqById(g.containerId);
        var tr = prTracks(seq, g)[g.track];
        if (g.prevIndex >= 0) {
            var clip = tr.clips[g.prevIndex];
            if (String(ticks(clip.end)) !== g.startTicks) throw new Error("The timeline changed since the check. Check again.");
            var t = new Time(); t.ticks = g.endTicks;
            clip.end = t;
            if (String(ticks(clip.end)) !== g.endTicks) throw new Error("Premiere wouldn't stretch \"" + clip.name + "\" (it may have no extra frames). Close this gap by hand.");
            return true;
        }
        var nextClip = tr.clips[g.nextIndex];
        var t0 = new Time(); t0.ticks = "0";
        nextClip.start = t0;
        if (ticks(nextClip.start) !== 0) throw new Error("Premiere wouldn't move \"" + nextClip.name + "\". Close this gap by hand.");
        return true;
    };

    // ========================================================== After Effects
    function visual(layer) {
        try {
            if (!layer.enabled || layer.guideLayer || layer.adjustmentLayer) return false;
            if (layer instanceof CameraLayer || layer instanceof LightLayer) return false;
            if (layer.nullLayer) return false;
            if (layer.hasVideo === false) return false;
        } catch (e) { return false; }
        return true;
    }
    function compsToCheck(a) {
        var out = [], seen = {};
        function add(c, deep, depth) {
            if (!c || seen[c.id] || depth > 20) return;
            seen[c.id] = true; out.push(c);
            if (!deep) return;
            for (var i = 1; i <= c.numLayers; i++) {
                try { var src = c.layer(i).source; if (src instanceof CompItem) add(src, true, depth + 1); } catch (e) {}
            }
        }
        if (a.scope === "active") {
            var c = app.project.activeItem;
            if (!(c instanceof CompItem)) throw new Error("Open a comp first (click in its timeline).");
            add(c, true, 0);
        } else {
            for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i) instanceof CompItem) add(app.project.item(i), false, 0);
        }
        return out;
    }

    function aeComp(comp, a, out) {
        var fd = comp.frameDuration, dur = comp.duration, max = a.maxFrames * fd + fd / 2, half = fd / 2;
        var layers = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (!visual(L)) continue;
            var inP = Math.max(0, L.inPoint), outP = Math.min(dur, L.outPoint);
            if (outP <= inP) continue;
            layers.push({ i: i, name: L.name, inP: inP, outP: outP });
        }
        if (!layers.length) return;
        var seen = {};
        var base = { app: "AEFT", container: comp.name, containerId: comp.id, fps: 1 / fd };
        function push(kind, from, to, prev, next, black) {
            var id = kind + ":" + (prev ? prev.i : 0) + ":" + (next ? next.i : 0);
            if (seen[id]) return;
            seen[id] = true;
            var g = {};
            for (var x in base) g[x] = base[x];
            g.kind = kind; g.frames = Math.round((to - from) / fd); g.time = from; g.to = to;
            g.prev = prev ? prev.name : ""; g.prevIndex = prev ? prev.i : 0;
            g.next = next ? next.name : ""; g.nextIndex = next ? next.i : 0;
            g.black = black;
            g.key = comp.id + ":" + id + ":" + Math.round(from / fd);
            out.push(g);
            return g;
        }
        // 1. Short moments where nothing is visible (black frames, or the comp below shows through).
        var spans = layers.slice().sort(function (p, q) { return p.inP - q.inP; });
        var reach = 0, last = null;
        if (spans[0].inP > half && spans[0].inP <= max) push("start", 0, spans[0].inP, null, spans[0], true);
        for (i = 0; i < spans.length; i++) {
            var s = spans[i];
            if (last && s.inP - reach > half && s.inP - reach <= max) push("between", reach, s.inP, last, s, true);
            if (s.outP > reach) { reach = s.outP; last = s; }
        }
        // 2. Layers ending a few frames before the comp ends; layers ending on the same frame are one gap.
        var groups = {}, order = [];
        for (i = 0; i < layers.length; i++) {
            var gapEnd = dur - layers[i].outP;
            if (!(gapEnd > half && gapEnd <= max)) continue;
            var f = Math.round(layers[i].outP / fd);
            if (!groups[f]) { groups[f] = []; order.push(f); }
            groups[f].push(layers[i]);
        }
        for (i = 0; i < order.length; i++) {
            var grp = groups[order[i]], at = grp[0].outP;
            var g0 = push("end", at, dur, grp[0], null, Math.abs(at - reach) < half);
            if (!g0) continue;
            g0.layers = []; g0.names = [];
            for (var j = 0; j < grp.length; j++) { g0.layers.push(grp[j].i); g0.names.push(grp[j].name); }
        }
        // 3. A layer starting just after the layer next to it in the stack ends (a sequence with a hole).
        for (i = 0; i + 1 < layers.length; i++) {
            var A = layers[i], B = layers[i + 1];
            if (B.i !== A.i + 1) continue;
            var pairs = [[A, B], [B, A]];
            for (var p = 0; p < 2; p++) {
                var first = pairs[p][0], second = pairs[p][1], g2 = second.inP - first.outP;
                if (g2 > half && g2 <= max) push("between", first.outP, second.inP, first, second, false);
            }
        }
    }

    api.aeScan = function (a) {
        if (!app.project) throw new Error("No project open.");
        var comps = compsToCheck(a), out = [];
        for (var i = 0; i < comps.length; i++) aeComp(comps[i], a, out);
        var name = app.project.file ? app.project.file.name : "(unsaved project)";
        return { project: name, projectPath: app.project.file ? app.project.file.fsName : "", containers: comps.length, gaps: out };
    };

    function compById(id) {
        try { var c = app.project.itemByID(id); if (c) return c; } catch (e) {}
        for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).id === id) return app.project.item(i);
        throw new Error("Comp not found. Was it deleted?");
    }

    api.aeJump = function (g) {
        var comp = compById(g.containerId);
        comp.openInViewer();
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        var pick = g.layers && g.layers.length ? g.layers : [g.prevIndex, g.nextIndex];
        for (var p = 0; p < pick.length; p++) if (pick[p]) comp.layer(pick[p]).selected = true;
        comp.time = g.time;
        return true;
    };

    // Close the gap by stretching the layer before it to where the gap ends
    // (or pulling the next layer's start back to 0 at the comp start).
    api.aeFix = function (g) {
        var comp = compById(g.containerId);
        app.beginUndoGroup("Harsh Gap QC fix");
        try {
            if (g.layers && g.layers.length) {
                var stuck = [];
                for (var k = 0; k < g.layers.length; k++) {
                    var E = comp.layer(g.layers[k]);
                    if (E.name !== g.names[k]) throw new Error("The layers changed since the check. Check again.");
                    E.outPoint = g.to;
                    if (Math.abs(E.outPoint - g.to) > comp.frameDuration / 2) stuck.push(E.name);
                }
                if (stuck.length) throw new Error("No more frames to stretch in: " + stuck.join(", ") + ". Turn on Time Remapping or close it by hand.");
            } else if (g.prevIndex) {
                var L = comp.layer(g.prevIndex);
                if (L.name !== g.prev) throw new Error("The layers changed since the check. Check again.");
                L.outPoint = g.to;
                if (Math.abs(L.outPoint - g.to) > comp.frameDuration / 2) throw new Error("\"" + L.name + "\" has no more frames to stretch. Turn on Time Remapping or close the gap by hand.");
            } else {
                var N = comp.layer(g.nextIndex);
                if (N.name !== g.next) throw new Error("The layers changed since the check. Check again.");
                N.inPoint = 0;
                if (N.inPoint > comp.frameDuration / 2) throw new Error("\"" + N.name + "\" can't start earlier. Close the gap by hand.");
            }
        } finally { app.endUndoGroup(); }
        return true;
    };

    api.info = function () { return { host: isAE() ? "AEFT" : "PPRO" }; };

    $.HarshGapQC = {
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
