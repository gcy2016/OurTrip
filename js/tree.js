// 旅行树：数据整理与布局（纯计算，不接触页面）。依据 gcy2016/AI_Corp issue #17《旅行树 PRD》。
//
// 分两步：
//   1. buildTreeModel：从主页的区域与点亮数据得到排好序的树（根基、一级区域、二级区域）；
//   2. layoutTree：把树换算成几何数据（树干分段、主枝、小枝、区域框、名称的位置）。
// 坐标以树干底部中心为原点，x 向右、y 向上，单位为像素；画法（SVG/HTML，或以后的动画、3D）只读这些数据，
// 不在画的时候再决定排序、归属或左右方向。每个元素带有 seq（生长顺序），供以后的生长动画使用（issue #18）。

// ---------- 排序 ----------

const collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin');

// 地名里的多音字：浏览器的拼音排序按常用读音，地名读音不同的先换成同音字再比较（只影响排序，不显示）
const PLACE_READING = { 长: '常', 重: '虫', 厦: '夏', 蚌: '泵', 六: '陆', 乐: '勒', 莞: '管', 亳: '博', 番: '潘', 单: '善', 尉: '玉', 涡: '锅' };

/** 拼音排序用的名称：地名多音字换成同音字 */
export function pinyinKey(name) {
  return [...String(name)].map((ch) => PLACE_READING[ch] || ch).join('');
}

