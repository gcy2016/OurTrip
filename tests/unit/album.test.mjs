import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../js/album.js';
import { loadRegions } from './helpers.mjs';

const R = loadRegions();

function photo(id) {
  return { id, width: 100, height: 80, uploadedAt: Date.now() };
}

function titles(album, parent) {
  return A.childNodes(album, parent).map((n) => n.title);
}

test('只能在二级区域或无二级区域的一级区域下建框', () => {
  const a = A.emptyAlbum();
  assert.ok(A.addBox(a, R, 'A03-C01', { title: '相册' }));
  assert.ok(A.addBox(a, R, 'A01', { title: '美食' }));
  assert.throws(() => A.addBox(a, R, 'A03', { title: 'x' }), { code: 'REGION_NOT_CONTAINER' });
});

test('框可无限嵌套；有子框的框不能放内容，有内容的框不能加子框（给出合并提示）', () => {
  const a = A.emptyAlbum();
  let parent = 'A03-C01';
  for (let i = 0; i < 8; i++) parent = A.addBox(a, R, parent, { title: `层${i}` }).id;
  assert.equal(A.regionOfNode(a, parent), 'A03-C01');

  const album = A.addBox(a, R, 'A03-C01', { title: '相册' });
  A.addPhotos(a, album.id, [photo('p1')]);
  assert.throws(() => A.addBox(a, R, album.id), (e) => e.code === 'HAS_CONTENT' && /合并/.test(e.message));

  const outer = A.addBox(a, R, 'A03-C01', { title: '外层' });
  A.addBox(a, R, outer.id, { title: '内层' });
  assert.throws(() => A.addNote(a, outer.id, 'x'), { code: 'HAS_CHILDREN' });
  assert.throws(() => A.addPhotos(a, outer.id, [photo('p2')]), { code: 'HAS_CHILDREN' });
});

test('文字备注、地址都算旅行内容，会点亮二级区域及其一级区域；标题不算', () => {
  const a = A.emptyAlbum();
  const b = A.addBox(a, R, 'A05-C02', { title: '只有标题' });
  assert.equal(A.computeLit(a, R).size, 0);
  const n = A.addNote(a, b.id, '好吃');
  assert.deepEqual([...A.computeLit(a, R)].sort(), ['A05', 'A05-C02']);
  A.updateNote(a, b.id, n.id, '   ');
  assert.equal(A.computeLit(a, R).size, 0);
  const l = A.addLocation(a, b.id, { address: '某路 1 号' });
  assert.ok(A.computeLit(a, R).has('A05-C02'));
  A.updateLocation(a, b.id, l.id, { address: '' });
  assert.equal(A.computeLit(a, R).size, 0);

  const c = A.addBox(a, R, 'A01', { title: '直达' });
  A.addPhotos(a, c.id, [photo('p1')]);
  assert.deepEqual([...A.computeLit(a, R)], ['A01']);
});

test('点亮随内容删除而取消', () => {
  const a = A.emptyAlbum();
  const b = A.addBox(a, R, 'A04-C01');
  A.addPhotos(a, b.id, [photo('p1')]);
  const b2 = A.addBox(a, R, 'A04-C02');
  A.addNote(a, b2.id, 'x');
  assert.deepEqual([...A.computeLit(a, R)].sort(), ['A04', 'A04-C01', 'A04-C02']);
  A.deletePhoto(a, 'p1');
  assert.deepEqual([...A.computeLit(a, R)].sort(), ['A04', 'A04-C02']);
  A.deleteBox(a, R, b2.id);
  assert.equal(A.computeLit(a, R).size, 0);
});

test('合并：新建父框，原框成为子框并保持顺序与内容', () => {
  const a = A.emptyAlbum();
  const [x, y, z] = ['相册', '美食', '景点'].map((t) => A.addBox(a, R, 'A03-C01', { title: t }));
  A.addPhotos(a, x.id, [photo('p1')]);
  const m = A.mergeBoxes(a, [z.id, x.id], '2024-05');
  assert.deepEqual(titles(a, 'A03-C01'), ['2024-05', '美食']);
  assert.deepEqual(titles(a, m.id), ['相册', '景点']);
  assert.deepEqual(a.nodes[x.id].photos, ['p1']);
  const other = A.addBox(a, R, m.id, { title: 'q' });
  assert.throws(() => A.mergeBoxes(a, [other.id, y.id]), { code: 'DIFFERENT_PARENT' });
});

