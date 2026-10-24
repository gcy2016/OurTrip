import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, blobFingerprint, ITERATIONS } from '../../js/crypto.js';

test('密文可用正确密码解开；错误密码给出统一提示', async () => {
  const blob = await encryptSecret({ secretId: 'AKIDtest', secretKey: 'k' }, 'correct horse 123', 1000);
  assert.equal(blob.iter, 1000);
  assert.ok(!JSON.stringify(blob).includes('AKIDtest'));
  const { secret } = await decryptSecret(blob, 'correct horse 123');
  assert.deepEqual(secret, { secretId: 'AKIDtest', secretKey: 'k' });
  await assert.rejects(decryptSecret(blob, 'wrong'), (e) => e.code === 'WRONG_PASSWORD' && e.message === '密码不正确，请重试');
  const fp1 = await blobFingerprint(blob);
  const blob2 = await encryptSecret({ secretId: 'x', secretKey: 'y' }, 'correct horse 123', 1000);
  assert.notEqual(fp1, await blobFingerprint(blob2));
});

test('默认迭代次数为 60 万', () => {
  assert.equal(ITERATIONS, 600000);
});
