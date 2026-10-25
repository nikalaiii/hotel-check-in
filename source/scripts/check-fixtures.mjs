import { readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parsePdfFile } from '../src/pdf.mjs';

const directory = process.env.CHECKIN_FIXTURES || '../upload';
const expected = {
  '1069/2026': { name: 'Tymes Beata', arrival: '2026-10-19', departure: '2026-10-22', guestCount: '1', room: '34', price: '930.00', phone: '+48660350606', language: 'pl' },
  '1274/2026': { name: 'Jabłecka Julia', arrival: '2026-10-21', departure: '2026-10-27', guestCount: '2', room: '35', price: '2081.70', phone: '', language: 'pl', preliminary: true },
  individual: { name: 'Magdalena Orczykowska', arrival: '2026-11-07', departure: '2026-11-11', guestCount: '', room: '', price: '1425.00', phone: '', language: 'pl', email: 'mago1@poczta.onet.pl' },
};
let tested = 0;
for (const name of await readdir(directory)) {
  if (!name.endsWith('.pdf')) continue;
  const { record } = await parsePdfFile(path.join(directory, name));
  const values = expected[record.reservationNumber || 'individual'];
  assert.ok(values, 'Unrecognised fixture');
  for (const [key, value] of Object.entries(values)) assert.equal(record[key], value, `${key} in ${name}`);
  tested++;
  console.log(`PASS: ${record.reservationNumber || 'individual'} — fields verified`);
}
assert.equal(tested, 3, 'Expected three supplied PDFs');
