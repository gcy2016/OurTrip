// 只读页面：地图、时间线。数据单向来自首页的点亮状态与点亮日期，这里不做任何修改。

import { h } from './ui.js';
import { litDateRegions } from './album.js';
import { MAP_KEY, validMapData, pathBBox, L2_INDEX_KEY, l2Key, validL2Data, labelPoint } from './region-names.js';

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
let selected2 = null; // 二级地图里选中的二级区域
let l2Index = new Set(); // 已上传二级地图的一级区域
const l2Cache = new Map(); // 一级区域 → { status, data, error }

async function loadMap(app) {
  mapState = { status: 'loading', data: null, error: '' };
  try {
    const rec = await app.store.getJSON(MAP_KEY);
    if (!rec) mapState = { status: 'missing', data: null, error: '' };
    else if (!validMapData(rec.data)) mapState = { status: 'error', data: null, error: '地图文件格式不正确' };
    else mapState = { status: 'ready', data: rec.data, error: '' };
    try {
      const idx = await app.store.getJSON(L2_INDEX_KEY);
      l2Index = new Set((idx && idx.data && idx.data.ids) || []);
    } catch {
      l2Index = new Set(); // 读不到二级地图目录时只显示全国地图
    }
  } catch (e) {
    mapState = { status: 'error', data: null, error: e.message || '读取失败' };
  }
  app.render();
}

function regionInfo(app, sel) {
  if (!sel) return h('div', { class: 'map-info muted' }, '点地图上的区域查看点亮时间');
  const lit = app.lit.has(sel);
  const date = lit ? app.litDate(sel) : null;
  const r = app.regions.byId.get(sel);
  // 已点亮、有二级区域且已上传二级地图的省份：可以展开二级地图（提示内容不变）
  const canOpen = lit && r && r.level === 1 && r.children.length > 0 && l2Index.has(sel);
  return h(
    'div',
    { class: 'map-info', role: 'status' },
    h('p', { class: lit ? 'lit' : '' }, h('strong', null, app.regionName(sel)), `　${lit ? (date ? `${dotted(date)} 点亮` : '已点亮') : '未点亮'}`),
    canOpen ? h('a', { class: 'btn btn-small btn-primary l2-open', href: `#/map/${sel}` }, '查看二级地图') : null
  );
}

/** 面积很小、在全国地图上看不清的区域（港澳）：在地图外加标注。依据形状大小判断，不依赖名称 */
function smallRegions(data, vw) {
  return (data.markers || []).filter((id) => {
    const d = data.regions[id];
    if (!d) return false;
    const b = pathBBox(d);
    return Math.max(b.w, b.h) < vw * 0.02;
  });
}

/** 线段是否穿过矩形（向外扩 margin）：用采样判断，足够精确 */
function segmentHitsBox(x1, y1, x2, y2, b, margin) {
  for (let i = 0; i <= 60; i++) {
    const x = x1 + ((x2 - x1) * i) / 60;
    const y = y1 + ((y2 - y1) * i) / 60;
    if (x > b.x - margin && x < b.x + b.w + margin && y > b.y - margin && y < b.y + b.h + margin) return true;
  }
  return false;
}

function boxGap(a, b) {
  return Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
}

/**
 * 南海诸岛：最南端区域的路径里，远离该区域主体（面积最大的一块）的小岛。
 * 从主图中拿出来，放进台湾右侧的小框，主图显示范围只按大陆与近岸岛屿计算。依据形状判断，不依赖名称。
 */
export function splitIslands(regions) {
  let south = null;
  let maxY = -Infinity;
  for (const [id, d] of Object.entries(regions)) {
    const b = pathBBox(d);
    if (b.y + b.h > maxY) {
      maxY = b.y + b.h;
      south = id;
    }
  }
  const subs = (regions[south] || '').match(/M[^M]*/g) || [];
  if (subs.length < 2) return { regions, islandsOf: null, islands: [] };
  const area = (sp) => {
    const b = pathBBox(sp);
    return b.w * b.h;
  };
  const main = subs.reduce((a, b) => (area(b) > area(a) ? b : a));
  const mb = pathBBox(main);
  const all = pathBBox(Object.values(regions).join(' '));
  const tol = all.w * 0.01;
  const islands = subs.filter((sp) => sp !== main && boxGap(pathBBox(sp), mb) > tol);
  if (!islands.length) return { regions, islandsOf: null, islands: [] };
  const rest = subs.filter((sp) => !islands.includes(sp)).join('');
  return { regions: { ...regions, [south]: rest }, islandsOf: south, islands };
}

