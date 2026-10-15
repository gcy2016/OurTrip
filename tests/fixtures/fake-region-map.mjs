// 测试用的“假”区域映射与地图：编号、层级与 data/region-map-anon.js 一致，名称全部是虚构的。
// 生成方式与真实映射文件相同（zlib 压缩 + PBKDF2-SHA256 + AES-256-GCM），用于测试解密、简称和地图对应。
import { deflateSync } from 'node:zlib';
import { webcrypto } from 'node:crypto';

export const FAKE_PASSWORD = 'fake-map-password';

// 特意构造的名称：去掉通名/民族名、重名加“省/市/州”、港澳台标注
const SPECIAL = {
  A01: '香港特别行政区',
  A02: '澳门特别行政区',
  A09: '台湾省',
  A07: '重名',
  'A07-C02': '重名',
  'A07-C03': '测甲蒙古族藏族自治州',
  'A07-C04': '测乙柯尔克孜自治州',
  'A07-C05': '测丙地区',
  'A07-C06': '兴安盟',
  'A08-C01': '重名藏族自治州',
};

const CN = '零一二三四五六七八九';
const num = (n) => String(n).padStart(2, '0').split('').map((d) => CN[d]).join('');

export function makeFakeMap(anon) {
  return {
    format: 'fake region map',
    note: '测试用虚构名称',
    level1: anon.level1.map((l1) => ({
      id: l1.id,
      name: SPECIAL[l1.id] || `虚${num(l1.id.slice(1))}省`,
      children: l1.children.map((c) => ({ id: c, name: SPECIAL[c] || `${num(l1.id.slice(1))}${num(c.slice(-2))}市` })),
    })),
  };
}

export async function encryptMap(map, password = FAKE_PASSWORD, iterations = 1000) {
  const subtle = webcrypto.subtle;
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const nonce = webcrypto.getRandomValues(new Uint8Array(12));
  const aad = 'OurTrip-region-map-v1';
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(aad) }, key, deflateSync(Buffer.from(JSON.stringify(map))));
  const b64 = (u) => Buffer.from(u).toString('base64');
  return {
    format: 'OurTrip encrypted mapping',
    version: 1,
    content: 'zlib-compressed UTF-8 JSON',
    kdf: 'PBKDF2-HMAC-SHA256',
    iterations,
    salt_b64: b64(salt),
    cipher: 'AES-256-GCM',
    nonce_b64: b64(nonce),
    aad,
    ciphertext_b64: b64(ct),
  };
}

/** 虚构地图：每个一级区域一个方块（6×6 网格），港澳两个很小的方块，A21 带两个远处小岛，另有一段九段线 */
export function makeFakeSvg(map, { evil = false } = {}) {
  const tiny = { A01: [20, 33], A02: [19.4, 33.2] };
  const paths = map.level1.map((l1, i) => {
    if (tiny[l1.id]) {
      const [x, y] = tiny[l1.id];
      return `<path id="p${i}" data-name="${l1.name}" d="M${x},${y}L${x + 0.3},${y}L${x + 0.3},${y + 0.3}L${x},${y + 0.3}Z"/>`;
    }
    const x = (i % 6) * 8;
    const y = Math.floor(i / 6) * 6;
    // A21 带两个远在南边的小岛（模拟南海诸岛）
    const isles = l1.id === 'A21' ? 'M17,40L17.3,40L17.3,40.3Z M19,43L19.3,43L19.3,43.3Z' : '';
    return `<path id="p${i}" data-name="${l1.name}" d="M${x},${y}L${x + 7},${y}L${x + 7},${y + 5}L${x},${y + 5}Z ${isles}"/>`;
  });
  if (evil) paths.push('<path data-name="坏" d="M0,0" onclick="alert(1)"/><script>alert(1)</script>');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 36">
<g id="provinces">
${paths.join('\n')}
</g>
<g id="jiuduanxian"><path d="M44,38L45,39L44,38ZM42,41L42,42L42,41Z"/></g>
</svg>`;
}
