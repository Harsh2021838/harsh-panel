import { useEffect, useState } from "react";
import { isWide } from "../density.js";

/** Follows whether the panel is wide enough for two columns. */
export default function useWide() {
  const [wide, setWide] = useState(isWide());
  useEffect(() => {
    const on = (e) => setWide(!!e.detail);
    window.addEventListener("fs-wide", on);
    setWide(isWide());
    return () => window.removeEventListener("fs-wide", on);
  }, []);
  return wide;
}
