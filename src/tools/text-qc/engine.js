// Text QC engine: LanguageTool batching, cache, dictionary, classification, HTML report.
// Runs in the panel (Chromium + Node), never inside After Effects / Premiere.
import { nodeRequire, host } from "../../host.js";
import { toolDir } from "../../library.js";

export var lastError = { message: "" };
// =================================================================== utils
var req = nodeRequire;
var fs = req("fs"), pathMod = req("path");
var Buffer = typeof globalThis.Buffer !== "undefined" ? globalThis.Buffer : req("buffer").Buffer;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function pad(n) { return n < 10 ? "0" + n : "" + n; }
function stamp(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function lsGet(k, d) { try { var v = localStorage.getItem("harsh.textqc." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem("harsh.textqc." + k, JSON.stringify(v)); } catch (e) {} }
function fmtSecs(ms) { var s = ms / 1000; return s < 60 ? s.toFixed(1) + "s" : Math.floor(s / 60) + "m " + Math.round(s % 60) + "s"; }

// ------------------------------------------------------------- files
var paths = null;
// Text QC keeps its files in the Harsh Library: Tools/Text QC/ (dictionary, reports, memory of checked text).
function getPaths() {
  if (paths) return Promise.resolve(paths);
  return toolDir("Text QC").then(function (work) {
    var reports = pathMod.join(work, "Reports");
    try { fs.mkdirSync(reports, { recursive: true }); } catch (e) {}
    paths = {
      work: work, reports: reports,
      dict: pathMod.join(work, "Dictionary.txt"),
      cache: pathMod.join(work, "checked-text.json"),
      reportPref: pathMod.join(work, "report_location.txt")
    };
    if (!fs.existsSync(paths.dict)) {
      // Bring over the dictionary from the old AE Text QC panel / Harsh 2.x, if there is one.
      return host("info").then(function (info) {
        var old = pathMod.join(info.documents, "AE_TextQC", "custom_dictionary.txt");
        if (fs.existsSync(old)) fs.copyFileSync(old, paths.dict);
        else fs.writeFileSync(paths.dict, "# Text QC dictionary\n# One word per line. These words are never flagged.\n# Example:\n# LeanSpark\n", "utf8");
        return paths;
      }).catch(function () { return paths; });
    }
    return paths;
  });
}
/** Call after the library moves. */
export function forgetPaths() { paths = null; cacheMem = null; }
function reportDir() {
  try {
    var p = fs.readFileSync(paths.reportPref, "utf8").replace(/[\r\n]/g, "");
    if (p && fs.existsSync(p)) return p;
  } catch (e) {}
  return paths.reports;
}
function loadDict() {
  var d = {};
  try {
    fs.readFileSync(paths.dict, "utf8").split(/\r?\n/).forEach(function (l) {
      l = l.trim();
      if (l && l.charAt(0) !== "#") d[l.toLowerCase()] = true;
    });
  } catch (e) {}
  return d;
}
function addToDict(word) {
  var cur = "";
  try { cur = fs.readFileSync(paths.dict, "utf8"); } catch (e) {}
  fs.writeFileSync(paths.dict, cur + (cur && !/\n$/.test(cur) ? "\n" : "") + word + "\n", "utf8");
}
var cacheMem = null;
function loadCache() {
  if (cacheMem) return cacheMem;
  try { cacheMem = JSON.parse(fs.readFileSync(paths.cache, "utf8")); } catch (e) { cacheMem = {}; }
  return cacheMem;
}
function saveCache() {
  if (!cacheMem) return;
  var keys = Object.keys(cacheMem);
  if (keys.length > 30000) keys.slice(0, keys.length - 30000).forEach(function (k) { delete cacheMem[k]; });
  try { fs.writeFileSync(paths.cache, JSON.stringify(cacheMem), "utf8"); } catch (e) {}
}

// ------------------------------------------------------- LanguageTool
var PUBLIC_API = "https://api.languagetool.org";
// Rules that look across paragraphs; since we pack many texts together they'd give false hits.
var DISABLED_RULES = "PARAGRAPH_REPEAT_BEGINNING_RULE,ENGLISH_WORD_REPEAT_BEGINNING_RULE,PUNCTUATION_PARAGRAPH_END,EN_UNPAIRED_BRACKETS,EN_UNPAIRED_QUOTES";
var SEP = "\n\n";

// AE line breaks (\r, \u0003) become spaces so a title split over two lines reads as one.
// Same length, so offsets still point at the original text.
function normalize(t) { return t.replace(/[\r\n\t\u0003\u2028\u2029]/g, " "); }

// The browser's fetch, not Node's https: Node network callbacks inside the panel can crash
// Premiere's panel engine (CEPHtmlEngine).
function postForm(url, params, timeoutMs) {
  var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs || 60000);
  return fetch(url, {
    method: "POST", signal: ctl ? ctl.signal : undefined,
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: new URLSearchParams(params).toString()
  }).then(function (res) {
    return res.text().then(function (body) { clearTimeout(timer); return { status: res.status, body: body }; });
  }, function (e) {
    clearTimeout(timer);
    throw new Error(e && e.name === "AbortError" ? "Request timed out" : (e && e.message) || "Network error");
  });
}

function limitsFor(settings) {
  var isPublic = !settings.server || settings.server.indexOf("api.languagetool.org") !== -1;
  if (!isPublic) return { maxChars: 60000, perMinReq: 1e9, perMinChars: 1e12, parallel: 4 };
  if (settings.apiKey) return { maxChars: 50000, perMinReq: 70, perMinChars: 280000, parallel: 2 };
  // Free public API: 20 requests, 75 KB per minute, 20 KB per request.
  return { maxChars: 12000, perMinReq: 18, perMinChars: 65000, parallel: 1 };
}

// texts: array of unique normalized strings. Returns { results: {text: matches[]}, failed: n }
function checkTexts(texts, settings, onProgress, token) {
  var lim = limitsFor(settings);
  var server = (settings.server || PUBLIC_API).replace(/\/+$/, "");
  var url = server + (/\/v2$/.test(server) ? "/check" : "/v2/check");

  // Pack texts into batches.
  var batches = [], cur = [], curLen = 0;
  texts.forEach(function (t) {
    if (cur.length && curLen + SEP.length + t.length > lim.maxChars) { batches.push(cur); cur = []; curLen = 0; }
    cur.push(t); curLen += t.length + SEP.length;
  });
  if (cur.length) batches.push(cur);

  var results = {}, failed = 0, done = 0;
  var sent = []; // {t, n} in the last minute
  function waitForSlot(n) {
    var now = Date.now();
    sent = sent.filter(function (s) { return now - s.t < 60000; });
    var chars = sent.reduce(function (a, s) { return a + s.n; }, 0);
    if (sent.length < lim.perMinReq && chars + n <= lim.perMinChars) { sent.push({ t: now, n: n }); return Promise.resolve(); }
    var wait = 60000 - (now - sent[0].t) + 250;
    onProgress(done, texts.length, "Waiting " + Math.ceil(wait / 1000) + "s for the free API limit...");
    return sleep(Math.min(wait, 5000)).then(function () { return token.cancelled ? null : waitForSlot(n); });
  }

  function runBatch(batch, attempt) {
    if (token.cancelled) return Promise.resolve();
    var text = batch.join(SEP);
    var params = { text: text, language: settings.lang || "en-US", disabledRules: DISABLED_RULES };
    if (settings.username && settings.apiKey) { params.username = settings.username; params.apiKey = settings.apiKey; }
    if ((settings.lang || "") === "auto") params.preferredVariants = "en-US";
    return waitForSlot(text.length).then(function () {
      if (token.cancelled) return null;
      return postForm(url, params);
    }).then(function (res) {
      if (!res) return;
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 4) throw new Error("HTTP " + res.status);
        onProgress(done, texts.length, res.status === 429 ? "API busy, retrying in 20s..." : "Server error, retrying...");
        return sleep(res.status === 429 ? 20000 : 3000).then(function () { return runBatch(batch, attempt + 1); });
      }
      if (res.status === 413 && batch.length > 1) {
        var mid = Math.floor(batch.length / 2);
        return runBatch(batch.slice(0, mid), 0).then(function () { return runBatch(batch.slice(mid), 0); });
      }
      if (res.status !== 200) throw new Error("HTTP " + res.status + ": " + res.body.slice(0, 150));
      var data = JSON.parse(res.body);
      // Map each match back to the text it belongs to.
      var starts = [], pos = 0;
      batch.forEach(function (t) { starts.push(pos); results[t] = []; pos += t.length + SEP.length; });
      (data.matches || []).forEach(function (m) {
        var lo = 0, hi = batch.length - 1;
        while (lo < hi) { var md = (lo + hi + 1) >> 1; if (starts[md] <= m.offset) lo = md; else hi = md - 1; }
        var t = batch[lo], off = m.offset - starts[lo];
        if (off < 0 || off + m.length > t.length) return; // spans a separator: ignore
        results[t].push({
          offset: off, length: m.length, message: m.message || "",
          suggestions: (m.replacements || []).slice(0, 3).map(function (r) { return r.value; }),
          ruleId: m.rule ? m.rule.id : "", categoryId: m.rule && m.rule.category ? m.rule.category.id : ""
        });
      });
      done += batch.length;
      onProgress(done, texts.length, "Checking...");
    }).catch(function (e) {
      if (attempt < 2 && !/^HTTP/.test(e.message)) {
        return sleep(2000).then(function () { return runBatch(batch, attempt + 1); });
      }
      failed += batch.length; done += batch.length;
      lastError.message = e.message;
      onProgress(done, texts.length, "A request failed: " + e.message);
    });
  }

  var queue = batches.slice();
  function worker() {
    if (!queue.length || token.cancelled) return Promise.resolve();
    return runBatch(queue.shift(), 0).then(worker);
  }
  var workers = [];
  for (var i = 0; i < Math.min(lim.parallel, batches.length); i++) workers.push(worker());
  return Promise.all(workers).then(function () { return { results: results, failed: failed, batches: batches.length }; });
}

