// S / M / L switch shown on tools that draw big (Ease Graph, Sound Kit). Same setting as Settings.
import { useEffect, useState } from "react";
import { SIZES, getSize, setSize } from "../density.js";

export default function SizeSwitch() {
  const [v, setV] = useState(getSize());
  useEffect(() => {
    const on = (e) => setV(e.detail);
    window.addEventListener("fs-size", on);
    return () => window.removeEventListener("fs-size", on);
  }, []);
  return (
    <div className="size-switch" role="radiogroup" aria-label="Size">
      {SIZES.map(([id, label]) => (
        <button key={id} role="radio" aria-checked={v === id} className={v === id ? "on" : ""} title={label} onClick={() => setSize(id)}>{label[0]}</button>
      ))}
    </div>
  );
}