/** 首次探索日期相同时：按名称拼音（首字母、再完整拼音），仍相同时按区域编码 */
export function compareRegions(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const c = collator.compare(pinyinKey(a.name), pinyinKey(b.name));
  if (c) return c;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 由主页数据得到排好序的树。
 * @param {object} p
 * @param {{level1: string[], byId: Map}} p.regions 区域映射
 * @param {Set<string>} p.lit 已点亮的区域
 * @param {(id: string) => string|null} p.litDate 点亮日期 YYYY-MM-DD（一级区域取下属最早日期）
 * @param {(id: string) => string} p.nameOf 区域名称（用于同日排序）
 * @returns {{root: object|null, levels: object[]}} root 为根基，levels 为根基以外的一级区域（由下向上）
 *   一级区域：{ id, name, date, selfBox, kids: [{id, name, date}] }；selfBox 表示没有二级区域、主枝末端挂自身的区域框
 */
export function buildTreeModel({ regions, lit, litDate, nameOf }) {
  const l1s = [];
  for (const id of regions.level1) {
    if (!lit.has(id)) continue;
    const r = regions.byId.get(id);
    const selfBox = r.children.length === 0;
    const kids = selfBox
      ? []
      : r.children
          .filter((c) => lit.has(c) && litDate(c))
          .map((c) => ({ id: c, name: nameOf(c), date: litDate(c) }))
          .sort(compareRegions);
    const date = litDate(id);
    if (!date || (!selfBox && !kids.length)) continue;
    l1s.push({ id, name: nameOf(id), date, selfBox, kids });
  }
  l1s.sort(compareRegions);
  return { root: l1s[0] || null, levels: l1s.slice(1) };
}

// ---------- 布局 ----------

// 树的形状尺寸（由 Muse 调整）：改完运行 npm test，测试会检查全部点亮时框和名称不重叠、顺序不变。
// 颜色、粗细、字体在 css/app.css 顶部的 --tree-* 变量里。
export const TREE_DIMS = {
  box: 64, // 区域框边长（主页方框等比缩小）
  label: 18, // 二级区域名称行高
  labelGap: 3, // 名称与框的间距
  twig: [14, 24], // 小枝长度（主枝到框边缘）
  step: 46, // 相邻两个框沿主枝的间距（上下交替，同侧相隔两个间距）
  firstGap: 34, // 第一个框离树干边缘的距离（框中心再加半个框）
  tail: 22, // 主枝越过最后一个框的长度
  rise: [10, 26], // 主枝向上翘起的高度
  gapY: 16, // 同侧上下两条主枝的区域之间至少留出的空隙
  rootPad: 8, // 根基区域框与地面的距离
};

/** 稳定的伪随机数：由编号算出，相同数据每次都一样 */
export function hash01(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (id, salt, [a, b]) => lerp(a, b, hash01(`${id}#${salt}`));

/** 树干半宽：上下一样粗（不越往上越细），只在树梢收成圆头（见 layoutTree 的 tip） */
export function trunkHalf() {
  return 22;
}

/** 主枝中心线在离树干中心 u 处的高度（相对节点） */
function branchLift(br, u) {
  const t = Math.max(0, u - br.u0);
  return br.rise * (1 - Math.exp(-t / 110)) + br.wave * Math.sin(t / br.waveLen + br.phase) * Math.min(1, t / 40);
}

/** 主枝在 u 处的粗细 */
function branchWidth(br, u) {
  const t = Math.min(1, Math.max(0, (u - br.u0) / Math.max(1, br.u1 - br.u0)));
  return lerp(br.w0, 2.5, t);
}

/**
 * 布局（纯计算）。
 * @param {{root, levels}} model buildTreeModel 的结果
 * @param {object} [dims] 尺寸，默认 TREE_DIMS
 * @returns 几何数据：
 *   root: { id, kind: 'box'|'base', top }（kind 为 box 时根基就是该区域自身的框，树干从框的上边长出）
 *   segments: 树干分段 [{ id, k, y0, y1, w0, w1, bulgeL, bulgeR, shade, root, tip }]
 *   branches: 主枝 [{ id, side, y, u0, u1, points: [{x, y, w}], knot: {x, y}, date, seq }]
 *   twigs: 小枝 [{ id, l1, from: {x, y}, ctrl: {x, y}, to: {x, y}, seq }]
 *   boxes: 区域框 [{ id, l1, x, y, size, above, order, label: {x, y, anchor}, date, seq }]（x, y 为框左下角）
 *   bounds: { minX, maxX, maxY }
 */
export function layoutTree(model, dims = TREE_DIMS) {
  const D = { ...TREE_DIMS, ...dims };
  const out = { root: null, segments: [], branches: [], twigs: [], boxes: [], bounds: { minX: 0, maxX: 0, maxY: 0 } };
  const { root, levels } = model;
  if (!root) return out;
  let seq = 0;

  const extent = D.twig[1] + D.box + D.labelGap + D.label; // 主枝上方（或下方）区域框连同名称的最大高度
  const S = extent + D.rise[1] / 2 + D.gapY / 2 + 2; // 树干上相邻一级区域的间距（同侧两条主枝相隔 2S）

  // 根基：没有二级区域时就是它自身的区域框（树干从框上边长出）；有二级区域时是一段带树根的底座，上方再长一段树干承接它的主枝
  let base;
  const onTrunk = levels.slice();
  if (root.selfBox) {
    const y = D.label + D.labelGap + D.rootPad;
    out.boxes.push({
      id: root.id,
      l1: root.id,
      x: -D.box / 2,
      y,
      size: D.box,
      above: false,
      order: 0,
      root: true,
      label: { x: 0, y: y - D.labelGap, anchor: 'top' },
      date: root.date,
      seq: seq++,
    });
    base = y + D.box;
    out.root = { id: root.id, kind: 'box', top: base, date: root.date };
  } else {
    base = 22;
    out.root = { id: root.id, kind: 'base', top: base, date: root.date };
    onTrunk.unshift(root);
  }
  out.bounds.minX = -D.box;
  out.bounds.maxX = D.box;
  out.bounds.maxY = base;
  if (!onTrunk.length) return out;

  // 节点高度：第一个节点离地面足够高，下方的框不碰到地面
  const first = Math.max(base + 36, extent + 10);
  const ys = onTrunk.map((_, k) => first + k * S);

  // 树干分段：每个一级区域一段（相邻两段在两个节点的中点相接），两侧略带弧度
  onTrunk.forEach((l1, k) => {
    const y0 = k === 0 ? base - 6 : (ys[k - 1] + ys[k]) / 2;
    const last = k === onTrunk.length - 1;
    const y1 = last ? ys[k] + S * 0.4 : (ys[k] + ys[k + 1]) / 2;
    out.segments.push({
      id: l1.id,
      k,
      y0,
      y1,
      w0: trunkHalf(k === 0 ? -1.5 : k - 0.5),
      w1: last ? trunkHalf(k + 0.5) * 0.45 : trunkHalf(k + 0.5),
      tip: last, // 树梢：顶端收成圆头
      bulgeL: rnd(l1.id, 'bl', [-1.5, 3.5]),
      bulgeR: rnd(l1.id, 'br', [-1.5, 3.5]),
      shade: k % 2,
      root: l1 === root,
      seq: seq++,
    });
  });

  // 主枝方向：根基以外最靠近根基的第一个一级区域向左，向上严格左右交替（按位置，不按区域）；
  // 根基自己的主枝（根基有二级区域时）向右，与上方第一条主枝错开
  const sideOf = (l1, idx) => (l1 === root ? 1 : idx % 2 === 0 ? -1 : 1);
  let nonRoot = 0;
  onTrunk.forEach((l1, k) => {
    const side = sideOf(l1, l1 === root ? 0 : nonRoot++);
    const y = ys[k];
    const u0 = trunkHalf(k) - 1;
    const kids = l1.selfBox ? [{ id: l1.id, name: l1.name, date: l1.date }] : l1.kids;
    const br = {
      id: l1.id,
      side,
      y,
      u0,
      rise: rnd(l1.id, 'rise', D.rise),
      wave: rnd(l1.id, 'wave', [1, 4]),
      waveLen: rnd(l1.id, 'wl', [26, 40]),
      phase: rnd(l1.id, 'ph', [0, Math.PI * 2]),
      w0: Math.min(9, trunkHalf(k) * 0.75),
      date: l1.date,
      seq: seq++,
    };
    // 框沿主枝从树干向外按时间排列，上下交替（第一个在上方）
    const anchors = kids.map((kid, j) => u0 + D.firstGap + D.box / 2 + j * D.step + (j ? rnd(kid.id, 'du', [-5, 5]) : 0));
    br.u1 = anchors[anchors.length - 1] + D.tail;
    br.points = [];
    for (let u = br.u0; ; u += 8) {
      const uu = Math.min(u, br.u1);
      br.points.push({ x: side * uu, y: y + branchLift(br, uu), w: branchWidth(br, uu) });
      if (uu >= br.u1) break;
    }
    br.knot = { x: side * u0, y };
    out.branches.push(br);

    kids.forEach((kid, j) => {
      const above = j % 2 === 0;
      const u = anchors[j];
      const by = y + branchLift(br, u);
      const twig = rnd(kid.id, 'tw', D.twig);
      const lean = rnd(kid.id, 'ln', [3, 10]); // 小枝略向外倾斜
      const cx = u + lean;
      const edgeY = above ? by + twig : by - twig; // 小枝末端连到框的下边（框在上方）或上边（框在下方）
      const boxY = above ? edgeY : edgeY - D.box;
      out.twigs.push({
        id: kid.id,
        l1: l1.id,
        from: { x: side * u, y: by },
        ctrl: { x: side * (u + lean * 0.2), y: lerp(by, edgeY, 0.6) },
        to: { x: side * cx, y: edgeY },
        seq: seq++,
      });
      out.boxes.push({
        id: kid.id,
        l1: l1.id,
        x: side * cx - D.box / 2,
        y: boxY,
        size: D.box,
        above,
        order: j,
        // 名称在框与小枝连接点的另一侧：框在上方时写在框上方，框在下方时写在框下方
        label: above ? { x: side * cx, y: boxY + D.box + D.labelGap, anchor: 'bottom' } : { x: side * cx, y: boxY - D.labelGap, anchor: 'top' },
        date: kid.date,
        seq: seq++,
      });
    });
  });

  for (const b of out.boxes) {
    out.bounds.minX = Math.min(out.bounds.minX, b.x);
    out.bounds.maxX = Math.max(out.bounds.maxX, b.x + b.size);
    out.bounds.maxY = Math.max(out.bounds.maxY, b.y + b.size + D.labelGap + D.label);
  }
  for (const s of out.segments) out.bounds.maxY = Math.max(out.bounds.maxY, s.y1 + (s.tip ? s.w1 * 2 : 0));
  return out;
}
