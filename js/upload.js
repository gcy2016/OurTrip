// 批量上传面板：单批最多 50 张；显示整体进度和每张状态；失败项可单独重试。
// 顺序：读取属性并压缩 → 上传原图 → 上传缩略图 → 全部文件确认成功后再写入 album.json。

import { h, clear, dialog, buttons, confirmDialog } from './ui.js';
import { processPhoto, MAX_BATCH } from './images.js';
import { newId, addPhotos } from './album.js';

const CONCURRENCY = 3;

const STATUS_TEXT = {
  waiting: '等待中',
  processing: '读取与压缩中',
  uploading: '上传中',
  uploaded: '文件已上传，等待保存',
  done: '完成',
  failed: '失败',
};

export function photoKey(id) {
  return `photos/${id}.jpg`;
}
export function thumbKey(id) {
  return `thumbs/${id}.jpg`;
}

export async function openUploader(app, boxId, fileList) {
  let files = Array.from(fileList || []);
  if (!files.length) return;
  let skipped = 0;
  if (files.length > MAX_BATCH) {
    skipped = files.length - MAX_BATCH;
    files = files.slice(0, MAX_BATCH);
  }
  const items = files.map((file) => ({ file, name: file.name || '照片', status: 'waiting', progress: 0, error: '', record: null, permanent: false }));
  let running = 0;
  let committing = false;
  let commitError = '';
  let closeFn = null;
  let listEl, summaryEl, barEl, footEl;

  const refresh = () => {
    if (!listEl) return;
    const done = items.filter((i) => i.status === 'done').length;
    const failed = items.filter((i) => i.status === 'failed').length;
    const pct = items.reduce((s, i) => s + (i.status === 'done' || i.status === 'uploaded' ? 1 : i.progress), 0) / items.length;
    barEl.style.width = `${Math.round(pct * 100)}%`;
    summaryEl.textContent = `共 ${items.length} 张：完成 ${done}，失败 ${failed}` + (skipped ? `（另有 ${skipped} 张超过单批 50 张上限未加入，请稍后再选）` : '');
    clear(listEl);
    for (const it of items) {
      const statusText = it.status === 'uploading' ? `上传中 ${Math.round(it.progress * 100)}%` : STATUS_TEXT[it.status];
      listEl.appendChild(
        h(
          'li',
          { class: `up-item up-${it.status}` },
          h('span', { class: 'up-name' }, it.name),
          h('span', { class: 'up-status' }, statusText, it.error ? `：${it.error}` : ''),
          it.status === 'failed' && !it.permanent
            ? h('button', { class: 'btn btn-small', onclick: () => retry(it) }, '重试')
            : null
        )
      );
    }
    clear(footEl);
    const busyNow = running > 0 || committing || items.some((i) => i.status === 'waiting');
    if (commitError) {
      footEl.appendChild(h('p', { class: 'error-text' }, `照片文件已上传，但保存相册失败：${commitError}`));
      footEl.appendChild(h('button', { class: 'btn btn-primary', onclick: () => commit() }, '重试保存'));
    }
    if (failed && items.some((i) => i.status === 'failed' && !i.permanent)) {
      footEl.appendChild(h('button', { class: 'btn', onclick: () => items.filter((i) => i.status === 'failed' && !i.permanent).forEach(retry) }, '重试全部失败项'));
    }
    footEl.appendChild(h('button', { class: 'btn', onclick: () => tryClose() }, busyNow ? '后台继续' : '关闭'));
  };

  const tryClose = async () => {
    const busyNow = running > 0 || committing || items.some((i) => i.status === 'waiting');
    const pending = items.some((i) => i.status === 'uploaded') || commitError;
    if (!busyNow && pending && !(await confirmDialog('还有已上传但未保存到相册的照片，关闭后它们不会出现在相册里。确定关闭？', { danger: true }))) return;
    closeFn && closeFn();
  };

  const work = async (it) => {
    it.status = 'processing';
    it.error = '';
    it.progress = 0.05;
    refresh();
    try {
      if (!it.processed) it.processed = await processPhoto(it.file);
      const p = it.processed;
      const id = it.id || (it.id = newId('p'));
      it.status = 'uploading';
      refresh();
      await app.store.putBlob(photoKey(id), p.photo, (f) => {
        it.progress = 0.1 + f * 0.75;
        refresh();
      });
      await app.store.putBlob(thumbKey(id), p.thumb, (f) => {
        it.progress = 0.85 + f * 0.15;
        refresh();
      });
      it.record = {
        id,
        width: p.width,
        height: p.height,
        origWidth: p.origWidth,
        origHeight: p.origHeight,
        origName: it.file.name || '',
        origSize: it.file.size || 0,
        exif: p.exif,
        uploadedAt: app.store.now(),
      };
      it.status = 'uploaded';
      it.progress = 1;
    } catch (e) {
      it.status = 'failed';
      it.permanent = !!e.permanent;
      it.error = e.message || '上传失败';
      it.progress = 0;
    }
    refresh();
  };

  const pump = () => {
    while (running < CONCURRENCY) {
      const next = items.find((i) => i.status === 'waiting');
      if (!next) break;
      running++;
      work(next).finally(() => {
        running--;
        pump();
        if (running === 0 && !items.some((i) => i.status === 'waiting')) commit();
      });
      next.status = 'processing';
    }
    refresh();
  };

  const retry = (it) => {
    it.status = 'waiting';
    it.error = '';
    pump();
  };

  const commit = async () => {
    const ready = items.filter((i) => i.status === 'uploaded');
    if (!ready.length || committing) return;
    committing = true;
    commitError = '';
    refresh();
    try {
      if (!app.editing) throw new Error('当前没有编辑权');
      const recs = ready.map((i) => i.record);
      const already = new Set(Object.keys(app.sync.album.photos));
      const fresh = recs.filter((r) => !already.has(r.id));
      if (fresh.length) app.sync.mutate((album) => addPhotos(album, boxId, fresh));
      const ok = await app.sync.flush();
      if (!ok) throw new Error(app.sync.error || '保存失败');
      for (const i of ready) i.status = 'done';
    } catch (e) {
      commitError = e.message || '保存失败';
    } finally {
      committing = false;
      refresh();
      app.render();
    }
  };

  dialog(
    (close) => {
      closeFn = close;
      summaryEl = h('p', { class: 'up-summary' });
      barEl = h('div', { class: 'progress-bar' });
      listEl = h('ul', { class: 'up-list' });
      footEl = buttons();
      return h(
        'div',
        null,
        h('p', { class: 'dialog-hint' }, '单批最多 50 张，上传前会自动压缩；首版不支持视频。'),
        summaryEl,
        h('div', { class: 'progress' }, barEl),
        listEl,
        footEl
      );
    },
    { title: '上传照片', wide: true, dismissable: false }
  );
  pump();
}
