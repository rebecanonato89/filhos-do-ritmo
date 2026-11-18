"""Prepara as fotos antes de subir para a VPS.

Remove EXIF (fotos de celular trazem GPS = localização das crianças), corrige a rotação
e reduz para no máximo 900px. Uso: python3 scripts/prepare_photos.py <entrada> <saida>
"""
import sys
from pathlib import Path
from PIL import Image, ImageOps

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
for f in sorted(src.iterdir()):
    if f.suffix.lower() not in {".jpg", ".jpeg", ".png", ".heic", ".webp"}:
        continue
    im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
    im.thumbnail((900, 900))
    out = dst / (f.stem + ".jpg")
    im.save(out, "JPEG", quality=82)  # salvar sem exif= descarta todos os metadados
    print(out.name)
