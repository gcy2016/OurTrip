import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, makeZip } from '../../js/zip.js';

test('CRC32 标准校验值', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('生成的 zip 可被标准工具读取，中文文件名正确', () => {
  const a = new Uint8Array([1, 2, 3, 4, 5]);
  const b = new TextEncoder().encode('hello');
  const zip = makeZip([{ name: '第一张.jpg', data: a }, { name: 'b.jpg', data: b }]);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const file = join(dir, 't.zip');
  writeFileSync(file, zip);
  const out = execFileSync('python3', ['-c', `import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print('|'.join(z.namelist())); print(list(z.read('第一张.jpg')), z.read('b.jpg').decode())`, file]).toString();
  assert.equal(out.trim(), 'None\n第一张.jpg|b.jpg\n[1, 2, 3, 4, 5] hello');
});
