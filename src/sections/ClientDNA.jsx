import React, { useEffect, useState } from "react";
import { hostApp, pickFiles } from "../host.js";
import { Brush, Copy, Folder, Link, Plus, Close, Download } from "../icons.jsx";
import {
  saveClient, removeClient, fileUrl, copyText, fontInstalled, openUrl, hostOf, normHex, validHex, hexToRgb, inkOn, lib, path,
} from "../library.js";

const isAE = hostApp === "AEFT";
const EMPTY = { name: "", founder: "", website: "", logo: "", colors: [{ name: "", hex: "" }, { name: "", hex: "" }, { name: "", hex: "" }],
  highlights: [{ name: "Highlight", hex: "" }], fonts: [{ name: "", role: "Headings" }, { name: "", role: "Body" }],
  emails: [""], socials: [{ label: "", url: "" }], styleLinks: [{ label: "", url: "" }], notes: "" };

/** Highlight colours; older clients stored a single `highlight`. */
export const highlightsOf = (c) => (c.highlights && c.highlights.length ? c.highlights : c.highlight && c.highlight.hex ? [c.highlight] : []);

// Social sites we recognise from a link, so the list shows "Instagram" instead of a URL.
const SITES = [
  [/instagram\.com/i, "Instagram"], [/linkedin\.com/i, "LinkedIn"], [/(^|\.)(x|twitter)\.com/i, "X"], [/youtube\.com|youtu\.be/i, "YouTube"],
  [/tiktok\.com/i, "TikTok"], [/facebook\.com|fb\.com/i, "Facebook"], [/threads\.net/i, "Threads"], [/behance\.net/i, "Behance"],
  [/dribbble\.com/i, "Dribbble"], [/github\.com/i, "GitHub"], [/medium\.com/i, "Medium"], [/substack\.com/i, "Substack"], [/vimeo\.com/i, "Vimeo"],
];
export function siteOf(url) {
  const host = hostOf(url).split("/")[0];
  for (const [re, name] of SITES) if (re.test(host)) return name;
  return host.replace(/^www\./, "");
}
/** "instagram.com/leanspark" -> "@leanspark"; YouTube "@handle" stays; else the short path. */
export function handleOf(url) {
  const rest = hostOf(url).split("/").slice(1).filter((x) => x && !/^(in|c|channel|user|company)$/i.test(x));
  if (!rest.length) return "";
  const h = decodeURIComponent(rest[0]).replace(/\?.*$/, "");
  return h.charAt(0) === "@" ? h : "@" + h;
}
const withHttps = (u) => { const s = String(u || "").trim(); return s && !/^https?:\/\//i.test(s) ? "https://" + s : s; };

function Monogram({ client, size = 52 }) {
  const hl = highlightsOf(client)[0];
  const bg = (hl && hl.hex) || (client.colors && client.colors[0] && client.colors[0].hex) || "#444444";
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
      </section>

      {highlightsOf(client).length > 0 && (
        <section className="block">
          <h3 className="block-title">Highlight colours <span className="dim">for highlighted words and accents</span></h3>
          <div className="swatches hl">{highlightsOf(client).map((c, i) => <Swatch key={i} c={c} wide onCopy={copy} onApply={apply} />)}</div>
        </section>
      )}

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

      {((client.emails || []).length > 0 || (client.socials || []).length > 0) && (
        <section className="block">
          <h3 className="block-title">Contact</h3>
          <ul className="links">
            {(client.emails || []).map((m, i) => (
              <li key={"m" + i}>
                <span className="link-kind">Email</span>
                <button className="link-main trunc" onClick={() => say(copyText(m) ? "Copied " + m + "." : m)} title="Copy">{m}</button>
                <button className="icon-btn small" onClick={() => say(copyText(m) ? "Copied " + m + "." : m)} aria-label={"Copy " + m}><Copy /></button>
              </li>
            ))}
            {(client.socials || []).map((l, i) => (
              <li key={"s" + i}>
                <span className="link-kind">{l.label || siteOf(l.url)}</span>
                <button className="link-main trunc" onClick={() => openUrl(l.url)} title={l.url}>{handleOf(l.url) || hostOf(l.url)}</button>
                <button className="icon-btn small" onClick={() => openUrl(l.url)} aria-label={"Open " + l.url}><Link /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(client.styleLinks || []).length > 0 && (
        <section className="block">
          <h3 className="block-title">Visual style <span className="dim">channels and videos to match</span></h3>
          <ul className="links">
            {client.styleLinks.map((l, i) => (
              <li key={i}>
                <span className="link-kind">{siteOf(l.url)}</span>
                <button className="link-main trunc" onClick={() => openUrl(l.url)} title={l.url}>{l.label || hostOf(l.url)}</button>
                <button className="icon-btn small" onClick={() => openUrl(l.url)} aria-label={"Open " + l.url}><Link /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

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
  const [c, setC] = useState(() => {
    const base = JSON.parse(JSON.stringify({ ...EMPTY, ...(client || {}) }));
    const atLeastOne = (list, blank) => (list && list.length ? list : [blank]);
    base.highlights = atLeastOne(client ? highlightsOf(client).map((x) => ({ ...x })) : null, { name: "Highlight", hex: "" });
    base.emails = atLeastOne(base.emails, "");
    base.socials = atLeastOne(base.socials, { label: "", url: "" });
    base.styleLinks = atLeastOne(base.styleLinks, { label: "", url: "" });
    return base;
  });
  const [logoSource, setLogoSource] = useState(null);
  const [err, setErr] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = (k, v) => setC((x) => ({ ...x, [k]: v }));
  const setColour = (i, v) => set("colors", c.colors.map((x, j) => (j === i ? v : x)));
  const setFont = (i, v) => set("fonts", c.fonts.map((x, j) => (j === i ? v : x)));
  const setAt = (k, i, v) => set(k, c[k].map((x, j) => (j === i ? v : x)));
  const removeAt = (k, i) => set(k, c[k].filter((_, j) => j !== i));

  async function save() {
    if (!c.name.trim()) return setErr("Give the client a name.");
    const bad = c.colors.concat(c.highlights).find((x) => x.hex && !validHex(x.hex));
    const badMail = c.emails.find((m) => m.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.trim()));
    if (badMail) return setErr("\u201C" + badMail + "\u201D doesn\u2019t look like an email address.");
    if (bad) return setErr("“" + bad.hex + "” isn’t a colour code. Use six hex digits, like #FF6A3D.");
    try {
      const site = c.website.trim();
      const out = { ...c, name: c.name.trim(), website: site && !/^https?:\/\//i.test(site) ? "https://" + site : site, colors: c.colors.map((x) => ({ name: x.name.trim(), hex: normHex(x.hex) })).filter((x) => x.hex),
        highlights: c.highlights.map((x, i) => ({ name: x.name.trim() || "Highlight " + (i + 1), hex: normHex(x.hex) })).filter((x) => x.hex),
        emails: c.emails.map((m) => m.trim()).filter(Boolean),
        socials: c.socials.map((l) => ({ label: l.label.trim(), url: withHttps(l.url) })).filter((l) => l.url),
        styleLinks: c.styleLinks.map((l) => ({ label: l.label.trim(), url: withHttps(l.url) })).filter((l) => l.url),
        fonts: c.fonts.map((f) => ({ name: f.name.trim(), role: f.role.trim() })).filter((f) => f.name) };
      onSaved(await saveClient(out, logoSource));
    } catch (e) { setErr("Couldn’t save: " + e.message); }
  }
  async function remove() {
    try { await removeClient(client); onRemoved(); } catch (e) { setErr(e.message); }
  }
  const logoPreview = logoSource ? fileUrl(logoSource) : client && client.logo ? fileUrl(path.join(client.dir, client.logo)) : null;

  return (
    <form className="edit" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
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

      <fieldset className="field group"><legend>Highlight colours <span className="dim">for highlighted words and accents in videos</span></legend>
        {c.highlights.map((x, i) => <ColourRow key={i} c={x} label="Highlight" onChange={(v) => setAt("highlights", i, v)} onRemove={c.highlights.length > 1 ? () => removeAt("highlights", i) : null} />)}
        {c.highlights.length < 6 && <button type="button" className="ghost tight add" onClick={() => set("highlights", c.highlights.concat([{ name: "", hex: "" }]))}><Plus /> Add highlight colour</button>}
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

      <fieldset className="field group"><legend>Email</legend>
        {c.emails.map((m, i) => (
          <div className="edit-row" key={i}>
            <input className="grow" type="email" aria-label="Email address" placeholder="founder@leanspark.com" autoComplete="off" spellCheck={false} value={m} onChange={(e) => setAt("emails", i, e.target.value)} />
            {c.emails.length > 1 && <button type="button" className="icon-btn small" onClick={() => removeAt("emails", i)} aria-label="Remove email"><Close size={13} /></button>}
          </div>
        ))}
        {c.emails.length < 4 && <button type="button" className="ghost tight add" onClick={() => set("emails", c.emails.concat([""]))}><Plus /> Add email</button>}
      </fieldset>

      <fieldset className="field group"><legend>Social links <span className="dim">the founder&rsquo;s Instagram, LinkedIn, X, YouTube&hellip;</span></legend>
        {c.socials.map((l, i) => (
          <div className="edit-row" key={i}>
            <input className="grow" inputMode="url" aria-label="Social link" placeholder="instagram.com/leanspark" autoComplete="off" spellCheck={false} value={l.url} onChange={(e) => setAt("socials", i, { ...l, url: e.target.value })} />
            <span className="site-tag" aria-hidden="true">{l.url.trim() ? siteOf(l.url) : ""}</span>
            {c.socials.length > 1 && <button type="button" className="icon-btn small" onClick={() => removeAt("socials", i)} aria-label="Remove link"><Close size={13} /></button>}
          </div>
        ))}
        {c.socials.length < 10 && <button type="button" className="ghost tight add" onClick={() => set("socials", c.socials.concat([{ label: "", url: "" }]))}><Plus /> Add social link</button>}
      </fieldset>

      <fieldset className="field group"><legend>Visual style links <span className="dim">channels or videos whose look to follow</span></legend>
        {c.styleLinks.map((l, i) => (
          <div className="link-edit" key={i}>
            <input inputMode="url" aria-label="Style link" placeholder="youtube.com/@channel or a video link" autoComplete="off" spellCheck={false} value={l.url} onChange={(e) => setAt("styleLinks", i, { ...l, url: e.target.value })} />
            <div className="edit-row">
              <input className="grow" aria-label="What to take from it" placeholder="What to take from it, e.g. caption style" autoComplete="off" value={l.label} onChange={(e) => setAt("styleLinks", i, { ...l, label: e.target.value })} />
              {c.styleLinks.length > 1 && <button type="button" className="icon-btn small" onClick={() => removeAt("styleLinks", i)} aria-label="Remove style link"><Close size={13} /></button>}
            </div>
          </div>
        ))}
        {c.styleLinks.length < 10 && <button type="button" className="ghost tight add" onClick={() => set("styleLinks", c.styleLinks.concat([{ label: "", url: "" }]))}><Plus /> Add style link</button>}
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
          <p className="dim">Logo, website, brand and highlight colours, fonts, contact and style links. Pick the client once and the panel uses it everywhere.</p>
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
