// 相册数据模型（纯函数，不依赖浏览器）。
// album.json 结构：
// {
//   schema: 1,
//   nodes:  { [id]: { id, parent, kind?, title, type, order, color, cover, notes: [{id, text}],
//                     locations: [{id, address, lat, lng, accuracy, capturedAt}], photos: [photoId] } },
//           kind 为 'album' 时是“相册框”：名称固定为“相册”，只能放照片，不能有子框、备注和地点。
//   photos: { [id]: { id, box, caption, exif, width, height, origName, origSize, uploadedAt } },
//   regionCovers: { [regionId]: { photo, at } },   // at：用户设置封面的时间（旧数据可能是照片 id 字符串）
//   trash:  [ { id, kind: 'box'|'photo', deletedAt, parent, region, order, node?, photos: [...] } ],
//   regionLit: { [regionId]: { date: 'YYYY-MM-DD', manual } },   // 二级区域（及无二级的一级区域）的点亮日期
//   colorDefaults: { site: color|null, regions: { [regionId]: color|null } }, // 新建框的默认背景色
// }
// parent 为固定区域编号（如 A03-C01）或另一个自定义框的 id。

import { isRegionId, isContentRegion } from './regions.js';

export const SCHEMA = 1;
export const TRASH_KEEP_MS = 30 * 24 * 3600 * 1000;
export const QUICK_TYPES = ['相册', '美食', '景点', '餐厅', '行程'];
export const ALBUM_TITLE = '相册';

export function isAlbumBox(node) {
  return !!node && node.kind === 'album';
}

export class AlbumError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function emptyAlbum() {
  return { schema: SCHEMA, nodes: {}, photos: {}, regionCovers: {}, trash: [], regionLit: {}, colorDefaults: { site: null, regions: {} } };
}

/** 旧数据（单条 note / location）迁移为多条 notes / locations */
export function migrateNode(n) {
  if (!Array.isArray(n.photos)) n.photos = [];
  if (!Array.isArray(n.notes)) {
    n.notes = typeof n.note === 'string' && n.note.trim() ? [{ id: `n0${n.id}`, text: n.note }] : [];
  }
  if (!Array.isArray(n.locations)) {
    n.locations = hasLocation(n.location) ? [{ id: `l0${n.id}`, ...n.location }] : [];
  }
  delete n.note;
  delete n.location;
  if (n.cover === undefined) n.cover = null;
  if (n.color === undefined) n.color = null;
  if (typeof n.order !== 'number') n.order = 0;
  return n;
}

export function normalizeAlbum(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const album = {
    ...a,
    schema: a.schema || SCHEMA,
    nodes: a.nodes && typeof a.nodes === 'object' ? a.nodes : {},
    photos: a.photos && typeof a.photos === 'object' ? a.photos : {},
    regionCovers: a.regionCovers && typeof a.regionCovers === 'object' ? a.regionCovers : {},
    trash: Array.isArray(a.trash) ? a.trash : [],
    regionLit: a.regionLit && typeof a.regionLit === 'object' ? a.regionLit : {},
    colorDefaults: {
      site: (a.colorDefaults && a.colorDefaults.site) || null,
      regions: (a.colorDefaults && a.colorDefaults.regions && typeof a.colorDefaults.regions === 'object' && a.colorDefaults.regions) || {},
    },
  };
  for (const n of Object.values(album.nodes)) migrateNode(n);
  return album;
}