test('删除父框：子框提升到原位置，任意深度适用，内容保留', () => {
  const a = A.emptyAlbum();
  const first = A.addBox(a, R, 'A03-C01', { title: '前' });
  const p = A.addBox(a, R, 'A03-C01', { title: '父' });
  A.addBox(a, R, 'A03-C01', { title: '后' });
  const c1 = A.addBox(a, R, p.id, { title: '子1' });
  const c2 = A.addBox(a, R, p.id, { title: '子2' });
  const g = A.addBox(a, R, c2.id, { title: '孙' });
  A.addPhotos(a, g.id, [photo('p1')]);
  A.deleteBox(a, R, p.id);
  assert.deepEqual(titles(a, 'A03-C01'), ['前', '子1', '子2', '后']);
  A.deleteBox(a, R, c2.id);
  assert.deepEqual(titles(a, 'A03-C01'), ['前', '子1', '孙', '后']);
  assert.deepEqual(a.nodes[g.id].photos, ['p1']);
  assert.equal(a.trash.length, 0);
  assert.ok(first && c1);
  assert.deepEqual(A.validateAlbum(a, R), []);
});

test('删除末级框：内容一起删除并进入回收记录，可恢复', () => {
  const a = A.emptyAlbum();
  const b = A.addBox(a, R, 'A03-C01', { title: '相册' });
  A.addPhotos(a, b.id, [photo('p1'), photo('p2')]);
  A.setCover(a, R, 'A03-C01', 'p1');
  A.deleteBox(a, R, b.id, 1000);
  assert.equal(Object.keys(a.photos).length, 0);
  assert.equal(a.regionCovers['A03-C01'], undefined);
  assert.equal(a.trash.length, 1);
  assert.deepEqual([...A.referencedPhotoIds(a)].sort(), ['p1', 'p2']);
  A.restoreTrash(a, R, a.trash[0].id);
  assert.deepEqual(titles(a, 'A03-C01'), ['相册']);
  assert.equal(Object.keys(a.photos).length, 2);
  assert.deepEqual(A.validateAlbum(a, R), []);
});

test('空的末级框删除不产生回收记录', () => {
  const a = A.emptyAlbum();
  const b = A.addBox(a, R, 'A03-C01');
  A.deleteBox(a, R, b.id);
  assert.equal(a.trash.length, 0);
});

test('复制粘贴：保留结构、标题、类型、颜色，清空旅行内容与封面', () => {
  const a = A.emptyAlbum();
  const trip = A.addBox(a, R, 'A03-C01', { title: '第一次', color: '#123456' });
  const al = A.addBox(a, R, trip.id, { title: '相册', type: '相册' });
  const food = A.addBox(a, R, trip.id, { title: '美食', type: '美食' });
  A.addPhotos(a, al.id, [photo('p1')]);
  A.addNote(a, food.id, '面条');
  A.addLocation(a, food.id, { address: 'x', lat: 1, lng: 2 });
  A.setCover(a, R, trip.id, 'p1');
  const tpl = A.copyTemplate(a, trip.id);
  const rootId = A.pasteTemplate(a, R, tpl, 'A07-C03');
  const root = a.nodes[rootId];
  assert.equal(root.title, '第一次');
  assert.equal(root.color, '#123456');
  assert.equal(root.cover, null);
  const kids = A.childNodes(a, rootId);
  assert.deepEqual(kids.map((k) => [k.title, k.type]), [['相册', '相册'], ['美食', '美食']]);
  for (const k of kids) {
    assert.equal(A.hasContent(k), false);
    assert.equal(k.cover, null);
  }
  assert.equal(a.nodes[trip.id].cover, 'p1');
  assert.ok(!A.computeLit(a, R).has('A07-C03'));
});

