"""Spider species generator (milestone 4). See SPECIES.md.

Parameters: assets/params/spiders.json. For each species writes blender/build/spider_<species>.glb (shrunk by
tools/assets.mjs into assets/models/) and assets/models/spider_<species>.json (leg layout + rest pose for the game).

How a spider is built
  1. The LAYOUT (where the legs attach, how long each segment is, where each foot rests) is worked out from the 'rig'
     numbers, the same way js/spiders/SpiderModel.js did for the old code-made spiders.
  2. The REST POSE: every one of the 58 bones (body, abdomen, 2 fangs, 2 x 3 palp segments, 8 legs x 6 segments) gets a
     frame: x along the segment, y = its back (dorsal) side, z = its outer side. Legs stand on their rest feet, solved
     with the same leg IK the game uses. The game's rig moves exactly these bones.
  3. The MESH is built around the rest pose: one continuous tube per leg and palp (so a bent knee stays smooth), a
     shaped carapace and abdomen, fangs, eyes, and per species a face plate or quills. Each vertex is weighted to one or
     two bones; across a joint the weight blends from one segment to the next.
  4. A HIGH copy (subdivided) carries layered CC0 scan materials (shell, legs, plate, eyes) and is baked onto the LOW
     mesh's textures, like every other family.
  5. An armature with the same bones is added only for the export (the game rebuilds the skeleton from the .json).

All positions are worked out in GAME space (x right, y up, z forward, metres) and converted with C.G().
"""
import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

from lib import common as C
from lib import materials as M

D2R = math.pi / 180
UP = Vector((0, 1, 0))
BODY, ABD, CHEL, PALP, LEG = 0, 1, 2, 4, 10
BONES = 10 + 8 * 6
MODELS_DIR = os.path.join(C.ROOT, 'assets', 'models')


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def clamp(x, a, b):
    return a if x < a else b if x > b else x


def lerp(a, b, t):
    return a + (b - a) * t


def bumpy(x, y, z):
    return (math.sin(x * 7.1 + y * 3.3) * math.sin(z * 6.7 + x * 2.1) * math.sin(y * 5.3 + z * 4.4)
            + 0.5 * math.sin(x * 15.3 - z * 9.1) * math.sin(y * 13.7 + x * 5.9))


def frame(pos, X, Y, Z):
    """4x4 bone frame (columns X, Y, Z, position) in GAME space."""
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2], m[i][3] = X[i], Y[i], Z[i], pos[i]
    return m


def euler_yxz(x, y, z):
    """Rotation matrix for a three.js Euler(x, y, z, 'YXZ')."""
    return Matrix.Rotation(y, 3, 'Y') @ Matrix.Rotation(x, 3, 'X') @ Matrix.Rotation(z, 3, 'Z')


# ---------------------------------------------------------------- 1. layout (mirrors the old makeLayout in JS)
def layout(R):
    c, a = R['ceph'], R['abd']
    gap = c['rz'] * 0.15
    body_z0 = (a['len'] + gap) * 0.5 - c['rz'] * 0.15
    legs = []
    for side in (1, -1):
        for pair in range(4):
            ang = R['pairAngles'][pair] * D2R
            d = Vector((side * math.sin(ang), 0, math.cos(ang)))
            a_att = ang * 0.75 + (math.pi / 2) * 0.25
            attach = Vector((side * math.sin(a_att) * c['rx'] * 0.8, -c['ry'] * 0.12, math.cos(a_att) * c['rz'] * 0.62))
            L = R['restR'] * R['legFactor'] * R['pairLen'][pair]
            lens = [f * L for f in R['segFrac']]
            rr = R['restR'] * R['pairRest'][pair]
            rest = Vector((0, 0, body_z0)) + d * rr
            legs.append(dict(side=side, pair=pair, group=(pair + (0 if side > 0 else 1)) % 2, dir=d, attach=attach,
                             lens=lens, rest=rest, R=rr))
    span = max((l1['rest'] - l2['rest']).length for l1 in legs for l2 in legs)
    palps = [dict(side=s, attach=Vector((s * c['rx'] * 0.3, -c['ry'] * 0.3, c['rz'] * 0.8)),
                  lens=[f * R['palp']['len'] for f in (0.42, 0.33, 0.25)]) for s in (1, -1)]
    chel = [dict(side=s, attach=Vector((s * c['rx'] * 0.21, -c['ry'] * 0.08, c['rz'] * 0.84))) for s in (1, -1)]
    abd_attach = Vector((0, a['y'], -c['rz'] * 0.95))
    return dict(bodyZ0=body_z0, legs=legs, palps=palps, chel=chel, abdAttach=abd_attach, legSpan=span)


def kink(a, b, k):
    return math.atan2(b * math.sin(k), a + b * math.cos(k)), math.sqrt(a * a + b * b + 2 * a * b * math.cos(k))


