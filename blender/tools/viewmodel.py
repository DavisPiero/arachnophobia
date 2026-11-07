"""Studio-lit render of the first-person view, laid out exactly as js/player/ViewModel.js does it.

The game is dark on purpose, which makes it hard to judge the models in game screenshots. This puts the raw exports
(blender/build/rifle.glb, hands.glb, axe.glb) where the game puts them for a pose, looks from the player's eye with the
game's field of view, and lights them evenly.

    Blender -b --factory-startup -P blender/tools/viewmodel.py -- hip|aim|axe [out.png]

Output: shots/vm_<pose>.png (shots/ is git-ignored).
"""
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
pose = argv[0] if argv else 'hip'
out = argv[1] if len(argv) > 1 else os.path.join(ROOT, 'shots', f'vm_{pose}.png')
P = json.load(open(os.path.join(ROOT, 'assets', 'params', 'rifle.json')))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.render.resolution_x, scene.render.resolution_y = (2560, 1440) if os.environ.get("VM_BIG") else (1280, 720)


def gm(R=Matrix.Identity(3), t=(0, 0, 0)):
    """GAME-space affine (3x3, translation) -> Blender world matrix."""
    Gm = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
    M = (Gm @ R @ Gm.transposed()).to_4x4()
    M.translation = Gm @ Vector(t)
    return M


def game_xform(pos, rot_xyz):
    """three.js Object3D: position + Euler XYZ rotation (radians)."""
    return gm(Euler(rot_xyz, 'XYZ').to_matrix(), pos)


def load(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'blender', 'build', name + '.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    return {o.name: o for o in new}


def place(ob, M):
    ob.parent = None
    ob.matrix_world = M


hide = []
if pose.startswith('arm_'):
    # one arm on its own with a grey stand-in for what it holds, seen from outside (eye at the end of argv: x,y,z)
    hands = load('hands')
    for n, o in hands.items():
        if n != pose:
            hide.append(o)
    eye = Vector(tuple(float(v) for v in (argv[2] if len(argv) > 2 else '0.25,0.12,0.2').split(',')))
    if pose != 'arm_load_l':
        hp = json.load(open(os.path.join(ROOT, 'assets', 'params', 'hands.json')))['poses']
        k = {'arm_grip_r': 'grip', 'arm_axe_r': 'axe', 'arm_support_l': 'support'}[pose]
        rx, ry, cy = hp[k]['rx'], hp[k]['ry'], hp[k].get('cy', 0.0)
        bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=0.3, vertices=48)
        cyl = bpy.context.active_object
        cyl.matrix_world = gm(t=(0, cy, 0)) @ Matrix.Diagonal((rx, ry, 1, 1)) @ Matrix.Rotation(math.radians(90), 4, 'X')   # axis along GAME z
    look_at = Vector((0, 0, 0))
if pose.startswith('arm_'):
    pass
elif pose in ('hip', 'aim'):
    rifle = load('rifle')
    hands = load('hands')
    a = 1.0 if pose == 'aim' else 0.0
    lerp = lambda x, y: x + (y - x) * a
    sight = P['sights']['lineY']
    H = P['view']['hip']
    root = game_xform((lerp(H['pos'][0], 0), lerp(H['pos'][1], -sight - 0.001), lerp(H['pos'][2], P['view']['aimZ'])), (lerp(H['rot'][0], 0.005), lerp(H['rot'][1], 0), 0))
    lp = Vector(P['lever']['pivot'])
    for n, o in rifle.items():
        if n.endswith('_lod1') or n in ('rifle_round', 'rifle_case'):
            hide.append(o); continue
        place(o, root)
    for n, o in hands.items():
        if n == 'arm_grip_r':
            place(o, root @ gm(t=tuple(Vector(P['grips']['right']))))
        elif n == 'arm_support_l':
            place(o, root @ gm(t=tuple(P['grips']['left'])))
        else:
            hide.append(o)
else:   # axe: the middle of the swing's wind-up
    axe = load('axe')
    hands = load('hands')
    pos, h, b = [0.3, -0.25, -0.4], Vector((0.45, 0.85, 0.15)), Vector((-0.55, 0.35, -0.75))
    z = -h.normalized(); y = -b; y = (y - z * y.dot(z)).normalized(); x = y.cross(z)
    R = Matrix((x, y, z)).transposed()
    root = gm(R, pos)
    for n, o in axe.items():
        (hide.append(o) if n.endswith('_lod1') else place(o, root))
    for n, o in hands.items():
        (place(o, root) if n == 'arm_axe_r' else hide.append(o))
for o in hide:
    o.hide_render = True

cam_data = bpy.data.cameras.new('eye')
cam_data.sensor_fit = 'VERTICAL'; cam_data.angle_y = math.radians(72 * (0.74 if pose == 'aim' else 1.0)); cam_data.clip_start = 0.01
cam = bpy.data.objects.new('eye', cam_data); scene.collection.objects.link(cam)
cam.matrix_world = Matrix.Rotation(math.radians(90), 4, 'X')   # at the origin looking down GAME -z (Blender +Y)
if os.environ.get('VM_EYE'):      # look at the laid-out pose from elsewhere: VM_EYE / VM_AT in camera space (GAME)
    eye = Vector(tuple(float(v) for v in os.environ['VM_EYE'].split(',')))
    at = Vector(tuple(float(v) for v in os.environ.get('VM_AT', '0.17,-0.17,-0.35').split(',')))
    cam_data.angle_y = math.radians(35)
    eb, ab = gm(t=tuple(eye)).translation, gm(t=tuple(at)).translation
    cam.matrix_world = Matrix.Translation(eb) @ (ab - eb).to_track_quat('-Z', 'Z').to_matrix().to_4x4()
elif pose.startswith('arm_'):
    cam_data.angle_y = math.radians(40)
    eb = gm(t=tuple(eye)).translation
    cam.matrix_world = Matrix.Translation(eb) @ (Vector((0, 0, 0)) - eb).to_track_quat('-Z', 'Z').to_matrix().to_4x4()
scene.camera = cam
world = bpy.data.worlds.new('w'); scene.world = world
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.05, 0.055, 1)
for loc, power in (((0.6, 0.6, 0.5), 25.0), ((-0.6, 0.3, 0.2), 10.0), ((0.0, -0.2, -0.8), 6.0)):
    ld = bpy.data.lights.new('l', 'AREA'); ld.energy = power; ld.size = 0.8
    lo = bpy.data.objects.new('l', ld); scene.collection.objects.link(lo)
    lo.matrix_world = gm(t=loc)
    lo.rotation_euler = (Vector((0, 0, 0)) - lo.location).to_track_quat('-Z', 'Y').to_euler()
os.makedirs(os.path.dirname(out), exist_ok=True)
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('[viewmodel] wrote', out)
