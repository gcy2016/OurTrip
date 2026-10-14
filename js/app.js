// 旅行相册主程序：登录、在线人数、编辑权、页面路由与渲染。

import { CONFIG } from './config.js';
import { REGION_DISPLAY, COLORS } from './region-display.js';
import { buildRegions, isRegionId, isContentRegion } from './regions.js';
import * as A from './album.js';
import { encryptSecret, decryptSecret, decryptWithKey, blobFingerprint } from './crypto.js';
import { MemoryStore } from './store-memory.js';
import { CosStore } from './store-cos.js';
import { Session, LOCK_RENEW_EVERY, HEARTBEAT_EVERY } from './session.js';
import { AlbumSync } from './sync.js';
import { h, clear, toast, confirmDialog, alertDialog, actionSheet, promptDialog, busy, copyToClipboard, formatTime } from './ui.js';
import { openUploader, thumbKey } from './upload.js';
import { openViewer } from './viewer.js';
import * as B from './boxes.js';
import { mapLinks, formatCoords, copyText } from './maps.js';

const DEMO_PASSWORD = 'demo1234';
const POLL_EVERY = 20000;
const LS_DEVICE = 'travel-album-device';
const LS_CLIPBOARD = 'travel-album-clipboard';

const params = new URLSearchParams(location.search);
const configured = !!(CONFIG.bucket && CONFIG.region && CONFIG.encryptedCredentials);
const demo = params.has('demo');
// 演示模式下加 &tab=1：每个标签页视为一台独立设备，便于在一台电脑上模拟两三个人同时使用
const perTab = demo && params.has('tab');

function lsGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k, v) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* 忽略 */
  }
}

function deviceId() {
  if (perTab) {
    let t = sessionStorage.getItem(LS_DEVICE);
    if (!t) sessionStorage.setItem(LS_DEVICE, (t = `tab${Math.random().toString(36).slice(2, 8)}`));
    return t;
  }
  let id = lsGet(LS_DEVICE);
  if (!id) {
    id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    lsSet(LS_DEVICE, id);
  }
  return id;
}

function deviceName() {
  if (perTab) return `演示设备 ${deviceId().slice(3, 6)}`;
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? '安卓设备' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows 电脑' : '电脑';
  const br = /MicroMessenger/.test(ua) ? '微信' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '浏览器';
  return `${os} · ${br}`;
}

// ---------- “记住此设备”：在 IndexedDB 里保存不可导出的解密密钥 ----------

const authDb = {
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('travel-album-auth', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('kv', mode);
      const r = fn(t.objectStore('kv'));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    });
  },
  get: (k) => authDb.run('readonly', (s) => s.get(k)).catch(() => null),
  set: (k, v) => authDb.run('readwrite', (s) => s.put(v, k)).catch(() => null),
  del: (k) => authDb.run('readwrite', (s) => s.delete(k)).catch(() => null),
};
const AUTH_KEY = demo ? 'auth-demo' : 'auth';

// ---------- 程序状态 ----------

const app = {
  regions: null,
  store: null,
  session: null,
  sync: null,
  mode: 'boot', // boot | login | full | main | error
  errorText: '',
  route: { kind: 'home', id: null },
  lock: { state: 'free' },
  selecting: false,
  selected: new Set(),
  timers: [],
  credBlob: null,
  get editing() {
    return !!(this.session && this.session.editing);
  },
  get clipboard() {
    try {
      return JSON.parse(lsGet(LS_CLIPBOARD) || 'null');
    } catch {
      return null;
    }
  },
  setClipboard(tpl) {
    lsSet(LS_CLIPBOARD, JSON.stringify(tpl));
    this.render();
  },
  regionName(id) {
    return (REGION_DISPLAY[id] && REGION_DISPLAY[id].name) || id;
  },
  imageUrl(key) {
    return this.store.urlFor(key);
  },
  go(hash) {
    if (location.hash === hash) this.render();
    else location.hash = hash;
  },
  /** 修改相册；成功返回 { value }，失败返回 null 并提示原因 */
  mutate(fn) {
    if (!this.editing) {
      toast('当前是只读状态，请先点“开始编辑”', 'warn');
      return null;
    }
    try {
      const value = this.sync.mutate(fn);
      this.render();
      return { value };
    } catch (e) {
      if (e instanceof A.AlbumError) alertDialog(e.message, { title: '无法完成' });
      else toast(e.message || '操作失败', 'error');
      return null;
    }
  },
  renderQueued: false,
  render() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      renderNow();
    });
  },
};
window.__app = app; // 便于调试与自动化测试

