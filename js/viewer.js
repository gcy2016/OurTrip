// 大图查看：左右切换、照片说明，以及统一的“⋯”操作菜单（查看属性 / 编辑说明 / 设为封面 / 删除）。

import { h, clear, dialog, buttons, actionSheet, promptDialog, confirmDialog, toast, formatTime } from './ui.js';
import { setCaption, deletePhoto, setCover, ancestorIds } from './album.js';
import { isRegionId } from './regions.js';
import { appleMapsUrl, formatCoords } from './maps.js';
import { photoKey, thumbKey } from './upload.js';

function sizeText(bytes) {
  if (!bytes) return null;
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function showAttributes(photo) {
  const ex = photo.exif || {};
  const none = '无可用信息';
  const coords = Number.isFinite(ex.lat) && Number.isFinite(ex.lng) ? { lat: ex.lat, lng: ex.lng } : null;
  const row = (k, v) => h('div', { class: 'attr-row' }, h('dt', null, k), h('dd', { class: v ? '' : 'muted' }, v || none));
  return dialog(
    (close) =>
      h(
        'div',
        null,
        h(
          'dl',
          { class: 'attrs' },
          row('拍摄时间', ex.takenAt ? `${ex.takenAt}${ex.offset ? `（${ex.offset}）` : ''}` : null),
          row('拍摄地点（GPS）', coords ? `${formatCoords(coords)}${Number.isFinite(ex.altitude) ? `，海拔 ${ex.altitude} 米` : ''}` : null),
          coords
            ? h('div', { class: 'attr-links' }, h('a', { href: appleMapsUrl(coords, '拍摄地点'), target: '_blank', rel: 'noopener noreferrer' }, '在 Apple 地图中查看'))
            : null,
          row('拍摄设备', ex.device || null),
          row('镜头', ex.lens || null),
          row('原始尺寸', photo.origWidth ? `${photo.origWidth} × ${photo.origHeight}` : null),
          row('原文件名', photo.origName || null),
          row('原文件大小', sizeText(photo.origSize)),
          row('上传时间', photo.uploadedAt ? formatTime(photo.uploadedAt) : null)
        ),
        h('p', { class: 'dialog-hint' }, '拍摄信息读取自照片文件本身；照片经过转发、截图或编辑后可能已丢失，读不到的项目显示为“无可用信息”。'),
        buttons(h('button', { class: 'btn btn-primary', onclick: () => close() }, '关闭'))
      ),
    { title: '照片属性' }
  );
}

export function coverTargets(app, photo) {
  const album = app.sync.album;
  const ids = [photo.box, ...ancestorIds(album, app.regions, photo.box)];
  return ids.map((id) => {
    if (isRegionId(id)) {
      const r = app.regions.byId.get(id);
      return { value: id, label: `${r.level === 1 ? '一级区域' : '二级区域'}：${app.regionName(id)}` };
    }
    return { value: id, label: `${id === photo.box ? '所在框' : '上层框'}：${album.nodes[id].title}` };
  });
}

export function openViewer(app, photoIds, start) {
  let index = start;
  let touchX = null;
  const imgEl = h('img', { class: 'viewer-img', alt: '' });
  const captionEl = h('div', { class: 'viewer-caption' });
  const counterEl = h('span', { class: 'viewer-counter' });

  const current = () => app.sync.album.photos[photoIds[index]];

  const show = async () => {
    const p = current();
    if (!p) return close();
    counterEl.textContent = `${index + 1} / ${photoIds.length}`;
    captionEl.textContent = p.caption || '';
    captionEl.classList.toggle('empty', !p.caption);
    const id = p.id;
    imgEl.src = await app.imageUrl(thumbKey(id));
    const full = await app.imageUrl(photoKey(id));
    if (current() && current().id === id) {
      const pre = new Image();
      pre.onload = () => {
        if (current() && current().id === id) imgEl.src = full;
      };
      pre.src = full;
    }
  };

  const go = (d) => {
    const n = index + d;
    if (n < 0 || n >= photoIds.length) return;
    index = n;
    show();
  };

  const menu = async () => {
    const p = current();
    if (!p) return;
    const editing = app.editing;
    const choice = await actionSheet('照片操作', [
      { label: '查看属性', value: 'attrs' },
      { label: '编辑说明', value: 'caption', disabled: !editing, hint: editing ? '' : '需要先取得编辑权' },
      { label: '设为封面…', value: 'cover', disabled: !editing, hint: editing ? '' : '需要先取得编辑权' },
      { label: '删除照片', value: 'delete', danger: true, disabled: !editing },
    ]);
    if (choice === 'attrs') showAttributes(p);
    if (choice === 'caption') {
      const v = await promptDialog('照片说明', { value: p.caption || '', multiline: true });
      if (v !== undefined && app.mutate((a) => setCaption(a, p.id, v))) show();
    }
    if (choice === 'cover') {
      const target = await actionSheet('设为哪个框（区域）的封面？', coverTargets(app, p));
      if (target && app.mutate((a) => setCover(a, app.regions, target, p.id, app.store.now()))) toast('封面已设置', 'ok');
    }
    if (choice === 'delete') {
      if (!(await confirmDialog('确定删除这张照片？删除后 30 天内可由技术维护恢复。', { danger: true, okLabel: '删除' }))) return;
      if (app.mutate((a) => deletePhoto(a, p.id, app.store.now()))) {
        photoIds.splice(index, 1);
        if (!photoIds.length) return close();
        index = Math.min(index, photoIds.length - 1);
        show();
      }
    }
  };

  const onKey = (e) => {
    if (document.querySelector('.overlay')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  };

  const root = h(
    'div',
    { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '查看大图' },
    h(
      'div',
      { class: 'viewer-top' },
      h('button', { class: 'icon-btn', 'aria-label': '关闭', onclick: () => close() }, '✕'),
      counterEl,
      h('button', { class: 'icon-btn', 'aria-label': '照片操作', onclick: menu }, '⋯')
    ),
    h(
      'div',
      { class: 'viewer-stage' },
      h('button', { class: 'viewer-nav prev', 'aria-label': '上一张', onclick: () => go(-1) }, '‹'),
      imgEl,
      h('button', { class: 'viewer-nav next', 'aria-label': '下一张', onclick: () => go(1) }, '›')
    ),
    captionEl
  );
  root.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
  root.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    touchX = null;
  });

  function close() {
    document.removeEventListener('keydown', onKey);
    root.remove();
    document.body.classList.remove('no-scroll');
    app.render();
  }

  document.addEventListener('keydown', onKey);
  document.body.appendChild(root);
  document.body.classList.add('no-scroll');
  clear(captionEl);
  show();
}
