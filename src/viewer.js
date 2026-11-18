import { AppError } from './errors.js';

export async function openViewer(page, url, { maxPages }) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (response?.status() === 404) throw new AppError('FILE_NOT_FOUND', 'The Drive file does not exist or is not publicly accessible.', 404);
  if (response && response.status() >= 400) throw new AppError('DRIVE_UNAVAILABLE', 'Google Drive could not serve this file. Retry later.', 502);
  let info;
  try {
    const ready = await page.waitForFunction(() => {
      const label = document.querySelector('input[aria-label^="Page "][aria-label*=" of "]')?.getAttribute('aria-label');
      const total = Number(label?.match(/^Page \d+ of (\d+)$/)?.[1] || 0);
      const title = document.querySelector('meta[property="og:title"]')?.content || document.title;
      // Drive briefly announces "Page 1 of 0" before preview metadata arrives.
      if (total > 0 && [...document.images].some(img => img.alt === `Page 1 of ${total}` && img.complete && img.naturalWidth >= 300)) return { total, title };
      if (!total) {
        const text = document.body.innerText;
        if (/you need access|request access|you need permission|access denied|sign in to continue/i.test(text)) return { denied: true };
        if (/file you have requested does not exist|unable to access this document|couldn.t preview file|no preview available/i.test(text)) return { missing: true };
      }
      return false;
    }, null, { timeout: 45_000 });
    info = await ready.jsonValue();
    await ready.dispose();
  } catch (error) {
    if (page.isClosed()) throw error;
    throw new AppError('UNSUPPORTED_PREVIEW', 'Drive did not load a supported PDF preview. The file may require sign-in, or the viewer may have changed.');
  }
  if (info.denied || page.url().startsWith('https://accounts.google.com/')) throw new AppError('ACCESS_REQUIRED', 'This file requires Google sign-in or additional sharing permission.', 403);
  if (info.missing) throw new AppError('UNSUPPORTED_PREVIEW', 'Drive cannot preview this file. Check the link and its sharing settings.');
  if (info.total > maxPages) throw new AppError('PAGE_LIMIT', `The file has ${info.total} pages; the service limit is ${maxPages}.`, 413);
  const zoom = page.getByRole('combobox', { name: 'Page zoom control', exact: true });
  if (await zoom.count()) {
    const firstPageLabel = `Page 1 of ${info.total}`;
    const firstImage = page.locator(`img[alt="${firstPageLabel}"]`).first();
    await firstImage.waitFor({ state: 'visible' });
    const initialWidth = await firstImage.evaluate(img => img.getBoundingClientRect().width);
    const initialZoom = Number.parseFloat(await zoom.inputValue()) || 100;
    const expectedWidth = initialWidth * 200 / initialZoom;
    await zoom.fill('200%');
    await zoom.press('Enter');
    // The zoom control updates before Drive replaces its page images. Check native
    // pixels: CSS can cap the displayed width even after the higher-resolution image loads.
    await page.waitForFunction(({ label, width }) => {
      const img = [...document.images].find(img => img.alt === label);
      return img?.complete && img.naturalWidth >= width - 2;
    }, { label: firstPageLabel, width: expectedWidth }, { timeout: 25_000 });
  }
  return { title: info.title, pageCount: info.total };
}

export async function capturePage(page, pageNumber, total) {
  const input = page.locator('input[aria-label^="Page "][aria-label*=" of "]').first();
  await input.fill(String(pageNumber));
  await input.press('Enter');
  const label = `Page ${pageNumber} of ${total}`;
  try {
    await page.waitForFunction(label => {
      const img = [...document.images].find(img => img.alt === label);
      // At 200% zoom Drive replaces the initial low-resolution image asynchronously.
      return img?.complete && img.naturalWidth >= 300 && img.naturalHeight >= 200
        && img.naturalWidth >= Math.floor(img.getBoundingClientRect().width) - 2;
    }, label, { timeout: 25_000 });
    return await page.evaluate(label => {
      const img = [...document.images].find(img => img.alt === label);
      if (!img?.complete || !img.naturalWidth) throw new Error('Page image disappeared.');
      if (img.naturalWidth * img.naturalHeight > 40_000_000) throw new Error('Page image is too large.');
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0);
      const data = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
      const result = { data, width: canvas.width, height: canvas.height };
      canvas.width = canvas.height = 0;
      return result;
    }, label);
  } catch (error) {
    if (page.isClosed()) throw error;
    throw new AppError('PAGE_CAPTURE_FAILED', `Page ${pageNumber} of ${total} did not load completely. Retry the conversion.`);
  }
}
