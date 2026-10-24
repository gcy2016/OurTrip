// 相册框照片批量操作：批量删除、批量下载。
// 下载：先把选中的照片取回本机，再由用户点按钮保存——
// iPhone 上用系统分享面板（可选“存储图像”存进相册）；不支持时打包成 zip 下载。

import { h, dialog, buttons, confirmDialog, toast } from './ui.js';
import { deletePhoto } from './album.js';
import { photoKey } from './upload.js';
import { makeZip } from './zip.js';

export async function batchDelete(app, ids) {
  if (!ids.length) return false;
  if (!(await confirmDialog(`删除选中的 ${ids.length} 张照片？删除后 30 天内可由技术维护恢复。`, { danger: true, okLabel: '删除' }))) return false;
  const now = app.store.now();
  const r = app.mutate((a) => {
    for (const id of ids) if (a.photos[id]) deletePhoto(a, id, now);
  });
  if (r) toast(`已删除 ${ids.length} 张照片`, 'ok');
  return !!r;
}

function fileName(photo, i, used) {
  const base = (photo.origName || `照片${i + 1}`).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || `照片${i + 1}`;
  let name = `${base}.jpg`;
  let n = 2;
  while (used.has(name)) name = `${base}-${n++}.jpg`;
  used.add(name);
  return name;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 30000);
}

export function batchDownload(app, ids) {
  if (!ids.length) return;
  let cancelled = false;
  return dialog(
    (close) => {
      const status = h('p', { class: 'dialog-text' }, `正在准备 ${ids.length} 张照片…`);
      const bar = h('div', { class: 'progress-bar' });
      const actions = buttons(
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              cancelled = true;
              close();
            },
          },
          '取消'
        )
      );
      const files = [];
      (async () => {
        const used = new Set();
        let failed = 0;
        for (let i = 0; i < ids.length; i++) {
          if (cancelled) return;
          const p = app.sync.album.photos[ids[i]];
          if (!p) continue;
          try {
            const url = await app.imageUrl(photoKey(p.id));
            const res = await fetch(url);
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            files.push(new File([blob], fileName(p, i, used), { type: 'image/jpeg' }));
          } catch {
            failed++;
          }
          bar.style.width = `${Math.round(((i + 1) / ids.length) * 100)}%`;
          status.textContent = `正在准备 ${i + 1}/${ids.length} 张照片…`;
        }
        if (cancelled) return;
        if (!files.length) {
          status.textContent = '照片下载失败，请检查网络后重试。';
          return;
        }
        status.textContent = `已准备好 ${files.length} 张照片${failed ? `（${failed} 张失败）` : ''}。`;
        actions.textContent = '';
        actions.appendChild(h('button', { class: 'btn', onclick: () => close() }, '关闭'));
        const canShare = typeof navigator.canShare === 'function' && navigator.share && navigator.canShare({ files });
        if (canShare) {
          actions.appendChild(
            h(
              'button',
              {
                class: 'btn btn-primary',
                onclick: async () => {
                  try {
                    await navigator.share({ files });
                    close();
                  } catch (e) {
                    if (e && e.name !== 'AbortError') toast('无法打开分享面板，可以改用下载压缩包', 'warn');
                  }
                },
              },
              '保存到相册 / 分享'
            )
          );
        }
        actions.appendChild(
          h(
            'button',
            {
              class: `btn${canShare ? '' : ' btn-primary'}`,
              onclick: async () => {
                if (files.length === 1) saveBlob(files[0], files[0].name);
                else {
                  const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
                  saveBlob(new Blob([makeZip(data)], { type: 'application/zip' }), `旅行相册-${files.length}张.zip`);
                }
                close();
              },
            },
            files.length === 1 ? '下载照片' : '下载压缩包'
          )
        );
        if (canShare) actions.appendChild(h('p', { class: 'dialog-hint', style: { width: '100%', margin: 0 } }, 'iPhone 上点“保存到相册 / 分享”，再选“存储图像”即可存进系统相册。'));
      })();
      return h('div', null, status, h('div', { class: 'progress' }, bar), actions);
    },
    { title: '下载照片', dismissable: false }
  );
}