# ---------------------------------------------------------------- 2. rest pose (mirrors SpiderRig at rest)
def rest_pose(R, lay):
    frames = [Matrix.Identity(4) for _ in range(BONES)]
    H = R['bodyH']
    body = Matrix.Translation(Vector((0, H, lay['bodyZ0'])))
    frames[BODY] = body.copy()
    tilt = R['abd']['tilt']
    rot = euler_yxz(tilt, 0, 0)
    pa = body @ lay['abdAttach']
    frames[ABD] = frame(pa, rot.col[0], rot.col[1], rot.col[2])
    for s, ch in enumerate(lay['chel']):
        rot = euler_yxz(0.0, 0, ch['side'] * 0.1)
        frames[CHEL + s] = frame(body @ ch['attach'], rot.col[0], rot.col[1], rot.col[2])
    for s, p in enumerate(lay['palps']):
        angles = (0.55, -0.7, -1.45)
        spread = 0.25
        d = Vector((p['side'] * math.sin(spread), 0, math.cos(spread)))
        side = d.cross(UP).normalized()
        pos = p['attach'].copy()
        for k, a in enumerate(angles):
            X = d * math.cos(a) + UP * math.sin(a)
            Y = side.cross(X)
            frames[PALP + s * 3 + k] = frame(body @ pos, X, Y, side)
            pos = pos + X * p['lens'][k]
    for li, l in enumerate(lay['legs']):
        A = body @ l['attach']
        F = l['rest'].copy()
        for k, (X, Y, Z, p) in enumerate(leg_fk(R, l, A, F)):
            frames[LEG + li * 6 + k] = frame(p, X, Y, Z)
    return frames


def leg_fk(R, l, A, F):
    """The game's leg IK (SpiderRig._legIK) for one foot target; returns the six segment frames."""
    lens = l['lens']
    pt = kink(lens[2], lens[3], 0.22)
    mt = kink(lens[4], lens[5], 0.3)
    d = Vector((F.x - A.x, 0, F.z - A.z))
    d = d.normalized() if d.length > 1e-5 else l['dir'].copy()
    gam = R['coxaElev']
    ch, cv = math.cos(gam) * lens[0], math.sin(gam) * lens[0]
    hF = (F.x - A.x) * d.x + (F.z - A.z) * d.z - ch
    vF = F.y - A.y - cv
    rest_h = l['R'] - 0.1 * l['R']
    alpha = clamp(R['alpha'] + (rest_h - hF) / l['R'] * 0.9, 0.45, 1.5)
    Lm, Lp, Lf = mt[1], pt[1], lens[1]
    Th, Tv = hF - Lm * math.cos(alpha), vF + Lm * math.sin(alpha)
    D = math.hypot(Th, Tv)
    max_r = (Lf + Lp) * 0.995
    if D > max_r:
        Th, Tv, D = Th * max_r / D, Tv * max_r / D, max_r
    base = math.atan2(Tv, Th)
    fem = base + math.acos(clamp((Lf * Lf + D * D - Lp * Lp) / (2 * Lf * D), -1, 1))
    Kh, Kv = Lf * math.cos(fem), Lf * math.sin(fem)
    ptc = math.atan2(Tv - Kv, Th - Kh)
    mtc = math.atan2(vF - Tv, hF - Th)
    ang = [gam, fem, ptc + pt[0], ptc + pt[0] - 0.22, mtc + mt[0], mtc + mt[0] - 0.3]
    side = d.cross(UP).normalized()
    p = A.copy()
    out = []
    for k in range(6):
        X = d * math.cos(ang[k]) + UP * math.sin(ang[k])
        Y = side.cross(X)
        out.append((X, Y, side, p.copy()))
        p = p + X * lens[k]
    return out


# ---------------------------------------------------------------- 3. mesh builder
class Mesh:
    """Vertices in GAME space with bone weights, a 'reg' attribute (band, joint, belly) and a material index."""

    def __init__(self):
        self.v, self.f, self.w, self.reg, self.fm = [], [], [], [], []

    def vert(self, p, weights, reg=(0, 0, 0)):
        self.v.append(Vector(p)); self.w.append(weights); self.reg.append(reg)
        return len(self.v) - 1

    def face(self, idx, mat):
        self.f.append(idx); self.fm.append(mat)

    def grid(self, rings, mat, closed_start=True, closed_end=True):
        """Faces between consecutive rings (lists of vertex indices, same count)."""
        n = len(rings[0])
        for a, b in zip(rings, rings[1:]):
            for i in range(n):
                self.face((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]), mat)
        if closed_start:
            self.face(tuple(reversed(rings[0])), mat)
        if closed_end:
            self.face(tuple(rings[-1]), mat)


def bone_w(b):
    return {b: 1.0}


def blend_w(a, b, t):
    return {a: 1 - t, b: t} if a != b else {a: 1.0}