const root = document.getElementById('app');

// ---------- 启动 ----------

async function boot() {
  try {
    if (typeof REGION_MAP_ANON === 'undefined') throw new Error('区域映射文件 data/region-map-anon.js 未加载');
    app.regions = buildRegions(REGION_MAP_ANON);
  } catch (e) {
    app.mode = 'error';
    app.errorText = `区域数据有误：${e.message}`;
    return renderNow();
  }
  if (demo) {
    // 演示用密文固定保存在本浏览器，“记住此设备”才能在刷新后生效
    try {
      app.credBlob = JSON.parse(lsGet('travel-album-demo-blob') || 'null');
    } catch {
      app.credBlob = null;
    }
    if (!app.credBlob) {
      app.credBlob = await encryptSecret({ secretId: 'demo', secretKey: 'demo' }, DEMO_PASSWORD, 1000);
      lsSet('travel-album-demo-blob', JSON.stringify(app.credBlob));
    }
  }
  else if (configured) app.credBlob = CONFIG.encryptedCredentials;
  parseRoute();
  if (app.credBlob) {
    const saved = await authDb.get(AUTH_KEY);
    if (saved && saved.key && saved.fp === (await blobFingerprint(app.credBlob))) {
      try {
        const secret = await decryptWithKey(app.credBlob, saved.key);
        return startSession(secret);
      } catch {
        await authDb.del(AUTH_KEY);
      }
    }
  }
  app.mode = 'login';
  renderNow();
}

async function login(password, remember) {
  const { secret, key } = await decryptSecret(app.credBlob, password);
  if (remember) await authDb.set(AUTH_KEY, { fp: await blobFingerprint(app.credBlob), key });
  else await authDb.del(AUTH_KEY);
  await startSession(secret);
}

async function startSession(secret) {
  app.mode = 'boot';
  renderNow();
  try {
    app.store = demo
      ? new MemoryStore({ persistent: true })
      : new CosStore({ bucket: CONFIG.bucket, region: CONFIG.region, secretId: secret.secretId, secretKey: secret.secretKey });
    app.session = new Session({ store: app.store, deviceId: deviceId(), deviceName: deviceName() });
    const joined = await app.session.join();
    if (!joined.ok) {
      app.mode = 'full';
      app.pendingSecret = secret;
      return renderNow();
    }
    app.sync = new AlbumSync({ store: app.store, session: app.session, onChange: () => app.render() });
    await app.sync.load();
    app.lock = await app.session.lockStatus();
    app.mode = 'main';
    startTimers();
    renderNow();
  } catch (e) {
    app.mode = 'error';
    app.errorText = `无法连接云端：${e.message || e}`;
    app.pendingSecret = secret;
    renderNow();
  }
}

function stopTimers() {
  app.timers.forEach(clearInterval);
  app.timers = [];
}

function startTimers() {
  stopTimers();
  app.timers.push(setInterval(() => app.session.heartbeat().catch(() => {}), HEARTBEAT_EVERY));
  app.timers.push(setInterval(tickLock, LOCK_RENEW_EVERY));
  app.timers.push(setInterval(pollReadOnly, POLL_EVERY));
}

async function tickLock() {
  if (!app.editing) return;
  try {
    const ok = await app.session.renew();
    if (!ok) onLockLost();
  } catch {
    /* 断网：续约失败，等锁过期后由 verify 判断 */
  }
}

