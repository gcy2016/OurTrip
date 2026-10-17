// 旅行树页（只读）：数据单向来自首页的点亮状态与点亮日期，这里不做任何修改。
// 排序与几何全部在 js/tree.js 中算好，这里只负责画（SVG 画树干与枝条，区域框复用首页方框）。

import { h, confirmDialog } from './ui.js';
import { buildTreeModel, layoutTree } from './tree.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

const dotted = (date) => date.replace(/-/g, '.');
const f = (n) => Math.round(n * 10) / 10;

let selected = null; // 点开名称的一级区域
let scrollLeft = null; // 树区域的横向位置（重新渲染时保持；第一次打开时让树干居中）

export function resetTree() {
  selected = null;
  scrollLeft = null;
}

/** 首页入口能否进入：有可用于建立根基的已点亮一级区域 */
export function treeModel(app) {
  return buildTreeModel({ regions: app.regions, lit: app.lit, litDate: (id) => app.litDate(id), nameOf: (id) => app.regionName(id) });
}

/** 树干一段：两侧是略带弧度的曲线，上下两端水平，相邻两段首尾宽度相同 */
function segmentPath(s, Y) {
  const ym = (s.y0 + s.y1) / 2;
  const wm = (s.w0 + s.w1) / 2;
  return [
    `M${f(-s.w0)} ${f(Y(s.y0))}`,
    `Q${f(-wm - s.bulgeL)} ${f(Y(ym))} ${f(-s.w1)} ${f(Y(s.y1))}`,
    s.tip ? `Q0 ${f(Y(s.y1 + s.w1 * 2))} ${f(s.w1)} ${f(Y(s.y1))}` : `L${f(s.w1)} ${f(Y(s.y1))}`,
    `Q${f(wm + s.bulgeR)} ${f(Y(ym))} ${f(s.w0)} ${f(Y(s.y0))}Z`,
  ].join('');
}

/** 主枝：沿中心线两侧偏移出轮廓，末端收尖 */
function branchPath(b, Y) {
  const top = b.points.map((p) => `${f(p.x)} ${f(Y(p.y + p.w / 2))}`);
  const bottom = b.points.map((p) => `${f(p.x)} ${f(Y(p.y - p.w / 2))}`).reverse();
  const tip = b.points[b.points.length - 1];
  return `M${top.join('L')}L${f(tip.x + b.side * 3)} ${f(Y(tip.y))}L${bottom.join('L')}Z`;
}

/** 根基的树根：从树干底部向两侧伸进土里 */
function rootPaths(t, Y) {
  const out = [];
  const top = t.root.top;
  const half = t.root.kind === 'box' ? t.boxes[0].size / 2 : 14;
  const spread = [
    [-1, 0.55, 46],
    [-1, 0.2, 74],
    [1, 0.35, 58],
    [1, 0.75, 88],
  ];
  for (const [side, from, reach] of spread) {
    const x0 = side * half * (t.root.kind === 'box' ? 1 : from);
    const y0 = t.root.kind === 'box' ? top * from : top;
    const x1 = side * (half + reach);
    out.push(`M${f(x0)} ${f(Y(y0))}Q${f(side * (half + reach * 0.35))} ${f(Y(y0 * 0.3))} ${f(x1)} ${f(Y(-4))}`);
  }
  return out;
}

