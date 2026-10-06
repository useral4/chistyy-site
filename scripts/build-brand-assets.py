from pathlib import Path
import base64
from PIL import Image, ImageDraw

public = Path(__file__).resolve().parents[1] / 'public'
logo = Image.open(public / 'assets' / 'kinavapro-logo.png').convert('RGBA')
glyph = logo.crop((0, 0, 68, 103))

def icon(size):
    canvas = Image.new('RGBA', (size, size))
    ImageDraw.Draw(canvas).rounded_rectangle((0, 0, size - 1, size - 1), radius=size // 5, fill='#1b1b1b')
    mark = glyph.copy()
    mark.thumbnail((round(size * .66), round(size * .72)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas

icon(64).save(public / 'favicon.png')
icon(180).save(public / 'apple-touch-icon.png')
icon(64).save(public / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
data = base64.b64encode((public / 'favicon.png').read_bytes()).decode('ascii')
(public / 'favicon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,' + data + '"/></svg>\n', encoding='utf-8')