test('移动：可跨区域，禁止移入自身或后代，禁止移入有内容的框', () => {
  const a = A.emptyAlbum();
  const p = A.addBox(a, R, 'A03-C01', { title: 'p' });
  const c = A.addBox(a, R, p.id, { title: 'c' });
  const leaf = A.addBox(a, R, 'A03-C01', { title: 'leaf' });
  A.addNote(a, leaf.id, 'x');
  assert.throws(() => A.moveBox(a, R, p.id, c.id), { code: 'CYCLE' });
  assert.throws(() => A.moveBox(a, R, p.id, p.id), { code: 'CYCLE' });
  assert.throws(() => A.moveBox(a, R, p.id, leaf.id), { code: 'HAS_CONTENT' });
  assert.throws(() => A.moveBox(a, R, p.id, 'A03'), { code: 'REGION_NOT_CONTAINER' });
  A.moveBox(a, R, leaf.id, 'A22');
  assert.equal(A.regionOfNode(a, leaf.id), 'A22');
  assert.deepEqual([...A.computeLit(a, R)], ['A22']);
  A.promoteBox(a, R, c.id);
  assert.deepEqual(titles(a, 'A03-C01'), ['p', 'c']);
  assert.throws(() => A.promoteBox(a, R, c.id), { code: 'TOP' });
  assert.deepEqual(A.validateAlbum(a, R), []);
});

test('排序', () => {
  const a = A.emptyAlbum();
  ['1', '2', '3'].forEach((t) => A.addBox(a, R, 'A01', { title: t }));
  const [one] = A.childNodes(a, 'A01');
  A.shiftOrder(a, one.id, 1);
  assert.deepEqual(titles(a, 'A01'), ['2', '1', '3']);
  assert.equal(A.shiftOrder(a, A.childNodes(a, 'A01')[0].id, -1), false);
});

test('封面：只能用框/区域之内的照片；照片删除或移出后回退', () => {
  const a = A.emptyAlbum();
  const trip = A.addBox(a, R, 'A03-C01', { title: 'trip' });
  const al = A.addBox(a, R, trip.id, { title: '相册' });
  const other = A.addBox(a, R, 'A03-C02', { title: 'o' });
  A.addPhotos(a, al.id, [photo('p1')]);
  A.addPhotos(a, other.id, [photo('p2')]);
  A.setCover(a, R, trip.id, 'p1');
  A.setCover(a, R, 'A03', 'p1');
  assert.throws(() => A.setCover(a, R, trip.id, 'p2'), { code: 'NOT_WITHIN' });
  assert.equal(A.resolveCover(a, R, trip.id), 'p1');
  assert.equal(A.resolveCover(a, R, 'A03'), 'p1');
  assert.deepEqual(A.photosWithin(a, R, 'A03').sort(), ['p1', 'p2']);
  A.moveBox(a, R, trip.id, 'A01');
  assert.equal(A.resolveCover(a, R, 'A03'), null);
  assert.equal(A.resolveCover(a, R, trip.id), 'p1');
  A.deletePhoto(a, 'p1');
  assert.equal(A.resolveCover(a, R, trip.id), null);
});

test('回收记录超过 30 天会被清理，返回需删除的文件', () => {
  const a = A.emptyAlbum();
  const b = A.addBox(a, R, 'A01');
  A.addPhotos(a, b.id, [photo('p1'), photo('p2')]);
  A.deletePhoto(a, 'p1', 0);
  A.deletePhoto(a, 'p2', A.TRASH_KEEP_MS);
  const gone = A.purgeTrash(a, A.TRASH_KEEP_MS + 10);
  assert.deepEqual(gone, ['p1']);
  assert.equal(a.trash.length, 1);
});

test('照片恢复：原框已有子框时放进新建的“恢复的照片”框', () => {
  const a = A.emptyAlbum();
  const b = A.addBox(a, R, 'A01', { title: 'b' });
  A.addPhotos(a, b.id, [photo('p1')]);
  A.deletePhoto(a, 'p1');
  A.addBox(a, R, b.id, { title: '子' });
  const target = A.restoreTrash(a, R, a.trash[0].id);
  assert.equal(a.nodes[target].title, '恢复的照片');
  assert.equal(a.photos.p1.box, target);
  assert.deepEqual(A.validateAlbum(a, R), []);
});

test('normalizeAlbum 能处理空数据和缺字段', () => {
  const a = A.normalizeAlbum({ nodes: { b1: { id: 'b1', parent: 'A01', title: 't' } } });
  assert.deepEqual(a.nodes.b1.photos, []);
  assert.equal(A.hasContent(a.nodes.b1), false);
  assert.deepEqual(A.normalizeAlbum(null).trash, []);
});

