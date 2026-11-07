"""Rock family generator.

Parameters: assets/params/rocks.json. Output: rocks.glb with meshes rock_0 .. rock_N (game detail)
and rock_0_lod1 .. (phone / far detail), all sharing one baked texture atlas.

Shape of one rock (unit size, about 1 m radius before the game scales it):
  lumpy sphere (fractal noise) -> squashed (flatness) and stretched (elongation)
  -> flat fracture faces (planar cuts) -> flat bottom that sinks into the ground.
The HIGH mesh adds fine surface detail and cracks; the LOW mesh does not, it gets them from the baked normal map.
"""
import math

import bmesh
import bpy
from mathutils import Vector, noise

from lib import common as C


def shape_fn(P, r):
    S = P['shape']
    seed = Vector((r.uniform(-50, 50), r.uniform(-50, 50), r.uniform(-50, 50)))
    flat = r.uniform(*S['flatness'])
    elong = r.uniform(*S['elongation'])
    cuts = []
    for _ in range(r.randint(*S['fractures'])):
        n = Vector((r.uniform(-1, 1), r.uniform(-0.6, 1.0), r.uniform(-1, 1))).normalized()
        cuts.append((n, r.uniform(*S['fractureDepth'])))

    def base(v):
        d = v.normalized()
        rad = 1.0 + S['irregularity'] * C.fbm(d * S['lumpScale'] + seed, 4)
        p = d * rad
        p = Vector((p.x * elong, p.y * flat, p.z / max(0.6, elong ** 0.5)))
        for n, depth in cuts:
            k = p.dot(n) - depth
            if k > 0:
                p -= n * k
        return p
    return base, seed


def detail_fn(P, seed):
    D = P['surface']

    def detail(p):
        n = p.normalized()
        h = D['detail'] * C.fbm(p * D['detailScale'] + seed * 0.37, 5)
        # cracks: thin grooves where two Voronoi cells meet
        dist, _ = noise.voronoi(p * D['crackScale'] + seed, distance_metric='DISTANCE')
        edge = dist[1] - dist[0]
        h -= D['cracks'] * max(0.0, 1.0 - edge / 0.08)
        return p + n * h
    return detail


def build_mesh(name, subdiv, f, bottom):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        p = f(v.co.copy())
        p.y = max(p.y, bottom)
        v.co = p
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_object(name, bm)
    C.select_only(ob)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))   # fracture faces keep a hard edge
    return ob


def sock(sockets, name, kind):
    """Mix nodes have several sockets with the same name (one per data type); pick the right one."""
    return next(x for x in sockets if x.name == name and x.type == kind)


def rock_shader(ob, P):
    """Procedural stone: two-tone grain, darker cracks, moss and wet sheen on top-facing surfaces."""
    L = P['look']
    mat = bpy.data.materials.new(ob.name + '_src')
    mat.use_nodes = True
    nt = mat.node_tree
    N, link = nt.nodes, nt.links.new
    bsdf = next(n for n in N if n.type == 'BSDF_PRINCIPLED')
    tco = N.new('ShaderNodeTexCoord')
    grain = N.new('ShaderNodeTexNoise'); grain.inputs['Scale'].default_value = 4.5; grain.inputs['Detail'].default_value = 10; grain.inputs['Roughness'].default_value = 0.62
    speck = N.new('ShaderNodeTexNoise'); speck.inputs['Scale'].default_value = 60; speck.inputs['Detail'].default_value = 2
    link(tco.outputs['Object'], grain.inputs['Vector']); link(tco.outputs['Object'], speck.inputs['Vector'])
    ramp = N.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[0].color = (*L['stone'][0], 1)
    ramp.color_ramp.elements[1].position = 0.68; ramp.color_ramp.elements[1].color = (*L['stone'][1], 1)
    link(grain.outputs['Fac'], ramp.inputs['Fac'])
    # speckle: tiny light and dark mineral grains
    sp = N.new('ShaderNodeMix'); sp.data_type = 'RGBA'; sp.blend_type = 'OVERLAY'; sp.inputs['Factor'].default_value = 0.35
    link(ramp.outputs['Color'], sock(sp.inputs, 'A', 'RGBA')); link(speck.outputs['Color'], sock(sp.inputs, 'B', 'RGBA'))
    # moss mask: up-facing * patchy noise
    geo = N.new('ShaderNodeNewGeometry')
    sep = N.new('ShaderNodeSeparateXYZ'); link(geo.outputs['Normal'], sep.inputs['Vector'])
    up = N.new('ShaderNodeMapRange'); up.inputs['From Min'].default_value = 0.35; up.inputs['From Max'].default_value = 0.9
    link(sep.outputs['Z'], up.inputs['Value'])
    patch = N.new('ShaderNodeTexNoise'); patch.inputs['Scale'].default_value = 2.2; patch.inputs['Detail'].default_value = 6
    link(tco.outputs['Object'], patch.inputs['Vector'])
    pr = N.new('ShaderNodeMapRange'); pr.inputs['From Min'].default_value = 0.45; pr.inputs['From Max'].default_value = 0.6
    link(patch.outputs['Fac'], pr.inputs['Value'])
    mm = N.new('ShaderNodeMath'); mm.operation = 'MULTIPLY'
    link(up.outputs['Result'], mm.inputs[0]); link(pr.outputs['Result'], mm.inputs[1])
    ma = N.new('ShaderNodeMath'); ma.operation = 'MULTIPLY'; ma.inputs[1].default_value = L['mossAmount']
    link(mm.outputs['Value'], ma.inputs[0])
    moss = N.new('ShaderNodeMix'); moss.data_type = 'RGBA'
    sock(moss.inputs, 'B', 'RGBA').default_value = (*L['moss'], 1)
    link(ma.outputs['Value'], moss.inputs['Factor']); link(sock(sp.outputs, 'Result', 'RGBA'), sock(moss.inputs, 'A', 'RGBA'))
    # cavities darker, ridges lighter (worn edges): Cycles 'pointiness' measures how convex the surface is
    cav = N.new('ShaderNodeMapRange'); cav.inputs['From Min'].default_value = 0.44; cav.inputs['From Max'].default_value = 0.56
    cav.inputs['To Min'].default_value = 0.45; cav.inputs['To Max'].default_value = 1.35
    link(geo.outputs['Pointiness'], cav.inputs['Value'])
    shade = N.new('ShaderNodeMix'); shade.data_type = 'RGBA'; shade.blend_type = 'MULTIPLY'; shade.inputs['Factor'].default_value = 1.0
    link(sock(moss.outputs, 'Result', 'RGBA'), sock(shade.inputs, 'A', 'RGBA')); link(cav.outputs['Result'], sock(shade.inputs, 'B', 'RGBA'))
    link(sock(shade.outputs, 'Result', 'RGBA'), bsdf.inputs['Base Color'])
    # roughness: wet stone on top is glossier, moss is matte
    rough = N.new('ShaderNodeMapRange')
    rough.inputs['From Min'].default_value = 0.0; rough.inputs['From Max'].default_value = 1.0
    rough.inputs['To Min'].default_value = 0.88; rough.inputs['To Max'].default_value = 0.88 - 0.5 * L['wetness']
    link(up.outputs['Result'], rough.inputs['Value'])
    rm = N.new('ShaderNodeMix'); rm.data_type = 'FLOAT'; sock(rm.inputs, 'B', 'VALUE').default_value = 0.97
    link(ma.outputs['Value'], rm.inputs['Factor']); link(rough.outputs['Result'], sock(rm.inputs, 'A', 'VALUE'))
    link(sock(rm.outputs, 'Result', 'VALUE'), bsdf.inputs['Roughness'])
    ob.data.materials.append(mat)


