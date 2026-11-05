// Reads which After Effects comp each Dynamic Link clip really points to, from the
// saved .prproj file (gzipped XML).
//
// Premiere keeps showing the name a comp had when it was linked ("X Linked Comp 50"),
// even after the comp is renamed in After Effects. The project file knows better:
//   MasterClip <Name>  -> Clip -> VideoMediaSource -> Media
//   Media <Title>         "Ani 1/109_ASH.aep"   the comp's current name
//   Media <ImporterPrefs> base64 UTF-16 "0000010c-0000-..."   the comp's After Effects item id (0x10c)
import { nodeRequire } from "../../host.js";

/**
 * @returns Map<masterClipName, [{ compId, compName, aepPath }]>   (a name can appear more than once)
 *          or null when the file can't be read.
 */
export function readDynamicLinks(prprojPath) {
  const fs = nodeRequire("fs"), zlib = nodeRequire("zlib"), Buffer = nodeRequire("buffer").Buffer;
  let raw;
  try { raw = fs.readFileSync(prprojPath); } catch (e) { return null; }
  const xml = (raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString("utf8");
  if (xml.indexOf(".aep") === -1) return new Map();

  // Media: uid -> comp info (only After Effects comps)
  const media = new Map();
  const mediaRe = /<Media ObjectUID="([^"]+)"[^>]*>([\s\S]*?)<\/Media>/g;
  let m;
  while ((m = mediaRe.exec(xml))) {
    const body = m[2];
    const path = (/<(?:ActualMediaFilePath|FilePath)>([^<]*\.aep)<\//i.exec(body) || [])[1];
    if (!path) continue;
    const title = decode((/<Title>([^<]*)<\/Title>/.exec(body) || [])[1] || "");
    let compId = 0;
    const prefs = /<ImporterPrefs[^>]*>\s*([A-Za-z0-9+/=\s]+?)\s*<\/ImporterPrefs>/.exec(body);
    if (prefs) {
      const s = Buffer.from(prefs[1].replace(/\s/g, ""), "base64").toString("utf16le");
      const hex = /^([0-9a-f]{8})-0000-0000-0000-0{12}/i.exec(s);
      if (hex) compId = parseInt(hex[1], 16);
    }
    media.set(m[1], { compId, compName: title.replace(/\/[^/]*\.aep(\s.*)?$/i, ""), aepPath: path });
  }
  if (!media.size) return new Map();

  // VideoMediaSource id -> media uid; VideoClip id -> source id
  const source = new Map();
  const srcRe = /<VideoMediaSource ObjectID="(\d+)"[^>]*>([\s\S]*?)<\/VideoMediaSource>/g;
  while ((m = srcRe.exec(xml))) {
    const u = /<Media ObjectURef="([^"]+)"/.exec(m[2]);
    if (u && media.has(u[1])) source.set(m[1], u[1]);
  }
  const clip = new Map();
  const clipRe = /<VideoClip ObjectID="(\d+)"[^>]*>([\s\S]*?)<\/VideoClip>/g;
  while ((m = clipRe.exec(xml))) {
    const s = /<Source ObjectRef="(\d+)"/.exec(m[2]);
    if (s && source.has(s[1])) clip.set(m[1], source.get(s[1]));
  }

  // MasterClip name -> comps
  const out = new Map();
  const mcRe = /<MasterClip ObjectUID="[^"]+"[^>]*>([\s\S]*?)<\/MasterClip>/g;
  while ((m = mcRe.exec(xml))) {
    const body = m[1];
    const name = decode((/<Name>([^<]*)<\/Name>/.exec(body) || [])[1] || "");
    if (!/\.aep(\s|$)/i.test(name)) continue; // "Comp/x.aep" or a duplicate "Comp/x.aep Copy 01"
    const refs = body.match(/<Clip Index="\d+" ObjectRef="(\d+)"/g) || [];
    for (const r of refs) {
      const id = /ObjectRef="(\d+)"/.exec(r)[1];
      const uid = clip.get(id);
      if (!uid) continue;
      if (!out.has(name)) out.set(name, []);
      out.get(name).push(media.get(uid));
    }
  }
  return out;
}

function decode(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
