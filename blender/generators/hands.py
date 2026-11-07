"""Gloved hands, sleeves and a boot (first-person view).

Parameters: assets/params/hands.json. Output: hands.glb with
  arm_grip_r     right hand closed round a handle along z (rifle wrist), sleeve going back to the shoulder
  arm_axe_r      the same fist, forearm below the handle (axe)
  arm_support_l  left hand cradling the rifle forend from below
  arm_load_l     left hand pinching a cartridge at the origin (reloading)
  boot           right boot and trouser leg (stomp), toe towards -z
and `_lod1` copies. One baked atlas: leather work gloves, waxed canvas sleeves, boot leather.
Hands are metaballs (organic, gloves blur the fingers anyway), baked HIGH -> LOW like everything else.
"""
import math

from mathutils import Vector, noise

from lib import common as C


def V(*a):
    return Vector(a)


def around(a_deg, rx, ry, z):
    a = math.radians(a_deg)
    return (rx * math.cos(a), ry * math.sin(a), z)


def finger_chain(start_deg, end_deg, rx, ry, z, r, segs=3, taper=0.88):
    """A finger curled along an ellipse round the handle: capsules from joint to joint."""
    els = []
    pts = [around(start_deg + (end_deg - start_deg) * k / segs, rx, ry, z) for k in range(segs + 1)]
    rr = r
    for a, b in zip(pts, pts[1:]):
        els.append(('capsule', a, b, rr))
        rr *= taper
    return els, pts


def fist(P, R):
    """Right fist round a handle of radius R along z. Palm on +x, fingers under, thumb over the top."""
    F, T = P['finger'], P['thumb']
    fr = F['radius']
    els = []
    zs = [-1.5 * F['spacing'], -0.5 * F['spacing'], 0.5 * F['spacing'], 1.45 * F['spacing']]
    for z, L in zip(zs, F['lengths']):
        rc = R + fr
        arc = math.degrees(L / rc)
        e, pts = finger_chain(-40, -40 - arc, rc, rc, z, fr * (0.92 if L < 0.07 else 1.0))
        els += e
        # knuckle and palm pad behind each finger
        els.append(('ball', around(-28, R + fr + 0.008, R + fr + 0.008, z), None, fr * 1.25))
        els.append(('ball', around(0, R + 0.019, R + 0.019, z * 0.9), None, 0.016))
    # heel of the hand and back of the palm
    els.append(('capsule', around(18, R + 0.02, R + 0.02, -0.022), around(18, R + 0.02, R + 0.02, 0.026), 0.017))
    # thumb: from the heel over the top of the handle
    tz = zs[0] - 0.006
    base = around(32, R + 0.03, R + 0.03, tz + 0.012)
    mid = around(72, R + T['radius'] + 0.002, R + T['radius'] + 0.002, tz - 0.004)
    tip = around(122, R + T['radius'], R + T['radius'], tz - 0.006)
    els += [('capsule', base, mid, T['radius'] * 1.15), ('capsule', mid, tip, T['radius'])]
    wrist = V(*around(14, R + 0.036, R + 0.036, 0.036))
    return els, wrist


def support(P):
    """Left hand under an oval forend (rx, ry) along z. Palm below, fingers up the right side, thumb up the left."""
    F, T, S = P['finger'], P['thumb'], P['support']
    fr = F['radius']
    rx, ry = S['rx'] + fr, S['ry'] + fr
    els = []
    zs = [-1.5 * F['spacing'], -0.5 * F['spacing'], 0.5 * F['spacing'], 1.45 * F['spacing']]
    for z, L in zip(zs, F['lengths']):
        arc = math.degrees(L / ((rx + ry) / 2)) * 0.8   # relaxed: the fingers only half wrap
        e, _ = finger_chain(-50, -50 + arc, rx, ry, z, fr * (0.92 if L < 0.07 else 1.0))
        els += e
        els.append(('ball', around(-62, rx + 0.006, ry + 0.006, z), None, fr * 1.25))
        els.append(('ball', around(-95, rx + 0.012, ry + 0.012, z * 0.9), None, 0.016))
    els.append(('capsule', around(-128, rx + 0.014, ry + 0.012, -0.018), around(-128, rx + 0.014, ry + 0.012, 0.026), 0.017))
    tz = zs[0] - 0.004
    base = around(-140, rx + 0.02, ry + 0.02, tz + 0.014)
    mid = around(-178, rx + 0.003, ry + 0.003, tz - 0.002)
    tip = around(150, rx, ry, tz - 0.004)
    els += [('capsule', base, mid, T['radius'] * 1.15), ('capsule', mid, tip, T['radius'])]
    wrist = V(*around(-140, rx + 0.032, ry + 0.03, 0.034))
    return els, wrist


