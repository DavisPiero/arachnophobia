"""Shared helpers for the asset generators.

Every generator follows the same steps:
  1. build a HIGH-detail mesh (all the small surface detail lives here)
  2. build a LOW mesh for the game (few triangles), unwrap it
  3. bake the high mesh's colour, normals, roughness and ambient occlusion onto the low mesh's textures
  4. export only the low meshes to a .glb

Nothing here opens a window: Blender runs with -b (background).
"""
import json
import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Vector, noise

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PARAMS_DIR = os.path.join(ROOT, 'assets', 'params')
BUILD_DIR = os.path.join(ROOT, 'blender', 'build')      # raw exports (git-ignored), shrunk by tools/assets.mjs


def load_params(name):
    with open(os.path.join(PARAMS_DIR, name + '.json')) as f:
        return json.load(f)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 1
    scene.render.bake.margin = 6
    scene.render.bake.use_clear = False   # several objects bake into one atlas, one cell each
    scene.unit_settings.system = 'METRIC'
    return scene


def rng(seed):
    return random.Random(seed)


def fbm(p, octaves=4, lacunarity=2.0, gain=0.5):
    """Fractal noise in roughly -1..1."""
    s, a, f, total = 0.0, 1.0, 1.0, 0.0
    for _ in range(octaves):
        s += a * noise.noise(p * f)
        total += a
        a *= gain
        f *= lacunarity
    return s / total


