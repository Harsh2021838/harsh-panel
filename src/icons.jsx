// Small stroke icons, 16px grid, drawn to match Adobe panel iconography.
const base = (size) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
});

export const Wrench = ({ size = 18 }) => (
  <svg {...base(size)}><path d="M14.7 6.3a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.7-7.7a4 4 0 0 0-2-2z" /><path d="m14.7 6.3 2.8-2.8a4 4 0 0 1 3 3l-2.8 2.8" /></svg>
);
export const Layers = ({ size = 18 }) => (
  <svg {...base(size)}><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></svg>
);
export const Person = ({ size = 18 }) => (
  <svg {...base(size)}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
);
export const Check = ({ size = 18 }) => (
  <svg {...base(size)}><path d="M9 11.5 11.5 14 16 9" /><rect x="4" y="4" width="16" height="16" rx="3" /></svg>
);
export const Proof = ({ size = 18 }) => (
  <svg {...base(size)}><path d="M4 8h10M4 13h7" /><path d="M4 18c1-1.2 2-1.2 3 0s2 1.2 3 0 2-1.2 3 0" /><path d="m15 15 2.5 2.5L21 12" /></svg>
);
export const Back = ({ size = 16 }) => (
  <svg {...base(size)}><path d="M15 18 9 12l6-6" /></svg>
);
export const Chevron = ({ size = 14 }) => (
  <svg {...base(size)}><path d="m9 18 6-6-6-6" /></svg>
);
export const Book = ({ size = 13 }) => (
  <svg {...base(size)}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></svg>
);
export const Gear = ({ size = 14 }) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
);

export const Helix = ({ size = 18 }) => (
  <svg {...base(size)}><path d="M7 3c0 5 10 5 10 9s-10 4-10 9" /><path d="M17 3c0 5-10 5-10 9s10 4 10 9" /><path d="M8.5 7h7M8.5 17h7" /></svg>
);
export const Image = ({ size = 18 }) => (
  <svg {...base(size)}><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></svg>
);
export const Forward = ({ size = 16 }) => (
  <svg {...base(size)}><path d="m9 18 6-6-6-6" /></svg>
);
export const Close = ({ size = 16 }) => (
  <svg {...base(size)}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const Target = ({ size = 14 }) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
);
export const Stack = ({ size = 15 }) => (
  <svg {...base(size)}><rect x="4" y="4" width="16" height="12" rx="2" /><path d="M8 20h8" /></svg>
);
export const Brush = ({ size = 14 }) => (
  <svg {...base(size)}><path d="M14.5 4.5 19.5 9.5 10 19H5v-5z" /><path d="m12 7 5 5" /></svg>
);
export const Copy = ({ size = 13 }) => (
  <svg {...base(size)}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>
);
export const Folder = ({ size = 14 }) => (
  <svg {...base(size)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
);
export const Link = ({ size = 13 }) => (
  <svg {...base(size)}><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>
);
export const Plus = ({ size = 14 }) => (
  <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
);
export const Caret = ({ size = 12 }) => (
  <svg {...base(size)}><path d="m6 9 6 6 6-6" /></svg>
);
export const Download = ({ size = 14 }) => (
  <svg {...base(size)}><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></svg>
);
export const Film = ({ size = 22 }) => (
  <svg {...base(size)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" /></svg>
);
export const Wave = ({ size = 22 }) => (
  <svg {...base(size)}><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" /></svg>
);
export const Shapes = ({ size = 22 }) => (
  <svg {...base(size)}><rect x="3" y="3" width="8" height="8" rx="1.5" /><circle cx="17" cy="7" r="4" /><path d="m7 14 4 7H3z" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>
);
export const GapIcon = ({ size = 18 }) => (
  <svg {...base(size)}><rect x="2.5" y="8" width="7" height="8" rx="1.5" /><rect x="14.5" y="8" width="7" height="8" rx="1.5" /><path d="M12 5v2M12 11v2M12 17v2" /></svg>
);
