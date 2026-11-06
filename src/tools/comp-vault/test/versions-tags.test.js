const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createStore = require("../store.js");

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "hlv-")); }
function make() { let t = 1000; return createStore({ fs, path, home: tmp(), now: () => (t += 1000) }); }
function anim(s, name, body) {
  const d = s.newItem({}, name);
  s.saveItem(d, { kind: "animation", name, aep: "item.aep", compName: name, duration: 2, inspect: { v: 1, texts: [], colors: [] } });
  fs.writeFileSync(path.join(d, "item.aep"), body);
  fs.mkdirSync(path.join(d, "Footage")); fs.writeFileSync(path.join(d, "Footage", "a.png"), body + "-png");
  return d;
}

test("beginUpdate moves the current version aside and keeps name, pin and tags", () => {
  const s = make(); const d = anim(s, "Intro", "v1");
  s.setPinned(d, true); s.setTags(d, ["CTA"]);
  const keep = s.beginUpdate(d);
  assert.ok(!fs.existsSync(path.join(d, "item.aep")));
  assert.deepStrictEqual({ name: keep.name, pinned: keep.pinned, tags: keep.tags }, { name: "Intro", pinned: true, tags: ["CTA"] });
  assert.strictEqual(s.listVersions(d).length, 1);
});

test("finishUpdate writes fresh details and drops the old text/colour scan", () => {
  const s = make(); const d = anim(s, "Intro", "v1");
  const keep = s.beginUpdate(d);
  fs.writeFileSync(path.join(d, "item.aep"), "v2");
  s.finishUpdate(d, keep, { kind: "animation", aep: "item.aep", compName: "Intro", duration: 5 });
  const it = s.readItem(d);
  assert.strictEqual(it.duration, 5);
  assert.strictEqual(it.inspect, undefined);
  assert.strictEqual(it.name, "Intro");
  assert.ok(it.updatedAt > it.createdAt);
});

test("cancelUpdate puts the previous version back when the save fails", () => {
  const s = make(); const d = anim(s, "Intro", "v1");
  s.beginUpdate(d);
  fs.writeFileSync(path.join(d, "item.aep"), "half-written");
  s.cancelUpdate(d);
  assert.strictEqual(fs.readFileSync(path.join(d, "item.aep"), "utf8"), "v1");
  assert.strictEqual(s.listVersions(d).length, 0);
  assert.strictEqual(s.readItem(d).name, "Intro");
});

test("restoreVersion swaps an older version back in and keeps the newer one as a version", () => {
  const s = make(); const d = anim(s, "Intro", "v1");
  const keep = s.beginUpdate(d);
  fs.writeFileSync(path.join(d, "item.aep"), "v2"); fs.mkdirSync(path.join(d, "Footage"));
  s.finishUpdate(d, keep, { kind: "animation", aep: "item.aep", compName: "Intro", duration: 5 });
  const [v1] = s.listVersions(d);
  assert.strictEqual(v1.duration, 2);
  s.restoreVersion(d, v1.id);
  assert.strictEqual(fs.readFileSync(path.join(d, "item.aep"), "utf8"), "v1");
  assert.strictEqual(s.readItem(d).duration, 2);
  const vs = s.listVersions(d);
  assert.strictEqual(vs.length, 1);
  assert.strictEqual(vs[0].duration, 5);
});

test("versions don't show up as their own items", () => {
  const s = make(); const d = anim(s, "Intro", "v1");
  const keep = s.beginUpdate(d);
  fs.writeFileSync(path.join(d, "item.aep"), "v2");
  s.finishUpdate(d, keep, { kind: "animation", aep: "item.aep" });
  assert.strictEqual(s.listItems({}).length, 1);
});

test("setTags trims, drops empties and repeats (ignoring case)", () => {
  const s = make(); const d = anim(s, "Intro", "v1");
  s.setTags(d, [" Lower third ", "cta", "CTA", "", "lower Third"]);
  assert.deepStrictEqual(s.readItem(d).tags, ["Lower third", "cta"]);
});

test("allTags counts tags across the library, most used first", () => {
  const s = make(); s.createClient("Acme");
  const a = anim(s, "A", "x"); const b = anim(s, "B", "y");
  const c = s.newItem({ client: "Acme" }, "C"); s.saveItem(c, { kind: "image", name: "C", file: "image.png" });
  s.setTags(a, ["CTA", "Intro"]); s.setTags(b, ["cta"]); s.setTags(c, ["Logo"]);
  assert.deepStrictEqual(s.allTags(), [{ tag: "CTA", count: 2 }, { tag: "Intro", count: 1 }, { tag: "Logo", count: 1 }]);
});

test("search finds items by tag", () => {
  const s = make(); const a = anim(s, "Alpha", "x"); anim(s, "Beta", "y");
  s.setTags(a, ["lower third"]);
  assert.deepStrictEqual(s.search("lower").map(i => i.name), ["Alpha"]);
});