def tube(m, stations, sides, mat, keel=0.0, flat=1.0, tip=False):
    """stations: list of (center, X, Y, Z, radius, weights, reg, extra) along a path. extra = (yoff along -Y)."""
    rings = []
    for (c, X, Y, Z, r, w, reg) in stations:
        ring = []
        for j in range(sides):
            th = 2 * math.pi * j / sides
            cy, sz = math.cos(th), math.sin(th)
            ky = (1 + keel * max(0.0, cy) ** 5) * (0.9 if cy < 0 else 1.0)
            belly = max(0.0, -cy)
            p = c + Y * (cy * r * ky) + Z * (sz * r * flat)
            ring.append(m.vert(p, w, (reg[0], reg[1], belly)))
        rings.append(ring)
    m.grid(rings, mat, closed_start=True, closed_end=not tip)
    if tip:
        c, X, Y, Z, r, w, reg = stations[-1]
        t = m.vert(c + X * r * 0.5, w, (reg[0], reg[1], 0))
        last = rings[-1]
        for i in range(sides):
            m.face((last[i], last[(i + 1) % sides], t), mat)


def chain_stations(frames_k, lens, bones, radii, rings_per, knob, hook, first_blend=None, tip=True):
    """Stations for a jointed limb along its rest frames. frames_k: [(X, Y, Z, p)] per segment."""
    st = []
    n = len(frames_k)
    for k in range(n):
        X, Y, Z, P = frames_k[k]
        L = lens[k]
        nr = max(2, rings_per[k])
        last = k == n - 1
        count = nr + (1 if last else 0)
        for i in range(count):
            t = i / nr
            r = radii[k][0] + (radii[k][1] - radii[k][0]) * t
            if last and tip:
                r = (radii[k][0] + (max(radii[k][1], radii[k][0] * 0.05) - radii[k][0]) * t ** 0.7) * (1 - t ** 3 * 0.9)
            # knobbly joints: swollen at both ends, a waist just after the start
            if k > 0:
                r *= 1 + knob * math.exp(-((t / 0.1) ** 2))
            if not last:
                r *= 1 + knob * 0.7 * math.exp(-(((1 - t) / 0.08) ** 2))
            r *= (1 + 0.1 * math.sin(math.pi * t ** 0.8)) * (1 - 0.12 * math.exp(-(((t - 0.14) / 0.05) ** 2)))
            c = P + X * (t * L)
            Xc, Yc = X, Y
            if i == 0 and k > 0:
                # joint ring: halfway between the two segments' directions so the bend stays round
                pX, pY = frames_k[k - 1][0], frames_k[k - 1][1]
                Xc, Yc = (X + pX).normalized(), (Y + pY).normalized()
            if last and tip:
                c = c - Y * (hook * L * t ** 3)
            # weights: blend across each joint over a short zone
            hb = min(0.35, 1.6 * radii[k][0] / max(L, 1e-4))
            if i == 0 and k == 0 and first_blend is not None:
                w = blend_w(first_blend, bones[0], 0.5)
            elif t < hb and k > 0:
                w = blend_w(bones[k - 1], bones[k], 0.5 + 0.5 * t / hb)
            elif t < hb and k == 0 and first_blend is not None:
                w = blend_w(first_blend, bones[0], 0.5 + 0.5 * t / hb)
            elif t > 1 - hb and not last:
                w = blend_w(bones[k], bones[k + 1], 0.5 * (t - (1 - hb)) / hb)
            else:
                w = bone_w(bones[k])
            joint = math.exp(-((t / 0.08) ** 2)) * (1 if k > 0 else 0) + (0 if last else math.exp(-(((1 - t) / 0.06) ** 2)))
            band = 0.5 + 0.5 * math.cos(t * math.pi * 2 * 1.5)
            st.append((c, Xc, Yc, Z, r, w, (band, min(1.0, joint), 0)))
    return st


def ceph_point(c, nx, ny, nz, furrows):
    x, y, z = nx * c['rx'], ny * c['ry'], nz * c['rz']
    x *= 1 - 0.22 * smooth(0.1, 1, nz)
    if ny > 0:
        y *= 0.72 + 0.42 * c['head'] * smooth(-0.4, 0.75, nz) * (1 - 0.35 * smooth(0.75, 1, nz))
        phi = math.atan2(nx, nz + 0.3)
        fur = (0.5 + 0.5 * math.cos(phi * 8)) ** 6
        y -= c['ry'] * furrows * fur * smooth(0.2, 0.7, ny) * smooth(0.05, 0.3, math.hypot(nx, nz + 0.3))
        y -= c['ry'] * 0.16 * math.exp(-((nx * nx + (nz + 0.3) ** 2) / 0.015))
        y -= c['ry'] * 0.05 * math.exp(-(nx * nx) / 0.004) * smooth(0, 0.6, -nz + 0.2)
    else:
        y *= 0.55
    rim = 1 + 0.06 * math.exp(-((ny / 0.12) ** 2))
    x *= rim; z *= rim
    b = 1 + 0.035 * bumpy(nx * 1.3, ny * 1.3, nz * 1.3)
    return Vector((x * b, y * b, z * b))