async function pollReadOnly() {
  if (app.editing || app.mode !== 'main') return;
  try {
    const before = app.lock.state;
    app.lock = await app.session.lockStatus();
    const changed = await app.sync.refreshIfChanged();
    if (changed) toast('已同步最新内容');
    if (changed || before !== app.lock.state) app.render();
  } catch {
    /* 网络问题，下次再试 */
  }
}

function onLockLost() {
  app.lock = { state: 'free' };
  toast('编辑权已失效（可能因断网或长时间无响应），已切换为只读。未保存的修改已暂存在本机。', 'warn', 6000);
  app.render();
}

async function startEditing(btn) {
  const run = async () => {
    const r = await app.session.acquire();
    if (!r.ok) {
      app.lock = await app.session.lockStatus();
      app.render();
      return alertDialog(`${r.holder} 正在编辑，你当前只能查看。对方结束编辑，或超过 2 分钟无响应后，可以再试。`, { title: '编辑权已被占用' });
    }
    app.lock = { state: 'mine' };
    if (app.sync.dirty) {
      // 本次会话里还有没保存成功的修改：直接重新保存
      app.sync.retry();
    } else {
      await app.sync.load();
      const d = app.sync.pendingDraft();
      if (d && d.usable) {
        if (await confirmDialog(`发现本机 ${formatTime(d.at)} 有未保存的修改，是否恢复并保存？`, { okLabel: '恢复' })) app.sync.restoreDraft();
        else app.sync.discardDraft();
      } else if (d) {
        app.sync.discardDraft();
        await alertDialog(`本机暂存的修改（${formatTime(d.at)}）在此期间云端已被更新，无法自动恢复，已丢弃。`);
      }
    }
    app.render();
  };
  try {
    await (btn ? busy(btn, run()) : run());
  } catch (e) {
    toast(`取得编辑权失败：${e.message || '网络错误'}`, 'error');
  }
}

async function stopEditing(btn) {
  const run = async () => {
    const ok = await app.sync.flush();
    if (!ok && !(await confirmDialog('还有修改没有保存成功。结束编辑后这些修改只暂存在本机，下次取得编辑权时可尝试恢复。确定结束？', { danger: true }))) return;
    await app.session.release();
    app.lock = { state: 'free' };
    app.selecting = false;
    app.selected.clear();
    app.render();
  };
  try {
    await (btn ? busy(btn, run()) : run());
  } catch (e) {
    toast(`结束编辑时出错：${e.message || '网络错误'}`, 'error');
  }
}

async function logout() {
  if (app.sync && app.sync.dirty && !(await confirmDialog('还有修改没有保存成功，确定退出？', { danger: true }))) return;
  stopTimers();
  try {
    if (app.session) {
      await app.session.release();
      await app.session.leave();
    }
  } catch {
    /* 忽略 */
  }
  await authDb.del(AUTH_KEY);
  app.session = null;
  app.sync = null;
  app.store = null;
  app.mode = 'login';
  renderNow();
}

window.addEventListener('pagehide', () => {
  if (!app.session) return;
  app.session.release().catch(() => {});
  app.session.leave().catch(() => {});
});
window.addEventListener('beforeunload', (e) => {
  if (app.sync && app.sync.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.mode === 'main') {
    app.session.heartbeat().catch(() => {});
    if (app.editing) tickLock();
    else pollReadOnly();
  }
});

// ---------- 路由 ----------

function parseRoute() {
  const m = /^#\/(r|b)\/([\w-]+)$/.exec(location.hash);
  app.route = m ? { kind: m[1] === 'r' ? 'region' : 'box', id: m[2] } : { kind: 'home', id: null };
}

window.addEventListener('hashchange', () => {
  parseRoute();
  app.selecting = false;
  app.selected.clear();
  renderNow();
  window.scrollTo(0, 0);
});

// ---------- 渲染 ----------

