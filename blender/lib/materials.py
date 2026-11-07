"""Layered materials built from CC0 photo-scanned texture sets (blender/textures/, fetched by tools/fetch-textures.mjs).

A material here is only used for BAKING: Cycles bakes its colour, roughness, metalness and bumps into the asset's own
texture atlas, which is all the game sees. So these node trees can be as heavy as they like.

How a scanned set is put on a part without UV seams: it is projected from three sides in the object's own space
("triplanar"), and the image's horizontal axis always follows the part's LONG axis, so wood grain runs along a stock and
knit ribs run along a cuff. Colours are re-tinted: the scan's average colour is replaced by the colour asked for in the
parameter file, keeping the scan's variation.

Extra height detail (checkering, stitching, ribs, seams) can be added on top as `extra_height` callbacks that build
nodes and return a height socket. Wear: convex edges get lighter/brighter (`wear`), creases get darker (`cavity`).
"""
import os

import bpy
import numpy as np

from . import common as C

TEX_DIR = os.path.join(C.ROOT, 'blender', 'textures')
_means = {}
AXES = {'X': 0, 'Y': 1, 'Z': 2}


def tex_path(set_id, kind):
    return os.path.join(TEX_DIR, set_id, f'{set_id}_2K-JPG_{kind}.jpg')


def have_set(set_id):
    return os.path.exists(tex_path(set_id, 'Color'))


def image(set_id, kind):
    path = tex_path(set_id, kind)
    if not os.path.exists(path):
        raise FileNotFoundError(f'{path} missing: run `node tools/fetch-textures.mjs`')
    img = bpy.data.images.load(path, check_existing=True)
    if kind != 'Color':
        img.colorspace_settings.name = 'Non-Color'
    return img


def mean_color(set_id):
    """Average linear colour of a scan (to re-tint it)."""
    if set_id not in _means:
        img = image(set_id, 'Color')
        a = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(a)
        _means[set_id] = a.reshape(-1, 4)[::7, :3].mean(axis=0)
    return _means[set_id]


