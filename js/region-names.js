// 区域真实名称与地图（方案 B）：名称不进公开仓库，由维护工具在浏览器里解密映射文件后，
// 计算简称并上传到私有存储桶 meta/region-names.json；地图 SVG 经清洗后上传为 meta/china-map.json。
// 本文件只含通用规则（纯函数，浏览器与 Node 均可用），不含任何区域编号与名称的对应关系。

export const NAMES_KEY = 'meta/region-names.json';
export const MAP_KEY = 'meta/china-map.json';
export const NAMES_FORMAT = 'ourtrip-region-names-v1';
export const MAP_FORMAT = 'ourtrip-china-map-v1';
export const MAX_NAME_LEN = 4;

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function inflate(bytes) {
  // 'deflate' 即 zlib 格式（带 2 字节头和 Adler-32 校验）
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 解密映射文件（private/region-map.enc.json 的内容）；密码错误时抛出“密码不正确” */
export async function decryptRegionMap(enc, password) {
  if (!enc || enc.cipher !== 'AES-256-GCM' || enc.kdf !== 'PBKDF2-HMAC-SHA256' || !enc.ciphertext_b64) {
    throw new Error('不是有效的加密映射文件');
  }
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(enc.salt_b64), iterations: Number(enc.iterations) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  let plain;
  try {
    plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: b64(enc.nonce_b64), additionalData: enc.aad ? new TextEncoder().encode(enc.aad) : undefined, tagLength: 128 },
      key,
      b64(enc.ciphertext_b64)
    );
  } catch {
    throw new Error('映射密码不正确，或文件已损坏');
  }
  const json = new TextDecoder().decode(await inflate(new Uint8Array(plain)));
  return JSON.parse(json);
}

/** 解密出的映射与公开的匿名映射（编号与层级）必须完全一致 */
export function checkAgainstAnon(map, anon) {
  const problems = [];
  const a = (anon && anon.level1) || [];
  const m = (map && map.level1) || [];
  if (a.length !== m.length) problems.push(`一级区域数量不一致：映射 ${m.length} 个，网页 ${a.length} 个`);
  a.forEach((x, i) => {
    const y = m[i];
    if (!y || y.id !== x.id) return problems.push(`第 ${i + 1} 个一级区域编号不一致：${y && y.id} / ${x.id}`);
    const kids = (y.children || []).map((c) => c.id);
    if (kids.join() !== x.children.join()) problems.push(`${x.id} 的二级区域与网页不一致`);
    if (!y.name) problems.push(`${x.id} 缺少名称`);
    for (const c of y.children || []) if (!c.name) problems.push(`${c.id} 缺少名称`);
  });
  return problems;
}

// 行政区划通名（按长度优先匹配）
const SUFFIXES = ['特别行政区', '自治区', '自治州', '地区', '盟', '省', '市'];
// 民族名：多字民族名在正式名称中可能不带“族”；单字/易混的民族名只在带“族”时去掉
const ETHNIC_BARE = ['柯尔克孜', '维吾尔', '哈萨克', '蒙古'];
const ETHNIC = [
  '蒙古', '回', '藏', '维吾尔', '苗', '彝', '壮', '布依', '朝鲜', '满', '侗', '瑶', '白', '土家', '哈尼', '哈萨克', '傣', '黎', '傈僳',
  '佤', '畲', '高山', '拉祜', '水', '东乡', '纳西', '景颇', '柯尔克孜', '土', '达斡尔', '仫佬', '羌', '布朗', '撒拉', '毛南', '仡佬',
  '锡伯', '阿昌', '普米', '塔吉克', '怒', '乌孜别克', '俄罗斯', '鄂温克', '德昂', '保安', '裕固', '京', '塔塔尔', '独龙', '鄂伦春',
  '赫哲', '门巴', '珞巴', '基诺',
];
// 去掉通名后会产生歧义的个别名称，保留原名
const KEEP_FULL = ['兴安盟'];