// ------------------------------------------------------ classification
var CATS = [
  { id: "typo", label: "Typos", color: "#ff6b5e", on: true, hint: "Misspelled words. Fix these." },
  { id: "garbage", label: "Odd characters", color: "#f2a33a", on: true, hint: "Invisible characters, missing glyphs, double spaces or doubled punctuation." },
  { id: "grammar", label: "Grammar", color: "#b794ff", on: true, hint: "Sentence problems. Worth a look." },
  { id: "caps", label: "Capitals", color: "#59a8ff", on: false, hint: "Capital letters. Often a style choice in titles." },
  { id: "unknown", label: "Unknown words", color: "#9a9a9a", on: false, hint: "Names, brands and jargon. Add them to the dictionary to stop seeing them." }
];
var CAT_BY_ID = {};
CATS.forEach(function (c) { CAT_BY_ID[c.id] = c; });

var INVISIBLE = /[\u0000-\u0002\u0004-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2060\uFEFF\uFFFD]/g;
function localIssues(original) {
  var out = [], m;
  INVISIBLE.lastIndex = 0;
  while ((m = INVISIBLE.exec(original))) {
    var c = m[0].charCodeAt(0);
    out.push({
      offset: m.index, length: 1, suggestions: [""], ruleId: "HARSH_INVISIBLE", categoryId: "GARBAGE",
      message: c === 0xFFFD ? "Missing character (font can't show it, or a bad paste)." : "Invisible character U+" + ("000" + c.toString(16).toUpperCase()).slice(-4) + " (usually from copy-paste)."
    });
  }
  return out;
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  var prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function classify(iss, bad) {
  var ruleId = (iss.ruleId || "").toUpperCase(), cat = (iss.categoryId || "").toUpperCase(), msg = (iss.message || "").toLowerCase();
  if (cat === "GARBAGE") return "garbage";
  if (/^\s+$/.test(bad) || /^[,.;:!?]{2,}$/.test(bad) || ruleId.indexOf("WHITESPACE") !== -1 && ruleId.indexOf("SENTENCE") === -1) return "garbage";
  if (ruleId.indexOf("UPPERCASE_SENTENCE_START") !== -1 || ruleId.indexOf("SENTENCE_WHITESPACE") !== -1 || cat === "CASING" || msg.indexOf("uppercase") !== -1 || msg.indexOf("capital") !== -1) return "caps";
  if (ruleId.indexOf("MORFOLOGIK") !== -1 || ruleId.indexOf("SPELLER") !== -1 || cat === "TYPOS") {
    // Capitalised words are often names, but titles capitalise real typos too ("Prformer").
    // If the top suggestion is a letter or two away, it's a typo.
    var near = (iss.suggestions || []).some(function (sg) { return sg && bad.length >= 4 && editDistance(bad.toLowerCase(), sg.toLowerCase()) <= 2; });
    if (/^[A-Z]/.test(bad) && near && !/^[A-Z]+$/.test(bad)) return "typo";
    if (/^[A-Z]/.test(bad) || /[-']/.test(bad)) return "unknown";
    return "typo";
  }
  return "grammar";
}

// True when a "should start with a capital" hit is really the second half of a split sentence:
// at the start of the text (after quotes, dashes or dots), or after a line break whose line
// doesn't end a sentence.
function splitSentence(text, offset) {
  var before = text.slice(0, offset);
  if (/^[\s"'\u201C\u2018(\[\-\u2013\u2014\u2026.,:;]*$/.test(before)) return true;
  var m = /(\S)[^\S\r\n\u0003\u2028\u2029]*[\r\n\u0003\u2028\u2029][\s"'\u201C\u2018\-\u2013\u2014\u2026]*$/.exec(before);
  return !!(m && !/[.!?\u2026]/.test(m[1]));
}

// Turn per-text results into issue groups (same word, same text = one group, many places).
function buildGroups(items, results, dict) {
  var groups = {}, list = [];
  items.forEach(function (it) {
    var norm = normalize(it.text);
    var matches = (results[norm] || []).concat(localIssues(it.text));
    matches.forEach(function (m) {
      var bad = it.text.substr(m.offset, m.length);
      if (m.ruleId !== "HARSH_INVISIBLE" && dict[bad.toLowerCase()]) return;
      // A layer or caption that starts in lower case is usually the second line of a sentence
      // split across layers ("...an entrepreneur" / "isn't a working solution,"). Don't flag it.
      // The same goes for a sentence broken over two lines inside one layer to fit the frame:
      // a line that follows one without . ! or ? is the same sentence, so no capital is needed.
      if (/UPPERCASE_SENTENCE_START/i.test(m.ruleId) && splitSentence(it.text, m.offset)) return;
      // On-screen lines rarely end in a full stop; don't ask for one.
      if (/PUNCTUATION_PARAGRAPH_END|MISSING_SENTENCE_TERMINATOR/i.test(m.ruleId)) return;
      var cat = classify(m, bad);
      var key = cat + "|" + m.offset + "|" + m.ruleId + "|" + it.text;
      var g = groups[key];
      if (!g) {
        g = groups[key] = { id: list.length, cat: cat, bad: bad, text: it.text, offset: m.offset, length: m.length,
          message: m.message, suggestions: m.suggestions || [], ruleId: m.ruleId, places: [] };
        list.push(g);
      }
      g.places.push(it);
    });
  });
  var order = { typo: 0, garbage: 1, grammar: 2, caps: 3, unknown: 4 };
  list.sort(function (a, b) { return order[a.cat] - order[b.cat] || b.places.length - a.places.length; });
  return list;
}

// ---------------------------------------------------------- report
function buildReportHtml(run, groups) {
  var perProj = {}, compStats = {};
  run.items.forEach(function (it) {
    var p = perProj[it.project] || (perProj[it.project] = { name: it.project, comps: {}, layers: 0, serious: 0, total: 0 });
    p.comps[it.container] = 1; p.layers++;
  });
  var buckets = { typo: [], garbage: [], grammar: [], caps: [], unknown: [] };
  var anchorN = 0;
  groups.forEach(function (g) {
    g.places.forEach(function (it) {
      var ck = it.project + "||" + it.container;
      var cs = compStats[ck] || (compStats[ck] = { project: it.project, comp: it.container, serious: 0, total: 0, anchor: "c" + (anchorN++) });
      cs.total++; perProj[it.project].total++;
      if (g.cat === "typo" || g.cat === "garbage") { cs.serious++; perProj[it.project].serious++; }
      buckets[g.cat].push({ g: g, it: it, anchor: cs.anchor });
    });
  });
  var total = 0, serious = buckets.typo.length + buckets.garbage.length;
  CATS.forEach(function (c) { total += buckets[c.id].length; });
  var top = Object.keys(compStats).map(function (k) { return compStats[k]; })
    .sort(function (a, b) { return b.serious - a.serious || b.total - a.total; }).slice(0, 3);
  var compLabel = run.host === "PPRO" ? "Sequence" : "Comp";

  var css = "body{font-family:-apple-system,Segoe UI,sans-serif;background:#1a1a1a;color:#eee;padding:24px;max-width:1200px;margin:auto;line-height:1.4}" +
    "h1{border-bottom:2px solid #444;padding-bottom:8px;margin-top:0}h3{color:#7ed957;margin:28px 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:.05em}" +
    ".dash{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:800px){.dash{grid-template-columns:1fr}}" +
    ".card{background:#252525;padding:16px 18px;border-radius:8px}.card .t{color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px}" +
    ".card .r{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:#ccc}.card .r b{color:#fff}" +
    ".tbl{width:100%;border-collapse:collapse;background:#1f1f1f;border-radius:8px;overflow:hidden}.tbl th,.tbl td{padding:9px 12px;text-align:left;font-size:13px;border-bottom:1px solid #2a2a2a}" +
    ".tbl th{background:#252525;color:#aaa;font-size:11px;text-transform:uppercase}.num{text-align:right!important}.ser{color:#ff8a80;font-weight:600}.tbl a{color:#7ed957;text-decoration:none}" +
    "#search{width:100%;padding:10px 14px;background:#252525;border:1px solid #444;color:#eee;border-radius:6px;font-size:14px;box-sizing:border-box;margin-bottom:18px}" +
    ".b{margin-bottom:14px;border-radius:8px;background:#1f1f1f}.bh{padding:12px 16px;cursor:pointer;display:flex;align-items:center;gap:10px}.dot{width:10px;height:10px;border-radius:50%}" +
    ".bh .n{font-weight:600}.bh .c{color:#aaa;font-size:13px}.hint{padding:0 16px 8px;color:#888;font-size:12px;font-style:italic}.b.col .bb{display:none}.bb{padding:0 12px 12px}" +
    ".i{background:#252525;padding:10px 14px;margin-bottom:6px;border-radius:5px;border-left:3px solid #555}.i.hl{box-shadow:0 0 0 2px #7ed957}" +
    ".m{color:#888;font-size:11px;margin-bottom:4px}.bad{background:#e74c3c33;color:#ff8a80;padding:1px 6px;border-radius:3px;font-weight:600;font-family:Menlo,monospace;font-size:13px}" +
    ".sug{color:#7ed957;margin-left:8px;font-size:13px}.tx{color:#bbb;margin-top:4px;font-size:12px;font-style:italic}.msg{color:#888;font-size:11px;margin-top:3px}" +
    ".cp{margin-left:10px;background:#333;border:1px solid #555;color:#eee;padding:2px 8px;border-radius:4px;font-size:11px;cursor:pointer}.clean{color:#7ed957;padding:12px;background:#1c2a1c;border-radius:6px;text-align:center}.hid{display:none!important}";
  var h = '<!doctype html><html><head><meta charset="utf-8"><title>Text QC Report</title><style>' + css + "</style></head><body>";
  h += "<h1>Text QC Report</h1><div class=dash>";
  h += '<div class=card><div class=t>Run summary</div><div class=r><span>App</span><b>' + (run.host === "PPRO" ? "Premiere Pro" : "After Effects") + "</b></div>" +
    "<div class=r><span>Run time</span><b>" + fmtSecs(run.ms) + "</b></div><div class=r><span>Finished</span><b>" + esc(stamp(run.finished)) + "</b></div>" +
    "<div class=r><span>From cache</span><b>" + run.cached + " of " + run.unique + " unique texts</b></div><div class=r><span>API failures</span><b>" + run.failed + "</b></div></div>";
  h += '<div class=card><div class=t>Scanned</div><div class=r><span>Projects</span><b>' + Object.keys(perProj).length + "</b></div>" +
    "<div class=r><span>" + compLabel + "s with text</span><b>" + Object.keys(perProj).reduce(function (a, k) { return a + Object.keys(perProj[k].comps).length; }, 0) + "</b></div>" +
    "<div class=r><span>Text layers</span><b>" + run.items.length + "</b></div><div class=r><span>Issues found</span><b>" + total + " (" + serious + " serious)</b></div></div></div>";
  h += "<h3>Per-project breakdown</h3><table class=tbl><tr><th>Project</th><th class=num>" + compLabel + "s</th><th class=num>Layers</th><th class=num>Serious</th><th class=num>Total</th></tr>";
  Object.keys(perProj).forEach(function (k) { var p = perProj[k]; h += "<tr><td>" + esc(p.name) + "</td><td class=num>" + Object.keys(p.comps).length + "</td><td class=num>" + p.layers + "</td><td class='num ser'>" + p.serious + "</td><td class=num>" + p.total + "</td></tr>"; });
  h += "</table>";
  if (total) {
    h += "<h3>Top 3 " + compLabel.toLowerCase() + "s with most issues</h3><table class=tbl><tr><th>#</th><th>" + compLabel + "</th><th>Project</th><th class=num>Serious</th><th class=num>Total</th></tr>";
    top.forEach(function (c, i) { h += "<tr><td>" + (i + 1) + "</td><td><a href='#' onclick=\"hl('" + c.anchor + "');return false\">" + esc(c.comp) + "</a></td><td style='color:#888;font-size:12px'>" + esc(c.project) + "</td><td class='num ser'>" + c.serious + "</td><td class=num>" + c.total + "</td></tr>"; });
    h += "</table>";
  }
  h += '<h3>Issues by category</h3><input id=search placeholder="Filter by word, ' + compLabel.toLowerCase() + ' name or text...">';
  if (!total) h += "<div class=clean>No issues found across " + run.items.length + " text layers.</div>";
  else CATS.forEach(function (c) {
    var list = buckets[c.id];
    h += "<div class='b" + (c.on && list.length ? "" : " col") + "'><div class=bh onclick=\"this.parentNode.classList.toggle('col')\"><span class=dot style='background:" + c.color + "'></span><span class=n>" + c.label + "</span><span class=c>" + list.length + "</span></div>";
    h += "<div class=hint>" + esc(c.hint) + "</div><div class=bb>";
    if (!list.length) h += "<div style='color:#666;font-size:12px'>None.</div>";
    list.forEach(function (x) {
      var g = x.g, it = x.it;
      var shown = g.cat === "garbage" ? g.bad.replace(/[\s\S]/g, function (ch) { var cc = ch.charCodeAt(0); return cc < 33 || cc > 126 && cc < 161 || cc >= 0x200B && cc <= 0x200F || cc === 0xFEFF ? "[" + cc.toString(16).toUpperCase() + "]" : ch; }) : g.bad;
      h += "<div class=i style='border-left-color:" + c.color + "' data-a='" + x.anchor + "'><div class=m>" + esc(it.project) + " &mdash; " + esc(it.container) + (it.tc ? " at " + esc(it.tc) : "") + " / " + esc(it.layer) + "</div>" +
        "<span class=bad>" + esc(shown) + "</span>" + (g.suggestions.length && g.suggestions[0] ? "<span class=sug>&rarr; " + esc(g.suggestions.join(", ")) + "</span>" : "") +
        (c.id === "unknown" ? "<button class=cp onclick=\"navigator.clipboard.writeText(this.dataset.w);this.textContent='copied'\" data-w=\"" + esc(g.bad) + "\">copy</button>" : "") +
        "<div class=msg>" + esc(g.message) + "</div><div class=tx>\"" + esc(it.text) + "\"</div></div>";
    });
    h += "</div></div>";
  });
  h += "<script>document.getElementById('search').oninput=function(e){var q=e.target.value.toLowerCase();document.querySelectorAll('.i').forEach(function(el){el.classList.toggle('hid',!!q&&el.textContent.toLowerCase().indexOf(q)<0)});if(q)document.querySelectorAll('.b').forEach(function(b){b.classList.remove('col')})};" +
    "function hl(a){document.querySelectorAll('.b').forEach(function(b){b.classList.remove('col')});var m=document.querySelectorAll('[data-a=\"'+a+'\"]');m.forEach(function(x){x.classList.add('hl');setTimeout(function(){x.classList.remove('hl')},2500)});if(m[0])m[0].scrollIntoView({behavior:'smooth'})}</script></body></html>";
  return h;
}

function writeReport(run, groups) {
  var proj = (run.items[0] && run.items[0].project) || run.project || "report";
  proj = proj.replace(/\.(aep|prproj)$/i, "").replace(/[^a-zA-Z0-9_\- ]/g, "_").replace(/\s+/g, "_").slice(0, 40);
  var projects = {};
  run.items.forEach(function (it) { projects[it.project] = 1; });
  var n = Object.keys(projects).length;
  var d = run.finished;
  var name = "TextQC_" + proj + (n > 1 ? "_and_" + (n - 1) + "_more" : "") + "_" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes()) + ".html";
  var file = pathMod.join(reportDir(), name);
  fs.writeFileSync(file, buildReportHtml(run, groups), "utf8");
  return file;
}

function findAeps(dir, recursive, out) {
  out = out || [];
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  entries.forEach(function (e) {
    var full = pathMod.join(dir, e.name), lower = e.name.toLowerCase();
    if (e.isDirectory()) {
      if (recursive && lower.indexOf("auto-save") === -1 && lower.charAt(0) !== ".") findAeps(full, true, out);
    } else if (/\.aep$/.test(lower) && lower.indexOf("auto-save") === -1 && lower.indexOf(" copy") === -1 && lower.indexOf("._") !== 0) {
      out.push(full);
    }
  });
  return out;
}

export { sleep, fmtSecs, lsGet, lsSet, getPaths, reportDir, loadDict, addToDict, loadCache, saveCache,
  normalize, checkTexts, CATS, CAT_BY_ID, buildGroups, writeReport, findAeps, pathMod, fs };
export function getPathsSync() { return paths; }

// ------------------------------------- remembered "Ignore"s and "Corrected"s
// Kept per project in Tools/Text QC/ignored.json as { key: { s: "ignored" | "corrected", t: time } }.
// A re-check brings none of them back, but only for a while: they are forgotten when the app is
// restarted (each app session has its own scope, "project@session") or after REMEMBER_HOURS.
export const REMEMBER_HOURS = 5;
export function ignoreKey(g) { return [g.cat, g.ruleId, g.bad, normalize(g.text)].join("\u241F"); }
function ignoredFile() { return pathMod.join(paths.work, "ignored.json"); }
function readIgnored() { try { return JSON.parse(fs.readFileSync(ignoredFile(), "utf8")); } catch (e) { return {}; } }
const fresh = (v) => v && typeof v === "object" && Date.now() - v.t < REMEMBER_HOURS * 3600e3;
/** Map of key -> "ignored" | "corrected" still remembered for this project and session. */
export function loadHandled(scope) {
  const raw = readIgnored()[scope || "*"];
  const out = new Map();
  if (raw && !Array.isArray(raw)) for (const k of Object.keys(raw)) if (fresh(raw[k])) out.set(k, raw[k].s);
  return out;
}
/** Remember (state "ignored" / "corrected") or forget (state null) some keys. */
export function saveHandled(scope, keys, state) {
  const all = readIgnored();
  // Drop other sessions and anything too old.
  const session = String(scope || "").split("@").pop();
  for (const k of Object.keys(all)) if (k.indexOf("@") === -1 || k.split("@").pop() !== session) delete all[k];
  const cur = all[scope || "*"] && !Array.isArray(all[scope || "*"]) ? all[scope || "*"] : {};
  for (const k of Object.keys(cur)) if (!fresh(cur[k])) delete cur[k];
  keys.forEach((k) => { if (state) cur[k] = { s: state, t: Date.now() }; else delete cur[k]; });
  all[scope || "*"] = cur;
  try { fs.writeFileSync(ignoredFile(), JSON.stringify(all), "utf8"); } catch (e) {}
}
export function resetCache() { cacheMem = {}; saveCache(); }
