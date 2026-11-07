"""Lever-action rifle generator (side-gate lever action: round blued barrel, full-length magazine tube, walnut).

Parameters: assets/params/rifle.json (positions in GAME space, metres; the game reads the same pivots).
Output: rifle.glb with
  rifle_body    stock, receiver, barrel, magazine tube, forend, sights, trigger, bolt (one mesh, several materials baked
                into one atlas)
  rifle_lever   the lever and its big finger loop (the game rotates it about lever.pivot)
  rifle_hammer  (rotates about hammer.pivot)
  rifle_round   a cartridge (reloading), rifle_case  a spent case (ejected after each shot)
and `_lod1` copies for phones.

Shapes come from side profiles (receiver, hammer, trigger, lever plate) and turned profiles (barrel, tube, cartridge),
cut with booleans (ejection port, loading gate, bore). Materials are CC0 scans (blender/lib/materials.py): walnut with
cut checkering, blued steel worn bright on the edges, polished bolt, ribbed rubber butt pad, brass bead.
"""
import math

from lib import common as C
from lib import materials as M


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------- materials
def materials(P):
    L = P['look']
    wood = dict(set_id='Wood026', scale=9.0, long_axis='Y', color=L['walnut'], rough=(0.3, 0.48), bump=0.6, bump_dist=0.00025,
                cavity=0.35, wear=dict(color=[c * 1.7 for c in L['walnut']], rough=0.5, lo=0.505, hi=0.56, amount=0.7))
    steel = dict(set_id='Metal046B', scale=7.0, long_axis='Y', color=L['blued'], rough=(0.26, 0.46), metal=1.0, bump=0.4,
                 bump_dist=0.00012, cavity=0.25,
                 wear=dict(color=L['bare'], rough=0.22, metal=1.0, lo=0.508, hi=0.56, noise=90.0))
    mats = {
        'walnut': M.scanned('walnut', **wood),
        'walnut_chk': M.scanned('walnut_chk', **{**wood, 'extra_height': [M.checkering(780, 30, 1.4)]}),
        'blued': M.scanned('blued', **steel),
        'blued_chk': M.scanned('blued_chk', **{**steel, 'extra_height': [M.checkering(900, 45, 1.2, axes=('Y', 'X'))]}),
        'knurl': M.scanned('knurl', **{**steel, 'extra_height': [M.ribs(900, 'X', 1.0, sharp=True)]}),
        'bright': M.scanned('bright', **{**steel, 'color': L['bolt'], 'rough': (0.16, 0.3), 'wear': None, 'cavity': 0.5}),
        'rubber': M.scanned('rubber', 'Rubber004', 10.0, 'Y', color=L['rubber'], rough=(0.72, 0.9), bump=0.6, bump_dist=0.0002,
                            extra_height=[M.ribs(260, 'Z', 1.2)]),
        'brass': M.flat('brass', L['brass'], 0.28, 1.0, 900, 0.00004),
        'copper': M.flat('copper', L['copper'], 0.32, 1.0, 900, 0.00004),
        'lead': M.flat('lead', (0.16, 0.16, 0.17), 0.6, 0.6, 400, 0.0001),
        'primer': M.flat('primer', (0.5, 0.5, 0.52), 0.3, 1.0),
    }
    return mats


# ---------------------------------------------------------------- parts
def barrel(P, mats):
    b = P['barrel']
    prof = [(b['from'] + 0.004, b['radius'] * 1.2), (b['from'] - 0.006, b['radius'] * 1.2), (b['from'] - 0.0075, b['radius']),
            (b['to'] * 0.5 + b['from'] * 0.5, (b['radius'] + b['muzzleRadius']) / 2), (b['to'] + 0.004, b['muzzleRadius']),
            (b['to'] + 0.0012, b['muzzleRadius']), (b['to'], b['muzzleRadius'] * 0.92)]
    ob = C.lathe('barrel', prof, (0, b['y']), n=40)
    C.boolean(ob, C.cylinder('bore', (0, b['y'], b['to'] - 0.01), (0, b['y'], b['to'] + 0.03), 0.0039, n=20))
    return C.assign(ob, mats['blued'])


