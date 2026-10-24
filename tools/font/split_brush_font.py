"""把马善政毛笔体（约 3.2MB，7000 字）拆成按需下载的小字体包，生成 css/fonts/ 与 css/brush-font.css。

为什么要拆：github.io 在国内下载慢，整个字体要几分钟才能下完，期间标题一直是默认字体。
拆分后：
- 核心包（地名用字 + 页面标题用字 + 数字字母标点）页面打开时先下载，一般只有一两百 KB；
- 其余的字按编码顺序切成若干小包，浏览器只在页面上真的出现这些字时（例如自定义框的名称）才下载对应的包
  （CSS 的 unicode-range 机制）。

用法（需要 pip install fonttools brotli）：
    python3 tools/font/split_brush_font.py tools/font/MaShanZheng-Regular.woff2
原字体放在 tools/font/ 里，网页不再直接加载它。地名用字见 core-place-chars.txt（从地图素材的地名中提取，不含编号对应关系）。
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'css', 'fonts')
FAMILY = 'MaShanZheng'
CHUNK = 300  # 其余字每包的字数

# 页面上用毛笔字显示的固定文字
UI_TEXT = '旅行相册全部区域地图时间线旅行树未点亮已点亮省市州'


def ranges(codes):
    """码位列表 → unicode-range 文本（连续的合并成区间）"""
    codes = sorted(codes)
    out = []
    start = prev = codes[0]
    for c in codes[1:] + [None]:
        if c is not None and c == prev + 1:
            prev = c
            continue
        out.append(f'U+{start:X}' if start == prev else f'U+{start:X}-{prev:X}')
        if c is not None:
            start = prev = c
    return ', '.join(out)


def build(src, codes, name):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    f = TTFont(src)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=codes)
    sub.subset(f)
    path = os.path.join(OUT, name)
    f.flavor = 'woff2'
    f.save(path)
    return os.path.getsize(path)


def main(src):
    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):
        if old.startswith('brush-') and old.endswith('.woff2'):
            os.remove(os.path.join(OUT, old))
    cmap = set(TTFont(src).getBestCmap())
    place = open(os.path.join(HERE, 'core-place-chars.txt'), encoding='utf-8').read()
    core = {c for c in cmap if c < 0x3000}  # 数字、字母、标点等
    core |= {ord(ch) for ch in place + UI_TEXT if ord(ch) in cmap}
    rest = sorted(cmap - core)
    faces = []
    size = build(src, sorted(core), 'brush-core.woff2')
    faces.append(('brush-core.woff2', sorted(core)))
    print(f'core: {len(core)} 字, {size // 1024} KB')
    for i in range(0, len(rest), CHUNK):
        part = rest[i:i + CHUNK]
        name = f'brush-{i // CHUNK + 1:02d}.woff2'
        size = build(src, part, name)
        faces.append((name, part))
        print(f'{name}: {len(part)} 字, {size // 1024} KB')
    css = ['/* 由 tools/font/split_brush_font.py 生成，请勿手改。马善政毛笔体按需分包：只下载页面上用到的字。 */']
    for name, codes in faces:
        css.append(
            '@font-face {\n'
            f"  font-family: '{FAMILY}';\n"
            f"  src: url('fonts/{name}') format('woff2');\n"
            '  font-weight: 400;\n'
            '  font-style: normal;\n'
            '  font-display: swap;\n'
            f'  unicode-range: {ranges(codes)};\n'
            '}'
        )
    open(os.path.join(ROOT, 'css', 'brush-font.css'), 'w', encoding='utf-8').write('\n\n'.join(css) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