/** 单个名称的简称：去掉通名与民族名，去掉后至少保留两个字 */
export function baseShortName(full) {
  const name = String(full || '').trim();
  if (KEEP_FULL.includes(name)) return name;
  let s = name;
  for (const suf of SUFFIXES) {
    if (s.endsWith(suf) && s.length - suf.length >= 2) {
      s = s.slice(0, -suf.length);
      break;
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    const words = [...ETHNIC.map((e) => `${e}族`), ...ETHNIC_BARE].sort((x, y) => y.length - x.length);
    for (const w of words) {
      if (s.endsWith(w) && s.length - w.length >= 2) {
        s = s.slice(0, -w.length);
        changed = true;
        break;
      }
    }
  }
  return s;
}

/**
 * 计算全部区域的显示名称：{ names: {id: 简称}, full: {id: 全称}, problems: [] }。
 * 简称重名时加回通名区分：一级区域加“省”，自治州加“州”，其余二级区域加“市”（如 吉林省 / 吉林市、海南省 / 海南州）。
 */
export function computeShortNames(map) {
  const items = [];
  for (const l1 of map.level1) {
    items.push({ id: l1.id, level: 1, full: l1.name });
    for (const c of l1.children || []) items.push({ id: c.id, level: 2, full: c.name });
  }
  for (const it of items) it.short = baseShortName(it.full);
  const groups = new Map();
  for (const it of items) groups.set(it.short, [...(groups.get(it.short) || []), it]);
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (const it of list) {
      if (it.level === 1) it.short += '省';
      else if (it.full.endsWith('自治州')) it.short += '州';
      else it.short += '市';
    }
  }
  const names = {};
  const full = {};
  const problems = [];
  const seen = new Map();
  for (const it of items) {
    names[it.id] = it.short;
    full[it.id] = it.full;
    if ([...it.short].length > MAX_NAME_LEN) problems.push(`${it.id}“${it.short}”超过 ${MAX_NAME_LEN} 个字`);
    if (seen.has(it.short)) problems.push(`${seen.get(it.short)} 与 ${it.id} 简称重复：“${it.short}”`);
    seen.set(it.short, it.id);
  }
  return { names, full, problems };
}

// ---------- 地图 ----------

const MARKER_NAMES = /香港|澳门|台湾/;

