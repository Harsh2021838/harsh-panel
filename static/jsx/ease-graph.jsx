// Frameshift - Ease Graph, host side (Premiere Pro). ES3 only, ASCII only.
// Global FrameshiftEG (the standalone EaseGraph panel uses EG; a different name means the two never overwrite each other).
var FrameshiftEG = {};
FrameshiftEG.TPS = 254016000000; // Premiere ticks per second

FrameshiftEG.json = function (v) {
  var t = typeof v, i, a;
  if (v === null || v === undefined) return 'null';
  if (t === 'number') return isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') {
    return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
  }
  if (v instanceof Array) {
    a = [];
    for (i = 0; i < v.length; i++) a.push(FrameshiftEG.json(v[i]));
    return '[' + a.join(',') + ']';
  }
  a = [];
  for (i in v) { if (v.hasOwnProperty(i)) a.push(FrameshiftEG.json(String(i)) + ':' + FrameshiftEG.json(v[i])); }
  return '{' + a.join(',') + '}';
};
FrameshiftEG.ok = function (d) { return FrameshiftEG.json({ ok: true, data: d }); };
FrameshiftEG.err = function (e) {
  var m = (e && e.message) ? e.message : String(e);
  if (e && e.line) m += ' (line ' + e.line + ')';
  return FrameshiftEG.json({ ok: false, error: m });
};
FrameshiftEG.parse = function (s) { return eval('(' + s + ')'); };

FrameshiftEG.ticksOf = function (t) {
  if (typeof t === 'number') return Math.round(t * FrameshiftEG.TPS);
  if (t && t.ticks !== undefined) return Number(t.ticks);
  return Math.round(Number(t.seconds) * FrameshiftEG.TPS);
};
FrameshiftEG.mkTime = function (ticks) {
  var tm = new Time();
  tm.ticks = String(Math.round(ticks));
  return tm;
};
FrameshiftEG.readVal = function (v) {
  if (typeof v === 'number') return v;
  if (v && typeof v !== 'string' && typeof v !== 'boolean' && v.length !== undefined) {
    var a = [];
    for (var i = 0; i < v.length; i++) {
      if (typeof v[i] !== 'number') return null;
      a.push(v[i]);
    }
    return a.length ? a : null;
  }
  return null;
};

FrameshiftEG.seq = function () {
  var s = app.project.activeSequence;
  if (!s) throw new Error('No active sequence. Open a sequence in the timeline.');
  return s;
};

FrameshiftEG.findClip = function (nodeId) {
  var s = FrameshiftEG.seq(), groups = [s.videoTracks, s.audioTracks], g, t, j;
  for (g = 0; g < groups.length; g++) {
    for (t = 0; t < groups[g].numTracks; t++) {
      var clips = groups[g][t].clips;
      for (j = 0; j < clips.numItems; j++) {
        if (clips[j].nodeId === nodeId) return clips[j];
      }
    }
  }
  return null;
};
FrameshiftEG.findParam = function (nodeId, c, p) {
  var clip = FrameshiftEG.findClip(nodeId);
  if (!clip) throw new Error('Clip not found. Reload the selection.');
  return clip.components[c].properties[p];
};

FrameshiftEG.getSelection = function () {
  try {
    var s = FrameshiftEG.seq(), sel = s.getSelection(), out = [], i, c, p, k;
    for (i = 0; i < sel.length; i++) {
      var it = sel[i];
      var clip = {
        nodeId: it.nodeId, name: it.name,
        start: FrameshiftEG.ticksOf(it.start), end: FrameshiftEG.ticksOf(it.end), inPoint: FrameshiftEG.ticksOf(it.inPoint),
        params: []
      };
      var comps = it.components;
      for (c = 0; c < comps.numItems; c++) {
        var comp = comps[c], props = comp.properties;
        for (p = 0; p < props.numItems; p++) {
          var prm = props[p], tv = false;
          try { tv = prm.isTimeVarying(); } catch (e1) { tv = false; }
          if (!tv) continue;
          var keys = prm.getKeys();
          if (!keys || keys.length < 1) continue;
          var ks = [], good = true;
          for (k = 0; k < keys.length; k++) {
            var v = FrameshiftEG.readVal(prm.getValueAtKey(keys[k]));
            if (v === null) { good = false; break; }
            ks.push({ t: FrameshiftEG.ticksOf(keys[k]), v: v });
          }
          if (!good) continue;
          clip.params.push({ c: c, p: p, comp: comp.displayName, name: prm.displayName, keys: ks });
        }
      }
      if (clip.params.length) out.push(clip);
    }
    return FrameshiftEG.ok({
      seqId: s.sequenceID,
      timebase: Number(s.timebase),
      frameW: s.frameSizeHorizontal, frameH: s.frameSizeVertical,
      playhead: FrameshiftEG.ticksOf(s.getPlayerPosition()),
      clips: out
    });
  } catch (e) { return FrameshiftEG.err(e); }
};

