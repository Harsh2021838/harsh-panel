// Gap QC for Premiere: turns the raw clip list from jsx/gap-qc.jsx (prDump) into problems.
// Runs in the panel, where it's fast; Premiere only has to read the timeline once.
const TICKS = 254016000000;
const ADJUST = /adjustment layer/i;
const NOT_A_SHOT = /adjustment layer|black video|colou?r matte|transparent video|graphic|title|\.aep|\.mogrt/i;
// Overlays and design elements are reused on purpose (film burns, light leaks, grain, logos...).
const OVERLAY = /burn|leak|light ?pack|flare|grain|dust|scratch|texture|overlay|transition|glitch|bokeh|smoke|particle|frame|border|logo|subscribe|lower ?third|arrow|emoji|sticker|sfx|whoosh/i;

function clipsOf(rows) {
  return rows.map((r) => ({
    i: r[0], name: r[1], start: Number(r[2]), end: Number(r[3]), off: !!r[4], node: r[5] || "",
    inPt: r[6] === "" ? null : Number(r[6]), outPt: r[7] === "" ? null : Number(r[7]),
  })).filter((c) => isFinite(c.start) && isFinite(c.end)).sort((a, b) => a.start - b.start);
}

// Smallest index in a sorted number array whose value is >= x.
function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

/** Is [from, to] fully covered by one enabled clip on any of these tracks? */
function covered(tracks, from, to) {
  for (const list of tracks) for (const c of list) {
    if (c.start > from) break; // sorted by start
    if (!c.off && c.end >= to) return true;
  }
  return false;
}

