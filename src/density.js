// How big everything in the panel is. Every size in every tool's CSS is written in rem (rem() turns
// "12px" into "0.75rem"), so one number, the page's root font size, scales text, buttons, graphs,
// waveforms and spacing together. Nothing is hidden at any size.
//   Auto (default): follows the panel's width, so a narrow panel shrinks everything to fit and a
//                   wide one grows it.
//   Small / Medium / Large: fixed sizes that don't change with the panel.
const KEY = "frameshift.size";
export const SIZES = [["auto", "Auto"], ["small", "Small"], ["medium", "Medium"], ["large", "Large"]];
const FIXED = { small: 0.88, medium: 1, large: 1.14 };

export function getSize() {
  try { const v = localStorage.getItem(KEY); return v && (v === "auto" || FIXED[v]) ? v : "auto"; } catch (e) { return "auto"; }
}
export function setSize(v) {
  try { localStorage.setItem(KEY, v); } catch (e) {}
  applySize();
  window.dispatchEvent(new CustomEvent("fs-size", { detail: v }));
}

/** The scale for a panel this wide. 340 px wide is the design size (1). */
export function autoScale(width) {
  if (!width) return 1;
  return Math.min(1.16, Math.max(0.84, width / 340));
}

let last = 0, wideNow = false;
/** True when the panel is wide enough for two columns (settings left, results right). */
export function isWide() { return wideNow; }
let measure = () => (document.getElementById("app") || document.body || {}).clientWidth || window.innerWidth;
/** Sets the root font size from the size setting (and, in Auto, the panel's width). */
export function applySize() {
  const s = getSize();
  const k = s === "auto" ? autoScale(measure()) : FIXED[s];
  const px = Math.round(16 * k * 4) / 4; // quarter-pixel steps so tiny resizes don't redraw everything
  const wide = measure() / px >= 34; // about 545 px at Medium
  if (wide !== wideNow) {
    wideNow = wide;
    document.documentElement.classList.toggle("fs-wide", wide);
    window.dispatchEvent(new CustomEvent("fs-wide", { detail: wide }));
  }
  if (px === last) return;
  last = px;
  document.documentElement.style.fontSize = px + "px";
  // canvases measure themselves on resize: redraw at the new size
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

/** Starts following the panel's width. Call once at boot. */
export function startSizing(getWidth) {
  if (getWidth) measure = getWidth;
  applySize();
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(applySize, 60); };
  window.addEventListener("resize", later);
  if (window.ResizeObserver) {
    const el = document.getElementById("app");
    if (el) new ResizeObserver(later).observe(el);
  }
}

/** Kept for the tools that called it: sizes now apply to the whole panel. */
export function followSize() { return () => {}; }

/** "12px" -> "0.75rem" everywhere in a stylesheet, so it follows the panel's size.
 *  Hairlines (1px and less) stay in px so they stay crisp. */
export function rem(css) {
  return css.replace(/(^|[^\w.#-])(-?\d*\.?\d+)px\b/g, (m, pre, n) => {
    const v = parseFloat(n);
    if (Math.abs(v) <= 1) return m;
    return pre + +(v / 16).toFixed(4) + "rem";
  });
}