export function treeView(app) {
  const model = treeModel(app);
  // 与首页、一级区域页相同的格式：已点亮 x/333 个二级区域
  const level2 = [...app.regions.byId.values()].filter((r) => r.level === 2);
  const litL2 = level2.filter((r) => app.lit.has(r.id)).length;
  const head = h('div', { class: 'page-head' }, h('h1', null, '旅行树'), h('p', { class: 'sub' }, `已点亮 ${litL2}/${level2.length} 个二级区域`));
  if (!model.root) return h('section', null, head, h('div', { class: 'empty' }, '还没有点亮的区域。'));

  const t = layoutTree(model);
  if (selected && !t.branches.some((b) => b.id === selected) && t.root.id !== selected) selected = null;
  const dateOf = new Map([[t.root.id, t.root.date], ...t.branches.map((b) => [b.id, b.date])]);

  // 画布：左右留白，内容比屏幕窄时树干放在正中
  const pad = 24;
  const viewW = Math.min(document.documentElement.clientWidth || 360, 4000);
  const half = Math.max(-t.bounds.minX, t.bounds.maxX) + pad;
  let width;
  let cx;
  if (half * 2 <= viewW) {
    width = viewW;
    cx = viewW / 2;
  } else {
    width = Math.ceil(t.bounds.maxX - t.bounds.minX + pad * 2);
    cx = pad - t.bounds.minX;
  }
  const height = Math.ceil(t.bounds.maxY + 40);
  const ground = height - 22;
  const Y = (y) => ground - y;

  const pick = (id) => {
    selected = selected === id ? null : id;
    app.render();
  };
  const bindPick = (el, id) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      pick(id);
    });
    el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick(id)));
  };

  const root = svg('svg', { class: 'tree-svg', width, height, viewBox: `${f(-cx)} 0 ${width} ${height}`, 'aria-hidden': 'false' });
  root.appendChild(svg('ellipse', { class: 'tree-ground', cx: 0, cy: Y(-6), rx: 150, ry: 18 }));

  // 根基：树根伸进土里；有二级区域时是一小段底座
  const rootG = svg('g', { class: `tree-l1 tree-root${selected === t.root.id ? ' sel' : ''}`, 'data-id': t.root.id, tabindex: 0, role: 'button', 'aria-label': `根基 ${app.regionName(t.root.id)}` });
  for (const d of rootPaths(t, Y)) rootG.appendChild(svg('path', { class: 'tree-rootline', d }));
  if (t.root.kind === 'base' && t.segments.length) {
    const s = t.segments[0];
    rootG.appendChild(svg('path', { class: 'tree-trunk shade-0', d: `M${-s.w0 - 10} ${Y(-2)}Q${-s.w0} ${Y(4)} ${-s.w0} ${Y(t.root.top)}L${s.w0} ${Y(t.root.top)}Q${s.w0} ${Y(4)} ${s.w0 + 10} ${Y(-2)}Z` }));
  }
  bindPick(rootG, t.root.id);
  root.appendChild(rootG);

  // 主枝在树干下面画，接缝被树干盖住
  const branchG = svg('g', { class: 'tree-branches' });
  for (const b of t.branches) {
    const g = svg('g', { class: `tree-l1${selected === b.id ? ' sel' : ''}`, 'data-id': b.id, tabindex: 0, role: 'button', 'aria-label': app.regionName(b.id) });
    const d = branchPath(b, Y);
    g.appendChild(svg('path', { class: 'tree-hit', d })); // 加宽的透明描边，便于手指点中
    g.appendChild(svg('path', { class: 'tree-branch', d }));
    bindPick(g, b.id);
    branchG.appendChild(g);
  }
  root.appendChild(branchG);

  const twigG = svg('g', { class: 'tree-twigs' });
  for (const w of t.twigs) {
    twigG.appendChild(svg('path', { class: 'tree-twig', 'data-id': w.id, d: `M${f(w.from.x)} ${f(Y(w.from.y))}Q${f(w.ctrl.x)} ${f(Y(w.ctrl.y))} ${f(w.to.x)} ${f(Y(w.to.y))}` }));
  }
  root.appendChild(twigG);

  // 树干：每个一级区域一段，深浅交替，接缝处一条淡线
  const trunkG = svg('g', { class: 'tree-trunks' });
  for (const s of t.segments) {
    const g = svg('g', { class: `tree-l1${selected === s.id ? ' sel' : ''}`, 'data-id': s.id, 'data-seg': s.k });
    g.appendChild(svg('path', { class: `tree-trunk shade-${s.shade}`, d: segmentPath(s, Y) }));
    if (s.k > 0) g.appendChild(svg('line', { class: 'tree-seam', x1: f(-s.w0 + 1.5), x2: f(s.w0 - 1.5), y1: f(Y(s.y0)), y2: f(Y(s.y0)) }));
    bindPick(g, s.id);
    trunkG.appendChild(g);
  }
  root.appendChild(trunkG);
  // 节点：主枝与树干相接处的小圆点
  for (const b of t.branches) {
    const k = svg('circle', { class: `tree-knot${selected === b.id ? ' sel' : ''}`, cx: f(b.knot.x), cy: f(Y(b.knot.y)), r: 3.2, 'data-id': b.id });
    bindPick(k, b.id);
    root.appendChild(k);
  }

  const canvas = h('div', { class: 'tree-canvas', style: { width: `${width}px`, height: `${height}px` } }, root);

  // 区域框：复用首页方框（背景色、封面），隐藏框里的名称和日期；名称写在框外
  for (const b of t.boxes) {
    const name = app.regionName(b.id);
    const open = async (e) => {
      e.preventDefault();
      const ok = await confirmDialog(`点亮时间：${dotted(b.date)}`, { title: name, okLabel: '进入该区域' });
      if (ok) app.go(`#/r/${b.id}`);
    };
    const left = cx + b.x;
    const top = Y(b.y + b.size);
    canvas.appendChild(
      h('div', { class: 'tree-box', style: { left: `${f(left)}px`, top: `${f(top)}px`, width: `${b.size}px`, height: `${b.size}px` }, dataset: { id: b.id, l1: b.l1, order: String(b.order), date: b.date } }, app.regionTile(b.id, { href: `#/r/${b.id}`, onclick: open }))
    );
    const ly = Y(b.label.y);
    canvas.appendChild(
      h('div', { class: `tree-name ${b.label.anchor === 'bottom' ? 'up' : 'down'}`, style: { left: `${f(cx + b.label.x)}px`, top: `${f(ly)}px` }, dataset: { id: b.id } }, name)
    );
  }

  const scroller = h('div', { class: 'tree-scroll' }, canvas);
  scroller.addEventListener('scroll', () => {
    scrollLeft = scroller.scrollLeft;
  });
  requestAnimationFrame(() => {
    if (!scroller.isConnected) return; // 已被下一次渲染替换
    // 第一次打开时树干位于视野中央；之后（自动同步、点开名称）保持用户滑到的位置
    scroller.scrollLeft = scrollLeft === null ? cx - scroller.clientWidth / 2 : scrollLeft;
    scrollLeft = scroller.scrollLeft;
  });

  let info = null;
  if (selected) {
    const date = dateOf.get(selected);
    info = h(
      'div',
      { class: 'tree-info', role: 'status' },
      h('p', null, h('strong', null, app.regionName(selected)), `　${date ? `${dotted(date)} 点亮` : '已点亮'}`),
      h('button', { class: 'icon-btn', 'aria-label': '关闭', onclick: () => pick(selected) }, '✕')
    );
  }
  return h('section', { class: 'tree-page' }, head, h('p', { class: 'tree-hint muted' }, '点树干或主枝查看一级区域，点区域框查看点亮时间'), scroller, info);
}
