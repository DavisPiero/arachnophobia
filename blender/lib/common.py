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


def smart_unwrap(ob, island_margin=0.02):
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=island_margin)
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