function renderNow() {
  clear(root);
  if (app.mode === 'boot') root.appendChild(h('div', { class: 'center-page' }, h('p', { class: 'muted' }, '加载中…')));
  else if (app.mode === 'login') root.appendChild(loginView());
  else if (app.mode === 'full') root.appendChild(fullView());
  else if (app.mode === 'error') root.appendChild(errorView());
  else root.appendChild(mainView());
}

function loginView() {
  const card = h('div', { class: 'card login' }, h('h1', null, '旅行相册'));
  if (demo) {
    card.appendChild(
      h('p', { class: 'notice' }, `演示模式：数据只保存在当前浏览器里，不会上传到云端。演示密码：${DEMO_PASSWORD}`)
    );
  }
  if (!app.credBlob) {
    card.appendChild(h('p', { class: 'notice' }, '尚未配置云端存储（存储桶名称、地域、密钥密文）。可以先进入演示模式体验。'));
    card.appendChild(h('a', { class: 'btn btn-primary', href: '?demo=1' }, '进入演示模式'));
    return h('div', { class: 'center-page' }, card);
  }
  const pwd = h('input', { class: 'input', type: 'password', placeholder: '共享密码', autocomplete: 'current-password', autofocus: true, 'aria-label': '共享密码' });
  const remember = h('input', { type: 'checkbox', id: 'remember' });
  const err = h('p', { class: 'error-text', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, '进入');
  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        if (!pwd.value) {
          err.textContent = '请输入密码';
          return;
        }
        const run = busy(
          btn,
          login(pwd.value, remember.checked).catch((ex) => {
            err.textContent = ex.code === 'WRONG_PASSWORD' ? '密码不正确，请重试' : '无法进入，请稍后重试';
            pwd.select();
          })
        );
        btn.textContent = '正在解锁…';
        await run;
      },
    },
    pwd,
    h('label', { class: 'check', for: 'remember' }, remember, ' 记住此设备'),
    h('p', { class: 'dialog-hint' }, '只在自己的手机或电脑上勾选。之后可在右上角菜单“退出并清除本设备”。'),
    btn,
    err
  );
  card.appendChild(form);
  if (!demo && configured) card.appendChild(h('p', { class: 'foot-link' }, h('a', { href: '?demo=1' }, '演示模式')));
  return h('div', { class: 'center-page' }, card);
}

function fullView() {
  return h(
    'div',
    { class: 'center-page' },
    h(
      'div',
      { class: 'card' },
      h('h1', null, '在线人数已满'),
      h('p', null, '当前已有 2 位使用者在线，已达到在线人数上限，请稍后再试。'),
      h('p', { class: 'dialog-hint' }, '对方关闭网页后约 1–2 分钟会自动释放名额。'),
      h(
        'div',
        { class: 'row-gap' },
        h('button', { class: 'btn btn-primary', onclick: () => startSession(app.pendingSecret) }, '重试'),
        h('button', { class: 'btn', onclick: logout }, '返回')
      )
    )
  );
}

function errorView() {
  return h(
    'div',
    { class: 'center-page' },
    h(
      'div',
      { class: 'card' },
      h('h1', null, '出错了'),
      h('p', null, app.errorText),
      h(
        'div',
        { class: 'row-gap' },
        app.pendingSecret ? h('button', { class: 'btn btn-primary', onclick: () => startSession(app.pendingSecret) }, '重试') : null,
        h('button', { class: 'btn', onclick: logout }, '返回登录')
      )
    )
  );
}

// ----- 主界面 -----

function mainView() {
  const album = app.sync.album;
  app.lit = A.computeLit(album, app.regions);
  let page;
  const { kind, id } = app.route;
  if (kind === 'region' && app.regions.byId.has(id)) {
    page = isContentRegion(app.regions, id) ? containerView(id) : level1View(id);
  } else if (kind === 'box' && album.nodes[id]) {
    page = containerView(id);
  } else if (kind !== 'home') {
    page = h('div', { class: 'empty' }, h('p', null, '这个框不存在或已被删除。'), h('a', { class: 'btn', href: '#/' }, '返回首页'));
  } else {
    page = homeView();
  }
  return h('div', { class: 'shell' }, topBar(), statusBanner(), h('main', { class: 'page' }, breadcrumb(), page));
}

