// 部署配置（不含任何秘密）。
// bucket / region：在腾讯云控制台 → 对象存储 → 存储桶列表中查看。
// encryptedCredentials：用 tools/encrypt.html 生成的密文（一段 JSON），整段粘贴到这里。
// 三项都填好之前，网页会提示“尚未配置云端存储”，可以先进入演示模式体验。
export const CONFIG = {
  bucket: '', // 例如 'ourtrip-1250000000'
  region: '', // 例如 'ap-guangzhou'
  encryptedCredentials: null, // 例如 { "v": 1, "kdf": "PBKDF2-SHA256", ... }
};