let idCounter = 0;
export function newId(prefix) {
  idCounter = (idCounter + 1) % 1296;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36).padStart(2, '0')}${rand}`;
}

// ---------- 查询 ----------

export function childNodes(album, parentId) {
  return Object.values(album.nodes)
    .filter((n) => n.parent === parentId)
    .sort((x, y) => x.order - y.order);
}

export function hasChildren(album, id) {
  for (const n of Object.values(album.nodes)) if (n.parent === id) return true;
  return false;
}

export function hasLocation(loc) {
  if (!loc) return false;
  return !!((loc.address && loc.address.trim()) || Number.isFinite(loc.lat) || (loc.mapUrl && loc.mapUrl.trim()));
}

export function hasNotes(node) {
  return !!node && Array.isArray(node.notes) && node.notes.some((x) => x.text && x.text.trim());
}

export function hasLocations(node) {
  return !!node && Array.isArray(node.locations) && node.locations.some(hasLocation);
}

/** 末级框是否存放了用户内容（照片、文字备注、地址/地点都算） */
export function hasContent(node) {
  return !!node && (node.photos.length > 0 || hasNotes(node) || hasLocations(node));
}

/** 从框向上找到所属固定区域编号 */
export function regionOfNode(album, id) {
  let cur = id;
  const seen = new Set();
  while (cur && !isRegionId(cur)) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const n = album.nodes[cur];
    if (!n) return null;
    cur = n.parent;
  }
  return cur || null;
}

/** 祖先链（不含自身），由近到远：父框…、二级区域、一级区域 */
export function ancestorIds(album, regions, id) {
  const out = [];
  let cur = isRegionId(id) ? null : album.nodes[id] && album.nodes[id].parent;
  while (cur) {
    out.push(cur);
    if (isRegionId(cur)) {
      const r = regions.byId.get(cur);
      cur = r && r.parent;
    } else {
      cur = album.nodes[cur] && album.nodes[cur].parent;
    }
  }
  return out;
}

/** target 是否是 id 自身或其祖先（target 可以是区域或框） */
export function isWithin(album, regions, id, target) {
  if (id === target) return true;
  return ancestorIds(album, regions, id).includes(target);
}

/** 能否在 containerId 下新建/放入子框 */
export function canHoldChildren(album, regions, containerId) {
  if (isRegionId(containerId)) return isContentRegion(regions, containerId);
  const n = album.nodes[containerId];
  return !!n && !isAlbumBox(n) && !hasContent(n);
}

function assertContainer(album, regions, containerId) {
  if (isRegionId(containerId)) {
    if (!isContentRegion(regions, containerId)) {
      throw new AlbumError('REGION_NOT_CONTAINER', '该区域下有二级区域，请进入二级区域后再添加内容');
    }
    return;
  }
  const n = album.nodes[containerId];
  if (!n) throw new AlbumError('NOT_FOUND', '目标框不存在');
  if (isAlbumBox(n)) throw new AlbumError('ALBUM_NO_CHILDREN', '相册框只能放照片，不能添加子框。');
  if (hasContent(n)) {
    throw new AlbumError(
      'HAS_CONTENT',
      `“${n.title || '未命名'}”里已经有内容，不能直接添加子框。如需分层，请回到上一层新建一个框，再把它和“${n.title || '未命名'}”一起选中合并。`
    );
  }
}

function getNode(album, id) {
  const n = album.nodes[id];
  if (!n) throw new AlbumError('NOT_FOUND', '框不存在或已被删除');
  return n;
}

function assertLeafForContent(album, id, { photosOnly = false } = {}) {
  const n = getNode(album, id);
  if (isAlbumBox(n) && !photosOnly) throw new AlbumError('ALBUM_ONLY_PHOTOS', '相册框只能放照片，不能添加备注或地点。');
  if (hasChildren(album, id)) {
    throw new AlbumError('HAS_CHILDREN', '这个框里已经有子框，内容请放到末级框中');
  }
  return n;
}

function renumber(album, parentId, orderedIds) {
  const ids = orderedIds || childNodes(album, parentId).map((n) => n.id);
  ids.forEach((id, i) => {
    album.nodes[id].order = i;
  });
}

function nextOrder(album, parentId) {
  const kids = childNodes(album, parentId);
  return kids.length ? kids[kids.length - 1].order + 1 : 0;
}

// ---------- 框操作 ----------

function makeNode(fields) {
  return { color: null, cover: null, notes: [], locations: [], photos: [], ...fields };
}

/** 新建框的默认背景色：所在二级区域（或无二级的一级区域）的默认色 > 全站默认色 > 无 */
export function defaultBoxColor(album, regions, parentId) {
  const rid = isRegionId(parentId) ? parentId : regionOfNode(album, parentId);
  const d = album.colorDefaults || { site: null, regions: {} };
  if (rid && d.regions && Object.prototype.hasOwnProperty.call(d.regions, rid)) return d.regions[rid] || null;
  return d.site || null;
}

export function addBox(album, regions, parentId, { title = '', type = '', color, kind = null } = {}) {
  assertContainer(album, regions, parentId);
  const id = newId('b');
  const isAlbum = kind === 'album';
  album.nodes[id] = makeNode({
    id,
    parent: parentId,
    ...(isAlbum ? { kind: 'album' } : {}),
    title: isAlbum ? ALBUM_TITLE : String(title).trim() || '新建框',
    type: isAlbum ? ALBUM_TITLE : String(type || '').trim(),
    order: nextOrder(album, parentId),
    color: color === undefined ? defaultBoxColor(album, regions, parentId) : color,
  });
  return album.nodes[id];
}

export function updateBox(album, id, patch) {
  const n = getNode(album, id);
  if (isAlbumBox(n) && ('title' in patch || 'type' in patch)) {
    throw new AlbumError('ALBUM_FIXED', '相册框的名称固定为“相册”，不能修改。');
  }
  if ('title' in patch) n.title = String(patch.title).trim() || '未命名';
  if ('type' in patch) n.type = String(patch.type || '').trim();
  if ('color' in patch) n.color = patch.color || null;
  return n;
}

// ---------- 备注与地点（每个末级框可以有多条） ----------

export function addNote(album, id, text) {
  const n = assertLeafForContent(album, id);
  const t = String(text || '');
  if (!t.trim()) throw new AlbumError('EMPTY', '备注不能为空');
  const note = { id: newId('n'), text: t };
  n.notes.push(note);
  return note;
}

export function updateNote(album, id, noteId, text) {
  const n = assertLeafForContent(album, id);
  const note = n.notes.find((x) => x.id === noteId);
  if (!note) throw new AlbumError('NOT_FOUND', '备注不存在或已被删除');
  if (!String(text || '').trim()) return deleteNote(album, id, noteId);
  note.text = String(text);
  return note;
}

export function deleteNote(album, id, noteId) {
  const n = getNode(album, id);
  n.notes = n.notes.filter((x) => x.id !== noteId);
  return null;
}

function cleanLocation(loc) {
  const out = {};
  if (loc.address && String(loc.address).trim()) out.address = String(loc.address).trim();
  if (Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
    out.lat = loc.lat;
    out.lng = loc.lng;
    if (Number.isFinite(loc.accuracy)) out.accuracy = loc.accuracy;
    if (loc.capturedAt) out.capturedAt = loc.capturedAt;
  }
  return out;
}

export function addLocation(album, id, loc) {
  const n = assertLeafForContent(album, id);
  const clean = cleanLocation(loc || {});
  if (!hasLocation(clean)) throw new AlbumError('EMPTY', '请填写地址或获取当前位置');
  const item = { id: newId('l'), ...clean };
  n.locations.push(item);
  return item;
}

export function updateLocation(album, id, locId, loc) {
  const n = assertLeafForContent(album, id);
  const i = n.locations.findIndex((x) => x.id === locId);
  if (i < 0) throw new AlbumError('NOT_FOUND', '地点不存在或已被删除');
  const clean = cleanLocation(loc || {});
  if (!hasLocation(clean)) return deleteLocation(album, id, locId);
  n.locations[i] = { id: locId, ...clean };
  return n.locations[i];
}

export function deleteLocation(album, id, locId) {
  const n = getNode(album, id);
  n.locations = n.locations.filter((x) => x.id !== locId);
  return null;
}

// ---------- 背景色 ----------

/**
 * 修改框的背景色。scope：
 * - 'box'：只改当前框；
 * - 'region'：当前框所在二级区域（或无二级的一级区域）下现有的全部框，以及以后在该区域新建的框；
 * - 'site'：整个网页现有的全部框，以及以后新建的框。
 * color 为 null 表示恢复默认色。
 */
export function applyBoxColor(album, regions, nodeId, color, scope = 'box') {
  const n = getNode(album, nodeId);
  const c = color || null;
  if (scope === 'box') {
    n.color = c;
    return 1;
  }
  album.colorDefaults = album.colorDefaults || { site: null, regions: {} };
  let count = 0;
  if (scope === 'region') {
    const rid = regionOfNode(album, nodeId);
    for (const x of Object.values(album.nodes)) {
      if (regionOfNode(album, x.id) === rid) {
        x.color = c;
        count++;
      }
    }
    album.colorDefaults.regions[rid] = c;
    return count;
  }
  for (const x of Object.values(album.nodes)) {
    x.color = c;
    count++;
  }
  album.colorDefaults = { site: c, regions: {} };
  return count;
}

function removeCoverRefs(album, photoIds) {
  const dead = new Set(photoIds);
  for (const n of Object.values(album.nodes)) if (n.cover && dead.has(n.cover)) n.cover = null;
  for (const rid of Object.keys(album.regionCovers)) if (dead.has(regionCoverPhoto(album, rid))) delete album.regionCovers[rid];
}

/**
 * 删除框：
 * - 有子框：框本身消失，直接子框提升到它原来的位置（任意深度适用）；
 * - 末级框：框和其中内容一起删除，放入 trash 供 30 天内技术恢复。
 */
export function deleteBox(album, regions, id, now = Date.now()) {
  const n = getNode(album, id);
  const kids = childNodes(album, id);
  const siblings = childNodes(album, n.parent).map((s) => s.id);
  const pos = siblings.indexOf(id);
  if (kids.length) {
    for (const k of kids) k.parent = n.parent;
    siblings.splice(pos, 1, ...kids.map((k) => k.id));
    delete album.nodes[id];
    renumber(album, n.parent, siblings);
    return { promoted: kids.map((k) => k.id), trashed: null };
  }
  const photos = n.photos.map((pid) => album.photos[pid]).filter(Boolean);
  const entry = !hasContent(n) ? null : {
    id: newId('t'),
    kind: 'box',
    deletedAt: now,
    parent: n.parent,
    region: regionOfNode(album, id),
    order: pos,
    node: { ...n, photos: n.photos.slice() },
    photos: photos.map((p) => ({ ...p })),
  };
  if (entry) album.trash.push(entry);
  for (const p of photos) delete album.photos[p.id];
  removeCoverRefs(album, n.photos);
  delete album.nodes[id];
  siblings.splice(pos, 1);
  renumber(album, n.parent, siblings);
  return { promoted: [], trashed: entry };
}

/** 合并：同一父级下的若干框收进一个新父框，原框成为子框，内容不变 */
export function mergeBoxes(album, ids, title = '') {
  if (!ids.length) throw new AlbumError('EMPTY', '请先选择要合并的框');
  const nodes = ids.map((id) => getNode(album, id));
  const parent = nodes[0].parent;
  if (!nodes.every((n) => n.parent === parent)) {
    throw new AlbumError('DIFFERENT_PARENT', '只能合并同一层级、同一父级下的框');
  }
  const siblings = childNodes(album, parent).map((s) => s.id);
  const chosen = siblings.filter((sid) => ids.includes(sid));
  const firstPos = siblings.indexOf(chosen[0]);
  const id = newId('b');
  album.nodes[id] = makeNode({
    id,
    parent,
    title: String(title).trim() || '合并的框',
    type: '',
    order: 0,
    color: defaultBoxColor(album, null, parent),
  });
  chosen.forEach((cid, i) => {
    album.nodes[cid].parent = id;
    album.nodes[cid].order = i;
  });
  const rest = siblings.filter((sid) => !chosen.includes(sid));
  rest.splice(firstPos, 0, id);
  renumber(album, parent, rest);
  return album.nodes[id];
}

/** 复制为模板：保留标题、类型、颜色及子框结构；照片、文字、地址、封面全部清空 */
export function copyTemplate(album, id) {
  const n = getNode(album, id);
  const walk = (node) => ({
    ...(isAlbumBox(node) ? { kind: 'album' } : {}),
    title: node.title,
    type: node.type,
    color: node.color,
    children: childNodes(album, node.id).map(walk),
  });
  return walk(n);
}

export function pasteTemplate(album, regions, template, parentId) {
  assertContainer(album, regions, parentId);
  const make = (tpl, parent) => {
    const id = newId('b');
    const isAlbum = tpl.kind === 'album';
    album.nodes[id] = makeNode({
      id,
      parent,
      ...(isAlbum ? { kind: 'album' } : {}),
      title: isAlbum ? ALBUM_TITLE : tpl.title || '未命名',
      type: isAlbum ? ALBUM_TITLE : tpl.type || '',
      order: nextOrder(album, parent),
      color: tpl.color || null,
    });
    for (const c of tpl.children || []) make(c, id);
    return id;
  };
  return make(template, parentId);
}

/** 移动框到另一个容器（可跨区域），可选插在 afterId 之后 */
export function moveBox(album, regions, id, newParentId, { afterId = null } = {}) {
  const n = getNode(album, id);
  if (newParentId === id || (!isRegionId(newParentId) && isWithin(album, regions, newParentId, id))) {
    throw new AlbumError('CYCLE', '不能把框移动到它自己或它的子框里');
  }
  assertContainer(album, regions, newParentId);
  const oldParent = n.parent;
  if (oldParent !== newParentId) {
    n.parent = newParentId;
    renumber(album, oldParent);
  }
  const siblings = childNodes(album, newParentId)
    .map((s) => s.id)
    .filter((sid) => sid !== id);
  let at = siblings.length;
  if (afterId) {
    const k = siblings.indexOf(afterId);
    if (k >= 0) at = k + 1;
  }
  siblings.splice(at, 0, id);
  renumber(album, newParentId, siblings);
  return n;
}

/** 提升一级：移到父框所在层级，排在原父框后面 */
export function promoteBox(album, regions, id) {
  const n = getNode(album, id);
  if (isRegionId(n.parent)) throw new AlbumError('TOP', '已经在区域下的第一层，不能再提升');
  const parent = album.nodes[n.parent];
  return moveBox(album, regions, id, parent.parent, { afterId: parent.id });
}

export function shiftOrder(album, id, delta) {
  const n = getNode(album, id);
  const ids = childNodes(album, n.parent).map((s) => s.id);
  const i = ids.indexOf(id);
  const j = Math.max(0, Math.min(ids.length - 1, i + delta));
  if (i === j) return false;
  ids.splice(i, 1);
  ids.splice(j, 0, id);
  renumber(album, n.parent, ids);
  return true;
}

// ---------- 照片 ----------

export function addPhotos(album, boxId, photos) {
  const n = assertLeafForContent(album, boxId, { photosOnly: true });
  for (const p of photos) {
    if (album.photos[p.id]) continue;
    album.photos[p.id] = { caption: '', exif: null, ...p, box: boxId };
    n.photos.push(p.id);
  }
  return n;
}

export function setCaption(album, photoId, caption) {
  const p = album.photos[photoId];
  if (!p) throw new AlbumError('NOT_FOUND', '照片不存在或已被删除');
  p.caption = String(caption || '');
  return p;
}

export function deletePhoto(album, photoId, now = Date.now()) {
  const p = album.photos[photoId];
  if (!p) throw new AlbumError('NOT_FOUND', '照片不存在或已被删除');
  const n = album.nodes[p.box];
  album.trash.push({
    id: newId('t'),
    kind: 'photo',
    deletedAt: now,
    parent: p.box,
    region: n ? regionOfNode(album, n.id) : null,
    order: n ? n.photos.indexOf(photoId) : 0,
    photos: [{ ...p }],
  });
  if (n) n.photos = n.photos.filter((x) => x !== photoId);
  delete album.photos[photoId];
  removeCoverRefs(album, [photoId]);
}

// ---------- 封面 ----------

/** 照片是否位于 target（区域或框）之下 */
export function photoWithin(album, regions, photoId, target) {
  const p = album.photos[photoId];
  if (!p || !album.nodes[p.box]) return false;
  return isWithin(album, regions, p.box, target);
}

function regionCoverPhoto(album, regionId) {
  const c = album.regionCovers[regionId];
  return typeof c === 'string' ? c : (c && c.photo) || null;
}

export function setCover(album, regions, targetId, photoId, now = Date.now()) {
  if (!photoWithin(album, regions, photoId, targetId)) {
    throw new AlbumError('NOT_WITHIN', '只能选择这个框（或区域）里面的照片作为封面');
  }
  if (isRegionId(targetId)) album.regionCovers[targetId] = { photo: photoId, at: now };
  else getNode(album, targetId).cover = photoId;
}

export function clearCover(album, targetId) {
  if (isRegionId(targetId)) delete album.regionCovers[targetId];
  else getNode(album, targetId).cover = null;
}

export function hasUserCover(album, targetId) {
  return isRegionId(targetId) ? !!regionCoverPhoto(album, targetId) : !!(album.nodes[targetId] && album.nodes[targetId].cover);
}

/** 返回当前有效的封面照片 id；照片已删除或已移出该框时返回 null（回退为纯色/仓库图片） */
export function resolveCover(album, regions, targetId) {
  const pid = isRegionId(targetId) ? regionCoverPhoto(album, targetId) : album.nodes[targetId] && album.nodes[targetId].cover;
  if (!pid) return null;
  return photoWithin(album, regions, pid, targetId) ? pid : null;
}

/**
 * 固定区域的背景：用户在网页上选的照片与仓库配置的代表图片“谁后设置谁生效”，可以互相替换；
 * 生效的一方失效（照片被删/移走、没有配置图片）时用另一方；两者都没有时返回 null，由页面显示纯色。
 * display：仓库配置 { image, imageUpdatedAt }，imageUpdatedAt 为日期字符串（如 '2026-10-15 20:00'）。
 */
export function resolveRegionBackground(album, regions, regionId, display = {}) {
  const c = album.regionCovers[regionId];
  const photo = resolveCover(album, regions, regionId);
  const userAt = photo ? (typeof c === 'object' && c && Number(c.at)) || 0 : -1;
  const image = display && display.image ? String(display.image) : null;
  const codeAt = image ? Date.parse(String(display.imageUpdatedAt || '').replace(' ', 'T')) || 0 : -1;
  if (photo && (!image || userAt >= codeAt)) return { kind: 'photo', photoId: photo, fallback: image ? { kind: 'image', src: image } : null };
  if (image) return { kind: 'image', src: image, fallback: photo ? { kind: 'photo', photoId: photo } : null };
  return null;
}

/** 某个区域/框之下的全部照片 id（用于选封面） */
export function photosWithin(album, regions, targetId) {
  return Object.values(album.photos)
    .filter((p) => photoWithin(album, regions, p.id, targetId))
    .sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0))
    .map((p) => p.id);
}

// ---------- 点亮 ----------

/** 由内容计算点亮的区域集合：有内容的区域点亮，并点亮其一级父区域 */
export function computeLit(album, regions) {
  const lit = new Set();
  for (const n of Object.values(album.nodes)) {
    if (!hasContent(n)) continue;
    const rid = regionOfNode(album, n.id);
    const r = rid && regions.byId.get(rid);
    if (!r) continue;
    lit.add(rid);
    if (r.parent) lit.add(r.parent);
  }
  return lit;
}

/** 统计某个区域/框之下的框数与照片数（用于提示） */
export function countWithin(album, regions, targetId) {
  let boxes = 0;
  let photos = 0;
  for (const n of Object.values(album.nodes)) {
    if (n.id !== targetId && isWithin(album, regions, n.id, targetId)) {
      boxes++;
      photos += n.photos.length;
    }
  }
  return { boxes, photos };
}

// ---------- 点亮日期 ----------

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 时间戳 → 本地日期 YYYY-MM-DD */
export function localDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}

/** 可以记录点亮日期的区域：二级区域，或没有二级区域的一级区域 */
export function litDateRegions(regions) {
  return [...regions.byId.values()].filter((r) => r.level === 2 || r.children.length === 0).map((r) => r.id);
}

/**
 * 根据当前内容同步点亮日期（每次修改后调用）：
 * - 新点亮的区域：记为导致点亮的操作日期；若区域里已有更早上传的照片（旧数据），取最早的上传日期；
 * - 不再点亮的区域：清除日期；再次点亮时重新按操作日期记录；
 * - 已有的日期（包括用户手动修改的）保持不变。
 */
export function syncLitTimes(album, regions, now = Date.now()) {
  album.regionLit = album.regionLit || {};
  const lit = computeLit(album, regions);
  for (const rid of Object.keys(album.regionLit)) {
    if (!lit.has(rid)) delete album.regionLit[rid];
  }
  for (const rid of litDateRegions(regions)) {
    if (!lit.has(rid) || album.regionLit[rid]) continue;
    let ts = now;
    for (const p of Object.values(album.photos)) {
      if (p.uploadedAt && p.uploadedAt < ts && regionOfNode(album, p.box) === rid) ts = p.uploadedAt;
    }
    album.regionLit[rid] = { date: localDate(ts), manual: false };
  }
}

/** 区域当前的点亮日期；一级区域（有二级区域的）取下属二级区域中最早的日期 */
export function litDateOf(album, regions, regionId) {
  const r = regions.byId.get(regionId);
  if (!r) return null;
  const lit = album.regionLit || {};
  if (r.level === 2 || r.children.length === 0) return (lit[regionId] && lit[regionId].date) || null;
  const dates = r.children.map((c) => lit[c] && lit[c].date).filter(Boolean).sort();
  return dates[0] || null;
}

/** 用户手动修改点亮日期（只适用于二级区域或无二级的一级区域，且该区域须已点亮） */
export function setLitDate(album, regions, regionId, date) {
  const r = regions.byId.get(regionId);
  if (!r || !(r.level === 2 || r.children.length === 0)) {
    throw new AlbumError('NOT_EDITABLE', '一级区域的点亮时间取下属二级区域中最早的时间，不能单独修改');
  }
  if (!computeLit(album, regions).has(regionId)) throw new AlbumError('NOT_LIT', '这个区域还没有点亮');
  if (!isValidDate(date)) throw new AlbumError('BAD_DATE', '请输入正确的日期');
  album.regionLit[regionId] = { date, manual: true };
}

// ---------- 回收（技术维护用） ----------

export function referencedPhotoIds(album) {
  const ids = new Set(Object.keys(album.photos));
  for (const t of album.trash) for (const p of t.photos || []) ids.add(p.id);
  return ids;
}

export function restoreTrash(album, regions, trashId) {
  const idx = album.trash.findIndex((t) => t.id === trashId);
  if (idx < 0) throw new AlbumError('NOT_FOUND', '回收记录不存在');
  const t = album.trash[idx];
  const fallbackParent = () => {
    if (t.region && regions.byId.has(t.region) && isContentRegion(regions, t.region)) return t.region;
    throw new AlbumError('NO_TARGET', '原位置已不存在，且无法确定所属区域');
  };
  let target;
  if (t.kind === 'box') {
    target = canHoldChildren(album, regions, t.parent) ? t.parent : fallbackParent();
    const id = album.nodes[t.node.id] ? newId('b') : t.node.id;
    album.nodes[id] = migrateNode({ ...t.node, id, parent: target, cover: null, photos: [] });
    const siblings = childNodes(album, target).map((s) => s.id).filter((s) => s !== id);
    siblings.splice(Math.min(t.order, siblings.length), 0, id);
    renumber(album, target, siblings);
    for (const p of t.photos) {
      album.photos[p.id] = { ...p, box: id };
      album.nodes[id].photos.push(p.id);
    }
  } else {
    const box = album.nodes[t.parent];
    if (box && !hasChildren(album, box.id)) {
      target = box.id;
    } else {
      target = addBox(album, regions, fallbackParent(), { title: '恢复的照片' }).id;
    }
    for (const p of t.photos) {
      album.photos[p.id] = { ...p, box: target };
      album.nodes[target].photos.push(p.id);
    }
  }
  album.trash.splice(idx, 1);
  return target;
}

/** 移除超过保留期的回收记录，返回需要删除文件的照片 id */
export function purgeTrash(album, now = Date.now(), keepMs = TRASH_KEEP_MS) {
  const keep = [];
  const expiredPhotos = [];
  for (const t of album.trash) {
    if (now - t.deletedAt > keepMs) for (const p of t.photos || []) expiredPhotos.push(p.id);
    else keep.push(t);
  }
  album.trash = keep;
  const still = referencedPhotoIds(album);
  return expiredPhotos.filter((id) => !still.has(id));
}

/** 数据自检：返回发现的问题列表（循环、孤儿、引用失效等） */
export function validateAlbum(album, regions) {
  const problems = [];
  for (const n of Object.values(album.nodes)) {
    const rid = regionOfNode(album, n.id);
    if (!rid) problems.push(`框 ${n.id} 无法追溯到固定区域（孤儿或循环）`);
    else if (!regions.byId.has(rid)) problems.push(`框 ${n.id} 挂在未知区域 ${rid} 下`);
    else if (!isContentRegion(regions, rid) && n.parent === rid) problems.push(`框 ${n.id} 直接挂在有二级区域的一级区域 ${rid} 下`);
    if (hasContent(n) && hasChildren(album, n.id)) problems.push(`框 ${n.id} 同时有内容和子框`);
    if (isAlbumBox(n) && (hasChildren(album, n.id) || hasNotes(n) || hasLocations(n))) problems.push(`相册框 ${n.id} 含有照片以外的内容或子框`);
    for (const pid of n.photos) {
      if (!album.photos[pid]) problems.push(`框 ${n.id} 引用了不存在的照片 ${pid}`);
      else if (album.photos[pid].box !== n.id) problems.push(`照片 ${pid} 的所属框不一致`);
    }
  }
  for (const p of Object.values(album.photos)) {
    if (!album.nodes[p.box] || !album.nodes[p.box].photos.includes(p.id)) problems.push(`照片 ${p.id} 不属于任何框`);
  }
  return problems;
}
