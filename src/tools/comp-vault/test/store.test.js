const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createStore = require("../store.js");

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "hl-")); }
function store() {
  const home = tmp();
  return { s: createStore({ fs, path, home, now: () => 1700000000000 }), home };
}

test("default library folder is Documents/Harsh Library", () => {
  const { s, home } = store();
  assert.strictEqual(s.root(), path.join(home, "Documents", "Harsh Library"));
});

test("library folder setting persists across store instances", () => {
  const { s, home } = store();
  const other = path.join(home, "Drive", "Lib");
  s.setRoot(other);
  const again = createStore({ fs, path, home });
  assert.strictEqual(again.root(), other);
});

test("scopes map to Common, client and client project folders", () => {
  const { s } = store();
  const r = s.root();
  assert.strictEqual(s.scopeDir({}), path.join(r, "Common"));
  assert.strictEqual(s.scopeDir({ client: "Acme" }), path.join(r, "Clients", "Acme"));
  assert.strictEqual(s.scopeDir({ client: "Acme", project: "Site" }), path.join(r, "Clients", "Acme", "Projects", "Site"));
});

test("cleanName strips characters Windows and Mac cannot store", () => {
  const { s } = store();
  assert.strictEqual(s.cleanName('  Link: in/desc*ription?  '), "Link in description");
  assert.strictEqual(s.cleanName("..."), "");
});

test("createClient rejects empty and duplicate names", () => {
  const { s } = store();
  s.createClient("Acme");
  assert.throws(() => s.createClient("acme"), /already/);
  assert.throws(() => s.createClient("  "), /name/);
  assert.deepStrictEqual(s.listClients().map(c => c.name), ["Acme"]);
});

test("listClients is sorted and includes palette and project count", () => {
  const { s } = store();
  s.createClient("Zed"); s.createClient("Acme");
  s.createProject("Acme", "Website");
  s.addColor({ client: "Acme" }, "Acme blue", "1c83ff");
  const [a, z] = s.listClients();
  assert.strictEqual(a.name, "Acme");
  assert.strictEqual(a.projects, 1);
  assert.deepStrictEqual(a.palette, [{ name: "Acme blue", hex: "#1C83FF" }]);
  assert.strictEqual(z.name, "Zed");
});

test("newItem makes a unique folder per item even with the same name", () => {
  const { s } = store();
  const a = s.newItem({}, "Subscribe");
  const b = s.newItem({}, "Subscribe");
  assert.notStrictEqual(a, b);
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
});

test("saveItem then listItems returns items newest first with absolute file paths", () => {
  let t = 1;
  const home = tmp();
  const s = createStore({ fs, path, home, now: () => t++ });
  const d1 = s.newItem({}, "Old");
  s.saveItem(d1, { kind: "image", name: "Old", file: "image.png" });
  const d2 = s.newItem({}, "New");
  s.saveItem(d2, { kind: "animation", name: "New", aep: "item.aep", frames: 2 });
  fs.mkdirSync(path.join(d2, "preview"));
  fs.writeFileSync(path.join(d2, "preview", "f_00.png"), "x");
  fs.writeFileSync(path.join(d2, "preview", "f_01.png"), "x");
  const items = s.listItems({});
  assert.deepStrictEqual(items.map(i => i.name), ["New", "Old"]);
  assert.strictEqual(items[0].aepPath, path.join(d2, "item.aep"));
  assert.deepStrictEqual(items[0].framePaths, [path.join(d2, "preview", "f_00.png"), path.join(d2, "preview", "f_01.png")]);
  assert.strictEqual(items[1].filePath, path.join(d1, "image.png"));
});

test("folders without item.json (half-finished saves) are skipped", () => {
  const { s } = store();
  s.newItem({}, "Broken");
  assert.deepStrictEqual(s.listItems({}), []);
});

test("renameItem changes the shown name only", () => {
  const { s } = store();
  const d = s.newItem({}, "A");
  s.saveItem(d, { kind: "image", name: "A", file: "image.png" });
  s.renameItem(d, "Logo white");
  assert.strictEqual(s.listItems({})[0].name, "Logo white");
});

test("trashItem hides an item and undo restores it", () => {
  const { s } = store();
  const d = s.newItem({ client: "Acme" }, "A");
  s.saveItem(d, { kind: "image", name: "A", file: "image.png" });
  const undo = s.trashItem(d);
  assert.deepStrictEqual(s.listItems({ client: "Acme" }), []);
  undo();
  assert.strictEqual(s.listItems({ client: "Acme" })[0].name, "A");
});

