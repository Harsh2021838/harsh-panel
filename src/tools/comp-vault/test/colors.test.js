const test = require("node:test");
const assert = require("node:assert");
const { isNeutral, autoMatch } = require("../colors.js");

test("greys, black and white count as neutral; brand colours don't", () => {
  for (const h of ["#000000", "#FFFFFF", "#808080", "#1A1A1A", "#F4F4F2"]) assert.ok(isNeutral(h), h);
  for (const h of ["#1C83FF", "#CC0000", "#D6A860", "#1F3D34"]) assert.ok(!isNeutral(h), h);
});

test("auto match maps the most-used colours to the palette in order and keeps neutrals", () => {
  const item = [{ hex: "#FFFFFF", count: 9 }, { hex: "#CC0000", count: 5 }, { hex: "#1C83FF", count: 2 }, { hex: "#00AA44", count: 1 }];
  const palette = [{ hex: "#FFFFFF" }, { hex: "#1F3D34" }, { hex: "#D6A860" }];
  assert.deepStrictEqual(autoMatch(item, palette), [
    { from: "#FFFFFF", to: "" },
    { from: "#CC0000", to: "#1F3D34" },
    { from: "#1C83FF", to: "#D6A860" },
    { from: "#00AA44", to: "" }
  ]);
});

test("auto match with an empty palette keeps everything", () => {
  assert.deepStrictEqual(autoMatch([{ hex: "#CC0000", count: 1 }], []), [{ from: "#CC0000", to: "" }]);
});
