// 只读页面：地图、时间线。数据单向来自首页的点亮状态与点亮日期，这里不做任何修改。

import { h } from './ui.js';
import { litDateRegions } from './album.js';
import { MAP_KEY, validMapData, pathBBox } from './region-names.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

const dotted = (date) => date.replace(/-/g, '.');

// ---------- 地图 ----------

let mapState = { status: 'idle', data: null, error: '' }; // idle | loading | ready | missing | error
let selected = null;

async function loadMap(app) {
  mapState = { status: 'loading', data: null, error: '' };
  try {
    const rec = await app.store.getJSON(MAP_KEY);
    if (!rec) mapState = { status: 'missing', data: null, error: '' };
    else if (!validMapData(rec.data)) mapState = { status: 'error', data: null, error: '地图文件格式不正确' };
    else mapState = { status: 'ready', data: rec.data, error: '' };
  } catch (e) {
    mapState = { status: 'error', data: null, error: e.message || '读取失败' };
  }
  app.render();
}

const HKMO = '__dots__'; // 香港、澳门共用的点击热区

function litText(app, id, unlitText) {
  if (!app.lit.has(id)) return unlitText;
  const date = app.litDate(id);
  return date ? `${dotted(date)} 点亮` : '已点亮';
}

function regionInfo(app, sel, dots) {
  if (!sel) return h('div', { class: 'map-info muted' }, '点地图上的区域查看点亮时间');
  // 港澳：同时显示两地各自的状态和时间
  if (sel === HKMO) {
    return h(
      'div',
      { class: 'map-info', role: 'status' },
      dots.map((id) => h('p', { class: app.lit.has(id) ? 'lit' : '' }, h('strong', null, app.regionName(id)), `　${litText(app, id, '暂未点亮')}`))
    );
  }
  return h('div', { class: 'map-info', role: 'status' }, h('p', { class: app.lit.has(sel) ? 'lit' : '' }, h('strong', null, app.regionName(sel)), `　${litText(app, sel, '未点亮')}`));
}

/** 面积很小、在全国地图上看不清的区域（港澳）：在原位置画成小点。依据形状大小判断，不依赖名称 */
function smallRegions(data, vw) {
  return (data.markers || []).filter((id) => {
    const d = data.regions[id];
    if (!d) return false;
    const b = pathBBox(d);
    return Math.max(b.w, b.h) < vw * 0.02;
  });
}

function drawMap(app, data) {
  // 显示范围只按各省边界计算（不含九段线），尽量放大地图主体
  const box = pathBBox(Object.values(data.regions).join(' '));
  const pad = Math.max(box.w, box.h) * 0.015;
  const vx = box.x - pad;
  const vy = box.y - pad;
  const vw = box.w + pad * 2;
  const vh = box.h + pad * 2;
  const dots = smallRegions(data, vw);
  const root = svg('svg', { viewBox: `${vx} ${vy} ${vw} ${vh}`, class: 'china-map', role: 'img', 'aria-label': '已点亮区域地图' });
  const pick = (id) => {
    selected = id;
    app.render();
  };
  const bind = (el, id) => {
    el.addEventListener('click', () => pick(id));
    el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && pick(id));
  };
  const g = svg('g', { class: 'provinces' });
  // 选中的区域最后画，描边不会被相邻区域盖住
  const entries = Object.entries(data.regions).sort((x, y) => (x[0] === selected) - (y[0] === selected));
  for (const [id, d] of entries) {
    const dot = dots.includes(id);
    const p = svg('path', {
      d,
      class: `prov${app.lit.has(id) ? ' lit' : ''}${selected === id ? ' sel' : ''}`,
      'data-id': id,
      tabindex: dot ? null : 0,
      role: dot ? null : 'button',
      'aria-label': dot ? null : app.regionName(id),
    });
    if (!dot) bind(p, id);
    g.appendChild(p);
  }
  root.appendChild(g);

  if (dots.length) {
    // 港澳：原位置两个小点，点亮后发亮；两点附近一个共同的点击热区
    const pts = dots.map((id) => {
      const b = pathBBox(data.regions[id]);
      return { id, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
    });
    const cx = pts.reduce((t, p) => t + p.cx, 0) / pts.length;
    const cy = pts.reduce((t, p) => t + p.cy, 0) / pts.length;
    const spread = Math.max(...pts.map((p) => Math.hypot(p.cx - cx, p.cy - cy)));
    const r = Math.max(spread + vw * 0.012, vw * 0.022);
    const hot = svg('g', { class: `dots${selected === HKMO ? ' sel' : ''}`, 'data-id': HKMO, tabindex: 0, role: 'button', 'aria-label': dots.map((id) => app.regionName(id)).join('、') });
    hot.appendChild(svg('circle', { class: 'hot', cx, cy, r }));
    for (const p of pts) hot.appendChild(svg('circle', { class: `dot${app.lit.has(p.id) ? ' lit' : ''}`, 'data-id': p.id, cx: p.cx, cy: p.cy, r: vw * 0.0055 }));
    bind(hot, HKMO);
    root.appendChild(hot);
  }
  return { root, dots };
}

