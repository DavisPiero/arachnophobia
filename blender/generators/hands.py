"""Gloved hands and jacket sleeves (first-person view).

Parameters: assets/params/hands.json. Output: hands.glb with
  arm_grip_r     right hand closed round the rifle wrist (a handle along z at the origin), sleeve back to the shoulder
  arm_axe_r      the same hand round the axe handle
  arm_support_l  left hand cradling the rifle forend from below
  arm_load_l     left hand pinching a cartridge (base at the origin, bullet towards -z)
and `_lod1` copies. One baked atlas.

How a hand is made:
  1. One anatomical skeleton (hands.json): knuckles (MCP), three-joint fingers, a thumb, in a HAND frame:
     x = thumb side, y = back of the hand, z = towards the finger tips, origin = middle of the wrist.
  2. A pose bends it: fingers wrap the handle (solved so each joint lands on the handle's surface), or reach a target
     (the cartridge pinch, the thumbs). The handle is tilted across the palm so the forearm leaves at the angle the
     parameter file asks for.
  3. Tapered fingers, the palm, the thumb's pad and the glove cuff are lofted along the skeleton, fused into one surface
     (voxel remesh), smoothed, and pressed out of the handle so the grip really touches it.
  4. Glove panels by region: synthetic fabric on the back, leather on the palm and finger fronts, a knit cuff, stitched
     seams between them; a moulded hard knuckle guard and knuckle pads on the fingers.
  5. A dark jacket sleeve with folds and a ribbed knit cuff goes back along the forearm.
  6. HIGH = the fused hand (all detail), LOW = a decimated copy; bake HIGH -> LOW like everything else.
Everything is built in the hand frame and only placed in GAME space by the object's transform, so the scanned textures
run along the fingers and the arm. The transform is applied just before export.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from lib import common as C
from lib import materials as M


def V(*a):
    return Vector(a)


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------- skeleton solvers (hand frame)
def circle_hits(A, rA, O, rO):
    """Intersections of two circles in 2D (Vectors). [] if none."""
    d = (O - A).length
    if d < 1e-9 or d > rA + rO or d < abs(rA - rO):
        return []
    a = (rA * rA - rO * rO + d * d) / (2 * d)
    h = math.sqrt(max(0.0, rA * rA - a * a))
    m = A + (O - A) * (a / d)
    perp = V(-(O - A).y, (O - A).x) / d
    return [m + perp * h, m - perp * h]


def wrap_finger(mcp, lengths, radii, d0, axis_pt, axis_dir, R, gap=0.0, max_flex=105):
    """Joints of a finger that curls round a cylinder (axis_pt, axis_dir, radius R) from its knuckle `mcp`.
    The finger bends in its own plane (spanned by d0 = its straight direction, and the palm side -y)."""
    up = V(0, 1, 0)
    n = d0.cross(up).normalized()                 # plane normal
    u_ax, v_ax = d0.normalized(), n.cross(d0).normalized()   # v_ax ~ +y (back of hand)
    if v_ax.y < 0:
        v_ax = -v_ax
    t = n.dot(mcp - axis_pt) / (n.dot(axis_dir) or 1e-6)
    O3 = axis_pt + axis_dir * t
    to2 = lambda p: V((p - mcp).dot(u_ax), (p - mcp).dot(v_ax))
    O = to2(O3)
    Reff = R / math.sqrt(max(0.3, abs(n.dot(axis_dir))))
    pts2 = [V(0.0, 0.0)]
    sign = None
    dirp = V(1.0, 0.0)
    for L, r in zip(lengths, radii):
        A = pts2[-1]
        hits = circle_hits(A, L, O, Reff + r + gap)
        Q = None
        if hits:
            if sign is None:
                Q = min(hits, key=lambda q: q.y)                     # first bone heads towards the palm side
                sign = math.copysign(1, (A - O).x * (Q - O).y - (A - O).y * (Q - O).x)
            else:
                Q = next((q for q in hits if math.copysign(1, (A - O).x * (q - O).y - (A - O).y * (q - O).x) == sign), hits[0])
        if Q is None:                                                 # cannot reach: bend a fixed amount
            ang = math.radians(35)
            c, s = math.cos(-ang), math.sin(-ang)
            Q = A + V(dirp.x * c - dirp.y * s, dirp.x * s + dirp.y * c) * L
        # limit how far one joint may bend
        nd = (Q - A).normalized()
        bend = math.degrees(math.acos(max(-1, min(1, nd.dot(dirp)))))
        if bend > max_flex:
            k = math.radians(max_flex)
            c, s = math.cos(-k), math.sin(-k)
            nd = V(dirp.x * c - dirp.y * s, dirp.x * s + dirp.y * c)
            Q = A + nd * L
        dirp = nd
        pts2.append(Q)
    return [mcp + u_ax * p.x + v_ax * p.y for p in pts2], n


def fk_finger(mcp, lengths, d0, angles):
    """Joints from flexion angles (degrees) at MCP, PIP, DIP, bending towards the palm (-y)."""
    up = V(0, 1, 0)
    n = d0.cross(up).normalized()
    pts = [mcp.copy()]
    d = d0.normalized()
    for L, a in zip(lengths, angles):
        d = Matrix.Rotation(-math.radians(a), 3, n) @ d     # towards the palm (-y)
        pts.append(pts[-1] + d * L)
    return pts, n


def fabrik(base, lengths, target, pole, iters=30):
    """Chain from `base` reaching for `target`, bending towards `pole`."""
    pts = [base.copy()]
    for L in lengths:
        pts.append(pts[-1] + (target - base).normalized() * L)
    # start bent towards the pole so the solve keeps that side
    for i in range(1, len(pts) - 1):
        pts[i] += (pole - pts[i]).normalized() * 0.01
    total = sum(lengths)
    if (target - base).length >= total:
        d = (target - base).normalized()
        return [base + d * sum(lengths[:i]) for i in range(len(lengths) + 1)]
    for _ in range(iters):
        pts[-1] = target.copy()
        for i in range(len(pts) - 2, -1, -1):
            pts[i] = pts[i + 1] + (pts[i] - pts[i + 1]).normalized() * lengths[i]
        pts[0] = base.copy()
        for i in range(1, len(pts)):
            pts[i] = pts[i - 1] + (pts[i] - pts[i - 1]).normalized() * lengths[i - 1]
    return pts


# ---------------------------------------------------------------- hand skeleton for a pose
def skeleton(P, pose, thumb_at=None):
    """Right-hand skeleton in the hand frame for one pose. Returns dict with fingers (list of joint lists and their
    bend normals), thumb joints, the handle (axis point, dir, radius) or None, and the hand->game basis info."""
    S = P['skeleton']
    fingers = S['fingers']
    out = {'fingers': [], 'normals': [], 'radii': []}
    kind = pose['kind']
    handle = None
    if kind == 'grip':
        f = V(*pose['forearm']).normalized()
        fz = -f.z if pose.get('thumb') == 'back' else f.z
        tau = math.radians(pose['tilt']) if 'back' in pose else math.asin(max(-0.94, min(0.94, fz)))             # the handle runs diagonally across the palm, so
        # that the forearm can leave along pose['forearm'] with a straight wrist
        a = V(math.cos(tau), 0, math.sin(tau)).normalized()     # handle axis, pointing to the thumb side
        R = (pose['rx'] + pose['ry']) / 2
        C0 = V(0.0, -(S['palmThickness'] / 2 + R + 0.002), pose['across'])
        handle = (C0, a, R)
    for fd in fingers:
        mcp = V(*fd['mcp'])
        d0 = Matrix.Rotation(math.radians(fd['spread']), 3, 'Y') @ V(0, 0, 1)
        radii = [fd['radius'] * (0.9 ** i) for i in range(3)]
        if kind == 'grip':
            j, n = wrap_finger(mcp, fd['lengths'], radii, d0, handle[0], handle[1], handle[2], gap=pose.get('gap', 0.0))
        else:
            ang = pose['curl'].get(fd['name'], [10, 10, 5])
            j, n = fk_finger(mcp, fd['lengths'], d0, ang)
        out['fingers'].append(j); out['normals'].append(n); out['radii'].append(radii)
    T = S['thumb']
    cmc = V(*T['cmc'])
    if kind == 'grip':
        # thumb tip rests over the index finger's middle bone, on the far side of the handle
        idx = out['fingers'][0]
        mid = (idx[1] + idx[2]) / 2
        foot = handle[0] + handle[1] * handle[1].dot(mid - handle[0])
        out_dir = (mid - foot).normalized()
        target = mid + out_dir * (out['radii'][0][1] + T['radius'] * 0.9) + handle[1] * pose.get('thumbAlong', 0.012)
        pole = cmc + V(0.03, 0.03, 0.02)
        if thumb_at is not None:          # the pose names where the thumb rests (pose['thumbAt'], GAME space)
            target, pole = thumb_at, cmc + V(0.04, -0.01, 0.02)
        thumb = fabrik(cmc, T['lengths'], target, pole)
    else:
        pinch = V(*pose['pinch'])
        q = V(*pose['pinchDir']).normalized()
        thumb = fabrik(cmc, T['lengths'], pinch - q * pose['gapThumb'], cmc + V(0.03, -0.02, 0.0))
        # the index reaches the other side of the round
        fd = fingers[0]
        out['fingers'][0] = fabrik(V(*fd['mcp']), fd['lengths'], pinch + q * pose['gapIndex'], V(*fd['mcp']) + V(0.0, 0.03, 0.04))
    out['thumb'] = thumb
    out['handle'] = handle
    return out


# ---------------------------------------------------------------- surfaces (hand frame, GAME-like coordinates)
def frame_along(pts, side_hint):
    """Per point: tangent, 'back' (dorsal) and lateral unit vectors, the back kept towards side_hint."""
    frames = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        b = side_hint - t * side_hint.dot(t)
        b = b.normalized() if b.length > 1e-6 else V(0, 1, 0)
        frames.append((t, b, t.cross(b)))
    return frames


def tube_along(name, pts, radii, back_hint, flat=0.85, n=20, tip=True, start_back=0.0):
    """Loft a finger-like tube along joint points: elliptical (flatter front-to-back), joints slightly bulged, rounded tip."""
    # resample smoothly through the joints
    ctrl = [pts[0] - (pts[1] - pts[0]).normalized() * start_back] + list(pts) if start_back else list(pts)
    S = [V(*p) for p in C.catmull([tuple(p) for p in ctrl], per=6)]
    # radius along the curve: interpolate per joint, bulge at the joints (glove fabric bunches there)
    seg_len = [(S[i + 1] - S[i]).length for i in range(len(S) - 1)]
    total = sum(seg_len)
    acc = [0.0]
    for l in seg_len:
        acc.append(acc[-1] + l)
    joint_s = []
    a = 0.0
    jl = [(ctrl[i + 1] - ctrl[i]).length for i in range(len(ctrl) - 1)]
    for l in jl:
        joint_s.append(a); a += l
    joint_s.append(a)
    jr = ([radii[0] * 1.08] if start_back else []) + [radii[0] * 1.05] + list(radii[1:]) + [radii[-1] * 0.92]
    jr = jr[:len(joint_s)] + [jr[-1]] * (len(joint_s) - len(jr))

    def rad(s):
        s *= a / max(1e-6, total)
        for i in range(len(joint_s) - 1):
            if s <= joint_s[i + 1] or i == len(joint_s) - 2:
                k = (s - joint_s[i]) / max(1e-6, joint_s[i + 1] - joint_s[i])
                r = jr[i] + (jr[i + 1] - jr[i]) * min(1, max(0, k))
                bulge = 0.06 * max(0.0, 1 - abs(k) * 6) + 0.06 * max(0.0, 1 - abs(1 - k) * 6)
                return r * (1 + bulge)
        return jr[-1]
    fr = frame_along(S, back_hint)
    secs = []
    for p, s, (t, b, l) in zip(S, acc, fr):
        r = rad(s)
        secs.append([p + l * (r * math.cos(2 * math.pi * i / n)) + b * (r * flat * math.sin(2 * math.pi * i / n)) for i in range(n)])
    if tip:   # round the tip: shrinking rings beyond the last point
        p, (t, b, l) = S[-1], fr[-1]
        r = rad(total)
        for k in (0.35, 0.62, 0.82, 0.94, 0.99):
            rr = r * math.sqrt(max(0.0, 1 - k * k))
            c = p + t * (r * k)
            secs.append([c + l * (rr * math.cos(2 * math.pi * i / n)) + b * (rr * flat * math.sin(2 * math.pi * i / n)) for i in range(n)])
    return C.loft(name, [[C.G(*q) for q in sec] for sec in secs])


def palm(P, sk, name):
    """The palm: from the wrist to the knuckle line, wide and flat, back slightly arched; the heel pads on the palm side."""
    S = P['skeleton']
    mcps = [f[0] for f in sk['fingers']]
    xs = [m.x for m in mcps]
    secs = []
    n = 32
    W0, W1 = S['wristWidth'], S['palmWidth']
    T0, T1 = S['wristThickness'], S['palmThickness']
    for k in range(13):
        s = k / 12
        ring = []
        w = W0 + (W1 - W0) * smooth(s * 1.4)
        th = T0 + (T1 - T0) * s
        for i in range(n):
            ang = 2 * math.pi * i / n
            cx, sy = math.cos(ang), math.sin(ang)
            x = math.copysign(abs(cx) ** 0.75, cx) * w / 2
            # distal end follows the knuckle line (the pinky sits lower)
            xt = max(min(xs), min(max(xs), x))
            zk = np.interp(xt, sorted(xs), [m.z for m in sorted(mcps, key=lambda m: m.x)]) - 0.004
            yk = np.interp(xt, sorted(xs), [m.y for m in sorted(mcps, key=lambda m: m.x)])
            z = zk * s
            arch = 0.004 * (1 - (2 * x / max(1e-6, w)) ** 2)
            y = (yk * s) + (sy * th / 2 + (arch if sy > 0 else 0)) * (1.0 if sy > 0 else 1.08)
            # heel pad on the little-finger side, near the wrist
            if sy < 0 and x < 0:
                y -= 0.004 * (1 - s) * (-x / (w / 2))
            ring.append(C.G(x, y, z))
        secs.append(ring)
    return C.loft(name, secs)


def thenar(P, sk, name):
    """The fleshy pad at the base of the thumb, from the wrist to the thumb's first joint."""
    t = sk['thumb']
    T = P['skeleton']['thumb']
    a = V(0.012, -0.004, 0.006)
    pts = [a, (a + t[1]) / 2, t[1]]
    radii = [T['radius'] * 1.6, T['radius'] * 1.55, T['radius'] * 1.15]
    return tube_along(name, pts, radii, V(0.4, 1, 0), flat=0.8, tip=False)