function drawMap(app, data) {
  // 显示范围只按各省边界计算（不含九段线；南海诸岛另放小框），尽量放大地图主体
  const { regions, islandsOf, islands } = splitIslands(data.regions);
  const box = pathBBox(Object.values(regions).join(' '));
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
  const entries = Object.entries(regions).sort((x, y) => (x[0] === selected) - (y[0] === selected));
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

  // 台湾等较大的标注区域直接显示，不另加标注；港澳在台湾右侧、南海诸岛小框左侧列出标注
  const big = (data.markers || []).filter((id) => regions[id] && !dots.includes(id)).map((id) => pathBBox(regions[id]));
  const gap = vw * 0.02;
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  const labelW = vw * 0.07;
  const lh = vw * 0.028;
  const bigRight = big.length ? Math.max(...big.map((b) => b.x + b.w)) : right - vw * 0.25;
  const labelX = bigRight + gap;

  if (islands.length) {
    // 南海诸岛小框：港澳标注右侧到地图右边界之间的海面上，不占用大陆的显示空间
    const ib = pathBBox(islands.join(' '));
    const left = labelX + (dots.length ? labelW + gap : 0);
    const top = big.length ? Math.min(...big.map((b) => b.y)) : bottom - vh * 0.3;
    const fw = right - left;
    const fh = bottom - top;
    const k = Math.min((fw * 0.86) / ib.w, (fh * 0.8) / ib.h);
    const fwUsed = (ib.w * k) / 0.86;
    const fhUsed = (ib.h * k) / 0.8;
    const fx = right - fwUsed;
    const fy = bottom - fhUsed;
    const lit = app.lit.has(islandsOf);
    const inset = svg('g', { class: `inset${lit ? ' lit' : ''}${selected === islandsOf ? ' sel' : ''}`, 'data-id': islandsOf, tabindex: 0, role: 'button', 'aria-label': '南海诸岛' });
    inset.appendChild(svg('rect', { class: 'frame', x: fx, y: fy, width: fwUsed, height: fhUsed, rx: vw * 0.004 }));
    const tx = fx + (fwUsed - ib.w * k) / 2 - ib.x * k;
    const ty = fy + fhUsed - ib.h * k - fhUsed * 0.06 - ib.y * k;
    const ig = svg('g', { transform: `translate(${tx} ${ty}) scale(${k})` });
    for (const sp of islands) ig.appendChild(svg('path', { d: sp, class: 'isle' }));
    inset.appendChild(ig);
    inset.appendChild(svg('text', { x: fx + fwUsed / 2, y: fy + fhUsed * 0.11, 'font-size': fhUsed * 0.07, 'text-anchor': 'middle' }, '南海诸岛'));
    bind(inset, islandsOf);
    root.appendChild(inset);
  }

  if (dots.length) {
    // 港澳：原位置一个小圆点，引线连到右侧的名称标注；引线绕开台湾（从台湾下方经过）
    const pts = dots
      .map((id) => {
        const b = pathBBox(regions[id]);
        return { id, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
      })
      .sort((a, b) => a.cy - b.cy);
    const maxY = vy + vh - lh;
    let lastY = -Infinity;
    for (const pt of pts) {
      let y = Math.max(pt.cy - lh / 2, lastY + lh * 1.3);
      while (y < maxY && big.some((b) => segmentHitsBox(pt.cx, pt.cy, labelX, y + lh / 2, b, gap * 0.3))) y += lh * 0.25;
      y = Math.min(y, maxY);
      lastY = y;
      const lit = app.lit.has(pt.id);
      const mg = svg('g', { class: `marker${lit ? ' lit' : ''}${selected === pt.id ? ' sel' : ''}`, 'data-id': pt.id, tabindex: 0, role: 'button', 'aria-label': app.regionName(pt.id) });
      mg.appendChild(svg('line', { x1: pt.cx, y1: pt.cy, x2: labelX, y2: y + lh / 2 }));
      mg.appendChild(svg('circle', { cx: pt.cx, cy: pt.cy, r: vw * 0.004 }));
      mg.appendChild(svg('rect', { x: labelX, y, width: labelW, height: lh, rx: lh * 0.3 }));
      mg.appendChild(svg('text', { x: labelX + labelW / 2, y: y + lh * 0.7, 'font-size': lh * 0.6, 'text-anchor': 'middle' }, app.regionName(pt.id)));
      bind(mg, pt.id);
      root.appendChild(mg);
    }
  }
  return { root, dots };
}

export function mapView(app, l1Id = null) {
  if (mapState.status === 'idle') loadMap(app);
  if (l1Id && mapState.status === 'ready') return l2View(app, l1Id);
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
    if (selected && !app.regions.byId.has(selected)) selected = null;
    const { root } = drawMap(app, mapState.data);
    body = h(
      'div',
      { class: 'map-body' },
      h('div', { class: 'map-canvas' }, root),
      h(
        'div',
        { class: 'map-side' },
        regionInfo(app, selected),
        h('div', { class: 'map-legend' }, h('span', { class: 'legend lit' }, '已点亮'), h('span', { class: 'legend' }, '未点亮'))
      )
    );
  }
  // 横向展示：竖屏时整页旋转 90°，不依赖锁定屏幕方向，也不提示用户旋转手机
  return h('section', { class: 'map-stage' }, head, body);
}

// ---------- 二级地图（点亮的省份展开） ----------

