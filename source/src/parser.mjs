// Parsers return only facts present in the reservation. Missing values stay empty.
export const fields = ['name', 'arrival', 'departure', 'guestCount', 'room', 'price', 'phone', 'email', 'country', 'identity', 'car', 'floor'];
export function emptyReservation() {
  return Object.fromEntries(fields.map(key => [key, '']));
}
export function languageFromPhone(phone = '') {
  const value = phone.trim().replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (!/^\+\d{7,15}$/.test(value)) return 'pl';
  if (value.startsWith('+420')) return 'cze';
  if (value.startsWith('+49')) return 'deu';
  if (value.startsWith('+48')) return 'pl';
  // Recognised international calling codes. Unknown prefixes keep the Polish default.
  const codes = '1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 246 247 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 380 381 382 383 385 386 387 389 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 598 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 850 852 853 855 856 880 886 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998'.split(' ');
  return codes.some(code => value.startsWith(`+${code}`)) ? 'eng' : 'pl';
}

export function isoDate(raw) {
  const m = String(raw || '').match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return '';
  const [, day, month, year] = m;
  const date = new Date(Date.UTC(+year, +month - 1, +day));
  if (date.getUTCFullYear() !== +year || date.getUTCMonth() !== +month - 1 || date.getUTCDate() !== +day) return '';
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function money(raw) {
  const s = String(raw || '').replace(/\s|zł|PLN/gi, '');
  if (!s || !/^[\d.,]+$/.test(s)) return '';
  let value = s;
  if (s.includes(',')) value = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) value = s.replace(/\./g, '');
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number.toFixed(2) : '';
}

const months = { stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6, lipca: 7, sierpnia: 8, 'września': 9, 'października': 10, listopada: 11, grudnia: 12 };
function dateParts(day, month, year) { return isoDate(`${day}.${month}.${year}`); }
function clean(value = '') { return /^(?:null|undefined|[-–—.]*)$/i.test(value.trim()) ? '' : value.trim(); }
function match(text, regex) { return clean(text.match(regex)?.[1] || ''); }

export function parseReservation(text, sourceName = '') {
  const raw = String(text || '').replace(/\u00a0/g, ' ').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const record = { ...emptyReservation(), sourceName, language: 'pl', languageMode: 'auto', reservationNumber: '', preliminary: false, warnings: [], rawText: raw };
  if (raw.replace(/\s/g, '').length < 25) {
    record.warnings.push('Brak warstwy tekstowej PDF. To może być skan — uzupełnij dane ręcznie. OCR nie jest dostępny w tej wersji.');
    return record;
  }
  const numbers = [...raw.matchAll(/(?:rezerwacji|rezerwację)\s+nr\s+([\w/-]+)/gi)].map(m => m[1]);
  if (new Set(numbers).size > 1) {
    record.warnings.push('W tym PDF znaleziono kilka numerów rezerwacji. Podziel plik na osobne potwierdzenia lub uzupełnij jeden wpis ręcznie.');
    return record;
  }
  record.reservationNumber = numbers[0] || '';
  record.preliminary = /Wstępne\s+potwierdzenie|potwierdzamy\s+wstępnie/i.test(raw);
  const start = raw.search(/(?:^|\n)\s*(?:Dla\s*:|Pani?\s*:|Pan\s*:)/i);
  const guestText = start >= 0 ? raw.slice(start) : '';
  const contact = guestText.split(/Mamy przyjemność|Potwierdzamy|Szanown[ayie]/i)[0];
  record.name = match(contact, /(?:^|\n)\s*(?:Dla|Pani|Pan)\s*:[ \t]*\n?[ \t]*([^\n]+)/i);
  record.phone = match(contact, /(?:^|\n)\s*(?:tel\.?|telefon)\s*:[ \t]*([^\n]*)/i);
  if (!/^[+\d][\d\s().-]{5,}$/.test(record.phone)) record.phone = '';
  record.email = match(contact, /([\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[A-Za-z]{2,})/);
  record.arrival = isoDate(match(raw, /Przyjazd w dniu\s*:[ \t\n]*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i));
  record.departure = isoDate(match(raw, /Wyjazd w dniu\s*:[ \t\n]*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i));
  record.guestCount = match(raw, /Liczba gości\s*:[ \t\n]*(\d+)\b/i);
  record.room = match(raw, /Nr pokoju\s*:[ \t\n]*([\w/-]+)/i);
  record.price = money(match(raw, /Koszt pobytu\s*:[ \t\n]*([\d][\d .,]*)/i));
  if (!record.price) record.price = money(match(raw, /Łączna wartość usługi\s*[-–—:]\s*([\d][\d .,]*)/i));
  if (!record.arrival || !record.departure) {
    const stay = raw.match(/w terminie\s+(\d{1,2})\s*(?:[-–—]\s*)(\d{1,2})\s+([\p{L}]+)\s+(\d{4})/iu);
    const across = raw.match(/w terminie\s+(\d{1,2})\s+([\p{L}]+)(?:\s+(\d{4}))?\s*[-–—]\s*(\d{1,2})\s+([\p{L}]+)\s+(\d{4})/iu);
    const numeric = raw.match(/w terminie\s+(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s*[-–—]\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i);
    if (numeric) [record.arrival, record.departure] = [isoDate(numeric[1]), isoDate(numeric[2])];
    else if (across) {
      const startYear = across[3] || (+months[across[2].toLowerCase()] > +months[across[5].toLowerCase()] ? +across[6] - 1 : across[6]);
      record.arrival = dateParts(across[1], months[across[2].toLowerCase()], startYear);
      record.departure = dateParts(across[4], months[across[5].toLowerCase()], across[6]);
    } else if (stay && months[stay[3].toLowerCase()]) {
      record.arrival = dateParts(stay[1], months[stay[3].toLowerCase()], stay[4]);
      record.departure = dateParts(stay[2], months[stay[3].toLowerCase()], stay[4]);
    }
  }
  record.language = languageFromPhone(record.phone);
  return record;
}

export function validationMessages(record) {
  const warnings = [...(record.warnings || [])];
  if (record.preliminary) warnings.push('To jest wstępne potwierdzenie. Aktualny status rezerwacji wymaga sprawdzenia.');
  for (const [key, label] of [['name', 'imię i nazwisko'], ['arrival', 'data przyjazdu'], ['departure', 'data wyjazdu'], ['guestCount', 'liczba gości']]) {
    if (!record[key]) warnings.push(`Brak danych: ${label}. Pole pozostanie puste.`);
  }
  if (record.arrival && record.departure && record.departure <= record.arrival) warnings.push('Data wyjazdu musi być późniejsza od daty przyjazdu.');
  if (record.guestCount && (!/^\d+$/.test(record.guestCount) || +record.guestCount < 1)) warnings.push('Liczba gości musi być dodatnią liczbą całkowitą.');
  if (record.price && (!Number.isFinite(Number(record.price)) || Number(record.price) < 0)) warnings.push('Cena musi być nieujemną liczbą.');
  return warnings;
}