def wrist_path(f_l):
    """From inside the palm, out of the wrist, bending towards the forearm direction f_l."""
    W = V(0, 0.001, -0.006)
    return [V(0, 0.001, 0.014), W, W + (V(0, 0, -1) + f_l).normalized() * 0.018, W + f_l * 0.036, W + f_l * 0.06]


def cuff(P, name, f_l):
    """The glove's cuff: out of the wrist and bending with it towards the forearm."""
    S = P['skeleton']
    path = [V(*p) for p in C.catmull([tuple(p) for p in wrist_path(f_l)], per=5)]
    fr = frame_along(path, V(0, 1, 0))
    secs = []
    n = 32
    for k, (p, (t, b, l)) in enumerate(zip(path, fr)):
        u = k / (len(path) - 1)
        s = 1.0 + 0.14 * u
        rx, ry = S['wristWidth'] / 2 * s * 1.02, S['wristThickness'] / 2 * s * 1.1
        secs.append([C.G(*(p + l * (rx * math.cos(2 * math.pi * i / n)) + b * (ry * math.sin(2 * math.pi * i / n)))) for i in range(n)])
    return C.loft(name, secs)


def guard(P, sk, name):
    """Moulded hard knuckle guard across the four knuckles: a domed strip with one lobe per knuckle."""
    mcps = [f[0] for f in sk['fingers']]
    rr = [r[0] for r in sk['radii']]
    top = P['skeleton']['palmThickness'] / 2
    lift = [V(m.x, top + 0.0012, m.z - 0.011) for m in mcps]          # on the back of the hand, over the knuckle heads
    # extend a little past the index and the pinky
    ends = [lift[0] + (lift[0] - lift[1]).normalized() * 0.008] + lift + [lift[-1] + (lift[-1] - lift[-2]).normalized() * 0.007]
    path = [V(*p) for p in C.catmull([tuple(p) for p in ends], per=8)]
    secs = []
    n = 24
    for k, p in enumerate(path):
        t = (path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]).normalized()
        up = V(0, 1, 0)
        fwd = t.cross(up).normalized()        # along the hand (towards the fingers)
        if fwd.z < 0:
            fwd = -fwd
        u = k / (len(path) - 1)
        lobes = 0.55 + 0.45 * abs(math.cos(u * math.pi * (len(lift) - 0.5) + 0.3))
        end = smooth(min(u, 1 - u) / 0.08)
        h = 0.0042 * lobes * end + 0.001
        w = 0.0115 * (0.75 + 0.25 * end)
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            c, s = math.cos(a), math.sin(a)
            yy = (max(0.0, s) ** 0.7) * h - (0.0035 if s < 0 else 0.0) * (-s)
            ring.append(C.G(*(p + fwd * (c * w) + up * yy)))
        secs.append(ring)
    return C.loft(name, secs)


