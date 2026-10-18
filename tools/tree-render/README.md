# 旅行树渲染小样（实验，未接入网页）

用 Blender 按“空间殖民”算法生成一棵会长大的 3D 树，渲染不同生长阶段的图片，并导出每张图上挂果子的位置。

```bash
python3 -m venv bl && ./bl/bin/pip install bpy==5.2.2   # Blender 作为 Python 模块，约 1～2 分钟
./bl/bin/python grow.py                 # 生成树的生长结构 tree.json
./bl/bin/python render.py -- stage-30 30   # 渲染“去过 30 个地方”时的树：stage-30.png + stage-30.json（果子位置）
python3 comp.py stage-30                # 合成蓝色背景与地面光
python3 fruit.py stage-30               # 演示：叠上果子
```