async function loadL2(app, l1Id) {
  l2Cache.set(l1Id, { status: 'loading' });
  try {
    const rec = await app.store.getJSON(l2Key(l1Id));
    if (!rec) l2Cache.set(l1Id, { status: 'missing' });
    else if (!validL2Data(rec.data, l1Id)) l2Cache.set(l1Id, { status: 'error', error: '二级地图文件格式不正确' });
    else l2Cache.set(l1Id, { status: 'ready', data: rec.data });
  } catch (e) {
    l2Cache.set(l1Id, { status: 'error', error: e.message || '读取失败' });
  }
  app.render();
}

function drawL2(app, data, dateInMap) {
  const [vx, vy, vw, vh] = data.viewBox;
  const root = svg('svg', { viewBox: `${vx} ${vy} ${vw} ${vh}`, class: 'china-map l2-map', role: 'img', 'aria-label': '二级区域地图' });
  const pick = (id) => {
    selected2 = id;
    app.render();
  };
  const g = svg('g', { class: 'provinces' });
  for (const d of data.others || []) g.appendChild(svg('path', { d, class: 'other' }));
  const entries = Object.entries(data.regions).sort((x, y) => (x[0] === selected2) - (y[0] === selected2));
  for (const [id, d] of entries) {
    const p = svg('path', { d, class: `prov${app.lit.has(id) ? ' lit' : ''}${selected2 === id ? ' sel' : ''}`, 'data-id': id, tabindex: 0, role: 'button', 'aria-label': app.regionName(id) });
    p.addEventListener('click', () => pick(id));
    p.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && pick(id));
    g.appendChild(p);
  }
  root.appendChild(g);
  // 所有二级区域都显示名称（不论是否点亮）；字号随区域大小缩放
  const labels = svg('g', { class: 'l2-labels' });
  const base = Math.max(vw, vh) * 0.026;
  for (const [id, d] of Object.entries(data.regions)) {
    const b = pathBBox(d);
    const pt = labelPoint(d);
    const name = app.regionName(id);
    const fs = Math.max(base * 0.55, Math.min(base, (b.w * 0.8) / Math.max(2, [...name].length), b.h * 0.35));
    const lit = app.lit.has(id);
    const date = lit ? app.litDate(id) : null;
    const showDate = dateInMap && date;
    labels.appendChild(svg('text', { x: pt.x, y: showDate ? pt.y - fs * 0.15 : pt.y + fs * 0.35, 'font-size': fs, 'text-anchor': 'middle', class: lit ? 'lit' : '' }, name));
    if (showDate) labels.appendChild(svg('text', { x: pt.x, y: pt.y + fs * 0.85, 'font-size': fs * 0.62, 'text-anchor': 'middle', class: 'date' }, dotted(date)));
  }
  root.appendChild(labels);
  return root;
}

function l2View(app, l1Id) {
  const r = app.regions.byId.get(l1Id);
  if (!r || !r.children.length) return h('section', { class: 'map-stage' }, h('div', { class: 'empty' }, '这个区域没有二级地图。', h('a', { class: 'btn btn-small', href: '#/map' }, '返回地图')));
  const st = l2Cache.get(l1Id);
  if (!st) loadL2(app, l1Id);
  const litKids = r.children.filter((c) => app.lit.has(c)).length;
  const head = h(
    'div',
    { class: 'map-head' },
    h('a', { class: 'btn btn-small', href: '#/map' }, '‹ 全国'),
    h('h1', null, app.regionName(l1Id)),
    h('span', { class: 'sub' }, `已点亮 ${litKids}/${r.children.length} 个二级区域`)
  );
  // 点亮时间的显示方式：A 直接写在区域内；B 点击区域后显示（默认）
  const dateInMap = (app.l2DateMode || 'B') === 'A';
  let body;
  if (!st || st.status === 'loading') body = h('p', { class: 'muted' }, '正在载入二级地图…');
  else if (st.status === 'missing') body = h('div', { class: 'empty' }, '这个省的二级地图尚未上传。');
  else if (st.status === 'error') body = h('div', { class: 'empty' }, `二级地图载入失败：${st.error}`, h('div', null, h('button', { class: 'btn btn-small', onclick: () => loadL2(app, l1Id) }, '重试')));
  else {
    if (selected2 && !st.data.regions[selected2]) selected2 = null;
    body = h(
      'div',
      { class: 'map-body' },
      h('div', { class: 'map-canvas' }, drawL2(app, st.data, dateInMap)),
      h(
        'div',
        { class: 'map-side' },
        regionInfo(app, selected2),
        h('div', { class: 'map-legend' }, h('span', { class: 'legend lit' }, '已点亮'), h('span', { class: 'legend' }, '未点亮'))
      )
    );
  }
  return h('section', { class: 'map-stage' }, head, body);
}

/** 退出登录或换账号时清空缓存的地图 */
export function resetViews() {
  mapState = { status: 'idle', data: null, error: '' };
  selected = null;
  selected2 = null;
  l2Index = new Set();
  l2Cache.clear();
}

// ---------- 时间线 ----------

export const PX_PER_MONTH = 120;
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
  // 方框为首页大小的约 2/3，让不同时间的方框之间留出距离
  const cardW = Math.max(64, Math.min(100, Math.floor(((width / 2 - 34) * 2) / 3)));
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
