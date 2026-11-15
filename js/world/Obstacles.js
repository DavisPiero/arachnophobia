// What stops you outside: tree trunks, big rocks, fallen logs, the shed (SURVIVAL.md S1).
// Circles and short capsules on the ground plane, in a coarse grid so a lookup only checks what is near.
// The forest fills it while it places things; the player and the spiders that hunt outside push out of it.
const CELL = 4;
const M = 0.8;   // margin: anything up to this radius (the player, a spider) finds it from the cell it stands in

export class Obstacles {
  constructor() { this.grid = new Map(); this.count = 0; }

  key(cx, cz) { return cx * 100003 + cz; }
  insert(o, minX, maxX, minZ, maxZ) {
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = this.key(cx, cz);
        let l = this.grid.get(k);
        if (!l) this.grid.set(k, l = []);
        l.push(o);
      }
    this.count++;
  }
  /** A round obstacle (a trunk, a rock). */
  circle(x, z, r) { this.insert({ ax: x, az: z, bx: x, bz: z, r }, x - r - M, x + r + M, z - r - M, z + r + M); }
  /** A capsule from a to b with radius r (a fallen log). */
  capsule(ax, az, bx, bz, r) {
    this.insert({ ax, az, bx, bz, r }, Math.min(ax, bx) - r - M, Math.max(ax, bx) + r + M, Math.min(az, bz) - r - M, Math.max(az, bz) + r + M);
  }

  /** Push the point p ({x, z}, changed in place) out of everything it overlaps by radius r. Returns true if it moved. */
  push(p, r) {
    const l = this.grid.get(this.key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
    if (!l) return false;
    let moved = false;
    for (const o of l) {
      const dx = o.bx - o.ax, dz = o.bz - o.az, len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - o.ax) * dx + (p.z - o.az) * dz) / len2)) : 0;
      const cx = o.ax + dx * t, cz = o.az + dz * t;
      const ex = p.x - cx, ez = p.z - cz, d2 = ex * ex + ez * ez, R = o.r + r;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2) || 1e-4;
      p.x = cx + (d2 > 1e-8 ? ex / d : 1) * R; p.z = cz + (d2 > 1e-8 ? ez / d : 0) * R;
      moved = true;
    }
    return moved;
  }
}
