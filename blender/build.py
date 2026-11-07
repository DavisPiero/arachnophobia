"""Entry point for the asset pipeline. Run through `npm run assets` (tools/assets.mjs), which calls:

    Blender -b --factory-startup -P blender/build.py -- [names...]

With no names it builds every generator in blender/generators/. A hand-made file in blender/source/<name>.glb
(exported by you from Blender) replaces the generated one: tools/assets.mjs picks it up instead.
"""
import importlib
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from lib import common as C  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
names = argv or sorted(f[:-3] for f in os.listdir(os.path.join(HERE, 'generators')) if f.endswith('.py') and not f.startswith('_'))

failed = False
for name in names:
    t0 = time.time()
    try:
        mod = importlib.import_module('generators.' + name)
        report = mod.build(C.load_params(name)) or []
        print(f'[assets] {name}: built in {time.time() - t0:.1f}s')
        for line in report:
            print(f'[assets]   {line}')
    except Exception:
        failed = True
        print(f'[assets] {name}: FAILED')
        traceback.print_exc()

sys.exit(1 if failed else 0)