def pinch(P):
    """Left hand pinching a cartridge at the origin between thumb and index; the other fingers curled into the palm."""
    F, T = P['finger'], P['thumb']
    fr = F['radius']
    palm = V(-0.008, -0.034, 0.046)
    els = [('ball', tuple(palm), None, 0.026), ('ball', tuple(palm + V(0.012, 0.01, -0.016)), None, 0.022)]
    # index: from the knuckle, straight-ish to the round
    k = palm + V(0.012, 0.022, -0.02)
    els += [('capsule', tuple(k), tuple(V(0.004, 0.012, -0.006)), fr), ('capsule', (0.004, 0.012, -0.006), (0.002, 0.008, 0.004), fr * 0.88)]
    # thumb: from the heel of the hand to the other side of the round
    tb = palm + V(-0.02, 0.0, -0.005)
    els += [('capsule', tuple(tb), (-0.012, -0.006, 0.004), T['radius'] * 1.1), ('capsule', (-0.012, -0.006, 0.004), (-0.002, -0.006, 0.0), T['radius'])]
    # middle, ring, pinky curled into the palm
    for i, dz in enumerate((0.0, 0.014, 0.026)):
        a = palm + V(0.022, 0.012 - i * 0.004, -0.012 + dz)
        b = a + V(0.006, -0.018, 0.004)
        c = b + V(-0.012, -0.008, 0.002)
        els += [('capsule', tuple(a), tuple(b), fr * 0.96), ('capsule', tuple(b), tuple(c), fr * 0.86)]
    wrist = palm + V(-0.022, -0.02, 0.03)
    return els, wrist


def sleeve(P, name, wrist, d, seed):
    """Glove cuff + jacket sleeve from the wrist along direction d (game space)."""
    S = P['sleeve']
    d = d.normalized()
    up = V(0, 1, 0) if abs(d.y) < 0.9 else V(1, 0, 0)
    a = d.cross(up).normalized(); b = d.cross(a).normalized()
    secs = []
    n = 9
    for k in range(n):
        t = k / (n - 1)
        c = wrist + d * (S['cuff'] * 0.6 + t * S['length'])
        r = S['cuff'] + (S['elbow'] - S['cuff']) * t
        ring = []
        for i in range(16):
            ang = 2 * math.pi * i / 16
            fold = S['folds'] * noise.noise(V(math.cos(ang) * 2, math.sin(ang) * 2, t * 6 + seed))
            # the sleeve is a little flattened (an arm, not a pipe)
            p = c + a * math.cos(ang) * (r + fold) + b * math.sin(ang) * (r * 0.86 + fold)
            ring.append(C.G(p.x, p.y, p.z))
        secs.append(ring)
    return C.loft(name + '_sleeve', secs, cap_start=False)


def arm(P, name, els, wrist, d, glove, cloth, seed):
    d = V(*d).normalized()
    els = els + [('capsule', tuple(wrist - d * 0.004), tuple(wrist + d * 0.05), 0.029)]   # glove gauntlet
    hi_hand = C.metaball_mesh(name + '_hand_hi', els, resolution=0.0016)
    lo_hand = C.metaball_mesh(name + '_hand', els, resolution=0.0035)
    C.decimate_to(lo_hand, P['budget']['hand'])
    for o in (hi_hand, lo_hand):
        C.assign(o, glove)
    lo_sl = C.assign(sleeve(P, name, wrist, d, seed), cloth)
    hi_sl = C.high_from(lo_sl, name + '_sleeve_hi', bevel=0, subdiv=2)
    lo = C.join([lo_hand, lo_sl], name)
    hi = C.join([hi_hand, hi_sl], name + '_high')
    C.shade_low(lo, 70)
    return hi, lo