def finger_pads(sk, name):
    """Small padded panels on the back of each finger's first bone."""
    parts = []
    for k, (j, r) in enumerate(zip(sk['fingers'], sk['radii'])):
        a, b = j[1] + (j[0] - j[1]) * 0.75, j[1] + (j[0] - j[1]) * 0.22
        t = (b - a).normalized()
        n = sk['normals'][k]
        back = n.cross(t).normalized()
        if back.y < 0 and back.dot(V(0, 1, 0)) < 0:
            back = -back
        pts = [a + back * (r[0] * 0.92), b + back * (r[1] * 0.98)]
        parts.append(tube_along(f'{name}{k}', pts, [r[0] * 0.55, r[1] * 0.5], back, flat=0.45, n=16, tip=True))
    return parts


# ---------------------------------------------------------------- mesh utilities
def remesh(ob, voxel, smooth_iter=6):
    ob.data.remesh_voxel_size = voxel
    ob.data.remesh_voxel_adaptivity = 0.0
    C.select_only(ob)
    bpy.ops.object.voxel_remesh()
    m = ob.modifiers.new('sm', 'CORRECTIVE_SMOOTH')
    m.iterations = smooth_iter; m.factor = 0.5; m.smooth_type = 'SIMPLE'; m.use_only_smooth = True
    C.apply_modifiers(ob)
    return ob


