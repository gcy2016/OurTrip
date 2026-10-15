// 部署配置（不含任何秘密）。
// bucket / region：在腾讯云控制台 → 对象存储 → 存储桶列表中查看。
// encryptedCredentials：用 tools/encrypt.html 生成的密文（一段 JSON），整段粘贴到这里。
// 三项都填好之前，网页会提示“尚未配置云端存储”，可以先进入演示模式体验。
export const CONFIG = {
  bucket: 'ourtrip-1497637272',
  region: 'ap-guangzhou',
  encryptedCredentials: {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter: 600000,
    salt: 'Hb3rw9ilueSDXAe/8vF9oQ==',
    iv: 'WteuCNwIy+8e3sVR',
    ct: 'ND2XGpgS4HPoca6MLtU0uiVApMfN0Fb/TZy93rwfn/zT+dPE1blOyn8Y9Rla7gc98YYm5KrBcHnDJVzgz2+Bm0wQU0fOPVK5tg2Ku/+iWwIsPJXyYV6VSeaXQXReAsr3QFZ+GfzsDkNhKXFyTij7k9+M',
  },
};