def build_ceph(m, R, S, body, q, mat):
    c = R['ceph']
    rings, sides = int(10 + 12 * q), int(14 + 16 * q)
    rows = []
    for i in range(rings + 1):
        t = i / rings
        pol = t * math.pi
        nz, rr = -math.cos(pol), math.sin(pol)
        row = []
        for j in range(sides):
            th = 2 * math.pi * j / sides
            nx, ny = rr * math.sin(th), rr * math.cos(th)
            p = body @ ceph_point(c, nx, ny, nz, S['cephFurrows'])
            row.append(m.vert(p, bone_w(BODY), (0, 0, max(0.0, -ny))))
            if i == 0 or i == rings:
                break
        rows.append(row)
    # poles: fans
    for j in range(sides):
        a, b = rows[1][j], rows[1][(j + 1) % sides]
        m.face((rows[0][0], b, a), mat)
        a, b = rows[-2][j], rows[-2][(j + 1) % sides]
        m.face((rows[-1][0], a, b), mat)
    for r0, r1 in zip(rows[1:-2], rows[2:-1]):
        for j in range(sides):
            m.face((r0[j], r0[(j + 1) % sides], r1[(j + 1) % sides], r1[j]), mat)


def build_abdomen(m, R, S, F, q, mat):
    a = R['abd']
    rings, sides = int(8 + 16 * q), int(12 + 14 * q)
    ribs, rib_d = S['abdRibs'], S['abdRibDepth']
    rows = []
    for i in range(rings + 1):
        s = i / rings
        r = a['r'] * math.sin(math.pi * s ** 0.78) ** 0.55
        r = max(r, a['r'] * 0.3 * (1 - smooth(0, 0.08, s)))
        if ribs:
            r *= 1 - rib_d * (0.5 + 0.5 * math.cos((s * ribs + 0.5) * math.pi * 2)) ** 6 * smooth(0.08, 0.2, s) * smooth(0.95, 0.8, s)
        # the front blends into the body (the waist bends with both)
        w = blend_w(BODY, ABD, 0.5 + 0.5 * smooth(0, 0.12, s)) if s < 0.12 else bone_w(ABD)
        row = []
        for j in range(sides):
            th = 2 * math.pi * j / sides
            cy, sx = math.cos(th), math.sin(th)
            hump = (0.07 * math.exp(-(((abs(th - math.pi) - math.pi + 0.55) / 0.3) ** 2))
                    * (0.4 + 0.6 * (0.5 + 0.5 * math.cos(s * (ribs or 5) * math.pi * 2)) ** 2) * smooth(0.15, 0.4, s) * smooth(0.95, 0.6, s))
            b = 1 + hump + 0.03 * bumpy(sx * 2, cy * 2, s * 4)
            p = Vector((sx * r * a['sx'] * b, cy * r * a['sy'] * b * (0.82 if cy < 0 else 1) + a['r'] * 0.18 * math.sin(math.pi * s), -s * a['len']))
            if i == rings:
                p = Vector((0, a['r'] * 0.05, -a['len']))
            row.append(m.vert(F @ p, w, (s, 0, max(0.0, -cy))))
            if i == rings:
                break
        rows.append(row)
    m.grid(rows[:-1], mat, closed_start=True, closed_end=False)
    last = rows[-2]
    for j in range(sides):
        m.face((last[j], last[(j + 1) % sides], rows[-1][0]), mat)


def build_chelicera(m, R, S, F, side, bone, q, mats):
    c = R['chel']
    bulge = S.get('fangBulge', 1.0)
    sides = int(7 + 6 * q)
    d = Vector((0, -1, 0.35)).normalized()
    Z = Vector((1, 0, 0))
    Y = Z.cross(d).normalized()
    st = []
    n = int(6 + 6 * q)
    for i in range(n + 1):
        t = i / n
        r = c['r'] * bulge * (0.55 + 0.65 * math.sin(math.pi * t ** 0.55)) * (1 - 0.45 * t)
        st.append((F @ (d * (t * c['len'])), F.to_3x3() @ d, F.to_3x3() @ Y, F.to_3x3() @ Z, max(r, c['r'] * 0.2), bone_w(bone), (0, 0, 0)))
    tube(m, st, sides, mats['shell'])
    # fang: curls in towards the middle and back
    base = d * (c['len'] * 0.88)
    st = []
    nf = int(5 + 4 * q)
    L = c['len'] * 0.85
    curl = S.get('fangCurl', 0.9)
    for i in range(nf + 1):
        t = i / nf
        ang = t * curl * 1.4
        dirf = (d * math.cos(ang) + Vector((-side, 0, 0.4)).normalized() * math.sin(ang)).normalized()
        p = base + dirf * (t * L)
        r = c['r'] * 0.36 * (1 - t ** 1.2 * 0.95)
        Zf = Vector((0, 0, 1)).cross(dirf).normalized() if abs(dirf.z) < 0.95 else Vector((1, 0, 0))
        Yf = Zf.cross(dirf).normalized()
        st.append((F @ p, F.to_3x3() @ dirf, F.to_3x3() @ Yf, F.to_3x3() @ Zf, r, bone_w(bone), (0, 1, 0)))
    tube(m, st, max(4, sides - 2), mats['fang'], tip=True)


