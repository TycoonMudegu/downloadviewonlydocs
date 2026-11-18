import test from 'node:test';
import assert from 'node:assert/strict';
import { timePeriod, normalizePreferences, DEFAULT_MESSAGES } from '../public/workspace-settings.js';

test('daytime colours follow Nairobi time at each boundary, independent of host timezone', () => {
  const cases = [
    ['2026-11-18T01:59:00Z', 'afternoon'],
    ['2026-11-18T02:00:00Z', 'morning'],
    ['2026-11-18T08:59:00Z', 'morning'],
    ['2026-11-18T09:00:00Z', 'midday'],
    ['2026-11-18T11:59:00Z', 'midday'],
    ['2026-11-18T12:00:00Z', 'afternoon'],
    ['2026-11-18T22:00:00Z', 'afternoon'],
  ];
  for (const [date, expected] of cases) assert.equal(timePeriod(new Date(date)), expected, date);
});

test('corrupt or missing saved preferences fall back to safe defaults', () => {
  for (const value of [null, undefined, [], 'invalid', {theme:'dark', messages:{morning:123}}]) {
    const result=normalizePreferences(value);
    assert.equal(result.theme,'auto');
    assert.deepEqual(result.messages,DEFAULT_MESSAGES);
    assert.equal(result.quote.text,'');
  }
});

test('saved text is bounded, preserves messages, and excludes unrelated data', () => {
  const prefs=normalizePreferences({theme:'morning',messages:{morning:'  Hello!  ',midday:'x'.repeat(200)},quote:{text:'y'.repeat(300),author:'z'.repeat(100)},apiKey:'do-not-store'});
  assert.equal(prefs.theme,'morning');
  assert.equal(prefs.messages.morning,'Hello!');
  assert.equal(prefs.messages.midday.length,160);
  assert.equal(prefs.quote.text.length,220);
  assert.equal(prefs.quote.author.length,60);
  assert.equal('apiKey' in prefs,false);
});