function topBar() {
  const lockChip = app.editing
    ? h('span', { class: 'chip-status editing' }, '编辑中')
    : app.lock.state === 'other'
      ? h('span', { class: 'chip-status other' }, `${app.lock.name} 正在编辑 · 只读`)
      : h('span', { class: 'chip-status' }, '只读');
  const editBtn = app.editing
    ? h('button', { class: 'btn btn-small', onclick: (e) => stopEditing(e.currentTarget) }, '结束编辑')
    : h('button', { class: 'btn btn-small btn-primary', onclick: (e) => startEditing(e.currentTarget) }, '开始编辑');
  return h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'brand', href: '#/' }, '旅行相册', demo ? h('small', null, ' 演示') : null),
    h('div', { class: 'top-actions' }, saveChip(), lockChip, editBtn, h('button', { class: 'icon-btn', 'aria-label': '菜单', onclick: menu }, '☰'))
  );
}

function saveChip() {
  const s = app.sync;
  if (s.status === 'saving') return h('span', { class: 'chip-status' }, '保存中…');
  if (s.status === 'saved' && !s.dirty) return h('span', { class: 'chip-status ok' }, '已保存');
  if (s.dirty && s.status !== 'error' && s.status !== 'conflict' && s.status !== 'lost-lock') return h('span', { class: 'chip-status' }, '待保存');
  return null;
}

function statusBanner() {
  const s = app.sync;
  if (s.status === 'error') {
    return h('div', { class: 'banner banner-error' }, `保存失败：${s.error}。修改已暂存在本机。`, h('button', { class: 'btn btn-small', onclick: () => s.retry() }, '重试'));
  }
  if (s.status === 'conflict') {
    return h(
      'div',
      { class: 'banner banner-error' },
      `${s.error}。为避免覆盖对方的内容，请重新载入后再操作。`,
      h(
        'button',
        {
          class: 'btn btn-small',
          onclick: async () => {
            s.discardDraft();
            await s.load();
            toast('已重新载入');
          },
        },
        '重新载入'
      )
    );
  }
  if (s.status === 'lost-lock') {
    return h('div', { class: 'banner banner-warn' }, `${s.error}。`, h('button', { class: 'btn btn-small', onclick: (e) => startEditing(e.currentTarget) }, '重新取得编辑权并保存'));
  }
  if (!app.editing && app.lock.state === 'other') {
    return h('div', { class: 'banner' }, `${app.lock.name} 正在编辑，你当前只能查看；对方保存后这里会自动更新。`);
  }
  return null;
}

async function menu() {
  const opts = [
    { label: '刷新数据', value: 'refresh' },
    { label: '退出并清除本设备', value: 'logout', danger: true },
  ];
  if (demo) {
    opts.splice(1, 0, { label: '演示：让下一次保存失败', value: 'fail' }, { label: '演示：清空演示数据', value: 'reset' });
  }
  const v = await actionSheet('菜单', opts);
  if (v === 'refresh') {
    if (app.sync.dirty) return toast('还有未保存的修改，请先等待保存完成', 'warn');
    await app.sync.load();
    app.lock = await app.session.lockStatus();
    toast('已刷新');
  }
  if (v === 'logout') logout();
  if (v === 'fail') {
    globalThis.__demoFailWrites = 1;
    toast('下一次写入云端将模拟失败');
  }
  if (v === 'reset' && (await confirmDialog('清空本浏览器中的全部演示数据？', { danger: true }))) {
    await logout();
    indexedDB.deleteDatabase('travel-album-demo');
    location.reload();
  }
}

