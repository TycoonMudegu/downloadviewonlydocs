import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';
import { parseDriveUrl, safeFilename } from './drive-url.js';

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));

function authorized(req, key) {
  if (!key) return true;
  const actual = Buffer.from(req.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${key}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createApp({ config, convert, log = entry => console.log(JSON.stringify(entry)) }) {
  const app = express();
  const shutdown = new AbortController();
  let busy = false;
  app.disable('x-powered-by');
  app.locals.shutdown = () => shutdown.abort(new AppError('SHUTTING_DOWN', 'The service is restarting. Please retry.', 503));
  app.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    next();
  });
  app.get('/healthz', (_req, res) => res.status(shutdown.signal.aborted ? 503 : 200).json({ status: shutdown.signal.aborted ? 'stopping' : 'ok' }));
  app.get('/', (_req, res) => res.sendFile('index.html', { root: publicDirectory }));
  app.use('/assets', express.static(publicDirectory, { index: false, dotfiles: 'deny' }));
  app.get('/api/config', (_req, res) => res.json({ requiresApiKey: Boolean(config.apiKey) }));
  app.get('/api', (_req, res) => res.json({
    service: 'Drive Download Helper',
    usage: 'POST /convert with application/json: {"url":"https://drive.google.com/file/d/FILE_ID/view"}',
    authentication: config.apiKey ? 'Authorization: Bearer <API_KEY>' : 'Use Cloud Run IAM for access control.',
    accepts: 'Public Google Drive PDF previews',
    output: 'application/pdf; pages are images, without searchable text',
  }));
  app.post('/convert', (req, res, next) => {
    if (!authorized(req, config.apiKey)) {
      res.set('WWW-Authenticate', 'Bearer');
      return next(new AppError('UNAUTHORIZED', 'A valid bearer token is required.', 401));
    }
    next();
  }, express.json({ limit: '8kb' }), async (req, res, next) => {
    const disconnected = new AbortController();
    const onDisconnect = () => {
      if (!res.writableFinished) disconnected.abort(new AppError('CLIENT_DISCONNECTED', 'The client disconnected.', 499));
    };
    let acquired = false;
    const started = Date.now();
    try {
      if (!req.is('application/json')) throw new AppError('INVALID_BODY', 'Send JSON with a url field.', 415);
      const source = parseDriveUrl(req.body?.url);
      if (shutdown.signal.aborted) throw shutdown.signal.reason;
      if (busy) {
        res.set('Retry-After', '10');
        throw new AppError('BUSY', 'A conversion is already running on this instance. Retry shortly.', 429);
      }
      busy = true;
      acquired = true;
      req.once('aborted', onDisconnect);
      res.once('close', onDisconnect);
      const result = await convert(source.url, {
        ...config,
        signal: AbortSignal.any([disconnected.signal, shutdown.signal]),
        onProgress: progress => log({ event: 'conversion_progress', ...progress }),
      });
      if (disconnected.signal.aborted) return;
      const filename = safeFilename(result.filename);
      const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
      res.status(200).set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        'X-PDF-Page-Count': String(result.pageCount),
      });
      // Omit Content-Length and send chunks: Cloud Run permits streamed responses over 32 MiB.
      async function* chunks() {
        for (let offset = 0; offset < result.bytes.length; offset += 64 * 1024) yield result.bytes.subarray(offset, offset + 64 * 1024);
      }
      await pipeline(Readable.from(chunks()), res);
      log({ event: 'conversion_complete', pages: result.pageCount, bytes: result.bytes.length, durationMs: Date.now() - started });
    } catch (error) {
      if (!disconnected.signal.aborted) next(error);
    } finally {
      if (acquired) busy = false;
      req.off('aborted', onDisconnect);
      res.off('close', onDisconnect);
    }
  });
  app.use((_req, _res, next) => next(new AppError('NOT_FOUND', 'Endpoint not found.', 404)));
  app.use((error, _req, res, _next) => {
    if (res.headersSent || res.destroyed) return;
    let known = error instanceof AppError;
    if (error.type === 'entity.parse.failed') { error = new AppError('INVALID_JSON', 'The request body is not valid JSON.', 400); known = true; }
    if (error.type === 'entity.too.large') { error = new AppError('BODY_TOO_LARGE', 'The JSON request exceeds 8 KB.', 413); known = true; }
    log({ event: 'request_error', code: known ? error.code : 'INTERNAL_ERROR' });
    res.status(known ? error.status : 500).json({ error: {
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : 'Conversion failed unexpectedly. Check the service logs and retry.',
    } });
  });
  return app;
}
