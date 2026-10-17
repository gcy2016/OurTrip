import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTreeModel, layoutTree, compareRegions, pinyinKey, TREE_DIMS } from '../../js/tree.js';
import { loadRegions } from './helpers.mjs';

const R = loadRegions();

/**
 * 构造主页数据：dates 为 { 区域编号: 日期 }（二级区域，或没有二级区域的一级区域）；
 * 一级区域的日期取下属最早日期，与 album.litDateOf 相同。
 */
function data(dates, names = {}) {
  const lit = new Set();
  for (const id of Object.keys(dates)) {
    lit.add(id);
    const r = R.byId.get(id);
    if (r.parent) lit.add(r.parent);
  }
  const litDate = (id) => {
    const r = R.byId.get(id);
    if (r.level === 2 || !r.children.length) return dates[id] || null;
    return r.children.map((c) => dates[c]).filter(Boolean).sort()[0] || null;
  };
  return { regions: R, lit, litDate, nameOf: (id) => names[id] || id };
}

const tree = (dates, names) => layoutTree(buildTreeModel(data(dates, names)));
const trunkOrder = (t) => t.segments.map((s) => s.id);
const sides = (t) => Object.fromEntries(t.branches.map((b) => [b.id, b.side]));

function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 框与名称占用的矩形（名称按 4 个字、每字 13px 估算） */
function rects(t) {
  const out = [];
  for (const b of t.boxes) {
    out.push({ id: b.id, x: b.x, y: b.y, w: b.size, h: b.size });
    const lw = 4 * 13;
    const ly = b.label.anchor === 'bottom' ? b.label.y : b.label.y - TREE_DIMS.label;
    out.push({ id: `${b.id}名称`, x: b.label.x - lw / 2, y: ly, w: lw, h: TREE_DIMS.label });
  }
  return out;
}

test('没有点亮的一级区域时没有根基', () => {
  const m = buildTreeModel(data({}));
  assert.equal(m.root, null);
  assert.equal(layoutTree(m).root, null);
});

test('首次探索最早的一级区域作为根基（不固定为某个区域）', () => {
  const t = tree({ 'A03-C01': '2022-01-01', A01: '2023-01-01', 'A04-C02': '2021-05-01' });
  assert.equal(t.root.id, 'A04');
  assert.equal(t.root.kind, 'base'); // 有二级区域：底座 + 上方一段承接自己主枝的树干
  assert.deepEqual(trunkOrder(t), ['A04', 'A03', 'A01']);
  assert.ok(t.boxes.some((b) => b.id === 'A04-C02' && b.l1 === 'A04')); // 根基的二级区域分枝保留
});

test('根基没有二级区域：根基就是它自身的区域框，不额外增加主干', () => {
  const t = tree({ A22: '2020-01-01', 'A03-C01': '2022-01-01', 'A03-C02': '2022-02-01' });
  assert.equal(t.root.id, 'A22');
  assert.equal(t.root.kind, 'box');
  assert.deepEqual(trunkOrder(t), ['A03']);
  assert.ok(!t.branches.some((b) => b.id === 'A22'));
  const rb = t.boxes.find((b) => b.id === 'A22');
  assert.ok(rb.root && rb.y > 0 && Math.abs(rb.x + rb.size / 2) < 1e-9);
  assert.ok(t.segments[0].y0 <= t.root.top); // 树干从根基框的上边长出
});

test('只有一个一级区域：只显示根基；有二级区域时保留其分枝', () => {
  const a = tree({ A01: '2024-01-01' });
  assert.equal(a.root.kind, 'box');
  assert.equal(a.segments.length, 0);
  assert.equal(a.boxes.length, 1);
  const b = tree({ 'A05-C03': '2024-01-01', 'A05-C01': '2024-02-01' });
  assert.equal(b.root.id, 'A05');
  assert.deepEqual(trunkOrder(b), ['A05']);
  assert.deepEqual(b.boxes.map((x) => x.id), ['A05-C03', 'A05-C01']);
});

test('一级区域由下向上按首次探索时间排列；每个一级区域只有一条主枝', () => {
  const t = tree({ 'A03-C01': '2020-01-01', 'A06-C02': '2021-03-01', A09: '2021-01-01', 'A05-C07': '2022-06-01', 'A06-C01': '2023-01-01' });
  assert.deepEqual(trunkOrder(t), ['A03', 'A09', 'A06', 'A05']);
  const ys = t.branches.map((b) => b.y);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
  assert.equal(new Set(t.branches.map((b) => b.id)).size, t.branches.length);
});

