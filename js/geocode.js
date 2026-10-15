// 坐标转中文地址（逆地理编码），使用腾讯位置服务 WebService API。
// 采用 JSONP 方式调用，Key 在腾讯位置服务控制台设置“域名白名单”为 gcy2016.github.io，
// 其他网站拿到 Key 也无法使用。未配置 Key 时此功能隐藏，地址仍可手动填写。

import { CONFIG } from './config.js';
import { wgs84ToGcj02 } from './maps.js';

const ENDPOINT = 'https://apis.map.qq.com/ws/geocoder/v1/';
const TIMEOUT_MS = 10000;

export function geocodeAvailable() {
  return !!CONFIG.tencentMapKey;
}

let seq = 0;

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const name = `__geo_cb_${Date.now().toString(36)}_${seq++}`;
    const script = document.createElement('script');
    // 页面整体不发送来源信息；这里需要发送来源域名，腾讯位置服务才能校验域名白名单
    script.referrerPolicy = 'origin';
    const cleanup = () => {
      clearTimeout(timer);
      delete window[name];
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('查询地址超时'));
    }, TIMEOUT_MS);
    window[name] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('无法连接地址服务'));
    };
    script.src = `${url}&output=jsonp&callback=${name}`;
    document.head.appendChild(script);
  });
}

/** 由 WGS84 坐标查询中文地址；返回字符串，失败时抛出带中文说明的错误 */
export async function reverseGeocode(lat, lng) {
  if (!geocodeAvailable()) throw new Error('尚未配置地址服务');
  const g = wgs84ToGcj02(lat, lng);
  const data = await jsonp(`${ENDPOINT}?location=${g.lat.toFixed(6)},${g.lng.toFixed(6)}&key=${encodeURIComponent(CONFIG.tencentMapKey)}`);
  if (!data || data.status !== 0 || !data.result) {
    throw new Error(`地址服务返回错误${data && data.message ? `：${data.message}` : ''}`);
  }
  return formatAddress(data.result);
}

export function formatAddress(result) {
  const base = (result.address || '').trim();
  const fa = result.formatted_addresses || {};
  const detail = (fa.standard_address || fa.recommend || '').trim();
  if (detail && base && !detail.includes(base) && !base.includes(detail)) return `${base}（${detail}）`;
  return detail.length > base.length ? detail : base;
}
