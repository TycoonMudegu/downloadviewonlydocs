export const STORAGE_KEY = 'hummingbird-workspace-v1';
export const TIME_ZONE = 'Africa/Nairobi';
export const THEMES = ['auto', 'morning', 'midday', 'afternoon'];
export const DEFAULT_MESSAGES = {
  morning: 'A fresh page. A fresh start. Let’s make something good.',
  midday: 'A little less admin. A little more room for your ideas.',
  afternoon: 'A softer pace. The same good work. You’ve got this.',
};

// Original office humour written for this tool; these are not attributed to public figures.
export const DESK_QUOTES = [
  { text: 'I have a filing system. It’s called ‘Downloads’.', author: 'The Hummingbird desk' },
  { text: 'Behind every great lesson is a tab someone forgot to close.', author: 'The Hummingbird desk' },
  { text: 'Today’s forecast: a 100% chance of ‘just one more page’.', author: 'The Hummingbird desk' },
  { text: 'My printer and I are taking some space. It started the paper jam.', author: 'The Hummingbird desk' },
  { text: 'A PDF a day keeps ‘where did I save that?’ slightly further away.', author: 'The Hummingbird desk' },
  { text: 'Teaching: where coffee becomes lesson plans.', author: 'The Hummingbird desk' },
];

export function timePeriod(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23',
  }).format(date));
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 15) return 'midday';
  return 'afternoon';
}

export function normalizePreferences(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const shortText = (text, max, fallback = '') => typeof text === 'string' ? text.trim().slice(0, max) || fallback : fallback;
  return {
    theme: THEMES.includes(input.theme) ? input.theme : 'auto',
    messages: Object.fromEntries(Object.entries(DEFAULT_MESSAGES).map(([period, fallback]) => [period, shortText(input.messages?.[period], 160, fallback)])),
    quote: {
      text: shortText(input.quote?.text, 220),
      author: shortText(input.quote?.author, 60, 'Your desk'),
    },
  };
}