def tube(P, mats):
    t = P['tube']
    r = t['radius']
    body = C.assign(C.lathe('tube', [(t['from'], r), (t['to'] + 0.016, r)], (0, t['y']), n=32), mats['blued'])
    plug = C.lathe('plug', [(t['to'] + 0.017, r * 1.06), (t['to'] + 0.002, r * 1.06), (t['to'], r * 0.9), (t['to'] - 0.001, r * 0.5)], (0, t['y']), n=32)
    C.assign(plug, mats['knurl'])
    return [body, plug]


def band(P, mats, z, length, name):
    """Barrel band: clamps the magazine tube under the barrel (two lobes, a waist between them)."""
    b, t = P['barrel'], P['tube']
    secs = []
    for zz in (z - length / 2, z - length / 2 + 0.0012, z + length / 2 - 0.0012, z + length / 2):
        grow = 0.0018 if zz in (z - length / 2, z + length / 2) else 0.0024
        ring = []
        n = 40
        for i in range(n):
            a = 2 * math.pi * i / n
            x = math.cos(a); y = math.sin(a)
            # union of two circles (barrel above, tube below) with a waist
            if y > 0:
                cx, cy, R = 0, b['y'], b['radius'] + grow
                yy = cy + max(0, y) * R
                xx = x * R
            else:
                cx, cy, R = 0, t['y'], t['radius'] + grow
                yy = cy + y * R
                xx = x * R
            ring.append(C.G(xx, yy, zz))
        secs.append(ring)
    # loft wants GAME space through G(); points above are already converted
    ob = C.loft(name, secs)
    return C.assign(ob, mats['blued'])


def receiver(P, mats):
    r = P['receiver']
    w = r['width'] / 2
    f, bk, top, bot = r['front'], r['back'], r['top'], r['bottom']
    back_curve = C.catmull([(0.03, top, 0), (0.052, top - 0.003, 0), (0.068, top - 0.01, 0), (bk + 0.002, P['stock']['wristTop'], 0)], per=4)
    outline = [(f + 0.014, bot), (f, bot + 0.014), (f, top - 0.004), (f + 0.003, top)]
    outline += [(p[0], p[1]) for p in back_curve]
    outline += [(bk + 0.002, bot + 0.01), (bk - 0.006, bot)]
    body = C.extrude_profile('receiver', outline, -w, w)
    # rounded top and back: the outline edges of both side faces, upper part
    round_edges(body, lambda p: abs(abs(p[0]) - w) < 1e-5 and p[1] > 0.012, 0.0042, 5)
    # ejection port on top, loading gate recess on the right side
    C.boolean(body, C.box('port', (-0.0075, top - 0.012, -0.06), (0.0075, top + 0.01, 0.018)))
    g = P['loadingGate']
    C.boolean(body, C.box('gate_cut', (w - 0.0012, g[1] - 0.0105, g[2] - 0.0215), (w + 0.01, g[1] + 0.0105, g[2] + 0.0215)))
    C.assign(body, mats['blued'])
    gate = C.box('gate', (w - 0.0014, g[1] - 0.0096, g[2] - 0.0205), (w - 0.0002, g[1] + 0.0096, g[2] + 0.0205))
    C.assign(gate, mats['blued'])
    bolt = C.box('bolt', (-0.0066, top - 0.016, -0.058), (0.0066, top - 0.004, 0.016))
    C.assign(bolt, mats['bright'])
    parts = [body, gate, bolt]
    # screws on both sides
    for z, y in ((f + 0.012, 0.014), (0.05, 0.012), (0.052, bot + 0.008)):
        for s in (-1, 1):
            parts.append(screw('screw', (s * w, y, z), (s, 0, 0), 0.0033, mats))
    # upper and lower tangs running back over and under the wrist
    S = P['stock']
    wt = S['wristTop']
    def on_wood(z, side):
        t = (z - S['from']) / (S['to'] - S['from'])
        top, bottom, _ = stock_section(S, max(0.0, t))
        return top if side > 0 else bottom
    tz = [bk - 0.004, 0.09, 0.11, 0.13, 0.142]
    up = [(z, on_wood(z, 1) + 0.0016) for z in tz]
    dn = [(z, on_wood(z, 1) - 0.0035) for z in reversed(tz)]
    tang = C.extrude_profile('tang', up + dn, -0.0072, 0.0072)
    lz = [bk - 0.008, 0.11, 0.14, 0.168]
    ltang = C.extrude_profile('ltang', [(z, on_wood(z, -1) + 0.003) for z in lz] + [(z, on_wood(z, -1) - 0.0018) for z in reversed(lz)], -0.0068, 0.0068)
    for t_ in (tang, ltang):
        C.assign(t_, mats['blued'])
    parts += [tang, ltang, screw('tscrew', (0, on_wood(0.118, 1) + 0.0016, 0.118), (0, 1, 0.3), 0.0028, mats)]
    return parts


