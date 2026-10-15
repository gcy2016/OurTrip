// album.json 的读取与保存。
// 保存顺序：确认编辑权仍在本机 → 比对云端版本（ETag）→ 写入。
// 版本不一致时不覆盖，进入“冲突”状态；网络失败时保留本地修改并可重试。
// 每次修改都会先在本机暂存一份草稿，浏览器崩溃或断网后可以找回。

import { emptyAlbum, normalizeAlbum } from './album.js';

export const ALBUM_KEY = 'album.json';
const DRAFT_KEY = 'travel-album-draft';
const SAVE_DEBOUNCE_MS = 500;

function readDraft() {
  try {
    const s = localStorage.getItem(DRAFT_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function writeDraft(d) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 存储空间不足或被禁用时忽略；云端保存仍会进行 */
  }
}

export class AlbumSync {
  constructor({ store, session, onChange, afterMutate }) {
    this.store = store;
    this.afterMutate = afterMutate || (() => {});
    this.session = session;
    this.onChange = onChange || (() => {});
    this.album = emptyAlbum();
    this.etag = null;
    this.dirty = false;
    this.status = 'idle'; // idle | saving | saved | error | conflict | lost-lock
    this.error = '';
    this.timer = null;
    this.saving = null;
    this.waiters = [];
  }

  set(status, error = '') {
    this.status = status;
    this.error = error;
    this.onChange();
  }

  async load() {
    const rec = await this.store.getJSON(ALBUM_KEY);
    this.album = normalizeAlbum(rec ? rec.data : null);
    this.etag = rec ? rec.etag : null;
    this.dirty = false;
    this.status = 'idle';
    this.error = '';
    this.onChange();
  }

  /** 查看模式下检查云端是否有更新；有则重新载入。返回是否更新 */
  async refreshIfChanged() {
    if (this.dirty || this.saving) return false;
    const remote = await this.store.headETag(ALBUM_KEY);
    if (remote === this.etag) return false;
    await this.load();
    return true;
  }

  /** 上次未保存的草稿（仅当云端在此期间未被修改时可恢复） */
  pendingDraft() {
    const d = readDraft();
    if (!d) return null;
    return { ...d, usable: d.baseEtag === this.etag };
  }

  discardDraft() {
    writeDraft(null);
  }

  restoreDraft() {
    const d = readDraft();
    if (!d || d.baseEtag !== this.etag) return false;
    this.album = normalizeAlbum(d.album);
    this.dirty = true;
    this.schedule(0);
    return true;
  }

  /** 修改相册：fn(album) 抛出错误时不做任何修改 */
  mutate(fn) {
    const snapshot = JSON.stringify(this.album);
    try {
      const result = fn(this.album);
      this.afterMutate(this.album);
      this.dirty = true;
      writeDraft({ baseEtag: this.etag, album: this.album, at: Date.now() });
      this.schedule();
      this.onChange();
      return result;
    } catch (e) {
      this.album = normalizeAlbum(JSON.parse(snapshot));
      throw e;
    }
  }

  schedule(delay = SAVE_DEBOUNCE_MS) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), delay);
  }

  /** 等待当前修改保存完成；返回是否成功 */
  flush() {
    if (!this.dirty && !this.saving) return Promise.resolve(this.status !== 'error' && this.status !== 'conflict');
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      if (!this.saving) this.schedule(0);
    });
  }

  settle(ok) {
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r(ok);
  }

  async save() {
    clearTimeout(this.timer);
    if (this.saving) {
      await this.saving;
      if (this.dirty && this.status === 'saved') return this.save();
      return;
    }
    if (!this.dirty) return this.settle(true);
    if (this.status === 'conflict') return this.settle(false);
    this.saving = this.doSave();
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
    if (this.dirty && this.status === 'saved') return this.save();
    this.settle(this.status === 'saved');
  }

  async doSave() {
    this.set('saving');
    const body = JSON.parse(JSON.stringify(this.album));
    body.updatedAt = this.store.now();
    try {
      if (!(await this.session.verify())) {
        this.set('lost-lock', '编辑权已失效，修改未保存（已暂存在本机）');
        return;
      }
      const remote = await this.store.headETag(ALBUM_KEY);
      if (remote !== this.etag) {
        this.set('conflict', '云端数据已被另一台设备修改，你最近的修改没有保存');
        return;
      }
      const sentAt = JSON.stringify(this.album);
      const etag = await this.store.putJSON(ALBUM_KEY, body);
      this.etag = etag;
      if (JSON.stringify(this.album) === sentAt) {
        this.dirty = false;
        writeDraft(null);
      } else {
        writeDraft({ baseEtag: this.etag, album: this.album, at: Date.now() });
      }
      this.set('saved');
    } catch (e) {
      this.set('error', e && e.message ? e.message : '保存失败');
    }
  }

  retry() {
    if (this.status === 'conflict') return;
    if (this.dirty) {
      this.status = 'idle';
      this.schedule(0);
    }
  }
}
