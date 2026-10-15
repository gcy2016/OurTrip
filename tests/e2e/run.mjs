// 端到端测试（演示模式，不连接真实 COS）。
// 用法：node tests/e2e/run.mjs   （需要本机可用的 Playwright + Chromium；可用 PLAYWRIGHT_MODULE 指定模块路径）
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIX = join(ROOT, 'tests/e2e/fixtures');
const SHOTS = process.env.SHOTS_DIR || join(ROOT, 'tests/e2e/screenshots');

function loadPlaywright() {
  for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) {
    try {
      return require(m);
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error('找不到 Playwright，请先 npm i -D playwright 或设置 PLAYWRIGHT_MODULE');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
function serve() {
  const server = http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

const results = [];
const openPages = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['✔', name]);
    console.log(`✔ ${name}`);
  } catch (e) {
    results.push(['✘', name, e.message]);
    for (const [i, pg] of openPages.entries()) await pg.screenshot({ path: join(SHOTS, `fail-${i}.png`) }).catch(() => {});
    console.log(`✘ ${name}\n   ${e.stack || e.message}`);
    throw e;
  }
}

const { chromium } = loadPlaywright();
const server = await serve();
const BASE = `http://localhost:${server.address().port}/?demo=1&tab=1`;
await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 850 },
  permissions: ['geolocation'],
  geolocation: { latitude: 31.2304, longitude: 121.4737 },
});
// 注入测试用的腾讯位置服务 Key，并拦截逆地理编码请求（不访问真实服务）
const geoRequests = [];
await ctx.route('**/js/config.js', async (route) => {
  const res = await route.fetch();
  const body = (await res.text()).replace(/tencentMapKey: '[^']*'/, "tencentMapKey: 'TESTKEY'");
  await route.fulfill({ response: res, body });
});
await ctx.route('https://apis.map.qq.com/**', async (route) => {
  const url = new URL(route.request().url());
  geoRequests.push({ location: url.searchParams.get('location'), referer: route.request().headers().referer || '' });
  const payload = { status: 0, result: { address: '上海市黄浦区人民大道', formatted_addresses: { recommend: '人民广场附近' } } };
  await route.fulfill({ contentType: 'application/javascript', body: `${url.searchParams.get('callback')}(${JSON.stringify(payload)})` });
});
const errors = [];

async function openPage() {
  const p = await ctx.newPage();
  openPages.push(p);
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(BASE);
  return p;
}

async function login(p, { remember = false } = {}) {
  await p.fill('input[type=password]', 'demo1234');
  if (remember) await p.check('#remember');
  await p.click('button[type=submit]');
  await p.waitForSelector('.topbar, .card h1:text("在线人数已满")');
}

const album = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__app.sync.album)));
const nodeByTitle = async (p, t) => Object.values((await album(p)).nodes).find((n) => n.title === t);
const settle = (p) => p.evaluate(() => window.__app.sync.flush());

async function newBox(p, title, type) {
  await p.click('.toolbar button:has-text("新建")');
  if (type) await p.click(`.chip:text-is("${type}")`);
  await p.fill('.dialog input.input', title);
  await p.click('.dialog button:text-is("新建")');
  await p.waitForSelector(`.tile-title:text-is("${title}")`);
}

async function tileMenu(p, title, item) {
  await p.click(`.tile:has(.tile-title:text-is("${title}")) .tile-menu`);
  await p.click(`.sheet-item:has-text("${item}")`);
}