def verts_np(ob):
    a = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def set_verts_np(ob, arr):
    ob.data.vertices.foreach_set('co', arr.astype(np.float32).ravel())
    ob.data.update()


def to_game_np(b):   # Blender (x,y,z) -> GAME (x, z, -y)
    return np.stack([b[:, 0], b[:, 2], -b[:, 1]], axis=1)


def to_blender_np(g):
    return np.stack([g[:, 0], -g[:, 2], g[:, 1]], axis=1)


def held_shape(P, pose, z):
    """Cross-section of what the hand holds at GAME z (hand space, the grip at the origin): (rx, ry, cy, power) arrays.
    'stock' = the real rifle wrist and receiver (from rifle.json and the rifle generator), plus the lever's top bar just
    under the wrist (the fingers go round both). Otherwise an even oval of pose rx, ry."""
    n = len(z)
    if pose.get('shape') != 'stock':
        return np.full(n, pose['rx']), np.full(n, pose['ry']), np.full(n, pose.get('cy', 0.0)), np.full(n, 2.0)
    import json as _j
    import os as _o
    from generators import rifle as RF
    R = _j.load(open(_o.path.join(C.PARAMS_DIR, 'rifle.json')))
    S, rc, g = R['stock'], R['receiver'], R['grips']['right']
    zr = z + g[2]
    rx, ry, cy, pw = np.empty(n), np.empty(n), np.empty(n), np.empty(n)
    for i, zz in enumerate(zr):
        if zz < S['from']:
            top, bot, w, k = rc['top'], rc['bottom'], rc['width'], 4.0
        else:
            tt = min(1.0, (zz - S['from']) / (S['to'] - S['from']))
            top, bot, w = RF.stock_section(S, tt)
            k = 2.3
        if 0.02 < zz < 0.16:                       # the lever's top bar under the wrist
            bot = min(bot, -0.053)
        rx[i], ry[i], cy[i], pw[i] = w / 2, (top - bot) / 2, (top + bot) / 2 - g[1], k
    return rx, ry, cy, pw