test('相册框：名称固定、只能放照片、不能有子框，复制模板保留种类', () => {
  const a = A.emptyAlbum();
  const al = A.addBox(a, R, 'A03-C01', { kind: 'album', title: '随便' });
  assert.equal(al.title, '相册');
  assert.equal(A.isAlbumBox(al), true);
  assert.throws(() => A.updateBox(a, al.id, { title: '改名' }), { code: 'ALBUM_FIXED' });
  assert.throws(() => A.addNote(a, al.id, 'x'), { code: 'ALBUM_ONLY_PHOTOS' });
  assert.throws(() => A.addLocation(a, al.id, { address: 'x' }), { code: 'ALBUM_ONLY_PHOTOS' });
  assert.throws(() => A.addBox(a, R, al.id), { code: 'ALBUM_NO_CHILDREN' });
  assert.equal(A.canHoldChildren(a, R, al.id), false);
  A.addPhotos(a, al.id, [photo('p1')]);
  assert.ok(A.computeLit(a, R).has('A03-C01'));
  A.updateBox(a, al.id, { color: '#123456' });
  const trip = A.mergeBoxes(a, [al.id], '第一次');
  const pasted = A.pasteTemplate(a, R, A.copyTemplate(a, trip.id), 'A01');
  const kid = A.childNodes(a, pasted)[0];
  assert.equal(A.isAlbumBox(kid), true);
  assert.equal(kid.photos.length, 0);
  const other = A.addBox(a, R, 'A01', { title: 'x' });
  assert.throws(() => A.moveBox(a, R, other.id, kid.id), { code: 'ALBUM_NO_CHILDREN' });
  assert.deepEqual(A.validateAlbum(a, R), []);
});

test('区域背景：用户照片与仓库图片谁后设置谁生效，失效时互相顶替，都没有时为 null', () => {
  const a = A.emptyAlbum();
  const b = A.addBox(a, R, 'A03-C01');
  A.addPhotos(a, b.id, [photo('p1')]);
  const at = (s) => Date.parse(s.replace(' ', 'T'));
  assert.equal(A.resolveRegionBackground(a, R, 'A03', {}), null);
  // 只有仓库图片
  assert.deepEqual(A.resolveRegionBackground(a, R, 'A03', { image: 'x.jpg' }), { kind: 'image', src: 'x.jpg', fallback: null });
  // 用户之后选了照片 → 用户生效，仓库图片作为后备
  A.setCover(a, R, 'A03', 'p1', at('2026-10-16 10:00'));
  let r = A.resolveRegionBackground(a, R, 'A03', { image: 'x.jpg', imageUpdatedAt: '2026-10-15 10:00' });
  assert.equal(r.kind, 'photo');
  assert.equal(r.fallback.src, 'x.jpg');
  // 维护者之后更新了仓库图片 → 仓库图片生效
  r = A.resolveRegionBackground(a, R, 'A03', { image: 'y.jpg', imageUpdatedAt: '2026-10-17 10:00' });
  assert.equal(r.kind, 'image');
  assert.equal(r.fallback.photoId, 'p1');
  // 用户再次设置 → 又由用户生效
  A.setCover(a, R, 'A03', 'p1', at('2026-10-18 10:00'));
  assert.equal(A.resolveRegionBackground(a, R, 'A03', { image: 'y.jpg', imageUpdatedAt: '2026-10-17 10:00' }).kind, 'photo');
  // 用户照片失效 → 回到仓库图片；仓库也没有 → null（纯色）
  A.deletePhoto(a, 'p1');
  assert.equal(A.resolveRegionBackground(a, R, 'A03', { image: 'y.jpg' }).kind, 'image');
  assert.equal(A.resolveRegionBackground(a, R, 'A03', {}), null);
  // 旧数据（字符串形式的封面）仍可读取
  A.addPhotos(a, b.id, [photo('p2')]);
  a.regionCovers['A03-C01'] = 'p2';
  assert.equal(A.resolveCover(a, R, 'A03-C01'), 'p2');
  assert.equal(A.hasUserCover(a, 'A03-C01'), true);
});

