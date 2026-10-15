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
  assert.throws(() => A.setNote(a, outer.id, 'x'), { code: 'HAS_CHILDREN' });
  assert.throws(() => A.addPhotos(a, outer.id, [photo('p2')]), { code: 'HAS_CHILDREN' });
});

test('文字备注、地址都算旅行内容，会点亮二级区域及其一级区域；标题不算', () => {
  const a = A.emptyAlbum();
  const b = A.addBox(a, R, 'A05-C02', { title: '只有标题' });
  assert.equal(A.computeLit(a, R).size, 0);
  A.setNote(a, b.id, '好吃');
  assert.deepEqual([...A.computeLit(a, R)].sort(), ['A05', 'A05-C02']);
  A.setNote(a, b.id, '   ');
  assert.equal(A.computeLit(a, R).size, 0);
  A.setLocation(a, b.id, { address: '某路 1 号' });
  assert.ok(A.computeLit(a, R).has('A05-C02'));
  A.setLocation(a, b.id, { address: '' });
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
  A.setNote(a, b2.id, 'x');
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
  A.setNote(a, food.id, '面条');
  A.setLocation(a, food.id, { address: 'x', lat: 1, lng: 2 });
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
  A.setNote(a, leaf.id, 'x');
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
  assert.throws(() => A.setNote(a, al.id, 'x'), { code: 'ALBUM_ONLY_PHOTOS' });
  assert.throws(() => A.setLocation(a, al.id, { address: 'x' }), { code: 'ALBUM_ONLY_PHOTOS' });
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