def boot(P, leather, cloth):
    """Right boot, toe towards -z, sole at y=0; trouser leg up to the knee."""
    secs = []
    prof = [(0.11, 0.04, 0.085), (0.06, 0.052, 0.1), (0.0, 0.054, 0.095), (-0.06, 0.05, 0.075), (-0.12, 0.047, 0.055), (-0.165, 0.035, 0.035), (-0.18, 0.02, 0.022)]
    for z, half_w, h in prof:
        secs.append(C.ring((0, h / 2 + 0.012, z), half_w, h / 2, n=14, power=3.0))
    foot = C.loft('boot_foot', secs)
    shaft = C.loft('boot_shaft', [C.ring((0, y, 0.075 - y * 0.08), 0.05 + y * 0.02, 0.055 + y * 0.02, n=14, axis='y', power=2.2)
                                   for y in (0.06, 0.2)])
    sole = C.box('boot_sole', (-0.056, 0.0, -0.185), (0.056, 0.014, 0.125))
    upper = C.join([foot, shaft], 'boot_upper')
    C.assign(upper, leather)
    C.assign(sole, C.steel_material('sole', blue=(0.02, 0.02, 0.02), bare=(0.05, 0.05, 0.05)))
    # the trouser leg rises up and back towards the player, so from the eye it runs to the bottom of the screen
    leg = C.loft('boot_leg', [C.ring((0, y, z), r, r * 1.05, n=16, axis='y', power=2.0)
                              for y, z, r in ((0.17, 0.06, 0.066), (0.5, 0.2, 0.076), (0.9, 0.5, 0.088), (1.35, 0.95, 0.1))])   # top ends behind the eye
    C.assign(leg, cloth)
    lo = C.join([upper, sole, leg], 'boot')
    hi = C.high_from(lo, 'boot_high', bevel=0.003, segments=2, subdiv=1, angle=50)
    C.shade_low(lo, 50)
    return hi, lo


def build(P):
    C.reset_scene()
    L = P['look']
    glove = C.leather_material('glove', base=tuple(L['glove']), worn=tuple(L['gloveWorn']))
    cloth = C.cloth_material('sleeve', base=tuple(L['sleeve']))
    trousers = C.cloth_material('trousers', base=tuple(L['trousers']))
    bootl = C.leather_material('bootleather', base=tuple(L['boot']), worn=(0.1, 0.075, 0.055), scale=200)
    FA = P['forearm']
    R = P['grip']['radius']
    pairs = []
    els, w = fist(P, R)
    pairs.append(arm(P, 'arm_grip_r', els, w, FA['grip'], glove, cloth, 1.0))
    els, w = fist(P, P['grip']['axeRadius'])
    pairs.append(arm(P, 'arm_axe_r', els, w, FA['axe'], glove, cloth, 2.0))
    els, w = support(P)
    pairs.append(arm(P, 'arm_support_l', els, w, FA['support'], glove, cloth, 3.0))
    els, w = pinch(P)
    pairs.append(arm(P, 'arm_load_l', els, w, FA['load'], glove, cloth, 4.0))
    pairs.append(boot(P, bootl, trousers))
    lows = [lo for hi, lo in pairs]
    for lo in lows:
        C.smart_unwrap(lo, island_margin=0.01, angle=66)
    C.pack_atlas(lows, margin=0.003)
    mat = C.bake_family(pairs, P['budget']['texture'], 'hands', extrusion=0.005, ao_samples=16, ao_strength=0.65)
    for hi, lo in pairs:
        C.bpy.data.objects.remove(hi, do_unlink=True)
    objs, report = C.finish_family(lows, mat, lod_ratio=0.5, lod_min=300)
    C.preview(lows[:3], f'{C.BUILD_DIR}/hands_preview.png', eye=(0.0, -0.75, 0.25), target=(0, 0, -0.05), lens=50)
    C.export_glb(objs, 'hands')
    return report
