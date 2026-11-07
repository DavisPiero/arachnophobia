"""Lever-action rifle generator.

Parameters: assets/params/rifle.json (positions in GAME space, metres; the game reads the same pivots).
Output: rifle.glb with
  rifle_body    stock, receiver, barrel, magazine tube, forend, sights, trigger (one mesh)
  rifle_lever   the lever and its finger loop (the game rotates it about lever.pivot)
  rifle_hammer  (rotates about hammer.pivot)
  rifle_round   a cartridge (reloading), rifle_case  a spent case (ejected after each shot)
and `_lod1` copies for phones. All share one baked atlas: walnut wood, blued steel worn bright on the edges, brass.
"""
import math

from mathutils import Vector

from lib import common as C


def barrel(P):
    b = P['barrel']
    secs = []
    for z, r in ((b['from'], b['radius']), (b['to'] + 0.02, b['muzzleRadius'] * 1.03), (b['to'], b['muzzleRadius'])):
        # octagonal barrel: a ring of `sides` points, flat on top (rotated half a step)
        secs.append(C.ring((0, b['y'], z), r, r, n=b['sides'], rot=math.pi / b['sides']))
    return C.loft('barrel', secs)


def tube(P):
    t = P['tube']
    secs = [C.ring((0, t['y'], z), t['radius'], t['radius'], n=12) for z in (t['from'], t['to'])]
    cap = [C.ring((0, t['y'], t['to'] - 0.012), t['radius'] * 1.08, t['radius'] * 1.08, n=12)]
    return C.loft('tube', secs + cap)


def band(P, z, length=0.012):
    b, t = P['barrel'], P['tube']
    cy = (b['y'] + t['y']) / 2
    ry = (b['y'] - t['y']) / 2 + b['radius'] + 0.002
    secs = [C.ring((0, cy, zz), b['radius'] + 0.002, ry, n=16, power=2.6) for zz in (z - length / 2, z + length / 2)]
    return C.loft('band', secs)


def receiver(P):
    r = P['receiver']
    w = r['width'] / 2
    body = C.box('receiver', (-w, r['bottom'], r['front']), (w, r['top'], r['back']))
    # loading gate: a slightly raised plate on the right side
    g = P['loadingGate']
    gate = C.box('gate', (w - 0.0005, g[1] - 0.011, g[2] - 0.022), (w + 0.0015, g[1] + 0.011, g[2] + 0.022))
    # top tang running back into the wrist, and the lower tang under it
    tang = C.box('tang', (-0.008, r['top'] - 0.008, r['back'] - 0.002), (0.008, r['top'] - 0.002, r['back'] + 0.06))
    lower = C.box('ltang', (-0.007, r['bottom'], r['back'] - 0.002), (0.007, r['bottom'] + 0.006, r['back'] + 0.07))
    return C.join([body, gate, tang, lower], 'receiver')


def forend(P):
    f = P['forend']
    secs = []
    for k in range(7):
        t = k / 6
        z = f['from'] + (f['to'] - f['from']) * t
        swell = 1.0 + 0.08 * math.sin(t * math.pi)   # slightly fuller in the middle
        taper = 1.0 - 0.1 * t
        secs.append(C.ring((0, f['y'], z), f['rx'] * swell * taper, f['ry'] * swell * taper, n=14, power=2.2))
    return C.loft('forend', secs)


def forend_cap(P):
    f = P['forend']
    z = f['to'] - 0.004
    secs = [C.ring((0, f['y'], zz), f['rx'] * 0.92, f['ry'] * 0.92, n=14, power=2.2) for zz in (z + 0.004, z - 0.01)]
    return C.loft('fcap', secs)


def stock(P):
    s = P['stock']
    secs = []
    n = 10
    for k in range(n + 1):
        t = k / n
        z = s['from'] + (s['to'] - s['from']) * t
        top = s['wristTop'] + (s['buttTop'] - s['wristTop']) * t
        # a slim straight wrist behind the receiver (where the hand goes), then the belly drops towards the butt
        bt = t ** 1.4
        bottom = s['wristBottom'] + (s['buttBottom'] - s['wristBottom']) * bt
        width = s['wristWidth'] + (s['buttWidth'] - s['wristWidth']) * min(1, t * 1.6)
        secs.append(C.ring((0, (top + bottom) / 2, z), width / 2, (top - bottom) / 2, n=14, power=2.4))
    return C.loft('stock', secs)


def buttplate(P):
    s = P['stock']
    top, bottom = s['buttTop'], s['buttBottom']
    secs = [C.ring((0, (top + bottom) / 2, z), s['buttWidth'] / 2 * 1.01, (top - bottom) / 2 * 1.01, n=14, power=2.4)
            for z in (s['to'] - 0.004, s['to'] + 0.006)]
    return C.loft('butt', secs)


def sights(P):
    s, b = P['sights'], P['barrel']
    top = b['y'] + b['radius'] * 0.92
    front = C.join([
        C.box('fbase', (-0.004, top - 0.002, s['front'] - 0.006), (0.004, top + 0.003, s['front'] + 0.006)),
        C.box('fblade', (-0.0013, top, s['front'] - 0.003), (0.0013, s['lineY'] + 0.0005, s['front'] + 0.003)),
    ], 'fsight')
    # rear: a notched leaf; the notch bottom sits on the sight line
    leaf = [C.box('rbase', (-0.007, top - 0.002, s['rear'] - 0.005), (0.007, top + 0.002, s['rear'] + 0.005))]
    for x in (-0.0055, 0.0055):
        leaf.append(C.box('rpost', (x - 0.0035, top, s['rear'] - 0.0015), (x + 0.0035, s['lineY'] + 0.0035, s['rear'] + 0.0015)))
    leaf.append(C.box('rbar', (-0.009, top, s['rear'] - 0.0015), (0.009, s['lineY'], s['rear'] + 0.0015)))
    return C.join([front, C.join(leaf, 'rsight')], 'sights')


