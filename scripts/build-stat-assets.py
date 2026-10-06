from pathlib import Path
from PIL import Image

assets = Path(__file__).resolve().parents[1] / 'public' / 'assets'
for source, target in [('warning.png', 'stat-warning.webp'), ('red-arrow-small.png', 'stat-arrow.webp'), ('coin-faded.png', 'stat-coin.webp')]:
    image = Image.open(assets / source).convert('RGBA')
    image.thumbnail((320, 320), Image.Resampling.LANCZOS)
    image.save(assets / target, 'WEBP', quality=90, method=6)