def screw(name, c, n, r, mats):
    """A slotted screw head sitting on a surface at c, facing n (GAME space)."""
    from mathutils import Vector
    N = Vector(n).normalized()
    head = C.lathe(name, [(0, r), (0.0011, r * 0.97), (0.0015, r * 0.75)], (0, 0), axis='z', n=20)   # faces game +z
    C.boolean(head, C.box('slot', (-r * 1.2, -0.00045, 0.0008), (r * 1.2, 0.00045, 0.003)))
    head.rotation_mode = 'QUATERNION'
    head.rotation_quaternion = Vector((0, -1, 0)).rotation_difference(C.G(*N))   # game +z is Blender -Y
    head.location = C.G(*(Vector(c) - N * 0.0008))
    C.bpy.context.view_layer.update()
    C.select_only(head); C.bpy.ops.object.transform_apply(location=True, rotation=True)
    return C.assign(head, mats['blued'])


def round_edges(ob, pred, offset, segments=4):
    """Bevel the edges whose two ends (GAME space) both pass pred(p): rounded receiver top, etc."""
    import bmesh
    bm = bmesh.new(); bm.from_mesh(ob.data)
    gp = lambda v: (v.co.x, v.co.z, -v.co.y)
    edges = [e for e in bm.edges if pred(gp(e.verts[0])) and pred(gp(e.verts[1]))]
    bmesh.ops.bevel(bm, geom=edges, offset=offset, segments=segments, profile=0.5, affect='EDGES', clamp_overlap=True)
    bm.to_mesh(ob.data); bm.free()


def forend(P, mats):
    f = P['forend']
    secs = []
    n = 24
    for k in range(n + 1):
        t = k / n
        z = f['from'] + (f['to'] - f['from']) * t
        swell = 1.0 + 0.05 * math.sin(t * math.pi) - 0.06 * smooth((t - 0.9) / 0.1)
        secs.append(C.ring((0, f['y'], z), f['rx'] * swell, f['ry'] * swell, n=36, power=2.5))
    ob = C.loft('forend', secs)
    z0, z1 = f['from'] + (f['to'] - f['from']) * 0.14, f['from'] + (f['to'] - f['from']) * 0.88
    mats_ = [mats['walnut'], mats['walnut_chk']]
    C.set_material_by(ob, mats_, lambda c, nn: 1 if (z1 < c[2] < z0 and abs(nn[0]) > 0.55 and abs(c[1] - f['y']) < f['ry'] * 0.62) else 0)
    # steel forend cap at the front
    cap = C.loft('fcap', [C.ring((0, f['y'], zz), f['rx'] * s, f['ry'] * s, n=36, power=2.5)
                         for zz, s in ((f['to'] + 0.002, 0.95), (f['to'] - 0.001, 0.96), (f['to'] - 0.012, 0.96), (f['to'] - 0.014, 0.9))])
    C.assign(cap, mats['blued'])
    return [ob, cap]