// Write the exact desired key set inside [t0,t1] for each job.
// job = {nodeId,c,p,t0,t1,tol,linear,keys:[{t,v}]}
FrameshiftEG.writeRanges = function (json) {
  try {
    var spec = FrameshiftEG.parse(json), j, k, w, n = 0;
    for (j = 0; j < spec.jobs.length; j++) {
      var job = spec.jobs[j];
      var prm = FrameshiftEG.findParam(job.nodeId, job.c, job.p);
      var tol = job.tol || 1;
      // 1) remove keys in range that are not wanted
      var existing = prm.getKeys() || [];
      for (k = 0; k < existing.length; k++) {
        var et = FrameshiftEG.ticksOf(existing[k]);
        if (et < job.t0 - tol || et > job.t1 + tol) continue;
        var keep = false;
        for (w = 0; w < job.keys.length; w++) {
          if (Math.abs(job.keys[w].t - et) <= tol) { keep = true; break; }
        }
        if (!keep) prm.removeKey(existing[k]);
      }
      // 2) add / set wanted keys
      for (k = 0; k < job.keys.length; k++) {
        var tm = FrameshiftEG.mkTime(job.keys[k].t);
        try { prm.addKey(tm); } catch (e2) {}
        prm.setValueAtKey(tm, job.keys[k].v, false);
        n++;
        if (job.linear && job.keys[k].t > job.t0 && job.keys[k].t < job.t1) {
          try { prm.setInterpolationTypeAtKey(tm, 0, false); } catch (e3) {}
        }
      }
      // 2b) Premiere's own interpolation on the two end keys (5 = Bezier, 0 = Linear)
      //     (or per end: interpA on the first key, interpB on the last; 1/2/3 = Ease In/Out/Both)
      if ((job.interp !== undefined || job.interpA !== undefined) && job.keys.length) {
        var ia = job.interpA !== undefined ? job.interpA : job.interp, ib = job.interpB !== undefined ? job.interpB : job.interp;
        try { prm.setInterpolationTypeAtKey(FrameshiftEG.mkTime(job.keys[0].t), ia, false); } catch (e4) {}
        try { prm.setInterpolationTypeAtKey(FrameshiftEG.mkTime(job.keys[job.keys.length - 1].t), ib, false); } catch (e5) {}
      }
      // 3) refresh Premiere UI once per job
      if (job.keys.length) {
        var last = job.keys[job.keys.length - 1];
        prm.setValueAtKey(FrameshiftEG.mkTime(last.t), last.v, true);
      }
    }
    return FrameshiftEG.ok({ written: n });
  } catch (e) { return FrameshiftEG.err(e); }
};

// Value of a parameter at a key time (ticks) - used for "add key at playhead"
FrameshiftEG.valueAt = function (json) {
  try {
    var a = FrameshiftEG.parse(json);
    var prm = FrameshiftEG.findParam(a.nodeId, a.c, a.p);
    return FrameshiftEG.ok({ v: FrameshiftEG.readVal(prm.getValueAtTime(FrameshiftEG.mkTime(a.t))) });
  } catch (e) { return FrameshiftEG.err(e); }
};

// What Premiere really plays between keys: n values from t0 to t1 for each job, so the panel
// can draw the actual motion (proof that a pair is smooth, whatever made it so).
FrameshiftEG.samples = function (json) {
  try {
    var spec = FrameshiftEG.parse(json), out = [], j, i;
    for (j = 0; j < spec.jobs.length; j++) {
      var job = spec.jobs[j], vals = [];
      try {
        var prm = FrameshiftEG.findParam(job.nodeId, job.c, job.p), n = job.n || 16;
        for (i = 0; i <= n; i++) vals.push(FrameshiftEG.readVal(prm.getValueAtTime(FrameshiftEG.mkTime(job.t0 + (job.t1 - job.t0) * i / n))));
      } catch (e1) { vals = null; }
      out.push(vals);
    }
    return FrameshiftEG.ok(out);
  } catch (e) { return FrameshiftEG.err(e); }
};

// Cheap fingerprint of the selection + keyframe counts, polled by the panel
FrameshiftEG.selSignature = function () {
  try {
    var s = app.project.activeSequence;
    if (!s) return FrameshiftEG.ok('');
    var sel = s.getSelection(), parts = [], i, c, p;
    for (i = 0; i < sel.length; i++) {
      var comps = sel[i].components;
      parts.push(sel[i].nodeId);
      for (c = 0; c < comps.numItems; c++) {
        var props = comps[c].properties;
        for (p = 0; p < props.numItems; p++) {
          var tv = false;
          try { tv = props[p].isTimeVarying(); } catch (e1) {}
          if (tv) { var k = props[p].getKeys(); parts.push(c + '.' + p + ':' + (k ? k.length : 0)); }
        }
      }
    }
    return FrameshiftEG.ok(parts.join('|'));
  } catch (e) { return FrameshiftEG.err(e); }
};

FrameshiftEG.ping = function () { return FrameshiftEG.ok({ app: app.name, version: app.version }); };
