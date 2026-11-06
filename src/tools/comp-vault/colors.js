// Colour helpers for "recolour to client brand".
function rgb(hex) {
  var h = String(hex).replace("#", "");
  return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255];
}
// Black, white and greys (low saturation) are layout colours, not brand colours.
function isNeutral(hex) {
  var c = rgb(hex), max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]);
  var l = (max + min) / 2, d = max - min;
  if (d === 0) return true;
  var sat = d / (1 - Math.abs(2 * l - 1));
  return sat < 0.15 || l < 0.06 || l > 0.96;
}
// Most-used brand colours in the item -> client's brand colours, in palette order.
function autoMatch(itemColors, palette) {
  var brand = (palette || []).filter(function (p) { return !isNeutral(p.hex); });
  var next = 0;
  return itemColors.map(function (c) {
    if (isNeutral(c.hex) || next >= brand.length) return { from: c.hex, to: "" };
    return { from: c.hex, to: brand[next++].hex };
  });
}
module.exports = { isNeutral: isNeutral, autoMatch: autoMatch };
