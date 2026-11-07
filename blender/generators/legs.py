"""The player's legs: worn, muddy cargo trousers and black lace-up work boots (reference/m4-legs-*.webp).

Parameters: assets/params/legs.json. Output: legs.glb with
  leg_l, leg_r   each leg standing (GAME space, metres): feet on y = 0, toes towards -z, the hip at the top.
                 The game hangs them under the player and swings them from the hip (pivots in legs.json).
  waist          belt line and the top of the trousers, seen when you look straight down
  boot           the right lower leg for the stomp: sole at y = 0, toe towards -z, the trouser leg rising up and back
                 (towards the eye), as the stomp animation expects
and `_lod1` copies. One baked atlas.
"""
import math

import numpy as np
from mathutils import Vector

from lib import common as C
from lib import materials as M


def V(*a):
    return Vector(a)


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def materials(P):
    L = P['look']
    mud = dict(set_id='Ground051', color=L['mud'], scale=7.0, rough=0.9, height=2.5, crease=0.012)
    return {
        'trousers': M.scanned('trousers', 'Fabric063', 9.0, 'Z', color=L['trousers'], rough=(0.78, 0.95), bump=1.2, bump_dist=0.0004,
                              cavity=0.6, dirt=dict(mud, amount=0.9, below=0.42, fade=0.3, noiseScale=7.0),
                              wear=dict(color=[c * 2.4 for c in L['trousers']], rough=0.85, amount=0.8, radius=0.004, noise=25.0)),
        'belt': M.scanned('belt', 'Leather026', 20.0, 'Y', color=L['belt'], rough=(0.45, 0.7), bump=1.0, bump_dist=0.0003, cavity=0.4,
                          wear=dict(color=[c * 3 for c in L['belt']], rough=0.4, amount=0.7, radius=0.002)),
        'boot': M.scanned('boot', 'Leather026', 14.0, 'Y', color=L['boot'], rough=(0.35, 0.6), bump=1.4, bump_dist=0.0004, cavity=0.5,
                          dirt=dict(mud, amount=1.0, below=0.07, fade=0.08, noiseScale=12.0),
                          wear=dict(color=[c * 4 for c in L['boot']], rough=0.35, amount=0.9, radius=0.003, noise=30.0)),
        'sole': M.scanned('sole', 'Rubber004', 12.0, 'Y', color=L['sole'], rough=(0.75, 0.95), bump=1.0, bump_dist=0.0006,
                          extra_height=[M.ribs(110, 'Y', 2.0, sharp=True)], dirt=dict(mud, amount=1.0, below=0.03, fade=0.03)),
        'jacket': M.scanned('jacket', 'Fabric063', 16.0, 'Z', color=L['jacket'], rough=(0.72, 0.9), bump=0.9, bump_dist=0.0003, cavity=0.6),
        'lace': M.flat('lace', (0.025, 0.022, 0.018), 0.8, 0.0, 2000, 0.0002),
        'metal': M.flat('eyelet', (0.18, 0.17, 0.15), 0.4, 1.0),
    }


