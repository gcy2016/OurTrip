// 本地演示/测试用存储：与 COS 存储接口一致。
// 浏览器中用 IndexedDB 持久化（同一浏览器的多个标签页共享数据，可模拟两人同时在线）；
// Node 测试中退化为内存。

function randomEtag() {
  return `"${Math.random().toString(16).slice(2)}${Date.now().toString(16)}"`;
}

class MemoryBackend {
  constructor() {
    this.map = new Map();
  }
  async get(key) {
    return this.map.get(key) || null;
  }
  async put(key, rec) {
    this.map.set(key, rec);
  }
  async keys() {
    return [...this.map.keys()];
  }
}

class IdbBackend {
  constructor(name) {
    this.ready = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('objects');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async tx(mode, fn) {
    const db = await this.ready;
    return new Promise((resolve, reject) => {
      const t = db.transaction('objects', mode);
      const r = fn(t.objectStore('objects'));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    });
  }
  async get(key) {
    return (await this.tx('readonly', (s) => s.get(key))) || null;
  }
  async put(key, rec) {
    await this.tx('readwrite', (s) => s.put(rec, key));
  }
  async keys() {
    return this.tx('readonly', (s) => s.getAllKeys());
  }
}

export class MemoryStore {
  constructor({ persistent = false, name = 'travel-album-demo' } = {}) {
    this.backend = persistent && typeof indexedDB !== 'undefined' ? new IdbBackend(name) : new MemoryBackend();
    this.urls = new Map();
    // 测试钩子：让接下来 n 次写入失败，模拟断网/超时
    this.failNextWrites = 0;
    this.latencyMs = 0;
    this.clockOffset = 0;
    this.kind = 'demo';
  }

  now() {
    return Date.now() + this.clockOffset;
  }

  async delay() {
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  maybeFail() {
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    if (g.__demoFailWrites > 0) {
      g.__demoFailWrites--;
      throw Object.assign(new Error('模拟网络错误'), { network: true });
    }
    if (this.failNextWrites > 0) {
      this.failNextWrites--;
      throw Object.assign(new Error('模拟网络错误'), { network: true });
    }
  }

  async getJSON(key) {
    await this.delay();
    const rec = await this.backend.get(key);
    if (!rec) return null;
    return { data: JSON.parse(rec.text), etag: rec.etag };
  }

  async headETag(key) {
    await this.delay();
    const rec = await this.backend.get(key);
    return rec ? rec.etag : null;
  }

  async putJSON(key, data) {
    await this.delay();
    this.maybeFail();
    const etag = randomEtag();
    await this.backend.put(key, { text: JSON.stringify(data), etag, lastModified: this.now(), size: 0 });
    return etag;
  }

  async putBlob(key, blob, onProgress) {
    await this.delay();
    this.maybeFail();
    if (onProgress) onProgress(0.5);
    const etag = randomEtag();
    await this.backend.put(key, { blob, etag, lastModified: this.now(), size: blob.size || 0 });
    if (onProgress) onProgress(1);
    return etag;
  }

  async list(prefix) {
    const keys = (await this.backend.keys()).filter((k) => k.startsWith(prefix));
    const out = [];
    for (const k of keys) {
      const rec = await this.backend.get(k);
      out.push({ key: k, lastModified: rec.lastModified, size: rec.size || 0 });
    }
    return out;
  }

  async remove(key) {
    if (this.backend.map) this.backend.map.delete(key);
    else await this.backend.tx('readwrite', (st) => st.delete(key));
  }

  async urlFor(key) {
    if (this.urls.has(key)) return this.urls.get(key);
    const rec = await this.backend.get(key);
    if (!rec || !rec.blob) return '';
    const url = URL.createObjectURL(rec.blob);
    this.urls.set(key, url);
    return url;
  }
}
