import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../../js/region-names.js';
import { loadRegionMap } from './helpers.mjs';
import { makeFakeMap, encryptMap, makeFakeSvg, makeFakeL2Svg, FAKE_PASSWORD } from '../fixtures/fake-region-map.mjs';

const anon = loadRegionMap();

test('映射文件：正确密码可解密且与匿名映射一致；错误密码给出明确提示', async () => {
  const map = makeFakeMap(anon);
  const enc = await encryptMap(map);
  const out = await N.decryptRegionMap(enc, FAKE_PASSWORD);
  assert.deepEqual(out, map);
  assert.deepEqual(N.checkAgainstAnon(out, anon), []);
  await assert.rejects(N.decryptRegionMap(enc, 'wrong'), /密码不正确/);
  await assert.rejects(N.decryptRegionMap({ foo: 1 }, 'x'), /不是有效/);
  const broken = structuredClone(map);
  broken.level1[2].children.pop();
  assert.ok(N.checkAgainstAnon(broken, anon).some((p) => p.includes('A03')));
});

test('简称：去掉省/市/自治区/自治州/地区/盟及民族名，不超过 4 个字；重名加省/市/州；兴安盟保留', () => {
  assert.equal(N.baseShortName('某某维吾尔自治区'), '某某');
  assert.equal(N.baseShortName('某某壮族自治区'), '某某');
  assert.equal(N.baseShortName('内蒙古自治区'), '内蒙古'); // 去掉“蒙古”只剩一个字，不去
  assert.equal(N.baseShortName('西藏自治区'), '西藏');
  assert.equal(N.baseShortName('甲乙苗族侗族自治州'), '甲乙');
  assert.equal(N.baseShortName('甲乙丙丁蒙古自治州'), '甲乙丙丁');
  assert.equal(N.baseShortName('甲乙特别行政区'), '甲乙');
  assert.equal(N.baseShortName('锡林郭勒盟'), '锡林郭勒');
  assert.equal(N.baseShortName('兴安盟'), '兴安盟');
  assert.equal(N.baseShortName('白城'), '白城');

  const { names, problems } = N.computeShortNames(makeFakeMap(anon));
  assert.deepEqual(problems, []);
  assert.equal(Object.keys(names).length, 34 + 333);
  assert.equal(names.A07, '重名省');
  assert.equal(names['A07-C02'], '重名市');
  assert.equal(names['A08-C01'], '重名州');
  assert.equal(names['A07-C03'], '测甲');
  assert.equal(names['A07-C04'], '测乙');
  assert.equal(names['A07-C05'], '测丙');
  assert.equal(names['A07-C06'], '兴安盟');
  assert.equal(names.A01, '香港');
  for (const v of Object.values(names)) assert.ok([...v].length <= 4, v);

  const long = makeFakeMap(anon);
  long.level1[3].name = '甲乙丙丁戊省';
  assert.ok(N.computeShortNames(long).problems.some((p) => p.includes('超过')));
});

test('地图：按名称对应到一级区域，不含九段线；只保留坐标路径，过滤脚本与事件属性', () => {
  const map = makeFakeMap(anon);
  const { names } = N.computeShortNames(map);
  const r = N.parseChinaSvg(makeFakeSvg(map), map, names);
  assert.deepEqual(r.problems, []);
  assert.equal(Object.keys(r.data.regions).length, 34);
  assert.equal(r.data.dashes, undefined);
  assert.deepEqual(r.data.markers.sort(), ['A01', 'A02', 'A09']);
  // 显示范围只按各省计算，不为九段线留空间
  const [, y, , hgt] = r.data.viewBox;
  assert.ok(y + hgt < 45);
  assert.ok(N.validMapData(r.data));
  assert.ok(!JSON.stringify(r.data).includes('script'));

  const evil = N.parseChinaSvg(makeFakeSvg(map, { evil: true }), map, names);
  assert.ok(evil.problems.some((p) => p.includes('坏')));
  assert.ok(!JSON.stringify(evil.data).includes('alert'));
  assert.equal(N.validMapData({ ...r.data, regions: { A01: 'M0,0 url(javascript:alert(1))' } }), false);

  const noDash = N.parseChinaSvg(makeFakeSvg(map).replace(/<g id="jiuduanxian">.*<\/g>/, ''), map, names);
  assert.deepEqual(noDash.problems, []);
});

test('南海诸岛：从最南端区域中分出远离主体的小岛，主图范围不再包含它们', async () => {
  const { splitIslands } = await import('../../js/views.js');
  const map = makeFakeMap(anon);
  const { names } = N.computeShortNames(map);
  const { data } = N.parseChinaSvg(makeFakeSvg(map), map, names);
  const r = splitIslands(data.regions);
  assert.equal(r.islandsOf, 'A21');
  assert.equal(r.islands.length, 2);
  const main = N.pathBBox(Object.values(r.regions).join(' '));
  assert.ok(main.y + main.h <= 36);
  assert.ok(N.pathBBox(r.regions.A21).h <= 5);
  // 没有远离主体的小岛时原样返回
  const plain = { A01: 'M0,0L1,0L1,1Z', A02: 'M2,2L3,2L3,3Z M3,3L3.2,3L3.2,3.1Z' };
  assert.deepEqual(splitIslands(plain).islands, []);
});

test('二级地图：自动识别省份，二级区域按名称对应，多出的块放进 others；名称位置落在区域内', () => {
  const map = makeFakeMap(anon);
  const r = N.parseLevel2Svg(makeFakeL2Svg(map, 'A16'), map);
  assert.equal(r.l1Id, 'A16');
  assert.deepEqual(r.problems, []);
  assert.deepEqual(Object.keys(r.data.regions).sort(), anon.level1.find((x) => x.id === 'A16').children.slice().sort());
  assert.equal(r.data.others.length, 1);
  assert.ok(N.validL2Data(r.data, 'A16'));
  assert.equal(N.validL2Data(r.data, 'A15'), false);
  // 缺一个二级区域时报告问题
  const svg = makeFakeL2Svg(map, 'A16').replace(/<path id="c0"[^>]*>/, '');
  assert.ok(N.parseLevel2Svg(svg, map).problems.some((p) => p.includes('A16-C01')));
  // 名称位置：凹形（L 形）区域取区域内的点
  const p = N.labelPoint('M0,0L10,0L10,1L1,1L1,10L0,10Z');
  assert.ok((p.x <= 1 && p.y <= 10) || (p.y <= 1 && p.x <= 10), JSON.stringify(p));
});
