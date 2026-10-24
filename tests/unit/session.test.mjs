import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../../js/store-memory.js';
import { Session, LOCK_TTL, PRESENCE_TTL } from '../../js/session.js';

const noSleep = async () => {};
function dev(store, id) {
  return new Session({ store, deviceId: id, deviceName: id, sleep: noSleep });
}

test('最多两台设备在线，第三台被拒绝；离开或超时后可进入', async () => {
  const s = new MemoryStore();
  const a = dev(s, 'a'), b = dev(s, 'b'), c = dev(s, 'c');
  assert.equal((await a.join()).ok, true);
  assert.equal((await b.join()).ok, true);
  const r = await c.join();
  assert.equal(r.ok, false);
  assert.equal(r.others.length, 2);
  await b.leave();
  assert.equal((await c.join()).ok, true);
  s.clockOffset += PRESENCE_TTL + 60000;
  assert.equal((await dev(s, 'd').join()).ok, true);
});

test('编辑权：先到先得，另一台只能查看；释放或超时后可取得', async () => {
  const s = new MemoryStore();
  const a = dev(s, 'a'), b = dev(s, 'b');
  assert.equal((await a.acquire()).ok, true);
  const rb = await b.acquire();
  assert.equal(rb.ok, false);
  assert.equal(rb.holder, 'a');
  assert.equal(await a.verify(), true);
  assert.equal(await b.verify(), false);
  assert.equal(await a.renew(), true);
  await a.release();
  assert.equal(a.editing, false);
  assert.equal((await b.acquire()).ok, true);
  // b 失联超时，a 可接手；b 随后续约/写入前检查都会失败
  s.clockOffset += LOCK_TTL + 1000;
  assert.equal((await a.acquire()).ok, true);
  assert.equal(await b.renew(), false);
  assert.equal(await b.verify(), false);
});

test('同时抢锁时只有最后写入令牌的一方成功', async () => {
  const s = new MemoryStore();
  const a = new Session({ store: s, deviceId: 'a', deviceName: 'a', sleep: () => new Promise((r) => setTimeout(r, 20)) });
  const b = new Session({ store: s, deviceId: 'b', deviceName: 'b', sleep: () => new Promise((r) => setTimeout(r, 20)) });
  const [ra, rb] = await Promise.all([a.acquire(), b.acquire()]);
  assert.equal([ra.ok, rb.ok].filter(Boolean).length, 1);
});

test('同一设备刷新页面后可直接收回自己的锁', async () => {
  const s = new MemoryStore();
  const old = dev(s, 'a');
  assert.equal((await old.acquire()).ok, true);
  const reloaded = dev(s, 'a');
  assert.equal((await dev(s, 'b').acquire()).ok, false);
  assert.equal((await reloaded.acquire()).ok, true);
  assert.equal(await old.verify(), false);
});

test('在线统计不依赖“列出文件”；登记表被覆盖后心跳会补登', async () => {
  const s = new MemoryStore();
  s.list = async () => {
    throw new Error('不应调用 list');
  };
  const a = dev(s, 'a'), b = dev(s, 'b');
  await a.join();
  await b.join();
  // 模拟并发登记互相覆盖：登记表里只剩 b
  await s.putJSON('meta/devices.json', { devices: { b: { name: 'b', registeredAt: s.now() } } });
  assert.equal((await b.othersOnline()).length, 0);
  for (let i = 0; i < 4; i++) await a.heartbeat();
  assert.equal((await b.othersOnline()).length, 1);
  const c = dev(s, 'c');
  assert.equal((await c.join()).ok, false);
});