def stock_section(S, t):
    top = S['wristTop'] - 0.025 * smooth(t / 0.28) - (S['wristTop'] - 0.025 - S['buttTop']) * t
    bottom = S['wristBottom'] + (S['buttBottom'] - S['wristBottom']) * t ** 1.45
    width = S['wristWidth'] * (1 - 0.06 * math.sin(min(1, t / 0.3) * math.pi)) + (S['buttWidth'] - S['wristWidth']) * smooth(t / 0.65)
    return top, bottom, width


def stock(P, mats):
    S = P['stock']
    secs = []
    n = 40
    for k in range(n + 1):
        t = k / n
        z = S['from'] + (S['to'] - S['from']) * t
        top, bottom, width = stock_section(S, t)
        # rounder at the wrist, flatter sides towards the butt
        secs.append(C.ring((0, (top + bottom) / 2, z), width / 2, (top - bottom) / 2, n=40, power=2.2 + 0.5 * t))
    ob = C.loft('stock', secs)
    zc0, zc1 = S['from'] + 0.012, S['from'] + 0.085
    C.set_material_by(ob, [mats['walnut'], mats['walnut_chk']],
                      lambda c, nn: 1 if (zc0 < c[2] < zc1 and abs(nn[0]) > 0.5 and c[1] > -0.045) else 0)
    # rubber butt pad
    top, bottom, width = stock_section(S, 1.0)
    cy, ry, rx = (top + bottom) / 2, (top - bottom) / 2, width / 2
    pad = C.loft('buttpad', [C.ring((0, cy, z), rx * s, ry * s, n=40, power=2.7)
                             for z, s in ((S['to'] - 0.001, 1.0), (S['to'] + 0.012, 1.02), (S['to'] + 0.015, 0.985), (S['to'] + 0.016, 0.95))])
    C.assign(pad, mats['rubber'])
    # sling stud under the butt
    zs = S['from'] + (S['to'] - S['from']) * 0.8
    _, by, _ = stock_section(S, 0.8)
    stud = C.lathe('stud', [(by + 0.001, 0.0034), (by - 0.004, 0.0028), (by - 0.0065, 0.0028), (by - 0.007, 0.002)], (0, zs), axis='y', n=16)
    C.assign(stud, mats['blued'])
    return [ob, pad, stud]


def sights(P, mats):
    s, b = P['sights'], P['barrel']
    rf = b['muzzleRadius'] + (b['radius'] - b['muzzleRadius']) * 0.02
    top = b['y'] + rf * 0.96
    zf = s['front']
    base = C.extrude_profile('fbase', [(zf - 0.008, top - 0.002), (zf + 0.008, top - 0.002), (zf + 0.007, top + 0.0022), (zf - 0.007, top + 0.0022)], -0.0034, 0.0034)
    blade = C.extrude_profile('fblade', [(zf - 0.006, top + 0.002), (zf + 0.006, top + 0.002), (zf + 0.0015, s['lineY'] - 0.0012),
                                         (zf - 0.0012, s['lineY'] - 0.0012)], -0.00115, 0.00115)
    bead = C.lathe('bead', [(zf - 0.0013, 0.0001), (zf - 0.0009, 0.0009), (zf, 0.00125), (zf + 0.0009, 0.0009), (zf + 0.0013, 0.0001)],
                   (0, s['lineY'] - 0.0011), n=16)
    C.assign(base, mats['blued']); C.assign(blade, mats['blued']); C.assign(bead, mats['brass'])
    # rear: semi-buckhorn leaf with a V notch whose bottom is on the sight line, on a dovetail base with an elevator
    zr = s['rear']
    rtop = b['y'] + (b['radius'] + (b['muzzleRadius'] - b['radius']) * 0.3) * 0.96
    rbase = C.extrude_profile('rbase', [(zr - 0.009, rtop - 0.002), (zr + 0.011, rtop - 0.002), (zr + 0.01, rtop + 0.0022), (zr - 0.008, rtop + 0.0022)], -0.005, 0.005)
    ly = s['lineY']
    half = [(0.0, ly), (0.0013, ly + 0.0017), (0.0034, ly + 0.0008), (0.0068, ly + 0.0014), (0.0092, ly + 0.0038), (0.0099, ly + 0.0028),
            (0.0094, rtop + 0.001)]
    outline = half + [(-x, y) for x, y in reversed(half)]
    leaf = C.extrude_profile_xy('rleaf', outline, zr - 0.0008, zr + 0.0008)
    elev = C.extrude_profile('relev', [(zr + 0.001, rtop), (zr + 0.009, rtop), (zr + 0.009, rtop + 0.0026), (zr + 0.006, rtop + 0.0026),
                                      (zr + 0.006, rtop + 0.0042), (zr + 0.003, rtop + 0.0042), (zr + 0.003, rtop + 0.0058), (zr + 0.001, rtop + 0.0058)], -0.0032, 0.0032)
    for o in (rbase, leaf, elev):
        C.assign(o, mats['blued'])
    return [base, blade, bead, rbase, leaf, elev]


