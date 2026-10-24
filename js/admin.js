// 维护工具：恢复已删除内容、检查文件一致性、清理孤立文件、回退 album.json 历史版本。
// 使用“维护子账号”（子用户 B）的密钥，只在本页临时输入，不保存。

import { CONFIG } from './config.js';
import { buildRegions } from './regions.js';
import * as A from './album.js';
import { CosStore } from './store-cos.js';
import { MemoryStore } from './store-memory.js';
import { Session, PRESENCE_PREFIX } from './session.js';
import { ALBUM_KEY } from './sync.js';
import { photoKey, thumbKey } from './upload.js';
import { h, clear, toast, confirmDialog, alertDialog, formatTime } from './ui.js';
import * as N from './region-names.js';

const demo = new URLSearchParams(location.search).has('demo');
const root = document.getElementById('admin');
const regions = buildRegions(REGION_MAP_ANON);
const ORPHAN_MIN_AGE = 24 * 3600 * 1000;

let store = null;
let session = null;
let current = null; // { album, etag }
let fileReport = null;
let versions = null;

async function reload() {
  const rec = await store.getJSON(ALBUM_KEY);
  current = { album: A.normalizeAlbum(rec ? rec.data : null), etag: rec ? rec.etag : null };
}

/** 取得编辑权 → 载入最新数据 → 修改 → 版本比对后保存 → 释放编辑权 */
async function withLock(label, fn) {
  const r = await session.acquire();
  if (!r.ok) {
    await alertDialog(`${r.holder} 正在编辑相册。请等对方结束编辑后再执行维护操作。`);
    return false;
  }
  let ok = false;
  try {
    await reload();
    const result = await fn(current.album);
    if (result === false) return false;
    A.syncLitTimes(current.album, regions, store.now());
    const remote = await store.headETag(ALBUM_KEY);
    if (remote !== current.etag) throw new Error('云端数据刚被修改，请刷新后重试');
    current.album.updatedAt = store.now();
    current.etag = await store.putJSON(ALBUM_KEY, current.album);
    toast(`${label}：已完成`, 'ok');
    ok = true;
    return true;
  } catch (e) {
    await alertDialog(`${label}失败：${e.message}`);
    return false;
  } finally {
    await session.release().catch(() => {});
    if (!ok) await reload().catch(() => {});
    render();
  }
}

function connectView() {
  const sid = h('input', { class: 'input', placeholder: '维护子账号 SecretId', autocomplete: 'off', spellcheck: 'false' });
  const skey = h('input', { class: 'input', type: 'password', placeholder: '维护子账号 SecretKey', autocomplete: 'off' });
  const bucket = h('input', { class: 'input', placeholder: '存储桶名称，例如 ourtrip-1250000000' });
  const region = h('input', { class: 'input', placeholder: '地域，例如 ap-guangzhou' });
  bucket.value = CONFIG.bucket || '';
  region.value = CONFIG.region || '';
  const err = h('p', { class: 'error-text' });
  const btn = h('button', { class: 'btn btn-primary' }, '连接');
  btn.addEventListener('click', async () => {
    err.textContent = '';
    try {
      store = demo
        ? new MemoryStore({ persistent: true })
        : new CosStore({ bucket: bucket.value.trim(), region: region.value.trim(), secretId: sid.value.trim(), secretKey: skey.value.trim() });
      session = new Session({ store, deviceId: 'maintenance-tool', deviceName: '维护工具' });
      await reload();
      skey.value = '';
      render();
    } catch (e) {
      store = null;
      err.textContent = `连接失败：${e.message}`;
    }
  });
  return h(
    'div',
    { class: 'card admin-card' },
    h('h1', null, '相册维护工具'),
    h('p', { class: 'notice' }, demo ? '演示模式：操作本浏览器里的演示数据。' : '请使用维护子账号（子用户 B）的密钥。密钥只用于本页，不会保存，也不要发给任何人。'),
    demo ? null : [sid, skey, bucket, region],
    btn,
    err
  );
}

function section(title, ...children) {
  return h('section', { class: 'card admin-card' }, h('h2', null, title), ...children);
}

function overview() {
  const a = current.album;
  const problems = A.validateAlbum(a, regions);
  return section(
    '概况与自检',
    h('p', null, `框 ${Object.keys(a.nodes).length} 个，照片 ${Object.keys(a.photos).length} 张，回收记录 ${a.trash.length} 条，点亮区域 ${A.computeLit(a, regions).size} 个。`),
    h('p', { class: 'muted' }, `最后保存：${a.updatedAt ? formatTime(a.updatedAt) : '—'}`),
    problems.length ? h('ul', { class: 'error-text' }, problems.map((p) => h('li', null, p))) : h('p', { class: 'ok-text' }, '数据结构自检通过'),
    h('button', { class: 'btn btn-small', onclick: async () => (await reload(), render()) }, '刷新')
  );
}

