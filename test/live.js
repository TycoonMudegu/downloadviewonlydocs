import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { convertDrivePdf } from '../src/converter.js';

// Explicit opt-in: contacts Google Drive and may take several minutes.
const url = process.env.LIVE_DRIVE_URL || 'https://drive.google.com/file/d/1ttNvzuQbHUnABVcP-TAoix8-TVmehYph/view';
test('converts a public Drive preview through the HTTP API into a complete PDF', { timeout: 570_000 }, async () => {
  const app = createApp({ config: readConfig({}), convert: convertDrivePdf });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/convert`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(550_000),
    });
    assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
    const bytes = Buffer.from(await response.arrayBuffer());
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), Number(response.headers.get('x-pdf-page-count')));
    if (!process.env.LIVE_DRIVE_URL) assert.equal(pdf.getPageCount(), 64);
    assert.ok(bytes.length > 10000);
    await mkdir('output', { recursive: true });
    await writeFile('output/live-result.pdf', bytes);
    console.log(`Verified ${pdf.getPageCount()} pages, ${bytes.length} bytes; output/live-result.pdf`);
  } finally {
    app.locals.shutdown();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
