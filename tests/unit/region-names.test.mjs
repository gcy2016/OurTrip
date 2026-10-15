import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../../js/region-names.js';
import { loadRegionMap } from './helpers.mjs';
import { makeFakeMap, encryptMap, makeFakeSvg, FAKE_PASSWORD } from '../fixtures/fake-region-map.mjs';

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

test('地图：按名称对应到一级区域，含九段线；只保留坐标路径，过滤脚本与事件属性', () => {
  const map = makeFakeMap(anon);
  const { names } = N.computeShortNames(map);
  const r = N.parseChinaSvg(makeFakeSvg(map), map, names);
  assert.deepEqual(r.problems, []);
  assert.equal(Object.keys(r.data.regions).length, 34);
  assert.equal(r.data.dashes.length, 1);
  assert.deepEqual(r.data.markers.sort(), ['A01', 'A02', 'A09']);
  // viewBox 要包含九段线（在原 viewBox 之外）
  const [, y, , hgt] = r.data.viewBox;
  assert.ok(y + hgt >= 42);
  assert.ok(N.validMapData(r.data));
  assert.ok(!JSON.stringify(r.data).includes('script'));

  const evil = N.parseChinaSvg(makeFakeSvg(map, { evil: true }), map, names);
  assert.ok(evil.problems.some((p) => p.includes('坏')));
  assert.ok(!JSON.stringify(evil.data).includes('alert'));
  assert.equal(N.validMapData({ ...r.data, regions: { A01: 'M0,0 url(javascript:alert(1))' } }), false);

  const noDash = N.parseChinaSvg(makeFakeSvg(map).replace(/<g id="jiuduanxian">.*<\/g>/, ''), map, names);
  assert.ok(noDash.problems.some((p) => p.includes('九段线')));
});
