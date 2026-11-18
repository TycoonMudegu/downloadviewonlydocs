import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDriveUrl, safeFilename, allowedBrowserUrl } from '../src/drive-url.js';
import { readConfig } from '../src/config.js';

const id = '1ttNvzuQbHUnABVcP-TAoix8-TVmehYph';
test('normalizes Drive links and preserves resource keys', () => {
  for (const path of [`file/d/${id}/view?usp=sharing`, `file/d/${id}/preview`, `open?id=${id}`, `uc?id=${id}&export=download`]) {
    assert.equal(parseDriveUrl(`https://drive.google.com/${path}`).url, `https://drive.google.com/file/d/${id}/view?hl=en`);
  }
  assert.match(parseDriveUrl(`https://drive.google.com/file/d/${id}/view?resourcekey=0-abc`).url, /resourcekey=0-abc$/);
});
test('rejects arbitrary hosts, credentials, ports, malformed IDs and non-HTTPS links', () => {
  for (const value of [null, {}, '', `http://drive.google.com/file/d/${id}/view`, `https://drive.google.com.evil.test/file/d/${id}/view`, `https://drive.google.com@evil.test/file/d/${id}/view`, `https://user@drive.google.com/file/d/${id}/view`, `https://drive.google.com:8443/file/d/${id}/view`, 'http://169.254.169.254/', 'file:///etc/passwd', 'https://drive.google.com/file/d/short/view', `https://drive.google.com/file/d/${id}/view?resourcekey=%0a`]) {
    assert.throws(() => parseDriveUrl(value), { code: 'INVALID_URL', status: 400 });
  }
});
test('browser network filter blocks non-Google destinations and metadata addresses', () => {
  for (const value of ['https://drive.google.com/viewer/img?page=1', 'https://lh3.googleusercontent.com/image', 'https://www.gstatic.com/viewer.js', 'https://content.googleapis.com/api', 'blob:https://drive.google.com/a']) assert.equal(allowedBrowserUrl(value), true);
  for (const value of ['http://metadata.google.internal/', 'https://127.0.0.1/', 'http://169.254.169.254/', 'https://evilgoogleusercontent.com/', 'https://gstatic.com.evil.test/', 'https://drive.google.com:1234/', 'https://user@drive.google.com/']) assert.equal(allowedBrowserUrl(value), false);
});
test('filenames are safe for paths and HTTP headers', () => {
  assert.equal(safeFilename('Maths.pdf - Google Drive'), 'Maths.pdf');
  assert.equal(safeFilename('../../report\r\n".pdf'), '_.._report___.pdf');
  assert.equal(safeFilename(''), 'document.pdf');
  assert.equal(safeFilename('Kiswahili – darasa.pdf'), 'Kiswahili – darasa.pdf');
});
test('configuration rejects unsafe limits', () => {
  assert.equal(readConfig({}).timeoutMs, 540000);
  for (const env of [{PORT:'bad'}, {MAX_PAGES:'0'}, {MAX_PDF_MB:'999'}, {CONVERSION_TIMEOUT_SECONDS:'Infinity'}]) assert.throws(() => readConfig(env));
});