def push_box(g, lo, hi, margin):
    """Push points (hand space) out of an axis-aligned box through its nearest side face (x or y only)."""
    lo, hi = np.array(lo) - margin, np.array(hi) + margin
    inside = np.all((g > lo) & (g < hi), axis=1)
    if not inside.any():
        return g
    gi = g[inside]
    d = np.stack([gi[:, 0] - lo[0], hi[0] - gi[:, 0], gi[:, 1] - lo[1], hi[1] - gi[:, 1]], axis=1)
    k = np.argmin(d, axis=1)
    gi[k == 0, 0] = lo[0]; gi[k == 1, 0] = hi[0]; gi[k == 2, 1] = lo[1]; gi[k == 3, 1] = hi[1]
    g[inside] = gi
    return g


def push_cyl(g, cx, cy, r, z0, z1, margin):
    """Push points out of a cylinder along z (hand space)."""
    dx, dy = g[:, 0] - cx, g[:, 1] - cy
    d = np.sqrt(dx * dx + dy * dy)
    m = (d < r + margin) & (g[:, 2] > z0) & (g[:, 2] < z1)
    k = (r + margin) / np.maximum(d[m], 1e-5)
    g[m, 0] = cx + dx[m] * k; g[m, 1] = cy + dy[m] * k
    return g


def press_out(ob, Rm, t, pose, margin=0.0028, P=None):
    """Push every vertex that sits inside what the hand holds back out to its surface (and out of the parts next to
    it: the hammer and receiver for the trigger hand, the barrel for the support hand)."""
    loc = to_game_np(verts_np(ob))
    g = loc @ np.array(Rm).T + np.array(t)
    import json as _j
    import os as _o
    R = _j.load(open(_o.path.join(C.PARAMS_DIR, 'rifle.json')))
    if pose.get('shape') == 'stock':
        o = np.array(R['grips']['right'])
        hx, hy, hz = R['hammer']['pivot']
        g = push_box(g, np.array([-0.006, hy - 0.01, hz - 0.012]) - o, np.array([0.006, hy + 0.046, hz + 0.034]) - o, margin)
        rc = R['receiver']
        g = push_box(g, np.array([-rc['width'] / 2, rc['bottom'], rc['front']]) - o, np.array([rc['width'] / 2, rc['top'], rc['back'] + 0.003]) - o, margin)
    if pose.get('barrel'):
        o = np.array(R['grips']['left'])
        b = R['barrel']
        g = push_cyl(g, -o[0], b['y'] - o[1], b['radius'], b['to'] - o[2], b['from'] - o[2], margin)
        zr = R['sights']['rear']           # and the rear sight on top of the barrel
        g = push_box(g, np.array([-0.0105, b['y'], zr - 0.011]) - o, np.array([0.0105, R['sights']['lineY'] + 0.005, zr + 0.012]) - o, margin)
    rx, ry, cy, pw = held_shape(P, pose, g[:, 2])
    rx, ry = rx + margin, ry + margin
    ex, ey = np.abs(g[:, 0] / rx), np.abs((g[:, 1] - cy) / ry)
    s = (ex ** pw + ey ** pw) ** (1 / pw)
    inside = s < 1.0
    k = np.where(inside, 1.0 / np.maximum(s, 1e-4), 1.0)
    g[:, 0] *= k
    g[:, 1] = cy + (g[:, 1] - cy) * k
    loc = (g - np.array(t)) @ np.array(Rm)
    set_verts_np(ob, to_blender_np(loc))
    return int(inside.sum())


def mirror_x(ob):
    a = verts_np(ob)
    a[:, 0] *= -1
    set_verts_np(ob, a)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free()


def classify(ob, sk, mats, left):
    """Glove panels on the fused hand: back fabric / palm leather / knit cuff by which way each face looks relative to
    its nearest bone, plus a 'seam' attribute (distance to the panel border) for stitching."""
    segs = []
    for j, n in zip(sk['fingers'], sk['normals']):
        for a, b in zip(j, j[1:]):
            back = n.cross(b - a).normalized()
            if back.y < 0:
                back = -back
            segs.append((a, b, back))
    th = sk['thumb']
    tn = (th[1] - th[0]).cross(th[3] - th[0])
    tn = tn.normalized() if tn.length > 1e-8 else V(0, 0, 1)
    for a, b in zip(th, th[1:]):
        back = tn.cross(b - a).normalized()
        if back.x < 0 and back.y < 0:
            back = -back
        segs.append((a, b, back))
    segs.append((V(0, 0, 0), V(0, 0, 0.07), V(0, 1, 0)))       # the palm
    A = np.array([tuple(s[0]) for s in segs]); B = np.array([tuple(s[1]) for s in segs]); D = np.array([tuple(s[2]) for s in segs])
    me = ob.data
    nf = len(me.polygons)
    cen = np.empty(nf * 3); me.polygons.foreach_get('center', cen); cen = to_game_np(cen.reshape(-1, 3))
    nor = np.empty(nf * 3); me.polygons.foreach_get('normal', nor); nor = to_game_np(nor.reshape(-1, 3))
    if left:      # skeleton is the right hand; the mesh was mirrored
        cen[:, 0] *= -1; nor[:, 0] *= -1

    def nearest(P_):
        AB = B - A
        best_d = np.full(len(P_), 1e9); best = np.zeros(len(P_), dtype=int)
        for i in range(len(A)):
            ab = AB[i]; L2 = max(1e-12, ab @ ab)
            tt = np.clip(((P_ - A[i]) @ ab) / L2, 0, 1)
            d = np.linalg.norm(P_ - (A[i] + tt[:, None] * ab), axis=1)
            m = d < best_d
            best_d[m] = d[m]; best[m] = i
        return best
    idx = nearest(cen)
    dots = np.einsum('ij,ij->i', nor, D[idx])
    back = dots > 0.12
    cuffm = cen[:, 2] < -0.004
    mi = np.where(cuffm, 2, np.where(back, 0, 1))
    me.polygons.foreach_set('material_index', mi.astype(np.int32))
    ob.data.materials.clear()
    for m, _ in mats:
        ob.data.materials.append(m)
    for m, metal in mats:
        m['_metal_node'] = metal.node.name
        m['_metal_out'] = list(metal.node.outputs).index(metal)
    # seam distance per vertex
    nv = len(me.vertices)
    vco = to_game_np(verts_np(ob)); vno = np.empty(nv * 3); me.vertices.foreach_get('normal', vno); vno = to_game_np(vno.reshape(-1, 3))
    if left:
        vco[:, 0] *= -1; vno[:, 0] *= -1
    vi = nearest(vco)
    vd = np.einsum('ij,ij->i', vno, D[vi])
    seam = np.abs(vd - 0.12) * 0.012
    seam = np.minimum(seam, np.abs(vco[:, 2] + 0.004))       # the cuff seam
    at = me.attributes.new('seam', 'FLOAT', 'POINT')
    at.data.foreach_set('value', seam.astype(np.float32))