def trigger(P, mats):
    r = P['receiver']
    yb = r['bottom']
    front = [(0.031, yb + 0.002), (0.0315, yb - 0.008), (0.035, yb - 0.017), (0.0425, yb - 0.023)]
    back = [(0.0465, yb - 0.0215), (0.0395, yb - 0.0155), (0.0365, yb - 0.008), (0.037, yb + 0.002)]
    ob = C.extrude_profile('trigger', front + back, -0.0021, 0.0021)
    return C.assign(ob, mats['blued_chk'])


def lever(P, mats):
    L, r = P['lever'], P['receiver']
    px, py, pz = L['pivot']
    cy, cz = L['loop'][1], L['loop'][2]
    R = L['loopRadius']          # half height of the finger loop
    A = L['loopLength'] / 2      # half length (front to back)
    yb = r['bottom']
    oval = lambda deg, k=1.0: (0, cy + R * k * math.sin(math.radians(deg)), cz + A * k * math.cos(math.radians(deg)))
    # one continuous bar: pivot -> trigger guard -> big oval loop -> back up to the latch under the lower tang -> forward
    # one continuous bar: pivot -> under the receiver -> one big oval loop round the trigger and the fingers -> forward
    # again under the lower tang to close the loop just behind the trigger
    ctrl = [(0, py - 0.004, pz + 0.012), (0, yb - 0.006, -0.02), (0, yb - 0.008, 0.008),
            oval(165), oval(205), oval(240), oval(270), oval(300), oval(335), oval(10), oval(50),
            (0, cy + R * 0.96, cz - A * 0.15), (0, cy + R * 0.93, cz - A * 0.55), (0, yb - 0.012, 0.03)]
    pts = C.catmull(ctrl, per=6)
    bar = C.tube_curve('lever_bar', pts, 0.0045, profile=(0.0085, 0.0078))
    plate = C.extrude_profile('lever_plate', [(pz - 0.01, py + 0.006), (pz + 0.03, r['bottom'] + 0.001), (0.005, r['bottom'] - 0.001),
                                              (0.005, r['bottom'] - 0.0095), (pz + 0.03, r['bottom'] - 0.0105), (pz - 0.01, py - 0.006)],
                              -0.0055, 0.0055, smooth=2)
    C.assign(bar, mats['blued']); C.assign(plate, mats['blued'])
    parts = [bar, plate] + [screw('pivot', (s * 0.0055, py, pz), (s, 0, 0), 0.003, mats) for s in (-1, 1)]
    return C.join(parts, 'rifle_lever')


def hammer(P, mats):
    hx, hy, hz = P['hammer']['pivot']
    pts = [(hz - 0.008, hy - 0.006), (hz + 0.006, hy - 0.008), (hz + 0.009, hy + 0.016), (hz + 0.013, hy + 0.027), (hz + 0.022, hy + 0.033),
           (hz + 0.029, hy + 0.037), (hz + 0.028, hy + 0.042), (hz + 0.014, hy + 0.04), (hz + 0.002, hy + 0.035), (hz - 0.006, hy + 0.024),
           (hz - 0.009, hy + 0.008)]
    ob = C.extrude_profile('rifle_hammer', pts, -0.0042, 0.0042, smooth=3)
    C.set_material_by(ob, [mats['blued'], mats['blued_chk']], lambda c, nn: 1 if (nn[1] > 0.5 and c[1] > hy + 0.032) else 0)
    return ob


