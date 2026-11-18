import { AppError } from './errors.js';

export function parseDriveUrl(value) {
  const invalid = () => new AppError('INVALID_URL', 'Provide an HTTPS Google Drive file link.', 400);
  if (typeof value !== 'string' || value.length > 2048) throw invalid();
  let url;
  try { url = new URL(value.trim()); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.port || url.username || url.password) throw invalid();
  const pathMatch = url.pathname.match(/^\/file\/d\/([\w-]+)(?:\/(?:view|preview))?\/?$/);
  const fileId = pathMatch?.[1] ?? (/^\/(?:open|uc)$/.test(url.pathname) ? url.searchParams.get('id') : null);
  if (!fileId || !/^[\w-]{10,200}$/.test(fileId)) throw invalid();
  const resourceKey = url.searchParams.get('resourcekey');
  if (resourceKey && !/^[\w-]{1,200}$/.test(resourceKey)) throw invalid();
  const canonical = new URL(`https://drive.google.com/file/d/${fileId}/view`);
  canonical.searchParams.set('hl', 'en');
  if (resourceKey) canonical.searchParams.set('resourcekey', resourceKey);
  return { fileId, url: canonical.href };
}

export function safeFilename(value = 'document.pdf') {
  const name = String(value).replace(/\s*-\s*Google Drive\s*$/i, '')
    .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').trim().replace(/^\.+/, '').slice(0, 160);
  return `${name.replace(/\.pdf$/i, '') || 'document'}.pdf`;
}

export function allowedBrowserUrl(value) {
  try {
    const url = new URL(value);
    if (['blob:', 'data:', 'about:'].includes(url.protocol)) return true;
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
    return ['drive.google.com', 'docs.google.com', 'accounts.google.com', 'www.google.com', 'apis.google.com', 'fonts.googleapis.com'].includes(url.hostname)
      || ['gstatic.com', 'googleusercontent.com', 'googleapis.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}