try {
  const A = await openPage();

  await step('登录：错误密码提示“密码不正确，请重试”，“记住此设备”默认不勾选', async () => {
    assert.equal(await A.isChecked('#remember'), false);
    await A.fill('input[type=password]', 'nope');
    await A.click('button[type=submit]');
    await A.waitForFunction(() => document.querySelector('.error-text').textContent.length > 0);
    assert.equal(await A.textContent('.error-text'), '密码不正确，请重试');
    assert.equal(await A.textContent('button[type=submit]'), '进入');
    await login(A);
  });

  await step('首页 34 个一级区域；有二级区域的进入二级列表，没有的直接进入内容', async () => {
    assert.equal(await A.locator('.grid .tile').count(), 34);
    await A.click('.tile-title:text-is("A03")');
    await A.waitForSelector('.page-head h1:text-is("A03")');
    assert.equal(await A.locator('.grid .tile').count(), 11);
    await A.goto(`${BASE}#/r/A01`);
    await A.waitForSelector('.page-head h1:text-is("A01")');
    assert.equal(await A.locator('.grid .tile').count(), 0);
    assert.ok(await A.isVisible('text=这里还没有内容'));
    await A.screenshot({ path: join(SHOTS, 'region-empty.png') });
  });

  await step('只读状态下不能修改；开始编辑后可新建框', async () => {
    await A.goto(`${BASE}#/r/A03-C01`);
    await A.waitForSelector('.page-head h1:text-is("A03-C01")');
    assert.equal(await A.locator('.toolbar').count(), 0);
    await A.click('button:text-is("开始编辑")');
    await A.waitForSelector('.chip-status.editing');
    await newBox(A, '2024 五一');
    await newBox(A, '相册', '相册');
    await newBox(A, '美食', '美食');
    assert.ok(await settle(A));
  });

  await step('上传：多选批量上传、视频被拒绝、读取 EXIF、压缩至 2560/400', async () => {
    await A.click('.tile-title:text-is("相册")');
    await A.waitForSelector('.page-head h1:has-text("相册")');
    await A.setInputFiles('#file-input', ['with-exif.jpg', 'no-exif.jpg', 'square.png', 'clip.mp4'].map((f) => join(FIX, f)));
    await A.waitForFunction(() => {
      const s = document.querySelector('.up-summary');
      return s && /完成 3，失败 1/.test(s.textContent);
    }, null, { timeout: 30000 });
    assert.ok(await A.isVisible('.up-failed:has-text("首版不支持视频")'));
    assert.equal(await A.locator('.up-failed button:text("重试")').count(), 0);
    await A.screenshot({ path: join(SHOTS, 'upload.png') });
    await A.click('.dialog button:text-is("关闭")');
    const a = await album(A);
    const photos = Object.values(a.photos);
    assert.equal(photos.length, 3);
    const ex = photos.find((p) => p.origName === 'with-exif.jpg');
    assert.equal(ex.exif.takenAt, '2024-05-01 10:20:30');
    assert.ok(Math.abs(ex.exif.lat - 31.23) < 0.001 && Math.abs(ex.exif.lng - 121.47) < 0.001);
    assert.equal(ex.exif.device, 'TestMaker TestCam 1');
    assert.equal(ex.width, 2560);
    assert.equal(ex.height, 1920);
    assert.equal(photos.find((p) => p.origName === 'no-exif.jpg').exif, null);
    const thumb = await A.evaluate(async (id) => {
      const url = await window.__app.store.urlFor(`thumbs/${id}.jpg`);
      const img = new Image();
      img.src = url;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }, ex.id);
    assert.deepEqual(thumb, [400, 300]);
    assert.ok(await settle(A));
  });

  await step('点亮：上传后二级区域及其一级区域自动点亮', async () => {
    const lit = await A.evaluate(() => [...window.__app.lit]);
    assert.deepEqual(lit.sort(), ['A03', 'A03-C01']);
  });

  await step('大图、查看属性（有/无 EXIF）、编辑说明、设为封面', async () => {
    const a = await album(A);
    const node = Object.values(a.nodes).find((n) => n.title === '相册');
    const idxExif = node.photos.indexOf(Object.values(a.photos).find((p) => p.origName === 'with-exif.jpg').id);
    await A.locator('.photo').nth(idxExif).click();
    await A.waitForSelector('.viewer');
    await A.click('.viewer button[aria-label="照片操作"]');
    await A.click('.sheet-item:has-text("查看属性")');
    const text = await A.textContent('.attrs');
    assert.match(text, /2024-05-01 10:20:30/);
    assert.match(text, /31\.23/);
    await A.screenshot({ path: join(SHOTS, 'attributes.png') });
    await A.click('.dialog button:text-is("关闭")');
    await A.click('.viewer button[aria-label="照片操作"]');
    await A.click('.sheet-item:has-text("编辑说明")');
    await A.fill('.dialog textarea', '第一天的早餐');
    await A.click('.dialog button:text-is("保存")');
    await A.waitForSelector('.viewer-caption:text("第一天的早餐")');
    await A.click('.viewer button[aria-label="照片操作"]');
    await A.click('.sheet-item:has-text("设为封面")');
    await A.click('.sheet-item:has-text("二级区域：A03-C01")');
    await A.click('.viewer button[aria-label="照片操作"]');
    await A.click('.sheet-item:has-text("设为封面")');
    await A.click('.sheet-item:has-text("所在框：相册")');
    // 无 EXIF 的照片
    const idxNo = node.photos.indexOf(Object.values(a.photos).find((p) => p.origName === 'no-exif.jpg').id);
    await A.click('.viewer button[aria-label="关闭"]');
    await A.locator('.photo').nth(idxNo).click();
    await A.click('.viewer button[aria-label="照片操作"]');
    await A.click('.sheet-item:has-text("查看属性")');
    const t2 = await A.textContent('.attrs');
    assert.match(t2, /拍摄时间无可用信息/);
    assert.match(t2, /拍摄地点（GPS）无可用信息/);
    await A.click('.dialog button:text-is("关闭")');
    await A.click('.viewer button[aria-label="关闭"]');
    const b = await album(A);
    assert.ok(b.regionCovers['A03-C01']);
    assert.ok(Object.values(b.nodes).find((n) => n.title === "相册").cover);
  });

  await step('有内容的末级框不能直接加子框，提示先合并', async () => {
    await A.click('.toolbar button:has-text("新建子框")');
    await A.waitForSelector('.dialog');
    assert.match(await A.textContent('.dialog'), /已经有内容.*合并/);
    await A.click('.dialog button:text-is("知道了")');
  });

  await step('备注与地点（手动地址）都算内容；地图链接与复制', async () => {
    await A.goto(`${BASE}#/r/A03-C01`);
    await A.click('.tile-title:text-is("美食")');
    await A.waitForSelector('.page-head h1:has-text("美食")');
    await A.click('.section-head:has(h2:text("备注")) button');
    await A.fill('.dialog textarea', '一家很好吃的面馆');
    await A.click('.dialog button:text-is("保存")');
    await A.click('.section-head:has(h2:text("地点")) button');
    await A.fill('.loc-form textarea', '某某路 88 号');
    await A.click('.dialog button:text-is("保存")');
    await A.waitForSelector('.map-links a:text("在 Apple 地图中打开")');
    assert.equal(await A.locator('.map-links a').count(), 1);
    assert.equal(await A.getAttribute('.map-links a', 'target'), '_blank');
    assert.ok(await settle(A));
  });

  await step('定位后自动转成中文地址；Apple 地图链接用换算后的坐标；可删除地点', async () => {
    await A.click('.section-head:has(h2:text("地点")) button');
    await A.click('.dialog button:text-is("获取当前位置")');
    await A.waitForFunction(() => document.querySelector('.loc-form textarea').value.includes('人民大道'), null, { timeout: 15000 });
    assert.equal(await A.inputValue('.loc-form textarea'), '上海市黄浦区人民大道（人民广场附近）');
    assert.match(geoRequests[0].location, /^31\.228\d+,121\.478\d+$/); // 已换算为 GCJ-02
    assert.match(geoRequests[0].referer, /^http:\/\/localhost:\d+\/$/); // 发送来源域名，供域名白名单校验
    assert.ok(await A.isVisible('.dialog button:text-is("按坐标填写地址")'));
    await A.click('.dialog button:text-is("保存")');
    await A.waitForSelector('.location .note:text("人民大道")');
    assert.match(await A.getAttribute('.map-links a', 'href'), /^https:\/\/maps\.apple\.com\/\?ll=31\.228\d+,121\.478\d+&q=/);
    await A.screenshot({ path: join(SHOTS, 'leaf-content.png') });
    await A.click('.section-head:has(h2:text("地点")) button');
    await A.click('.dialog button:text-is("删除地点")');
    await A.click('.overlay:last-child .dialog button:text-is("删除")');
    await A.waitForSelector('text=暂无地点');
    // 重新手动填写地址，供后续步骤使用
    await A.click('.section-head:has(h2:text("地点")) button');
    await A.fill('.loc-form textarea', '某某路 88 号');
    await A.click('.dialog button:text-is("保存")');
    await A.waitForSelector('.location .note:text("某某路 88 号")');
    assert.ok(await settle(A));
  });

  await step('相册框：名称固定为“相册”、只能放照片、不能加子框', async () => {
    await A.goto(`${BASE}#/r/A07-C01`);
    await A.waitForSelector('.page-head h1:text-is("A07-C01")');
    await A.click('.toolbar button:has-text("新建框")');
    await A.click('.seg:text("相册框")');
    assert.equal(await A.isVisible('.dialog input.input'), false);
    await A.click('.dialog button:text-is("新建")');
    await A.waitForSelector('.tile:has(.tile-badge:text("相册框"))');
    await tileMenu(A, '相册', '重命名').catch(() => {});
    assert.ok(await A.isDisabled('.sheet-item:has-text("重命名")'));
    await A.click('.sheet-item:text("取消")');
    await A.click('.tile-title:text-is("相册")');
    await A.waitForSelector('.page-head h1:has-text("相册")');
    assert.equal(await A.locator('.toolbar').count(), 0);
    assert.equal(await A.locator('.section-head h2:text("备注")').count(), 0);
    assert.equal(await A.locator('.section-head h2:text("地点")').count(), 0);
    await A.setInputFiles('#file-input', [join(FIX, 'square.png')]);
    await A.waitForFunction(() => /完成 1，失败 0/.test(document.querySelector('.up-summary').textContent), null, { timeout: 20000 });
    await A.click('.dialog button:text-is("关闭")');
    await A.waitForSelector('.photo img[src]');
    const lit = await A.evaluate(() => [...window.__app.lit]);
    assert.ok(lit.includes('A07-C01'));
    assert.ok(await settle(A));
  });

  await step('相册框多选：批量下载（打包 zip）与批量删除', async () => {
    await A.setInputFiles('#file-input', [join(FIX, 'no-exif.jpg'), join(FIX, 'with-exif.jpg')]);
    await A.waitForFunction(() => /完成 2，失败 0/.test(document.querySelector('.up-summary').textContent), null, { timeout: 20000 });
    await A.click('.dialog button:text-is("关闭")');
    await A.waitForFunction(() => document.querySelectorAll('.photo img[src]').length === 3);
    await A.click('.section-head button:text-is("多选")');
    await A.click('.section-head button:text-is("全选")');
    await A.waitForSelector('.section-head h2:text("已选 3 张")');
    await A.screenshot({ path: join(SHOTS, 'album-select.png') });
    await A.click('.section-head button:has-text("下载")');
    await A.waitForSelector('.dialog:has-text("已准备好 3 张照片")');
    const [dl] = await Promise.all([A.waitForEvent('download'), A.click('.dialog button:text-is("下载压缩包")')]);
    const zipPath = join(SHOTS, 'download.zip');
    await dl.saveAs(zipPath);
    const { execFileSync } = await import('node:child_process');
    const names = execFileSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("|".join(sorted(z.namelist())))', zipPath]).toString().trim();
    assert.equal(names, 'no-exif.jpg|square.jpg|with-exif.jpg');
    await A.click('.section-head button:text-is("全不选")');
    await A.click('.photo.selectable >> nth=0');
    await A.click('.section-head button:has-text("删除")');
    await A.click('.overlay:last-child .dialog button:text-is("删除")');
    await A.waitForFunction(() => document.querySelectorAll('.photo').length === 2);
    assert.equal(await A.locator('.section-head button:text-is("多选")').count(), 1);
    await A.screenshot({ path: join(SHOTS, 'album-box.png') });
    assert.ok(await settle(A));
  });

  await step('合并：两个框收进新父框，原框成为子框且内容保留', async () => {
    await A.goto(`${BASE}#/r/A03-C01`);
    await A.click('button:text("选择 / 合并")');
    await A.click('.tile:has(.tile-title:text-is("相册"))');
    await A.click('.tile:has(.tile-title:text-is("美食"))');
    await A.click('button:text("合并为一个框")');
    await A.fill('.dialog input', '第一次');
    await A.click('.dialog button:text-is("合并")');
    await A.waitForSelector('.tile-title:text-is("第一次")');
    const a = await album(A);
    const parent = Object.values(a.nodes).find((n) => n.title === '第一次');
    const kids = Object.values(a.nodes).filter((n) => n.parent === parent.id).sort((x, y) => x.order - y.order).map((n) => n.title);
    assert.deepEqual(kids, ['相册', '美食']);
    assert.equal(Object.values(a.nodes).find((n) => n.title === '相册').photos.length, 3);
  });

  await step('复制为模板并跨区域粘贴：只有框架，没有内容，不点亮', async () => {
    await tileMenu(A, '第一次', '复制为模板');
    await A.goto(`${BASE}#/r/A05-C01`);
    await A.click('.page-head');
    await A.click('button:text-is("开始编辑")').catch(() => {});
    await A.click('button:has-text("粘贴模板")');
    await A.waitForSelector('.tile-title:text-is("第一次")');
    await A.click('.tile-title:text-is("第一次")');
    await A.waitForSelector('.tile-title:text-is("相册")');
    const a = await album(A);
    const pasted = Object.values(a.nodes).filter((n) => n.title === '相册' && n.photos.length === 0);
    assert.equal(pasted.length, 1);
    const lit = await A.evaluate(() => [...window.__app.lit]);
    assert.ok(!lit.includes('A05-C01'));
  });

  await step('移动：把框从 A05-C01 移到无二级区域的 A22', async () => {
    await A.goto(`${BASE}#/r/A05-C01`);
    await tileMenu(A, '第一次', '移动到');
    await A.click('.picker-crumbs button:text("全部区域")');
    await A.click('.picker-row:text-is("A22")');
    await A.click('.dialog button:text-is("移到这里")');
    await A.goto(`${BASE}#/r/A22`);
    await A.waitForSelector('.tile-title:text-is("第一次")');
  });

  await step('删除父框：子框提升一级，内容保留；删除末级框：内容进入回收记录', async () => {
    await A.goto(`${BASE}#/r/A03-C01`);
    await tileMenu(A, '第一次', '删除');
    assert.match(await A.textContent('.dialog'), /2 个子框会提升/);
    await A.click('.dialog button:text-is("删除")');
    await A.waitForSelector('.tile-title:text-is("相册")');
    const titles = await A.locator('.grid .tile-title').allTextContents();
    assert.deepEqual(titles, ['2024 五一', '相册', '美食']);
    await tileMenu(A, '美食', '删除');
    assert.match(await A.textContent('.dialog'), /文字备注、地点会一起删除/);
    await A.click('.dialog button:text-is("删除")');
    await A.waitForFunction(() => ![...document.querySelectorAll('.tile-title')].some((e) => e.textContent === '美食'));
    assert.ok(await settle(A));
    const a = await album(A);
    const boxes = a.trash.filter((t) => t.kind === 'box');
    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].node.note, '一家很好吃的面馆');
  });

  await step('删除需要确认；取消则不删除', async () => {
    await tileMenu(A, '2024 五一', '删除');
    await A.click('.dialog button:text-is("取消")');
    assert.ok(await nodeByTitle(A, '2024 五一'));
  });

  await step('保存失败会明确提示，可重试成功', async () => {
    await A.evaluate(() => (globalThis.__demoFailWrites = 1));
    await tileMenu(A, '2024 五一', '重命名');
    await A.fill('.dialog input', '2024 五一假期');
    await A.click('.dialog button:text-is("保存")');
    await A.waitForSelector('.banner-error:has-text("保存失败")');
    await A.screenshot({ path: join(SHOTS, 'save-failed.png') });
    await A.click('.banner-error button:text("重试")');
    await A.waitForSelector('.chip-status.ok:text("已保存")');
  });

  await step('上传失败可单独重试', async () => {
    await A.click('.tile-title:text-is("相册")');
    await A.waitForSelector('#file-input', { state: 'attached' });
    await A.evaluate(() => (globalThis.__demoFailWrites = 1));
    await A.setInputFiles('#file-input', [join(FIX, 'no-exif.jpg')]);
    await A.waitForSelector('.up-failed:has-text("模拟网络错误")', { timeout: 20000 });
    await A.click('.up-failed button:text("重试")');
    await A.waitForFunction(() => /完成 1，失败 0/.test(document.querySelector('.up-summary').textContent), null, { timeout: 20000 });
    await A.click('.dialog button:text-is("关闭")');
    assert.equal((await nodeByTitle(A, '相册')).photos.length, 4);
  });

  const B = await openPage();
  await step('第二位使用者：可进入，只能查看，抢不到编辑权', async () => {
    await login(B);
    await B.goto(`${BASE}#/r/A03-C01`);
    await B.waitForSelector('.chip-status.other');
    assert.match(await B.textContent('.banner'), /正在编辑，你当前只能查看/);
    assert.equal(await B.locator('.toolbar').count(), 0);
    assert.equal(await B.locator('.tile-menu').count(), 0);
    await B.click('button:text-is("开始编辑")');
    await B.waitForSelector('.dialog:has-text("编辑权已被占用")');
    await B.click('.dialog button:text-is("知道了")');
    await B.screenshot({ path: join(SHOTS, 'readonly.png') });
  });

  await step('第三位使用者被拒绝进入', async () => {
    const C = await openPage();
    await login(C);
    await C.waitForSelector('text=已达到在线人数上限');
    await C.screenshot({ path: join(SHOTS, 'full.png') });
    await C.close();
  });

  await step('编辑权释放后另一位可取得；查看方能看到最新内容', async () => {
    await A.click('button:text-is("结束编辑")');
    await A.waitForSelector('button:text-is("开始编辑")');
    await B.click('button:text-is("☰")').catch(() => B.click('button[aria-label="菜单"]'));
    await B.click('.sheet-item:has-text("刷新数据")');
    await B.waitForSelector('.tile-title:text-is("2024 五一假期")');
    await B.click('button:text-is("开始编辑")');
    await B.waitForSelector('.chip-status.editing');
  });

  await step('版本比对：云端被改动后不覆盖，提示重新载入', async () => {
    // 模拟“锁失效期间另一台设备写入”的极端情况
    await B.evaluate(async () => {
      const s = window.__app.store;
      const cur = await s.getJSON('album.json');
      cur.data.nodes = { ...cur.data.nodes };
      await s.putJSON('album.json', cur.data);
    });
    await tileMenu(B, '相册', '重命名');
    await B.fill('.dialog input', '相册2');
    await B.click('.dialog button:text-is("保存")');
    await B.waitForSelector('.banner-error:has-text("云端数据已被另一台设备修改")');
    await B.click('.banner-error button:text("重新载入")');
    await B.waitForSelector('.tile-title:text-is("相册")');
  });

  await step('同一标签页刷新不用重输密码；新开页面需要密码；“记住此设备”后新页面也自动进入；退出后清除', async () => {
    await B.click('button:text-is("结束编辑")');
    await B.waitForSelector('button:text-is("开始编辑")');
    await B.reload();
    await B.waitForSelector('.topbar');
    const N1 = await openPage();
    await N1.waitForSelector('input[type=password]');
    await N1.close();
    await B.click('button[aria-label="菜单"]');
    await B.click('.sheet-item:has-text("退出并清除本设备")');
    await B.waitForSelector('input[type=password]');
    await B.reload();
    await B.waitForSelector('input[type=password]');
    await login(B, { remember: true });
    const N2 = await openPage();
    // 已记住设备：不再要求输入密码（A、B 已在线，第三个页面会显示“在线人数已满”，同样说明已自动解锁）
    await N2.waitForSelector('.topbar, .card h1:text("在线人数已满")');
    assert.equal(await N2.locator('input[type=password]').count(), 0);
    await N2.close();
    await B.click('button[aria-label="菜单"]');
    await B.click('.sheet-item:has-text("退出并清除本设备")');
    await B.waitForSelector('input[type=password]');
    await B.reload();
    await B.waitForSelector('input[type=password]');
  });

  await step('手机尺寸页面检查（375×812）', async () => {
    // 演示数据保存在本浏览器的 IndexedDB 中，这里复用同一个浏览器上下文，只调整窗口尺寸
    const P = A;
    await P.setViewportSize({ width: 375, height: 812 });
    await P.goto(BASE);
    await P.waitForSelector('.grid .tile');
    await P.screenshot({ path: join(SHOTS, 'm-home.png') });
    const widths = await P.$$eval('.grid .tile', (els) => els.slice(0, 3).map((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().top)]));
    assert.equal(widths[0][1], widths[1][1]); // 一行两个
    assert.notEqual(widths[1][1], widths[2][1]);
    assert.ok(widths[0][0] > 150 && widths[0][0] < 180, `tile width ${widths[0][0]}`);
    const inputFont = await P.evaluate(() => {
      const i = document.createElement('input');
      i.className = 'input';
      document.body.appendChild(i);
      const f = getComputedStyle(i).fontSize;
      i.remove();
      return f;
    });
    assert.equal(inputFont, '16px');
    const overflow = await P.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    await P.goto(`${BASE}#/r/A03`);
    await P.waitForSelector('.page-head h1:text-is("A03")');
    await P.screenshot({ path: join(SHOTS, 'm-level1.png') });
    await P.goto(`${BASE}#/r/A03-C01`);
    await P.waitForSelector('.tile-title:text-is("相册")');
    await P.screenshot({ path: join(SHOTS, 'm-region.png') });
    await P.click('.tile-title:text-is("相册")');
    await P.waitForSelector('.photo img[src]');
    await P.screenshot({ path: join(SHOTS, 'm-album.png') });
    await P.locator('.photo').first().click();
    await P.waitForSelector('.viewer-img[src]');
    await P.waitForTimeout(300);
    await P.screenshot({ path: join(SHOTS, 'm-viewer.png') });
    await P.click('.viewer button[aria-label="关闭"]');
    await P.click('button:text-is("开始编辑")');
    await P.waitForSelector('.chip-status.editing');
    assert.equal(await P.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await P.screenshot({ path: join(SHOTS, 'm-album-edit.png') });
    await P.click('button:text-is("结束编辑")');
    await P.setViewportSize({ width: 1100, height: 850 });
  });

  await step('维护工具（演示）：回收记录恢复被删除的末级框，文件检查无缺失', async () => {
    const M = await ctx.newPage();
    openPages.push(M);
    M.on('pageerror', (e) => errors.push(e.message));
    await M.goto(BASE.replace('/?', '/tools/admin.html?'));
    await M.click('button:text-is("连接")');
    await M.waitForSelector('text=回收记录（删除的末级框与照片）');
    assert.match(await M.textContent('.admin-table'), /框“美食”/);
    await M.click('.admin-table button:text-is("恢复")');
    await M.waitForFunction(() => !document.querySelector('.admin-table') || !document.querySelector('.admin-table').textContent.includes('框“美食”'));
    await M.click('button:text-is("开始检查")');
    await M.waitForSelector('text=相册引用的文件都存在');
    await M.screenshot({ path: join(SHOTS, 'admin.png'), fullPage: true });
    await M.close();
    await A.click('button[aria-label="菜单"]');
    await A.click('.sheet-item:has-text("刷新数据")');
    await A.waitForSelector('.toast:has-text("已刷新")');
    const a = await album(A);
    const food = Object.values(a.nodes).find((n) => n.title === '美食' && n.parent === 'A03-C01');
    assert.equal(food.note, '一家很好吃的面馆');
    assert.equal(food.location.address, '某某路 88 号');
  });

  await step('密钥加密工具：生成的密文可被相册用同一密码解开', async () => {
    const E = await ctx.newPage();
    openPages.push(E);
    E.on('pageerror', (e) => errors.push(e.message));
    await E.goto(BASE.replace(/\/\?.*$/, '/tools/encrypt.html'));
    await E.fill('#sid', 'AKIDexample123');
    await E.fill('#skey', 'secretkey456');
    await E.fill('#pw1', 'Travel2024abcd');
    await E.fill('#pw2', 'Travel2024abcd');
    await E.click('#go');
    await E.waitForSelector('#result:not([hidden])', { timeout: 20000 });
    const blob = JSON.parse(await E.inputValue('#out'));
    assert.equal(blob.iter, 600000);
    assert.ok(!JSON.stringify(blob).includes('secretkey456'));
    E.once('dialog', (d) => d.accept('Travel2024abcd'));
    await E.click('#verify');
    await E.waitForSelector('#vmsg:has-text("验证通过")', { timeout: 20000 });
    const secret = await E.evaluate(async (b) => {
      const m = await import('/js/crypto.js');
      return (await m.decryptSecret(b, 'Travel2024abcd')).secret;
    }, blob);
    assert.deepEqual(secret, { secretId: 'AKIDexample123', secretKey: 'secretkey456' });
    await E.close();
  });

  await step('照片很多时分批显示（每次 60 张）', async () => {
    await A.click('button:text-is("开始编辑")');
    await A.waitForSelector('.chip-status.editing');
    await A.evaluate(async () => {
      const app = window.__app;
      const box = Object.values(app.sync.album.nodes).find((n) => n.kind === 'album');
      const recs = Array.from({ length: 70 }, (_, i) => ({ id: `fake${i}`, width: 10, height: 10, uploadedAt: i }));
      const m = await import('/js/album.js');
      app.mutate((a) => m.addPhotos(a, box.id, recs));
      location.hash = `#/b/${box.id}`;
    });
    await A.waitForSelector('.more-btn');
    assert.equal(await A.locator('.photo').count(), 60);
    await A.click('.more-btn');
    await A.waitForFunction(() => document.querySelectorAll('.photo').length === 72);
    assert.equal(await A.locator('.more-btn').count(), 0);
    assert.ok(await settle(A));
    await A.click('button:text-is("结束编辑")');
  });

  await step('数据自检无问题；页面无脚本错误', async () => {
    const problems = await A.evaluate(async () => {
      const mod = await import('/js/album.js');
      return mod.validateAlbum(window.__app.sync.album, window.__app.regions);
    });
    assert.deepEqual(problems, []);
    await A.evaluate(() => (location.hash = '#/'));
    await A.waitForSelector('.grid .tile');
    await A.screenshot({ path: join(SHOTS, 'home-lit.png') });
    assert.deepEqual(errors, []);
  });
} catch {
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  const failed = results.filter((r) => r[0] === '✘').length;
  console.log(`\n${results.length - failed} 项通过，${failed} 项失败`);
}
