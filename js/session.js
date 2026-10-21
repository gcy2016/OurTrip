// 在线人数与编辑权（方案 B：纯 COS，尽力而为）。
// - 在线：每台设备定期写 meta/presence/{设备ID}.json 心跳，超过 PRESENCE_TTL 未更新视为离线；
//   设备 ID 登记在 meta/devices.json 里，统计在线时按登记表逐个读取（不需要“列出文件”权限）。
// - 编辑权：meta/lock.json 记录持有者与续约时间，超过 LOCK_TTL 未续约视为失效；
//   抢锁时写入随机令牌，等待片刻后回读确认，降低两台设备同时抢到的概率。
// 这些机制都由网页自觉遵守，不能防止绕过网页直接写存储桶，也不能在极端时序下严格保证排他；
// 保存 album.json 前的版本比对是防止互相覆盖的第二道保护。

export const LOCK_KEY = 'meta/lock.json';
export const PRESENCE_PREFIX = 'meta/presence/';
export const REGISTRY_KEY = 'meta/devices.json';
const REGISTRY_REFRESH = 7 * 86400000;
const REGISTRY_EXPIRE = 30 * 86400000;
export const MAX_ONLINE = 2;
// 编辑权 5 分钟未续约才失效：切到手机相册找照片时网页会暂停续约，回来不必重新取得编辑权（用户 2026-10-21）
export const LOCK_TTL = 300000;
export const LOCK_RENEW_EVERY = 30000;
export const PRESENCE_TTL = 75000;
export const HEARTBEAT_EVERY = 25000;
export const SETTLE_MS = 1500;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function token() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class Session {
  constructor({ store, deviceId, deviceName, sleep = defaultSleep, settleMs = SETTLE_MS }) {
    this.store = store;
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.sleep = sleep;
    this.settleMs = settleMs;
    this.lockToken = null;
  }

  presenceKey(id = this.deviceId) {
    return `${PRESENCE_PREFIX}${id}.json`;
  }

  async readRegistry() {
    const rec = await this.store.getJSON(REGISTRY_KEY);
    const devices = rec && rec.data && typeof rec.data.devices === 'object' && rec.data.devices ? rec.data.devices : {};
    return devices;
  }

  /** 把本机登记到设备表；顺带清理 30 天未重新登记的旧设备 */
  async register(devices) {
    const now = this.store.now();
    const mine = devices[this.deviceId];
    if (mine && now - mine.registeredAt < REGISTRY_REFRESH) return;
    const next = {};
    for (const [id, d] of Object.entries(devices)) if (d && now - d.registeredAt < REGISTRY_EXPIRE) next[id] = d;
    next[this.deviceId] = { name: this.deviceName, registeredAt: now };
    await this.store.putJSON(REGISTRY_KEY, { devices: next });
  }

  /** 其他在线设备（不含本机） */
  async othersOnline(devices) {
    const now = this.store.now();
    const ids = Object.keys(devices || (await this.readRegistry())).filter((id) => id !== this.deviceId);
    const out = [];
    for (const id of ids) {
      const rec = await this.store.getJSON(this.presenceKey(id));
      const p = rec && rec.data;
      if (p && !p.left && now - p.seenAt < PRESENCE_TTL) out.push(p);
    }
    return out;
  }

  /** 进入相册：在线人数已满时返回 { ok:false } */
  async join() {
    const devices = await this.readRegistry();
    const others = await this.othersOnline(devices);
    if (others.length >= MAX_ONLINE) return { ok: false, others };
    await this.register(devices);
    await this.heartbeat();
    return { ok: true, others };
  }

  async heartbeat() {
    // 两台设备同时首次登记可能互相覆盖登记表，这里定期检查并补登
    this.beats = (this.beats || 0) + 1;
    if (this.beats % 4 === 0) {
      const devices = await this.readRegistry();
      if (!devices[this.deviceId]) await this.register(devices);
    }
    await this.store.putJSON(this.presenceKey(), {
      deviceId: this.deviceId,
      name: this.deviceName,
      seenAt: this.store.now(),
      left: false,
    });
  }

  async leave() {
    await this.store.putJSON(this.presenceKey(), {
      deviceId: this.deviceId,
      name: this.deviceName,
      seenAt: this.store.now(),
      left: true,
    });
  }

  async readLock() {
    const rec = await this.store.getJSON(LOCK_KEY);
    return rec ? rec.data : null;
  }

  /** 解析锁状态：free / mine / other */
  describeLock(lock) {
    const now = this.store.now();
    if (!lock || !lock.holder || now - lock.renewedAt > LOCK_TTL) return { state: 'free' };
    if (lock.holder === this.deviceId) {
      // 同一台设备刷新页面后，旧页面的锁可以直接收回，不必等待过期
      return lock.token === this.lockToken ? { state: 'mine', lock } : { state: 'free', ownStale: true };
    }
    return { state: 'other', lock, name: lock.name || '另一台设备', since: lock.acquiredAt };
  }

  async lockStatus() {
    return this.describeLock(await this.readLock());
  }

  async acquire() {
    const before = this.describeLock(await this.readLock());
    if (before.state === 'other') return { ok: false, holder: before.name };
    if (before.state === 'mine') return { ok: true };
    const t = token();
    const now = this.store.now();
    await this.store.putJSON(LOCK_KEY, {
      holder: this.deviceId,
      name: this.deviceName,
      token: t,
      acquiredAt: now,
      renewedAt: now,
    });
    await this.sleep(this.settleMs);
    const after = await this.readLock();
    if (after && after.token === t) {
      this.lockToken = t;
      return { ok: true };
    }
    return { ok: false, holder: (after && after.name) || '另一台设备' };
  }

  /** 续约；锁已被他人取得或失效时返回 false */
  async renew() {
    if (!this.lockToken) return false;
    const lock = await this.readLock();
    if (!lock || lock.token !== this.lockToken) {
      this.lockToken = null;
      return false;
    }
    if (this.store.now() - lock.renewedAt > LOCK_TTL) {
      this.lockToken = null;
      return false;
    }
    await this.store.putJSON(LOCK_KEY, { ...lock, renewedAt: this.store.now() });
    return true;
  }

  /** 写入前确认编辑权仍在本机 */
  async verify() {
    if (!this.lockToken) return false;
    const d = this.describeLock(await this.readLock());
    if (d.state !== 'mine') this.lockToken = null;
    return d.state === 'mine';
  }

  async release() {
    if (!this.lockToken) return;
    const lock = await this.readLock();
    const mine = lock && lock.token === this.lockToken;
    this.lockToken = null;
    if (mine) await this.store.putJSON(LOCK_KEY, { holder: null, releasedAt: this.store.now() });
  }

  get editing() {
    return !!this.lockToken;
  }
}
