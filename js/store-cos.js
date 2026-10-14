// 腾讯云 COS 存储（cos-js-sdk-v5，页面中以 <script> 引入，全局变量 COS）。
// 用解密得到的子账号密钥直接读写私有存储桶。

const TIMEOUT_MS = 60000;
const URL_TTL_S = 3600;

function promisify(cos, method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (err, data) => (err ? reject(normalizeError(err)) : resolve(data)));
  });
}

function normalizeError(err) {
  const status = err && (err.statusCode || (err.error && err.error.statusCode));
  const e = new Error(describe(err, status));
  e.status = status || 0;
  e.network = !status;
  e.raw = err;
  return e;
}

function describe(err, status) {
  if (!status) return '网络连接失败或超时';
  if (status === 403) return '没有访问权限（请检查子账号权限策略与 CORS 设置）';
  if (status === 404) return '文件不存在';
  return `云端返回错误（${status}）`;
}

export class CosStore {
  constructor({ bucket, region, secretId, secretKey }) {
    if (typeof COS === 'undefined') throw new Error('COS SDK 未加载');
    this.bucket = bucket;
    this.region = region;
    this.cos = new COS({ SecretId: secretId, SecretKey: secretKey, Timeout: TIMEOUT_MS, ForceSignHost: true });
    this.clockOffset = 0;
    this.urls = new Map();
    this.kind = 'cos';
  }

  base(key) {
    return { Bucket: this.bucket, Region: this.region, Key: key };
  }

  /** 用响应头 Date（需在 CORS 中暴露）校准本机时钟，供编辑锁、在线状态计时 */
  learnClock(data) {
    const h = data && data.headers;
    const d = h && (h.date || h.Date);
    if (d) {
      const t = Date.parse(d);
      if (Number.isFinite(t)) this.clockOffset = t - Date.now();
    }
  }

  now() {
    return Date.now() + this.clockOffset;
  }

  async getJSON(key) {
    try {
      const data = await promisify(this.cos, 'getObject', {
        ...this.base(key),
        DataType: 'text',
        Headers: { 'Cache-Control': 'no-cache' },
        Query: { _t: Date.now() },
      });
      this.learnClock(data);
      return { data: JSON.parse(data.Body), etag: data.ETag };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async headETag(key) {
    try {
      const data = await promisify(this.cos, 'headObject', { ...this.base(key), Headers: { 'Cache-Control': 'no-cache' } });
      this.learnClock(data);
      return data.ETag;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async putJSON(key, obj) {
    const body = JSON.stringify(obj);
    const data = await promisify(this.cos, 'putObject', {
      ...this.base(key),
      Body: body,
      Headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
    this.learnClock(data);
    return data.ETag;
  }

  async putBlob(key, blob, onProgress) {
    const data = await promisify(this.cos, 'putObject', {
      ...this.base(key),
      Body: blob,
      Headers: { 'Content-Type': blob.type || 'image/jpeg', 'Cache-Control': 'max-age=31536000' },
      onProgress: (p) => onProgress && onProgress(p.percent || 0),
    });
    return data.ETag;
  }

  async list(prefix) {
    const out = [];
    let marker = '';
    for (;;) {
      const data = await promisify(this.cos, 'getBucket', {
        Bucket: this.bucket,
        Region: this.region,
        Prefix: prefix,
        Marker: marker,
        MaxKeys: 1000,
      });
      this.learnClock(data);
      for (const c of data.Contents || []) {
        out.push({ key: c.Key, lastModified: Date.parse(c.LastModified), size: Number(c.Size) || 0 });
      }
      if (String(data.IsTruncated) !== 'true' || !data.NextMarker) break;
      marker = data.NextMarker;
    }
    return out;
  }

  // ---------- 以下仅供维护工具（使用维护子账号密钥）调用 ----------

  async remove(key) {
    await promisify(this.cos, 'deleteObject', this.base(key));
  }

  async getJSONVersion(key, versionId) {
    const data = await promisify(this.cos, 'getObject', { ...this.base(key), VersionId: versionId, DataType: 'text' });
    return JSON.parse(data.Body);
  }

  /** 列出历史版本（需开启版本控制）：[{ key, versionId, isLatest, lastModified, size, deleteMarker }] */
  async listVersions(prefix) {
    const out = [];
    let keyMarker = '';
    let versionMarker = '';
    for (;;) {
      const data = await promisify(this.cos, 'listObjectVersions', {
        Bucket: this.bucket,
        Region: this.region,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionMarker,
        MaxKeys: 1000,
      });
      for (const v of data.Versions || []) {
        out.push({ key: v.Key, versionId: v.VersionId, isLatest: String(v.IsLatest) === 'true', lastModified: Date.parse(v.LastModified), size: Number(v.Size) || 0, deleteMarker: false });
      }
      for (const v of data.DeleteMarkers || []) {
        out.push({ key: v.Key, versionId: v.VersionId, isLatest: String(v.IsLatest) === 'true', lastModified: Date.parse(v.LastModified), size: 0, deleteMarker: true });
      }
      if (String(data.IsTruncated) !== 'true') break;
      keyMarker = data.NextKeyMarker;
      versionMarker = data.NextVersionIdMarker;
    }
    return out;
  }

  /** 把某个历史版本复制为当前版本（用于恢复误删/被覆盖的文件） */
  async restoreVersion(key, versionId) {
    const host = `${this.bucket}.cos.${this.region}.myqcloud.com`;
    await promisify(this.cos, 'putObjectCopy', { ...this.base(key), CopySource: `${host}/${encodeURI(key)}?versionId=${encodeURIComponent(versionId)}` });
  }

  /** 私有桶的图片地址需要签名；同一会话内缓存，减少重复签名、利于浏览器缓存 */
  async urlFor(key) {
    const hit = this.urls.get(key);
    if (hit && hit.expires > Date.now()) return hit.url;
    const url = await new Promise((resolve, reject) => {
      this.cos.getObjectUrl({ ...this.base(key), Sign: true, Expires: URL_TTL_S }, (err, data) =>
        err ? reject(normalizeError(err)) : resolve(data.Url)
      );
    });
    this.urls.set(key, { url, expires: Date.now() + (URL_TTL_S - 300) * 1000 });
    return url;
  }
}
