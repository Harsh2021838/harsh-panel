const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const createStore = require("../store.js");

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "hls-")); }
function make() { let t = 1; return createStore({ fs, path, crypto, home: tmp(), now: () => t++ }); }
function item(s, scope, name, files) {
  const d = s.newItem(scope, name);
  s.saveItem(d, { kind: "animation", name, aep: "item.aep" });
  Object.keys(files).forEach(f => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), files[f]); });
  return d;
}

test("listAll returns every item from every place, newest first", () => {
  const s = make(); s.createClient("Acme");
  item(s, {}, "A", {}); item(s, { client: "Acme" }, "B", {});
  assert.deepStrictEqual(s.listAll().map(i => i.name), ["B", "A"]);
});

test("search matches item names, places and kinds, case-insensitive", () => {
  const s = make(); s.createClient("Acme");
  item(s, {}, "Subscribe pop", {}); item(s, { client: "Acme" }, "Lower third", {});
  assert.deepStrictEqual(s.search("SUBSCR").map(i => i.name), ["Subscribe pop"]);
  assert.deepStrictEqual(s.search("acme").map(i => i.name), ["Lower third"]);
  assert.deepStrictEqual(s.search("").length, 0);
});

test("storage report gives the size of each place and the largest items", () => {
  const s = make(); s.createClient("Acme");
  item(s, {}, "Small", { "item.aep": "x".repeat(100) });
  item(s, { client: "Acme" }, "Big", { "item.aep": "x".repeat(1000), "Footage/rec.mp4": "v".repeat(5000) });
  const r = s.storageReport();
  const acme = r.places.find(p => p.label === "Acme");
  assert.ok(acme.bytes >= 6000);
  assert.strictEqual(r.largest[0].name, "Big");
  assert.ok(r.total >= acme.bytes + 100);
});

test("emptyTrash deletes trashed items for good and reports what it freed", () => {
  const s = make();
  const d = item(s, {}, "Old", { "item.aep": "x".repeat(500) });
  s.trashItem(d);
  assert.ok(s.storageReport().trash >= 500);
  const freed = s.emptyTrash();
  assert.ok(freed >= 500);
  assert.strictEqual(s.storageReport().trash, 0);
});

test("dedupe keeps one copy of identical footage and every item still has its file", () => {
  const s = make(); s.createClient("Acme");
  const video = "screen-recording".repeat(400);
  const a = item(s, {}, "A", { "Footage/rec.mp4": video });
  const b = item(s, { client: "Acme" }, "B", { "Footage/recording.mp4": video });
  item(s, {}, "C", { "Footage/other.mp4": "different".repeat(400) });
  const before = s.storageReport().total;
  const found = s.findDuplicates();
  assert.strictEqual(found.groups, 1);
  assert.strictEqual(found.bytes, video.length);
  const res = s.dedupe();
  assert.strictEqual(res.saved, video.length);
  assert.strictEqual(fs.readFileSync(path.join(a, "Footage/rec.mp4"), "utf8"), video);
  assert.strictEqual(fs.readFileSync(path.join(b, "Footage/recording.mp4"), "utf8"), video);
  assert.strictEqual(fs.statSync(path.join(a, "Footage/rec.mp4")).ino, fs.statSync(path.join(b, "Footage/recording.mp4")).ino);
  assert.strictEqual(s.storageReport().total, before - video.length);
  assert.strictEqual(s.findDuplicates().groups, 0);
});

test("item inspection results are cached in item.json", () => {
  const s = make();
  const d = item(s, {}, "A", {});
  s.saveItem(d, { inspect: { v: 1, texts: [{ comp: "A", index: 1, name: "URL", text: "x.com" }], colors: ["#FF0000"] } });
  assert.strictEqual(s.readItem(d).inspect.texts[0].text, "x.com");
});