function breadcrumb() {
  const { kind, id } = app.route;
  if (kind === 'home') return null;
  const album = app.sync.album;
  const chain = [];
  let cur = id;
  while (cur) {
    chain.unshift(cur);
    if (isRegionId(cur)) cur = app.regions.byId.get(cur) && app.regions.byId.get(cur).parent;
    else cur = album.nodes[cur] && album.nodes[cur].parent;
  }
  const items = [h('a', { href: '#/' }, '全部区域')];
  chain.forEach((c, i) => {
    const text = isRegionId(c) ? app.regionName(c) : album.nodes[c] ? album.nodes[c].title : '…';
    items.push(h('span', { class: 'sep' }, '/'));
    items.push(i === chain.length - 1 ? h('span', { class: 'current' }, text) : h('a', { href: isRegionId(c) ? `#/r/${c}` : `#/b/${c}` }, text));
  });
  return h('nav', { class: 'crumbs', 'aria-label': '位置' }, items);
}

// ----- 网格与方框 -----

function lazyImage(key, alt = '') {
  const img = h('img', { alt, loading: 'lazy', decoding: 'async' });
  app
    .imageUrl(key)
    .then((u) => {
      if (u) img.src = u;
    })
    .catch(() => img.remove());
  return img;
}

function tile({ href, title, sub, color, imgKey, imgSrc, lit, badge, extra, onclick, selected }) {
  const bg = h('div', { class: 'tile-bg', style: { background: color } });
  if (imgKey) bg.appendChild(lazyImage(imgKey));
  else if (imgSrc) bg.appendChild(h('img', { src: imgSrc, alt: '', loading: 'lazy' }));
  return h(
    'a',
    {
      class: `tile${lit === false ? ' unlit' : ''}${lit ? ' lit' : ''}${selected ? ' selected' : ''}`,
      href: href || '#',
      onclick,
    },
    bg,
    h('div', { class: 'tile-text' }, h('div', { class: 'tile-title' }, title), sub ? h('div', { class: 'tile-sub' }, sub) : null),
    badge ? h('span', { class: 'tile-badge' }, badge) : null,
    lit ? h('span', { class: 'lit-mark', title: '已点亮' }, '已点亮') : null,
    extra || null
  );
}

function regionTile(id) {
  const r = app.regions.byId.get(id);
  const album = app.sync.album;
  const cover = A.resolveCover(album, app.regions, id);
  const disp = REGION_DISPLAY[id] || {};
  let sub = '';
  if (r.children.length) {
    const litKids = r.children.filter((c) => app.lit.has(c)).length;
    sub = `点亮 ${litKids}/${r.children.length}`;
  }
  return tile({
    href: `#/r/${id}`,
    title: app.regionName(id),
    sub,
    color: COLORS.region,
    imgKey: cover ? thumbKey(cover) : null,
    imgSrc: !cover && disp.image ? disp.image : null,
    lit: app.lit.has(id),
  });
}

function homeView() {
  const total = app.regions.level1.length;
  const litCount = app.regions.level1.filter((id) => app.lit.has(id)).length;
  return h(
    'section',
    null,
    h('div', { class: 'page-head' }, h('h1', null, '全部区域'), h('p', { class: 'sub' }, `已点亮 ${litCount} / ${total} 个一级区域`)),
    h('div', { class: 'grid' }, app.regions.level1.map(regionTile))
  );
}

function level1View(id) {
  const r = app.regions.byId.get(id);
  const litKids = r.children.filter((c) => app.lit.has(c)).length;
  return h(
    'section',
    null,
    h(
      'div',
      { class: 'page-head' },
      h('h1', null, app.regionName(id)),
      h('p', { class: 'sub' }, `${r.children.length} 个二级区域，已点亮 ${litKids} 个`),
      regionCoverTools(id)
    ),
    h('div', { class: 'grid' }, r.children.map(regionTile))
  );
}

function regionCoverTools(id) {
  if (!app.editing || !app.sync.album.regionCovers[id]) return null;
  return h('button', { class: 'btn btn-small', onclick: () => app.mutate((a) => A.clearCover(a, id)) }, '清除区域封面');
}

