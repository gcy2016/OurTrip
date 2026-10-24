import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegions, isContentRegion, isRegionId } from '../../js/regions.js';
import { loadRegionMap, loadRegions } from './helpers.mjs';

test('映射文件：一级 34 个、二级 333 个，ID 与层级保持原样', () => {
  const raw = loadRegionMap();
  const r = buildRegions(raw);
  assert.equal(r.stats.level1, 34);
  assert.equal(r.stats.level2, 333);
  assert.deepEqual(r.level1, raw.level1.map((x) => x.id));
  for (const l1 of raw.level1) {
    assert.deepEqual(r.byId.get(l1.id).children, l1.children);
    for (const c of l1.children) assert.equal(r.byId.get(c).parent, l1.id);
  }
});

test('没有二级区域的一级区域可直接放内容；有二级区域的不行', () => {
  const r = loadRegions();
  const empty = r.level1.filter((id) => r.byId.get(id).children.length === 0);
  assert.deepEqual(empty, ['A01', 'A02', 'A09', 'A22', 'A32', 'A33', 'A34']);
  assert.equal(isContentRegion(r, 'A01'), true);
  assert.equal(isContentRegion(r, 'A03'), false);
  assert.equal(isContentRegion(r, 'A03-C01'), true);
  assert.equal(isContentRegion(r, 'A99'), false);
});

test('非法映射会被拒绝', () => {
  assert.throws(() => buildRegions({ level1: [{ id: 'A01', children: ['A02-C01'] }] }));
  assert.throws(() => buildRegions({ level1: [{ id: 'A01', children: [] }, { id: 'A01', children: [] }] }));
  assert.equal(isRegionId('A03-C01'), true);
  assert.equal(isRegionId('b123'), false);
});
