// 自定义框的编辑操作：新建、重命名、类型、颜色、复制、移动、合并、删除、地点编辑。

import { h, dialog, buttons, actionSheet, promptDialog, confirmDialog, alertDialog, toast } from './ui.js';
import * as A from './album.js';
import { isRegionId, isContentRegion } from './regions.js';
import { BOX_PALETTE } from './region-display.js';
import { formatCoords, hasCoords } from './maps.js';
import { geocodeAvailable, reverseGeocode } from './geocode.js';

export function newBoxDialog(app, parentId) {
  if (!A.canHoldChildren(app.sync.album, app.regions, parentId)) {
    // 有内容的末级框 / 相册框：按约定给出提示
    try {
      A.addBox(app.sync.album, app.regions, parentId);
    } catch (e) {
      return alertDialog(e.message, { title: '不能直接添加子框' });
    }
  }
  return dialog(
    (close) => {
      let type = '';
      let kind = 'normal';
      const input = h('input', { class: 'input', type: 'text', placeholder: '标题，例如 2024 五一 / 某家小店', autofocus: true });
      const chips = h(
        'div',
        { class: 'chips' },
        A.QUICK_TYPES.map((t) =>
          h(
            'button',
            {
              class: 'chip',
              type: 'button',
              onclick: (e) => {
                type = type === t ? '' : t;
                for (const c of chips.children) c.classList.toggle('on', c.textContent === type);
                if (!input.value.trim() || A.QUICK_TYPES.includes(input.value.trim())) input.value = type;
                e.currentTarget.blur();
              },
            },
            t
          )
        )
      );
      const normalPart = h('div', null, input, h('p', { class: 'dialog-hint' }, '快捷类型（可选，不限制框里放什么）：'), chips);
      const albumPart = h('p', { class: 'dialog-hint', hidden: true }, '相册框名称固定为“相册”，只能放照片，不能添加子框、备注或地点。照片很多时，单独放进相册框，其他内容就不会被挤到很下面。');
      const kindBtns = h(
        'div',
        { class: 'segmented', role: 'radiogroup', 'aria-label': '框的种类' },
        [
          ['normal', '普通框'],
          ['album', '相册框（只放照片）'],
        ].map(([k, label]) =>
          h(
            'button',
            {
              type: 'button',
              class: `seg${k === kind ? ' on' : ''}`,
              role: 'radio',
              'aria-checked': String(k === kind),
              dataset: { kind: k },
              onclick: () => {
                kind = k;
                for (const b of kindBtns.children) {
                  b.classList.toggle('on', b.dataset.kind === kind);
                  b.setAttribute('aria-checked', String(b.dataset.kind === kind));
                }
                normalPart.hidden = kind === 'album';
                albumPart.hidden = kind !== 'album';
              },
            },
            label
          )
        )
      );
      const submit = () => {
        const opts = kind === 'album' ? { kind: 'album' } : { title: input.value || type, type };
        const r = app.mutate((a) => A.addBox(a, app.regions, parentId, opts));
        if (r) close(r.value);
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      return h(
        'div',
        null,
        kindBtns,
        normalPart,
        albumPart,
        buttons(h('button', { class: 'btn', onclick: () => close() }, '取消'), h('button', { class: 'btn btn-primary', onclick: submit }, '新建'))
      );
    },
    { title: '新建框' }
  );
}

function colorDialog(app, node) {
  return dialog(
    (close) =>
      h(
        'div',
        null,
        h(
          'div',
          { class: 'swatches' },
          h('button', { class: 'swatch swatch-default', title: '默认颜色', onclick: () => close('') }, '默认'),
          BOX_PALETTE.map((c) => h('button', { class: `swatch${node.color === c ? ' on' : ''}`, style: { background: c }, title: c, 'aria-label': c, onclick: () => close(c) }))
        ),
        h('p', { class: 'dialog-hint' }, '设置了封面照片时显示照片；没有封面时显示这里的颜色。'),
        buttons(h('button', { class: 'btn', onclick: () => close() }, '取消'))
      ),
    { title: '背景颜色' }
  );
}

/** 选择移动目标：逐级浏览区域与框，在可放置的位置点“移到这里” */
export function movePicker(app, nodeId) {
  const album = app.sync.album;
  const R = app.regions;
  const moving = album.nodes[nodeId];
  let at = moving.parent;
  return dialog(
    (close) => {
      const wrap = h('div', { class: 'picker' });
      const render = () => {
        wrap.textContent = '';
        const crumbs = [];
        let cur = at;
        while (cur) {
          crumbs.unshift(cur);
          cur = isRegionId(cur) ? R.byId.get(cur).parent : album.nodes[cur].parent;
        }
        wrap.appendChild(
          h(
            'div',
            { class: 'picker-crumbs' },
            h('button', { class: 'link', onclick: () => ((at = null), render()) }, '全部区域'),
            crumbs.map((c) => [' / ', h('button', { class: 'link', onclick: () => ((at = c), render()) }, label(c))])
          )
        );
        let rows = [];
        if (!at) rows = R.level1.map((id) => ({ id, text: label(id) }));
        else if (isRegionId(at) && !isContentRegion(R, at)) rows = R.byId.get(at).children.map((id) => ({ id, text: label(id) }));
        else rows = A.childNodes(album, at).filter((n) => n.id !== nodeId).map((n) => ({ id: n.id, text: n.title }));
        const list = h('ul', { class: 'picker-list' });
        for (const r of rows) {
          const isBox = !isRegionId(r.id);
          const blocked = isBox && (A.hasContent(album.nodes[r.id]) || A.isAlbumBox(album.nodes[r.id]));
          list.appendChild(
            h(
              'li',
              null,
              h('button', { class: 'picker-row', disabled: blocked, onclick: () => ((at = r.id), render()) }, r.text, blocked ? h('small', null, A.isAlbumBox(album.nodes[r.id]) ? '（相册框，不能放入子框）' : '（有内容，不能放入子框）') : null)
            )
          );
        }
        if (!rows.length) list.appendChild(h('li', { class: 'muted' }, '这里还没有框'));
        wrap.appendChild(list);
        const ok = !!at && at !== moving.parent && A.canHoldChildren(album, R, at);
        wrap.appendChild(
          buttons(
            h('button', { class: 'btn', onclick: () => close() }, '取消'),
            h('button', { class: 'btn btn-primary', disabled: !ok, onclick: () => close(at) }, '移到这里')
          )
        );
      };
      const label = (id) => (isRegionId(id) ? app.regionName(id) : album.nodes[id].title);
      render();
      return wrap;
    },
    { title: `移动“${moving.title}”到…` }
  );
}

export async function boxActions(app, nodeId) {
  const album = app.sync.album;
  const node = album.nodes[nodeId];
  if (!node) return;
  const kids = A.childNodes(album, nodeId);
  const siblings = A.childNodes(album, node.parent);
  const pos = siblings.findIndex((s) => s.id === nodeId);
  const isAlbum = A.isAlbumBox(node);
  const choice = await actionSheet(isAlbum ? '相册框' : `“${node.title}”`, [
    { label: '重命名', value: 'rename', disabled: isAlbum, hint: isAlbum ? '相册框名称固定' : '' },
    { label: '设置类型', value: 'type', disabled: isAlbum, hint: isAlbum ? '' : node.type || '无' },
    { label: '背景颜色', value: 'color' },
    { label: '清除封面', value: 'uncover', disabled: !node.cover },
    { label: '复制为模板', value: 'copy', hint: '只复制框架，不复制内容' },
    { label: '移动到…', value: 'move' },
    { label: '提升一级', value: 'promote', disabled: isRegionId(node.parent) },
    { label: '前移', value: 'up', disabled: pos <= 0 },
    { label: '后移', value: 'down', disabled: pos >= siblings.length - 1 },
    { label: '删除', value: 'delete', danger: true },
  ]);
  if (!choice) return;
  if (choice === 'rename') {
    const v = await promptDialog('重命名', { value: node.title });
    if (v !== undefined) app.mutate((a) => A.updateBox(a, nodeId, { title: v }));
  } else if (choice === 'type') {
    const v = await actionSheet('设置类型', [...A.QUICK_TYPES.map((t) => ({ label: t, value: t })), { label: '自定义…', value: '__custom' }, { label: '无类型', value: '__none' }]);
    if (v === '__custom') {
      const t = await promptDialog('自定义类型', { value: node.type });
      if (t !== undefined) app.mutate((a) => A.updateBox(a, nodeId, { type: t }));
    } else if (v === '__none') app.mutate((a) => A.updateBox(a, nodeId, { type: '' }));
    else if (v) app.mutate((a) => A.updateBox(a, nodeId, { type: v }));
  } else if (choice === 'color') {
    const c = await colorDialog(app, node);
    if (c !== undefined) app.mutate((a) => A.updateBox(a, nodeId, { color: c }));
  } else if (choice === 'uncover') {
    app.mutate((a) => A.clearCover(a, nodeId));
  } else if (choice === 'copy') {
    app.setClipboard(A.copyTemplate(album, nodeId));
    toast('已复制框架，到目标位置点“粘贴模板”', 'ok');
  } else if (choice === 'move') {
    const target = await movePicker(app, nodeId);
    if (target && app.mutate((a) => A.moveBox(a, app.regions, nodeId, target))) toast('已移动', 'ok');
  } else if (choice === 'promote') {
    app.mutate((a) => A.promoteBox(a, app.regions, nodeId));
  } else if (choice === 'up' || choice === 'down') {
    app.mutate((a) => A.shiftOrder(a, nodeId, choice === 'up' ? -1 : 1));
  } else if (choice === 'delete') {
    await deleteBoxFlow(app, nodeId, kids.length);
  }
}

export async function deleteBoxFlow(app, nodeId, kidCount) {
  const album = app.sync.album;
  const node = album.nodes[nodeId];
  let msg;
  if (kidCount) msg = `删除“${node.title}”后，它的 ${kidCount} 个子框会提升到它原来所在的层级，子框里的内容全部保留。确定删除？`;
  else if (A.hasContent(node)) {
    const parts = [];
    if (node.photos.length) parts.push(`${node.photos.length} 张照片`);
    if (node.note.trim()) parts.push('文字备注');
    if (A.hasLocation(node.location)) parts.push('地点');
    msg = `“${node.title}”里的${parts.join('、')}会一起删除（30 天内可由技术维护恢复）。确定删除？`;
  } else msg = `确定删除空框“${node.title}”？`;
  if (!(await confirmDialog(msg, { danger: true, okLabel: '删除' }))) return false;
  const parent = node.parent;
  const r = app.mutate((a) => A.deleteBox(a, app.regions, nodeId, app.store.now()));
  if (r && app.route.id === nodeId) app.go(isRegionId(parent) ? `#/r/${parent}` : `#/b/${parent}`);
  return !!r;
}

export async function mergeFlow(app, ids) {
  const v = await promptDialog(`把选中的 ${ids.length} 个框合并到一个新框里`, {
    placeholder: '新框标题，例如 2024 五一',
    okLabel: '合并',
    hint: '原来的框会成为新框的子框，内容全部保留。',
  });
  if (v === undefined) return false;
  return !!app.mutate((a) => A.mergeBoxes(a, ids, v));
}

export function pasteFlow(app, parentId) {
  const tpl = app.clipboard;
  if (!tpl) return;
  if (app.mutate((a) => A.pasteTemplate(a, app.regions, tpl, parentId))) toast(`已粘贴模板“${tpl.title}”（内容为空）`, 'ok');
}

/** 地点编辑：手动输入地址，或经授权读取当前位置（配置了地址服务时自动转成中文地址） */
export function locationDialog(app, nodeId) {
  const node = app.sync.album.nodes[nodeId];
  const loc = { ...(node.location || {}) };
  delete loc.mapUrl;
  const hadLocation = A.hasLocation(node.location);
  let generation = 0; // 取消或关闭后，迟到的定位/查询结果一律丢弃
  return dialog(
    (close) => {
      const finish = (v) => {
        generation++;
        close(v);
      };
      const addr = h('textarea', { class: 'input', rows: 3, placeholder: '地址（可手动输入）' });
      addr.value = loc.address || '';
      const coordText = h('p', { class: 'coord-text' });
      const status = h('p', { class: 'dialog-hint', role: 'status' });
      const actions = h('div', { class: 'row-gap' });

      const fillAddress = async (gen) => {
        if (!geocodeAvailable() || !hasCoords(loc)) return;
        status.textContent = '正在根据坐标查询地址…';
        try {
          const text = await reverseGeocode(loc.lat, loc.lng);
          if (gen !== generation) return;
          if (text) {
            addr.value = text;
            status.textContent = '已根据定位填入地址，可以再修改。';
          } else status.textContent = '没有查到对应地址，请手动填写。';
        } catch (e) {
          if (gen !== generation) return;
          status.textContent = `${e.message}，请手动填写地址。`;
        }
        render();
      };

      const render = () => {
        coordText.textContent = hasCoords(loc)
          ? `已保存坐标：${formatCoords(loc)}${loc.accuracy ? `（精度约 ${Math.round(loc.accuracy)} 米）` : ''}`
          : '未保存坐标';
        actions.textContent = '';
        if (locating) {
          actions.appendChild(
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: () => {
                  generation++;
                  locating = false;
                  status.textContent = '已取消定位。';
                  render();
                },
              },
              '取消定位'
            )
          );
          return;
        }
        actions.appendChild(h('button', { class: 'btn', type: 'button', onclick: locate }, '获取当前位置'));
        if (hasCoords(loc) && geocodeAvailable()) {
          actions.appendChild(h('button', { class: 'btn', type: 'button', onclick: () => fillAddress(generation) }, '按坐标填写地址'));
        }
        if (hasCoords(loc)) {
          actions.appendChild(
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: () => {
                  delete loc.lat;
                  delete loc.lng;
                  delete loc.accuracy;
                  status.textContent = '已清除坐标（保存后生效）。';
                  render();
                },
              },
              '清除坐标'
            )
          );
        }
      };

      let locating = false;
      const locate = () => {
        if (!('geolocation' in navigator)) {
          status.textContent = '当前浏览器不支持定位，请手动输入地址。';
          return;
        }
        const gen = ++generation;
        locating = true;
        status.textContent = '正在获取位置…（需要你在浏览器弹窗中允许）';
        render();
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (gen !== generation) return;
            locating = false;
            loc.lat = Number(pos.coords.latitude.toFixed(7));
            loc.lng = Number(pos.coords.longitude.toFixed(7));
            loc.accuracy = pos.coords.accuracy;
            loc.capturedAt = app.store.now();
            status.textContent = geocodeAvailable() ? '已获取当前位置。' : '已获取当前位置。文字地址请在上方手动填写。';
            render();
            fillAddress(gen);
          },
          (err) => {
            if (gen !== generation) return;
            locating = false;
            status.textContent =
              err.code === 1 ? '你拒绝了定位权限，可以直接手动输入地址。' : '获取位置失败（信号弱或超时），可以稍后重试或手动输入地址。';
            render();
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      };

      const save = () => {
        const next = { ...loc, address: addr.value.trim() };
        if (app.mutate((a) => A.setLocation(a, nodeId, next))) finish(true);
      };
      const remove = async () => {
        if (!(await confirmDialog('删除这个框里保存的地点（地址和坐标）？', { danger: true, okLabel: '删除' }))) return;
        if (app.mutate((a) => A.setLocation(a, nodeId, null))) finish(true);
      };
      render();
      return h(
        'div',
        { class: 'loc-form' },
        addr,
        coordText,
        actions,
        status,
        buttons(
          hadLocation ? h('button', { class: 'btn btn-danger-text', onclick: remove }, '删除地点') : null,
          h('button', { class: 'btn', onclick: () => finish() }, '取消'),
          h('button', { class: 'btn btn-primary', onclick: save }, '保存')
        )
      );
    },
    { title: '编辑地点', onClose: () => generation++ }
  );
}