def sleeve(P, name, hi=False):
    """Jacket sleeve along -z of the hand frame, from just over the glove cuff back towards the elbow."""
    S, sl = P['skeleton'], P['sleeve']
    secs = []
    n = 40 if hi else 22
    rings = 70 if hi else 18
    rnd = np.random.RandomState(7)
    ph = rnd.rand(6) * 6.28
    for k in range(rings + 1):
        t = k / rings
        z = -0.032 - t * sl['length']
        # a forearm, not a pipe: snug at the cuff, fullest past the middle (the muscle), a touch narrower at the elbow
        r = sl['cuff'] + (sl['forearm'] - sl['cuff']) * smooth(t / 0.55) - (sl['forearm'] - sl['elbow']) * smooth((t - 0.6) / 0.4)
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            fold = 0.0
            if hi:
                # compression folds near the cuff, long soft folds up the arm
                fold += sl['folds'] * (0.9 * math.sin(z * 210 + 1.7 * math.sin(a * 2 + ph[0])) * max(0.0, 1 - t * 2.4))
                fold += sl['folds'] * 0.7 * math.sin(a * 3 + ph[1] + z * 18) * math.sin(z * 40 + ph[2])
                fold += sl['folds'] * 0.4 * math.sin(a * 5 + ph[3] + z * 60)
            else:
                fold += sl['folds'] * 0.5 * math.sin(a * 3 + ph[1] + z * 18) * math.sin(z * 40 + ph[2])
            band = 1.0 + (0.02 if t < 0.1 else 0.0)                 # the knit cuff band is a touch fuller
            ring.append(C.G((r * band + fold) * math.cos(a), 0.001 + (r * 0.84 * band + fold) * math.sin(a), z))
        secs.append(ring)
    return C.loft(name, secs, cap_start=False, cap_end=True)


# ---------------------------------------------------------------- placement
def place_matrix(sk, pose, left):
    """Hand frame -> GAME space (rotation 3x3, translation). The handle (grips) or the round (pinch) goes along GAME -z
    (or +z with thumb: 'back') through the origin, and the hand turns round it until its forearm line points along
    pose['forearm']. The wrist stays straight; pose['wrist'] = [bend up, bend sideways] in degrees adds a natural bend."""
    if pose['kind'] == 'grip':
        C0, a, R = sk['handle']
        if left:
            C0 = V(-C0.x, C0.y, C0.z); a = V(-a.x, a.y, a.z)
        src_a, origin = a, C0
    else:
        c = V(*pose['roundDir']).normalized()
        pin = V(*pose['pinch'])
        if left:
            c = V(-c.x, c.y, c.z); pin = V(-pin.x, pin.y, pin.z)
        src_a, origin = c, pin + c * pose.get('alongRound', 0.0)
    dst_a = V(0, 0, 1) if pose.get('thumb') == 'back' else V(0, 0, -1)
    if 'back' in pose:
        # the back of the hand faces pose['back']; the wrist bends to meet the forearm (a trigger hand hangs below the
        # stock with its wrist flexed, see reference/m4-rifle-hold.png)
        y_l = V(0, 1, 0)
        yl = (y_l - src_a * y_l.dot(src_a)).normalized()
        b = V(*pose['back']).normalized()
        yg = (b - dst_a * b.dot(dst_a)).normalized()
        Bl = Matrix((src_a, yl, src_a.cross(yl))).transposed()
        Bg = Matrix((dst_a, yg, dst_a.cross(yg))).transposed()
        Rm = Bg @ Bl.transposed()
        return Rm, -(Rm @ origin)
    f_l = wrist_dir(pose, left)
    fl = (f_l - src_a * f_l.dot(src_a)).normalized()
    f_g = V(*pose['forearm']).normalized()
    fg = (f_g - dst_a * f_g.dot(dst_a)).normalized()
    Bl = Matrix((src_a, fl, src_a.cross(fl))).transposed()
    Bg = Matrix((dst_a, fg, dst_a.cross(fg))).transposed()
    Rm = Bg @ Bl.transposed()
    t = -(Rm @ origin)
    return Rm, t


