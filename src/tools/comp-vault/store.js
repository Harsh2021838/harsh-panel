// Harsh Library: everything on disk. Pure Node (fs + path), no Adobe APIs.
//
// <root>/Common/                          items for every client
// <root>/Clients/<Client>/                client items, palette.json, client.json
// <root>/Clients/<Client>/Projects/<P>/   project items
// <scope>/Items/<id>/item.json            one saved thing + its files
// <root>/.Trash/                          deleted items (undo)
//
// A scope is { client?, project? }. {} is Common.

module.exports = function createStore(opts) {
  var fs = opts.fs, path = opts.path, home = opts.home;
  var now = opts.now || Date.now;
  var crypto = opts.crypto || null;
  var settingsFile = opts.settingsFile || path.join(home, ".harsh", "library.json");

  function readJSON(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
  }
  function writeJSON(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    var tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }
  function dirs(dir) {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter(function (d) { return d.isDirectory() && d.name.charAt(0) !== "."; })
        .map(function (d) { return d.name; });
    } catch (e) { return []; }
  }
  function byName(a, b) { return a.localeCompare(b, undefined, { sensitivity: "base" }); }

  function root() {
    var s = readJSON(settingsFile, {});
    return s.root || opts.defaultRoot || path.join(home, "Documents", "Harsh Library");
  }
  function setRoot(dir) {
    var s = readJSON(settingsFile, {});
    s.root = dir;
    writeJSON(settingsFile, s);
  }

  function cleanName(name) {
    return String(name || "")
      .replace(/[*?"<>|\u0000-\u001f]/g, "")
      .replace(/[\\/:]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+|\.+$/g, "")
      .trim()
      .slice(0, 80);
  }
  function requireName(name, what) {
    var n = cleanName(name);
    if (!n) throw new Error("Type a " + what + " name.");
    return n;
  }

  function scopeDir(scope) {
    scope = scope || {};
    if (!scope.client) return path.join(root(), "Common");
    var c = path.join(root(), "Clients", scope.client);
    return scope.project ? path.join(c, "Projects", scope.project) : c;
  }

  function createClient(name) {
    var n = requireName(name, "client");
    var taken = dirs(path.join(root(), "Clients")).some(function (d) { return d.toLowerCase() === n.toLowerCase(); });
    if (taken) throw new Error("A client called " + n + " already exists.");
    fs.mkdirSync(path.join(root(), "Clients", n, "Items"), { recursive: true });
    return n;
  }
  function createProject(client, name) {
    var n = requireName(name, "project");
    var base = path.join(scopeDir({ client: client }), "Projects");
    var taken = dirs(base).some(function (d) { return d.toLowerCase() === n.toLowerCase(); });
    if (taken) throw new Error(client + " already has a project called " + n + ".");
    fs.mkdirSync(path.join(base, n, "Items"), { recursive: true });
    return n;
  }
  function moveToTrash(dir) {
    var trash = path.join(root(), ".Trash");
    fs.mkdirSync(trash, { recursive: true });
    var dest = path.join(trash, now().toString(36) + "-" + path.basename(dir));
    fs.renameSync(dir, dest);
    return function undo() {
      if (fs.existsSync(dir)) throw new Error(path.basename(dir) + " exists again, so it can't be restored.");
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      fs.renameSync(dest, dir);
    };
  }
  function renameFolder(base, from, to, what, owner) {
    var n = requireName(to, what);
    if (n === from) return n;
    var taken = dirs(base).some(function (d) { return d !== from && d.toLowerCase() === n.toLowerCase(); });
    if (taken) throw new Error((owner ? owner + " already has a " + what : "A " + what) + " called " + n + (owner ? "." : " already exists."));
    var src = path.join(base, from), dest = path.join(base, n);
    if (from.toLowerCase() === n.toLowerCase()) { var tmp = dest + ".renaming"; fs.renameSync(src, tmp); fs.renameSync(tmp, dest); }
    else fs.renameSync(src, dest);
    return n;
  }
  function renameClient(from, to) { return renameFolder(path.join(root(), "Clients"), from, to, "client"); }
  function renameProject(client, from, to) { return renameFolder(path.join(scopeDir({ client: client }), "Projects"), from, to, "project", client); }
  function trashClient(name) { return moveToTrash(scopeDir({ client: name })); }
  function trashProject(client, name) { return moveToTrash(scopeDir({ client: client, project: name })); }
  function listClients() {
    return dirs(path.join(root(), "Clients")).sort(byName).map(function (name) {
      var scope = { client: name };
      return {
        name: name,
        palette: palette(scope),
        projects: listProjects(name).length,
        items: dirs(path.join(scopeDir(scope), "Items")).length
      };
    });
  }
  function listProjects(client) {
    var base = path.join(scopeDir({ client: client }), "Projects");
    return dirs(base).sort(byName).map(function (name) {
      return { name: name, items: dirs(path.join(base, name, "Items")).length };
    });
  }

  function slug(name) {
    return (cleanName(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item").slice(0, 40);
  }
  function newItem(scope, name) {
    var base = path.join(scopeDir(scope), "Items");
    fs.mkdirSync(base, { recursive: true });
    var stem = now().toString(36) + "-" + slug(name), dir = path.join(base, stem), i = 2;
    while (fs.existsSync(dir)) dir = path.join(base, stem + "-" + i++);
    fs.mkdirSync(dir);
    return dir;
  }
  function saveItem(dir, meta) {
    var old = readJSON(path.join(dir, "item.json"), {});
    var out = Object.assign({ createdAt: now() }, old, meta);
    writeJSON(path.join(dir, "item.json"), out);
    return out;
  }
  function framesIn(dir) {
    var p = path.join(dir, "preview");
    try {
      return fs.readdirSync(p).filter(function (n) { return /\.png$/i.test(n); }).sort()
        .map(function (n) { return path.join(p, n); });
    } catch (e) { return []; }
  }
  function readItem(dir) {
    var meta = readJSON(path.join(dir, "item.json"), null);
    if (!meta) return null;
    var item = Object.assign({}, meta, { dir: dir });
    if (meta.aep) item.aepPath = path.join(dir, meta.aep);
    if (meta.file) item.filePath = path.join(dir, meta.file);
    if (meta.video) item.videoPath = path.join(dir, meta.video);
    item.framePaths = framesIn(dir);
    return item;
  }
  function listItems(scope) {
    var base = path.join(scopeDir(scope), "Items");
    return dirs(base).map(function (d) { return readItem(path.join(base, d)); })
      .filter(Boolean)
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }
  function renameItem(dir, name) {
    saveItem(dir, { name: requireName(name, "item") });
  }
  function trashItem(dir) {
    var trash = path.join(root(), ".Trash");
    fs.mkdirSync(trash, { recursive: true });
    var dest = path.join(trash, now().toString(36) + "-" + path.basename(dir));
    fs.renameSync(dir, dest);
    return function undo() {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      fs.renameSync(dest, dir);
    };
  }
  function moveItem(dir, scope) {
    var base = path.join(scopeDir(scope), "Items");
    fs.mkdirSync(base, { recursive: true });
    var dest = path.join(base, path.basename(dir));
    if (fs.existsSync(dest)) dest += "-" + now().toString(36);
    fs.renameSync(dir, dest);
    return dest;
  }

  function setPinned(dir, on) { saveItem(dir, { pinned: !!on }); }
  function allScopes() {
    var list = [{}];
    dirs(path.join(root(), "Clients")).forEach(function (c) {
      list.push({ client: c });
      dirs(path.join(scopeDir({ client: c }), "Projects")).forEach(function (p) { list.push({ client: c, project: p }); });
    });
    return list;
  }
  function listRecent(limit) {
    var out = [];
    allScopes().forEach(function (scope) {
      listItems(scope).forEach(function (it) { it.scope = scope; out.push(it); });
    });
    return out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, limit || 8);
  }
  function listPinned() {
    var out = [];
    allScopes().forEach(function (scope) {
      listItems(scope).forEach(function (it) { if (it.pinned) { it.scope = scope; out.push(it); } });
    });
    return out.sort(function (a, b) { return byName(a.name, b.name); });
  }

  // ---- export / import (for moving PCs or sharing with friends)
  // Works on Node 12+ (older CEP), so no fs.cpSync.
  function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src, { withFileTypes: true }).forEach(function (d) {
      var a = path.join(src, d.name), b = path.join(dest, d.name);
      if (d.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
    });
  }
  function scopeDirIn(base, scope) {
    if (!scope.client) return path.join(base, "Common");
    var c = path.join(base, "Clients", scope.client);
    return scope.project ? path.join(c, "Projects", scope.project) : c;
  }
  function stampName() {
    var d = new Date(now()), p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + p2(d.getMinutes());
  }
  function newExportDir(destParent, label) {
    var base = path.join(destParent, "Comp Vault export, " + cleanName(label) + ", " + stampName()), dir = base, i = 2;
    while (fs.existsSync(dir)) dir = base + " (" + i++ + ")";
    fs.mkdirSync(dir, { recursive: true });
    writeJSON(path.join(dir, "harsh-library.json"), { harshLibraryExport: 1, exportedAt: now(), label: label });
    return dir;
  }
  function copyClientMeta(client, out) {
    var from = scopeDir({ client: client }), to = scopeDirIn(out, { client: client });
    fs.mkdirSync(to, { recursive: true });
    ["palette.json", "client.json"].forEach(function (f) {
      if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(to, f));
    });
  }
  function exportItems(list, destParent, label) {
    var out = newExportDir(destParent, label || (list.length === 1 ? (readItem(list[0].dir) || {}).name || "item" : list.length + " items"));
    list.forEach(function (it) {
      if (it.scope.client) copyClientMeta(it.scope.client, out);
      copyDir(it.dir, path.join(scopeDirIn(out, it.scope), "Items", path.basename(it.dir)));
    });
    return out;
  }
  // scope null = everything; a client includes its projects.
  function exportTo(scope, destParent) {
    var scopes = allScopes().filter(function (s) {
      if (!scope) return true;
      if (!scope.client) return !s.client;
      if (scope.project) return s.client === scope.client && s.project === scope.project;
      return s.client === scope.client;
    });
    var label = !scope ? "Everything" : !scope.client ? "Common" : scope.project ? scope.client + " " + scope.project : scope.client;
    var out = newExportDir(destParent, label);
    scopes.forEach(function (s) {
      if (s.client) copyClientMeta(s.client, out);
      if (!s.client && fs.existsSync(paletteFile({}))) {
        fs.mkdirSync(scopeDirIn(out, {}), { recursive: true });
        fs.copyFileSync(paletteFile({}), path.join(scopeDirIn(out, {}), "palette.json"));
      }
      listItems(s).forEach(function (it) { copyDir(it.dir, path.join(scopeDirIn(out, s), "Items", path.basename(it.dir))); });
    });
    return out;
  }
  function mergePalette(scope, incoming) {
    var p = palette(scope), have = {};
    p.forEach(function (c) { have[c.hex] = true; });
    var added = incoming.filter(function (c) { return c && c.hex && !have[c.hex]; });
    if (added.length) writeJSON(paletteFile(scope), p.concat(added));
  }
  function importFrom(src) {
    if (!fs.existsSync(path.join(src, "harsh-library.json"))) throw new Error("That folder isn't a Comp Vault export. Pick the folder that has harsh-library.json inside.");
    var scopes = [{}];
    dirs(path.join(src, "Clients")).forEach(function (c) {
      scopes.push({ client: c });
      dirs(path.join(src, "Clients", c, "Projects")).forEach(function (p) { scopes.push({ client: c, project: p }); });
    });
    var count = 0;
    scopes.forEach(function (s) {
      var from = scopeDirIn(src, s);
      if (s.client && !s.project) {
        fs.mkdirSync(path.join(scopeDir(s), "Items"), { recursive: true });
        var meta = readJSON(path.join(from, "client.json"), null);
        if (meta && !fs.existsSync(path.join(scopeDir(s), "client.json"))) writeJSON(path.join(scopeDir(s), "client.json"), meta);
      }
      if (!s.client || !s.project) mergePalette(s, readJSON(path.join(from, "palette.json"), []));
      dirs(path.join(from, "Items")).forEach(function (d) {
        if (!fs.existsSync(path.join(from, "Items", d, "item.json"))) return;
        var dest = path.join(scopeDir(s), "Items", d);
        if (fs.existsSync(dest)) return;
        copyDir(path.join(from, "Items", d), dest);
        count++;
      });
    });
    return count;
  }

  // ---- versions: <item>/versions/<id>/ holds an older copy of everything in the item
  var ITEM_KEEP = ["name", "pinned", "tags", "createdAt"];
  function pick(meta, keys) { var o = {}; keys.forEach(function (k) { if (meta[k] !== undefined) o[k] = meta[k]; }); return o; }
  function moveContents(from, to, skip) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach(function (n) {
      if (skip.indexOf(n) !== -1) return;
      fs.renameSync(path.join(from, n), path.join(to, n));
    });
  }
  function archiveCurrent(dir) {
    var id = now().toString(36), vdir = path.join(dir, "versions", id), i = 2;
    while (fs.existsSync(vdir)) vdir = path.join(dir, "versions", id + "-" + i++);
    moveContents(dir, vdir, ["versions", ".updating"]);
    return path.basename(vdir);
  }
  function beginUpdate(dir) {
    var meta = readJSON(path.join(dir, "item.json"), null);
    if (!meta) throw new Error("That item is missing its details file, so it can't be updated.");
    var id = archiveCurrent(dir);
    fs.writeFileSync(path.join(dir, ".updating"), id);
    return pick(meta, ITEM_KEEP);
  }
  function finishUpdate(dir, keep, meta) {
    var out = Object.assign({}, meta, keep, { updatedAt: now() });
    delete out.inspect;
    writeJSON(path.join(dir, "item.json"), out);
    try { fs.unlinkSync(path.join(dir, ".updating")); } catch (e) {}
    return out;
  }
  function cancelUpdate(dir) {
    var id;
    try { id = fs.readFileSync(path.join(dir, ".updating"), "utf8"); } catch (e) { return; }
    fs.readdirSync(dir).forEach(function (n) { if (n !== "versions" && n !== ".updating") rmTree(path.join(dir, n)); });
    var vdir = path.join(dir, "versions", id);
    moveContents(vdir, dir, []);
    fs.rmdirSync(vdir);
    try { fs.rmdirSync(path.join(dir, "versions")); } catch (e) {}
    fs.unlinkSync(path.join(dir, ".updating"));
  }
  function listVersions(dir) {
    return dirs(path.join(dir, "versions")).map(function (id) {
      var m = readJSON(path.join(dir, "versions", id, "item.json"), {});
      return Object.assign({}, m, { id: id, savedAt: m.updatedAt || m.createdAt || 0 });
    }).sort(function (a, b) { return b.savedAt - a.savedAt; });
  }
  function restoreVersion(dir, id) {
    var vdir = path.join(dir, "versions", id);
    if (!fs.existsSync(vdir)) throw new Error("That version is gone.");
    var cur = readJSON(path.join(dir, "item.json"), {});
    var keep = pick(cur, ["name", "pinned", "tags"]);
    archiveCurrent(dir);
    moveContents(vdir, dir, []);
    fs.rmdirSync(vdir);
    var meta = readJSON(path.join(dir, "item.json"), {});
    writeJSON(path.join(dir, "item.json"), Object.assign(meta, keep, { updatedAt: now() }));
  }

  // ---- tags
  function cleanTag(t) { return String(t || "").replace(/\s+/g, " ").trim().slice(0, 30); }
  function setTags(dir, tags) {
    var seen = {}, out = [];
    (tags || []).forEach(function (t) {
      var c = cleanTag(t), k = c.toLowerCase();
      if (c && !seen[k]) { seen[k] = true; out.push(c); }
    });
    saveItem(dir, { tags: out });
    return out;
  }
  function allTags() {
    var counts = {}, label = {};
    listAll().reverse().forEach(function (it) {
      (it.tags || []).forEach(function (t) {
        var k = t.toLowerCase();
        if (!label[k]) label[k] = t;
        counts[k] = (counts[k] || 0) + 1;
      });
    });
    return Object.keys(counts).map(function (k) { return { tag: label[k], count: counts[k] }; })
      .sort(function (a, b) { return b.count - a.count || byName(a.tag, b.tag); });
  }

  // ---- whole-library search
  function listAll() { return listRecent(Infinity); }
  function placeLabel(sc) { return !sc.client ? "Common" : sc.project ? sc.client + " " + sc.project : sc.client; }
  var KIND_WORDS = { animation: "animation comp", layers: "layers", image: "image logo screenshot", clip: "clip video" };
  function search(q) {
    var words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return listAll().filter(function (it) {
      var hay = [it.name, placeLabel(it.scope), KIND_WORDS[it.kind] || "", (it.fonts || []).join(" "), it.source || "", (it.tags || []).join(" ")].join(" ").toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }

  // ---- storage
  // Walks a folder; each file is counted once even if it's hard-linked in several items.
  function walk(dir, fn) {
    var list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    list.forEach(function (d) {
      var p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p, fn); else fn(p);
    });
  }
  function sizeOf(dir, seen) {
    var total = 0;
    walk(dir, function (f) {
      try {
        var st = fs.statSync(f), key = st.dev + ":" + st.ino;
        if (seen && st.ino) { if (seen[key]) return; seen[key] = true; }
        total += st.size;
      } catch (e) {}
    });
    return total;
  }
  function storageReport() {
    var seen = {}, places = [], largest = [];
    var common = path.join(root(), "Common");
    places.push({ label: "Common", scope: {}, bytes: sizeOf(common, seen) });
    dirs(path.join(root(), "Clients")).sort(byName).forEach(function (c) {
      places.push({ label: c, scope: { client: c }, bytes: sizeOf(path.join(root(), "Clients", c), seen) });
    });
    allScopes().forEach(function (sc) {
      listItems(sc).forEach(function (it) { largest.push({ name: it.name, dir: it.dir, scope: sc, bytes: sizeOf(it.dir, null) }); });
    });
    largest.sort(function (a, b) { return b.bytes - a.bytes; });
    var trash = sizeOf(path.join(root(), ".Trash"), null);
    var total = places.reduce(function (n, p) { return n + p.bytes; }, 0);
    return { total: total, trash: trash, places: places, largest: largest.slice(0, 8) };
  }
  function rmTree(p) {
    var st;
    try { st = fs.lstatSync(p); } catch (e) { return; }
    if (st.isDirectory()) {
      fs.readdirSync(p).forEach(function (n) { rmTree(path.join(p, n)); });
      fs.rmdirSync(p);
    } else fs.unlinkSync(p);
  }
  function emptyTrash() {
    var trash = path.join(root(), ".Trash"), freed = sizeOf(trash, null);
    dirs(trash).concat((function () { try { return fs.readdirSync(trash).filter(function (n) { return n.charAt(0) === "."; }); } catch (e) { return []; } })())
      .forEach(function (n) { rmTree(path.join(trash, n)); });
    return freed;
  }

  // Identical files (same size and SHA-1) across saved items. Keeping one copy and
  // hard-linking the rest saves space while every item still opens on its own.
  function hashFile(f) {
    var hsh = crypto.createHash("sha1"), fd = fs.openSync(f, "r"), buf = Buffer.alloc(1 << 20), n;
    try { while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hsh.update(n === buf.length ? buf : buf.slice(0, n)); }
    finally { fs.closeSync(fd); }
    return hsh.digest("hex");
  }
  function duplicateGroups() {
    if (!crypto) throw new Error("Duplicate check needs Node's crypto module.");
    var bySize = {};
    allScopes().forEach(function (sc) {
      listItems(sc).forEach(function (it) {
        walk(it.dir, function (f) {
          if (/item\.json$/.test(f)) return;
          var st = fs.statSync(f);
          if (st.size < 1024) return;
          (bySize[st.size] = bySize[st.size] || []).push({ file: f, size: st.size, key: st.dev + ":" + st.ino });
        });
      });
    });
    var groups = [];
    Object.keys(bySize).forEach(function (sz) {
      var list = bySize[sz];
      var inodes = {};
      list.forEach(function (x) { inodes[x.key] = true; });
      if (Object.keys(inodes).length < 2) return;
      var byHash = {};
      list.forEach(function (x) { x.hash = hashFile(x.file); (byHash[x.hash] = byHash[x.hash] || []).push(x); });
      Object.keys(byHash).forEach(function (hh) {
        var g = byHash[hh], keys = {};
        g.forEach(function (x) { keys[x.key] = true; });
        if (Object.keys(keys).length > 1) groups.push(g);
      });
    });
    return groups;
  }
  function findDuplicates() {
    var groups = duplicateGroups(), bytes = 0;
    groups.forEach(function (g) { var keys = {}; g.forEach(function (x) { keys[x.key] = true; }); bytes += (Object.keys(keys).length - 1) * g[0].size; });
    return { groups: groups.length, bytes: bytes };
  }
  function dedupe() {
    var saved = 0, failed = 0;
    duplicateGroups().forEach(function (g) {
      var keep = g[0];
      g.slice(1).forEach(function (x) {
        if (x.key === keep.key) return;
        var tmp = x.file + ".harsh-link";
        try {
          fs.linkSync(keep.file, tmp);
          fs.renameSync(tmp, x.file);
          // count each inode's bytes once
          if (!keep["done" + x.key]) { keep["done" + x.key] = true; saved += x.size; }
        } catch (e) { failed++; try { fs.unlinkSync(tmp); } catch (e2) {} }
      });
    });
    return { saved: saved, failed: failed };
  }

  function normalHex(hex) {
    var h = String(hex || "").trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, "$&$&");
    if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error("Use a 6-digit colour code like #1C83FF.");
    return "#" + h.toUpperCase();
  }
  function paletteFile(scope) { return path.join(scopeDir(scope), "palette.json"); }
  function palette(scope) { return readJSON(paletteFile(scope), []); }
  function addColor(scope, name, hex) {
    var p = palette(scope);
    var h = normalHex(hex);
    p.push({ name: cleanName(name) || h, hex: h });
    writeJSON(paletteFile(scope), p);
    return p;
  }
  function removeColor(scope, index) {
    var p = palette(scope);
    p.splice(index, 1);
    writeJSON(paletteFile(scope), p);
    return p;
  }

  function clientMeta(client) { return readJSON(path.join(scopeDir({ client: client }), "client.json"), {}); }
  function setClientMeta(client, patch) {
    var file = path.join(scopeDir({ client: client }), "client.json");
    writeJSON(file, Object.assign(readJSON(file, {}), patch));
  }

  // Cheap fingerprint of what a view shows, so the panel can refresh when
  // another window (or another PC via Drive/Dropbox) changes the library.
  function stamp(p) { try { var s = fs.statSync(p); return s.mtimeMs + ":" + s.size; } catch (e) { return "-"; } }
  function signature(scope) {
    var dir = scopeDir(scope), items = path.join(dir, "Items");
    var parts = [root(), stamp(dir), stamp(items), stamp(path.join(dir, "palette.json")),
      stamp(path.join(root(), "Clients")), stamp(path.join(dir, "Projects"))];
    dirs(items).forEach(function (d) { parts.push(d + stamp(path.join(items, d, "item.json")) + stamp(path.join(items, d, "preview"))); });
    return parts.join("|");
  }

  return {
    root: root, setRoot: setRoot, cleanName: cleanName, scopeDir: scopeDir,
    createClient: createClient, createProject: createProject, renameClient: renameClient, renameProject: renameProject, trashClient: trashClient, trashProject: trashProject, listClients: listClients, listProjects: listProjects,
    newItem: newItem, saveItem: saveItem, readItem: readItem, listItems: listItems,
    renameItem: renameItem, trashItem: trashItem, moveItem: moveItem, setPinned: setPinned, listPinned: listPinned, listRecent: listRecent, allScopes: allScopes, exportTo: exportTo, beginUpdate: beginUpdate, finishUpdate: finishUpdate, cancelUpdate: cancelUpdate, listVersions: listVersions, restoreVersion: restoreVersion, setTags: setTags, allTags: allTags, listAll: listAll, search: search, storageReport: storageReport, emptyTrash: emptyTrash, findDuplicates: findDuplicates, dedupe: dedupe, exportItems: exportItems, importFrom: importFrom,
    palette: palette, addColor: addColor, removeColor: removeColor, normalHex: normalHex,
    clientMeta: clientMeta, setClientMeta: setClientMeta, signature: signature
  };
};