# ---------------------------------------------------------------- boot (sole at y = 0, toe towards -z, ankle at the origin xz)
def boot_parts(P, mats, mirror=1.0):
    B = P['boot']
    L, W = B['length'], B['width']
    parts = []
    # upper: a loft from heel to toe; each ring = (z, half width, height, toe-spring lift)
    prof = [(0.105, 0.36, 0.40), (0.09, 0.46, 0.75), (0.06, 0.5, 0.9), (0.02, 0.5, 0.95), (-0.03, 0.52, 0.8), (-0.08, 0.53, 0.62),
            (-0.13, 0.5, 0.5), (-0.165, 0.45, 0.42), (-0.19, 0.36, 0.35), (-0.205, 0.22, 0.27)]
    secs = []
    for z, hw, h in prof:
        zz = z * L / 0.31
        spring = 0.012 * smooth((-zz - 0.12) / 0.09)          # the toe turns up a little
        height = h * B['height'] * 0.5
        secs.append(C.ring((0, B['sole'] + spring + height / 2, zz), hw * W, height / 2, n=28, power=2.6))
    upper = C.loft('upper', secs)
    # shaft round the ankle
    shaft = C.lathe('shaft', [(B['sole'] + 0.03, 0.05), (B['sole'] + 0.09, 0.047), (B['shaft'] - 0.02, 0.05), (B['shaft'], 0.053)],
                    (0, 0.04 * L / 0.31), axis='y', n=28)
    # thick lug sole following the upper's outline, toe spring included
    sole = C.loft('sole', [C.ring((0, B['sole'] * 0.5 + 0.012 * smooth((-z * L / 0.31 - 0.12) / 0.09), z * L / 0.31), hw * W * 1.07, B['sole'] / 2,
                                  n=28, power=3.6) for z, hw, _ in prof])
    for o in (upper, shaft):
        C.assign(o, mats['boot'])
    C.assign(sole, mats['sole'])
    parts += [upper, shaft, sole]
    # laces: criss-cross over the tongue, eyelets on both sides
    ys = np.linspace(B['sole'] + 0.06, B['shaft'] - 0.02, 7)
    for i, y in enumerate(ys):
        z = -0.035 - (ys[-1] - y) * 0.45
        for s in (-1, 1):
            e = C.lathe(f'eye{i}{s}', [(s * 0.026 - 0.003, 0.0035), (s * 0.026 + 0.003, 0.0035)], (y, z), axis='x', n=10)
            C.assign(e, mats['metal']); parts.append(e)
        if i + 1 < len(ys):
            y2, z2 = ys[i + 1], -0.035 - (ys[-1] - ys[i + 1]) * 0.45
            for s in (-1, 1):
                lc = C.tube_curve(f'lace{i}{s}', [(s * 0.024, y, z - 0.004), (0, (y + y2) / 2, (z + z2) / 2 - 0.009), (-s * 0.024, y2, z2 - 0.004)], 0.0022, bevel_res=1)
                C.assign(lc, mats['lace']); parts.append(lc)
    return parts


def trouser_leg(P, mats, name, pts, radii, hem_ragged=True, hi=False):
    """A baggy trouser leg along a path (GAME points), radius per point; soft folds; frayed hem at the start."""
    path = [V(*p) for p in C.catmull([tuple(p) for p in pts], per=10 if hi else 4)]
    n = 40 if hi else 20
    rr = np.interp(np.linspace(0, 1, len(path)), np.linspace(0, 1, len(radii)), radii)
    rnd = np.random.RandomState(abs(hash(name)) % 1000)
    ph = rnd.rand(8) * 6.28
    secs = []
    for k, p in enumerate(path):
        t = (path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]).normalized()
        side = V(1, 0, 0)
        b = t.cross(side).normalized()
        l = b.cross(t).normalized()
        u = k / (len(path) - 1)
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            fold = 0.0
            amp = P['trousers']['folds'] * (1.0 if hi else 0.5)
            fold += amp * math.sin(a * 3 + ph[0] + u * 9) * math.sin(u * 25 + ph[1])
            if hi:
                fold += amp * 0.5 * math.sin(a * 6 + ph[2] + u * 31)
                if hem_ragged and u < 0.04:
                    fold += 0.006 * (rnd.rand() - 0.5)
            r = rr[k] + fold
            ring.append(C.G(*(p + l * (r * math.cos(a)) + b * (r * 0.92 * math.sin(a)))))
        secs.append(ring)
    ob = C.loft(name, secs, cap_start=False, cap_end=True)
    return C.assign(ob, mats['trousers'])


def leg(P, mats, side, hi=False):
    """One standing leg: boot at x = side * stance, the trouser from the boot top to the hip."""
    T = P['trousers']
    x = side * P['stance']
    hipx = side * P['hip'][0]
    pts = [(x, P['boot']['shaft'] - 0.02, 0.012), (x, 0.28, 0.008), ((x + hipx) / 2, T['knee'], -0.012), (hipx, 0.72, 0.0), (hipx, P['hip'][1], 0.01)]
    parts = [trouser_leg(P, mats, f'tr{side}{hi}', pts, T['radii'], hi=hi)]
    # cargo pocket on the outer thigh: a slightly proud panel with a flap
    pk = C.box(f'pocket{side}{hi}', (hipx + side * T['radii'][3] * 0.75 - 0.012, 0.56, -0.07), (hipx + side * T['radii'][3] * 0.75 + 0.012, 0.74, 0.07))
    flap = C.box(f'flap{side}{hi}', (hipx + side * T['radii'][3] * 0.75 - 0.016, 0.725, -0.075), (hipx + side * T['radii'][3] * 0.75 + 0.016, 0.77, 0.075))
    for o in (pk, flap):
        C.add_modifier(o, 'BEVEL', width=0.006, segments=3)
        C.apply_modifiers(o)
        C.assign(o, mats['trousers'])
    parts += [pk, flap]
    boot = boot_parts(P, mats)
    for o in boot:
        for v in o.data.vertices:
            v.co.x += x
    return C.join(parts + boot, f'leg_{"l" if side < 0 else "r"}{"_high" if hi else ""}')


