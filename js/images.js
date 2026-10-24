// 照片处理（浏览器端）：先读原始 EXIF，再压缩原图（长边约 2560）与缩略图（长边约 400）。
// 压缩后的 JPEG 不保留 EXIF，已读取到的属性单独保存在 album.json 里。

import * as exifr from '../vendor/exifr.full.esm.js';

export const MAX_EDGE = 2560;
export const THUMB_EDGE = 400;
export const MAX_BATCH = 50;

export function isHeic(file) {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
}

export function isVideo(file) {
  return /^video\//i.test(file.type) || /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i.test(file.name || '');
}

export function isImage(file) {
  return /^image\//i.test(file.type) || isHeic(file) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name || '');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** EXIF 中的拍摄时间不带时区，exifr 按本地时区构造 Date，这里用本地字段还原原始读数 */
function formatExifDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 只返回实际读到的字段；读不到返回 null，不做任何推测 */
export async function readExif(file) {
  let raw;
  try {
    raw = await exifr.parse(file, { tiff: true, exif: true, gps: true, ifd1: false, xmp: false, icc: false, iptc: false });
  } catch {
    return null;
  }
  if (!raw) return null;
  const out = {};
  const taken = formatExifDate(raw.DateTimeOriginal || raw.CreateDate);
  if (taken) out.takenAt = taken;
  if (raw.OffsetTimeOriginal) out.offset = String(raw.OffsetTimeOriginal);
  if (Number.isFinite(raw.latitude) && Number.isFinite(raw.longitude)) {
    out.lat = Number(raw.latitude.toFixed(7));
    out.lng = Number(raw.longitude.toFixed(7));
  }
  if (Number.isFinite(raw.GPSAltitude)) out.altitude = Math.round(raw.GPSAltitude);
  const device = [raw.Make, raw.Model].filter((x) => typeof x === 'string' && x.trim()).join(' ').trim();
  if (device) out.device = device;
  if (typeof raw.LensModel === 'string' && raw.LensModel.trim()) out.lens = raw.LensModel.trim();
  return Object.keys(out).length ? out : null;
}

let heicLoader = null;
function loadHeic2any() {
  if (!heicLoader) {
    heicLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/heic2any.min.js', import.meta.url).href;
      s.onload = () => resolve(window.heic2any);
      s.onerror = () => {
        heicLoader = null;
        reject(new Error('HEIC 解码组件加载失败'));
      };
      document.head.appendChild(s);
    });
  }
  return heicLoader;
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法解码图片'));
    };
    img.src = url;
  });
}

async function decode(file) {
  try {
    return await loadImage(file);
  } catch {
    if (!isHeic(file)) throw new Error('无法读取这张图片（格式不支持或文件已损坏）');
    const heic2any = await loadHeic2any();
    const jpeg = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return loadImage(Array.isArray(jpeg) ? jpeg[0] : jpeg);
  }
}

function toJpeg(img, maxEdge, quality) {
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve({ blob: b, width: w, height: h }) : reject(new Error('图片压缩失败'))), 'image/jpeg', quality)
  );
}

/** 处理一张照片：EXIF → 解码 → 压缩原图与缩略图 */
export async function processPhoto(file) {
  if (isVideo(file)) throw Object.assign(new Error('首版不支持视频'), { permanent: true });
  if (!isImage(file)) throw Object.assign(new Error('不是图片文件'), { permanent: true });
  const exif = await readExif(file);
  const { img, url } = await decode(file);
  try {
    const photo = await toJpeg(img, MAX_EDGE, 0.86);
    const thumb = await toJpeg(img, THUMB_EDGE, 0.8);
    return {
      photo: photo.blob,
      thumb: thumb.blob,
      width: photo.width,
      height: photo.height,
      origWidth: img.naturalWidth,
      origHeight: img.naturalHeight,
      exif,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
