// 地点与地图。坐标统一按浏览器定位 / 照片 EXIF 得到的 WGS84 保存。
// 国内地图（含 Apple 地图在国内使用的底图、腾讯位置服务）使用 GCJ-02 坐标，
// 生成地图链接和查询地址前先在本地换算。两位使用者都用 iPhone，地图入口只保留 Apple 地图。

const enc = encodeURIComponent;

// ---------- WGS84 → GCJ-02（公开的标准换算公式） ----------

const A_AXIS = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return r;
}

function transformLng(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return r;
}

export function wgs84ToGcj02(lat, lng) {
  if (outOfChina(lat, lng)) return { lat, lng };
  let dLat = transformLat(lng - 105, lat - 35);
  let dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A_AXIS * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180) / ((A_AXIS / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

// ---------- 显示与链接 ----------

export function hasCoords(loc) {
  return !!loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng);
}

export function formatCoords(loc) {
  if (!hasCoords(loc)) return '';
  return `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`;
}

/** Apple 地图链接：有坐标时按坐标定位（换算为 GCJ-02），否则按地址搜索 */
export function appleMapsUrl(loc, name = '') {
  if (!loc) return null;
  const addr = (loc.address || '').trim();
  const label = name || addr || '标记地点';
  if (hasCoords(loc)) {
    const g = wgs84ToGcj02(loc.lat, loc.lng);
    return `https://maps.apple.com/?ll=${g.lat.toFixed(6)},${g.lng.toFixed(6)}&q=${enc(label)}`;
  }
  if (addr) return `https://maps.apple.com/?q=${enc(addr)}`;
  return null;
}

/** 复制用文本：地址 + 坐标 */
export function copyText(loc) {
  if (!loc) return '';
  return [loc.address && loc.address.trim(), formatCoords(loc) && `坐标：${formatCoords(loc)}`].filter(Boolean).join('\n');
}
