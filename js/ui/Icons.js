// Inventory and HUD pictures: the user's sprite sheet assets/ui/icons.webp (3 x 2 cells, 2026-11-15).
// icon(name) returns a span that shows that cell; CSS .spr in css/style.css does the cropping.
const CELL = { fists: [0, 0], rifle: [1, 0], axe: [2, 0], shotgun: [0, 1], flare: [1, 1], bandage: [2, 1] };
export function icon(name, cls = '') {
  const c = CELL[name];
  return c ? `<span class="spr ${cls}" style="background-position:${c[0] * 50}% ${c[1] * 100}%"></span>` : '';
}