function boxTile(node) {
  const album = app.sync.album;
  const kids = A.childNodes(album, node.id);
  const cover = A.resolveCover(album, app.regions, node.id);
  let sub = '';
  if (kids.length) sub = `${kids.length} 个框`;
  else {
    const parts = [];
    if (node.photos.length) parts.push(`${node.photos.length} 张`);
    if (node.note.trim()) parts.push('备注');
    if (A.hasLocation(node.location)) parts.push('地点');
    sub = parts.join(' · ');
  }
  const selecting = app.selecting;
  const extra =
    app.editing && !selecting
      ? h(
          'button',
          {
            class: 'tile-menu',
            'aria-label': `“${node.title}”的操作`,
            onclick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              B.boxActions(app, node.id);
            },
          },
          '⋯'
        )
      : selecting
        ? h('span', { class: 'tile-check' }, app.selected.has(node.id) ? '✓' : '')
        : null;
  return tile({
    href: `#/b/${node.id}`,
    title: node.title,
    sub,
    color: /^#[0-9a-fA-F]{6}$/.test(node.color || '') ? node.color : COLORS.box,
    imgKey: cover ? thumbKey(cover) : null,
    badge: node.type || null,
    extra,
    selected: selecting && app.selected.has(node.id),
    onclick: selecting
      ? (e) => {
          e.preventDefault();
          if (app.selected.has(node.id)) app.selected.delete(node.id);
          else app.selected.add(node.id);
          app.render();
        }
      : undefined,
  });
}

function containerView(id) {
  const album = app.sync.album;
  const isBox = !isRegionId(id);
  const node = isBox ? album.nodes[id] : null;
  const kids = A.childNodes(album, id);
  const content = isBox && A.hasContent(node);
  const canKids = A.canHoldChildren(album, app.regions, id);

  const head = h(
    'div',
    { class: 'page-head' },
    h('h1', null, isBox ? node.title : app.regionName(id), node && node.type ? h('span', { class: 'type-badge' }, node.type) : null),
    !isBox ? h('p', { class: 'sub' }, app.lit.has(id) ? '已点亮' : '还没有旅行内容') : null,
    isBox && app.editing ? h('button', { class: 'btn btn-small', onclick: () => B.boxActions(app, id) }, '本框操作 ⋯') : null,
    !isBox ? regionCoverTools(id) : null
  );

  const section = h('section', null, head);

  if (app.editing) section.appendChild(toolbar(id, kids, content, canKids));

  if (kids.length) {
    section.appendChild(h('div', { class: 'grid' }, kids.map(boxTile)));
  } else if (!isBox) {
    section.appendChild(
      h('div', { class: 'empty' }, app.editing ? '点“新建框”开始记录，例如按日期或行程建一个框，再在里面放相册、美食、景点、餐厅。' : '这里还没有内容。')
    );
  }

  if (isBox && !kids.length) {
    if (!content && app.editing) {
      section.appendChild(h('p', { class: 'hint' }, '这个框是空的：可以直接添加照片、备注、地点；也可以新建子框继续分层（二者选其一）。'));
    }
    if (!content && !app.editing) section.appendChild(h('div', { class: 'empty' }, '这个框还是空的。'));
    if (content || app.editing) section.appendChild(contentView(node));
  }
  return section;
}

function toolbar(id, kids, content, canKids) {
  if (app.selecting) {
    const n = app.selected.size;
    return h(
      'div',
      { class: 'toolbar' },
      h('span', { class: 'muted' }, `已选 ${n} 个`),
      h(
        'button',
        {
          class: 'btn btn-primary btn-small',
          disabled: n === 0,
          onclick: async () => {
            const ids = kids.map((k) => k.id).filter((k) => app.selected.has(k));
            if (await B.mergeFlow(app, ids)) {
              app.selecting = false;
              app.selected.clear();
              app.render();
            }
          },
        },
        '合并为一个框'
      ),
      h(
        'button',
        {
          class: 'btn btn-small',
          onclick: () => {
            app.selecting = false;
            app.selected.clear();
            app.render();
          },
        },
        '取消'
      )
    );
  }
  const clip = app.clipboard;
  return h(
    'div',
    { class: 'toolbar' },
    h('button', { class: 'btn btn-primary btn-small', onclick: () => B.newBoxDialog(app, id) }, content ? '+ 新建子框' : '+ 新建框'),
    kids.length
      ? h(
          'button',
          {
            class: 'btn btn-small',
            onclick: () => {
              app.selecting = true;
              app.selected.clear();
              app.render();
            },
          },
          '选择 / 合并'
        )
      : null,
    clip && canKids ? h('button', { class: 'btn btn-small', onclick: () => B.pasteFlow(app, id) }, `粘贴模板“${clip.title}”`) : null
  );
}

