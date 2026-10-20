// 固定区域的显示设置（由具备仓库修改权限的人维护）。
//
// 1. 名称：真实简称不放在公开仓库，由维护工具上传到私有存储桶（meta/region-names.json），网页登录后读取；
//    读不到时显示区域编号。在 REGION_DISPLAY 中填写 name 可以覆盖某个区域的名称（会公开）。
// 2. 代表图片：把图片放进 images/regions/ 目录，在 REGION_DISPLAY 中填写 image 路径，
//    并把 imageUpdatedAt 填成修改的当前时间。
//    封面规则：用户在网页上选的照片与这里配置的图片“谁后设置谁生效”，可以互相替换——
//    改了这里（并更新 imageUpdatedAt），会替换用户之前选的照片；用户之后再选照片，又会替换这里的图片。
//    生效的一方失效时（照片被删、图片打不开）自动显示另一方；都没有时显示默认纯色。
// 3. 默认颜色：修改 COLORS / BOX_PALETTE。
//
// 注意：区域的编号、数量和从属关系只能来自 data/region-map-anon.js，这里只能改“怎么显示”。
//
// 示例：
//   'A03': { name: 'A03', image: 'images/regions/A03.jpg', imageUpdatedAt: '2026-10-15 20:00' },
//   'A03-C01': { image: 'images/regions/A03-C01.jpg', imageUpdatedAt: '2026-10-15 20:00' },

export const REGION_DISPLAY = {};

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