test('多条备注与地点：逐条添加、修改、删除；旧数据自动迁移', () => {
  const a = A.emptyAlbum();
  const b = A.addBox(a, R, 'A03-C01', { title: '小店' });
  const n1 = A.addNote(a, b.id, '第一条');
  const n2 = A.addNote(a, b.id, '第二条');
  assert.throws(() => A.addNote(a, b.id, '  '), { code: 'EMPTY' });
  A.updateNote(a, b.id, n1.id, '改过');
  assert.deepEqual(a.nodes[b.id].notes.map((x) => x.text), ['改过', '第二条']);
  A.deleteNote(a, b.id, n2.id);
  assert.equal(a.nodes[b.id].notes.length, 1);
  const l1 = A.addLocation(a, b.id, { address: '甲路', mapUrl: 'x' });
  A.addLocation(a, b.id, { lat: 31.2, lng: 121.4, accuracy: 10, capturedAt: 1 });
  assert.equal(a.nodes[b.id].locations.length, 2);
  assert.equal(a.nodes[b.id].locations[0].mapUrl, undefined);
  A.updateLocation(a, b.id, l1.id, { address: '乙路' });
  assert.equal(a.nodes[b.id].locations[0].address, '乙路');
  A.deleteLocation(a, b.id, l1.id);
  assert.equal(a.nodes[b.id].locations.length, 1);

  const old = A.normalizeAlbum({ nodes: { b1: { id: 'b1', parent: 'A01', title: 't', order: 0, note: '旧备注', location: { address: '旧地址' }, photos: [] } } });
  const m = old.nodes.b1;
  assert.deepEqual(m.notes.map((x) => x.text), ['旧备注']);
  assert.deepEqual(m.locations.map((x) => x.address), ['旧地址']);
  assert.equal('note' in m, false);
  assert.equal('location' in m, false);
  // 迁移结果稳定：两台设备各自读取旧数据，得到相同的编号
  const again = A.normalizeAlbum({ nodes: { b1: { id: 'b1', parent: 'A01', title: 't', order: 0, note: '旧备注', photos: [] } } });
  assert.equal(again.nodes.b1.notes[0].id, m.notes[0].id);
});

test('背景色范围：仅当前框 / 所在区域（含以后新建）/ 整个网页（含以后新建）', () => {
  const a = A.emptyAlbum();
  const x1 = A.addBox(a, R, 'A03-C01', { title: 'x1' });
  const x2 = A.addBox(a, R, x1.id, { title: 'x2' });
  const y1 = A.addBox(a, R, 'A03-C02', { title: 'y1' });
  A.applyBoxColor(a, R, x2.id, '#111111', 'box');
  assert.equal(a.nodes[x2.id].color, '#111111');
  assert.equal(a.nodes[x1.id].color, null);

  assert.equal(A.applyBoxColor(a, R, x2.id, '#222222', 'region'), 2);
  assert.equal(a.nodes[x1.id].color, '#222222');
  assert.equal(a.nodes[y1.id].color, null);
  assert.equal(A.addBox(a, R, 'A03-C01').color, '#222222');
  assert.equal(A.addBox(a, R, x2.id).color, '#222222');
  assert.equal(A.addBox(a, R, 'A03-C02').color, null);

  A.applyBoxColor(a, R, y1.id, '#333333', 'site');
  assert.ok(Object.values(a.nodes).every((n) => n.color === '#333333'));
  assert.equal(A.addBox(a, R, 'A01').color, '#333333');
  assert.equal(A.addBox(a, R, 'A03-C01').color, '#333333');

  A.applyBoxColor(a, R, y1.id, null, 'site');
  assert.equal(A.addBox(a, R, 'A03-C01').color, null);
  assert.equal(A.addBox(a, R, 'A03-C01', { color: '#444444' }).color, '#444444');
});