def sphere(m, center, r, w, mat, rings=6, sides=8, squash=(1, 1, 1), reg=(0, 0, 0), axis=None):
    """A small UV sphere (eyes, knobs). axis rotates its pole (front of an eye) to point along `axis`."""
    rot = (Vector((0, 0, 1)).rotation_difference(axis).to_matrix() if axis is not None else Matrix.Identity(3))
    rows = []
    for i in range(rings + 1):
        pol = math.pi * i / rings
        row = []
        for j in range(sides):
            th = 2 * math.pi * j / sides
            p = Vector((math.sin(pol) * math.cos(th) * squash[0], math.sin(pol) * math.sin(th) * squash[1], math.cos(pol) * squash[2])) * r
            row.append(m.vert(center + rot @ p, w, reg))
            if i in (0, rings):
                break
        rows.append(row)
    for j in range(sides):
        m.face((rows[0][0], rows[1][j], rows[1][(j + 1) % sides]), mat)
        m.face((rows[-1][0], rows[-2][(j + 1) % sides], rows[-2][j]), mat)
    for r0, r1 in zip(rows[1:-2], rows[2:-1]):
        for j in range(sides):
            m.face((r0[j], r1[j], r1[(j + 1) % sides], r0[(j + 1) % sides]), mat)


def build_eyes(m, R, S, body, q, mats, rnd):
    """Returns glow points (body space) for the game's red eye glow."""
    c = R['ceph']
    E = S['eyes']
    glow = []
    kind = E['kind']
    dirs = [(0.13, 0.36, 0.92, 1.0), (0.3, 0.26, 0.9, 0.72), (0.17, 0.58, 0.8, 0.7), (0.36, 0.5, 0.78, 0.62)]
    if kind == 'big':
        # two huge front eyes looking forward, the small ones behind them
        dirs = [(0.2, 0.32, 0.93, 1.0)] + [(0.3 + rnd.random() * 0.3, 0.45 + rnd.random() * 0.3, 0.6 + rnd.random() * 0.2, 0.18 + rnd.random() * 0.1) for _ in range(E['extra'])]
    for (x, y, z, s) in dirs:
        for side in (1, -1):
            v = Vector((x * side, y, z)).normalized()
            p = ceph_point(c, v.x, v.y, v.z, S['cephFurrows'])
            r = E['r'] * s
            if kind == 'big' and s >= 1.0:
                p = p + v * (r * 0.25) + Vector((0, 0, r * 0.15))
                sphere(m, body @ p, r, bone_w(BODY), mats['eye'], rings=int(8 + 4 * q), sides=int(12 + 6 * q), axis=Vector((side * 0.25, 0.1, 1)).normalized())
                # a lid ridge over the big eye
                sphere(m, body @ (p + Vector((0, r * 0.55, -r * 0.2))), r * 1.08, bone_w(BODY), mats['shell'], rings=5, sides=10, squash=(1.05, 0.4, 0.8))
            elif kind == 'socket':
                continue
            else:
                p = p + v * (r * 0.35)
                sphere(m, body @ p, r, bone_w(BODY), mats['eye'], rings=3 if s < 0.9 else 5, sides=5 if s < 0.9 else 7)
                if s >= 0.72:
                    glow.append(list(p + v * r))
    return glow


def build_face_plate(m, R, S, body, q, mats):
    """Brute: a bony, skull-like plate over the front of the head, with two deep eye sockets and a row of teeth."""
    c = R['ceph']
    rings, sides = int(8 + 8 * q), int(12 + 12 * q)
    W, Hh, D = c['rx'] * 1.05, c['ry'] * 1.35, c['rz'] * 0.55
    front = Vector((0, c['ry'] * 0.35, c['rz'] * 0.78))
    sockets = []
    rows = []
    for i in range(rings + 1):
        v = -1 + 2 * i / rings                     # bottom .. top
        row = []
        for j in range(sides + 1):
            u = -1 + 2 * j / sides                 # right .. left
            rr = 1 - (u * u) * 0.55 - (v * v) * 0.35
            x = u * W
            y = v * Hh * (1 - 0.18 * u * u)
            z = D * max(0.0, rr) ** 0.5
            # brow and cheekbones forward, the nose hole and the eye sockets pushed in
            z += D * 0.18 * math.exp(-(((v - 0.45) / 0.18) ** 2))
            for sx in (-0.42, 0.42):
                k = math.exp(-(((u - sx) / 0.2) ** 2 + ((v - 0.1) / 0.22) ** 2))
                z -= D * 0.65 * k
            z -= D * 0.35 * math.exp(-((u / 0.09) ** 2 + ((v + 0.32) / 0.14) ** 2))
            z += D * 0.04 * bumpy(u * 3, v * 3, 1.7)
            row.append(m.vert(body @ (front + Vector((x, y, z))), bone_w(BODY), (0, 1 - max(0.0, rr), 0)))
        rows.append(row)
    for r0, r1 in zip(rows, rows[1:]):
        for j in range(sides):
            m.face((r0[j], r0[j + 1], r1[j + 1], r1[j]), mats['plate'])
    # sockets: small dull red eyes deep inside
    for sx in (-0.42, 0.42):
        p = front + Vector((sx * W, 0.1 * Hh, D * 0.2))
        sockets.append(list(p + Vector((0, 0, R['ceph']['rz'] * 0.05))))
        sphere(m, body @ p, S['eyes']['r'] * 1.6, bone_w(BODY), mats['eye'], rings=5, sides=8)
    # teeth: a jagged row under the plate
    n = int(10 + 4 * q)
    for i in range(n):
        u = -0.75 + 1.5 * i / (n - 1)
        base = front + Vector((u * W * 0.8, -Hh * 0.88, D * (0.75 - 0.35 * u * u)))
        L = c['ry'] * (0.35 + 0.25 * math.cos(u * 2.1)) * (1.25 if abs(abs(u) - 0.5) < 0.12 else 1)
        st = []
        dirt = Vector((0, -1, 0.15)).normalized()
        for k in range(4):
            t = k / 3
            st.append((body @ (base + dirt * (t * L)), dirt, Vector((0, 0, 1)), Vector((1, 0, 0)), c['rx'] * 0.06 * (1 - t * 0.8), bone_w(BODY), (0, 1, 0)))
        tube(m, st, 5, mats['plate'], tip=True)
    return sockets


