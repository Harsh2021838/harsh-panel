import React, { useEffect, useState } from "react";
import { hostApp, pickFiles } from "../host.js";
import { Brush, Copy, Folder, Link, Plus, Close, Download } from "../icons.jsx";
import {
  saveClient, removeClient, fileUrl, copyText, fontInstalled, openUrl, hostOf, normHex, validHex, hexToRgb, inkOn, lib, path,
} from "../library.js";

const isAE = hostApp === "AEFT";
const EMPTY = { name: "", founder: "", website: "", logo: "", colors: [{ name: "", hex: "" }, { name: "", hex: "" }, { name: "", hex: "" }],
  highlight: { name: "Highlight", hex: "" }, fonts: [{ name: "", role: "Headings" }, { name: "", role: "Body" }], notes: "" };

function Monogram({ client, size = 52 }) {
  const bg = (client.highlight && client.highlight.hex) || (client.colors && client.colors[0] && client.colors[0].hex) || "#444444";
  const letters = String(client.name || "?").split(/\s+/).map((w) => w.charAt(0)).join("").slice(0, 2).toUpperCase();
  return <span className="monogram" style={{ width: size, height: size, background: bg, color: inkOn(bg), fontSize: size * 0.38 }}>{letters}</span>;
}

export function ClientLogo({ client, size = 52 }) {
  const [broken, setBroken] = useState(false);
  if (!client.logo || broken) return <Monogram client={client} size={size} />;
  return <img className="logo-img" src={fileUrl(path.join(client.dir, client.logo))} width={size} height={size} alt={client.name + " logo"} onError={() => setBroken(true)} />;
}

// ===================================================================== view
function Swatch({ c, wide, onCopy, onApply }) {
  const hex = normHex(c.hex);
  return (
    <div className={"swatch" + (wide ? " wide" : "")}>
      <button className="swatch-chip" style={{ background: hex, color: inkOn(hex) }} onClick={() => onCopy(hex)} title={"Copy " + hex}>
        <span className="num">{hex}</span><Copy />
      </button>
      <div className="swatch-meta">
        <span className="trunc">{c.name || (wide ? "Highlight" : "Colour")}</span>
        {isAE && <button className="icon-btn small" onClick={() => onApply(hex)} aria-label={"Apply " + hex + " to selected layers"} title="Apply to selected layers"><Brush /></button>}
      </div>
    </div>
  );
}

function View({ client, onEdit, onAssets }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { setNote(""); setErr(""); }, [client.id]);
  const say = (m) => { setErr(""); setNote(m); };
  const copy = (hex) => say(copyText(hex) ? "Copied " + hex + "." : "Couldn’t copy. The code is " + hex + ".");
  const apply = (hex) => lib("applyColor", { rgb: hexToRgb(hex) }).then((r) => say(hex + " applied to " + r.changed + (r.changed === 1 ? " layer" : " layers") + ". Cmd/Ctrl+Z undoes it.")).catch((e) => { setNote(""); setErr(e.message); });
  const importLogo = () => lib("importFiles", { paths: [path.join(client.dir, client.logo)], bin: "Harsh / " + client.name }).then(() => say("Logo imported into the “Harsh / " + client.name + "” bin.")).catch((e) => setErr(e.message));
  const showFolder = () => lib("openFolder", { path: client.dir }).catch(() => { try { window.cep.util.openURLInDefaultBrowser(fileUrl(client.dir)); } catch (e) {} });

  return (
    <div className="dna">
      <div className="dna-head">
        <ClientLogo client={client} size={56} />
        <div className="dna-id">
          <h2 className="dna-name">{client.name}</h2>
          {client.founder && <p className="dim">{client.founder}, founder</p>}
          {client.website && <button className="link-btn" onClick={() => openUrl(client.website)}><Link /> {hostOf(client.website)}</button>}
        </div>
        <button className="ghost tight" onClick={onEdit}>Edit</button>
      </div>

      <div aria-live="polite">
        {note && <p className="msg good">{note}</p>}
        {err && <p className="msg bad">{err}</p>}
      </div>

      <section className="block">
        <h3 className="block-title">Colours <span className="dim">Click to copy{isAE ? "; the brush applies it to selected layers" : ""}</span></h3>
        {client.colors && client.colors.length ? (
          <div className="swatches">{client.colors.map((c, i) => <Swatch key={i} c={c} onCopy={copy} onApply={apply} />)}</div>
        ) : <p className="help">No brand colours yet.</p>}
        {client.highlight && client.highlight.hex && <Swatch c={client.highlight} wide onCopy={copy} onApply={apply} />}
      </section>

      <section className="block">
        <h3 className="block-title">Fonts</h3>
        {client.fonts && client.fonts.length ? (
          <ul className="fonts">
            {client.fonts.map((f, i) => {
              const ok = fontInstalled(f.name);
              return (
                <li key={i}>
                  <span className="font-sample" style={{ fontFamily: "\"" + f.name + "\", var(--font)" }}>Aa</span>
                  <span className="font-text">
                    <span className="font-name trunc" style={{ fontFamily: "\"" + f.name + "\", var(--font)" }}>{f.name}</span>
                    <span className="font-role">{f.role}{ok ? "" : " • "}{!ok && <span className="missing">Not installed on this computer</span>}</span>
                  </span>
                  <button className="icon-btn small" onClick={() => say(copyText(f.name) ? "Copied “" + f.name + "”." : f.name)} aria-label={"Copy font name " + f.name}><Copy /></button>
                </li>
              );
            })}
          </ul>
        ) : <p className="help">No fonts yet.</p>}
      </section>

      <section className="block">
        <h3 className="block-title">Logo and files</h3>
        <div className="inline">
          {client.logo && <button className="ghost tight" onClick={importLogo}><Download /> Import logo</button>}
          <button className="ghost tight" onClick={onAssets}>Open {client.name} assets</button>
          <button className="ghost tight" onClick={showFolder}><Folder /> Show folder</button>
        </div>
      </section>

      {client.notes && (
        <section className="block">
          <h3 className="block-title">Notes</h3>
          <p className="notes">{client.notes}</p>
        </section>
      )}
    </div>
  );
}

