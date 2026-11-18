import { STORAGE_KEY, TIME_ZONE, DEFAULT_MESSAGES, DESK_QUOTES, timePeriod, normalizePreferences } from './workspace-settings.js';

const byId = id => document.getElementById(id);
let preferences = normalizePreferences();
try { preferences = normalizePreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); } catch { /* Defaults work when browser storage is unavailable. */ }
let quoteIndex = 0;
const dialog = byId('preferences-dialog');
const editor = byId('preferences-form');
const notice = byId('preference-notice');

function quoteList() {
  return preferences.quote.text ? [preferences.quote, ...DESK_QUOTES] : DESK_QUOTES;
}

function renderQuote() {
  const quotes = quoteList();
  quoteIndex = ((quoteIndex % quotes.length) + quotes.length) % quotes.length;
  const quote = quotes[quoteIndex];
  byId('quote-text').textContent = quote.text;
  byId('quote-author').textContent = quote.author;
  byId('quote-count').textContent = `${String(quoteIndex + 1).padStart(2, '0')} / ${String(quotes.length).padStart(2, '0')}`;
}

function renderTime() {
  const date = new Date();
  const actualPeriod = timePeriod(date);
  const theme = preferences.theme === 'auto' ? actualPeriod : preferences.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeMode = preferences.theme;
  byId('time-avatar').src = `/assets/images/avatar-${theme}.svg`;
  byId('time-avatar').alt = `${theme[0].toUpperCase() + theme.slice(1)} sun avatar`;
  const labels = { morning: 'Morning light', midday: 'Midday energy', afternoon: 'Afternoon calm' };
  byId('time-label').textContent = labels[theme];
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  byId('local-clock').textContent = `${time} EAT`;
  byId('local-clock').dateTime = date.toISOString();
  byId('personal-message').textContent = preferences.messages[theme];
  byId('theme-caption').textContent = preferences.theme === 'auto' ? 'In step with your day' : `${theme[0].toUpperCase() + theme.slice(1)} preview`;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta.content = { morning: '#f5f8fa', midday: '#dceaf0', afternoon: '#becddc' }[theme];
}

function fillEditor() {
  editor.elements.theme.value = preferences.theme;
  for (const period of Object.keys(DEFAULT_MESSAGES)) editor.elements[`message-${period}`].value = preferences.messages[period];
  editor.elements['custom-quote'].value = preferences.quote.text;
  editor.elements['quote-author'].value = preferences.quote.text ? preferences.quote.author : '';
  notice.textContent = '';
}

function savePreferences(next) {
  preferences = normalizePreferences(next);
  let persisted = true;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { persisted = false; }
  quoteIndex = 0;
  renderTime();
  renderQuote();
  return persisted;
}

byId('open-preferences').addEventListener('click', () => {
  fillEditor();
  dialog.showModal();
});
byId('close-preferences').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
editor.addEventListener('submit', event => {
  event.preventDefault();
  const persisted = savePreferences({
    theme: editor.elements.theme.value,
    messages: Object.fromEntries(Object.keys(DEFAULT_MESSAGES).map(period => [period, editor.elements[`message-${period}`].value])),
    quote: { text: editor.elements['custom-quote'].value, author: editor.elements['quote-author'].value },
  });
  if (persisted) {
    dialog.close();
    byId('settings-feedback').textContent = 'Your workspace preferences are saved.';
  } else {
    notice.textContent = 'Changes are applied for this visit. Your browser is blocking saved preferences.';
  }
});
byId('reset-preferences').addEventListener('click', () => {
  savePreferences(null);
  fillEditor();
  notice.textContent = 'Default colours and messages restored.';
});
byId('previous-quote').addEventListener('click', () => { quoteIndex--; renderQuote(); });
byId('next-quote').addEventListener('click', () => { quoteIndex++; renderQuote(); });

renderTime();
renderQuote();
setInterval(renderTime, 30_000);
// Quotes change on request so they never move while someone is reading.
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  try { preferences = normalizePreferences(JSON.parse(event.newValue || 'null')); } catch { preferences = normalizePreferences(); }
  quoteIndex = 0;
  renderTime();
  renderQuote();
});
