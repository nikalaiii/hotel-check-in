"""Optional development tool: render hotel DOCX cards for prepare-templates.py.
Requires Python + lxml + PyMuPDF and LibreOffice on PATH. Not used by the app.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'template-build/cards'
OUT.mkdir(parents=True, exist_ok=True)
SOFFICE = shutil.which('soffice') or shutil.which('libreoffice')
if not SOFFICE:
    raise SystemExit('Install LibreOffice and add soffice to PATH.')
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006', 'a': 'http://schemas.openxmlformats.org/drawingml/2006/main', 'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
with tempfile.TemporaryDirectory() as temporary:
    tmp = Path(temporary)
    for source in (ROOT / 'templates/source').glob('*Karta*.docx'):
        target = tmp / source.name
        with ZipFile(source) as original, ZipFile(target, 'w', ZIP_DEFLATED) as compact:
            for name in original.namelist():
                data = original.read(name)
                if name in ['word/document.xml', 'word/styles.xml']:
                    tree = etree.fromstring(data)
                    for el in tree.xpath('//w:sz | //w:szCs', namespaces=NS):
                        key = '{' + NS['w'] + '}val'
                        el.set(key, str(max(16, round(int(el.get(key)) * 0.88))))
                    for alt in tree.xpath('//mc:AlternateContent', namespaces=NS):
                        ext = alt.xpath('.//wp:extent', namespaces=NS)
                        if alt.xpath('.//a:prstGeom[@prst="rect"]', namespaces=NS) and ext and int(ext[0].get('cx')) < 350000 and int(ext[0].get('cy')) < 350000:
                            alt.getparent().remove(alt)
                    data = etree.tostring(tree, xml_declaration=True, encoding='UTF-8', standalone=True)
                compact.writestr(name, data)
        subprocess.run([SOFFICE, '-env:UserInstallation=' + (tmp / 'profile').as_uri(), '--headless', '--convert-to', 'pdf', '--outdir', str(OUT), str(target)], check=True)
        if not (OUT / (source.stem + '.pdf')).exists():
            raise RuntimeError('No PDF generated for ' + source.name)
print('Next: python scripts/prepare-templates.py')
