# 合成：蓝色渐变背景 + 树下一团柔和的白光（参照视频 1），再叠上渲染出的树和影子
import sys, json
from PIL import Image, ImageDraw, ImageFilter
name = sys.argv[1]
tree = Image.open(name + '.png').convert('RGBA'); w, h = tree.size; meta = json.load(open(name + '.json'))
bg = Image.new('RGB', (w, h)); px = bg.load()
for y in range(h):
    t = y / h
    c = (int(46 + 10 * t), int(118 + 12 * t), int(160 + 8 * t))
    for x in range(w): px[x, y] = c
bx, by = meta['base'][0] * w, meta['base'][1] * h
glow = Image.new('L', (w, h), 0); d = ImageDraw.Draw(glow)
d.ellipse([bx - w * 0.42, by - h * 0.035, bx + w * 0.42, by + h * 0.05], fill=235)
glow = glow.filter(ImageFilter.GaussianBlur(w * 0.06))
bg = Image.composite(Image.new('RGB', (w, h), (236, 242, 246)), bg, glow).convert('RGBA')
bg.alpha_composite(tree)
bg.convert('RGB').save(name + '-final.png')
