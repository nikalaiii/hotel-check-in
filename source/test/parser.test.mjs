import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReservation, languageFromPhone, isoDate, money } from '../src/parser.mjs';
import { buildDocument } from '../src/documents.mjs';

test('language follows the agreed prefix rules including missing and unrecognised prefixes', () => {
  for (const [phone, expected] of [['+420 777 123 456', 'cze'], ['0049 170 1234567', 'deu'], ['+48 (660) 350-606', 'pl'], ['+380 67 123 45 67', 'eng'], ['+44 20 1234 5678', 'eng'], ['660350606', 'pl'], ['', 'pl'], ['+999123456789', 'pl'], ['+420', 'pl']]) assert.equal(languageFromPhone(phone), expected, phone);
});
test('does not infer occupancy from room capacity or confuse hotel contact with guest contact', () => {
  const r = parseReservation('Hotel tel.: +48757445577\nEmail: hotel@example.com\nPani: Test Guest\ntel. \ne-mail: guest@example.com\nPotwierdzamy rezerwację w terminie 7 – 11 listopada 2026\n1 x pok. 2-osobowy STANDARD\nŁączna wartość usługi – 1.425 zł');
  assert.equal(r.phone, ''); assert.equal(r.guestCount, ''); assert.equal(r.room, '');
  assert.equal(r.email, 'guest@example.com'); assert.equal(r.arrival, '2026-11-07'); assert.equal(r.price, '1425.00');
});
test('date validation and Polish money formats', () => {
  assert.equal(isoDate('31.02.2026'), ''); assert.equal(isoDate('29.02.2028'), '2028-02-29');
  assert.equal(money('2 081,70'), '2081.70'); assert.equal(money('1.425'), '1425.00');
});
test('December to January uses the previous start year when omitted', () => {
  const r = parseReservation('Pani: Test Guest\nPotwierdzamy pokoje w terminie 30 grudnia – 2 stycznia 2027\n');
  assert.equal(r.arrival, '2026-12-30'); assert.equal(r.departure, '2027-01-02');
});
test('scan and multi-booking file do not silently produce a combined guest', () => {
  assert.ok(parseReservation('').warnings[0].includes('OCR'));
  const r = parseReservation('Potwierdzenie rezerwacji nr 1/2026\nDla: Test One\nPotwierdzenie rezerwacji nr 2/2026\nDla: Test Two');
  assert.equal(r.name, ''); assert.ok(r.warnings[0].includes('kilka'));
});
test('HTML output escapes guest data and skips unavailable templates explicitly', () => {
  const { html, skipped, pageCount } = buildDocument([{ name: '<img src=x onerror=alert(1)>', language: 'eng' }], { card: true, info: true });
  assert.equal(pageCount, 1); assert.equal(skipped.length, 1); assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img src=x'));
});
