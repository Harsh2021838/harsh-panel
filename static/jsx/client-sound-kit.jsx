/*
 * Client Sound Kit - ExtendScript side (runs inside Premiere Pro).
 * ES3 only: no built-in JSON, no let/const, no arrow functions.
 * Public functions return "OK|..." or "ERR|message".
 */
var CSK = (function () {
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
        var keys = [];
        for (i = 0; i < ks.length; i++) {
            keys.push([r(keySeconds(ks[i]) - base, 3), r(levelToDb(level.getValueAtKey(ks[i])), 2)]);
        }
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

        if (clip) {
            if (colorIndex >= 0) { try { if (clip.setColorLabel) clip.setColorLabel(colorIndex); } catch (e4) {} }
            if (trim && clip.end.seconds - clip.start.seconds > dur + 0.01) {
                var t = new Time(); t.seconds = start + dur; clip.end = t;
            }
        }
        return { clip: clip, index: picked.index, dur: dur };
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
                return "OK|A" + (res.index + 1) + "|" + (ok ? "1" : "0") + "|" + r(res.dur, 3);
            } catch (e) { return "ERR|" + e.message; }
        },

        // BGM part: a section of a file with its saved volume keyframes ("t:db;t:db").
        placePart: function (path, clientName, trackIndex, inSec, outSec, keysStr, mode, staticDb, colorIndex) {
            try {
                var res = placeCore(path, clientName, trackIndex, inSec, outSec, colorIndex);
                var keys = parseKeys(keysStr), ok = false;
                if (res.clip) ok = keys.length ? applyKeys(res.clip, keys, mode) : setStaticVolume(res.clip, staticDb);
                return "OK|A" + (res.index + 1) + "|" + (ok ? "1" : "0") + "|" + r(res.dur, 3);
            } catch (e) { return "ERR|" + e.message; }
        },

        // Reads the selected audio clip on the timeline (to save it as a BGM part).
        captureSelected: function () {
            try {
                var seq = app.project.activeSequence;
                if (!seq) return "ERR|Open a sequence first.";
                var sel = seq.getSelection(), clip = null, i, j;
                if (!sel || !sel.length) return "ERR|Select a BGM clip on the timeline first.";
                for (i = 0; i < sel.length && !clip; i++) {
                    if (sel[i].mediaType === "Audio") clip = sel[i];
                }
                if (!clip) return "ERR|The selection has no audio clip. Select the BGM clip itself.";
                var ti = -1;
                for (i = 0; i < seq.audioTracks.numTracks && ti < 0; i++) {
                    var tr = seq.audioTracks[i];
                    for (j = 0; j < tr.clips.numItems; j++) {
                        if (tr.clips[j].nodeId === clip.nodeId) { ti = i; break; }
                    }
                }
                var path = clip.projectItem ? clip.projectItem.getMediaPath() : "";
                if (!path) return "ERR|Couldn't find the media file for this clip.";
                var v = readVolume(clip);
                var seqEnd = 0;
                try { seqEnd = Number(seq.end) / TICKS; } catch (e5) {}
                return "OK|" + J({
                    name: clip.name, path: path, track: ti,
                    start: r(clip.start.seconds, 3), seqEnd: r(seqEnd, 3),
                    inS: r(clip.inPoint.seconds, 3), outS: r(clip.outPoint.seconds, 3),
                    db: v.db, keys: v.keys, mode: v.mode
                });
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

        // After a file is dragged from the panel onto the timeline: give it the sound's colour, and
        // for a BGM part dragged as clean audio, put its volume keyframes on the clip ("t:db;t:db").
        // Returns "OK|<clips found>"; the panel calls again until the clip has landed.
        afterDrop: function (path, colorIndex, keysStr, mode) {
            try {
                var target = norm(path), n = 0, i, j, keys = parseKeys(keysStr || "");
                var item = findItemByPath(app.project.rootItem, target);
                if (item && colorIndex >= 0) { try { item.setColorLabel(colorIndex); } catch (e1) {} }
                var seq = app.project.activeSequence;
                if (seq) {
                    var ats = seq.audioTracks, na = ats.numTracks;
                    for (i = 0; i < na; i++) {
                        var clips = ats[i].clips, nc = clips.numItems;
                        for (j = 0; j < nc; j++) {
                            var c = clips[j];
                            try {
                                if (!c.projectItem || norm(c.projectItem.getMediaPath()) !== target) continue;
                                n++;
                                if (colorIndex >= 0 && c.setColorLabel) { try { c.setColorLabel(colorIndex); } catch (e3) {} }
                                if (keys.length) {
                                    var level = getLevelParam(c), varying = false;
                                    try { varying = level && level.isTimeVarying(); } catch (e4) {}
                                    if (level && !varying) applyKeys(c, keys, mode === "seq" ? "seq" : "media");
                                }
                            } catch (e2) {}
                        }
                    }
                }
                return "OK|" + n;
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
