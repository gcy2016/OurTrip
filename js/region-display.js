// 固定区域的显示设置（由具备仓库修改权限的人维护）。
//
// 1. 名称：第一版直接显示区域编号（如 A03、A03-C01）。如需改名，在 REGION_DISPLAY 中填写 name。
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
  region: '#3a6ea5', // 固定区域默认背景（蓝色）
  box: '#5f7f8f', // 自定义框默认背景
};

export const BOX_PALETTE = ['#5f7f8f', '#3a6ea5', '#2f8f83', '#6b8e4e', '#b8893a', '#c4664a', '#a35a7a', '#7563a8', '#56606b', '#8c7462'];