def waist(P, mats, hi=False):
    """Belt line and the bottom of the jacket over it, closed at the top: what you see looking straight down."""
    h = P['hip'][1]
    wx, wz = P['waist']
    n = 48 if hi else 24
    secs = [C.ring((0, y, 0.0), wx * s, wz * s, n=n, power=2.2) for y, s in ((h - 0.14, 0.95), (h - 0.04, 1.0), (h + 0.05, 1.0))]
    tr = C.assign(C.loft('waist_tr' + str(hi), secs, cap_start=False, cap_end=False), mats['trousers'])
    belt = C.loft('belt' + str(hi), [C.ring((0, y, 0.0), wx * 1.03, wz * 1.03, n=n, power=2.2) for y in (h + 0.01, h + 0.05)], cap_start=False, cap_end=False)
    C.assign(belt, mats['belt'])
    buckle = C.box('buckle' + str(hi), (-0.03, h + 0.006, -wz * 1.06), (0.03, h + 0.054, -wz * 1.0))
    C.assign(buckle, mats['metal'])
    # jacket: hem just over the belt, up to the chest, rounded shut on top
    J = P['jacket']
    js = []
    for y, s in ((h + 0.02, 1.12), (h + 0.05, 1.1), (h + 0.2, 1.12), (J['top'] - 0.06, 1.16), (J['top'] - 0.02, 1.0), (J['top'], 0.6), (J['top'] + 0.01, 0.2)):
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            fold = (0.004 if hi else 0.002) * math.sin(a * 5 + y * 30) if s > 0.9 else 0.0
            ring.append(C.G((wx * s + fold) * math.cos(a), y, (wz * 1.15 * s + fold) * math.sin(a)))
        js.append(ring)
    jacket = C.assign(C.loft('jacket' + str(hi), js, cap_start=False, cap_end=True), mats['jacket'])
    return C.join([tr, belt, buckle, jacket], 'waist' + ('_high' if hi else ''))


def stomp_boot(P, mats, hi=False):
    """Right lower leg for the stomp: the boot at the origin, the trouser leg rising up and back towards the eye."""
    T = P['trousers']
    pts = [(0, P['boot']['shaft'] - 0.02, 0.012), (0, 0.5, 0.2), (0, 0.9, 0.5), (0, 1.35, 0.95)]
    parts = [trouser_leg(P, mats, 'stomp_tr' + str(hi), pts, [T['radii'][0], T['radii'][1], T['radii'][2], T['radii'][3]], hi=hi)]
    return C.join(parts + boot_parts(P, mats), 'boot' + ('_high' if hi else ''))


def build(P):
    C.reset_scene()
    mats = materials(P)
    pairs = []
    for name, make in (('leg_l', lambda hi: leg(P, mats, -1, hi)), ('leg_r', lambda hi: leg(P, mats, 1, hi)),
                       ('waist', lambda hi: waist(P, mats, hi)), ('boot', lambda hi: stomp_boot(P, mats, hi))):
        lo = make(False)
        hi = make(True)
        hi2 = C.high_from(hi, name + '_hi2', bevel=0, subdiv=1)
        C.bpy.data.objects.remove(hi, do_unlink=True)
        C.shade_low(lo, 50); C.shade_low(hi2, 50)
        lo.name = name; lo.data.name = name
        pairs.append((hi2, lo))
    lows = [lo for _, lo in pairs]
    for lo in lows:
        C.smart_unwrap(lo, island_margin=0.004, angle=66)
    C.pack_atlas(lows, margin=0.003)
    mat = C.bake_family(pairs, P['budget']['texture'], 'legs', extrusion=0.006, ao_samples=24, ao_strength=0.6)
    for hi, lo in pairs:
        C.bpy.data.objects.remove(hi, do_unlink=True)
    objs, report = C.finish_family(lows, mat, lod_ratio=0.5, lod_min=300)
    C.render_preview(lows[:3], f'{C.BUILD_DIR}/legs_preview.png', eye=(0.6, -1.4, 1.1), target=(0, 0, 0.45), lens=40)
    C.render_preview(lows[:3], f'{C.BUILD_DIR}/legs_preview_pov.png', eye=(0.0, P['behind'], 1.65), target=(0, P['behind'] + 0.35, 0.0), lens=22)
    C.export_glb(objs, 'legs')
    return report