def build_spines(m, R, S, F, rnd, q, mat):
    """Brute: a crest of long quills on the back of the abdomen, raked backwards."""
    a = R['abd']
    for i in range(int(S['spines'] * (0.6 + 0.4 * q))):
        s = 0.12 + rnd.random() * 0.72
        th = (rnd.random() - 0.5) * 1.9                       # around the top (th = 0 is straight up)
        r = a['r'] * math.sin(math.pi * s ** 0.78) ** 0.55
        base = Vector((math.sin(th) * r * a['sx'] * 0.95, math.cos(th) * r * a['sy'] * 0.95 + a['r'] * 0.18 * math.sin(math.pi * s), -s * a['len']))
        n = Vector((math.sin(th) * 0.8, math.cos(th), 0)).normalized()
        d = (n * 0.75 + Vector((0, 0.15, -1)) * 0.7 + Vector((rnd.random() - 0.5, 0, rnd.random() - 0.5)) * 0.2).normalized()
        L = lerp(S['spineLen'][0], S['spineLen'][1], rnd.random() ** 1.5) * (0.6 + 0.6 * math.sin(math.pi * s))
        Z = d.cross(UP).normalized() if abs(d.y) < 0.95 else Vector((1, 0, 0))
        Y = Z.cross(d).normalized()
        st = []
        for k in range(4):
            t = k / 3
            bend = Y * (-0.08 * L * t * t)
            st.append((F @ (base + d * (t * L) + bend), F.to_3x3() @ d, F.to_3x3() @ Y, F.to_3x3() @ Z,
                       S['spineR'] * (1 - t * 0.85) * (0.7 + 0.6 * rnd.random()), bone_w(ABD), (0, 1, 0)))
        tube(m, st, 5, mat, tip=True)


def build(P):
    only = [s for s in os.environ.get('SPIDERS', '').split(',') if s]
    report = []
    for name, sp in P['species'].items():
        if only and name not in only:
            continue
        report += build_species(name, sp, P['budget'])
    return report