test('点亮日期：首次点亮记操作日期，旧数据取最早上传日期；取消点亮清空；手动修改不被覆盖', () => {
  const day = (s) => new Date(`${s}T12:00:00`).getTime();
  const a = A.emptyAlbum();
  const b = A.addBox(a, R, 'A03-C01');
  A.addPhotos(a, b.id, [{ id: 'p1', uploadedAt: day('2024-05-01') }, { id: 'p2', uploadedAt: day('2024-04-03') }]);
  const c = A.addBox(a, R, 'A03-C02');
  A.addNote(a, c.id, 'x');
  const d = A.addBox(a, R, 'A01');
  A.addNote(a, d.id, 'x');
  A.syncLitTimes(a, R, day('2026-10-15'));
  assert.equal(A.litDateOf(a, R, 'A03-C01'), '2024-04-03');
  assert.equal(A.litDateOf(a, R, 'A03-C02'), '2026-10-15');
  assert.equal(A.litDateOf(a, R, 'A01'), '2026-10-15');
  assert.equal(A.litDateOf(a, R, 'A03'), '2024-04-03');
  assert.equal(A.litDateOf(a, R, 'A04'), null);

  A.setLitDate(a, R, 'A03-C02', '2020-02-29');
  A.syncLitTimes(a, R, day('2026-10-20'));
  assert.equal(A.litDateOf(a, R, 'A03-C02'), '2020-02-29');
  assert.equal(A.litDateOf(a, R, 'A03'), '2020-02-29');
  assert.throws(() => A.setLitDate(a, R, 'A03', '2020-01-01'), { code: 'NOT_EDITABLE' });
  assert.throws(() => A.setLitDate(a, R, 'A04-C01', '2020-01-01'), { code: 'NOT_LIT' });
  assert.throws(() => A.setLitDate(a, R, 'A03-C01', '2021-02-29'), { code: 'BAD_DATE' });

  // 取消点亮后清空，重新点亮记新的操作日期
  A.deleteBox(a, R, c.id);
  A.syncLitTimes(a, R, day('2026-10-21'));
  assert.equal(A.litDateOf(a, R, 'A03-C02'), null);
  const c2 = A.addBox(a, R, 'A03-C02');
  A.addNote(a, c2.id, 'y');
  A.syncLitTimes(a, R, day('2026-11-01'));
  assert.deepEqual(a.regionLit['A03-C02'], { date: '2026-11-01', manual: false, at: day('2026-11-01') });
  // 手动改日期保留点亮时刻（用于同一天排序）
  A.setLitDate(a, R, 'A03-C02', '2026-10-30');
  assert.deepEqual(a.regionLit['A03-C02'], { date: '2026-10-30', manual: true, at: day('2026-11-01') });
});

test('时间线布局（倒序）：最新在上，3 个月内位置与时间成比例，同侧放不下顺延，同一天依次排列', async () => {
  const { layoutTimeline, PX_PER_MONTH } = await import('../../js/views.js');
  const items = [
    { id: 'a', date: '2025-04-01' },
    { id: 'b', date: '2025-04-01' },
    { id: 'c', date: '2025-04-01' },
    { id: 'd', date: '2025-01-01' },
  ];
  const { items: out, height, breaks, ticks } = layoutTimeline(items, { cardH: 100 });
  assert.equal(out[0].y, out[1].y);
  assert.ok(Math.abs(out[3].y - out[0].y - 3 * PX_PER_MONTH) < 10); // 正好 3 个月：不压缩
  assert.equal(breaks.length, 0);
  assert.deepEqual(out.map((x) => x.side), [0, 1, 0, 1]);
  assert.ok(out[2].cardY >= out[0].cardY + 100); // 同侧不重叠
  assert.ok(height >= out[3].cardY + 100);
  // 月份刻度：3、2、1 月（4 月 1 日与圆点重合，不画）；1 月标年份，即使与圆点重合也保留
  assert.deepEqual(ticks.map((t) => t.month), [3, 2, 1]);
  assert.equal(ticks[2].year, 2025);
});