def mesh_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def select_only(*objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def duplicate(ob, name):
    new = ob.copy()
    new.data = ob.data.copy()
    new.name = name
    new.data.name = name
    bpy.context.scene.collection.objects.link(new)
    return new


def apply_modifiers(ob):
    select_only(ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def decimate_to(ob, tris):
    """Collapse-decimate until the mesh has about `tris` triangles. Keeps UVs."""
    me = ob.data
    me.calc_loop_triangles()
    have = len(me.loop_triangles)
    if have <= tris:
        return
    mod = ob.modifiers.new('decimate', 'DECIMATE')
    mod.ratio = tris / have
    mod.use_collapse_triangulate = True
    apply_modifiers(ob)


def triangle_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


def smart_unwrap(ob, island_margin=0.02, angle=66):
    """Higher angle = fewer, bigger UV islands (fewer seams, sharper texture), a little more stretch."""
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=island_margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def pack_atlas(objs, margin=0.004):
    """Pack the UV islands of several objects into one shared 0..1 atlas, all at the same texel density."""
    select_only(*objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def fit_uvs_to_cell(ob, cell, grid, pad=0.01):
    """Squeeze an object's (0..1) UVs into one cell of a grid x grid atlas."""
    cx, cy = cell % grid, cell // grid
    s = (1.0 - 2 * pad) / grid
    uv = ob.data.uv_layers.active.data
    for d in uv:
        d.uv = Vector((cx / grid + pad / grid + d.uv.x * s, cy / grid + pad / grid + d.uv.y * s))


def new_image(name, size, non_color=False, color=(0.5, 0.5, 0.5, 1.0)):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.generated_color = color
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    return img


def bake_target_material(ob, img):
    """Give `ob` a material whose active node is an image node for `img` (Cycles bakes into it)."""
    mat = bpy.data.materials.new(ob.name + '_bake')
    mat.use_nodes = True
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    mat.node_tree.nodes.active = node
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return node


def set_bake_image(ob, img):
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        node = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
        node.image = img
        nt.nodes.active = node


def bake(high, low, kind, img, extrusion=0.06, samples=1):
    """Bake `kind` from high onto low into img. kind: 'COLOR', 'NORMAL', 'ROUGHNESS', 'AO'."""
    scene = bpy.context.scene
    scene.cycles.samples = samples
    set_bake_image(low, img)
    select_only(high, low, active=low)
    kw = dict(use_selected_to_active=True, cage_extrusion=extrusion, margin=6, use_clear=False)
    if kind == 'COLOR':
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, **kw)
    elif kind == 'NORMAL':
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', **kw)
    elif kind == 'ROUGHNESS':
        bpy.ops.object.bake(type='ROUGHNESS', **kw)
    elif kind == 'AO':
        bpy.ops.object.bake(type='AO', **kw)
    else:
        raise ValueError(kind)


def image_pixels(img):
    a = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def set_image_pixels(img, arr):
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.update()


def multiply_ao(color_img, ao_img, strength=0.8):
    c = image_pixels(color_img)
    ao = image_pixels(ao_img)[..., :1]
    c[..., :3] *= (1.0 - strength) + strength * ao
    set_image_pixels(color_img, c)


def save_image(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()


def game_material(name, color_img, normal_img, rough_img, normal_strength=1.0):
    """The material the game sees: base colour + tangent normal map + roughness."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = color_img
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = normal_img
    tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = rough_img
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = normal_strength
    nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(tr.outputs['Color'], bsdf.inputs['Roughness'])
    bsdf.inputs['Metallic'].default_value = 0.0
    return mat


def export_glb(objs, name):
    """Write blender/build/<name>.glb with just these objects. tools/assets.mjs then shrinks it into assets/models/."""
    os.makedirs(BUILD_DIR, exist_ok=True)
    path = os.path.join(BUILD_DIR, name + '.glb')
    select_only(*objs)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_texcoords=True, export_normals=True,
        export_tangents=True, export_materials='EXPORT', export_image_format='AUTO',
        export_cameras=False, export_lights=False, export_animations=False,
    )
    return path


# ---------------------------------------------------------------- hard-surface + character helpers (milestone 3)
# Game space is x right, y up, z towards the player (three.js / glTF). Blender is z up. Parameter files give
# positions in GAME space so the game and Blender read the same numbers; G() converts one point to Blender.
def G(x, y, z):
    return Vector((x, -z, y))


def loft(name, sections, cap_start=True, cap_end=True):
    """Mesh through a list of rings (each a list of Vector, same count). Used for barrels, stocks, handles, boots."""
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in ring] for ring in sections]
    n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if cap_start:
        bm.faces.new(list(reversed(rings[0])))
    if cap_end:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm)


def ring(center, rx, ry, n=12, power=2.0, axis='z', rot=0.0):
    """Superellipse ring around `center` in GAME space, perpendicular to a game axis. power>2 = boxier."""
    pts = []
    for i in range(n):
        a = rot + 2 * math.pi * i / n
        c, s = math.cos(a), math.sin(a)
        x = math.copysign(abs(c) ** (2 / power), c) * rx
        y = math.copysign(abs(s) ** (2 / power), s) * ry
        if axis == 'z':
            p = (center[0] + x, center[1] + y, center[2])
        elif axis == 'y':
            p = (center[0] + x, center[1], center[2] + y)
        else:
            p = (center[0], center[1] + y, center[2] + x)
        pts.append(G(*p))
    return pts


def box(name, mn, mx):
    """Axis-aligned box from two GAME-space corners."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    lo, hi = G(*mn), G(*mx)
    lo, hi = Vector(map(min, lo, hi)), Vector(map(max, lo, hi))
    for v in bm.verts:
        v.co = Vector((lo.x + (v.co.x + 0.5) * (hi.x - lo.x), lo.y + (v.co.y + 0.5) * (hi.y - lo.y), lo.z + (v.co.z + 0.5) * (hi.z - lo.z)))
    return mesh_object(name, bm)


def tube_curve(name, pts, radius, bevel_res=3, profile=None):
    """A curve through GAME-space points with a round (or rectangular, profile=(w,h)) cross-section, as a mesh."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        v = G(*q)
        p.co = (v.x, v.y, v.z, 1)
    if profile:
        w, h = profile
        bm = bpy.data.curves.new(name + '_prof', 'CURVE')
        ps = bm.splines.new('POLY'); ps.points.add(3)
        for p, (x, y) in zip(ps.points, ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))):
            p.co = (x, y, 0, 1)
        ps.use_cyclic_u = True
        bo = bpy.data.objects.new(name + '_prof', bm)
        bpy.context.scene.collection.objects.link(bo)
        cu.bevel_mode = 'OBJECT'; cu.bevel_object = bo
    else:
        cu.bevel_depth = radius; cu.bevel_resolution = bevel_res
    cu.use_fill_caps = True
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    select_only(ob)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    if profile:
        bpy.data.objects.remove(bpy.data.objects[name + '_prof'], do_unlink=True)
    return ob


def join(objs, name):
    select_only(*objs, active=objs[0])
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    return ob


def add_modifier(ob, kind, **kw):
    m = ob.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(m, k, v)
    return m


def high_from(low, name, bevel=0.0015, segments=3, subdiv=1, angle=40):
    """HIGH version of a hard-surface part: copy with rounded edges (bevel + subdivision). Baked onto the LOW one."""
    hi = duplicate(low, name)
    if bevel > 0:
        add_modifier(hi, 'BEVEL', width=bevel, segments=segments, limit_method='ANGLE', angle_limit=math.radians(angle))
    if subdiv:
        add_modifier(hi, 'SUBSURF', levels=subdiv, render_levels=subdiv)
    apply_modifiers(hi)
    return hi


def shade_low(ob, angle=40):
    select_only(ob)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))


MB_SURFACE = 0.57   # a lone metaball element's visible surface sits at ~0.57 x its radius (threshold 0.6, stiffness 2)


def metaball_mesh(name, elements, resolution=0.002, threshold=0.6):
    """Organic shapes (gloved hands): elements = [(kind, a, b, radius)] in GAME space. kind 'ball' or 'capsule' (a->b).
    `radius` is the VISIBLE radius of the element on its own (neighbours blend and grow a little)."""
    mb = bpy.data.metaballs.new(name)
    mb.resolution = resolution; mb.render_resolution = resolution; mb.threshold = threshold
    for kind, a, b, r in elements:
        e = mb.elements.new()
        e.radius = r / MB_SURFACE
        A = G(*a)
        if kind == 'capsule':
            B = G(*b)
            d = B - A
            e.type = 'CAPSULE'
            e.co = (A + B) / 2
            e.size_x = max(1e-4, d.length / 2)
            e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())
        elif kind == 'ellipsoid':
            e.type = 'ELLIPSOID'; e.co = A
            e.size_x, e.size_y, e.size_z = b   # Blender-axis half sizes
        else:
            e.type = 'BALL'; e.co = A
    ob = bpy.data.objects.new(name, mb)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.update()
    select_only(ob)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


# ---------------------------------------------------------------- procedural materials for baking
# Each returns (material, metal_socket): metal_socket is a float output that says where the surface is bare metal.
def _mat(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    return mat, nt, nt.nodes, nt.links.new, next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')


def _val(N, v):
    n = N.new('ShaderNodeValue'); n.outputs[0].default_value = v
    return n.outputs[0]


def _wear(N, link, lo=0.5, hi=0.56):
    """0..1 mask for convex edges (Cycles pointiness): where handling wears paint, bluing and leather."""
    geo = N.new('ShaderNodeNewGeometry')
    mr = N.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = lo; mr.inputs['From Max'].default_value = hi
    link(geo.outputs['Pointiness'], mr.inputs['Value'])
    return mr.outputs['Result']


def _mix_rgb(N, link, fac, a, b, blend='MIX'):
    m = N.new('ShaderNodeMix'); m.data_type = 'RGBA'; m.blend_type = blend
    if isinstance(fac, float):
        m.inputs['Factor'].default_value = fac
    else:
        link(fac, m.inputs['Factor'])
    for key, v in (('A', a), ('B', b)):
        s = next(x for x in m.inputs if x.name == key and x.type == 'RGBA')
        if isinstance(v, tuple):
            s.default_value = (*v, 1)
        else:
            link(v, s)
    return next(x for x in m.outputs if x.name == 'Result' and x.type == 'RGBA')


def _ramp(N, link, fac, stops):
    r = N.new('ShaderNodeValToRGB')
    els = r.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for e, (pos, col) in zip(els, stops):
        e.position = pos; e.color = (*col, 1)
    link(fac, r.inputs['Fac'])
    return r.outputs['Color']


def wood_material(name, dark=(0.07, 0.035, 0.016), light=(0.2, 0.1, 0.045), grain_axis='Y', scale=9.0, gloss=0.42):
    """Oiled walnut: long grain along a Blender axis, darker pores, lighter worn edges."""
    mat, nt, N, link, bsdf = _mat(name)
    tco = N.new('ShaderNodeTexCoord')
    mp = N.new('ShaderNodeMapping')
    # stretch noise along the grain so it reads as long fibres
    mp.inputs['Scale'].default_value = {'X': (0.08, 1, 1), 'Y': (1, 0.08, 1), 'Z': (1, 1, 0.08)}[grain_axis]
    link(tco.outputs['Object'], mp.inputs['Vector'])
    wave = N.new('ShaderNodeTexWave'); wave.wave_type = 'BANDS'; wave.bands_direction = {'X': 'Z', 'Y': 'Z', 'Z': 'X'}[grain_axis]   # bands across the grain axis = long fibres
    wave.inputs['Scale'].default_value = scale; wave.inputs['Distortion'].default_value = 7; wave.inputs['Detail'].default_value = 4
    link(tco.outputs['Object'], wave.inputs['Vector'])
    fib = N.new('ShaderNodeTexNoise'); fib.inputs['Scale'].default_value = 160; fib.inputs['Detail'].default_value = 3
    link(mp.outputs['Vector'], fib.inputs['Vector'])
    base = _ramp(N, link, wave.outputs['Fac'], [(0.15, dark), (0.85, light)])
    col = _mix_rgb(N, link, 0.35, base, fib.outputs['Color'], 'OVERLAY')
    wear = _wear(N, link, 0.505, 0.56)
    col = _mix_rgb(N, link, wear, col, tuple(min(1, c * 1.9) for c in light))
    link(col, bsdf.inputs['Base Color'])
    rough = N.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = gloss; rough.inputs['To Max'].default_value = gloss + 0.25
    link(fib.outputs['Fac'], rough.inputs['Value'])
    link(rough.outputs['Result'], bsdf.inputs['Roughness'])
    return mat, _val(N, 0.0)


def steel_material(name, blue=(0.035, 0.04, 0.05), bare=(0.42, 0.42, 0.43), wear_lo=0.51, wear_hi=0.58, rust=0.0):
    """Blued (or forged) steel: dark, slightly blue; bright bare steel on worn edges; optional rust in the cavities."""
    mat, nt, N, link, bsdf = _mat(name)
    tco = N.new('ShaderNodeTexCoord')
    n = N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 90; n.inputs['Detail'].default_value = 6
    link(tco.outputs['Object'], n.inputs['Vector'])
    wear = _wear(N, link, wear_lo, wear_hi)
    wm = N.new('ShaderNodeMath'); wm.operation = 'MULTIPLY'
    link(wear, wm.inputs[0]); link(n.outputs['Fac'], wm.inputs[1])
    wm2 = N.new('ShaderNodeMath'); wm2.operation = 'MULTIPLY'; wm2.inputs[1].default_value = 2.0; wm2.use_clamp = True
    link(wm.outputs[0], wm2.inputs[0])
    col = _mix_rgb(N, link, 0.25, blue, n.outputs['Color'], 'OVERLAY')
    if rust > 0:
        cav = _wear(N, link, 0.5, 0.44)  # inverted range: concave areas
        rn = N.new('ShaderNodeTexNoise'); rn.inputs['Scale'].default_value = 14; rn.inputs['Detail'].default_value = 8
        link(tco.outputs['Object'], rn.inputs['Vector'])
        rmask = N.new('ShaderNodeMapRange'); rmask.inputs['From Min'].default_value = 0.52; rmask.inputs['From Max'].default_value = 0.62
        link(rn.outputs['Fac'], rmask.inputs['Value'])
        rmul = N.new('ShaderNodeMath'); rmul.operation = 'MAXIMUM'
        link(rmask.outputs['Result'], rmul.inputs[0]); link(cav, rmul.inputs[1])
        rk = N.new('ShaderNodeMath'); rk.operation = 'MULTIPLY'; rk.inputs[1].default_value = rust
        link(rmul.outputs[0], rk.inputs[0])
        col = _mix_rgb(N, link, rk.outputs[0], col, (0.11, 0.045, 0.018))
    col = _mix_rgb(N, link, wm2.outputs[0], col, bare)
    link(col, bsdf.inputs['Base Color'])
    rough = N.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = 0.42; rough.inputs['To Max'].default_value = 0.22
    link(wm2.outputs[0], rough.inputs['Value'])
    link(rough.outputs['Result'], bsdf.inputs['Roughness'])
    metal = N.new('ShaderNodeMapRange'); metal.inputs['To Min'].default_value = 0.85; metal.inputs['To Max'].default_value = 1.0
    link(wm2.outputs[0], metal.inputs['Value'])
    if rust > 0:
        m2 = N.new('ShaderNodeMath'); m2.operation = 'SUBTRACT'; m2.use_clamp = True
        link(metal.outputs['Result'], m2.inputs[0]); link(rk.outputs[0], m2.inputs[1])
        return mat, m2.outputs[0]
    return mat, metal.outputs['Result']


def brass_material(name):
    mat, nt, N, link, bsdf = _mat(name)
    tco = N.new('ShaderNodeTexCoord')
    n = N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 120
    link(tco.outputs['Object'], n.inputs['Vector'])
    col = _mix_rgb(N, link, 0.2, (0.62, 0.42, 0.14), n.outputs['Color'], 'OVERLAY')
    link(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.3
    return mat, _val(N, 1.0)


def leather_material(name, base=(0.045, 0.032, 0.024), worn=(0.13, 0.095, 0.07), scale=380.0):
    """Work-glove / boot leather: pebbled grain, darker creases, lighter scuffed knuckles."""
    mat, nt, N, link, bsdf = _mat(name)
    tco = N.new('ShaderNodeTexCoord')
    vor = N.new('ShaderNodeTexVoronoi'); vor.inputs['Scale'].default_value = scale
    link(tco.outputs['Object'], vor.inputs['Vector'])
    n = N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 40; n.inputs['Detail'].default_value = 6
    link(tco.outputs['Object'], n.inputs['Vector'])
    col = _mix_rgb(N, link, 0.3, base, n.outputs['Color'], 'OVERLAY')
    wear = _wear(N, link, 0.505, 0.6)
    col = _mix_rgb(N, link, wear, col, worn)
    cav = _wear(N, link, 0.49, 0.43)
    col = _mix_rgb(N, link, cav, col, tuple(c * 0.35 for c in base))
    link(col, bsdf.inputs['Base Color'])
    rough = N.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = 0.55; rough.inputs['To Max'].default_value = 0.8
    link(vor.outputs['Distance'], rough.inputs['Value'])
    link(rough.outputs['Result'], bsdf.inputs['Roughness'])
    # pebble bumps
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.35; bump.inputs['Distance'].default_value = 0.0004
    link(vor.outputs['Distance'], bump.inputs['Height'])
    link(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat, _val(N, 0.0)


def cloth_material(name, base=(0.05, 0.055, 0.045), scale=900.0):
    """Waxed canvas / wool jacket sleeve: woven micro-texture, darker folds."""
    mat, nt, N, link, bsdf = _mat(name)
    tco = N.new('ShaderNodeTexCoord')
    w1 = N.new('ShaderNodeTexWave'); w1.inputs['Scale'].default_value = scale; w1.bands_direction = 'X'
    w2 = N.new('ShaderNodeTexWave'); w2.inputs['Scale'].default_value = scale; w2.bands_direction = 'Z'
    for w in (w1, w2):
        link(tco.outputs['Object'], w.inputs['Vector'])
    m = N.new('ShaderNodeMath'); m.operation = 'MULTIPLY'
    link(w1.outputs['Fac'], m.inputs[0]); link(w2.outputs['Fac'], m.inputs[1])
    n = N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 30
    link(tco.outputs['Object'], n.inputs['Vector'])
    col = _mix_rgb(N, link, 0.25, base, n.outputs['Color'], 'OVERLAY')
    cav = _wear(N, link, 0.495, 0.45)
    col = _mix_rgb(N, link, cav, col, tuple(c * 0.4 for c in base))
    link(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.92
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25; bump.inputs['Distance'].default_value = 0.0003
    link(m.outputs[0], bump.inputs['Height'])
    link(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat, _val(N, 0.0)


def assign(ob, mat_and_metal):
    mat, metal = mat_and_metal
    mat['_metal_node'] = metal.node.name
    mat['_metal_out'] = list(metal.node.outputs).index(metal)
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def bake_metal(high, low, img, extrusion):
    """Bake each high material's metal mask through a temporary emission shader."""
    saved = []
    for slot in high.material_slots:
        mat = slot.material
        nt = mat.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        old = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].links else None
        em = nt.nodes.new('ShaderNodeEmission')
        src = nt.nodes[mat['_metal_node']].outputs[mat['_metal_out']]
        nt.links.new(src, em.inputs['Strength'])
        em.inputs['Color'].default_value = (1, 1, 1, 1)
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        saved.append((nt, out, old, em))
    set_bake_image(low, img)
    select_only(high, low, active=low)
    bpy.ops.object.bake(type='EMIT', use_selected_to_active=True, cage_extrusion=extrusion, margin=6, use_clear=False)
    for nt, out, old, em in saved:
        if old:
            nt.links.new(old, out.inputs['Surface'])
        nt.nodes.remove(em)


def bake_base_color(high, low, img, extrusion):
    """Bake each high material's Base Color through a temporary emission shader. (A DIFFUSE colour bake returns black
    for metals, so blued steel and brass would lose their colour.)"""
    saved = []
    for slot in high.material_slots:
        nt = slot.material.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        old = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].links else None
        em = nt.nodes.new('ShaderNodeEmission')
        bc = bsdf.inputs['Base Color']
        if bc.links:
            nt.links.new(bc.links[0].from_socket, em.inputs['Color'])
        else:
            em.inputs['Color'].default_value = bc.default_value
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        saved.append((nt, out, old, em))
    set_bake_image(low, img)
    select_only(high, low, active=low)
    bpy.ops.object.bake(type='EMIT', use_selected_to_active=True, cage_extrusion=extrusion, margin=6, use_clear=False)
    for nt, out, old, em in saved:
        if old:
            nt.links.new(old, out.inputs['Surface'])
        nt.nodes.remove(em)


def bake_family(pairs, size, prefix, extrusion=0.01, ao_samples=16, ao_strength=0.7, metal=True):
    """Bake every (high, low) pair into one shared atlas. Lows must already be unwrapped and packed together.
    Returns the game material (colour, normal, roughness + metalness in one texture).
    ASSET_FAST=1 in the environment bakes small and quick (for iterating on shapes; never commit a fast build)."""
    if os.environ.get('ASSET_FAST'):
        size, ao_samples = min(size, 1024), 4
    img = {
        'color': new_image(prefix + '_color', size),
        'normal': new_image(prefix + '_normal', size, non_color=True, color=(0.5, 0.5, 1.0, 1.0)),
        'rough': new_image(prefix + '_rough', size, non_color=True, color=(0.6, 0.6, 0.6, 1.0)),
        'metal': new_image(prefix + '_metal', size, non_color=True, color=(0, 0, 0, 1)),
        'ao': new_image(prefix + '_ao', size, non_color=True, color=(1, 1, 1, 1)),
    }
    # pairs are baked one at a time; move them apart so AO rays never reach a neighbour
    for k, (hi, lo) in enumerate(pairs):
        hi.location = lo.location = Vector((k * 6.0, 0, 0))
    bpy.context.view_layer.update()
    for hi, lo in pairs:
        bake_target_material(lo, img['color'])
        lo.visible_shadow = False; lo.visible_diffuse = False; lo.visible_glossy = False
        bpy.context.scene.cycles.samples = 1
        bake_base_color(hi, lo, img['color'], extrusion)
        for kind, key, samples in (('NORMAL', 'normal', 1), ('ROUGHNESS', 'rough', 1), ('AO', 'ao', ao_samples)):
            bake(hi, lo, kind, img[key], extrusion=extrusion, samples=samples)
        if metal:
            bpy.context.scene.cycles.samples = 1
            bake_metal(hi, lo, img['metal'], extrusion)
    for hi, lo in pairs:
        lo.location = (0, 0, 0)
        lo.visible_shadow = True; lo.visible_diffuse = True; lo.visible_glossy = True
    multiply_ao(img['color'], img['ao'], ao_strength)
    # glTF packs roughness in G and metalness in B of one texture
    r = image_pixels(img['rough']); m = image_pixels(img['metal'])
    r[..., 2] = m[..., 0]
    r[..., 0] = 1.0
    set_image_pixels(img['rough'], r)
    mat = bpy.data.materials.new(prefix)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = img['color']
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = img['normal']
    tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = img['rough']
    nm = nt.nodes.new('ShaderNodeNormalMap')
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(tr.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    for k in ('color', 'normal', 'rough'):
        save_image(img[k], f'{BUILD_DIR}/{prefix}_{k}.png')
        img[k].pack()
    return mat


def finish_family(lows, mat, lod_ratio=0.5, lod_min=200):
    """Give every low mesh the baked material and make a `_lod1` copy for phones. Returns (objects, report)."""
    out, report = [], []
    for lo in lows:
        lo.data.materials.clear(); lo.data.materials.append(mat)
        lod = duplicate(lo, lo.name + '_lod1')
        t = triangle_count(lo)
        decimate_to(lod, max(lod_min, int(t * lod_ratio)))
        out += [lo, lod]
        report.append(f'{lo.name}: {t} / {triangle_count(lod)} tris')
    return out, report


def preview(objs, path, eye=(0.6, -0.9, 0.35), target=(0, 0, 0), lens=50, size=640):
    """Quick Workbench render of some objects to a PNG (for checking a generator without opening Blender)."""
    scene = bpy.context.scene
    old = scene.render.engine
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x = scene.render.resolution_y = size
    cam_data = bpy.data.cameras.new('preview'); cam_data.lens = lens
    cam = bpy.data.objects.new('preview', cam_data)
    scene.collection.objects.link(cam)
    cam.location = Vector(eye)
    cam.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    hidden = [o for o in scene.objects if o.type == 'MESH' and o not in objs]
    for o in hidden:
        o.hide_render = True
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in hidden:
        o.hide_render = False
    bpy.data.objects.remove(cam, do_unlink=True)
    scene.render.engine = old


# ---------------------------------------------------------------- modelling helpers (viewmodel art redo)
def catmull(pts, per=6, closed=False):
    """Smooth curve through GAME-space control points (Catmull-Rom). per = samples per span."""
    P = [Vector(p) for p in pts]
    n = len(P)
    out = []
    spans = n if closed else n - 1
    for i in range(spans):
        p0 = P[(i - 1) % n] if closed or i > 0 else P[0] * 2 - P[1]
        p1, p2 = P[i % n], P[(i + 1) % n]
        p3 = P[(i + 2) % n] if closed or i + 2 < n else P[-1] * 2 - P[-2]
        for k in range(per):
            t = k / per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(P[-1])
    return [tuple(p) for p in out]


def extrude_profile(name, pts_zy, x0, x1, smooth=None):
    """A flat part from a side profile: closed polygon of (z, y) GAME points, extruded across x from x0 to x1.
    smooth=k resamples the outline with a Catmull-Rom curve (k samples per corner) for rounded outlines."""
    if smooth:
        pts_zy = [(p[0], p[1]) for p in catmull([(z, y, 0) for z, y in pts_zy], per=smooth, closed=True)]
    bm = bmesh.new()
    a = [bm.verts.new(G(x0, y, z)) for z, y in pts_zy]
    b = [bm.verts.new(G(x1, y, z)) for z, y in pts_zy]
    n = len(a)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm)


def extrude_profile_xy(name, pts_xy, z0, z1):
    """Like extrude_profile but the outline is in the x-y plane (seen from the player) and extruded along z."""
    bm = bmesh.new()
    a = [bm.verts.new(G(x, y, z0)) for x, y in pts_xy]
    b = [bm.verts.new(G(x, y, z1)) for x, y in pts_xy]
    n = len(a)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm)