// ===================================================================== edit
function ColourRow({ c, onChange, onRemove, label }) {
  const hex = normHex(c.hex);
  const bad = c.hex && !validHex(c.hex);
  return (
    <div className="edit-row">
      <input type="color" aria-label={(label || "Colour") + " picker"} value={hex || "#888888"} onChange={(e) => onChange({ ...c, hex: e.target.value.toUpperCase() })} />
      <input className={"hex" + (bad ? " invalid" : "")} aria-label={(label || "Colour") + " code"} placeholder="#RRGGBB" spellCheck={false} autoComplete="off"
        value={c.hex} onChange={(e) => onChange({ ...c, hex: e.target.value })} />
      <input className="grow" aria-label={(label || "Colour") + " name"} placeholder={label ? "Name" : "Name, e.g. Spark orange"} autoComplete="off"
        value={c.name} onChange={(e) => onChange({ ...c, name: e.target.value })} />
      {onRemove && <button className="icon-btn small" onClick={onRemove} aria-label="Remove colour"><Close size={13} /></button>}
    </div>
  );
}

function Edit({ client, onSaved, onCancel, onRemoved }) {
  const [c, setC] = useState(() => JSON.parse(JSON.stringify({ ...EMPTY, ...(client || {}), highlight: (client && client.highlight) || EMPTY.highlight })));
  const [logoSource, setLogoSource] = useState(null);
  const [err, setErr] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = (k, v) => setC((x) => ({ ...x, [k]: v }));
  const setColour = (i, v) => set("colors", c.colors.map((x, j) => (j === i ? v : x)));
  const setFont = (i, v) => set("fonts", c.fonts.map((x, j) => (j === i ? v : x)));

  async function save() {
    if (!c.name.trim()) return setErr("Give the client a name.");
    const bad = c.colors.concat([c.highlight]).find((x) => x.hex && !validHex(x.hex));
    if (bad) return setErr("“" + bad.hex + "” isn’t a colour code. Use six hex digits, like #FF6A3D.");
    try {
      const site = c.website.trim();
      const out = { ...c, name: c.name.trim(), website: site && !/^https?:\/\//i.test(site) ? "https://" + site : site, colors: c.colors.map((x) => ({ name: x.name.trim(), hex: normHex(x.hex) })).filter((x) => x.hex),
        highlight: c.highlight.hex ? { name: c.highlight.name.trim() || "Highlight", hex: normHex(c.highlight.hex) } : null,
        fonts: c.fonts.map((f) => ({ name: f.name.trim(), role: f.role.trim() })).filter((f) => f.name) };
      onSaved(await saveClient(out, logoSource));
    } catch (e) { setErr("Couldn’t save: " + e.message); }
  }
  async function remove() {
    try { await removeClient(client); onRemoved(); } catch (e) { setErr(e.message); }
  }
  const logoPreview = logoSource ? fileUrl(logoSource) : client && client.logo ? fileUrl(path.join(client.dir, client.logo)) : null;

  return (
    <form className="edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h2 className="edit-title">{client ? "Edit " + client.name : "New client"}</h2>

      <label className="field"><span>Brand name</span>
        <input name="brand" autoComplete="off" value={c.name} placeholder="Lean Spark" onChange={(e) => set("name", e.target.value)} />
      </label>
      <label className="field"><span>Founder</span>
        <input name="founder" autoComplete="off" value={c.founder} placeholder="Founder’s name" onChange={(e) => set("founder", e.target.value)} />
      </label>
      <label className="field"><span>Website</span>
        <input name="website" type="text" inputMode="url" autoComplete="off" spellCheck={false} value={c.website} placeholder="leanspark.com" onChange={(e) => set("website", e.target.value)} />
      </label>

      <div className="field"><span>Logo</span>
        <div className="logo-pick">
          {logoPreview ? <img src={logoPreview} width="40" height="40" alt="" /> : <span className="logo-empty" aria-hidden="true">Logo</span>}
          <button type="button" className="ghost tight" onClick={() => { const f = pickFiles("Choose the logo (PNG, SVG, JPG, AI, PSD)", ""); if (f[0]) setLogoSource(f[0]); }}>{logoPreview ? "Change logo…" : "Choose logo…"}</button>
        </div>
      </div>

      <fieldset className="field group"><legend>Brand colours</legend>
        {c.colors.map((x, i) => <ColourRow key={i} c={x} onChange={(v) => setColour(i, v)} onRemove={() => set("colors", c.colors.filter((_, j) => j !== i))} />)}
        {c.colors.length < 6 && <button type="button" className="ghost tight add" onClick={() => set("colors", c.colors.concat([{ name: "", hex: "" }]))}><Plus /> Add colour</button>}
      </fieldset>

      <fieldset className="field group"><legend>Highlight colour <span className="dim">for highlighted words and accents in videos</span></legend>
        <ColourRow c={c.highlight} label="Highlight" onChange={(v) => set("highlight", v)} />
      </fieldset>

      <fieldset className="field group"><legend>Fonts</legend>
        {c.fonts.map((f, i) => (
          <div className="edit-row" key={i}>
            <input className="grow" aria-label="Font name" placeholder="Font name, e.g. Inter" autoComplete="off" spellCheck={false} value={f.name} onChange={(e) => setFont(i, { ...f, name: e.target.value })} />
            <input className="role" aria-label="Used for" placeholder="Used for" autoComplete="off" value={f.role} onChange={(e) => setFont(i, { ...f, role: e.target.value })} />
            <button type="button" className="icon-btn small" onClick={() => set("fonts", c.fonts.filter((_, j) => j !== i))} aria-label="Remove font"><Close size={13} /></button>
          </div>
        ))}
        {c.fonts.length < 6 && <button type="button" className="ghost tight add" onClick={() => set("fonts", c.fonts.concat([{ name: "", role: "" }]))}><Plus /> Add font</button>}
      </fieldset>

      <label className="field"><span>Notes</span>
        <textarea name="notes" rows="3" value={c.notes} placeholder="Tone, do’s and don’ts, logo rules…" onChange={(e) => set("notes", e.target.value)} />
      </label>

      {err && <p className="msg bad">{err}</p>}
      <div className="edit-acts">
        <button type="submit" className="primary">{client ? "Save changes" : "Add client"}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>

      {client && (
        <div className="danger">
          {!confirmRemove
            ? <button type="button" className="link-btn bad" onClick={() => setConfirmRemove(true)}>Remove this client…</button>
            : (
              <div className="confirm">
                <p>Remove {client.name}? Its folder and assets move to the library’s _Removed folder, so nothing is lost.</p>
                <div className="inline">
                  <button type="button" className="ghost tight danger-btn" onClick={remove}>Remove {client.name}</button>
                  <button type="button" className="ghost tight" onClick={() => setConfirmRemove(false)}>Keep</button>
                </div>
              </div>
            )}
        </div>
      )}
    </form>
  );
}

