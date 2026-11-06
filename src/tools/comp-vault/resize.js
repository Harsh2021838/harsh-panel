// Where to draw a source image on a fixed-size canvas.
// mode "crop":  fill the target box; tall images keep their top, wide images stay centred.
// mode "tall":  target width, full height (for scrolling website shots).
// mode "original": no resize (returns null).
function fitBox(src, target) {
  if (!target || target.mode === "original") return null;
  var tw = target.w, th = target.h;
  if (target.mode === "tall") {
    var h = Math.round(src.h * tw / src.w);
    return { w: tw, h: h, dx: 0, dy: 0, dw: tw, dh: h };
  }
  var scale = Math.max(tw / src.w, th / src.h);
  var dw = Math.round(src.w * scale), dh = Math.round(src.h * scale);
  var wider = src.w / src.h > tw / th;
  return { w: tw, h: th, dx: wider ? Math.round((tw - dw) / 2) : 0, dy: 0, dw: dw, dh: dh };
}

module.exports = { fitBox: fitBox };