test("moveItem moves an item to another scope", () => {
  const { s } = store();
  s.createClient("Acme");
  const d = s.newItem({}, "A");
  s.saveItem(d, { kind: "image", name: "A", file: "image.png" });
  s.moveItem(d, { client: "Acme" });
  assert.deepStrictEqual(s.listItems({}), []);
  assert.strictEqual(s.listItems({ client: "Acme" })[0].name, "A");
});

test("addColor normalises hex and rejects invalid codes", () => {
  const { s } = store();
  s.addColor({}, "White", "#fff");
  assert.deepStrictEqual(s.palette({}), [{ name: "White", hex: "#FFFFFF" }]);
  assert.throws(() => s.addColor({}, "Bad", "12345g"), /colour code/);
});

test("removeColor removes by index", () => {
  const { s } = store();
  s.addColor({}, "A", "000000"); s.addColor({}, "B", "111111");
  s.removeColor({}, 0);
  assert.deepStrictEqual(s.palette({}).map(c => c.name), ["B"]);
});

test("client remembers its image size", () => {
  const { s } = store();
  s.createClient("Acme");
  s.setClientMeta("Acme", { imageSize: { w: 1080, h: 1920, mode: "tall" } });
  assert.deepStrictEqual(s.clientMeta("Acme").imageSize, { w: 1080, h: 1920, mode: "tall" });
});

test("signature changes when anything in the library changes", () => {
  const { s } = store();
  const before = s.signature({});
  const d = s.newItem({}, "A");
  s.saveItem(d, { kind: "image", name: "A", file: "image.png" });
  assert.notStrictEqual(s.signature({}), before);
});

test("pinned items from every place are listed together, with where they live", () => {
  const { s } = store();
  s.createClient("Acme"); s.createProject("Acme", "Site");
  const a = s.newItem({}, "Common one"); s.saveItem(a, { kind: "image", name: "Common one", file: "image.png" });
  const b = s.newItem({ client: "Acme", project: "Site" }, "Deep one"); s.saveItem(b, { kind: "image", name: "Deep one", file: "image.png" });
  const c = s.newItem({ client: "Acme" }, "Not pinned"); s.saveItem(c, { kind: "image", name: "Not pinned", file: "image.png" });
  s.setPinned(a, true); s.setPinned(b, true);
  const pins = s.listPinned();
  assert.deepStrictEqual(pins.map(p => p.name).sort(), ["Common one", "Deep one"]);
  assert.deepStrictEqual(pins.find(p => p.name === "Deep one").scope, { client: "Acme", project: "Site" });
  assert.deepStrictEqual(pins.find(p => p.name === "Common one").scope, {});
});

test("unpinning removes an item from the pinned list", () => {
  const { s } = store();
  const a = s.newItem({}, "A"); s.saveItem(a, { kind: "image", name: "A", file: "image.png" });
  s.setPinned(a, true); s.setPinned(a, false);
  assert.deepStrictEqual(s.listPinned(), []);
});

function seed(s) {
  s.createClient("Acme"); s.createProject("Acme", "Site");
  s.addColor({ client: "Acme" }, "Blue", "1c83ff");
  const a = s.newItem({}, "Common anim"); s.saveItem(a, { kind: "animation", name: "Common anim", aep: "item.aep" });
  fs.writeFileSync(path.join(a, "item.aep"), "aep"); fs.mkdirSync(path.join(a, "Footage")); fs.writeFileSync(path.join(a, "Footage", "rec.mp4"), "video");
  const b = s.newItem({ client: "Acme", project: "Site" }, "Site shot"); s.saveItem(b, { kind: "image", name: "Site shot", file: "image.png" });
  fs.writeFileSync(path.join(b, "image.png"), "png");
  return { a, b };
}

test("exporting everything writes a folder another library can import", () => {
  const { s } = store(); seed(s);
  const dest = tmp();
  const out = s.exportTo(null, dest);
  assert.ok(fs.existsSync(path.join(out, "harsh-library.json")));
  const friend = createStore({ fs, path, home: tmp() });
  const n = friend.importFrom(out);
  assert.strictEqual(n, 2);
  assert.strictEqual(friend.listItems({})[0].name, "Common anim");
  assert.strictEqual(fs.readFileSync(path.join(friend.listItems({})[0].dir, "Footage", "rec.mp4"), "utf8"), "video");
  assert.strictEqual(friend.listItems({ client: "Acme", project: "Site" })[0].name, "Site shot");
  assert.deepStrictEqual(friend.palette({ client: "Acme" }), [{ name: "Blue", hex: "#1C83FF" }]);
});

