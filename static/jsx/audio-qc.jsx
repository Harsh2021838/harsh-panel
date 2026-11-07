// Frameshift - Audio QC, host side (Premiere Pro).
// Hands the panel the audio clips of the open sequence: where each sits, which part of which
// file it plays, its volume (level and keyframes) and the fades from audio transitions. The
// panel reads the files and does all the listening and checking.
// ES3 only, ASCII only. The panel calls $.HarshAudioQC.call("name", {args}) and gets a JSON string.
(function () {
    var api = {};
    var TICKS = 254016000000;
    function hex4(n) { var h = n.toString(16); while (h.length < 4) h = "0" + h; return h; }
    function ser(v) {
        if (v === null || v === undefined) return "null";
        var t = typeof v;
        if (t === "number") return isFinite(v) ? String(v) : "null";
        if (t === "boolean") return v ? "true" : "false";
        if (t === "string") {
            if (!/["\\\x00-\x1f\x7f-\uffff]/.test(v)) return '"' + v + '"'; // plain ASCII: no escaping needed
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
    function dbToLevel(db) { return Math.pow(10, (Number(db) - 15) / 20); }
    function levelToDb(v) { return v > 0 ? 20 * Math.log(v) / Math.LN10 + 15 : -99; }
    function r(n, d) { var m = Math.pow(10, d || 3); return Math.round(n * m) / m; }
    function getLevelParam(clip) {
        var comps = clip.components, vol = null, i;
        for (i = 0; i < comps.numItems; i++) {
            if (comps[i].displayName === "Volume") { vol = comps[i]; break; }
        }
        if (!vol && comps.numItems > 0) vol = comps[0];
        if (!vol) return null;
        for (i = 0; i < vol.properties.numItems; i++) {
            if (vol.properties[i].displayName === "Level") return vol.properties[i];
        }
        return vol.properties.numItems > 1 ? vol.properties[1] : null;
    }

    function keySeconds(k) { return (k && k.seconds !== undefined) ? k.seconds : Number(k); }

    // Reads a clip's volume: a static dB, or keyframes as [offsetFromClipStart, dB].
    // Keyframe times are normally source-media time (clip in point + offset);
    // "mode" records which convention the times matched so we re-apply the same way.
    function readVolume(clip) {
        var level = getLevelParam(clip);
        if (!level) return { db: 0, keys: [], mode: "media" };
        var tv = false;
        try { tv = level.isTimeVarying(); } catch (e) {}
        if (!tv) return { db: r(levelToDb(level.getValue()), 2), keys: [], mode: "media" };
        var ks = level.getKeys() || [];
        var inS = clip.inPoint.seconds, outS = clip.outPoint.seconds;
        var st = clip.start.seconds, en = clip.end.seconds;
        var inMedia = true, inSeq = true, i, t;
        for (i = 0; i < ks.length; i++) {
            t = keySeconds(ks[i]);
            if (t < inS - 0.05 || t > outS + 0.05) inMedia = false;
            if (t < st - 0.05 || t > en + 0.05) inSeq = false;
        }
        var mode = (!inMedia && inSeq) ? "seq" : "media";
        var base = mode === "seq" ? st : inS;
        var all = [];
        for (i = 0; i < ks.length; i++) all.push([keySeconds(ks[i]) - base, levelToDb(level.getValueAtKey(ks[i]))]);
        all.sort(function (a, b) { return a[0] - b[0]; });
        // Premiere keeps keyframes that sit outside a trimmed clip. Keep only the ones inside it,
        // with the exact level at the clip's start and end where keyframes ran past them.
        var len = mode === "seq" ? en - st : outS - inS, keys = [];
        function valAt(x) {
            if (x <= all[0][0]) return all[0][1];
            for (var q = 1; q < all.length; q++) {
                if (x <= all[q][0]) { var sp = all[q][0] - all[q - 1][0] || 1; return all[q - 1][1] + (all[q][1] - all[q - 1][1]) * ((x - all[q - 1][0]) / sp); }
            }
            return all[all.length - 1][1];
        }
        if (all.length && all[0][0] < -0.0005) keys.push([0, r(valAt(0), 2)]);
        for (i = 0; i < all.length; i++) if (all[i][0] >= -0.0005 && all[i][0] <= len + 0.0005) keys.push([r(Math.max(0, Math.min(len, all[i][0])), 3), r(all[i][1], 2)]);
        if (all.length && all[all.length - 1][0] > len + 0.0005) keys.push([r(len, 3), r(valAt(len), 2)]);
        if (!keys.length && all.length) keys.push([0, r(valAt(0), 2)]);
        return { db: keys.length ? keys[0][1] : r(levelToDb(level.getValue()), 2), keys: keys, mode: mode };
    }

    // Audio transitions (Constant Power, Exponential Fade...) at a clip's start and end, as the
    // seconds they cover inside the clip: [fadeIn, fadeOut]. Transitions aren't volume keyframes,
    // so the panel turns them into keyframes when it saves the clip.
    function fadesOf(track, clip) {
        var fi = 0, fo = 0, list = null;
        try { list = track.transitions; } catch (e) {}
        if (!list) return [0, 0];
        var st = clip.start.seconds, en = clip.end.seconds, n = 0;
        try { n = list.numItems; } catch (e2) { return [0, 0]; }
        for (var k = 0; k < n; k++) {
            var ts, te;
            try { ts = list[k].start.seconds; te = list[k].end.seconds; } catch (e3) { continue; }
            if (ts <= st + 0.05 && te > st + 0.01) fi = Math.max(fi, Math.min(te, en) - st);
            if (te >= en - 0.05 && ts < en - 0.01) fo = Math.max(fo, en - Math.max(ts, st));
        }
        return [r(fi, 3), r(fo, 3)];
    }


    var LOG = "";
    function step(name) {
        if (!LOG) return;
        try { var f = new File(LOG); f.encoding = "UTF-8"; f.open("a"); f.writeln(name); f.close(); } catch (e) {}
    }

    api.prDump = function (a) {
        LOG = a.logPath || "";
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("Open a sequence first.");
        var fps = TICKS / Number(seq.timebase), inS = 0, outS = 0, end = Number(seq.end) / TICKS;
        try { inS = seq.getInPointAsTime().seconds; outS = seq.getOutPointAsTime().seconds; } catch (e) {}
        var useRange = outS > inS + 0.5 && !(inS < 0.01 && outS >= end - 0.05);
        var out = { id: String(seq.sequenceID), name: seq.name, project: String(app.project.name), fps: r(fps, 3), end: r(end, 3),
            inS: useRange ? r(inS, 3) : 0, outS: useRange ? r(outS, 3) : r(end, 3), tracks: [], nested: 0 };
        var ats = seq.audioTracks;
        for (var t = 0; t < ats.numTracks; t++) {
            var tr = ats[t], muted = false;
            try { muted = tr.isMuted(); } catch (e1) {}
            var T = { index: t, name: String(tr.name || ""), muted: muted, clips: [] };
            out.tracks.push(T);
            if (muted) continue;
            step("track " + t);
            var cl = tr.clips, n = cl.numItems;
            for (var i = 0; i < n; i++) {
                var c = cl[i], st = c.start.seconds, en = c.end.seconds;
                if (en <= out.inS || st >= out.outS) continue;
                var off = false;
                try { off = !!c.disabled; } catch (e2) {}
                if (off) continue;
                var path = "";
                try { path = c.projectItem ? String(c.projectItem.getMediaPath() || "") : ""; } catch (e3) {}
                if (!path) { out.nested++; continue; }
                var v = { db: 0, keys: [], mode: "media" };
                try { v = readVolume(c); } catch (e4) {}
                var fx = [];
                try {
                    for (var k = 0; k < c.components.numItems; k++) {
                        var dn = String(c.components[k].displayName || "");
                        if (!/^(volume|channel volume|panner|panner \(legacy\)|balance)$/i.test(dn)) fx.push(dn);
                    }
                } catch (e6) {}
                var fades = [0, 0];
                try { fades = fadesOf(tr, c); } catch (e5) {}
                T.clips.push({ i: i, name: String(c.name), path: path, start: r(st, 4), end: r(en, 4),
                    inS: r(c.inPoint.seconds, 4), outS: r(c.outPoint.seconds, 4),
                    db: v.db, keys: v.keys, fadeIn: fades[0], fadeOut: fades[1], fx: fx });
            }
        }
        step("done");
        return out;
    };

    // Move the playhead in the open sequence and select the clip there (if one is named).
    api.prGo = function (a) {
        var seq = app.project.activeSequence;
        if (!seq || String(seq.sequenceID) !== a.id) throw new Error("Open the sequence that was checked.");
        seq.setPlayerPosition(String(Math.round(Number(a.t) * TICKS)));
        if (a.track >= 0 && a.i >= 0) {
            try {
                var sel = seq.getSelection();
                for (var s = 0; sel && s < sel.length; s++) sel[s].setSelected(false, false);
                var c = seq.audioTracks[a.track].clips[a.i];
                if (c && Math.abs(c.start.seconds - a.start) < 0.01) c.setSelected(true, true);
            } catch (e) {}
        }
        return true;
    };

    $.HarshAudioQC = {
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
