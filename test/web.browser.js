import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';

async function serve(t, convert, env = {}) {
  const app = createApp({ config: readConfig(env), convert, log: () => {} });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  t.after(async () => {
    await browser.close();
    app.locals.shutdown();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  return page;
}

async function makePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([800, 566]);
  pdf.addPage([400, 600]);
  return { bytes: Buffer.from(await pdf.save()), filename: 'Mathematics – Grade 8.pdf', pageCount: 2 };
}

test('validates links, shows processing and downloads the generated PDF', async t => {
  let calls = 0;
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const fixture = await makePdf();
  const page = await serve(t, async () => {
    calls++;
    await new Promise(resolve => { release = resolve; started(); });
    return fixture;
  });
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click();
  await page.locator('#field-error').waitFor({ state: 'visible' });
  assert.equal(calls, 0);
  await page.getByLabel('Google Drive document link', { exact: true }).fill('https://drive.google.com/file/d/1ttNvzuQbHUnABVcP-TAoix8-TVmehYph/view');
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click();
  await page.locator('#result[data-state=processing]').waitFor();
  assert.equal(await page.locator('#drive-url').isDisabled(), true);
  await page.waitForFunction(() => document.querySelector('#cancel-button').hidden === false);
  await ready;
  const downloadEvent = page.waitForEvent('download');
  release();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), fixture.filename);
  const bytes = await readFile(await download.path());
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
  await page.locator('#result[data-state=ready]').waitFor();
  assert.match(await page.locator('#result-description').textContent(), /2 pages/);
  assert.equal(await page.getByRole('link', { name: 'Download PDF' }).isVisible(), true);
  assert.equal(await page.locator('#drive-url').isEnabled(), true);
  assert.equal(calls, 1);
});

test('displays access errors safely and allows another attempt', async t => {
  let calls = 0;
  const fixture = await makePdf();
  const page = await serve(t, async () => {
    if (++calls === 1) throw new AppError('ACCESS_REQUIRED', 'This file requires additional sharing permission. <script>bad</script>', 403);
    return fixture;
  });
  await page.getByLabel('Google Drive document link', { exact: true }).fill('https://drive.google.com/file/d/1ttNvzuQbHUnABVcP-TAoix8-TVmehYph/view');
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click();
  await page.locator('#result[data-state=error]').waitFor();
  assert.match(await page.locator('#result-description').textContent(), /sharing permission/);
  assert.equal(await page.locator('#result-description script').count(), 0);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click();
  await downloaded;
  await page.locator('#result[data-state=ready]').waitFor();
});

test('cancel stops the conversion and restores the form', async t => {
  let stopped;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const cancelled = new Promise(resolve => { stopped = resolve; });
  const page = await serve(t, async (_url, { signal }) => {
    started();
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => { stopped(); reject(signal.reason); }, { once: true }));
  });
  await page.getByLabel('Google Drive document link', { exact: true }).fill('https://drive.google.com/file/d/1ttNvzuQbHUnABVcP-TAoix8-TVmehYph/view');
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click();
  await ready;
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('#result[data-state=cancelled]').waitFor();
  await cancelled;
  assert.equal(await page.locator('#drive-url').isEnabled(), true);
  assert.match(await page.locator('#drive-url').inputValue(), /drive.google.com/);
});

test('shows an access-key field only when required and works on a narrow screen', async t => {
  const fixture = await makePdf();
  let calls = 0;
  const page = await serve(t, async () => { calls++; return fixture; }, { API_KEY: 'office-key' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('#access-settings').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByLabel('Google Drive document link', { exact: true }).fill('https://drive.google.com/file/d/1ttNvzuQbHUnABVcP-TAoix8-TVmehYph/view');
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click();
  await page.locator('#result[data-state=error]').waitFor();
  assert.equal(calls, 0);
  await page.getByLabel('Access key', { exact: true }).fill('office-key');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click();
  await downloaded;
  assert.equal(calls, 1);
});

test('time-based themes, personalised messages and custom quotes persist and reset', async t => {
  const fixture = await makePdf();
  const page = await serve(t, async () => fixture);
  await page.clock.install({ time: new Date('2026-11-18T03:00:00Z') });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'morning');
  await page.getByRole('button', { name: 'Make it yours', exact: true }).click();
  await page.getByRole('radio', { name: 'Afternoon', exact: true }).check();
  await page.locator('#message-afternoon').fill('Good work, <script>bad()</script>');
  await page.getByLabel('Quote', { exact: true }).fill('My custom desk wisdom.');
  await page.getByLabel('Author', { exact: true }).fill('Test Publisher');
  await page.getByRole('button', { name: 'Save changes' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'afternoon');
  assert.equal(await page.locator('#personal-message').innerText(), 'Good work, <script>bad()</script>');
  assert.equal(await page.locator('#personal-message script').count(), 0);
  assert.equal(await page.locator('#quote-text').innerText(), 'My custom desk wisdom.');
  assert.equal(await page.locator('#quote-author').innerText(), 'Test Publisher');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#quote-text').textContent === 'My custom desk wisdom.');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'afternoon');
  await page.getByRole('button', { name: 'Next quote', exact: true }).click();
  assert.notEqual(await page.locator('#quote-text').innerText(), 'My custom desk wisdom.');
  await page.getByRole('button', { name: 'Make it yours', exact: true }).click();
  await page.getByRole('button', { name: 'Reset defaults', exact: true }).click();
  await page.getByRole('button', { name: 'Close preferences', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'morning');
  assert.equal(await page.locator('html').getAttribute('data-theme-mode'), 'auto');
});

test('automatic palette updates across morning, midday and afternoon while the page is open', async t => {
  const page = await serve(t, async () => makePdf());
  await page.clock.install({ time: new Date('2026-11-18T08:59:45Z') });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'morning');
  await page.clock.runFor(30_000);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'midday');
  assert.match(await page.locator('#time-avatar').getAttribute('src'), /midday/);
  await page.clock.setSystemTime(new Date('2026-11-18T11:59:45Z'));
  await page.clock.runFor(30_000);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'afternoon');
  assert.match(await page.locator('#time-avatar').getAttribute('src'), /afternoon/);
});