test('时间线：相邻日期间隔超过 3 个月时压缩为固定长度，标注相隔月数，段内不画刻度', async () => {
  const { layoutTimeline, monthsBetween, PX_PER_MONTH } = await import('../../js/views.js');
  assert.equal(monthsBetween('2023-05-01', '2026-10-20'), 41);
  assert.equal(monthsBetween('2025-01-20', '2025-04-19'), 2);
  const items = [
    { id: 'a', date: '2026-10-20' },
    { id: 'b', date: '2026-08-01' }, // 不到 3 个月：按比例
    { id: 'c', date: '2023-05-01' }, // 3 年多：压缩
    { id: 'd', date: '2023-02-01' }, // 正好 3 个月：不压缩
    { id: 'e', date: '2022-10-30' }, // 超过 3 个月（多 2 天）：压缩
  ];
  const { items: out, breaks, ticks } = layoutTimeline(items, { cardH: 100 });
  assert.equal(breaks.length, 2);
  assert.equal(breaks[0].months, 39);
  assert.equal(breaks[1].months, 3);
  // 两段压缩长度相同（固定长度），远小于按比例的长度
  const len0 = out[2].y - out[1].y;
  const len1 = out[4].y - out[3].y;
  assert.equal(len0, len1);
  assert.ok(len0 < 3 * PX_PER_MONTH);
  // 未压缩的部分仍成比例
  assert.ok(Math.abs(out[3].y - out[2].y - (89 / 30.44) * PX_PER_MONTH) < 1);
  // 压缩段内没有月份刻度；“此间”文字在两张卡片之间，不压在卡片上
  for (const b of breaks) {
    assert.ok(!ticks.some((t) => t.y > b.y1 + 1 && t.y < b.y2 - 1));
    const above = out.filter((o) => o.y <= b.y1).map((o) => o.cardY + 100);
    const below = out.filter((o) => o.y >= b.y2).map((o) => o.cardY);
    assert.ok(Math.max(...above) < b.bandY - 10 && Math.min(...below) > b.bandY + 10);
  }
  // 区段内的刻度：2026 年 10、9 月；2023 年 4、3 月。8 月 1 日、5 月 1 日、2 月 1 日与圆点重合，不画；
  // 2022-10-30 之后的 11 月在压缩段内，不画
  assert.deepEqual(ticks.map((t) => `${t.year}-${t.month}`), ['2026-10', '2026-9', '2023-4', '2023-3']);
});

test('区域排序：已点亮的在前（日期新到旧，同一天后点亮的在前），未点亮的按映射顺序在后', () => {
  const ids = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06'];
  const lit = { A02: ['2024-05-01', 1], A04: ['2025-01-01', 5], A05: ['2024-05-01', 9] };
  const order = A.orderRegions(ids, {
    isLit: (id) => !!lit[id],
    date: (id) => (lit[id] ? lit[id][0] : null),
    at: (id) => (lit[id] ? lit[id][1] : 0),
  });
  assert.deepEqual(order, ['A04', 'A05', 'A02', 'A01', 'A03', 'A06']);
});

test('自动封面：已点亮区域没有生效封面时取区域内最早上传的照片；一级区域取下属全部照片；用户封面优先', () => {
  const a = A.emptyAlbum();
  const b1 = A.addBox(a, R, 'A03-C01');
  const b2 = A.addBox(a, R, 'A03-C02');
  A.addPhotos(a, b1.id, [{ ...photo('late'), uploadedAt: 300 }, { ...photo('mid'), uploadedAt: 200 }]);
  A.addPhotos(a, b2.id, [{ ...photo('early'), uploadedAt: 100 }]);
  const auto = A.autoRegionCovers(a, R);
  assert.equal(auto.get('A03-C01'), 'mid');
  assert.equal(auto.get('A03-C02'), 'early');
  assert.equal(auto.get('A03'), 'early');
  assert.equal(auto.has('A04'), false);
  // 没有用户封面、没有仓库图片 → 自动照片
  assert.deepEqual(A.resolveRegionBackground(a, R, 'A03-C01', {}, auto.get('A03-C01')), { kind: 'photo', photoId: 'mid' });
  // 仓库图片优先于自动照片，自动照片作为后备
  const r = A.resolveRegionBackground(a, R, 'A03-C01', { image: 'x.jpg' }, auto.get('A03-C01'));
  assert.equal(r.src, 'x.jpg');
  assert.equal(r.fallback.photoId, 'mid');
  // 用户主动设置的封面不会被自动照片替换
  A.setCover(a, R, 'A03-C01', 'late', 1000);
  const u = A.resolveRegionBackground(a, R, 'A03-C01', {}, auto.get('A03-C01'));
  assert.equal(u.photoId, 'late');
  assert.equal(u.fallback.photoId, 'mid');
});
