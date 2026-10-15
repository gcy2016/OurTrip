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

function regionInfo(app, id) {
  if (!id) return h('p', { class: 'map-info muted' }, '点地图上的区域查看点亮时间');
  const lit = app.lit.has(id);
  const date = lit ? app.litDate(id) : null;
  return h(
    'p',
    { class: `map-info${lit ? ' lit' : ''}`, role: 'status' },
    h('strong', null, app.regionName(id)),
    lit ? (date ? `　${dotted(date)} 点亮` : '　已点亮') : '　未点亮'
  );
}

function drawMap(app, data) {
  const [vx, vy, vw, vh] = data.viewBox;
  const markers = (data.markers || []).filter((id) => data.regions[id]);
  // 港澳台在地图右侧另加标注（引线指向实际位置）
  const labelW = vw * 0.16;
  const extra = markers.length ? labelW + vw * 0.05 : 0;
  const root = svg('svg', { viewBox: `${vx} ${vy} ${vw + extra} ${vh}`, class: 'china-map', role: 'img', 'aria-label': '已点亮区域地图' });
  const pick = (id) => {
    selected = id;
    app.render();
  };
  const g = svg('g', { class: 'provinces' });
  // 选中的区域最后画，描边不会被相邻区域盖住
  const entries = Object.entries(data.regions).sort((x, y) => (x[0] === selected) - (y[0] === selected));
  for (const [id, d] of entries) {
    const p = svg('path', { d, class: `prov${app.lit.has(id) ? ' lit' : ''}${selected === id ? ' sel' : ''}`, 'data-id': id, tabindex: 0, role: 'button', 'aria-label': app.regionName(id) });
    p.addEventListener('click', () => pick(id));
    p.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && pick(id));
    g.appendChild(p);
  }
  root.appendChild(g);
  const dg = svg('g', { class: 'dashes' });
  for (const d of data.dashes || []) dg.appendChild(svg('path', { d }));
  root.appendChild(dg);

  if (markers.length) {
    const lx = vx + vw + vw * 0.04;
    const lh = vh * 0.06;
    const pts = markers.map((id) => {
      const b = pathBBox(data.regions[id]);
      return { id, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
    });
    pts.sort((a, b) => a.cy - b.cy);
    let lastY = -Infinity;
    for (const pt of pts) {
      const y = Math.max(pt.cy - lh / 2, lastY + lh * 1.3);
      lastY = y;
      const lit = app.lit.has(pt.id);
      const mg = svg('g', { class: `marker${lit ? ' lit' : ''}${selected === pt.id ? ' sel' : ''}`, 'data-id': pt.id, tabindex: 0, role: 'button', 'aria-label': app.regionName(pt.id) });
      mg.appendChild(svg('line', { x1: pt.cx, y1: pt.cy, x2: lx, y2: y + lh / 2 }));
      mg.appendChild(svg('circle', { cx: pt.cx, cy: pt.cy, r: vw * 0.006 }));
      mg.appendChild(svg('rect', { x: lx, y, width: labelW, height: lh, rx: lh * 0.3 }));
      mg.appendChild(svg('text', { x: lx + labelW / 2, y: y + lh * 0.68, 'font-size': lh * 0.56, 'text-anchor': 'middle' }, app.regionName(pt.id)));
      mg.addEventListener('click', () => pick(pt.id));
      mg.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && pick(pt.id));
      root.appendChild(mg);
    }
  }
  return root;
}

export function mapView(app) {
  if (mapState.status === 'idle') loadMap(app);
  const level1 = app.regions.level1;
  const litCount = level1.filter((id) => app.lit.has(id)).length;
  const head = h('div', { class: 'page-head' }, h('h1', null, '地图'), h('p', { class: 'sub' }, `已点亮 ${litCount}/${level1.length} 个一级区域`));
  let body;
  if (mapState.status === 'loading' || mapState.status === 'idle') body = h('p', { class: 'muted' }, '正在载入地图…');
  else if (mapState.status === 'missing') body = h('div', { class: 'empty' }, '地图尚未上传。请用维护工具上传地图文件后再来查看。');
  else if (mapState.status === 'error') {
    body = h('div', { class: 'empty' }, `地图载入失败：${mapState.error}`, h('div', null, h('button', { class: 'btn btn-small', onclick: () => loadMap(app) }, '重试')));
  } else {
    if (selected && !app.regions.byId.has(selected)) selected = null;
    body = h(
      'div',
      { class: 'map-wrap' },
      h('div', { class: 'map-card' }, drawMap(app, mapState.data)),
      regionInfo(app, selected),
      h('div', { class: 'map-legend' }, h('span', { class: 'legend lit' }, '已点亮'), h('span', { class: 'legend' }, '未点亮'))
    );
  }
  return h('section', null, head, body);
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
 * 时间线布局（纯计算）：点在轴上的位置与真实时间成比例；卡片左右交替，
 * 同侧放不下时顺延到下方（用引线连到实际日期），同一天的多个区域按顺序依次排列。
 */
export function layoutTimeline(items, { cardH, gap = 10, top = 24 }) {
  if (!items.length) return { items: [], height: 0, startDay: 0 };
  const startDay = dayNumber(items[0].date);
  const bottom = [top - gap, top - gap];
  const out = items.map((it, i) => {
    const y = top + (dayNumber(it.date) - startDay) * PX_PER_DAY;
    const side = i % 2;
    const cardY = Math.max(y - cardH / 2, bottom[side] + gap, top);
    bottom[side] = cardY + cardH;
    return { ...it, y, side, cardY };
  });
  const height = Math.max(...bottom, out[out.length - 1].y) + top;
  return { items: out, height, startDay };
}

export function timelineView(app) {
  const items = litDateRegions(app.regions)
    .filter((id) => app.lit.has(id))
    .map((id) => ({ id, date: app.litDate(id) }))
    .filter((x) => x.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const head = h('div', { class: 'page-head' }, h('h1', null, '时间线'), h('p', { class: 'sub' }, items.length ? `${items.length} 个区域 · ${dotted(items[0].date)} 起` : ''));
  if (!items.length) return h('section', null, head, h('div', { class: 'empty' }, '还没有点亮的区域。'));

  const width = Math.min(document.documentElement.clientWidth || 360, 1200) - 40;
  const cardW = Math.max(96, Math.min(150, Math.floor(width / 2 - 34)));
  const { items: laid, height, startDay } = layoutTimeline(items, { cardH: cardW });
  const box = h('div', { class: 'timeline', style: { height: `${Math.ceil(height)}px`, '--tl-card': `${cardW}px` } });
  box.appendChild(h('div', { class: 'tl-axis' }));

  // 月份刻度；1 月标出年份
  const last = laid[laid.length - 1];
  const [y0, m0] = items[0].date.split('-').map(Number);
  for (let y = y0, m = m0; ; m++) {
    if (m > 12) {
      m = 1;
      y++;
    }
    const day = Math.round(Date.UTC(y, m - 1, 1) / DAY_MS);
    const top = 24 + (day - startDay) * PX_PER_DAY;
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