def build_species(name, sp, budget):
    C.reset_scene()
    R, S, L = sp['rig'], sp['shape'], sp['look']
    rnd = C.rng(len(name) * 101 + 7)
    q = clamp(math.sqrt(S['tris'] / 6000.0), 0.6, 1.5)
    lay = layout(R)
    frames = rest_pose(R, lay)
    body = frames[BODY]
    mats = materials(name, L)
    order = ['shell', 'abd', 'leg', 'plate', 'eye', 'fang']
    mi = {k: i for i, k in enumerate(order)}
    m = Mesh()
    build_ceph(m, R, S, body, q, mi['shell'])
    build_abdomen(m, R, S, frames[ABD], q, mi['abd'])
    for s in range(2):
        build_chelicera(m, R, S, frames[CHEL + s], lay['chel'][s]['side'], CHEL + s, q, mi)
    glow = build_eyes(m, R, S, body, q, mi, rnd)
    if S.get('facePlate'):
        glow += build_face_plate(m, R, S, body, q, mi)
    if S.get('spines'):
        build_spines(m, R, S, frames[ABD], rnd, q, mi['plate'])
    # palps
    for s in range(2):
        fk = [(frames[PALP + s * 3 + k].col[0].xyz, frames[PALP + s * 3 + k].col[1].xyz, frames[PALP + s * 3 + k].col[2].xyz,
               frames[PALP + s * 3 + k].col[3].xyz) for k in range(3)]
        pr = R['palp']['r']
        st = chain_stations(fk, lay['palps'][s]['lens'], [PALP + s * 3 + k for k in range(3)],
                            [[pr * 1.1, pr * 0.95], [pr * 0.95, pr * 0.85], [pr * 0.9, pr * 1.0]], [3, 4, 4], 0.2, 0.0, first_blend=BODY)
        # the palp ends in a rounded club, not a point
        tube(m, st, max(5, int(S['legSides'] * 0.75)), mi['leg'], tip=True)
    # legs
    for li, l in enumerate(lay['legs']):
        fk = [(frames[LEG + li * 6 + k].col[0].xyz, frames[LEG + li * 6 + k].col[1].xyz, frames[LEG + li * 6 + k].col[2].xyz,
               frames[LEG + li * 6 + k].col[3].xyz) for k in range(6)]
        r0 = S['legR'] * (1 - l['pair'] * 0.04)
        radii = [[r0 * a, r0 * b] for a, b in S['segRad']]
        # the coxa starts a little inside the body
        X0 = fk[0][0]
        fk[0] = (fk[0][0], fk[0][1], fk[0][2], fk[0][3] - X0 * r0)
        lens = list(l['lens']); lens[0] += r0
        st = chain_stations(fk, lens, [LEG + li * 6 + k for k in range(6)], radii, S['ringsPerSeg'], S['knob'], S['hook'], first_blend=BODY)
        tube(m, st, S['legSides'], mi['leg'], keel=S['keel'], flat=S['flat'], tip=True)

    lo = to_blender(m, 'spider_' + name, [mats[k] for k in order])
    C.shade_low(lo, 180)
    hi = C.high_from(lo, lo.name + '_high', bevel=0, subdiv=1)
    C.shade_low(hi, 180)
    C.smart_unwrap(lo, island_margin=0.004, angle=70)
    C.pack_atlas([lo], margin=0.003)
    tex = budget['texture']
    span = lay['legSpan']
    mat = C.bake_family([(hi, lo)], tex, 'spider_' + name, extrusion=max(0.004, span * 0.004), ao_samples=16, ao_strength=0.5, metal=False)
    bpy.data.objects.remove(hi, do_unlink=True)
    objs, rep = C.finish_family([lo], mat, lod_ratio=0.5, lod_min=600)
    arm = add_armature(objs, frames, 'spider_' + name + '_rig')
    head = body @ Vector((0, 0, R['ceph']['rz']))
    preview(objs[0], name, span, face=(head, max(R['ceph']['rz'] * 7, R['restR'] * 0.7)))
    C.export_glb(objs + [arm], 'spider_' + name)
    write_sidecar(name, R, lay, frames, glow, S, L)
    return [f'{name}: ' + r for r in rep]


def to_blender(m, name, mat_list):
    bm = bmesh.new()
    vs = [bm.verts.new(C.G(*p)) for p in m.v]
    bm.verts.ensure_lookup_table()
    for f, mi in zip(m.f, m.fm):
        try:
            face = bm.faces.new([vs[i] for i in f])
            face.material_index = mi
            face.smooth = True
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for mt in mat_list:
        me.materials.append(mt[0])
    # bone weights: one vertex group per bone (vertex order is the builder's order)
    groups = [ob.vertex_groups.new(name=f'b{i:02d}') for i in range(BONES)]
    attr = me.color_attributes.new('reg', 'FLOAT_COLOR', 'POINT')
    n = len(me.vertices)
    for i in range(min(n, len(m.v))):
        for b, w in m.w[i].items():
            groups[b].add([i], w, 'REPLACE')
        r = m.reg[i]
        attr.data[i].color = (r[0], r[1], r[2], 1)
    return ob