function attr(tag, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

/** 路径只允许绝对坐标的 M/L/Z 与数字，防止把任何脚本或外部引用带进网页 */
function cleanPath(d) {
  const s = String(d || '').trim();
  return /^[MLZ0-9.,\s-]+$/i.test(s) ? s : null;
}

function bboxOf(paths) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of paths) {
    const nums = d.match(/-?\d+(?:\.\d+)?/g) || [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = Number(nums[i]);
      const y = Number(nums[i + 1]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function pathBBox(d) {
  return bboxOf([d]);
}

/**
 * 解析省级边界 SVG：<g id="provinces"> 内每个省一个 <path id data-name d>；<g id="jiuduanxian">（九段线）按 PRD 不显示，忽略。
 * 按全称（或简称前缀）把路径对应到一级区域编号。返回清洗后的数据（只含坐标）与问题列表。
 */
export function parseChinaSvg(svgText, map, names) {
  const text = String(svgText || '');
  const problems = [];
  const provinces = [];
  const gi = text.indexOf('id="jiuduanxian"');
  const re = /<path\b[^>]*>/g;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[0];
    const d = cleanPath(attr(tag, 'd'));
    if (!d) continue;
    const name = attr(tag, 'data-name');
    if (gi >= 0 && m.index > gi) continue;
    if (name) provinces.push({ name, d });
  }
  const regions = {};
  const used = new Set();
  for (const l1 of map.level1) {
    const short = baseShortName(l1.name);
    const hit =
      provinces.find((p) => !used.has(p) && p.name === l1.name) ||
      provinces.find((p) => !used.has(p) && (p.name.startsWith(short) || p.name.startsWith(names[l1.id])));
    if (!hit) {
      problems.push(`地图中找不到 ${l1.id}（${l1.name}）`);
      continue;
    }
    used.add(hit);
    regions[l1.id] = hit.d;
  }
  for (const p of provinces) if (!used.has(p)) problems.push(`地图中的“${p.name}”没有对应的一级区域`);
  // 港澳台：网页按形状大小决定是否画成小点（港澳），台湾作为普通区域显示
  const markers = map.level1.filter((l1) => MARKER_NAMES.test(l1.name) && regions[l1.id]).map((l1) => l1.id);
  const box = bboxOf(Object.values(regions));
  const pad = Math.max(box.w, box.h) * 0.02;
  return {
    data: {
      format: MAP_FORMAT,
      viewBox: [box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2].map((v) => Math.round(v * 100) / 100),
      regions,
      markers,
    },
    problems,
  };
}

/** 校验从存储桶读到的地图数据（只接受坐标路径） */
export function validMapData(data) {
  if (!data || data.format !== MAP_FORMAT || !Array.isArray(data.viewBox) || data.viewBox.length !== 4) return false;
  if (!data.regions || typeof data.regions !== 'object') return false;
  for (const d of [...Object.values(data.regions), ...(data.dashes || [])]) if (!cleanPath(d)) return false;
  if (data.markers && !Array.isArray(data.markers)) return false;
  return true;
}

// ---------- 二级地图（按省） ----------

export const L2_FORMAT = 'ourtrip-l2-map-v1';
export const L2_INDEX_KEY = 'meta/l2/index.json';
export const l2Key = (l1Id) => `meta/l2/${l1Id}.json`;

/**
 * 解析一个省的地级边界 SVG（每个地级一个 <path data-name d>），按名称对应到该省的二级区域编号。
 * 自动判断是哪个省：取名称对应上最多的一级区域。不在 333 个二级区域里的块（如省直辖县级市）放进 others，显示为灰色、无名称。
 */
export function parseLevel2Svg(svgText, map) {
  const text = String(svgText || '');
  const paths = [];
  const re = /<path\b[^>]*>/g;
  let m;
  while ((m = re.exec(text))) {
    const d = cleanPath(attr(m[0], 'd'));
    const name = attr(m[0], 'data-name');
    if (d && name) paths.push({ name, d });
  }
  const problems = [];
  let best = null;
  let bestHits = 0;
  for (const l1 of map.level1) {
    if (!(l1.children || []).length) continue;
    const bases = new Set(l1.children.map((c) => baseShortName(c.name)));
    const hits = paths.filter((p) => bases.has(baseShortName(p.name))).length;
    if (hits > bestHits) {
      best = l1;
      bestHits = hits;
    }
  }
  if (!best) return { data: null, l1Id: null, problems: ['文件中没有能对应到二级区域的地级边界'] };
  const regions = {};
  const others = [];
  for (const p of paths) {
    const c = best.children.find((x) => x.name === p.name || baseShortName(x.name) === baseShortName(p.name));
    if (c && !regions[c.id]) regions[c.id] = p.d;
    else others.push(p.d);
  }
  for (const c of best.children) if (!regions[c.id]) problems.push(`${best.id} 的地图里找不到 ${c.id}（${c.name}）`);
  const box = bboxOf([...Object.values(regions), ...others]);
  const pad = Math.max(box.w, box.h) * 0.02;
  return {
    l1Id: best.id,
    data: {
      format: L2_FORMAT,
      l1: best.id,
      viewBox: [box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2].map((v) => Math.round(v * 1000) / 1000),
      regions,
      others,
    },
    problems,
  };
}

export function validL2Data(data, l1Id) {
  if (!data || data.format !== L2_FORMAT || data.l1 !== l1Id || !Array.isArray(data.viewBox) || data.viewBox.length !== 4) return false;
  if (!data.regions || typeof data.regions !== 'object') return false;
  for (const d of [...Object.values(data.regions), ...(data.others || [])]) if (!cleanPath(d)) return false;
  return true;
}

/** 面积加权的形心（取面积最大的一块），用来放区域名称；落在凹形区域外时退回到包围盒中心 */
export function labelPoint(d) {
  const rings = (String(d).match(/M[^M]*/g) || []).map((r) => {
    const nums = (r.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  });
  let best = null;
  let bestA = 0;
  for (const pts of rings) {
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      const f = x1 * y2 - x2 * y1;
      a += f;
      cx += (x1 + x2) * f;
      cy += (y1 + y2) * f;
    }
    if (Math.abs(a) > bestA) {
      bestA = Math.abs(a);
      best = { x: cx / (3 * a), y: cy / (3 * a), pts };
    }
  }
  if (!best) {
    const b = pathBBox(d);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  // 形心不在多边形内（如月牙形）时，沿水平线取多边形内最宽一段的中点
  const inside = (x, y, pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  if (inside(best.x, best.y, best.pts)) return { x: best.x, y: best.y };
  const xs = [];
  const y = best.y;
  for (let i = 0, j = best.pts.length - 1; i < best.pts.length; j = i++) {
    const [xi, yi] = best.pts[i];
    const [xj, yj] = best.pts[j];
    if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  xs.sort((a, b) => a - b);
  let mid = null;
  let w = 0;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > w) {
      w = xs[i + 1] - xs[i];
      mid = (xs[i] + xs[i + 1]) / 2;
    }
  }
  return mid === null ? { x: best.x, y: best.y } : { x: mid, y };
}