function trashSection() {
  const a = current.album;
  const now = store.now();
  const rows = a.trash
    .slice()
    .sort((x, y) => y.deletedAt - x.deletedAt)
    .map((t) => {
      const days = Math.max(0, Math.ceil((t.deletedAt + A.TRASH_KEEP_MS - now) / 86400000));
      const what = t.kind === 'box' ? `框“${t.node.title}”（${t.photos.length} 张照片${A.hasNotes(A.migrateNode({ ...t.node })) ? '，含备注' : ''}${A.hasLocations(A.migrateNode({ ...t.node })) ? '，含地点' : ''}）` : `照片 ${t.photos[0] && (t.photos[0].origName || t.photos[0].id)}`;
      return h(
        'tr',
        null,
        h('td', null, formatTime(t.deletedAt)),
        h('td', null, what),
        h('td', null, t.region || ''),
        h('td', null, days ? `${days} 天` : '已过期'),
        h(
          'td',
          null,
          h(
            'button',
            {
              class: 'btn btn-small',
              onclick: () =>
                withLock('恢复', async (album) => {
                  const target = A.restoreTrash(album, regions, t.id);
                  toast(`已恢复到 ${A.regionOfNode(album, target) || target}`);
                }),
            },
            '恢复'
          )
        )
      );
    });
  const expired = a.trash.filter((t) => now - t.deletedAt > A.TRASH_KEEP_MS).length;
  return section(
    '回收记录（删除的末级框与照片）',
    rows.length
      ? h('table', { class: 'admin-table' }, h('tr', null, ['删除时间', '内容', '所在区域', '剩余保留', ''].map((x) => h('th', null, x))), rows)
      : h('p', { class: 'muted' }, '没有回收记录'),
    h('p', { class: 'dialog-hint' }, '恢复时会放回原来的位置；原位置已不存在或已有子框时，放到所属区域下（照片会放进新建的“恢复的照片”框）。'),
    expired
      ? h(
          'button',
          {
            class: 'btn btn-small btn-danger',
            onclick: async () => {
              if (!(await confirmDialog(`清理 ${expired} 条超过 30 天的回收记录，并删除对应的照片文件？`, { danger: true }))) return;
              let gone = [];
              const ok = await withLock('清理过期回收记录', (album) => {
                gone = A.purgeTrash(album, store.now());
              });
              if (ok) for (const id of gone) await removeQuiet([photoKey(id), thumbKey(id)]);
            },
          },
          `清理 ${expired} 条过期记录`
        )
      : null
  );
}

async function removeQuiet(keys) {
  for (const k of keys) {
    try {
      await store.remove(k);
    } catch (e) {
      toast(`删除 ${k} 失败：${e.message}`, 'error');
    }
  }
}

async function scanFiles() {
  await reload();
  const a = current.album;
  const listed = [...(await store.list('photos/')), ...(await store.list('thumbs/'))];
  const have = new Map(listed.map((x) => [x.key, x]));
  const live = Object.keys(a.photos);
  const referenced = A.referencedPhotoIds(a);
  const missing = [];
  for (const id of live) for (const k of [photoKey(id), thumbKey(id)]) if (!have.has(k)) missing.push(k);
  const now = store.now();
  const orphans = listed.filter((x) => {
    const m = /^(?:photos|thumbs)\/(.+)\.jpg$/.exec(x.key);
    return m && !referenced.has(m[1]) && now - x.lastModified > ORPHAN_MIN_AGE;
  });
  fileReport = { missing, orphans, total: listed.length, at: now };
}

