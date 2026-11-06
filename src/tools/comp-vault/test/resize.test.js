const test = require("node:test");
const assert = require("node:assert");
const { fitBox } = require("../resize.js");

test("crop mode: tall screenshot fills width and keeps the top", () => {
  assert.deepStrictEqual(fitBox({ w: 1440, h: 4000 }, { w: 1920, h: 1080, mode: "crop" }),
    { w: 1920, h: 1080, dx: 0, dy: 0, dw: 1920, dh: 5333 });
});

test("crop mode: wide image fills height and is centred", () => {
  assert.deepStrictEqual(fitBox({ w: 4000, h: 1000 }, { w: 1920, h: 1080, mode: "crop" }),
    { w: 1920, h: 1080, dx: -1200, dy: 0, dw: 4320, dh: 1080 });
});

test("tall mode: keeps full height at target width", () => {
  assert.deepStrictEqual(fitBox({ w: 1440, h: 4000 }, { w: 1920, h: 1080, mode: "tall" }),
    { w: 1920, h: 5333, dx: 0, dy: 0, dw: 1920, dh: 5333 });
});

test("original mode keeps the file as is", () => {
  assert.strictEqual(fitBox({ w: 10, h: 10 }, { mode: "original" }), null);
});