def wrist_dir(pose, left):
    """The forearm's direction in the hand frame: straight back out of the wrist, plus the pose's small natural bend."""
    up, side = pose.get('wrist', [0, 0])
    d = Matrix.Rotation(math.radians(up), 3, 'X') @ (Matrix.Rotation(math.radians(side) * (-1 if left else 1), 3, 'Y') @ V(0, 0, -1))
    return d.normalized()


def forearm_local(Rm, pose, left):
    """The forearm direction in the (possibly mirrored) hand frame."""
    if 'back' in pose:
        return (Rm.transposed() @ V(*pose['forearm'])).normalized()
    return wrist_dir(pose, left)


def game_matrix_to_blender(Rm, t):
    """A GAME-space affine map as a Blender object matrix (Blender coords <-> GAME coords swap)."""
    Gm = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))     # GAME -> Blender
    R4 = (Gm @ Rm @ Gm.transposed()).to_4x4()
    R4.translation = Gm @ t
    return R4


# ---------------------------------------------------------------- build
def materials(P):
    L = P['look']
    seam = M.attribute_lines('seam', width=0.0011, dash_per_m=380, strength=0.8)
    grime = dict(set_id='Ground051', color=L['grime'], amount=0.15, scale=14.0, rough=0.85, height=0.4, crease=0.004)
    return {
        'fabric': M.scanned('glove_fabric', 'Fabric039', 38.0, 'Y', color=L['gloveBack'], rough=(0.7, 0.92), bump=1.0, bump_dist=0.00025,
                            cavity=0.5, extra_height=[seam], dirt=grime,
                            wear=dict(color=[c * 1.9 for c in L['gloveBack']], rough=0.6, amount=0.5, radius=0.0025)),
        'leather': M.scanned('glove_leather', 'Leather032', 24.0, 'Y', color=L['glovePalm'], rough=(0.5, 0.75), bump=1.0, bump_dist=0.0002,
                             cavity=0.5, extra_height=[seam], dirt=grime,
                             wear=dict(color=[c * 2.2 for c in L['glovePalm']], rough=0.45, amount=0.7, radius=0.0025)),
        'knit': M.scanned('glove_cuff', 'Fabric079', 40.0, 'Y', color=L['cuff'], rough=(0.8, 0.95), bump=1.2, bump_dist=0.0003,
                          extra_height=[seam], cavity=0.4),
        'rubber': M.scanned('guard', 'Rubber004', 30.0, 'Y', color=L['guard'], rough=(0.38, 0.55), bump=0.5, bump_dist=0.00012,
                            cavity=0.3, wear=dict(color=[c * 3.0 for c in L['guard']], rough=0.3, amount=0.6, radius=0.0015)),
        'sleeve': M.scanned('sleeve', 'Fabric063', 16.0, 'Y', color=L['sleeve'], rough=(0.72, 0.9), bump=0.9, bump_dist=0.0003,
                            cavity=0.6),
        'sleeve_knit': M.scanned('sleeve_cuff', 'Fabric079', 30.0, 'Y', color=L['sleeveCuff'], rough=(0.8, 0.95), bump=1.4,
                                 bump_dist=0.0004, cavity=0.5),
    }


def arm_matrix(f_l, wrist_end):
    """Sleeve frame (straight along -z, origin where the sleeve's coordinates start) -> hand frame."""
    z = -f_l
    up = V(0, 1, 0) if abs(z.y) < 0.95 else V(1, 0, 0)
    x = up.cross(z).normalized(); y = z.cross(x)
    R = Matrix((x, y, z)).transposed()
    origin = wrist_end - f_l * 0.032          # sleeve() starts at its local z = -0.032
    return R, origin