function filesSection() {
  const body = [];
  if (fileReport) {
    body.push(h('p', null, `检查时间 ${formatTime(fileReport.at)}，存储桶中共 ${fileReport.total} 个照片/缩略图文件。`));
    if (fileReport.missing.length) {
      body.push(h('p', { class: 'error-text' }, `相册引用但存储桶中缺失的文件 ${fileReport.missing.length} 个：`));
      body.push(h('ul', null, fileReport.missing.slice(0, 50).map((k) => h('li', null, k))));
      if (store.listVersions) {
        body.push(
          h(
            'button',
            {
              class: 'btn btn-small',
              onclick: async (e) => {
                e.currentTarget.disabled = true;
                let fixed = 0;
                for (const k of fileReport.missing) {
                  const vs = (await store.listVersions(k)).filter((v) => v.key === k && !v.deleteMarker).sort((x, y) => y.lastModified - x.lastModified);
                  if (vs.length) {
                    await store.restoreVersion(k, vs[0].versionId);
                    fixed++;
                  }
                }
                toast(`已从历史版本恢复 ${fixed} 个文件`);
                await scanFiles();
                render();
              },
            },
            '尝试从历史版本恢复缺失文件'
          )
        );
      }
    } else body.push(h('p', { class: 'ok-text' }, '相册引用的文件都存在'));
    if (fileReport.orphans.length) {
      body.push(h('p', null, `未被相册引用、且上传超过 1 天的孤立文件 ${fileReport.orphans.length} 个（多为上传中断遗留）。`));
      body.push(
        h(
          'button',
          {
            class: 'btn btn-small btn-danger',
            onclick: async () => {
              if (!(await confirmDialog(`删除 ${fileReport.orphans.length} 个孤立文件？（开启版本控制时 30 天内仍可从历史版本找回）`, { danger: true }))) return;
              await removeQuiet(fileReport.orphans.map((x) => x.key));
              await scanFiles();
              render();
            },
          },
          '删除孤立文件'
        )
      );
    } else body.push(h('p', { class: 'muted' }, '没有孤立文件'));
  }
  return section(
    '文件检查',
    h('p', { class: 'dialog-hint' }, '检查相册引用的原图、缩略图是否都在存储桶里，并找出没有被引用的孤立文件。'),
    ...body,
    h(
      'button',
      {
        class: 'btn btn-small',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await scanFiles();
          } catch (err) {
            toast(`检查失败：${err.message}`, 'error');
          }
          render();
        },
      },
      fileReport ? '重新检查' : '开始检查'
    )
  );
}

function versionsSection() {
  if (!store.listVersions) return section('album.json 历史版本', h('p', { class: 'muted' }, '演示模式不支持历史版本。'));
  const body = [];
  if (versions) {
    body.push(
      h(
        'table',
        { class: 'admin-table' },
        h('tr', null, ['保存时间', '大小', '', ''].map((x) => h('th', null, x))),
        versions.map((v) =>
          h(
            'tr',
            null,
            h('td', null, formatTime(v.lastModified), v.isLatest ? '（当前）' : ''),
            h('td', null, v.deleteMarker ? '删除标记' : `${Math.round(v.size / 1024)} KB`),
            h(
              'td',
              null,
              v.deleteMarker
                ? null
                : h(
                    'button',
                    {
                      class: 'btn btn-small',
                      onclick: async () => {
                        const data = A.normalizeAlbum(await store.getJSONVersion(ALBUM_KEY, v.versionId));
                        const problems = A.validateAlbum(data, regions);
                        await alertDialog(
                          `该版本：框 ${Object.keys(data.nodes).length} 个，照片 ${Object.keys(data.photos).length} 张，回收记录 ${data.trash.length} 条。` +
                            (problems.length ? `\n结构问题：\n${problems.join('\n')}` : '\n结构自检通过。'),
                          { title: '版本预览' }
                        );
                      },
                    },
                    '预览'
                  )
            ),
            h(
              'td',
              null,
              v.isLatest || v.deleteMarker
                ? null
                : h(
                    'button',
                    {
                      class: 'btn btn-small btn-danger',
                      onclick: async () => {
                        if (!(await confirmDialog(`把相册整体回退到 ${formatTime(v.lastModified)} 的版本？之后的所有修改都会被撤销（当前版本仍会作为历史版本保留 30 天）。`, { danger: true, okLabel: '回退' }))) return;
                        const old = A.normalizeAlbum(await store.getJSONVersion(ALBUM_KEY, v.versionId));
                        await withLock('回退版本', (album) => {
                          for (const k of Object.keys(album)) delete album[k];
                          Object.assign(album, old);
                        });
                        versions = null;
                        fileReport = null;
                        render();
                      },
                    },
                    '回退到此版本'
                  )
            )
          )
        )
      )
    );
    body.push(h('p', { class: 'dialog-hint' }, '回退后建议再做一次“文件检查”，确认引用的照片文件都存在。'));
  }
  return section(
    'album.json 历史版本（30 天内）',
    h('p', { class: 'dialog-hint' }, '优先使用上面的“回收记录”恢复单个内容；只有数据被整体改坏时才需要回退版本。'),
    ...body,
    h(
      'button',
      {
        class: 'btn btn-small',
        onclick: async () => {
          try {
            versions = (await store.listVersions(ALBUM_KEY)).filter((v) => v.key === ALBUM_KEY).sort((x, y) => y.lastModified - x.lastModified);
          } catch (e) {
            toast(`读取历史版本失败：${e.message}`, 'error');
          }
          render();
        },
      },
      versions ? '刷新列表' : '查看历史版本'
    )
  );
}

