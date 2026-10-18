import bpy, bmesh, json, math, sys, random
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
OUT = sys.argv[sys.argv.index('--') + 1]; NPLACES = int(sys.argv[sys.argv.index('--') + 2])
T = json.load(open('tree.json')); P = [Vector(p) for p in T['nodes']]; par = T['parent']; birth = T['birth']; slots = T['slots']
step = birth[slots[NPLACES - 1]] + 3 if NPLACES else 8
alive = [b <= step for b in birth]
kids = [[] for _ in P]
for i, p in enumerate(par):
    if p >= 0 and alive[i]: kids[p].append(i)
r = [0.0] * len(P)
for i in range(len(P) - 1, -1, -1):
    if not alive[i]: continue
    r[i] = (sum(r[k] ** 2.2 for k in kids[i])) ** (1 / 2.2) if kids[i] else 0.012
age = lambda i: step - birth[i]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 40
try: sc.cycles.use_denoising = True
except Exception: pass
sc.render.resolution_x, sc.render.resolution_y = 720, 900
sc.render.film_transparent = True
sc.view_settings.view_transform = 'AgX'
# 树干：节点 + 父子连线，用 Skin 修改器长出圆滑的枝干
idx = [i for i in range(len(P)) if alive[i]]; remap = {o: n for n, o in enumerate(idx)}
me = bpy.data.meshes.new('tree'); bm = bmesh.new()
vs = [bm.verts.new(P[i]) for i in idx]; bm.verts.ensure_lookup_table()
for i in idx:
    if par[i] >= 0: bm.edges.new((vs[remap[i]], vs[remap[par[i]]]))
bm.to_mesh(me); bm.free()
ob = bpy.data.objects.new('tree', me); sc.collection.objects.link(ob)
sk = ob.modifiers.new('skin', 'SKIN'); sk.use_smooth_shade = True
for n, i in enumerate(idx):
    rad = max(0.01, r[i] * 0.8 + (0.05 if r[i] > 0.15 else 0)) * (1 + 0.9 * max(0, 1 - P[i].z / 0.5) ** 2)
    me.skin_vertices[0].data[n].radius = (rad, rad)
me.skin_vertices[0].data[0].use_root = True
ob.modifiers.new('sub', 'SUBSURF').levels = 1
bark = bpy.data.materials.new('bark'); bark.use_nodes = True; nt = bark.node_tree; b = nt.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (0.13, 0.085, 0.055, 1); b.inputs['Roughness'].default_value = 0.85
noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 60; bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.4
nt.links.new(noise.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
ob.data.materials.append(bark)
# 叶子：长在较新的细枝上（外层树冠），每处几片
rnd = random.Random(7)
lm = bpy.data.meshes.new('leaves'); bm = bmesh.new(); uv = bm.loops.layers.uv.new()
for i in idx:
    if r[i] > 0.07 or age(i) > 70 or P[i].z < 1.2: continue
    for k in range(12):
        c = P[i] + Vector((rnd.uniform(-.22, .22), rnd.uniform(-.22, .22), rnd.uniform(-.16, .1)))
        s = rnd.uniform(0.07, 0.11)
        a = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-.3, .5))).normalized()
        n_ = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).cross(a).normalized()
        q = [c - n_ * s * .25, c + n_ * s * .25, c + n_ * s * .25 + a * s, c - n_ * s * .25 + a * s]
        f = bm.faces.new([bm.verts.new(v) for v in q])
        for loop, (u, v) in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]): loop[uv].uv = (u, v)