class Tree:
    """Small wrapper around a node tree so recipes read as maths, not plumbing."""

    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.N = self.nt.nodes
        self.bsdf = next(n for n in self.N if n.type == 'BSDF_PRINCIPLED')
        self.tco = self.N.new('ShaderNodeTexCoord')
        self.geo = self.N.new('ShaderNodeNewGeometry')
        self._sep = None

    def link(self, a, b):
        self.nt.links.new(a, b)

    def val(self, v):
        n = self.N.new('ShaderNodeValue'); n.outputs[0].default_value = v
        return n.outputs[0]

    def vec(self, v):
        n = self.N.new('ShaderNodeCombineXYZ')
        for i in range(3):
            n.inputs[i].default_value = v[i]
        return n.outputs[0]

    def _in(self, sock, v):
        if isinstance(v, (int, float)):
            sock.default_value = v
        else:
            self.link(v, sock)

    def math(self, op, a, b=0.0, clamp=False):
        n = self.N.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
        self._in(n.inputs[0], a); self._in(n.inputs[1], b)
        return n.outputs[0]

    def vmath(self, op, a, b=None, scale=None):
        n = self.N.new('ShaderNodeVectorMath'); n.operation = op
        self._in_vec(n.inputs[0], a)
        if b is not None:
            self._in_vec(n.inputs[1], b)
        if scale is not None:
            self._in(n.inputs[3], scale)
        return n.outputs['Value'] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else n.outputs['Vector']

    def _in_vec(self, sock, v):
        if isinstance(v, (tuple, list)):
            sock.default_value = v
        else:
            self.link(v, sock)

    def maprange(self, x, a, b, c=0.0, d=1.0, smooth=True):
        n = self.N.new('ShaderNodeMapRange')
        if smooth:
            n.interpolation_type = 'SMOOTHSTEP'
        self._in(n.inputs['Value'], x)
        n.inputs['From Min'].default_value = a; n.inputs['From Max'].default_value = b
        n.inputs['To Min'].default_value = c; n.inputs['To Max'].default_value = d
        return n.outputs['Result']

    def mix(self, fac, a, b):
        """Linear mix of two colours/vectors (a at 0, b at 1). Works for scalars too (as vectors)."""
        n = self.N.new('ShaderNodeMix'); n.data_type = 'VECTOR'; n.factor_mode = 'UNIFORM'
        self._in(n.inputs['Factor'], fac)
        A = next(s for s in n.inputs if s.name == 'A' and s.type == 'VECTOR')
        B = next(s for s in n.inputs if s.name == 'B' and s.type == 'VECTOR')
        for sock, v in ((A, a), (B, b)):
            if isinstance(v, (tuple, list)):
                sock.default_value = v
            elif isinstance(v, (int, float)):
                sock.default_value = (v, v, v)
            else:
                self.link(v, sock)
        return next(s for s in n.outputs if s.type == 'VECTOR')

    def sep(self, vec=None):
        n = self.N.new('ShaderNodeSeparateXYZ')
        self.link(vec if vec is not None else self.tco.outputs['Object'], n.inputs[0])
        return n.outputs

    @property
    def P(self):
        """Object-space position, separated (Blender axes X, Y, Z)."""
        if self._sep is None:
            self._sep = self.sep()
        return self._sep

    def noise(self, scale, detail=4.0, vec=None, kind='Fac'):
        n = self.N.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
        self.link(vec if vec is not None else self.tco.outputs['Object'], n.inputs['Vector'])
        return n.outputs[kind]

    def voronoi(self, scale, vec=None, out='Distance', feature='F1'):
        n = self.N.new('ShaderNodeTexVoronoi'); n.feature = feature
        n.inputs['Scale'].default_value = scale
        self.link(vec if vec is not None else self.tco.outputs['Object'], n.inputs['Vector'])
        return n.outputs[out]

    def pointiness(self, lo, hi):
        """0..1: convex edges (lo<hi) or creases (lo>hi). Needs a dense mesh (the HIGH mesh)."""
        return self.maprange(self.geo.outputs['Pointiness'], lo, hi)

    def edges(self, radius=0.0012, lo=0.03, hi=0.25):
        """0..1 on convex AND concave edges, from how far a rounded (bevel) normal leans away from the true one.
        Independent of mesh density. Combined with convexity below to keep only the worn (outer) edges."""
        bv = self.N.new('ShaderNodeBevel'); bv.samples = 8
        bv.inputs['Radius'].default_value = radius
        d = self.vmath('DOT_PRODUCT', bv.outputs['Normal'], self.geo.outputs['Normal'])
        return self.maprange(self.math('SUBTRACT', 1.0, d), lo, hi)

    def convex(self, radius=0.0012):
        """Worn edges: rounded-normal edges that are NOT in a crease (AO says open)."""
        return self.math('MULTIPLY', self.edges(radius), self.maprange(self.ao(radius * 3), 0.75, 0.95), clamp=True)

    def crease(self, distance=0.004):
        """0..1 in creases and corners (where dirt and darkness collect)."""
        return self.maprange(self.ao(distance), 0.85, 0.35)

    def ao(self, distance, inside=False, samples=8):
        n = self.N.new('ShaderNodeAmbientOcclusion'); n.inside = inside; n.only_local = True; n.samples = samples
        n.inputs['Distance'].default_value = distance
        return n.outputs['AO']

    def tri(self, img, scale, long_axis='Y', seed=0.0):
        """Sample `img` projected from three sides, image-u along `long_axis`. Returns a colour/vector socket."""
        a = AXES[long_axis]
        b, c = [i for i in range(3) if i != a]
        P = self.P
        nrm = self.sep(self.tco.outputs['Normal'])
        out = None
        wsum = None
        # (projection axis, u coord, v coord)
        for k, (proj, u, v) in enumerate(((b, a, c), (c, a, b), (a, b, c))):
            cmb = self.N.new('ShaderNodeCombineXYZ')
            self.link(P[u], cmb.inputs[0]); self.link(P[v], cmb.inputs[1])
            mp = self.N.new('ShaderNodeMapping')
            mp.inputs['Scale'].default_value = (scale, scale, 1)
            mp.inputs['Location'].default_value = (0.37 * k + seed, 0.61 * k + seed * 0.7, 0)
            self.link(cmb.outputs[0], mp.inputs['Vector'])
            t = self.N.new('ShaderNodeTexImage'); t.image = img; t.interpolation = 'Cubic'
            self.link(mp.outputs['Vector'], t.inputs['Vector'])
            w = self.math('POWER', self.math('ABSOLUTE', nrm[proj]), 4.0)
            term = self.vmath('SCALE', t.outputs['Color'], scale=w)
            out = term if out is None else self.vmath('ADD', out, term)
            wsum = w if wsum is None else self.math('ADD', wsum, w)
        inv = self.math('DIVIDE', 1.0, self.math('MAXIMUM', wsum, 1e-4))
        return self.vmath('SCALE', out, scale=inv)

    def gray(self, col):
        return self.vmath('DOT_PRODUCT', col, (0.3333, 0.3333, 0.3333))


