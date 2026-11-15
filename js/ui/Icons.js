// Pictures for the inventory: small ink drawings (SVG), in the HUD's colours. Drawn here so they cost nothing to load;
// they can be swapped for Blender renders of the real models later behind the same names.
const S = (body, vb = '0 0 160 80') =>
  `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" fill="var(--icon-fill)" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

export const ICONS = {
  fists: S(`
    <g transform="translate(22 18)"><rect x="0" y="8" width="44" height="34" rx="11"/><path d="M11 9v12M22 8v13M33 9v12"/><path d="M0 30q-6 2-4 10q3 8 14 6"/><path d="M8 42l-2 16h30l-2-16"/></g>
    <g transform="translate(94 18)"><rect x="0" y="8" width="44" height="34" rx="11"/><path d="M11 9v12M22 8v13M33 9v12"/><path d="M44 30q6 2 4 10q-3 8-14 6"/><path d="M8 42l-2 16h30l-2-16"/></g>`),
  axe: S(`
    <path d="M30 70L112 16" stroke-width="7" stroke="currentColor"/><path d="M30 70L112 16" stroke-width="3.5" stroke="var(--icon-fill)"/>
    <path d="M100 8l22 26q10-4 16-18q-8-14-20-16z"/><path d="M104 12l-8 8"/>`),
  rifle: S(`
    <path d="M6 44l30-6h22l4-6h92v6H66v6l-6 4H40l-30 10q-6 0-4-14z"/>
    <path d="M66 41h84v4H66z"/><circle cx="68" cy="52" r="7" fill="none"/><path d="M58 48q2 14 14 12"/><path d="M118 32v-4h4v4"/>`),
  shotgun: S(`
    <path d="M6 46l30-8h26l6-4h86v10H70l-6 4H42l-32 10q-6 0-4-12z"/><path d="M68 39h86"/>
    <path d="M58 48q0 10 10 10" fill="none"/><circle cx="70" cy="40" r="2"/>`),
  flare: S(`
    <rect x="30" y="32" width="96" height="16" rx="3"/><rect x="118" y="30" width="16" height="20" rx="2" fill="#8c1a10"/>
    <path d="M44 32v16M50 32v16"/><path d="M134 40q10-8 16-2q-6 8-16 2" fill="none" stroke="#d9472f"/>`),
  bandage: S(`
    <ellipse cx="62" cy="40" rx="22" ry="26"/><ellipse cx="62" cy="40" rx="8" ry="10" fill="none"/>
    <path d="M62 66h70q8 0 6-10l-4-6H72" /><path d="M96 66v-16M110 66v-16" stroke-dasharray="3 4"/>`),
  logs: S(`
    <rect x="24" y="40" width="96" height="24" rx="4"/><ellipse cx="120" cy="52" rx="7" ry="12"/><ellipse cx="120" cy="52" rx="3" ry="5" fill="none"/>
    <rect x="40" y="16" width="96" height="24" rx="4"/><ellipse cx="136" cy="28" rx="7" ry="12"/><ellipse cx="136" cy="28" rx="3" ry="5" fill="none"/>
    <path d="M40 50h40M54 26h44" />`),
};
