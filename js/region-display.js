// 固定区域的显示设置（由具备仓库修改权限的人维护）。
//
// 1. 名称：真实简称不放在公开仓库，由维护工具上传到私有存储桶（meta/region-names.json），网页登录后读取；
//    读不到时显示区域编号。在 REGION_DISPLAY 中填写 name 可以覆盖某个区域的名称（会公开）。
// 2. 省级代表照片（PRD 2.2）：放在 images/provinces/{省名}.jpg，来源与授权见同目录的“来源.md”。
//    按省名（不是区域编号）对应，公开仓库里因此看不出编号与省份的对应关系；网页登录读到名称后才能对上。
//    未点亮时显示为灰白色；点亮后为彩色；用户设置封面后显示用户的照片。换图只需替换同名文件并更新来源.md。
//    二级区域没有代表照片。
// 3. 默认颜色：修改 COLORS / BOX_PALETTE。
//
// 注意：区域的编号、数量和从属关系只能来自 data/region-map-anon.js，这里只能改“怎么显示”。
//
// 示例：
//   'A03': { name: 'A03' },

export const REGION_DISPLAY = {};

/** 有代表照片的省级区域（与 images/provinces/ 里的文件名一致） */
export const PROVINCE_PHOTOS = [
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江', '安徽',
  '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州',
  '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆', '台湾', '香港', '澳门',
];

/** 省级区域显示名称 → 代表照片地址；名称为与二级区域重名而加了“省”的（如“吉林省”）去掉后再对应 */
export function provincePhoto(name) {
  const key = String(name || '').replace(/省$/, '');
  return PROVINCE_PHOTOS.includes(key) ? `images/provinces/${encodeURIComponent(key)}.jpg` : null;
}

export const COLORS = {
  region: '#d7e4f8', // 固定区域默认背景（未点亮浅色；点亮后为明亮渐变，见 css/app.css）
  box: '#eaf2ff', // 自定义框默认背景
};

// 自定义框可选背景色：与蓝色主色系搭配的浅色为主（蓝、青、绿、灰，另有一种暖黄点缀），
// 另有几种鲜亮色（深色背景上自动改用白字）。用户之前选过的颜色保存在相册数据里，不受这里影响。
export const BOX_PALETTE = [
  '#eaf2ff', '#dbeafe', '#e0f2fe', '#ccfbf1', '#dcfce7', '#eef2f7', '#fef3c7',
  '#2f7cf6', '#0ea5e9', '#14b8a6', '#34d399', '#64748b',
];
