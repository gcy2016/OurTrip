// 固定区域的显示设置（由具备仓库修改权限的人维护）。
//
// 1. 名称：真实简称不放在公开仓库，由维护工具上传到私有存储桶（meta/region-names.json），网页登录后读取；
//    读不到时显示区域编号。在 REGION_DISPLAY 中填写 name 可以覆盖某个区域的名称（会公开）。
// 2. 区域方框的背景：用户在网页上设置的封面；没有设置时显示默认纯色。
// 3. 默认颜色：修改 COLORS / BOX_PALETTE。
//
// 注意：区域的编号、数量和从属关系只能来自 data/region-map-anon.js，这里只能改“怎么显示”。
//
// 示例：
//   'A03': { name: 'A03' },

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
