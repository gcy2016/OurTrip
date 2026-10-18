# 3D 空间殖民生长：根在原点，树冠是根上方的椭球；诱饵按离“树冠起点”的远近逐步激活，树从小苗长成大树。
# 节点一旦长出就不再移动；输出节点表（位置、父节点、出生步）与挂果位置（按出生先后）。
import numpy as np, json, sys
rng = np.random.default_rng(20261018)
CROWN_C = np.array([0, 0, 5.3]); CROWN_R = np.array([3.9, 3.9, 3.6])
START = np.array([0, 0, 1.7])
STEP, INFL, KILL = 0.12, 1.25, 0.32
pts = []
while len(pts) < 2600:
    p = (rng.random(3) * 2 - 1) * CROWN_R + CROWN_C
    if (((p - CROWN_C) / CROWN_R) ** 2).sum() > 1 or p[2] < 1.5: continue
    pts.append(p)
A = np.array(pts)
d = A - START; act = np.sqrt(d[:, 0] ** 2 + d[:, 1] ** 2 + (d[:, 2] * 0.85) ** 2) * (1 + rng.random(len(A)) * 0.15)
alive = np.ones(len(A), bool)
nodes = [np.array([0., 0, 0])]; parent = [-1]; birth = [0]
reach = lambda s: 0.3 + s * 0.045
started = False
for s in range(1, 420):
    N = np.array(nodes)
    m = alive & (act <= reach(s))
    idx = np.where(m)[0]
    pulls = {}
    if len(idx):
        P = A[idx]
        D = np.linalg.norm(P[:, None, :] - N[None, :, :], axis=2)
        near = D.argmin(1); dist = D[np.arange(len(idx)), near]
        ok = dist < INFL
        for a, n, dd in zip(idx[ok], near[ok], dist[ok]):
            v = (A[a] - N[n]) / dd
            pulls[n] = pulls.get(n, 0) + v
    if pulls: started = True
    if not pulls:
        if started: continue
        top = int(np.argmax(N[:, 2]))
        nodes.append(N[top] + np.array([rng.normal() * 0.01, rng.normal() * 0.01, STEP])); parent.append(top); birth.append(s)
    else:
        for n in sorted(pulls):
            v = pulls[n]; v = v / np.linalg.norm(v); v = v + np.array([0, 0, 0.18]); v /= np.linalg.norm(v)
            nodes.append(N[n] + v * STEP); parent.append(int(n)); birth.append(s)
    N = np.array(nodes)
    if len(idx):
        P = A[idx]
        D = np.linalg.norm(P[:, None, :] - N[None, :, :], axis=2).min(1)
        alive[idx[D < KILL]] = False
N = np.array(nodes)
# 挂果位置：按出生先后，离已有果子至少 0.38，高于 3m
slots = []
for i in range(len(N)):
    if N[i, 2] < 2.0: continue
    if slots and np.min(np.linalg.norm(N[slots] - N[i], axis=1)) < 0.38: continue
    slots.append(i)
json.dump({'nodes': N.round(4).tolist(), 'parent': parent, 'birth': birth, 'slots': slots}, open('tree.json', 'w'))
print('nodes', len(N), 'slots', len(slots), 'steps', max(birth))