def trigger(P):
    r = P['receiver']
    return C.tube_curve('trigger', [(0, r['bottom'] + 0.002, 0.04), (0, r['bottom'] - 0.01, 0.045), (0, r['bottom'] - 0.02, 0.054)], 0.0024)


def lever(P):
    L, r = P['lever'], P['receiver']
    px, py, pz = L['pivot']
    cx, cy, cz = L['loop']
    R = L['loopRadius']
    pts = [(0, py, pz), (0, r['bottom'] - 0.008, 0.0), (0, r['bottom'] - 0.012, 0.06)]
    for k in range(15):
        a = math.radians(135 + k * (300 - 0) / 14)   # around the finger loop, front-top -> bottom -> back-top
        pts.append((0, cy + R * math.sin(a), cz + R * math.cos(a)))
    pts.append((0, r['bottom'] - 0.01, cz + R * 1.25))
    loop = C.tube_curve('lever_loop', pts, 0.0042, bevel_res=2)
    plate = C.box('lever_plate', (-0.0055, py - 0.006, pz - 0.006), (0.0055, py + 0.003, 0.05))
    return C.join([loop, plate], 'rifle_lever')


def hammer(P):
    hx, hy, hz = P['hammer']['pivot']
    body = C.box('hbody', (-0.0045, hy - 0.004, hz - 0.006), (0.0045, hy + 0.036, hz + 0.008))
    spur = C.box('hspur', (-0.005, hy + 0.03, hz + 0.004), (0.005, hy + 0.038, hz + 0.026))
    return C.join([body, spur], 'rifle_hammer')


def cartridge(P, name, with_bullet=True, z0=0.0):
    rd = P['round']
    L, R = rd['length'], rd['radius']
    case_len = L * (0.68 if with_bullet else 1.0) if with_bullet else L * 0.68
    zs = [(z0 + 0.0, R * 1.18), (z0 + 0.0012, R * 1.18), (z0 + 0.0014, R * 0.92), (z0 + 0.003, R), (z0 + case_len * 0.85, R * 0.97), (z0 + case_len, R * 0.88)]
    secs = [C.ring((0, 0, -z), r, r, n=12) for z, r in zs]
    case = C.loft(name + '_case', secs)
    C.assign(case, C.brass_material(name + '_brass'))
    parts = [case]
    if with_bullet:
        bz = [(z0 + case_len - 0.002, R * 0.86), (z0 + case_len + 0.008, R * 0.84), (z0 + L - 0.006, R * 0.55), (z0 + L, R * 0.18)]
        bullet = C.loft(name + '_bullet', [C.ring((0, 0, -z), r, r, n=12) for z, r in bz])
        C.assign(bullet, C.steel_material(name + '_lead', blue=(0.16, 0.16, 0.17), bare=(0.3, 0.3, 0.31)))
        parts.append(bullet)
    return C.join(parts, name)


def build(P):
    C.reset_scene()
    L = P['look']
    wood = C.wood_material('walnut', dark=tuple(L['walnut'][0]), light=tuple(L['walnut'][1]), grain_axis='Y')
    steel = C.steel_material('blued', blue=tuple(L['blued']), bare=tuple(L['bare']), wear_lo=0.53, wear_hi=0.6)
    body_parts = []
    for ob in (barrel(P), tube(P), band(P, -0.12), band(P, -0.58), receiver(P), sights(P), trigger(P), forend_cap(P), buttplate(P)):
        body_parts.append(C.assign(ob, steel))
    for ob in (forend(P), stock(P)):
        body_parts.append(C.assign(ob, wood))
    body = C.join(body_parts, 'rifle_body')
    lev = C.assign(lever(P), steel)
    ham = C.assign(hammer(P), steel)
    rnd = cartridge(P, 'rifle_round')
    case = cartridge(P, 'rifle_case', with_bullet=False)
    lows = [body, lev, ham, rnd, case]
    for lo in lows:
        C.shade_low(lo, 35)
    highs = [C.high_from(lo, lo.name + '_high', bevel=0.0009, segments=2, subdiv=1, angle=40) for lo in lows]
    for lo in lows:
        C.smart_unwrap(lo, island_margin=0.01, angle=60)
    C.pack_atlas(lows, margin=0.003)
    mat = C.bake_family(list(zip(highs, lows)), P['budget']['texture'], 'rifle', extrusion=0.004, ao_samples=16, ao_strength=0.6)
    for hi in highs:
        C.bpy.data.objects.remove(hi, do_unlink=True)
    objs, report = C.finish_family(lows, mat, lod_ratio=0.55, lod_min=60)
    C.preview([body, lev, ham], f'{C.BUILD_DIR}/rifle_preview.png', eye=(1.25, 0.12, 0.2), target=(0, 0.1, -0.02), lens=40)
    C.export_glb(objs, 'rifle')
    return report
