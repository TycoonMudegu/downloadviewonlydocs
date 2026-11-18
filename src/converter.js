import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { AppError } from './errors.js';
import { parseDriveUrl, safeFilename, allowedBrowserUrl } from './drive-url.js';
import { readConfig } from './config.js';
import { openViewer, capturePage } from './viewer.js';

export async function convertDrivePdf(inputUrl, options = {}) {
  const source = parseDriveUrl(inputUrl);
  const config = { ...readConfig(), ...options };
  const timer = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, timer.signal]) : timer.signal;
  const deadline = setTimeout(() => timer.abort(new AppError('CONVERSION_TIMEOUT', 'The conversion exceeded its time limit.', 504)), config.timeoutMs);
  let browser;
  let context;
  const closeContext = () => { void context?.close().catch(() => {}); };
  signal.addEventListener('abort', closeContext, { once: true });
  try {
    signal.throwIfAborted();
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'], timeout: Math.min(30_000, config.timeoutMs) });
    signal.throwIfAborted();
    context = await browser.newContext({ viewport: { width: 1800, height: 1200 }, locale: 'en-US', serviceWorkers: 'block', acceptDownloads: false });
    signal.throwIfAborted();
    await context.route('**/*', route => allowedBrowserUrl(route.request().url()) ? route.continue() : route.abort('blockedbyclient'));
    const page = await context.newPage();
    page.setDefaultTimeout(25_000);
    const { title, pageCount } = await openViewer(page, source.url, config);
    const pdf = await PDFDocument.create();
    pdf.setTitle(title.replace(/\s*-\s*Google Drive\s*$/i, ''));
    pdf.setCreator('Drive Download Helper');
    let imageBytes = 0;
    for (let number = 1; number <= pageCount; number++) {
      signal.throwIfAborted();
      const capture = await capturePage(page, number, pageCount);
      const bytes = Buffer.from(capture.data, 'base64');
      imageBytes += bytes.length;
      if (imageBytes > config.maxPdfBytes) throw new AppError('SIZE_LIMIT', 'The PDF exceeds the configured size limit.', 413);
      const image = await pdf.embedJpg(bytes);
      // Preserve individual page proportions, including mixed portrait and landscape pages.
      const outputPage = pdf.addPage([capture.width * 0.5, capture.height * 0.5]);
      outputPage.drawImage(image, { x: 0, y: 0, width: outputPage.getWidth(), height: outputPage.getHeight() });
      await pdf.flush();
      config.onProgress?.({ page: number, total: pageCount });
    }
    signal.throwIfAborted();
    if (pdf.getPageCount() !== pageCount) throw new AppError('INCOMPLETE_PDF', 'The PDF page count does not match the preview.');
    const bytes = Buffer.from(await pdf.save());
    signal.throwIfAborted();
    if (bytes.length > config.maxPdfBytes) throw new AppError('SIZE_LIMIT', 'The PDF exceeds the configured size limit.', 413);
    return { bytes, filename: safeFilename(title), pageCount };
  } catch (error) {
    if (signal.aborted) throw signal.reason instanceof AppError ? signal.reason : new AppError('CANCELLED', 'The conversion was cancelled.', 499);
    if (error instanceof AppError) throw error;
    // Do not expose signed Drive image URLs or browser internals to API clients/logs.
    throw new AppError('BROWSER_ERROR', 'The browser could not process this Drive preview. Check browser installation and retry.', 502);
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', closeContext);
    await browser?.close().catch(() => {});
  }
}
