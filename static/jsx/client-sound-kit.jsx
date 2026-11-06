/*
 * Client Sound Kit - ExtendScript side (runs inside Premiere Pro).
 * ES3 only: no built-in JSON, no let/const, no arrow functions.
 * Public functions return "OK|..." or "ERR|message".
 */
var FrameshiftSK = (function () { // own global: the old standalone Client Sound Kit panel used "CSK"
    var BIN_ROOT = "Client Sound Kit";
    var EPS = 0.0005;
    var TICKS = 254016000000;

    // ---------- helpers ----------
    // Premiere's clip "Level" parameter: 0 dB == 10^(-15/20).
    function dbToLevel(db) { return Math.pow(10, (Number(db) - 15) / 20); }
    function levelToDb(v) { return v > 0 ? 20 * Math.log(v) / Math.LN10 + 15 : -99; }
    function r(n, d) { var m = Math.pow(10, d || 3); return Math.round(n * m) / m; }

    function J(v) {
        if (v === null || v === undefined) return "null";
        var t = typeof v;
        if (t === "number") return isFinite(v) ? String(v) : "null";
        if (t === "boolean") return v ? "true" : "false";
        if (t === "string") {
            return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
        }
        var i, a = [];
        if (v instanceof Array) { for (i = 0; i < v.length; i++) a.push(J(v[i])); return "[" + a.join(",") + "]"; }
        for (var k in v) if (v.hasOwnProperty(k)) a.push(J(k) + ":" + J(v[k]));
        return "{" + a.join(",") + "}";
    }

    function norm(p) { return String(p).replace(/\\/g, "/").toLowerCase(); }
    function isBin(item) { return item.type === ProjectItemType.BIN || item.type === ProjectItemType.ROOT; }

    function findItemByPath(item, target) {
        if (!item) return null;
        if (isBin(item)) {
            for (var i = 0; i < item.children.numItems; i++) {
                var hit = findItemByPath(item.children[i], target);
                if (hit) return hit;
            }
            return null;
        }
        try { if (norm(item.getMediaPath()) === target) return item; } catch (e) {}
        return null;
    }

    function getOrCreateBin(parent, name) {
        var i;
        for (i = 0; i < parent.children.numItems; i++) {
            var c = parent.children[i];
            if (c.type === ProjectItemType.BIN && c.name === name) return c;
        }
        var made = parent.createBin(name);
        if (made) return made;
        for (i = 0; i < parent.children.numItems; i++) {
            var d = parent.children[i];
            if (d.type === ProjectItemType.BIN && d.name === name) return d;
        }
        return parent;
    }

    function getProjectItem(path, clientName) {
        var target = norm(path), root = app.project.rootItem;
        var item = findItemByPath(root, target);
        if (item) return item;
        var f = new File(path);
        if (!f.exists) throw new Error("File not found: " + path);
        var bin = getOrCreateBin(getOrCreateBin(root, BIN_ROOT), clientName || "Shared");
        app.project.importFiles([f.fsName], true, bin, false);
        item = findItemByPath(bin, target) || findItemByPath(root, target);
        if (!item) throw new Error("Import failed: " + path);
        return item;
    }

    function itemDuration(item) {
        try {
            var d = item.getOutPoint().seconds - item.getInPoint().seconds;
            if (d > 0) return d;
        } catch (e) {}
        return 1;
    }

    function trackIsLocked(track) { try { return track.isLocked(); } catch (e) { return false; } }

    function trackIsFree(track, start, end) {
        for (var i = 0; i < track.clips.numItems; i++) {
            var c = track.clips[i];
            if (c.start.seconds < end - EPS && c.end.seconds > start + EPS) return false;
        }
        return true;
    }

    function findClipAt(track, t, item) {
        var best = null;
        for (var i = 0; i < track.clips.numItems; i++) {
            var c = track.clips[i];
            if (Math.abs(c.start.seconds - t) < 0.02) {
                try { if (!item || (c.projectItem && c.projectItem.nodeId === item.nodeId)) return c; } catch (e) {}
                best = c;
            }
        }
        return best;
    }

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

    function setStaticVolume(clip, db) {
        var level = getLevelParam(clip);
        if (!level) return false;
        try { if (level.isTimeVarying()) level.setTimeVarying(false); } catch (e) {}
        level.setValue(dbToLevel(db), true);
        return true;
    }

    function applyKeys(clip, keys, mode) {
        var level = getLevelParam(clip);
        if (!level) return false;
        level.setTimeVarying(true);
        var base = mode === "seq" ? clip.start.seconds : clip.inPoint.seconds;
        for (var i = 0; i < keys.length; i++) {
            var t = base + keys[i][0];
            level.addKey(t);
            level.setValueAtKey(t, dbToLevel(keys[i][1]), true);
        }
        return true;
    }

    function parseKeys(str) {
        var out = [];
        if (!str) return out;
        var parts = String(str).split(";");
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].split(":");
            if (p.length === 2 && !isNaN(Number(p[0])) && !isNaN(Number(p[1]))) out.push([Number(p[0]), Number(p[1])]);
        }
        return out;
    }

    function pickTrack(seq, trackIndex, start, dur) {
        var tracks = seq.audioTracks, i;
        if (trackIndex < 0) {
            for (i = 0; i < tracks.numTracks; i++) {
                if (!trackIsLocked(tracks[i]) && trackIsFree(tracks[i], start, start + dur)) return { track: tracks[i], index: i };
            }
            throw new Error("No free audio track at the playhead. Add a track or set a fixed track.");
        }
        if (trackIndex >= tracks.numTracks) throw new Error("Track A" + (trackIndex + 1) + " doesn't exist in this sequence. Add it or edit this sound's track.");
        if (trackIsLocked(tracks[trackIndex])) throw new Error("Track A" + (trackIndex + 1) + " is locked.");
        return { track: tracks[trackIndex], index: trackIndex };
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

    // Colour a timeline clip and report what Premiere then shows: "got:<index>" or "nolabel" when
    // this Premiere has no colour functions for timeline clips (the project item is coloured anyway).
    function labelClip(clip, colorIndex) {
        var has = false;
        try { if (clip.setColorLabel) { clip.setColorLabel(colorIndex); has = true; } } catch (e1) {}
        try { if (clip.getColorLabel) return "got:" + clip.getColorLabel(); } catch (e2) {}
        return has ? "set" : "item"; // no clip colour functions: the clip took its project item's colour
    }

    // Places [inSec, outSec) of a file at the playhead. outSec <= 0 means to the end.
    function placeCore(path, clientName, trackIndex, inSec, outSec, colorIndex) {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("Open a sequence first.");
        var item = getProjectItem(path, clientName);
        try { item.clearInPoint(); item.clearOutPoint(); } catch (e0) {}
        var full = itemDuration(item);
        inSec = Math.max(0, Number(inSec) || 0);
        outSec = Number(outSec) || 0;
        if (!(outSec > inSec) || outSec > full) outSec = full;
        var trim = inSec > 0.0005 || outSec < full - 0.0005;
        var dur = outSec - inSec;

        var start = seq.getPlayerPosition().seconds;
        var picked = pickTrack(seq, trackIndex, start, dur);

        if (colorIndex >= 0) { try { item.setColorLabel(colorIndex); } catch (e1) {} }
        // Source in/out so only the chosen part is placed and nothing after it is overwritten.
        if (trim) { try { item.setInPoint(inSec, 4); item.setOutPoint(outSec, 4); } catch (e2) {} }
        picked.track.overwriteClip(item, start);
        var clip = findClipAt(picked.track, start, item);
        if (trim) { try { item.clearInPoint(); item.clearOutPoint(); } catch (e3) {} }

        var colour = "";
        if (clip) {
            if (colorIndex >= 0) colour = labelClip(clip, colorIndex);
            if (trim && clip.end.seconds - clip.start.seconds > dur + 0.01) {
                var t = new Time(); t.seconds = start + dur; clip.end = t;
            }
        }
        return { clip: clip, index: picked.index, dur: dur, colour: colour };
    }

    function rangeOf(seq) {
        var inS = 0, outS = 0, whole = false;
        try { inS = seq.getInPointAsTime().seconds; outS = seq.getOutPointAsTime().seconds; }
        catch (e) { try { inS = Number(seq.getInPoint()); outS = Number(seq.getOutPoint()); } catch (e2) {} }
        var seqEnd = 0;
        try { seqEnd = Number(seq.end) / TICKS; } catch (e3) {}
        if (!(outS > inS + 0.01) || (seqEnd > 0 && inS <= 0.001 && outS >= seqEnd - 0.01)) { inS = 0; outS = seqEnd; whole = true; }
        return { inS: inS, outS: outS, whole: whole };
    }

    function fps(seq) {
        try { var tb = Number(seq.timebase); if (tb > 0) return TICKS / tb; } catch (e) {}
        return 25;
    }

    return {
        ping: function () { return "OK|" + app.version; },

        sequenceInfo: function () {
            var seq = app.project.activeSequence;
            if (!seq) return "OK|0|";
            return "OK|" + seq.audioTracks.numTracks + "|" + seq.name;
        },

        pickFiles: function () {
            var files = File.openDialog("Choose sound files", undefined, true);
            if (!files) return "OK|";
            if (!(files instanceof Array)) files = [files];
            var out = [];
            for (var i = 0; i < files.length; i++) out.push(files[i].fsName);
            return "OK|" + out.join("\n");
        },

        // SFX and full BGM: one fixed volume. outSec 0 = whole sound.
        place: function (path, clientName, db, trackIndex, outSec, colorIndex) {
            try {
                var res = placeCore(path, clientName, trackIndex, 0, outSec, colorIndex);
                var ok = res.clip ? setStaticVolume(res.clip, db) : false;
                return "OK|A" + (res.index + 1) + "|" + (ok ? "1" : "0") + "|" + r(res.dur, 3) + "|" + res.colour;
            } catch (e) { return "ERR|" + e.message; }
        },

        // BGM part: a section of a file with its saved volume keyframes ("t:db;t:db").
        placePart: function (path, clientName, trackIndex, inSec, outSec, keysStr, mode, staticDb, colorIndex) {
            try {
                var res = placeCore(path, clientName, trackIndex, inSec, outSec, colorIndex);
                var keys = parseKeys(keysStr), ok = false;
                if (res.clip) ok = keys.length ? applyKeys(res.clip, keys, mode) : setStaticVolume(res.clip, staticDb);
                return "OK|A" + (res.index + 1) + "|" + (ok ? "1" : "0") + "|" + r(res.dur, 3) + "|" + res.colour;
            } catch (e) { return "ERR|" + e.message; }
        },

        // Reads the selected audio clip on the timeline (to save it as a BGM part).
        // Reads every selected audio clip on the timeline (to save as BGM parts), in timeline order.
        captureSelected: function () {
            try {
                var seq = app.project.activeSequence;
                if (!seq) return "ERR|Open a sequence first.";
                var sel = seq.getSelection(), i, j, out = [];
                if (!sel || !sel.length) return "ERR|Select the BGM clips on the timeline first.";
                var seqEnd = 0;
                try { seqEnd = Number(seq.end) / TICKS; } catch (e5) {}
                var ats = seq.audioTracks, na = ats.numTracks;
                for (i = 0; i < sel.length; i++) {
                    var clip = sel[i];
                    if (clip.mediaType !== "Audio") continue;
                    var ti = -1;
                    for (var t = 0; t < na && ti < 0; t++) {
                        var cl = ats[t].clips, nc = cl.numItems;
                        for (j = 0; j < nc; j++) if (cl[j].nodeId === clip.nodeId) { ti = t; break; }
                    }
                    var path = "";
                    try { path = clip.projectItem ? clip.projectItem.getMediaPath() : ""; } catch (e6) {}
                    if (!path) continue;
                    var v = readVolume(clip), fades = ti >= 0 ? fadesOf(ats[ti], clip) : [0, 0];
                    out.push({ name: clip.name, path: path, track: ti, fadeIn: fades[0], fadeOut: fades[1],
                        start: r(clip.start.seconds, 3), end: r(clip.end.seconds, 3), seqEnd: r(seqEnd, 3),
                        inS: r(clip.inPoint.seconds, 3), outS: r(clip.outPoint.seconds, 3),
                        db: v.db, keys: v.keys, mode: v.mode });
                }
                if (!out.length) return "ERR|The selection has no audio clips. Select the BGM clips themselves.";
                out.sort(function (a, b) { return a.start - b.start; });
                return "OK|" + J(out);
            } catch (e) { return "ERR|" + e.message; }
        },

        // Media files of what's selected in Premiere: audio clips on the timeline, and items in the
        // Project panel. Used when clips are dragged from Premiere into the panel, and by "Add selected".
        selectedMedia: function () {
            try {
                var paths = [], seen = {}, i;
                function add(item) {
                    try {
                        if (!item || (item.isSequence && item.isSequence())) return;
                        var p = String(item.getMediaPath() || "");
                        if (p && !seen[p]) { seen[p] = 1; paths.push(p); }
                    } catch (e) {}
                }
                var seq = app.project.activeSequence;
                if (seq) {
                    var sel = seq.getSelection() || [];
                    for (i = 0; i < sel.length; i++) if (sel[i].mediaType === "Audio") add(sel[i].projectItem);
                }
                try {
                    var view = app.getCurrentProjectViewIDs ? app.getCurrentProjectViewIDs() : [];
                    for (var v = 0; v < view.length; v++) {
                        var items = app.getProjectViewSelection(view[v]) || [];
                        for (i = 0; i < items.length; i++) add(items[i]);
                    }
                } catch (e2) {}
                return "OK|" + J(paths);
            } catch (e) { return "ERR|" + e.message; }
        },

        // Lists clips between the sequence In and Out on the given tracks ("1,2" / "3").
        scan: function (sfxCsv, bgmCsv, includeOthers) {
            try {
                var seq = app.project.activeSequence;
                if (!seq) return "ERR|Open a sequence first.";
                var rg = rangeOf(seq), out = [], roles = {}, i, j;
                var s = String(sfxCsv).split(","), b = String(bgmCsv).split(",");
                for (i = 0; i < s.length; i++) if (s[i] !== "") roles[Number(s[i])] = "sfx";
                for (i = 0; i < b.length; i++) if (b[i] !== "") roles[Number(b[i])] = "bgm";
                for (i = 0; i < seq.audioTracks.numTracks; i++) {
                    if (!roles[i]) { if (includeOthers) roles[i] = "other"; else continue; }
                    var tr = seq.audioTracks[i];
                    var muted = false;
                    try { muted = tr.isMuted(); } catch (eM) {}
                    if (muted) continue;
                    for (j = 0; j < tr.clips.numItems; j++) {
                        var c = tr.clips[j];
                        if (c.end.seconds <= rg.inS + EPS || c.start.seconds >= rg.outS - EPS) continue;
                        var path = "";
                        try { path = c.projectItem.getMediaPath(); } catch (e1) {}
                        if (!path) continue;
                        var v = readVolume(c);
                        out.push({
                            track: i, role: roles[i], name: c.name, path: path,
                            start: r(c.start.seconds, 4), end: r(c.end.seconds, 4),
                            srcIn: r(c.inPoint.seconds, 4), srcOut: r(c.outPoint.seconds, 4),
                            db: v.db, keys: v.keys
                        });
                    }
                }
                return "OK|" + J({
                    seqId: String(seq.sequenceID), seqName: seq.name, fps: fps(seq),
                    inS: r(rg.inS, 4), outS: r(rg.outS, 4), whole: rg.whole,
                    tracks: seq.audioTracks.numTracks, clips: out
                });
            } catch (e) { return "ERR|" + e.message; }
        },

        gotoTime: function (sec) {
            try {
                var seq = app.project.activeSequence;
                if (!seq) return "ERR|Open a sequence first.";
                seq.setPlayerPosition(String(Math.round(Number(sec) * TICKS)));
                return "OK|1";
            } catch (e) { return "ERR|" + e.message; }
        },

        // The label names and colours set in Premiere's Preferences > Labels: [[name, colour], ...].
        labels: function () {
            var out = [], i, n, c;
            for (i = 0; i < 16; i++) {
                n = ""; c = "";
                try { if (app.properties.doesPropertyExist("BE.Prefs.LabelNames." + i)) n = String(app.properties.getProperty("BE.Prefs.LabelNames." + i)); } catch (e1) {}
                try { if (app.properties.doesPropertyExist("BE.Prefs.LabelColors." + i)) c = String(app.properties.getProperty("BE.Prefs.LabelColors." + i)); } catch (e2) {}
                out.push([n, c]);
            }
            return "OK|" + J(out);
        },

        // Premiere can't colour a timeline clip from a script, and a dropped file arrives as a new
        // project item with the default colour. But a clip takes its project item's colour when it is
        // put on the timeline. So when a drag is about to start, remember which project items already
        // use the file; after the drop (afterDrop) the new clip is swapped, at the same place, for one
        // item of that file in the client's bin that carries the sound's colour.
        beforeDrop: function (path) {
            try {
                var target = norm(path), all = [];
                (function walk(it) {
                    if (isBin(it)) { for (var k = 0; k < it.children.numItems; k++) walk(it.children[k]); }
                    else { try { if (norm(it.getMediaPath()) === target) all.push(it.nodeId); } catch (e2) {} }
                })(app.project.rootItem);
                $.global.__fsDropBefore = $.global.__fsDropBefore || {};
                $.global.__fsDropBefore[target] = "|" + all.join("|") + "|";
                return "OK|" + all.length;
            } catch (e) { return "ERR|" + e.message; }
        },

        // After a file is dragged from the panel onto the timeline: swap the dropped clip for the
        // coloured project item (same track, same place), and for a BGM part dragged as clean audio
        // put its volume keyframes on it ("t:db;t:db"). Only clips of items imported by this drop are
        // touched. Returns "OK|<clips found>|<item|nolabel>"; the panel calls again until it landed.
        afterDrop: function (path, colorIndex, keysStr, mode, clientName) {
            try {
                var target = norm(path), n = 0, i, j, keys = parseKeys(keysStr || ""), colour = "";
                var before = ($.global.__fsDropBefore || {})[target];
                var known = function (it) { return before && before.indexOf("|" + it.nodeId + "|") >= 0; };
                // The coloured item: one of this file in the client's bin from before the drop, or a new import there.
                var bin = getOrCreateBin(getOrCreateBin(app.project.rootItem, BIN_ROOT), clientName || "Shared");
                var keep = findItemByPath(bin, target);
                if (keep && before && !known(keep)) keep = null;
                if (!keep) {
                    var f = new File(path);
                    if (f.exists) {
                        app.project.importFiles([f.fsName], true, bin, false);
                        for (i = 0; i < bin.children.numItems; i++) { // the last one is the import just made
                            var ch = bin.children[i];
                            try { if (!isBin(ch) && norm(ch.getMediaPath()) === target && !known(ch)) keep = ch; } catch (e0) {}
                        }
                    }
                    if (!keep) keep = getProjectItem(path, clientName);
                    if (before) { before += keep.nodeId + "|"; $.global.__fsDropBefore[target] = before; }
                }
                if (colorIndex >= 0) { try { keep.setColorLabel(colorIndex); } catch (e1) {} }
                var seq = app.project.activeSequence, spare = [], spareSeen = {};
                if (seq) {
                    var ats = seq.audioTracks, na = ats.numTracks;
                    for (i = 0; i < na; i++) {
                        var tr = ats[i], landed = [];
                        for (j = 0; j < tr.clips.numItems; j++) {
                            var c = tr.clips[j], pi = null;
                            try { pi = c.projectItem; } catch (e2) {}
                            if (!pi) continue;
                            var mp = "";
                            try { mp = norm(pi.getMediaPath()); } catch (e3) {}
                            if (mp !== target || pi.nodeId === keep.nodeId) continue;
                            if (before && known(pi)) continue; // an earlier drop: leave it
                            if (!before) { n++; colour = "nolabel"; continue; } // no beforeDrop: just report it landed
                            landed.push({ clip: c, item: pi, start: c.start.seconds, end: c.end.seconds });
                        }
                        for (j = 0; j < landed.length; j++) {
                            var L = landed[j], nc = null;
                            try {
                                L.clip.remove(false, false);
                                try { keep.clearInPoint(); keep.clearOutPoint(); } catch (e4) {}
                                tr.overwriteClip(keep, L.start);
                                nc = findClipAt(tr, L.start, keep);
                                if (nc && nc.end.seconds > L.end + 0.01) { var t = new Time(); t.seconds = L.end; nc.end = t; }
                                colour = "item";
                                if (!spareSeen[L.item.nodeId]) { spareSeen[L.item.nodeId] = 1; spare.push(L.item); }
                            } catch (e5) { nc = findClipAt(tr, L.start, null); colour = colour || "nolabel"; }
                            n++;
                            if (nc && keys.length) {
                                var level = getLevelParam(nc), varying = false;
                                try { varying = level && level.isTimeVarying(); } catch (e6) {}
                                if (level && !varying) applyKeys(nc, keys, mode === "seq" ? "seq" : "media");
                            }
                        }
                    }
                }
                // The copies Premiere imported for the drop are no longer used: delete them.
                if (spare.length) {
                    try {
                        var trash = app.project.rootItem.createBin("Frameshift drop copies");
                        if (trash) {
                            for (i = 0; i < spare.length; i++) { try { spare[i].moveBin(trash); } catch (e7) {} }
                            trash.deleteBin();
                        }
                    } catch (e8) {}
                }
                if (n && before) delete $.global.__fsDropBefore[target];
                return "OK|" + n + "|" + colour;
            } catch (e) { return "ERR|" + e.message; }
        },

        gotoClip: function (trackIndex, start) {
            try {
                var seq = app.project.activeSequence;
                if (!seq) return "ERR|Open a sequence first.";
                seq.setPlayerPosition(String(Math.round(Number(start) * TICKS)));
                var clip = findClipAt(seq.audioTracks[trackIndex], Number(start));
                if (clip) {
                    try {
                        var sel = seq.getSelection();
                        for (var i = 0; sel && i < sel.length; i++) sel[i].setSelected(false, false);
                    } catch (e1) {}
                    try { clip.setSelected(true, true); } catch (e2) {}
                }
                return "OK|" + (clip ? "1" : "0");
            } catch (e) { return "ERR|" + e.message; }
        },

        // Changes a timeline clip's volume by deltaDb (keeps keyframe shape).
        adjustClip: function (trackIndex, start, deltaDb) {
            try {
                var seq = app.project.activeSequence;
                if (!seq) return "ERR|Open a sequence first.";
                var clip = findClipAt(seq.audioTracks[trackIndex], Number(start));
                if (!clip) return "ERR|That clip moved or was deleted. Run the check again.";
                var level = getLevelParam(clip);
                if (!level) return "ERR|This clip has no Volume effect.";
                var tv = false;
                try { tv = level.isTimeVarying(); } catch (e1) {}
                if (tv) {
                    var ks = level.getKeys() || [];
                    for (var i = 0; i < ks.length; i++) {
                        level.setValueAtKey(ks[i], dbToLevel(levelToDb(level.getValueAtKey(ks[i])) + Number(deltaDb)), true);
                    }
                } else {
                    level.setValue(dbToLevel(levelToDb(level.getValue()) + Number(deltaDb)), true);
                }
                return "OK|" + J(readVolume(clip));
            } catch (e) { return "ERR|" + e.message; }
        }
    };
})();