// ==================================================================== screen
export default function ClientDNA({ clients, active, onSelect, reload, intent, goAssets }) {
  const [mode, setMode] = useState(null); // null | "new" | "edit"
  useEffect(() => { if (intent && intent.type === "new") setMode("new"); }, [intent]);

  if (mode) {
    return (
      <div className="screen">
        <Edit client={mode === "edit" ? active : null} onCancel={() => setMode(null)}
          onSaved={async (id) => { await reload(); onSelect(id); setMode(null); }}
          onRemoved={async () => { await reload(); onSelect(null); setMode(null); }} />
      </div>
    );
  }
  if (!clients.length) {
    return (
      <div className="screen">
        <div className="empty big-empty">
          <p className="empty-title">Keep every client’s brand in one place</p>
          <p className="dim">Logo, website, brand colours, highlight colour and fonts. Pick the client once and the panel uses it everywhere.</p>
          <button className="primary" onClick={() => setMode("new")}><Plus /> Add your first client</button>
        </div>
      </div>
    );
  }
  return (
    <div className="screen">
      <div className="picker">
        <label className="sr" htmlFor="client-pick">Client</label>
        <select id="client-pick" value={active ? active.id : ""} onChange={(e) => onSelect(e.target.value || null)}>
          {!active && <option value="">Choose a client…</option>}
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="ghost" onClick={() => setMode("new")}><Plus /> New</button>
      </div>
      {active ? <View client={active} onEdit={() => setMode("edit")} onAssets={goAssets} />
        : <p className="help pad">Choose a client to see their colours, fonts and logo.</p>}
    </div>
  );
}