def build_arm(P, mats, name, pose, left):
    sk = skeleton(P, pose)
    Rm, t = place_matrix(sk, pose, left)
    if 'thumbAt' in pose:
        tl = Rm.transposed() @ (V(*pose['thumbAt']) - t)
        if left:
            tl.x = -tl.x
        sk = skeleton(P, pose, thumb_at=tl)
    f_l = forearm_local(Rm, pose, left)                 # in the (mirrored) hand frame
    f_r = V(-f_l.x, f_l.y, f_l.z) if left else f_l       # in the right-hand frame the glove is built in
    # --- the fused glove (hand frame, right hand; mirrored afterwards for a left hand)
    parts = [palm(P, sk, name + '_palm'), thenar(P, sk, name + '_thenar'), cuff(P, name + '_cuff', f_r)]
    for k, (j, r, nrm) in enumerate(zip(sk['fingers'], sk['radii'], sk['normals'])):
        back = nrm.cross(j[1] - j[0]).normalized()
        if back.y < 0:
            back = -back
        parts.append(tube_along(f'{name}_f{k}', j, r, back, flat=0.86, start_back=0.012))
    T = P['skeleton']['thumb']
    th = sk['thumb']
    tnorm = (th[1] - th[0]).cross(th[3] - th[0])
    tback = tnorm.cross(th[2] - th[1]).normalized() if tnorm.length > 1e-8 else V(1, 1, 0).normalized()
    if tback.x < 0 and tback.y < 0:
        tback = -tback
    parts.append(tube_along(name + '_thumb', th[1:], [T['radius'] * 1.08, T['radius'], T['radius'] * 0.9], tback, flat=0.84))
    glove = C.join(parts, name + '_glove_hi')
    remesh(glove, P['budget']['voxel'], 5)
    pieces = [glove, guard(P, sk, name + '_guard')]     # (finger pads dropped: they floated off fingers pressed onto the stock)
    if left:
        for o in pieces:
            mirror_x(o)
    if pose['kind'] == 'grip':
        press_out(glove, Rm, t, pose, P=P)
    classify(glove, sk, [mats['fabric'], mats['leather'], mats['knit']], left)
    for o in pieces[1:]:
        C.assign(o, mats['rubber'])
    # --- LOW: decimated glove + light copies of the hard parts
    glove_lo = C.duplicate(glove, name + '_glove')
    C.decimate_to(glove_lo, P['budget']['hand'])
    hard_lo = [C.duplicate(o, o.name + '_lo') for o in pieces[1:]]
    for o in hard_lo:
        C.decimate_to(o, 500)
    hard_hi = []
    for o in pieces[1:]:
        hard_hi.append(C.high_from(o, o.name + '_hi', bevel=0, subdiv=1))
        C.bpy.data.objects.remove(o, do_unlink=True)
    hi = C.join([glove] + hard_hi, name + '_high')
    lo = C.join([glove_lo] + hard_lo, name)
    Mh = game_matrix_to_blender(Rm, t)
    for o in (hi, lo):
        C.select_only(o); bpy.ops.object.shade_smooth()
        o.matrix_world = Mh
    if __import__('os').environ.get('HANDS_DEBUG'):
        Gm = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
        for view, eye in (('back', (0, 0.26, 0.06)), ('thumb', (0.26 * (-1 if left else 1), 0.0, 0.06)), ('palm', (0, -0.26, 0.06))):
            e = Mh @ (Gm @ V(*eye)); c = Mh @ (Gm @ V(0, 0, 0.06))
            C.render_preview([lo], f'{C.BUILD_DIR}/dbg_{name}_{view}.png', eye=tuple(e), target=tuple(c), lens=50, size=500, samples=16)
    # --- the sleeve: its own straight frame along the forearm, so the canvas and the knit ribs run along the arm
    wp = wrist_path(f_l if left else f_r)
    Ra, oa = arm_matrix(f_l, wp[1] + f_l * 0.006)        # the sleeve comes right down to the wrist
    sl_hi = sleeve(P, name + '_sleeve_hi', hi=True)
    sl_lo = sleeve(P, name + '_sleeve_lo', hi=False)
    for o in (sl_hi, sl_lo):
        C.set_material_by(o, [mats['sleeve'], mats['sleeve_knit']], lambda c, nn: 1 if c[2] > -0.07 else 0)
    sl_hi2 = C.high_from(sl_hi, name + '_sleeve_hi2', bevel=0, subdiv=1)
    C.bpy.data.objects.remove(sl_hi, do_unlink=True)
    Ms = game_matrix_to_blender(Rm @ Ra, Rm @ oa + t)
    for o in (sl_hi2, sl_lo):
        C.select_only(o); bpy.ops.object.shade_smooth()
        o.matrix_world = Ms
    return [(hi, lo), (sl_hi2, sl_lo)], (Rm, t)


def build(P):
    C.reset_scene()
    mats = materials(P)
    poses = P['poses']
    arms = [('arm_grip_r', poses['grip'], False), ('arm_axe_r', poses['axe'], False),
            ('arm_support_l', poses['support'], True), ('arm_load_l', poses['load'], True)]
    pairs, report, groups = [], [], []
    for name, pose, left in arms:
        prs, (Rm, t) = build_arm(P, mats, name, pose, left)
        f = Rm @ forearm_local(Rm, pose, left)
        bend = math.degrees(V(0, 0, -1).angle(forearm_local(Rm, pose, left)))
        report.append(f'{name}: wrist bend {bend:.0f} deg')
        report.append(f'{name}: forearm leaves along ({f.x:.2f}, {f.y:.2f}, {f.z:.2f})')
        groups.append((name, [lo for hi, lo in prs]))
        pairs += prs
    lows = [lo for hi, lo in pairs]
    for lo in lows:
        C.smart_unwrap(lo, island_margin=0.004, angle=66)
    C.pack_atlas(lows, margin=0.002)
    # bake in place: every object carries its GAME placement in its transform
    mats_world = [lo.matrix_world.copy() for lo in lows]
    mat = C.bake_family(pairs, P['budget']['texture'], 'hands', extrusion=0.0055, ao_samples=24, ao_strength=0.6)
    for (hi, lo), mw in zip(pairs, mats_world):
        C.bpy.data.objects.remove(hi, do_unlink=True)
        lo.matrix_world = mw
        C.select_only(lo); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    arms_lo = [C.join(parts, name) for name, parts in groups]
    objs, rep = C.finish_family(arms_lo, mat, lod_ratio=0.5, lod_min=400)
    C.render_preview(arms_lo[:1] + arms_lo[2:3], f'{C.BUILD_DIR}/hands_preview.png', eye=(0.05, 0.75, 0.32), target=(0.02, 0.15, -0.02), lens=40)
    C.export_glb(objs, 'hands')
    return report + rep