function presenceSection() {
  return section(
    '在线记录清理',
    h('p', { class: 'dialog-hint' }, '每台设备有一个很小的在线记录文件。可以删除超过 7 天没有更新的旧记录。'),
    h(
      'button',
      {
        class: 'btn btn-small',
        onclick: async () => {
          const items = await store.list(PRESENCE_PREFIX);
          const old = items.filter((x) => store.now() - x.lastModified > 7 * 86400000);
          await removeQuiet(old.map((x) => x.key));
          toast(`已清理 ${old.length} 条旧记录`);
        },
      },
      '清理旧在线记录'
    )
  );
}

let namesInfo = null; // 已上传的名称文件概况
let namesPreview = null; // { names, full, mapData, problems, version }

async function loadNamesInfo() {
  try {
    const [n, m, l2] = await Promise.all([store.getJSON(N.NAMES_KEY), store.getJSON(N.MAP_KEY), store.getJSON(N.L2_INDEX_KEY)]);
    namesInfo = { names: n && n.data, map: m && m.data, l2: l2 && l2.data };
  } catch (e) {
    namesInfo = { error: e.message };
  }
  render();
}

function readFile(input) {
  const f = input.files && input.files[0];
  return f ? f.text() : Promise.resolve(null);
}

/** 上传区域名称与地图：在本页解密映射文件，计算简称，清洗地图后上传到存储桶（名称不进入公开仓库） */
function namesSection() {
  if (!namesInfo) loadNamesInfo();
  const encInput = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '加密映射文件' });
  const pw = h('input', { class: 'input', type: 'password', placeholder: '映射文件密码', autocomplete: 'off' });
  const svgInput = h('input', { type: 'file', accept: '.svg,image/svg+xml', 'aria-label': '地图 SVG 文件' });
  const l2Input = h('input', { type: 'file', accept: '.svg,image/svg+xml', multiple: true, 'aria-label': '二级地图 SVG 文件' });
  const err = h('p', { class: 'error-text', role: 'status' });
  const status = [];
  if (namesInfo && namesInfo.error) status.push(h('p', { class: 'error-text' }, `读取失败：${namesInfo.error}`));
  else if (namesInfo) {
    const n = namesInfo.names;
    const m = namesInfo.map;
    status.push(
      h('p', null, n && n.names ? `已上传区域名称 ${Object.keys(n.names).length} 个（${formatTime(n.uploadedAt)}）` : '尚未上传区域名称，网页上显示区域编号。'),
      h('p', null, m && m.regions ? `已上传地图（${Object.keys(m.regions).length} 个一级区域，${formatTime(m.uploadedAt)}）` : '尚未上传地图，网页上的“地图”页暂时无法显示。'),
      h('p', null, namesInfo.l2 && namesInfo.l2.ids && namesInfo.l2.ids.length ? `已上传二级地图 ${namesInfo.l2.ids.length} 个省` : '尚未上传二级地图。')
    );
  }
  const preview = [];
  if (namesPreview) {
    const p = namesPreview;
    const l1 = regions.level1.map((id) => `${id} ${p.names[id]}`).join('、');
    const changed = Object.keys(p.names).filter((id) => /[省市州]$/.test(p.names[id]) && p.names[id] !== p.full[id]);
    preview.push(
      h('h3', null, '预览'),
      h('p', null, `区域名称 ${Object.keys(p.names).length} 个，全部不超过 ${N.MAX_NAME_LEN} 个字、没有重名。`),
      h('p', { class: 'dialog-hint' }, `一级区域：${l1}`),
      changed.length ? h('p', { class: 'dialog-hint' }, `为区分重名加了“省/市/州”：${changed.map((id) => `${id} ${p.names[id]}`).join('、')}`) : null,
      p.mapData ? h('p', null, `地图：${Object.keys(p.mapData.regions).length} 个一级区域已对应（九段线不显示）。`) : h('p', { class: 'muted' }, '未选择地图文件，本次只上传名称。'),
      p.l2.length
        ? h('p', null, `二级地图 ${p.l2.length} 个省：${p.l2.map((x) => `${p.names[x.l1Id]}（${Object.keys(x.data.regions).length} 个二级区域）`).join('、')}`)
        : null,
      p.problems.length ? h('ul', { class: 'error-text' }, p.problems.map((x) => h('li', null, x))) : null,
      h(
        'div',
        { class: 'row-gap' },
        h(
          'button',
          {
            class: 'btn btn-primary',
            disabled: p.problems.length > 0,
            onclick: async (e) => {
              e.currentTarget.disabled = true;
              try {
                const at = store.now();
                await store.putJSON(N.NAMES_KEY, { format: N.NAMES_FORMAT, version: p.version, names: p.names, uploadedAt: at });
                if (p.mapData) await store.putJSON(N.MAP_KEY, { ...p.mapData, uploadedAt: at });
                if (p.l2.length) {
                  for (const x of p.l2) await store.putJSON(N.l2Key(x.l1Id), { ...x.data, uploadedAt: at });
                  const old = await store.getJSON(N.L2_INDEX_KEY);
                  const ids = new Set((old && old.data && old.data.ids) || []);
                  for (const x of p.l2) ids.add(x.l1Id);
                  await store.putJSON(N.L2_INDEX_KEY, { ids: [...ids].sort(), uploadedAt: at });
                }
                namesPreview = null;
                toast('已上传，网页刷新后生效', 'ok');
                await loadNamesInfo();
              } catch (x) {
                toast(`上传失败：${x.message}`, 'error');
                render();
              }
            },
          },
          '上传到存储桶'
        ),
        h('button', { class: 'btn', onclick: () => ((namesPreview = null), render()) }, '放弃')
      )
    );
  }
  return section(
    '区域名称与地图',
    h('p', { class: 'dialog-hint' }, '选择加密映射文件（private/region-map.enc.json）并输入映射密码，在本页解密后计算简称；可同时选择地图文件（china-boundary.svg）。密码只在本页使用，不保存、不上传。'),
    ...status,
    h('label', { class: 'field-label' }, '加密映射文件 ', encInput),
    pw,
    h('label', { class: 'field-label' }, '地图 SVG（可选） ', svgInput),
    h('label', { class: 'field-label' }, '二级地图 SVG（可选，可多选，每省一个文件） ', l2Input),
    h(
      'button',
      {
        class: 'btn',
        onclick: async (e) => {
          const btn = e.currentTarget;
          err.textContent = '';
          btn.disabled = true;
          btn.textContent = '正在解密…';
          try {
            const encText = await readFile(encInput);
            if (!encText) throw new Error('请先选择加密映射文件');
            if (!pw.value) throw new Error('请输入映射密码');
            const enc = JSON.parse(encText);
            const map = await N.decryptRegionMap(enc, pw.value);
            pw.value = '';
            const problems = N.checkAgainstAnon(map, REGION_MAP_ANON);
            const { names, full, problems: nameProblems } = N.computeShortNames(map);
            problems.push(...nameProblems);
            let mapData = null;
            const svgText = await readFile(svgInput);
            if (svgText) {
              const r = N.parseChinaSvg(svgText, map, names);
              problems.push(...r.problems);
              mapData = r.data;
            }
            const l2 = [];
            for (const f of l2Input.files || []) {
              const r = N.parseLevel2Svg(await f.text(), map);
              problems.push(...r.problems.map((x) => `${f.name}：${x}`));
              if (!r.data) continue;
              if (l2.some((x) => x.l1Id === r.l1Id)) problems.push(`${f.name}：与另一个文件是同一个省`);
              l2.push(r);
            }
            namesPreview = { names, full, mapData, l2, problems, version: enc.version || null };
            render();
          } catch (x) {
            err.textContent = x instanceof SyntaxError ? '文件格式不正确' : x.message;
            btn.disabled = false;
            btn.textContent = '解密并预览';
          }
        },
      },
      '解密并预览'
    ),
    err,
    ...preview
  );
}

function render() {
  clear(root);
  if (!store || !current) return root.appendChild(connectView());
  root.appendChild(h('div', { class: 'admin-head' }, h('h1', null, '相册维护工具'), h('a', { href: demo ? '../?demo=1' : '../' }, '返回相册')));
  root.appendChild(overview());
  root.appendChild(namesSection());
  root.appendChild(trashSection());
  root.appendChild(filesSection());
  root.appendChild(versionsSection());
  root.appendChild(presenceSection());
}

render();
