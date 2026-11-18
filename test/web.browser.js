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
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click();
  await page.locator('#field-error').waitFor({ state: 'visible' });
  assert.equal(calls, 0);
  await page.getByLabel('Google Drive document link', { exact: true }).fill('https://drive.google.com/file/d/1ttNvzuQbHUnABVcP-TAoix8-TVmehYph/view');
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click();
  await page.locator('#result[data-state=processing]').waitFor();
  assert.equal(await page.locator('#drive-url').isDisabled(), true);
  await page.waitForFunction(() => document.querySelector('#cancel-button').hidden === false);
  await ready;
  await assertFitsViewport(page, ['#drive-url', '#submit-button', '#cancel-button', '#quote-text', '#quote-author', '.ownership']);
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
  await page.setViewportSize({ width: 375, height: 667 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  await page.locator('#result[data-state=ready]').waitFor();
  for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await assertFitsViewport(page, ['#drive-url', '#access-key', '#submit-button', '#download-link', '#quote-text', '#quote-author', '.ownership']);
  }
});

test('time-based themes, personalised messages and custom quotes persist and reset', async t => {
  const fixture = await makePdf();
  const page = await serve(t, async () => fixture);
  await page.clock.install({ time: new Date('2026-11-18T03:00:00Z') });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'morning');
  // The owner has hidden the editor entry point; retain coverage of saved preferences.
  assert.equal(await page.locator('#open-preferences').isVisible(), false);
  await page.locator('#open-preferences').dispatchEvent('click');
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
  await page.locator('#open-preferences').dispatchEvent('click');
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

async function assertFitsViewport(page, selectors) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  assert.ok(dimensions.scrollWidth <= dimensions.width, 'the document must not overflow horizontally');
  assert.ok(dimensions.scrollHeight <= dimensions.height, 'the document must not overflow vertically');
  for (const selector of selectors) {
    const bounds = await page.locator(selector).boundingBox();
    assert.ok(bounds && bounds.width > 0 && bounds.height > 0, `${selector} must be visible`);
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= dimensions.width + 1, `${selector} must fit horizontally`);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= dimensions.height + 1, `${selector} must fit vertically`);
  }
  const quoteFits = await page.locator('blockquote').evaluate(element => element.scrollHeight <= element.clientHeight + 1);
  assert.ok(quoteFits, `the current quote must fit without its own scrollbar at ${dimensions.width}×${dimensions.height}`);
  await page.mouse.wheel(0, 1000);
  assert.equal(await page.evaluate(() => scrollY), 0, 'the page must not scroll');
}

test('form, results and quotes fit desktop, mobile and landscape screens without page scrolling', async t => {
  const fixture = await makePdf();
  const page = await serve(t, async () => fixture);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    const selectors = ['.brand-island', '.time-island', '#drive-url', '#submit-button', '.quote-navigation', '#quote-text', '#quote-author', '.ownership'];
    await assertFitsViewport(page, selectors);
    await page.locator('#drive-url').fill('https://drive.google.com/file/d/1ttNvzuQbHUnABVcP-TAoix8-TVmehYph/view');
    const downloaded = page.waitForEvent('download');
    await page.locator('#submit-button').click();
    await downloaded;
    await page.locator('#result[data-state=ready]').waitFor();
    await assertFitsViewport(page, [...selectors, '#download-link']);
  }
});

test('quotes rotate automatically and pause for reading and the pause control', async t => {
  const page = await serve(t, async () => makePdf());
  await page.clock.install();
  await page.reload();
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.querySelector('#quote-count').textContent === '01 / 06');
  await page.clock.runFor(10_000);
  assert.equal(await page.locator('#quote-count').textContent(), '02 / 06');

  await page.locator('#quote-text').hover();
  await page.clock.runFor(20_000);
  assert.equal(await page.locator('#quote-count').textContent(), '02 / 06');
  await page.mouse.move(0, 0);
  await page.clock.runFor(10_000);
  assert.equal(await page.locator('#quote-count').textContent(), '03 / 06');

  await page.getByRole('button', { name: 'Pause automatic quotes', exact: true }).click();
  await page.locator('#drive-url').focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(30_000);
  assert.equal(await page.locator('#quote-count').textContent(), '03 / 06');
  await page.getByRole('button', { name: 'Resume automatic quotes', exact: true }).click();
  await page.locator('#drive-url').focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(10_000);
  assert.equal(await page.locator('#quote-count').textContent(), '04 / 06');

  await page.getByRole('button', { name: 'Next quote', exact: true }).click();
  assert.equal(await page.locator('#quote-count').textContent(), '05 / 06');
  await page.locator('#drive-url').focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(9_000);
  assert.equal(await page.locator('#quote-count').textContent(), '05 / 06');
  await page.clock.runFor(1_000);
  assert.equal(await page.locator('#quote-count').textContent(), '06 / 06');
  await page.clock.runFor(10_000);
  assert.equal(await page.locator('#quote-count').textContent(), '01 / 06');
});
