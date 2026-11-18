import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readConfig } from './config.js';
import { convertDrivePdf } from './converter.js';

const [url, output] = process.argv.slice(2);
if (!url) {
  console.error('Usage: npm run convert -- <Google Drive URL> [output.pdf]');
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  try {
    const result = await convertDrivePdf(url, {
      ...readConfig(), signal: controller.signal,
      onProgress: ({ page, total }) => console.error(`Captured page ${page}/${total}`),
    });
    const destination = output || `output/${result.filename}`;
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, result.bytes);
    console.log(`Saved ${result.pageCount} pages to ${destination}`);
  } catch (error) {
    console.error(`${error.code || error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