def scanned(name, set_id, scale, long_axis='Y', color=None, rough=(0.4, 0.8), metal=0.0, bump=1.0, bump_dist=0.0004,
            wear=None, cavity=0.0, extra_height=None, dirt=None, seed=0.0, post=None):
    """A material from one scanned set.

    scale: repeats per metre. color: target average colour (linear RGB) or None to keep the scan's.
    rough: roughness range the scan's roughness map is squeezed into. metal: 0..1.
    wear: dict(color=, rough=, metal=, lo=, hi=) for convex worn edges (pointiness lo..hi).
    cavity: 0..1 how much darker the creases get. extra_height: [fn(T) -> (height socket, strength)].
    dirt: dict(set_id=, color=, amount=, scale=, rough=) caked in creases and low down. post: fn(T, col, rgh) -> (col, rgh).
    Returns (material, metal socket) like the old common.*_material functions, so common.assign/bake_family take it.
    """
    T = Tree(name)
    col_img = image(set_id, 'Color')
    col = T.tri(col_img, scale, long_axis, seed)
    if color is not None:
        m = mean_color(set_id)
        k = tuple(float(color[i] / max(1e-4, m[i])) for i in range(3))
        col = T.vmath('MULTIPLY', col, k)
    try:
        rimg = image(set_id, 'Roughness')
        rgh = T.maprange(T.gray(T.tri(rimg, scale, long_axis, seed)), 0, 1, rough[0], rough[1], smooth=False)
    except FileNotFoundError:
        rgh = T.val((rough[0] + rough[1]) / 2)
    h = T.gray(T.tri(image(set_id, 'Displacement'), scale, long_axis, seed))
    met = T.val(metal)
    if cavity > 0:
        cav = T.crease(0.004)
        col = T.mix(T.math('MULTIPLY', cav, cavity), col, T.vmath('SCALE', col, scale=0.3))
    if dirt:
        dcol = T.tri(image(dirt['set_id'], 'Color'), dirt.get('scale', 6.0), long_axis, seed + 0.3)
        dm = mean_color(dirt['set_id'])
        dcol = T.vmath('MULTIPLY', dcol, tuple(float(dirt['color'][i] / max(1e-4, dm[i])) for i in range(3)))
        mask = dirt_mask(T, dirt)
        col = T.mix(mask, col, dcol)
        rgh = T.vmath('DOT_PRODUCT', T.mix(mask, rgh, dirt.get('rough', 0.9)), (1, 0, 0))   # mix is a vector: take x
        met = T.math('MULTIPLY', met, T.math('SUBTRACT', 1.0, mask))
        dh = T.gray(T.tri(image(dirt['set_id'], 'Displacement'), dirt.get('scale', 6.0), long_axis, seed + 0.3))
        h = T.math('ADD', h, T.math('MULTIPLY', T.math('MULTIPLY', mask, dh), dirt.get('height', 2.0)))
    if wear:
        wm = T.math('MULTIPLY', T.convex(wear.get('radius', 0.0012)),
                    T.maprange(T.noise(wear.get('noise', 60.0), 6.0), 0.35, 0.65), clamp=True)
        wm = T.math('MULTIPLY', wm, wear.get('amount', 1.0), clamp=True)
        if 'color' in wear:
            col = T.mix(wm, col, tuple(wear['color']))
        if 'rough' in wear:
            rgh = T.math('ADD', T.math('MULTIPLY', rgh, T.math('SUBTRACT', 1.0, wm)), T.math('MULTIPLY', wm, wear['rough']))
        if 'metal' in wear:
            met = T.math('ADD', T.math('MULTIPLY', met, T.math('SUBTRACT', 1.0, wm)), T.math('MULTIPLY', wm, wear['metal']))
    if post:
        col, rgh = post(T, col, rgh)
    # bumps: the scan's height plus any extra detail
    total = T.math('MULTIPLY', h, bump)
    for fn in (extra_height or []):
        hs, strength = fn(T)
        total = T.math('ADD', total, T.math('MULTIPLY', hs, strength))
    bn = T.N.new('ShaderNodeBump')
    bn.inputs['Strength'].default_value = 1.0
    bn.inputs['Distance'].default_value = bump_dist
    T.link(total, bn.inputs['Height'])
    T.link(bn.outputs['Normal'], T.bsdf.inputs['Normal'])
    T.link(col, T.bsdf.inputs['Base Color'])
    T.link(rgh, T.bsdf.inputs['Roughness'])
    T.link(met, T.bsdf.inputs['Metallic'])
    return T.mat, met