def lathe(name, prof, center=(0, 0), axis='z', n=32, cap_start=True, cap_end=True):
    """Revolve a profile [(along, radius)] around a GAME axis through `center` (the other two coordinates)."""
    secs = []
    for t, r in prof:
        if axis == 'z':
            secs.append(ring((center[0], center[1], t), r, r, n=n))
        elif axis == 'y':
            secs.append(ring((center[0], t, center[1]), r, r, n=n, axis='y'))
        else:
            secs.append(ring((t, center[0], center[1]), r, r, n=n, axis='x'))
    return loft(name, secs, cap_start=cap_start, cap_end=cap_end)


def boolean(ob, cutter, op='DIFFERENCE', keep=False):
    m = ob.modifiers.new('bool', 'BOOLEAN'); m.operation = op; m.object = cutter; m.solver = 'EXACT'
    cutter.hide_render = True
    apply_modifiers(ob)
    if not keep:
        bpy.data.objects.remove(cutter, do_unlink=True)
    return ob


def cylinder(name, a, b, r, n=24):
    """A capped cylinder between two GAME points."""
    A, B = Vector(a), Vector(b)
    d = (B - A).normalized()
    up = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(up).normalized(); v = d.cross(u).normalized()
    secs = []
    for c in (A, B):
        secs.append([G(*(c + u * (r * math.cos(2 * math.pi * i / n)) + v * (r * math.sin(2 * math.pi * i / n)))) for i in range(n)])
    return loft(name, secs)