def build(P):
    C.reset_scene()
    r = C.rng(P['seed'])
    B = P['budget']
    n = P['variants']
    size = B['texture']
    img = {
        'color': C.new_image('rocks_color', size),
        'normal': C.new_image('rocks_normal', size, non_color=True, color=(0.5, 0.5, 1.0, 1.0)),
        'rough': C.new_image('rocks_rough', size, non_color=True, color=(0.9, 0.9, 0.9, 1.0)),
        'ao': C.new_image('rocks_ao', size, non_color=True, color=(1, 1, 1, 1)),
    }
    lows, highs, report = [], [], []
    for i in range(n):
        base, seed = shape_fn(P, r)
        detail = detail_fn(P, seed)
        bottom = P['shape']['bottom']
        offset = Vector((i * 25.0, 0, 0))  # far apart: all rocks exist while baking, AO rays must not reach a neighbour
        high = build_mesh(f'rock_{i}_high', 6, lambda v, d=detail, b=base: d(b(v)), bottom)
        low = build_mesh(f'rock_{i}', 4, base, bottom)
        high.location = low.location = offset
        C.decimate_to(low, B['high'])
        C.smart_unwrap(low, angle=P.get('uv', {}).get('angleLimit', 80))
        rock_shader(high, P)
        lows.append(low); highs.append(high)
    # One shared atlas: every rock's islands packed together at the same texel density (no wasted grid cells).
    C.pack_atlas(lows, margin=P.get('uv', {}).get('margin', 0.004))
    for low, high in zip(lows, highs):
        C.bake_target_material(low, img['color'])
        # the low mesh must not block rays while baking ambient occlusion from the high one
        low.visible_shadow = False; low.visible_diffuse = False; low.visible_glossy = False
        for kind, key, samples in (('COLOR', 'color', 1), ('NORMAL', 'normal', 1), ('ROUGHNESS', 'rough', 1), ('AO', 'ao', 24)):
            C.bake(high, low, kind, img[key], extrusion=0.08, samples=samples)
        bpy.data.objects.remove(high, do_unlink=True)
    C.multiply_ao(img['color'], img['ao'], 0.85)
    mat = C.game_material('rock', img['color'], img['normal'], img['rough'])
    lods = []
    for i, low in enumerate(lows):
        low.data.materials.clear(); low.data.materials.append(mat)
        low.location = (0, 0, 0)
        low.visible_shadow = True; low.visible_diffuse = True; low.visible_glossy = True
        lod = C.duplicate(low, f'rock_{i}_lod1')
        C.decimate_to(lod, B['low'])
        lods.append(lod)
        report.append(f'rock_{i}: {C.triangle_count(low)} / {C.triangle_count(lod)} tris')
    # pack the textures so they travel inside the .glb
    for k in ('color', 'normal', 'rough'):
        C.save_image(img[k], f'{C.BUILD_DIR}/rocks_{k}.png')   # for inspection only (git-ignored)
        img[k].pack()
    C.export_glb(lows + lods, 'rocks')
    return report
