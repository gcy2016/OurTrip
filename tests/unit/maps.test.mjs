import test from 'node:test';
import assert from 'node:assert/strict';
import { appleMapsUrl, copyText, wgs84ToGcj02, formatCoords } from '../../js/maps.js';
import { formatAddress } from '../../js/geocode.js';

test('WGS84 → GCJ-02：国内坐标有约数百米的偏移，国外坐标不变', () => {
  const g = wgs84ToGcj02(39.9087, 116.3975);
  assert.ok(Math.abs(g.lat - 39.9087 - 0.0013) < 0.0005, `lat ${g.lat}`);
  assert.ok(Math.abs(g.lng - 116.3975 - 0.0062) < 0.0005, `lng ${g.lng}`);
  assert.deepEqual(wgs84ToGcj02(48.8584, 2.2945), { lat: 48.8584, lng: 2.2945 });
});

test('只生成 Apple 地图链接：有坐标按换算后的坐标，否则按地址搜索', () => {
  const url = appleMapsUrl({ lat: 39.9087, lng: 116.3975, address: '某路' }, '小店');
  assert.match(url, /^https:\/\/maps\.apple\.com\/\?ll=39\.910\d+,116\.403\d+&q=%E5%B0%8F%E5%BA%97$/);
  assert.equal(appleMapsUrl({ address: '某路 1 号' }), 'https://maps.apple.com/?q=%E6%9F%90%E8%B7%AF%201%20%E5%8F%B7');
  assert.equal(appleMapsUrl({}), null);
  assert.equal(appleMapsUrl(null), null);
});

test('复制文本与坐标格式', () => {
  assert.equal(copyText({ address: 'a', lat: 1, lng: 2 }), 'a\n坐标：1.000000, 2.000000');
  assert.equal(formatCoords({ address: 'x' }), '');
});

test('逆地理编码结果整理成一行中文地址', () => {
  assert.equal(
    formatAddress({ address: '北京市海淀区彩和坊路', formatted_addresses: { recommend: '海淀西大街74号附近' } }),
    '北京市海淀区彩和坊路（海淀西大街74号附近）'
  );
  assert.equal(formatAddress({ address: '甲市乙区丙路', formatted_addresses: { standard_address: '甲市乙区丙路8号' } }), '甲市乙区丙路8号');
  assert.equal(formatAddress({ address: '甲市乙区' }), '甲市乙区');
});
