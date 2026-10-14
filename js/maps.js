// 地图链接。坐标统一按浏览器定位 / 照片 EXIF 得到的 WGS84 保存，
// 高德、百度链接通过参数声明坐标系为 wgs84，由地图服务自行换算，网页端不做转换。

const enc = encodeURIComponent;
const SRC = 'webapp.travel-album';

export function safeExternalUrl(url) {
  if (!url) return null;
  const s = String(url).trim();
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch {
    /* 不是合法网址 */
  }
  return null;
}

export function formatCoords(loc) {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return '';
  return `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`;
}

/** 生成可点击的地图链接列表：[{label, href}] */
export function mapLinks(loc, name = '') {
  if (!loc) return [];
  const links = [];
  const title = name || loc.address || '标记地点';
  const hasCoords = Number.isFinite(loc.lat) && Number.isFinite(loc.lng);
  const addr = (loc.address || '').trim();
  const own = safeExternalUrl(loc.mapUrl);
  if (own) links.push({ label: '保存的地图链接', href: own });
  if (hasCoords) {
    const { lat, lng } = loc;
    links.push({
      label: '高德地图',
      href: `https://uri.amap.com/marker?position=${lng},${lat}&name=${enc(title)}&coordinate=wgs84&callnative=1&src=${SRC}`,
    });
    links.push({
      label: '百度地图',
      href: `https://api.map.baidu.com/marker?location=${lat},${lng}&title=${enc(title)}&content=${enc(addr || title)}&output=html&coord_type=wgs84&src=${SRC}`,
    });
    links.push({ label: 'Apple 地图', href: `https://maps.apple.com/?ll=${lat},${lng}&q=${enc(title)}` });
    links.push({ label: '系统地图（安卓）', href: `geo:${lat},${lng}?q=${lat},${lng}(${enc(title)})` });
  } else if (addr) {
    links.push({ label: '高德地图', href: `https://uri.amap.com/search?keyword=${enc(addr)}&callnative=1&src=${SRC}` });
    links.push({ label: '百度地图', href: `https://api.map.baidu.com/geocoder?address=${enc(addr)}&output=html&src=${SRC}` });
    links.push({ label: 'Apple 地图', href: `https://maps.apple.com/?q=${enc(addr)}` });
    links.push({ label: '系统地图（安卓）', href: `geo:0,0?q=${enc(addr)}` });
  }
  return links;
}

/** 复制用文本：地址 + 坐标 */
export function copyText(loc) {
  if (!loc) return '';
  return [loc.address && loc.address.trim(), formatCoords(loc) && `坐标（WGS84）：${formatCoords(loc)}`]
    .filter(Boolean)
    .join('\n');
}
