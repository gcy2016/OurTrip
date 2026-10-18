# 演示：把果子叠到渲染图上（网页里由程序叠加，这里只是看效果）
import sys, json, random
from PIL import Image, ImageDraw, ImageFilter
name = sys.argv[1]
im = Image.open(name + '-final.png').convert('RGBA'); w, h = im.size; meta = json.load(open(name + '.json'))
PROV = [(244,114,182),(250,204,21),(52,211,153),(167,139,250),(251,146,60),(56,189,248),(248,113,113)]
rnd = random.Random(3)
glow = Image.new('RGBA', (w, h), (0,0,0,0)); g = ImageDraw.Draw(glow)
dots = Image.new('RGBA', (w, h), (0,0,0,0)); d = ImageDraw.Draw(dots)
R = max(4, min(9, int(w * 0.011)))
for x, y, z in meta['fruits']:
    c = PROV[rnd.randrange(len(PROV))]; X, Y = x * w, y * h
    g.ellipse([X - R*2.4, Y - R*2.4, X + R*2.4, Y + R*2.4], fill=c + (120,))
    d.ellipse([X - R, Y - R, X + R, Y + R], fill=c + (255,), outline=(255,255,255,235), width=2)
    d.ellipse([X - R*0.55, Y - R*0.6, X - R*0.05, Y - R*0.1], fill=(255,255,255,170))
im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(R * 1.2))); im.alpha_composite(dots)
im.convert('RGB').save(name + '-fruit.png')
