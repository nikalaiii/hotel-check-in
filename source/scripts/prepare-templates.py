"""One-time preparation of hotel-owned templates. Not required on reception PCs.

Reads original DOCX text and already rendered compact guest cards.
Card text and consent checkboxes are preserved; only font sizes were compacted
to fit one A4 sheet. All runtime backgrounds are vector SVG, with no Office dependency.
"""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree
import pymupdf
import json
import re
import argparse

ROOT = Path(__file__).resolve().parents[1]
arguments = argparse.ArgumentParser()
arguments.add_argument('--originals', type=Path, default=ROOT / 'templates/source')
arguments.add_argument('--rendered-cards', type=Path, default=ROOT / 'template-build/cards')
ARGS = arguments.parse_args()
OUT = ROOT / 'templates'
OUT.mkdir(exist_ok=True)
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

def paragraphs(p):
    with ZipFile(p) as z:
        tree = etree.fromstring(z.read('word/document.xml'))
    texts = []
    for el in tree.xpath('//w:p', namespaces=NS):
        parts = [node.text or '' if node.tag.endswith('}t') else '\n' if node.tag.endswith('}br') else ' ' for node in el.xpath('.//w:t | .//w:br | .//w:tab', namespaces=NS)]
        text = ''.join(parts).strip()
        if text and set(text) != {'_'}:
            if texts and text == texts[0]:
                break  # only one copy of a repeated printout
            texts.append(text)
    return list(dict.fromkeys(texts))

catalog = {'cards': {}, 'info': {}, 'privacy': {}, 'notes': [
    'Karty meldunkowe przygotowano z dostarczonych dokumentów. Układ i tekst zachowano, zmniejszając czcionkę, aby każda karta mieściła się na jednej stronie A4.',
    'Informacje dla gości i klauzule danych osobowych mają uproszczony układ; powtarzające się kopie usunięto. Tekst pochodzi z dostarczonych plików.',
    'Brak informacji dla gości po angielsku i pełnej klauzuli danych osobowych po polsku.',
    'Czeski wariant bez restauracji w źródle nadal zawiera informację o restauracji. Treści nie zmieniono; sprawdź ją przed użyciem.'
]}
bottom_labels = {
    'pl': ['Data przyjazdu:', 'Data wyjazdu:', 'Numer pokoju:', 'Cena za pobyt:', 'Liczba osób w pokoju:'],
    'cze': ['Datum příjezdu:', 'Datum odjezdu:', 'Číslo pokoje:', 'Cena za pobyt:', 'Počet osob v pokoji:'],
    'eng': ['Check in:', 'Check out:', 'Room number:', 'Price of  all stay:', 'Number of persons in the room:'],
    'deu': ['Anreise:', 'Abreise:', 'Zimmernummer:', 'Der Wert des Aufenthalts:', 'Personen im Zimmer:'],
}
for source in ARGS.rendered_cards.rglob('*.pdf'):
    name = source.name
    lang = next(lang for lang, token in [('pl', 'SOM PL'), ('cze', 'SOM CZE'), ('eng', 'SOM_'), ('deu', 'DEU')] if token in name)
    doc = pymupdf.open(source)
    assert len(doc) == 1, source
    page = doc[0]
    svg_name = f'card-{lang}.svg'
    # Original floating checkbox shapes were removed from the compact DOCX;
    # draw two aligned blank boxes at the actual consent lines instead.
    consent_starts = {'pl': ['Wyrażam zgodę na przesyłanie', 'Wyrażam zgodę na przekazanie'], 'cze': ['Souhlasím s tím', 'Souhlasím s předáním'], 'eng': ['I agree to send', 'I agree to give'], 'deu': ['Ich stimme zu, dass', 'Ich stimme zu, meine']}
    for label in consent_starts[lang]:
        found = page.search_for(label)
        assert found, (lang, label)
        rect = found[0]
        page.draw_rect(pymupdf.Rect(51, rect.y0 + 1, 61, rect.y0 + 11), color=(0, 0, 0), width=0.6)
    svg = page.get_svg_image(text_as_path=True)
    # MuPDF reuses glyph IDs across PDFs. Namespace every SVG to prevent a
    # multilingual batch from rendering later cards with the first card's glyphs.
    svg = re.sub(r'id="([^"]+)"', lambda m: f'id="{lang}-{m[1]}"', svg)
    svg = svg.replace('href="#', f'href="#{lang}-').replace('url(#', f'url(#{lang}-')
    (OUT / svg_name).write_text(svg, encoding='utf-8')
    # Recover cell boundaries directly from the rendered vector grid.
    horizontals = sorted(set(round(d['rect'].y0, 2) for d in page.get_drawings() if 150 < d['rect'].y0 < 370 and d['rect'].width > 450 and d['rect'].height < 1))
    assert len(horizontals) == 7, (lang, horizontals)
    verticals = [d['rect'].x0 for d in page.get_drawings() if d['rect'].height > 100 and d['rect'].width < 1 and 180 < d['rect'].x0 < 300]
    divider = min(verticals) if verticals else (212.5 if lang in ['pl', 'cze'] else 217)
    overlay = []
    for i, field in enumerate(['name', 'country', 'identity', 'car', 'email', 'phone']):
        overlay.append({'field': field, 'x': round(divider + 5, 2), 'y': horizontals[i] + 2, 'width': round(544 - divider - 10, 2), 'height': round(horizontals[i + 1] - horizontals[i] - 4, 2), 'kind': 'cell'})
    words = page.get_text('words')
    for field, label in zip(['arrival', 'departure', 'room', 'price', 'guestCount'], bottom_labels[lang]):
        rects = page.search_for(label)
        assert rects, (lang, label)
        label_rect = rects[0]
        candidates = [w for w in words if '_' in w[4] and w[0] >= label_rect.x1 - 2 and abs(w[1] - label_rect.y0) < 3]
        word = min(candidates, key=lambda w: w[0])
        overlay.append({'field': field, 'x': word[0], 'y': word[1] - 1, 'width': word[2] - word[0], 'height': 14, 'kind': 'line'})
    catalog['cards'][lang] = {'file': svg_name, 'width': page.rect.width, 'height': page.rect.height, 'fields': overlay, 'source': name.replace('.pdf', '.docx')}

for source in ARGS.originals.glob('ZAM*.docx'):
    name = source.name
    if 'INFORMACJE DLA' in name:
        lang = 'cze' if '[CZE]' in name else 'deu' if '[DEU]' in name else 'pl'
        variant = 'no-restaurant' if 'I RESTAURACJI' in name else 'no-dinner' if 'BEZ OBIADOKOLACJI' in name else 'standard'
        catalog['info'].setdefault(lang, {})[variant] = {'paragraphs': paragraphs(source), 'source': name}
    elif 'Pełna' in name:
        lang = 'cze' if ' CZ_' in name else 'deu' if ' DEU_' in name else 'eng'
        catalog['privacy'][lang] = {'paragraphs': paragraphs(source), 'source': name}
(OUT / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
print('Prepared', len(catalog['cards']), 'cards,', sum(len(v) for v in catalog['info'].values()), 'information sheets and', len(catalog['privacy']), 'privacy sheets.')
