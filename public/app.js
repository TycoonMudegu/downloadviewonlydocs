const form = document.querySelector('#convert-form');
const input = document.querySelector('#drive-url');
const submit = document.querySelector('#submit-button');
const clear = document.querySelector('#clear-link');
const fieldError = document.querySelector('#field-error');
const result = document.querySelector('#result');
const resultTitle = document.querySelector('#result-title');
const resultDescription = document.querySelector('#result-description');
const cancel = document.querySelector('#cancel-button');
const download = document.querySelector('#download-link');
const elapsed = document.querySelector('#elapsed');
const accessSettings = document.querySelector('#access-settings');
const accessKey = document.querySelector('#access-key');
let controller;
let downloadUrl;
let timer;
let busy = false;

const configuration = fetch('/api/config', { cache: 'no-store' })
  .then(response => {
    if (!response.ok) throw new Error('The service could not be reached. Reload the page and try again.');
    return response.json();
  })
  .then(config => {
    if (config.requiresApiKey) {
      accessSettings.hidden = false;
      accessSettings.open = true;
    }
    return config;
  });
// A failed setup request is reported when submitting, rather than becoming an unhandled rejection.
configuration.catch(() => {});

function showFieldError(message) {
  input.setAttribute('aria-invalid', 'true');
  fieldError.textContent = message;
  fieldError.hidden = false;
  input.focus();
}

function resetFieldError() {
  input.removeAttribute('aria-invalid');
  fieldError.hidden = true;
  fieldError.textContent = '';
}

function setBusy(value) {
  busy = value;
  form.setAttribute('aria-busy', String(value));
  for (const control of [input, submit, clear, accessKey]) control.disabled = value;
  document.querySelector('#button-label').textContent = value ? 'Generating your PDF…' : 'Generate PDF';
  cancel.hidden = !value;
  elapsed.hidden = !value;
}

function showResult(state, title, description) {
  result.dataset.state = state;
  result.hidden = false;
  resultTitle.textContent = title;
  resultDescription.textContent = description;
  download.hidden = state !== 'ready';
}

function releaseDownload() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = undefined;
  download.removeAttribute('href');
  download.hidden = true;
}

function filenameFromResponse(response) {
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* Fall back to the plain attachment name. */ }
  }
  return disposition.match(/filename="([^"]+)"/i)?.[1] || 'document.pdf';
}

input.addEventListener('input', () => {
  resetFieldError();
  clear.hidden = !input.value;
});
clear.addEventListener('click', () => {
  input.value = '';
  clear.hidden = true;
  resetFieldError();
  input.focus();
});
cancel.addEventListener('click', () => controller?.abort());
window.addEventListener('pagehide', () => {
  controller?.abort();
  releaseDownload();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  resetFieldError();
  const url = input.value.trim();
  let parsed;
  try { parsed = new URL(url); } catch { /* Show a readable validation message below. */ }
  if (!parsed || parsed.protocol !== 'https:' || parsed.hostname !== 'drive.google.com') {
    showFieldError('Paste a Google Drive file link beginning with https://drive.google.com/.');
    return;
  }

  releaseDownload();
  controller = new AbortController();
  const signal = controller.signal;
  setBusy(true);
  showResult('processing', 'Preparing your document…', 'We’re loading and preparing every page. Keep this page open.');
  const start = Date.now();
  elapsed.textContent = 'This usually takes a little time. Larger documents may take a few minutes.';
  timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - start) / 1000);
    const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    elapsed.textContent = `${duration} elapsed · Larger documents may take a few minutes.`;
  }, 1000);

  try {
    const config = await configuration;
    if (config.requiresApiKey && !accessKey.value.trim()) {
      accessSettings.hidden = false;
      accessSettings.open = true;
      throw new Error('Enter the access key provided by your administrator, then try again.');
    }
    signal.throwIfAborted();
    const headers = { 'Content-Type': 'application/json' };
    if (config.requiresApiKey) headers.Authorization = `Bearer ${accessKey.value.trim()}`;
    const response = await fetch('/convert', {
      method: 'POST', headers, body: JSON.stringify({ url }), signal,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(typeof error?.error?.message === 'string'
        ? error.error.message : 'We couldn’t process this document. Please try again.');
    }
    const blob = await response.blob();
    if (await blob.slice(0, 5).text() !== '%PDF-') throw new Error('The service did not return a complete PDF. Please try again.');
    signal.throwIfAborted();
    const filename = filenameFromResponse(response);
    const pages = Number(response.headers.get('x-pdf-page-count'));
    const size = blob.size < 1024 * 1024 ? `${Math.max(1, Math.round(blob.size / 1024))} KB` : `${(blob.size / (1024 * 1024)).toFixed(1)} MB`;
    downloadUrl = URL.createObjectURL(blob);
    download.href = downloadUrl;
    download.download = filename;
    showResult('ready', 'Your PDF is ready.', `${filename}${pages > 0 ? ` · ${pages} ${pages === 1 ? 'page' : 'pages'}` : ''} · ${size}`);
    // Keep a visible download link available if the browser blocks automatic saving.
    download.click();
    download.focus();
  } catch (error) {
    if (signal.aborted) {
      showResult('cancelled', 'Conversion cancelled.', 'Your link is still here. You can try again whenever you’re ready.');
    } else {
      showResult('error', 'We couldn’t prepare this document.', error instanceof TypeError ? 'The connection was interrupted. Check your connection and try again.' : error.message);
    }
  } finally {
    clearInterval(timer);
    timer = undefined;
    controller = undefined;
    setBusy(false);
    if (!accessSettings.hidden && !accessKey.value) accessKey.focus();
  }
});
