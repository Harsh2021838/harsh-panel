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
    // Read each track's clips once. Asking Premiere for track.clips inside the loop builds a new
    // collection every time, which is slow on big projects and can make Premiere run out of memory.
    // Project items and in points are only read when a check needs them (deep).
    function clipList(track, deep) {
        var out = [], clips = null, n = 0;
        try { clips = track.clips; n = clips.numItems; } catch (e) { return out; }
        for (var c = 0; c < n; c++) {
            var clip = clips[c], off = false;
            if (!clip) continue;
            try { off = !!clip.disabled; } catch (e) {}
            var item = null, node = "", inPt = null, outPt = null;
            if (deep) {
                try { item = clip.projectItem; node = item ? String(item.nodeId || item.name) : ""; } catch (e) {}
                try { inPt = clip.inPoint ? ticks(clip.inPoint) : null; } catch (e) {}
                try { outPt = clip.outPoint ? ticks(clip.outPoint) : null; } catch (e) {}
            }
            out.push({ i: c, name: clip.name, start: ticks(clip.start), end: ticks(clip.end), off: off, item: item, node: node, inPt: inPt, outPt: outPt });
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
        // maxFrames 0 = gaps of any length. Cuts and flash frames always use a few frames at most.
        var max = (a.maxFrames > 0 ? a.maxFrames : 1e9) * frame + frame / 2;
        var small = Math.min(a.maxFrames > 0 ? a.maxFrames : 5, 10) * frame + frame / 2;
        var seqEnd = 0;
        try { seqEnd = Number(seq.end); } catch (e) {}
        var fps = TICKS / frame;
        var checks = a.checks || { gaps: true };
        var kinds = [["V", seq.videoTracks]];
        if (a.audio) kinds.push(["A", seq.audioTracks]);
        if (!checks.gaps) kinds = [];
        var V = [], A = [];
        var deep = !!(checks.sync || checks.black || checks.rate || checks.dups);
        var vts = seq.videoTracks, nv = vts.numTracks;
        for (var vt = 0; vt < nv; vt++) V.push(clipList(vts[vt], deep));
        if (checks.sync || a.audio) {
            try { var ats = seq.audioTracks, na = ats.numTracks; for (var at = 0; at < na; at++) A.push(clipList(ats[at], checks.sync)); } catch (e) {}
        }
        function issue(kind, track, trackName, from, to, prev, next, extra) {
            var g = { app: "PPRO", container: seq.name, containerId: seq.sequenceID, fps: fps, trackKind: "V", track: track, trackName: trackName,
                kind: kind, frames: Math.round(Math.abs(to - from) / frame), time: from / TICKS, startTicks: String(from), endTicks: String(to),
                prev: prev ? prev.name : "", prevIndex: prev ? prev.i : -1, next: next ? next.name : "", nextIndex: next ? next.i : -1, black: false,
                key: seq.sequenceID + ":" + kind + ":" + trackName + ":" + from };
            for (var x in extra) g[x] = extra[x];
            out.push(g);
        }
        // Cuts on two video tracks that are a few frames apart (a flash of the wrong shot).
        if (checks.cuts) {
            var cuts = [];
            for (var ct = 0; ct < V.length; ct++) {
                var cl = [];
                for (var ci = 0; ci < V[ct].length; ci++) {
                    var cc = V[ct][ci];
                    if (cc.off || /adjustment layer/i.test(cc.name)) continue;
                    if (cc.start > frame / 2) cl.push({ at: cc.start, clip: cc });
                    if (!seqEnd || seqEnd - cc.end > frame / 2) cl.push({ at: cc.end, clip: cc });
                }
                cuts.push(cl);
            }
            var said = {};
            for (var ta = 0; ta < cuts.length; ta++) for (var tb = ta + 1; tb < cuts.length; tb++) {
                for (var ia = 0; ia < cuts[ta].length; ia++) {
                    var ca = cuts[ta][ia], best = null, bestD = small;
                    for (var ib = 0; ib < cuts[tb].length; ib++) {
                        var d = Math.abs(cuts[tb][ib].at - ca.at);
                        if (d < frame / 2) { best = null; bestD = -1; break; } // lines up with a cut on that track
                        if (d <= bestD) { best = cuts[tb][ib]; bestD = d; }
                    }
                    if (!best) continue;
                    if (said[tb + "@" + best.at]) continue; // that cut is already in a pair
                    said[tb + "@" + best.at] = true;
                    var from = Math.min(ca.at, best.at), to = Math.max(ca.at, best.at);
                    var id = ta + ":" + tb + ":" + from + ":" + to;
                    if (said[id]) continue;
                    said[id] = true;
                    issue("cut", ta, "V" + (ta + 1) + " and V" + (tb + 1), from, to, ca.clip, best.clip, { trackB: tb });
                }
            }
        }
        // Video and its own audio drifted out of sync.
        if (checks.sync) {
            for (var sv = 0; sv < V.length; sv++) for (var si = 0; si < V[sv].length; si++) {
                var vc = V[sv][si];
                if (vc.inPt === null || !vc.node) continue;
                var near = null, nearD = -1, nearT = -1;
                for (var sa = 0; sa < A.length; sa++) for (var sj = 0; sj < A[sa].length; sj++) {
                    var ac = A[sa][sj];
                    if (ac.node !== vc.node || ac.inPt === null) continue;
                    if (ac.end <= vc.start || ac.start >= vc.end) continue; // not playing at the same time
                    var drift = (vc.start - vc.inPt) - (ac.start - ac.inPt);
                    if (nearD < 0 || Math.abs(drift) < Math.abs(nearD)) { near = ac; nearD = drift; nearT = sa; }
                }
                if (!near || Math.abs(nearD) < frame / 2) continue;
                issue("sync", sv, "V" + (sv + 1) + " and A" + (nearT + 1), vc.start, vc.start + Math.abs(nearD), vc, near,
                    { audioEarly: nearD > 0, audioTrack: nearT });
            }
        }
        // Black Video clips and offline media.
        if (checks.black) {
            for (var bt = 0; bt < V.length; bt++) for (var bi = 0; bi < V[bt].length; bi++) {
                var bc = V[bt][bi], why = "";
                if (bc.off) continue;
                try { if (bc.item && !(bc.item.isSequence && bc.item.isSequence()) && bc.item.isOffline && bc.item.isOffline()) why = "offline"; } catch (e) {}
                if (!why && bc.item && /^black video/i.test(String(bc.item.name))) why = "blackvideo";
                if (!why) continue;
                issue(why, bt, "V" + (bt + 1), bc.start, bc.end, bc, null, {});
            }
        }
        // Flash frames: a clip only a few frames long.
        if (checks.cuts) {
            for (var ft = 0; ft < V.length; ft++) for (var fi = 0; fi < V[ft].length; fi++) {
                var fc = V[ft][fi];
                if (fc.off || /adjustment layer/i.test(fc.name)) continue;
                if (fc.end - fc.start > frame / 2 && fc.end - fc.start <= small) issue("flash", ft, "V" + (ft + 1), fc.start, fc.end, fc, null, {});
            }
        }
        // Frame rate problems: clips not starting on a whole frame, and footage at another frame rate.
        if (checks.rate) {
            var seenRate = {};
            for (var rt = 0; rt < V.length; rt++) for (var ri = 0; ri < V[rt].length; ri++) {
                var rc = V[rt][ri];
                if (rc.off) continue;
                var part = (rc.start % frame) / frame;
                if (part > 0.05 && part < 0.95) issue("subframe", rt, "V" + (rt + 1), rc.start, rc.start, rc, null, { part: Math.round(part * 100) });
                if (!rc.item || seenRate[rc.node]) continue;
                seenRate[rc.node] = true;
                // Only ask real video files for their frame rate. Asking an After Effects comp,
                // a nested sequence or a generator can crash Premiere.
                var rate = 0, media = "";
                try { if (rc.item.isSequence && rc.item.isSequence()) continue; } catch (e) { continue; }
                try { media = String(rc.item.getMediaPath() || ""); } catch (e) { media = ""; }
                if (!/\.(mp4|mov|mxf|m4v|avi|mts|m2ts|mpg|mpeg|wmv|webm|mkv|r3d|braw|crm|dng|ari|3gp)$/i.test(media)) continue;
                try { rate = Number(rc.item.getFootageInterpretation().frameRate); } catch (e) {}
                if (rate > 1000) rate = TICKS / rate;
                if (rate > 0 && rate < 1000 && Math.abs(rate - fps) > 0.01) issue("fps", rt, "V" + (rt + 1), rc.start, rc.end, rc, null, { rate: Math.round(rate * 100) / 100, seqRate: Math.round(fps * 100) / 100 });
            }
        }
        // The same shot used more than once.
        if (checks.dups) {
            var uses = {}, orderD = [];
            for (var dt = 0; dt < V.length; dt++) for (var di = 0; di < V[dt].length; di++) {
                var dc = V[dt][di];
                if (dc.off || !dc.node || !dc.item) continue;
                var nm = String(dc.item.name || "");
                if (/adjustment layer|black video|color matte|colour matte|transparent video|graphic|title|\.aep|\.mogrt/i.test(nm)) continue;
                try { if (dc.item.isSequence && dc.item.isSequence()) continue; } catch (e) {}
                if (!uses[dc.node]) { uses[dc.node] = []; orderD.push(dc.node); }
                uses[dc.node].push({ track: dt, clip: dc });
            }
            // Cutting the same interview many times is normal. What's a mistake is showing the
            // same moment of a shot twice: two uses whose source ranges overlap.
            for (var u = 0; u < orderD.length; u++) {
                var list2 = uses[orderD[u]], found = 0;
                for (var p1 = 0; p1 < list2.length && found < 20; p1++) for (var p2 = p1 + 1; p2 < list2.length && found < 20; p2++) {
                    var c1 = list2[p1].clip, c2 = list2[p2].clip;
                    if (c1.inPt === null || c2.inPt === null || c1.outPt === null || c2.outPt === null) continue;
                    var ov = Math.min(c1.outPt, c2.outPt) - Math.max(c1.inPt, c2.inPt);
                    if (ov <= frame) continue;
                    found++;
                    var first = c1.start <= c2.start ? list2[p1] : list2[p2], second = first === list2[p1] ? list2[p2] : list2[p1];
                    issue("dup", first.track, "V" + (first.track + 1), first.clip.start, first.clip.end, first.clip, second.clip,
                        { trackB: second.track, frames: Math.round(ov / frame), againAt: second.clip.start / TICKS, againTrack: "V" + (second.track + 1) });
                }
            }
        }
        for (var k = 0; k < kinds.length; k++) {
            var letter = kinds[k][0], tracks = kinds[k][1], all = [];
            all = letter === "V" ? V : A;
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
                    // Long gaps on upper tracks are normal (titles come and go); only report them when they show black.
                    var big = gap > small && (letter === "A" || (t > 0 && covered(below, list[i].end, list[i + 1].start)));
                    if (gap > frame / 2 && gap <= max && !big) push("between", list[i].end, list[i + 1].start, list[i], list[i + 1]);
                }
                // A track ending a few frames before the sequence does
                var last = list[list.length - 1];
                var tail = seqEnd - last.end, bigTail = tail > small && (letter === "A" || (t > 0 && covered(below, last.end, seqEnd)));
                if (seqEnd && tail > frame / 2 && tail <= max && !bigTail) push("end", last.end, seqEnd, last, null);
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

    // Drop a coloured marker on the sequence for each problem.
    api.prMarkers = function (a) {
        var seq = seqById(a.containerId), added = 0;
        for (var i = 0; i < a.items.length; i++) {
            var it = a.items[i];
            try {
                var m = seq.markers.createMarker(Number(it.time));
                try { m.name = it.name; } catch (e1) {}
                try { m.comments = it.comment; } catch (e2) {}
                try { m.setColorByIndex(it.color); } catch (e3) {}
                added++;
            } catch (e) {}
        }
        return { added: added };
    };

    // Move the playhead to the problem. Kept deliberately small: changing the clip selection
    // (getSelection / setSelected) from a script can crash some Premiere versions, so it only
    // opens the sequence when it isn't already the open one, then moves the playhead.
    api.prJump = function (g) {
        var seq = app.project.activeSequence;
        if (!seq || seq.sequenceID !== g.containerId) {
            var target = seqById(g.containerId);
            app.project.openSequence(target.sequenceID);
            seq = app.project.activeSequence;
            if (!seq || seq.sequenceID !== g.containerId) throw new Error("Couldn't open that sequence. Open it in the timeline and try again.");
        }
        seq.setPlayerPosition(String(g.startTicks));
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
