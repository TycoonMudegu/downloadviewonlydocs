import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { openViewer, capturePage } from '../src/viewer.js';

const url = 'https://drive.google.com/file/d/fixture_file_12345/view';
const fixture = `<!doctype html><html><head><title>Mixed pages.pdf</title></head><body>
<img alt="A thumbnail image for page 1" width="120" height="80">
<input aria-label="Page 1 of 0" value="1">
<input role="combobox" aria-label="Page zoom control" value="100%">
<div id="pages"></div>
<script>
const input = document.querySelector('input');
const zoom = document.querySelector('[role=combobox]');
let zoomFactor = 1;
function render() {
  const number = Number(input.value);
  const width = 800 * zoomFactor;
  const height = number === 2 ? width * 1.4 : width * 0.7;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = number === 1 ? '#f00' : '#00f'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#fff'; ctx.font = '80px sans-serif'; ctx.fillText('Page ' + number, 100, 120);
  const img = new Image(); img.alt = 'Page ' + number + ' of 2'; img.src = canvas.toDataURL();
  img.style.width = Math.min(width, 1442) + 'px';
  // Simulate viewer virtualization: only the current page remains in the DOM.
  document.querySelector('#pages').replaceChildren(img);
  input.setAttribute('aria-label', 'Page ' + number + ' of 2');
}
input.addEventListener('keydown', event => { if (event.key === 'Enter') render(); });
zoom.addEventListener('keydown', event => {
  if (event.key === 'Enter') setTimeout(() => { zoomFactor = 2; render(); }, 150);
});
setTimeout(render, 150);
</script></body></html>`;

test('waits through a zero page count and captures lazy pages in order with mixed dimensions', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://drive.google.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    const info = await openViewer(page, url, { maxPages: 10 });
    assert.deepEqual(info, { title: 'Mixed pages.pdf', pageCount: 2 });
    const first = await capturePage(page, 1, 2);
    const second = await capturePage(page, 2, 2);
    assert.deepEqual([first.width, first.height], [1600, 1120]);
    assert.deepEqual([second.width, second.height], [1600, 2240]);
    assert.notEqual(first.data, second.data);
    assert.equal(Buffer.from(first.data, 'base64').subarray(0, 2).toString('hex'), 'ffd8');
  } finally { await browser.close(); }
});
test('enforces page limits and reports access requirements', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://drive.google.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    await assert.rejects(openViewer(page, url, { maxPages: 1 }), { code: 'PAGE_LIMIT', status: 413 });
    await page.unrouteAll();
    await page.route('https://drive.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>You need access</h1><button>Request access</button>' }));
    await assert.rejects(openViewer(page, url, { maxPages: 10 }), { code: 'ACCESS_REQUIRED', status: 403 });
  } finally { await browser.close(); }
});
