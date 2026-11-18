function integer(env, key, fallback, min, max) {
  if (env[key] === undefined || env[key] === '') return fallback;
  const value = Number(env[key]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer from ${min} to ${max}.`);
  return value;
}

export function readConfig(env = process.env) {
  return {
    port: integer(env, 'PORT', 8080, 1, 65535),
    timeoutMs: integer(env, 'CONVERSION_TIMEOUT_SECONDS', 540, 5, 3500) * 1000,
    maxPages: integer(env, 'MAX_PAGES', 300, 1, 2000),
    maxPdfBytes: integer(env, 'MAX_PDF_MB', 100, 1, 256) * 1024 * 1024,
    apiKey: env.API_KEY || '',
  };
}