export function analyze(dump, opts) {
  const out = [];
  const keys = new Map(); // every row needs its own key, or the list can't tell rows apart
  const checks = opts.checks;
  for (const seq of dump.seqs) {
    const frame = Number(seq.timebase);
    if (!frame) continue;
    const half = frame / 2;
    const max = (opts.maxFrames > 0 ? opts.maxFrames : 1e9) * frame + half;
    const small = Math.min(opts.maxFrames > 0 ? opts.maxFrames : 5, 10) * frame + half;
    const seqEnd = Number(seq.end) || 0;
    const fps = TICKS / frame;
    const V = seq.video.map(clipsOf), A = seq.audio.map(clipsOf);
    const item = (c) => dump.items[c.node] || null;

    const issue = (kind, track, trackName, from, to, prev, next, extra = {}, trackKind = "V") => {
      out.push({
        app: "PPRO", container: seq.name, containerId: seq.id, fps, trackKind, track, trackName,
        kind, frames: Math.round(Math.abs(to - from) / frame), time: from / TICKS, startTicks: String(from), endTicks: String(to),
        prev: prev ? prev.name : "", prevIndex: prev ? prev.i : -1, next: next ? next.name : "", nextIndex: next ? next.i : -1, black: false,
        ...extra,
      });
      const g = out[out.length - 1];
      // Identify a problem by the clips involved (name + which part of the source they show), not by
      // their position or time: fixing something earlier on the track shifts those, and ignored or
      // corrected problems must stay recognised when you check again.
      const who = (c) => (c ? c.name + "|" + (c.inPt === null ? "" : Math.round(c.inPt / frame)) : "");
      const base = seq.id + ":" + kind + ":" + trackName + ":" + who(prev) + ":" + who(next) + ":" + g.frames;
      const n = keys.get(base) || 0;
      keys.set(base, n + 1);
      g.key = n ? base + "#" + n : base;
    };

    // ---- gaps
    if (checks.gaps) {
      const kinds = [["V", V]];
      if (opts.audio) kinds.push(["A", A]);
      for (const [letter, all] of kinds) {
        all.forEach((list, t) => {
          if (!list.length) return;
          const below = all.slice(0, t);
          const push = (kind, from, to, prev, next) => {
            issue(kind, t, letter + (t + 1), from, to, prev, next, { black: letter === "V" ? !covered(below, from, to) : false }, letter);
          };
          if (t === 0 && list[0].start > half && list[0].start <= max) push("start", 0, list[0].start, null, list[0]);
          let reach = list[0];
          for (let i = 1; i < list.length; i++) {
            const c = list[i];
            const gap = c.start - reach.end;
            // Long gaps on upper tracks are normal (titles come and go); only report them when they show black.
            const big = gap > small && (letter === "A" || (t > 0 && covered(below, reach.end, c.start)));
            if (gap > half && gap <= max && !big) push("between", reach.end, c.start, reach, c);
            if (c.end > reach.end) reach = c;
          }
          const tail = seqEnd - reach.end;
          const bigTail = tail > small && (letter === "A" || (t > 0 && covered(below, reach.end, seqEnd)));
          if (seqEnd && tail > half && tail <= max && !bigTail) push("end", reach.end, seqEnd, reach, null);
        });
      }
    }

    // ---- cuts a few frames apart on two video tracks, and flash frames
    if (checks.cuts) {
      const cuts = V.map((list) => {
        const pts = [];
        for (const c of list) {
          if (c.off || ADJUST.test(c.name)) continue;
          if (c.start > half) pts.push({ at: c.start, clip: c });
          if (!seqEnd || seqEnd - c.end > half) pts.push({ at: c.end, clip: c });
        }
        pts.sort((a, b) => a.at - b.at);
        return { pts, ats: pts.map((p) => p.at) };
      });
      for (let ta = 0; ta < cuts.length; ta++) for (let tb = ta + 1; tb < cuts.length; tb++) {
        const B = cuts[tb], used = new Set();
        if (!B.pts.length) continue;
        for (const ca of cuts[ta].pts) {
          const k = lowerBound(B.ats, ca.at - small);
          let best = null, bestD = Infinity, aligned = false;
          for (let j = k; j < B.pts.length && B.ats[j] <= ca.at + small; j++) {
            const d = Math.abs(B.ats[j] - ca.at);
            if (d < half) { aligned = true; break; }
            if (d < bestD) { best = j; bestD = d; }
          }
          if (aligned || best === null || used.has(best)) continue;
          used.add(best);
          const cb = B.pts[best];
          issue("cut", ta, "V" + (ta + 1) + " and V" + (tb + 1), Math.min(ca.at, cb.at), Math.max(ca.at, cb.at), ca.clip, cb.clip, { trackB: tb });
        }
      }
      V.forEach((list, t) => list.forEach((c) => {
        const len = c.end - c.start;
        if (!c.off && !ADJUST.test(c.name) && len > half && len <= small) issue("flash", t, "V" + (t + 1), c.start, c.end, c, null);
      }));
    }

    // ---- video and its own audio drifted apart
    if (checks.sync && A.length) {
      const audioByNode = new Map();
      A.forEach((list, t) => list.forEach((c) => {
        if (!c.node || c.inPt === null) return;
        if (!audioByNode.has(c.node)) audioByNode.set(c.node, []);
        audioByNode.get(c.node).push({ c, t });
      }));
      V.forEach((list, t) => list.forEach((vc) => {
        if (vc.inPt === null || !vc.node || !audioByNode.has(vc.node)) return;
        let near = null, nearD = 0;
        for (const { c: ac, t: at } of audioByNode.get(vc.node)) {
          if (ac.end <= vc.start || ac.start >= vc.end) continue; // not playing at the same time
          const drift = (vc.start - vc.inPt) - (ac.start - ac.inPt);
          if (!near || Math.abs(drift) < Math.abs(nearD)) { near = { ac, at }; nearD = drift; }
        }
        if (!near || Math.abs(nearD) < half) return;
        issue("sync", t, "V" + (t + 1) + " and A" + (near.at + 1), vc.start, vc.start + Math.abs(nearD), vc, near.ac,
          { audioEarly: nearD > 0, audioTrack: near.at });
      }));
    }

    // ---- Black Video clips and offline media
    if (checks.black) {
      V.forEach((list, t) => list.forEach((c) => {
        const it = item(c);
        if (c.off || !it) return;
        const why = it.offline ? "offline" : /^black video/i.test(it.name) ? "blackvideo" : "";
        if (why) issue(why, t, "V" + (t + 1), c.start, c.end, c, null);
      }));
    }

    // ---- frame rate: not on a whole frame, and footage at another frame rate (one row per file)
    if (checks.rate) {
      const seen = new Set();
      V.forEach((list, t) => list.forEach((c) => {
        if (c.off) return;
        const part = (c.start % frame) / frame;
        if (part > 0.05 && part < 0.95) issue("subframe", t, "V" + (t + 1), c.start, c.start, c, null, { part: Math.round(part * 100) });
        const it = item(c);
        if (!it || seen.has(c.node)) return;
        seen.add(c.node);
        let rate = it.rate;
        if (rate > 1000) rate = TICKS / rate;
        if (rate > 0 && rate < 1000 && Math.abs(rate - fps) > 0.01) {
          issue("fps", t, "V" + (t + 1), c.start, c.end, c, null, { rate: Math.round(rate * 100) / 100, seqRate: Math.round(fps * 100) / 100 });
        }
      }));
    }

    // ---- the same moment of a shot shown twice (cutting one interview many times is normal)
    if (checks.dups) {
      const uses = new Map();
      V.forEach((list, t) => list.forEach((c) => {
        const it = item(c);
        if (c.off || !it || it.seq || NOT_A_SHOT.test(it.name) || OVERLAY.test(it.name) || OVERLAY.test(c.name) || c.inPt === null || c.outPt === null) return;
        if (!uses.has(c.node)) uses.set(c.node, []);
        uses.get(c.node).push({ c, t });
      }));
      for (const list of uses.values()) {
        // Two uses can be a mistake; a clip used three or more times is a repeating element.
        if (list.length !== 2) continue;
        // sweep by source in point so only overlapping neighbours are compared
        list.sort((x, y) => x.c.inPt - y.c.inPt);
        let found = 0;
        for (let p = 0; p < list.length && found < 20; p++) {
          for (let q = p + 1; q < list.length && list[q].c.inPt < list[p].c.outPt && found < 20; q++) {
            const ov = Math.min(list[p].c.outPt, list[q].c.outPt) - list[q].c.inPt;
            if (ov <= frame) continue;
            found++;
            const [first, second] = list[p].c.start <= list[q].c.start ? [list[p], list[q]] : [list[q], list[p]];
            issue("dup", first.t, "V" + (first.t + 1), first.c.start, first.c.end, first.c, second.c,
              { trackB: second.t, frames: Math.round(ov / frame), againAt: second.c.start / TICKS, againTrack: "V" + (second.t + 1) });
          }
        }
      }
    }
  }
  return out;
}