test('主枝左右：根基以外最靠近根基的第一个向左，向上严格交替；方向由位置决定', () => {
  const dates = { A22: '2019-01-01', 'A03-C01': '2020-01-01', 'A04-C01': '2021-01-01', 'A05-C01': '2022-01-01', A01: '2023-01-01' };
  const t = tree(dates);
  assert.deepEqual(sides(t), { A03: -1, A04: 1, A05: -1, A01: 1 });
  // 补录更早的 A05：位置变化后方向按新位置重算，受影响的主枝连同框镜像到另一侧
  const t2 = tree({ ...dates, 'A05-C02': '2019-06-01' });
  assert.deepEqual(trunkOrder(t2), ['A05', 'A03', 'A04', 'A01']);
  assert.deepEqual(sides(t2), { A05: -1, A03: 1, A04: -1, A01: 1 });
  for (const b of t2.boxes.filter((x) => x.l1 === 'A03')) assert.ok(b.x > 0, '向右的主枝上的框都在右侧');
  for (const b of t2.boxes.filter((x) => x.l1 === 'A05')) assert.ok(b.x + b.size < 0);
});

test('根基有二级区域时，根基自己的主枝向右，上方第一个一级区域向左', () => {
  const t = tree({ 'A03-C01': '2020-01-01', 'A04-C01': '2021-01-01', 'A05-C01': '2022-01-01' });
  assert.deepEqual(sides(t), { A03: 1, A04: -1, A05: 1 });
});

test('二级区域只在所属主枝上，沿主枝路径按时间由近到远排列、上下交替', () => {
  const dates = { 'A06-C05': '2021-03-01', 'A06-C02': '2021-01-01', 'A06-C09': '2021-02-01', 'A06-C01': '2021-04-01', 'A06-C11': '2021-05-01' };
  for (const extra of [{}, { 'A03-C01': '2020-01-01' }]) {
    const t = tree({ ...dates, ...extra });
    const br = t.branches.find((b) => b.id === 'A06');
    const boxes = t.boxes.filter((b) => b.l1 === 'A06').sort((a, b) => a.order - b.order);
    assert.deepEqual(boxes.map((b) => b.id), ['A06-C02', 'A06-C09', 'A06-C05', 'A06-C01', 'A06-C11']);
    assert.deepEqual(boxes.map((b) => b.above), [true, false, true, false, true]);
    // 小枝从主枝出发，离树干的路径距离递增
    const twigs = boxes.map((b) => t.twigs.find((w) => w.id === b.id));
    const us = twigs.map((w) => w.from.x * br.side);
    assert.deepEqual(us, [...us].sort((a, b) => a - b));
    for (const [i, w] of twigs.entries()) {
      const b = boxes[i];
      assert.ok(w.from.x * br.side >= br.u0 && w.from.x * br.side <= br.u1);
      // 小枝末端接在框的边缘上：框在上方时接下边，在下方时接上边
      assert.ok(w.to.x > b.x && w.to.x < b.x + b.size);
      assert.ok(Math.abs(w.to.y - (b.above ? b.y : b.y + b.size)) < 1e-9);
      // 名称在连接点的另一侧
      assert.ok(b.above ? b.label.y >= b.y + b.size : b.label.y <= b.y);
    }
  }
});

test('同一天：按拼音排序，再按区域编码；地名多音字按地名读音', () => {
  assert.equal(pinyinKey('长沙'), '常沙');
  const list = [
    { id: 'A10', name: '中山', date: '2024-01-01' },
    { id: 'A11', name: '长沙', date: '2024-01-01' },
    { id: 'A12', name: '厦门', date: '2024-01-01' },
    { id: 'A13', name: '阿坝', date: '2024-01-01' },
    { id: 'A02', name: '阿坝', date: '2024-01-01' },
    { id: 'A14', name: '重庆', date: '2023-12-31' },
  ];
  assert.deepEqual(list.sort(compareRegions).map((x) => x.id), ['A14', 'A02', 'A13', 'A11', 'A12', 'A10']);
  // 一级区域与二级区域都用同样的规则
  const names = { A03: '长沙', A04: '北京', 'A05-C01': '厦门', 'A05-C02': '长沙' };
  const t = tree({ 'A03-C01': '2024-01-01', 'A04-C01': '2024-01-01', 'A05-C01': '2025-01-01', 'A05-C02': '2025-01-01' }, names);
  assert.deepEqual(trunkOrder(t), ['A04', 'A03', 'A05']);
  assert.deepEqual(t.boxes.filter((b) => b.l1 === 'A05').map((b) => b.id), ['A05-C02', 'A05-C01']);
});

