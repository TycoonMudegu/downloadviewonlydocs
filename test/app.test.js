import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';

const url = 'https://drive.google.com/file/d/1ttNvzuQbHUnABVcP-TAoix8-TVmehYph/view';
const fixture = { bytes: Buffer.from('%PDF-1.7\nfixture'), filename: 'Mathematics.pdf', pageCount: 64 };
async function serve(t, convert, env = {}) {
  const app = createApp({ config: readConfig(env), convert, log: () => {} });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { app.locals.shutdown(); server.closeAllConnections(); server.close(); });
  return { app, base: `http://127.0.0.1:${server.address().port}` };
}
function post(base, body = { url }, headers = {}) {
  return fetch(`${base}/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

test('serves the web interface and assets without exposing access keys', async t => {
  const { base } = await serve(t, async () => fixture, { API_KEY: 'test-secret' });
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  assert.match(html, /id="convert-form"/);
  assert.doesNotMatch(html, /test-secret/);
  assert.equal((await fetch(`${base}/assets/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/assets/styles.css`)).status, 200);
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.deepEqual(config, { requiresApiKey: true });
  assert.equal((await fetch(`${base}/api`)).status, 200);
});

test('returns PDF bytes, attachment name and verified page count', async t => {
  const { base } = await serve(t, async actual => { assert.equal(actual, `${url}?hl=en`); return fixture; });
  const response = await post(base);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'), /Mathematics.pdf/);
  assert.equal(response.headers.get('x-pdf-page-count'), '64');
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('transfer-encoding'), 'chunked');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixture.bytes);
});
test('validates request bodies before launching the browser', async t => {
  let calls = 0;
  const { base } = await serve(t, async () => { calls++; return fixture; });
  for (const body of [{}, { url: 'http://169.254.169.254/' }, { url: 123 }]) assert.equal((await post(base, body)).status, 400);
  const malformed = await fetch(`${base}/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  assert.equal((await post(base, { url: 'x'.repeat(9000) })).status, 413);
  assert.equal((await fetch(`${base}/convert`, { method: 'POST', body: url })).status, 415);
  assert.equal(calls, 0);
});
test('protects conversion with optional bearer token and leaves health checks available', async t => {
  const { base } = await serve(t, async () => fixture, { API_KEY: 'test-secret' });
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await post(base)).status, 401);
  assert.equal((await post(base, { url }, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await post(base, { url }, { Authorization: 'Bearer test-secret' })).status, 200);
});
test('rejects simultaneous conversions and releases capacity after a failure', async t => {
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const { base } = await serve(t, async () => {
    calls++;
    if (calls === 1) { started(); await new Promise(resolve => { release = resolve; }); throw new AppError('PAGE_CAPTURE_FAILED', 'Try again.'); }
    return fixture;
  });
  const first = post(base);
  await ready;
  const second = await post(base);
  assert.equal(second.status, 429);
  assert.equal(second.headers.get('retry-after'), '10');
  release();
  assert.equal((await first).status, 422);
  assert.equal((await post(base)).status, 200);
});
test('cancels work when the client disconnects', async t => {
  let started;
  let cancelled;
  const ready = new Promise(resolve => { started = resolve; });
  const stopped = new Promise(resolve => { cancelled = resolve; });
  const { base } = await serve(t, async (_url, { signal }) => {
    started();
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => { cancelled(); reject(signal.reason); }, { once: true }));
  });
  const controller = new AbortController();
  const request = fetch(`${base}/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: controller.signal }).catch(() => {});
  await ready;
  controller.abort();
  await Promise.race([stopped, new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('Cancellation was not propagated.')), 1500); timer.unref(); })]);
  await request;
});
test('returns useful known errors and hides unexpected internal details', async t => {
  let known = true;
  const { base, app } = await serve(t, async () => {
    if (known) throw new AppError('ACCESS_REQUIRED', 'Sharing permission required.', 403);
    throw new Error('sensitive signed URL');
  });
  assert.equal((await post(base)).status, 403);
  known = false;
  const response = await post(base);
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /sensitive/);
  app.locals.shutdown();
  assert.equal((await fetch(`${base}/healthz`)).status, 503);
  assert.equal((await post(base)).status, 503);
});