def bevel_low(ob, width=0.001, angle=40, segments=1):
    """A small chamfer on the game mesh's sharp edges: catches light like a real machined edge."""
    add_modifier(ob, 'BEVEL', width=width, segments=segments, limit_method='ANGLE', angle_limit=math.radians(angle),
                 harden_normals=True)
    apply_modifiers(ob)


def set_material_by(ob, mats, pick):
    """Several materials on one mesh: pick(face_center_GAME, normal_GAME) -> index into mats."""
    ob.data.materials.clear()
    for m, _ in mats:
        ob.data.materials.append(m)
    for p in ob.data.polygons:
        c = p.center; nn = p.normal
        p.material_index = pick((c.x, c.z, -c.y), (nn.x, nn.z, -nn.y))
    # keep the metal-mask bookkeeping of the first material (each material carries its own)
    for m, metal in mats:
        m['_metal_node'] = metal.node.name
        m['_metal_out'] = list(metal.node.outputs).index(metal)
    return ob


def render_preview(objs, path, eye, target, lens=50, size=900, bg=0.035, key=40.0, engine='CYCLES', samples=48):
    """A lit render of the finished (baked) game meshes, to compare with the references without opening Blender."""
    scene = bpy.context.scene
    old = scene.render.engine
    scene.render.engine = engine
    scene.cycles.samples = samples
    scene.render.resolution_x = size; scene.render.resolution_y = int(size * 0.75)
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('pv') if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    wn = world.node_tree.nodes
    bgn = next(n for n in wn if n.type == 'BACKGROUND')
    # the camera sees a dark backdrop; reflections see a soft grey room (metal is black with nothing to reflect)
    sky = wn.new('ShaderNodeTexGradient'); sky.gradient_type = 'LINEAR'
    tc = wn.new('ShaderNodeTexCoord'); mp = wn.new('ShaderNodeMapping'); mp.inputs['Rotation'].default_value = (0, math.radians(-90), 0)
    world.node_tree.links.new(tc.outputs['Generated'], mp.inputs['Vector']); world.node_tree.links.new(mp.outputs['Vector'], sky.inputs['Vector'])
    ramp = wn.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = (0.03, 0.03, 0.03, 1); ramp.color_ramp.elements[1].color = (0.35, 0.35, 0.36, 1)
    world.node_tree.links.new(sky.outputs['Fac'], ramp.inputs['Fac'])
    lp = wn.new('ShaderNodeLightPath'); mx = wn.new('ShaderNodeMix'); mx.data_type = 'RGBA'
    world.node_tree.links.new(lp.outputs['Is Camera Ray'], mx.inputs['Factor'])
    world.node_tree.links.new(ramp.outputs['Color'], mx.inputs[6]); mx.inputs[7].default_value = (bg, bg, bg, 1)
    world.node_tree.links.new(mx.outputs[2], bgn.inputs['Color'])
    bgn.inputs['Strength'].default_value = 1.0
    cam_data = bpy.data.cameras.new('pv'); cam_data.lens = lens; cam_data.clip_start = 0.01
    cam = bpy.data.objects.new('pv', cam_data)
    scene.collection.objects.link(cam)
    cam.location = Vector(eye)
    cam.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    lights = []
    for loc, power, sz in (((eye[0] + 0.6, eye[1] - 0.4, eye[2] + 1.0), key, 0.6), ((-1.2, 0.8, 0.4), key * 0.35, 1.2), ((0.0, 1.5, -0.6), key * 0.25, 1.0)):
        ld = bpy.data.lights.new('pvl', 'AREA'); ld.energy = power; ld.size = sz
        lo = bpy.data.objects.new('pvl', ld); scene.collection.objects.link(lo)
        lo.location = Vector(loc)
        lo.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        lights.append(lo)
    hidden = [o for o in scene.objects if o.type == 'MESH' and o not in objs]
    for o in hidden:
        o.hide_render = True
    scene.render.filepath = path
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    for o in hidden:
        o.hide_render = False
    for o in lights + [cam]:
        bpy.data.objects.remove(o, do_unlink=True)
    scene.render.engine = old
