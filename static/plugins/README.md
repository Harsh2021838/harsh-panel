# Plugins

Drop a `.js` file here to add a tool without rebuilding the panel. It appears in the
folder you name after Premiere / After Effects restarts.

```js
(function () {
  Harsh.register({
    folder: "tools",             // tools | assets | client-dna | qc
    hosts: ["PPRO", "AEFT"],
    tool: { id: "my-tool", name: "My tool", description: "What it does, in one line" },
    create: function (React) {
      var h = React.createElement;
      return function MyTool() {
        return h("div", { className: "tqc" }, h("button", { className: "primary" }, "Run"));
      };
    }
  });
})();
```

`Harsh.require` gives Node (fs, path, https). For bigger tools, add them to the source
project under `src/tools/` instead (that's how Text QC is built).