def dirt_mask(T, d):
    """Dirt: in creases, plus everything below `below` (object-space Blender z) fading up over `fade` metres, broken up by noise."""
    n = T.maprange(T.noise(d.get('noiseScale', 18.0), 6.0), 0.42, 0.62)
    m = T.math('MULTIPLY', T.crease(d.get('crease', 0.01)), 0.8)
    if 'below' in d:
        low = T.maprange(T.P[2], d['below'] + d.get('fade', 0.1), d['below'], 0, 1)
        m = T.math('MAXIMUM', m, low)
    return T.math('MULTIPLY', T.math('MULTIPLY', m, n), d.get('amount', 1.0), clamp=True)


def flat(name, color, rough=0.5, metal=0.0, bump_scale=0.0, bump_dist=0.0002):
    """A plain material (brass bead, primer, bore) with a little noise bump."""
    T = Tree(name)
    T.bsdf.inputs['Base Color'].default_value = (*color, 1)
    T.bsdf.inputs['Roughness'].default_value = rough
    met = T.val(metal)
    T.link(met, T.bsdf.inputs['Metallic'])
    if bump_scale:
        bn = T.N.new('ShaderNodeBump'); bn.inputs['Distance'].default_value = bump_dist
        T.link(T.noise(bump_scale, 8.0), bn.inputs['Height'])
        T.link(bn.outputs['Normal'], T.bsdf.inputs['Normal'])
    return T.mat, met


# ---------------------------------------------------------------- extra height patterns (return fn(T) -> (socket, strength))
def checkering(lines_per_m=900.0, angle_deg=32.0, strength=1.0, axes=('Y', 'Z')):
    """Diamond checkering (gun stocks): two sets of sharp V-grooves crossing at +-angle to the long axis."""
    import math

    def fn(T):
        P = T.P
        u, v = P[AXES[axes[0]]], P[AXES[axes[1]]]
        ca, sa = math.cos(math.radians(angle_deg)), math.sin(math.radians(angle_deg))
        hs = []
        for s in (1, -1):
            x = T.math('ADD', T.math('MULTIPLY', u, sa), T.math('MULTIPLY', v, ca * s))
            fr = T.math('FRACT', T.math('MULTIPLY', x, lines_per_m))
            tri = T.math('ABSOLUTE', T.math('SUBTRACT', T.math('MULTIPLY', fr, 2.0), 1.0))   # 1 at groove, 0 mid
            hs.append(tri)
        return T.math('MULTIPLY', T.math('MINIMUM', T.math('SUBTRACT', 1.0, hs[0]), T.math('SUBTRACT', 1.0, hs[1])), 1.0), strength
    return fn


def ribs(per_m, axis='Y', strength=1.0, sharp=False):
    """Parallel ribs across `axis` (knit cuffs, rubber butt pad, knurling)."""
    def fn(T):
        x = T.P[AXES[axis]]
        s = T.math('SINE', T.math('MULTIPLY', x, per_m * 6.2832))
        h = T.math('ABSOLUTE', s) if sharp else T.math('MULTIPLY', T.math('ADD', s, 1.0), 0.5)
        return h, strength
    return fn


def attribute_lines(attr, width=0.0012, dash_per_m=420.0, strength=1.0, groove=True):
    """Stitching and seams along mesh edges marked by the generator: `attr` is a float vertex attribute holding the
    distance (metres) to the nearest seam. Produces a groove at the seam and two rows of stitches beside it."""
    def fn(T):
        a = T.N.new('ShaderNodeAttribute'); a.attribute_name = attr
        d = a.outputs['Fac']
        g = T.maprange(d, width * 0.6, 0.0, 0.0, 1.0) if groove else T.val(0.0)
        # stitch rows at ~2.2 x width from the seam, dashed
        row = T.maprange(T.math('ABSOLUTE', T.math('SUBTRACT', d, width * 2.4)), width * 0.55, 0.0, 0.0, 1.0)
        P = T.P
        dash = T.math('SINE', T.math('MULTIPLY', T.math('ADD', T.math('ADD', P[0], P[1]), P[2]), dash_per_m * 6.2832))
        dash = T.maprange(dash, -0.2, 0.4)
        st = T.math('MULTIPLY', row, dash)
        return T.math('SUBTRACT', st, g), strength
    return fn