bm.to_mesh(lm); bm.free()
lo = bpy.data.objects.new('leaves', lm); sc.collection.objects.link(lo)
leaf = bpy.data.materials.new('leaf'); leaf.use_nodes = True; nt = leaf.node_tree; b = nt.nodes['Principled BSDF']
img = nt.nodes.new('ShaderNodeTexImage'); img.image = bpy.data.images.load(bpy.path.abspath('//leaf_alpha.png') if bpy.data.filepath else __import__('os').path.abspath('leaf_alpha.png'))
nt.links.new(img.outputs['Alpha'], b.inputs['Alpha'])
oi = nt.nodes.new('ShaderNodeObjectInfo'); ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.03, 0.11, 0.025, 1); ramp.color_ramp.elements[1].color = (0.30, 0.52, 0.10, 1)
geo = nt.nodes.new('ShaderNodeNewGeometry'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
nt.links.new(geo.outputs['Position'], sep.inputs['Vector']); mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 3; mr.inputs['From Max'].default_value = 9.5
nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 1.6
mix = nt.nodes.new('ShaderNodeMath'); mix.operation = 'MULTIPLY_ADD'; mix.inputs[1].default_value = 0.55
nt.links.new(nz.outputs['Fac'], mix.inputs[0]); nt.links.new(mr.outputs['Result'], mix.inputs[2]); nt.links.new(mix.outputs['Value'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
b.inputs['Roughness'].default_value = 0.6
try: b.inputs['Subsurface Weight'].default_value = 0.15
except Exception: pass
lo.data.materials.append(leaf)
# 地面：中间亮、向外融进背景
bpy.ops.mesh.primitive_plane_add(size=600); gp = bpy.context.object
gm = bpy.data.materials.new('ground'); gm.use_nodes = True; nt = gm.node_tree; b = nt.nodes['Principled BSDF']
gr = nt.nodes.new('ShaderNodeTexGradient'); gr.gradient_type = 'SPHERICAL'; mp = nt.nodes.new('ShaderNodeMapping'); tc = nt.nodes.new('ShaderNodeTexCoord')
mp.inputs['Scale'].default_value = (1 / 6, 1 / 6, 1); nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], gr.inputs['Vector'])
cr = nt.nodes.new('ShaderNodeValToRGB'); cr.color_ramp.elements[0].color = (0.035, 0.16, 0.26, 1); cr.color_ramp.elements[1].color = (0.9, 0.93, 0.95, 1)
cr.color_ramp.elements[1].position = 0.75
nt.links.new(gr.outputs['Fac'], cr.inputs['Fac']); nt.links.new(cr.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 1
gp.data.materials.append(gm); gp.is_shadow_catcher = True
# 环境：蓝色天空（参照视频 1 的底色）
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.09, 0.3, 0.46, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 1.1
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.4; sun.data.angle = 0.5; sc.collection.objects.link(sun); sun.rotation_euler = (0.42, 0.2, 0.7)
# 相机：按当前树的大小取景
hs = [P[i].z for i in idx]; height = max(1.0, max(hs)); xs = [abs(P[i].x) for i in idx]; half = max(0.6, max(xs))
size = max(height * 1.08, half * 2.3)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 50
dist = size * 2.05
cam.location = (0, -dist, height * 0.32)
tgt = bpy.data.objects.new('t', None); sc.collection.objects.link(tgt); tgt.location = (0, 0, height * 0.47)
c = cam.constraints.new('TRACK_TO'); c.target = tgt; c.track_axis = 'TRACK_NEGATIVE_Z'; c.up_axis = 'UP_Y'
bpy.context.view_layer.update()
sc.render.filepath = __import__('os').path.abspath(OUT + '.png')
bpy.ops.render.render(write_still=True)
# 导出果子在画面上的位置（挂在节点下方一点）
pos = []
for k in range(NPLACES):
    p = P[slots[k]] + Vector((0, 0, -0.08))
    v = world_to_camera_view(sc, cam, p)
    pos.append([round(v.x, 4), round(1 - v.y, 4), round(v.z, 3)])
b0 = world_to_camera_view(sc, cam, Vector((0, 0, 0)))
json.dump({'n': NPLACES, 'base': [b0.x, 1 - b0.y], 'fruits': pos}, open(OUT + '.json', 'w'))
print('done', OUT, 'step', step, 'height', round(height, 2))