function contentView(node) {
  const editing = app.editing;
  const wrap = h('div', { class: 'content' });

  // 照片
  const photoHead = h('div', { class: 'section-head' }, h('h2', null, `照片${node.photos.length ? `（${node.photos.length}）` : ''}`));
  if (editing) {
    const input = h('input', { type: 'file', multiple: true, accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: 'file-input' });
    input.addEventListener('change', () => {
      const files = input.files;
      if (files && files.length) openUploader(app, node.id, files);
      input.value = '';
    });
    photoHead.appendChild(h('label', { class: 'btn btn-small btn-primary', for: 'file-input' }, '上传照片', input));
  }
  wrap.appendChild(photoHead);
  if (node.photos.length) {
    wrap.appendChild(
      h(
        'div',
        { class: 'photo-grid' },
        node.photos.map((pid, i) =>
          h(
            'button',
            { class: 'photo', 'aria-label': `查看第 ${i + 1} 张`, onclick: () => openViewer(app, node.photos.slice(), i) },
            lazyImage(thumbKey(pid)),
            node.cover === pid ? h('span', { class: 'photo-flag' }, '封面') : null
          )
        )
      )
    );
  } else {
    wrap.appendChild(h('p', { class: 'muted' }, editing ? '单批最多 50 张，上传前会自动压缩；首版不支持视频。' : '暂无照片'));
  }

  // 备注
  wrap.appendChild(
    h(
      'div',
      { class: 'section-head' },
      h('h2', null, '备注'),
      editing
        ? h(
            'button',
            {
              class: 'btn btn-small',
              onclick: async () => {
                const v = await promptDialog('备注', { value: node.note, multiline: true });
                if (v !== undefined) app.mutate((a) => A.setNote(a, node.id, v));
              },
            },
            '编辑'
          )
        : null
    )
  );
  wrap.appendChild(node.note.trim() ? h('p', { class: 'note' }, node.note) : h('p', { class: 'muted' }, '暂无备注'));

  // 地点
  wrap.appendChild(
    h(
      'div',
      { class: 'section-head' },
      h('h2', null, '地点'),
      editing ? h('button', { class: 'btn btn-small', onclick: () => B.locationDialog(app, node.id) }, '编辑') : null
    )
  );
  const loc = node.location;
  if (A.hasLocation(loc)) {
    const links = mapLinks(loc, node.title);
    wrap.appendChild(
      h(
        'div',
        { class: 'location' },
        loc.address ? h('p', { class: 'note' }, loc.address) : null,
        Number.isFinite(loc.lat) ? h('p', { class: 'muted' }, `坐标：${formatCoords(loc)}`) : null,
        h(
          'div',
          { class: 'map-links' },
          links.map((l) => h('a', { class: 'btn btn-small', href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.label)),
          copyText(loc)
            ? h(
                'button',
                {
                  class: 'btn btn-small',
                  onclick: async () => toast((await copyToClipboard(copyText(loc))) ? '已复制地址/坐标' : '复制失败，请长按手动复制', 'ok'),
                },
                '复制地址/坐标'
              )
            : null
        ),
        h('p', { class: 'dialog-hint' }, '如果点击后没有打开地图 App，会进入对应的网页地图；也可以复制地址或坐标到地图里搜索。')
      )
    );
  } else {
    wrap.appendChild(h('p', { class: 'muted' }, '暂无地点'));
  }
  return wrap;
}

boot();
