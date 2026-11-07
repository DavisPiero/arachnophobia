"""Does any part of a hand pass through the rifle? Lays out blender/build/rifle.glb and hands.glb as the game does
(rifle space: the right arm at grips.right, the left at grips.left) and, for every hand vertex, checks whether it lies
inside a rifle part (nearest surface point's normal points away from it).

    Blender -b --factory-startup -P blender/tools/clipcheck.py

Prints, per arm and rifle part, how many vertices are inside and how deep the worst one is, and where (rifle space).
"""
import json
import os

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
P = json.load(open(os.path.join(ROOT, 'assets', 'params', 'rifle.json')))
bpy.ops.wm.read_factory_settings(use_empty=True)


def load(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'blender', 'build', name + '.glb'))
    return {o.name: o for o in bpy.data.objects if o not in before}


G = lambda x, y, z: Vector((x, -z, y))           # GAME -> Blender
rifle, hands = load('rifle'), load('hands')
arms = {'arm_grip_r': G(*P['grips']['right']), 'arm_support_l': G(*P['grips']['left'])}
dg = bpy.context.evaluated_depsgraph_get()
parts = {n: o for n, o in rifle.items() if n in ('rifle_body', 'rifle_lever', 'rifle_hammer')}
trees = {}
for n, o in parts.items():
    o.parent = None
    trees[n] = BVHTree.FromObject(o, dg)
bad = 0
for an, off in arms.items():
    a = hands[an]
    a.parent = None
    mw = a.matrix_world
    for pn, tree in trees.items():
        n_in, worst, where = 0, 0.0, None
        for v in a.data.vertices:
            p = mw @ v.co + off
            hit = tree.find_nearest(p, 0.05)
            if hit[0] is None:
                continue
            loc, nrm, _, dist = hit
            # the lever is a swept bar whose faces may point inwards: count only real contact for it
            inside = dist < 0.0015 if pn == 'rifle_lever' else (p - loc).dot(nrm) < -0.0006
            if inside:
                n_in += 1
                if dist > worst:
                    worst, where = dist, p
        if n_in:
            bad += n_in
            g = (where.x, where.z, -where.y)
            print(f'[clip] {an} inside {pn}: {n_in} vertices, deepest {worst * 1000:.1f} mm at rifle ({g[0]:.3f}, {g[1]:.3f}, {g[2]:.3f})')
print(f'[clip] total vertices inside: {bad}')
