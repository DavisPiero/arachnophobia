"""Camp axe generator.

Parameters: assets/params/axe.json. Output: axe.glb with `axe` and `axe_lod1`.
Hickory handle with a swelled knob, forged head (rusty cheeks, bright sharpened edge). Handle along z, grip at the origin.
"""
from lib import common as C


def handle(P):
    H = P['handle']
    secs = []
    n = 12
    for k in range(n + 1):
        t = k / n
        z = H['end'] + (H['top'] - H['end']) * t
        # swell at the knob, slimmer in the middle, fuller under the head; a gentle S-curve in y
        s = 1.0 + 0.32 * max(0.0, 1 - t / 0.12) ** 2 - 0.08 * (1 - abs(2 * t - 1)) + 0.1 * max(0.0, (t - 0.8) / 0.2)
        y = H['curve'] * (t * (1 - t) * 4 - 0.5 * max(0.0, 0.15 - t) / 0.15)
        secs.append(C.ring((0, y, z), H['rx'] * s, H['ry'] * s, n=12, power=2.2))
    return C.loft('handle', secs)


def head(P):
    h = P['head']
    T = h['thickness'] / 2
    # stations from the poll (back, +y) to the cutting edge (-y): (y, half thickness, half height)
    span = h['poll'] - h['edge']
    st = [(0.0, 0.62, 0.86), (0.12, 1.0, 1.0), (0.3, 1.0, 1.0), (0.45, 0.7, 0.86), (0.65, 0.38, 1.15), (0.86, 0.14, 1.6), (1.0, 0.03, 1.85)]
    secs = []
    for t, th, ht in st:
        y = h['poll'] - span * t
        secs.append(C.ring((0, y, h['z']), T * th, h['eyeHeight'] * ht, n=12, axis='y', power=4.0))
    return C.loft('head', secs)


def build(P):
    C.reset_scene()
    L = P['look']
    wood = C.wood_material('hickory', dark=tuple(L['hickory'][0]), light=tuple(L['hickory'][1]), grain_axis='Y', scale=14, gloss=0.5)
    steel = C.steel_material('forged', blue=(0.05, 0.05, 0.052), bare=(0.55, 0.55, 0.56), wear_lo=0.505, wear_hi=0.55, rust=L['rust'])
    lo = C.join([C.assign(handle(P), wood), C.assign(head(P), steel)], 'axe')
    C.shade_low(lo, 40)
    hi = C.high_from(lo, 'axe_high', bevel=0.0012, segments=2, subdiv=1, angle=35)
    C.smart_unwrap(lo, island_margin=0.01, angle=60)
    C.pack_atlas([lo], margin=0.004)
    mat = C.bake_family([(hi, lo)], P['budget']['texture'], 'axe', extrusion=0.004, ao_samples=16, ao_strength=0.6)
    C.bpy.data.objects.remove(hi, do_unlink=True)
    objs, report = C.finish_family([lo], mat, lod_ratio=0.55, lod_min=100)
    C.preview([lo], f'{C.BUILD_DIR}/axe_preview.png', eye=(0.9, 0.25, 0.05), target=(0, 0.25, 0), lens=40)
    C.export_glb(objs, 'axe')
    return report