test("exporting one client only includes that client", () => {
  const { s } = store(); seed(s);
  const out = s.exportTo({ client: "Acme" }, tmp());
  const friend = createStore({ fs, path, home: tmp() });
  assert.strictEqual(friend.importFrom(out), 1);
  assert.deepStrictEqual(friend.listItems({}), []);
});

test("exporting one item puts it in the right place", () => {
  const { s } = store(); const { b } = seed(s);
  const out = s.exportItems([{ dir: b, scope: { client: "Acme", project: "Site" } }], tmp());
  const friend = createStore({ fs, path, home: tmp() });
  assert.strictEqual(friend.importFrom(out), 1);
  assert.strictEqual(friend.listItems({ client: "Acme", project: "Site" })[0].name, "Site shot");
});

test("importing the same export twice does not duplicate items or colours", () => {
  const { s } = store(); seed(s);
  const out = s.exportTo(null, tmp());
  const friend = createStore({ fs, path, home: tmp() });
  friend.importFrom(out);
  assert.strictEqual(friend.importFrom(out), 0);
  assert.strictEqual(friend.palette({ client: "Acme" }).length, 1);
});

test("importing a folder that is not an export is refused", () => {
  const { s } = store();
  assert.throws(() => s.importFrom(tmp()), /Comp Vault export/);
});

test("recent lists the newest items from every place, with where they live", () => {
  let t = 1;
  const s = createStore({ fs, path, home: tmp(), now: () => t++ });
  s.createClient("Acme");
  for (const [scope, name] of [[{}, "One"], [{ client: "Acme" }, "Two"], [{}, "Three"]]) {
    const d = s.newItem(scope, name); s.saveItem(d, { kind: "image", name, file: "image.png" });
  }
  const r = s.listRecent(2);
  assert.deepStrictEqual(r.map(i => i.name), ["Three", "Two"]);
  assert.deepStrictEqual(r[1].scope, { client: "Acme" });
});

test("a second client can be added next to the first", () => {
  const { s } = store();
  s.createClient("Acme"); s.createClient("Northwind");
  assert.deepStrictEqual(s.listClients().map(c => c.name), ["Acme", "Northwind"]);
});

test("renameClient keeps its items, colours and projects", () => {
  const { s } = store();
  s.createClient("Acme"); s.createProject("Acme", "Site");
  s.addColor({ client: "Acme" }, "Blue", "1c83ff");
  const d = s.newItem({ client: "Acme" }, "Logo"); s.saveItem(d, { kind: "image", name: "Logo", file: "image.png" });
  s.renameClient("Acme", "Acme Studio");
  assert.deepStrictEqual(s.listClients().map(c => c.name), ["Acme Studio"]);
  assert.strictEqual(s.listItems({ client: "Acme Studio" })[0].name, "Logo");
  assert.strictEqual(s.palette({ client: "Acme Studio" })[0].hex, "#1C83FF");
  assert.strictEqual(s.listProjects("Acme Studio")[0].name, "Site");
});

test("renameClient refuses a name another client already has", () => {
  const { s } = store();
  s.createClient("Acme"); s.createClient("Zed");
  assert.throws(() => s.renameClient("Acme", "zed"), /already/);
});

test("trashClient removes a client and undo brings it back", () => {
  const { s } = store();
  s.createClient("Acme"); s.createClient("Zed");
  const undo = s.trashClient("Acme");
  assert.deepStrictEqual(s.listClients().map(c => c.name), ["Zed"]);
  undo();
  assert.deepStrictEqual(s.listClients().map(c => c.name), ["Acme", "Zed"]);
});

test("projects can be renamed and removed with undo", () => {
  const { s } = store();
  s.createClient("Acme"); s.createProject("Acme", "Site");
  s.renameProject("Acme", "Site", "Website");
  assert.deepStrictEqual(s.listProjects("Acme").map(p => p.name), ["Website"]);
  const undo = s.trashProject("Acme", "Website");
  assert.deepStrictEqual(s.listProjects("Acme"), []);
  undo();
  assert.deepStrictEqual(s.listProjects("Acme").map(p => p.name), ["Website"]);
});
