// 固定区域：读取 data/region-map-anon.js（与 OurTrip/private/region-map-anon.js 保持一致），
// 校验后生成查询结构。不得在这里另设一套区域数据。

const L1_ID = /^A\d{2}$/;
const L2_ID = /^(A\d{2})-C\d{2}$/;

export function isRegionId(id) {
  return typeof id === 'string' && (L1_ID.test(id) || L2_ID.test(id));
}

/**
 * @param {{level1: {id: string, children: string[]}[]}} raw
 * @returns {{level1: string[], byId: Map<string, {id, level, parent, children}>, stats}}
 */
export function buildRegions(raw) {
  if (!raw || !Array.isArray(raw.level1)) throw new Error('区域映射文件格式不正确：缺少 level1');
  const byId = new Map();
  const level1 = [];
  let level2Count = 0;
  for (const item of raw.level1) {
    if (!item || !L1_ID.test(item.id)) throw new Error(`一级区域编号不合法：${item && item.id}`);
    if (byId.has(item.id)) throw new Error(`区域编号重复：${item.id}`);
    const children = Array.isArray(item.children) ? item.children.slice() : [];
    byId.set(item.id, { id: item.id, level: 1, parent: null, children });
    level1.push(item.id);
    for (const cid of children) {
      const m = L2_ID.exec(cid);
      if (!m || m[1] !== item.id) throw new Error(`二级区域编号不合法或未挂在所属一级区域下：${cid}`);
      if (byId.has(cid)) throw new Error(`区域编号重复：${cid}`);
      byId.set(cid, { id: cid, level: 2, parent: item.id, children: [] });
      level2Count++;
    }
  }
  return { level1, byId, stats: { level1: level1.length, level2: level2Count } };
}

/** 可以直接在其下创建自定义框的区域：二级区域，或没有二级区域的一级区域 */
export function isContentRegion(regions, id) {
  const r = regions.byId.get(id);
  return !!r && (r.level === 2 || r.children.length === 0);
}