export function mapView(app) {
  if (mapState.status === 'idle') loadMap(app);
  const level1 = app.regions.level1;
  const litCount = level1.filter((id) => app.lit.has(id)).length;
  const head = h(
    'div',
    { class: 'map-head' },
    h('a', { class: 'btn btn-small', href: '#/' }, '‹ 返回'),
    h('h1', null, '地图'),
    h('span', { class: 'sub' }, `已点亮 ${litCount}/${level1.length} 个一级区域`)
  );
  let body;
  if (mapState.status === 'loading' || mapState.status === 'idle') body = h('p', { class: 'muted' }, '正在载入地图…');
  else if (mapState.status === 'missing') body = h('div', { class: 'empty' }, '地图尚未上传。请用维护工具上传地图文件后再来查看。');
  else if (mapState.status === 'error') {
    body = h('div', { class: 'empty' }, `地图载入失败：${mapState.error}`, h('div', null, h('button', { class: 'btn btn-small', onclick: () => loadMap(app) }, '重试')));
  } else {
    if (selected && selected !== HKMO && !app.regions.byId.has(selected)) selected = null;
    const { root, dots } = drawMap(app, mapState.data);
    body = h(
      'div',
      { class: 'map-body' },
      h('div', { class: 'map-canvas' }, root),
      h(
        'div',
        { class: 'map-side' },
        regionInfo(app, selected, dots),
        h('div', { class: 'map-legend' }, h('span', { class: 'legend lit' }, '已点亮'), h('span', { class: 'legend' }, '未点亮'))
      )
    );
  }
  // 横向展示：竖屏时整页旋转 90°，不依赖锁定屏幕方向，也不提示用户旋转手机
  return h('section', { class: 'map-stage' }, head, body);
}

/** 退出登录或换账号时清空缓存的地图 */
export function resetViews() {
  mapState = { status: 'idle', data: null, error: '' };
  selected = null;
}

// ---------- 时间线 ----------

export const PX_PER_MONTH = 60;
const DAY_MS = 86400000;
const PX_PER_DAY = PX_PER_MONTH / 30.44;

function dayNumber(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/**
 * 时间线布局（纯计算）：items 按从上到下的顺序给出（最新的在最上面），点在轴上的位置与真实时间成比例；
 * 卡片左右交替，同侧放不下时顺延到下方（用引线连到实际日期），同一天的多个区域依次排列。
 */
export function layoutTimeline(items, { cardH, gap = 10, top = 24 }) {
  if (!items.length) return { items: [], height: 0, startDay: 0 };
  const startDay = dayNumber(items[0].date);
  const bottom = [top - gap, top - gap];
  const out = items.map((it, i) => {
    const y = top + Math.abs(startDay - dayNumber(it.date)) * PX_PER_DAY;
    const side = i % 2;
    const cardY = Math.max(y - cardH / 2, bottom[side] + gap, top);
    bottom[side] = cardY + cardH;
    return { ...it, y, side, cardY };
  });
  const height = Math.max(...bottom, out[out.length - 1].y) + top;
  return { items: out, height, startDay };
}

export function timelineView(app) {
  // 倒序：最新点亮的在最上面，往下翻是更早的。同一天里后点亮的在上面（没有记录点亮时刻的旧数据按编号排）
  const items = litDateRegions(app.regions)
    .filter((id) => app.lit.has(id))
    .map((id) => ({ id, date: app.litDate(id), at: app.litAt(id) }))
    .filter((x) => x.date)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.at - a.at || (a.id < b.id ? -1 : 1)));
  const head = h('div', { class: 'page-head' }, h('h1', null, '时间线'), h('p', { class: 'sub' }, items.length ? `${items.length} 个区域 · 最近 ${dotted(items[0].date)}` : ''));
  if (!items.length) return h('section', null, head, h('div', { class: 'empty' }, '还没有点亮的区域。'));

  const width = Math.min(document.documentElement.clientWidth || 360, 1200) - 40;
  const cardW = Math.max(96, Math.min(150, Math.floor(width / 2 - 34)));
  const { items: laid, height, startDay } = layoutTimeline(items, { cardH: cardW });
  const box = h('div', { class: 'timeline', style: { height: `${Math.ceil(height)}px`, '--tl-card': `${cardW}px` } });
  box.appendChild(h('div', { class: 'tl-axis' }));

  // 月份刻度（从最新往前）；1 月标出年份
  const last = laid[laid.length - 1];
  const [y0, m0] = items[0].date.split('-').map(Number);
  for (let y = y0, m = m0; ; m--) {
    if (m < 1) {
      m = 12;
      y--;
    }
    const day = Math.round(Date.UTC(y, m - 1, 1) / DAY_MS);
    const top = 24 + (startDay - day) * PX_PER_DAY;
    if (top > last.y + 1) break;
    if (top >= 24 - 1) box.appendChild(h('div', { class: `tl-tick${m === 1 ? ' year' : ''}`, style: { top: `${top}px` } }, h('span', null, m === 1 ? `${y}年` : `${m}月`)));
  }

  for (const it of laid) {
    const left = it.side === 0;
    const cardMid = it.cardY + cardW / 2;
    box.appendChild(h('div', { class: 'tl-dot', style: { top: `${it.y}px` } }));
    // 引线：从轴上的日期点连到卡片
    const x1 = 0;
    const dy = cardMid - it.y;
    const len = Math.hypot(22, dy);
    const ang = (Math.atan2(dy, left ? -22 : 22) * 180) / Math.PI;
    box.appendChild(h('div', { class: 'tl-link', style: { top: `${it.y}px`, left: `calc(50% + ${x1}px)`, width: `${len}px`, transform: `rotate(${ang}deg)` } }));
    const card = h(
      'div',
      { class: `tl-card ${left ? 'left' : 'right'}`, style: { top: `${it.cardY}px` }, dataset: { id: it.id, date: it.date } },
      app.regionTile(it.id)
    );
    box.appendChild(card);
  }
  return h('section', null, head, box);
}