test('没有二级区域的一级区域：各占一个节点、一条主枝，末端挂自身的区域框，参与排序与交替', () => {
  const t = tree({ 'A03-C01': '2020-01-01', A01: '2021-01-01', A02: '2021-02-01', A09: '2021-03-01', A32: '2021-04-01', A33: '2021-05-01', A34: '2021-06-01' });
  assert.deepEqual(trunkOrder(t), ['A03', 'A01', 'A02', 'A09', 'A32', 'A33', 'A34']);
  assert.deepEqual(sides(t), { A03: 1, A01: -1, A02: 1, A09: -1, A32: 1, A33: -1, A34: 1 });
  for (const id of ['A01', 'A02', 'A09', 'A32', 'A33', 'A34']) {
    const own = t.boxes.filter((b) => b.l1 === id);
    assert.deepEqual(own.map((b) => b.id), [id]);
  }
});

test('相同数据布局一致；新区域加在末端时不移动已有的节点', () => {
  const dates = { 'A03-C01': '2020-01-01', 'A03-C04': '2020-02-01', 'A08-C02': '2021-01-01', A01: '2022-01-01' };
  const a = tree(dates);
  assert.deepEqual(tree({ ...dates }), a);
  const b = tree({ ...dates, 'A10-C01': '2024-01-01', 'A08-C05': '2024-02-01' });
  const pos = (t) => Object.fromEntries(t.boxes.map((x) => [x.id, [x.x, x.y]]));
  const pa = pos(a);
  const pb = pos(b);
  for (const id of Object.keys(pa)) assert.deepEqual(pb[id], pa[id], id);
  for (const s of a.segments.slice(0, -1)) assert.deepEqual(b.segments.find((x) => x.id === s.id), s);
});

test('全部点亮时框与名称互不重叠，树向上和两侧扩展', () => {
  const dates = {};
  let d = 0;
  for (const id of R.level1) {
    const r = R.byId.get(id);
    const ids = r.children.length ? r.children : [id];
    for (const c of ids) {
      const day = new Date(Date.UTC(2015, 0, 1) + d++ * 86400000 * 5).toISOString().slice(0, 10);
      dates[c] = day;
    }
  }
  const t = tree(dates);
  assert.equal(t.segments.length + (t.root.kind === 'box' ? 1 : 0), 34);
  assert.equal(t.boxes.length, 333 + 7);
  const rs = rects(t);
  for (let i = 0; i < rs.length; i++) {
    assert.ok(rs[i].y >= 0, `${rs[i].id} 在地面以下`);
    for (let j = i + 1; j < rs.length; j++) assert.ok(!overlap(rs[i], rs[j]), `${rs[i].id} 与 ${rs[j].id} 重叠`);
  }
  // 框不压在树干上
  for (const b of t.boxes.filter((x) => !x.root)) assert.ok(b.x > 20 || b.x + b.size < -20, b.id);
  // 树干由下向上变细，各段首尾相接
  for (let i = 1; i < t.segments.length; i++) {
    assert.equal(t.segments[i].y0, t.segments[i - 1].y1);
    assert.equal(t.segments[i].w0, t.segments[i - 1].w1);
    assert.ok(t.segments[i].w0 <= t.segments[i - 1].w0);
  }
  // 二级区域多的省只向横向扩展，不改变树干上的间距
  const gaps = t.branches.slice(1).map((b, i) => b.y - t.branches[i].y);
  assert.ok(gaps.every((g) => Math.abs(g - gaps[0]) < 1e-9));
});

test('修改二级区域的时间使一级区域时间变化后，重新排序', () => {
  const dates = { 'A03-C01': '2020-01-01', 'A04-C01': '2021-01-01', 'A04-C02': '2023-06-01', 'A05-C01': '2023-01-01' };
  assert.deepEqual(trunkOrder(tree(dates)), ['A03', 'A04', 'A05']);
  const t = tree({ ...dates, 'A04-C01': '2024-01-01' }); // A04 的计算时间变为 2023-06-01
  assert.deepEqual(trunkOrder(t), ['A03', 'A05', 'A04']);
  assert.deepEqual(sides(t), { A03: 1, A05: -1, A04: 1 });
  assert.deepEqual(t.boxes.filter((b) => b.l1 === 'A04').map((b) => b.id), ['A04-C02', 'A04-C01']);
});
