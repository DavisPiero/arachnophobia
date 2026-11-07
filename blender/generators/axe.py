"""Forest axe generator.

Parameters: assets/params/axe.json. Output: axe.glb with `axe` and `axe_lod1`.
GAME space: the handle runs along z with the right hand's grip at the origin; the head is at -z, its cutting edge
points to -y (the poll to +y).

Head: hand-forged look: dark forge scale (CC0 scan, re-tinted) on a square poll and cheeks that taper to a bearded bit,
and a bright ground bevel along a slightly convex edge. Handle: pale hickory with a gentle S-curve, a hooked swell at
the end and a wedge kerf showing at the top of the eye.
"""
import math

from lib import common as C
from lib import materials as M


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def materials(P):
    L = P['look']
    return {
        'hickory': M.scanned('hickory', 'Wood058', 7.0, 'Y', color=L['hickory'], rough=(0.42, 0.62), bump=0.5, bump_dist=0.0002,
                             cavity=0.3, wear=dict(color=[min(1, c * 1.25) for c in L['hickory']], rough=0.35, amount=0.6),
                             dirt=dict(set_id='Ground051', color=L['grime'], amount=0.25, scale=9.0, rough=0.7, height=0.3, crease=0.006)),
        'kerf': M.flat('kerf', (0.04, 0.025, 0.012), 0.7),
        'forged': M.scanned('forged', 'Metal038', 8.0, 'Y', color=L['scale'], rough=(0.45, 0.75), metal=0.85, bump=1.2, bump_dist=0.0003,
                            cavity=0.4, wear=dict(color=L['steel'], rough=0.3, metal=1.0, amount=0.8, noise=40.0)),
        'edge': M.scanned('edge', 'Metal046B', 12.0, 'Y', color=L['steel'], rough=(0.14, 0.26), metal=1.0, bump=0.2, bump_dist=0.00008,
                          extra_height=[M.ribs(2600, 'Y', 0.6)]),
    }


def handle(P, mats):
    H = P['handle']
    secs = []
    n = 40
    for k in range(n + 1):
        t = k / n                       # 0 = knob end, 1 = top of the eye
        z = H['end'] + (H['top'] - H['end']) * t
        knob = max(0.0, 1 - t / 0.13) ** 2                       # hooked swell at the end
        shoulder = smooth((t - 0.72) / 0.12) * (1 - smooth((t - 0.87) / 0.03))   # fuller just below the head
        s_y = 1.0 + 0.55 * knob + 0.16 * shoulder - 0.06 * math.sin(t * math.pi)
        s_x = 1.0 + 0.25 * knob + 0.1 * shoulder - 0.05 * math.sin(t * math.pi)
        # S-curve towards the poll side (+y), the knob hooking that way most
        y = H['curve'] * (math.sin(t * math.pi) * 0.7) + 0.016 * knob
        if t > 0.87:                    # through the eye: slimmer
            s_x *= 0.86; s_y *= 0.92
        secs.append(C.ring((0, y, z), H['rx'] * s_x, H['ry'] * s_y, n=28, power=2.15))
    ob = C.loft('handle', secs)
    C.assign(ob, mats['hickory'])
    # wedge kerf across the top of the eye
    kerf = C.box('kerf', (-H['rx'] * 0.82, -0.0008, H['top'] - 0.0012), (H['rx'] * 0.82, 0.0008, H['top'] + 0.004))
    C.assign(kerf, mats['kerf'])
    return [ob, kerf]


def head(P, mats):
    h = P['head']
    z0 = h['z']
    top = z0 - h['eyeHeight']             # the flat top of the head (towards -z)
    span = h['poll'] - h['edge']
    secs = []
    n_s, n_r = 30, 32
    for k in range(n_s + 1):
        t = k / n_s                         # 0 = poll face, 1 = cutting edge
        y = h['poll'] - span * t
        # height: square around the eye, then the beard drops towards the bit
        height = h['eyeHeight'] * 2 * (1.0 if t < 0.3 else 1.0 + (h['edgeHeight'] / h['eyeHeight'] - 1.0) * smooth((t - 0.3) / 0.7) ** 1.3)
        # thickness: full at the poll and eye, cheeks taper, a thin bit
        T = h['thickness'] / 2
        if t < 0.08:
            th = T * (0.86 + 0.14 * t / 0.08)
        elif t < 0.36:
            th = T * (1.0 + 0.06 * math.sin((t - 0.08) / 0.28 * math.pi))
        else:
            th = T * (1.0 - (t - 0.36) / 0.64) ** 1.25 + 0.0004
        power = 6.0 if t < 0.36 else 6.0 - 4.0 * smooth((t - 0.36) / 0.5)
        ring = []
        for i in range(n_r):
            a = 2 * math.pi * i / n_r
            c, s = math.cos(a), math.sin(a)
            x = math.copysign(abs(c) ** (2 / power), c) * th
            v = math.copysign(abs(s) ** (2 / power), s)          # -1 (top) .. 1 (bottom)
            zz = top + (v + 1) / 2 * height
            # convex edge: the bit's middle reaches further than its corners
            yy = y - 0.012 * (1 - v * v) * smooth((t - 0.75) / 0.25)
            ring.append(C.G(x, yy, zz))
        secs.append(ring)
    ob = C.loft('head', secs)
    edge_y = h['edge'] + 0.019
    C.set_material_by(ob, [mats['forged'], mats['edge']], lambda c, nn: 1 if c[1] < edge_y - 0.012 * 0 and c[1] < edge_y else 0)
    return ob


def build(P):
    C.reset_scene()
    mats = materials(P)
    lo = C.join(handle(P, mats) + [head(P, mats)], 'axe')
    C.shade_low(lo, 40)
    hi = C.high_from(lo, 'axe_high', bevel=0.0006, segments=2, subdiv=0, angle=40)
    C.shade_low(hi, 40)
    C.smart_unwrap(lo, island_margin=0.006, angle=60)
    C.pack_atlas([lo], margin=0.004)
    mat = C.bake_family([(hi, lo)], P['budget']['texture'], 'axe', extrusion=0.003, ao_samples=24, ao_strength=0.55)
    C.bpy.data.objects.remove(hi, do_unlink=True)
    objs, report = C.finish_family([lo], mat, lod_ratio=0.5, lod_min=200)
    C.render_preview([lo], f'{C.BUILD_DIR}/axe_preview.png', eye=(0.95, 0.24, -0.02), target=(0, 0.22, -0.02), lens=40)
    C.export_glb(objs, 'axe')
    return report
