import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../../js/store-memory.js';
import { Session } from '../../js/session.js';
import { AlbumSync, ALBUM_KEY } from '../../js/sync.js';
import * as A from '../../js/album.js';
import { loadRegions } from './helpers.mjs';

const R = loadRegions();
const noSleep = async () => {};

async function setup() {
  const store = new MemoryStore();
  const session = new Session({ store, deviceId: 'a', deviceName: 'a', sleep: noSleep });
  const sync = new AlbumSync({ store, session });
  await sync.load();
  return { store, session, sync };
}

test('没有编辑权时不写入云端', async () => {
  const { store, sync } = await setup();
  sync.mutate((a) => A.addBox(a, R, 'A01', { title: 'x' }));
  assert.equal(await sync.flush(), false);
  assert.equal(sync.status, 'lost-lock');
  assert.equal(await store.getJSON(ALBUM_KEY), null);
});

test('保存成功；网络失败后可重试', async () => {
  const { store, session, sync } = await setup();
  await session.acquire();
  sync.mutate((a) => A.addBox(a, R, 'A01', { title: 'x' }));
  assert.equal(await sync.flush(), true);
  assert.equal(Object.keys((await store.getJSON(ALBUM_KEY)).data.nodes).length, 1);
  store.failNextWrites = 1;
  sync.mutate((a) => A.addBox(a, R, 'A01', { title: 'y' }));
  assert.equal(await sync.flush(), false);
  assert.equal(sync.status, 'error');
  assert.equal(sync.dirty, true);
  sync.retry();
  assert.equal(await sync.flush(), true);
  assert.equal(Object.keys((await store.getJSON(ALBUM_KEY)).data.nodes).length, 2);
});

test('云端版本变化时不覆盖', async () => {
  const { store, session, sync } = await setup();
  await session.acquire();
  sync.mutate((a) => A.addBox(a, R, 'A01', { title: 'x' }));
  await sync.flush();
  await store.putJSON(ALBUM_KEY, { ...A.emptyAlbum(), marker: 'other' });
  sync.mutate((a) => A.addBox(a, R, 'A01', { title: 'y' }));
  assert.equal(await sync.flush(), false);
  assert.equal(sync.status, 'conflict');
  assert.equal((await store.getJSON(ALBUM_KEY)).data.marker, 'other');
});

test('修改失败时数据回滚', async () => {
  const { session, sync } = await setup();
  await session.acquire();
  assert.throws(() => sync.mutate((a) => A.addBox(a, R, 'A03')));
  assert.equal(Object.keys(sync.album.nodes).length, 0);
  assert.equal(sync.dirty, false);
});
