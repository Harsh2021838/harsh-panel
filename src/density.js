// How big the tools draw (graphs, waveforms, buttons): small, medium or large. One setting for the
// whole panel, in Settings; tools follow it live.
const KEY = "frameshift.size";
export const SIZES = [["small", "Small"], ["medium", "Medium"], ["large", "Large"]];
export function getSize() { try { return localStorage.getItem(KEY) || "medium"; } catch (e) { return "medium"; } }
export function setSize(v) {
  try { localStorage.setItem(KEY, v); } catch (e) {}
  window.dispatchEvent(new CustomEvent("fs-size", { detail: v }));
}
/** Keeps el's data-size attribute in step with the setting; returns a stop function. */
export function followSize(el) {
  const apply = () => {
    if (!el) return;
    el.setAttribute("data-size", getSize());
    // graphs measure themselves on resize: redraw at the new size
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  };
  apply();
  window.addEventListener("fs-size", apply);
  return () => window.removeEventListener("fs-size", apply);
}
