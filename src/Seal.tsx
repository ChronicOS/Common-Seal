/** The VeraPhius seal of approval: a rosette with ribbons and a tick. No lettering. Decorative, so hidden from screen readers. */
export default function Seal({ size = 34 }: { size?: number }) {
  return (
    <svg className="seal" width={size} height={(size * 72) / 64} viewBox="0 0 64 72" aria-hidden="true" focusable="false">
      <path d="M21 44 L14 70 L20.5 65.5 L26 71 L31 47 Z" fill="#7d2a1c" />
      <path d="M43 44 L50 70 L43.5 65.5 L38 71 L33 47 Z" fill="#7d2a1c" />
      <polygon points="32.00,2.00 34.82,4.96 38.23,2.70 40.32,6.21 44.15,4.77 45.41,8.66 49.46,8.11 49.82,12.18 53.89,12.54 53.34,16.59 57.23,17.85 55.79,21.68 59.30,23.77 57.04,27.18 60.00,30.00 57.04,32.82 59.30,36.23 55.79,38.32 57.23,42.15 53.34,43.41 53.89,47.46 49.82,47.82 49.46,51.89 45.41,51.34 44.15,55.23 40.32,53.79 38.23,57.30 34.82,55.04 32.00,58.00 29.18,55.04 25.77,57.30 23.68,53.79 19.85,55.23 18.59,51.34 14.54,51.89 14.18,47.82 10.11,47.46 10.66,43.41 6.77,42.15 8.21,38.32 4.70,36.23 6.96,32.82 4.00,30.00 6.96,27.18 4.70,23.77 8.21,21.68 6.77,17.85 10.66,16.59 10.11,12.54 14.18,12.18 14.54,8.11 18.59,8.66 19.85,4.77 23.68,6.21 25.77,2.70 29.18,4.96" fill="#b4472e" />
      <circle cx="32" cy="30" r="21.5" fill="#c4553a" />
      <circle cx="32" cy="30" r="18.5" fill="none" stroke="#f6f3ec" strokeOpacity="0.75" strokeWidth="1.2" />
      <path d="M23.5 30.5 L29.5 36.5 L41 24" fill="none" stroke="#f6f3ec" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The product name with its seal, for the masthead of every page */
export function Brand() {
  return (
    <span className="wordmark">
      <Seal />
      <span>VeraPhius</span>
    </span>
  );
}
