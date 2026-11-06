// Talks to the host app (AE / Premiere) and to Node.
var cep = typeof window !== "undefined" ? window.__adobe_cep__ : null;

function nodeRequire() {
  var H = window.Harsh || {};
  return H.require || (typeof require === "function" ? require : null) || (window.cep_node && window.cep_node.require) || null;
}

function hostApp() {
  try { return JSON.parse(cep.getHostEnvironment()).appName; } catch (e) { return "AEFT"; }
}

// Inside Harsh, commands go through Harsh's evalRaw (setEval): every character above 0x7E is
// sent as a \uXXXX escape, and the updater knows a command is running.
var runScript = null;
function setEval(fn) { runScript = fn; }
function evalHost(script) {
  if (runScript) return runScript(script);
  return new Promise(function (resolve) {
    if (!cep) return resolve("EvalScript error.");
    cep.evalScript(script, resolve);
  });
}

function literal(v) {
  return JSON.stringify(v).replace(/[\u007f-\uffff]/g, function (c) { return "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4); });
}

function createHost(hostScriptPath) {
  var loaded = null;
  function load() {
    if (!loaded) {
      loaded = evalHost("$.evalFile(" + literal(hostScriptPath) + "); typeof $.HarshCompVault").then(function (r) {
        if (r !== "object") { loaded = null; throw new Error("Couldn't load Comp Vault. Restart the app and try again."); }
      });
    }
    return loaded;
  }
  return function call(name, args) {
    return load().then(function () {
      return evalHost("$.HarshCompVault.call(" + literal(name) + "," + literal(args || {}) + ")");
    }).then(function (raw) {
      var res;
      try { res = JSON.parse(raw); } catch (e) { throw new Error("The app didn't answer (" + String(raw).slice(0, 80) + ")."); }
      if (!res.ok) throw new Error(res.error);
      return res.data;
    });
  };
}

module.exports = { nodeRequire: nodeRequire, hostApp: hostApp, createHost: createHost, setEval: setEval, literal: literal };