def cartridge(P, mats, name, with_bullet=True):
    """.30-30 style rimmed bottleneck round, pointing -z from the origin (the base)."""
    rd = P['round']
    L, R = rd['length'], rd['radius']
    k = R / 0.0062
    case_prof = [(0.0, 0.0064 * k), (0.0014, 0.0064 * k), (0.0017, 0.005 * k), (0.0027, 0.005 * k), (0.0031, 0.0054 * k),
                 (0.034 * k, 0.0051 * k), (0.039 * k, 0.0038 * k), (0.0515 * k, 0.0037 * k)]
    if not with_bullet:
        case_prof += [(0.0515 * k, 0.0033 * k), (0.046 * k, 0.0033 * k)]
    case = C.lathe(name + '_case', [(-z, r) for z, r in case_prof], (0, 0), n=24, cap_start=True, cap_end=not with_bullet)
    C.assign(case, mats['brass'])
    primer = C.lathe(name + '_primer', [(0.0003, 0.0019 * k), (-0.0002, 0.0019 * k)], (0, 0), n=16)
    C.assign(primer, mats['primer'])
    parts = [case, primer]
    if with_bullet:
        bp = [(0.0505 * k, 0.0037 * k), (0.0525 * k, 0.00385 * k), (0.057 * k, 0.0037 * k), (0.061 * k, 0.003 * k), (L - 0.0012, 0.0021 * k)]
        jacket = C.lathe(name + '_jacket', [(-z, r) for z, r in bp], (0, 0), n=24, cap_start=True, cap_end=False)
        C.assign(jacket, mats['copper'])
        tip = C.lathe(name + '_tip', [(-(L - 0.0014), 0.0021 * k), (-(L - 0.0003), 0.0019 * k), (-L, 0.0012 * k)], (0, 0), n=24, cap_start=False, cap_end=True)
        C.assign(tip, mats['lead'])
        parts += [jacket, tip]
    return C.join(parts, name)


def build(P):
    C.reset_scene()
    mats = materials(P)
    body_parts = [barrel(P, mats)] + tube(P, mats)
    body_parts += [band(P, mats, P['tube']['to'] + 0.035, 0.011, 'band_front'), band(P, mats, P['barrel']['from'] - 0.004, 0.007, 'band_rear')]
    body_parts += receiver(P, mats) + forend(P, mats) + stock(P, mats) + sights(P, mats) + [trigger(P, mats)]
    body = C.join(body_parts, 'rifle_body')
    lev = lever(P, mats)
    ham = hammer(P, mats)
    rnd = cartridge(P, mats, 'rifle_round')
    case = cartridge(P, mats, 'rifle_case', with_bullet=False)
    lows = [body, lev, ham, rnd, case]
    for lo in lows:
        C.shade_low(lo, 32)
    highs = [C.high_from(lo, lo.name + '_high', bevel=0.0008, segments=3, subdiv=0, angle=32) for lo in lows]
    for hi in highs:
        C.shade_low(hi, 32)   # no subdivision: it smears the boolean cuts in the receiver
    for lo in lows:
        C.smart_unwrap(lo, island_margin=0.004, angle=55)
    C.pack_atlas(lows, margin=0.002)
    mat = C.bake_family(list(zip(highs, lows)), P['budget']['texture'], 'rifle', extrusion=0.0025, ao_samples=24, ao_strength=0.55)
    for hi in highs:
        C.bpy.data.objects.remove(hi, do_unlink=True)
    objs, report = C.finish_family(lows, mat, lod_ratio=0.5, lod_min=60)
    C.render_preview([body, lev, ham], f'{C.BUILD_DIR}/rifle_preview.png', eye=(1.25, 0.12, 0.08), target=(0, 0.12, -0.02), lens=34)
    C.render_preview([body, lev, ham], f'{C.BUILD_DIR}/rifle_preview_action.png', eye=(0.38, 0.02, 0.03), target=(0, -0.02, -0.02), lens=50)
    C.export_glb(objs, 'rifle')
    return report
