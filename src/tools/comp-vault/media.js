// Copies files into the library, resizing images to a fixed size when asked.
var fitBox = require("./resize.js").fitBox;

var RESIZABLE = /\.(png|jpe?g|webp|bmp|gif)$/i;
var IMAGE = /\.(png|jpe?g|webp|bmp|gif|tiff?|psd|svg|ai|eps|tga|exr)$/i;
var MAX_SIDE = 16384;

function fileURL(p, version) {
  var u = String(p).replace(/\\/g, "/");
  if (u.charAt(0) !== "/") u = "/" + u;
  return "file://" + encodeURI(u).replace(/#/g, "%23").replace(/\?/g, "%3F") + (version ? "?v=" + version : "");
}

var MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp" };

// Read through Node and load as a blob: URL, so the canvas is never "tainted" by file:// access.
function loadImage(fs, p) {
  return new Promise(function (resolve, reject) {
    var url;
    try {
      var bytes = fs.readFileSync(p);
      var ext = (p.match(/\.[^.\\/]+$/) || [""])[0].toLowerCase();
      url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] || "application/octet-stream" }));
    } catch (e) { return reject(new Error("Couldn't open " + p.split(/[\\/]/).pop() + ".")); }
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Couldn't read " + p.split(/[\\/]/).pop() + " as an image.")); };
    img.src = url;
  });
}

function canvasToBuffer(canvas) {
  return new Promise(function (resolve, reject) {
    canvas.toBlob(function (blob) {
      if (!blob) return reject(new Error("The image is too large to resize."));
      blob.arrayBuffer().then(function (ab) { resolve(Buffer.from(ab)); }, reject);
    }, "image/png");
  });
}

// size: { w, h, mode: "crop" | "tall" | "original" }
// Returns { file, width, height, kind } written into dir.
function addFile(deps, src, dir, size) {
  var fs = deps.fs, path = deps.path;
  var ext = path.extname(src).toLowerCase();
  var isImage = IMAGE.test(src);
  if (!isImage || !RESIZABLE.test(src) || !size || size.mode === "original") {
    var name = (isImage ? "image" : "media") + ext;
    fs.copyFileSync(src, path.join(dir, name));
    if (!isImage || !RESIZABLE.test(src)) return Promise.resolve({ file: name, kind: isImage ? "image" : "clip" });
    return loadImage(fs, src).then(function (img) {
      return { file: name, kind: "image", width: img.naturalWidth, height: img.naturalHeight };
    }, function () { return { file: name, kind: "image" }; });
  }
  return loadImage(fs, src).then(function (img) {
    var box = fitBox({ w: img.naturalWidth, h: img.naturalHeight }, size);
    var h = Math.min(box.h, MAX_SIDE);
    var c = document.createElement("canvas");
    c.width = box.w; c.height = h;
    var g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, box.dx, box.dy, box.dw, box.dh);
    return canvasToBuffer(c).then(function (buf) {
      fs.writeFileSync(path.join(dir, "image.png"), buf);
      return { file: "image.png", kind: "image", width: box.w, height: h, trimmed: h < box.h };
    });
  });
}

module.exports = { addFile: addFile, fileURL: fileURL, IMAGE: IMAGE };