def add_armature(objs, frames, name):
    """An armature with the 58 bones in their rest frames, only so the glTF carries a skin (the game ignores its bones)."""
    ad = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, ad)
    bpy.context.scene.collection.objects.link(arm)
    C.select_only(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    for i, F in enumerate(frames):
        b = ad.edit_bones.new(f'b{i:02d}')
        p = F.col[3].xyz
        X = F.col[0].xyz
        b.head = C.G(*p)
        b.tail = C.G(*(p + X * 0.02))
    bpy.ops.object.mode_set(mode='OBJECT')
    for ob in objs:
        ob.parent = arm
        mod = ob.modifiers.new('rig', 'ARMATURE')
        mod.object = arm
    return arm


def write_sidecar(name, R, lay, frames, glow, S, L):
    """What the game needs to drive this mesh: rig numbers, layout, rest frames (column-major 4x4, GAME space)."""
    v = lambda x: [round(c, 6) for c in x]
    out = {
        '_about': 'Written by blender/generators/spiders.py with spider_%s.glb. Do not edit: change assets/params/spiders.json.' % name,
        'def': {k: R[k] for k in R},
        'layout': {
            'bodyZ0': lay['bodyZ0'], 'legSpan': lay['legSpan'], 'abdAttach': v(lay['abdAttach']),
            'legs': [dict(side=l['side'], pair=l['pair'], group=l['group'], dir=v(l['dir']), attach=v(l['attach']),
                          lens=[round(x, 6) for x in l['lens']], rest=v(l['rest']), R=l['R']) for l in lay['legs']],
            'palps': [dict(side=p['side'], attach=v(p['attach']), lens=[round(x, 6) for x in p['lens']]) for p in lay['palps']],
            'chel': [dict(side=c['side'], attach=v(c['attach'])) for c in lay['chel']],
        },
        'rest': [[round(F[r][c], 6) for c in range(4) for r in range(4)] for F in frames],
        'glow': [v(g) for g in glow],
        'eyes': S['eyes'],
        'legR': S['legR'],
        'color': L.get('legColor', L['color']),
    }
    os.makedirs(MODELS_DIR, exist_ok=True)
    with open(os.path.join(MODELS_DIR, f'spider_{name}.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))


def preview(ob, name, span, face=None):
    """Studio renders (the game is too dark to judge a model): three-quarter front and from the side."""
    s = span
    C.render_preview([ob], f'{C.BUILD_DIR}/spider_{name}_preview.png', eye=(s * 0.7, -s * 0.95, s * 0.55), target=(0, 0, s * 0.08), lens=40)
    C.render_preview([ob], f'{C.BUILD_DIR}/spider_{name}_side.png', eye=(s * 1.1, -s * 0.05, s * 0.18), target=(0, 0, s * 0.08), lens=40)
    if face:
        # close up on the face, from in front and a little above
        c, d = face
        C.render_preview([ob], f'{C.BUILD_DIR}/spider_{name}_face.png', eye=tuple(C.G(c.x + d * 0.35, c.y + d * 0.45, c.z + d * 1.6)),
                         target=tuple(C.G(c.x, c.y, c.z)), lens=50)


# ---------------------------------------------------------------- 4. materials (only for baking)
def materials(name, L):
    """shell (body), leg, plate (bone), eye, fang. Each layers a CC0 scan with mottling, speckles, bands, a paler belly
    and pale joint membranes, read from the mesh's 'reg' attribute (band, joint, belly)."""

    def layered(mname, color, extra_bands=0.0):
        def post(T, col, rgh):
            at = T.N.new('ShaderNodeAttribute'); at.attribute_name = 'reg'
            reg = T.sep(at.outputs['Vector'])
            band, joint, belly = reg[0], reg[1], reg[2]
            # mottling: big soft patches lighter and darker
            mot = T.maprange(T.noise(14.0, 5.0), 0.35, 0.65, -1.0, 1.0)
            col = T.vmath('SCALE', col, scale=T.math('ADD', 1.0, T.math('MULTIPLY', mot, L.get('mottle', 0.0))))
            # speckles: small dark dots
            if L.get('speckle', 0):
                sp = T.maprange(T.voronoi(160.0), 0.18, 0.06)
                col = T.mix(T.math('MULTIPLY', sp, L['speckle']), col, tuple(c * 0.25 for c in color))
            # belly and joints
            col = T.mix(T.math('MULTIPLY', T.maprange(belly, 0.2, 0.8), 0.8), col, tuple(L['belly']))
            col = T.mix(T.math('MULTIPLY', joint, 0.85), col, tuple(L['joint']))
            if extra_bands:
                b = T.maprange(band, 0.55, 0.85)
                col = T.mix(T.math('MULTIPLY', b, extra_bands), col, tuple(c * 0.35 for c in color))
            # fine hair streaks (bump only, below): a slightly duller sheen
            rgh = T.math('ADD', rgh, T.math('MULTIPLY', L.get('hair', 0.0), 0.08))
            return col, rgh

        hair = []
        if L.get('hair', 0):
            def hair_fn(T):
                v = T.vmath('MULTIPLY', T.tco.outputs['Object'], (900.0, 900.0, 120.0))
                n = T.N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 1.0; n.inputs['Detail'].default_value = 2.0
                T.link(v, n.inputs['Vector'])
                return n.outputs['Fac'], L['hair'] * 0.6
            hair = [hair_fn]
        return M.scanned(mname, L['set'], L['scale'], 'Y', color=color, rough=tuple(L['rough']), bump=L['bump'],
                         bump_dist=0.0004, cavity=0.55, post=post, extra_height=hair)

    shell = layered(name + '_shell', L['color'])
    abd = layered(name + '_abd', L.get('abdColor', L['color']))
    leg = layered(name + '_leg', L.get('legColor', L['color']), extra_bands=L.get('bands', 0.0))
    plate = M.scanned(name + '_plate', 'Leather026', 14.0, 'Y', color=L.get('plate', [0.5, 0.47, 0.42]), rough=(0.55, 0.85),
                      bump=1.6, bump_dist=0.0006, cavity=0.25)
    eye = M.flat(name + '_eye', tuple(L['eyeColor']), rough=0.06)
    fang = M.flat(name + '_fang', (0.03, 0.022, 0.018), rough=0.25)
    return {'shell': shell, 'abd': abd, 'leg': leg, 'plate': plate, 'eye': eye, 'fang': fang}
