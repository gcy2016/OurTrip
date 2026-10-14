import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLinks, safeExternalUrl, copyText } from '../../js/maps.js';

test('坐标生成多种地图链接并声明 wgs84', () => {
  const links = mapLinks({ lat: 31.2, lng: 121.5, address: '某路' }, '小店');
  const amap = links.find((l) => l.label === '高德地图').href;
  assert.match(amap, /position=121\.5,31\.2/);
  assert.match(amap, /coordinate=wgs84/);
  assert.match(links.find((l) => l.label === '百度地图').href, /coord_type=wgs84/);
  assert.ok(links.some((l) => l.href.startsWith('geo:')));
});

test('只有地址时用地址搜索；危险链接被过滤', () => {
  const links = mapLinks({ address: '某路 1 号', mapUrl: 'javascript:alert(1)' });
  assert.ok(links.every((l) => !l.href.startsWith('javascript')));
  assert.match(links[0].href, /keyword=/);
  assert.equal(safeExternalUrl('https://surl.amap.com/x'), 'https://surl.amap.com/x');
  assert.equal(safeExternalUrl('data:text/html,1'), null);
  assert.equal(copyText({ address: 'a', lat: 1, lng: 2 }), 'a\n坐标（WGS84）：1.000000, 2.000000');
  assert.deepEqual(mapLinks(null), []);
});
