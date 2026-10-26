"""Static TTF cuts of the Timeless fonts for link-preview images (worker/ogRender.ts).

The preview renderer can't read variable WOFF2, so this pins the axes the app uses and writes plain TTFs
to fonts-og/ (git-ignored, like the WOFF2s: the license forbids public repositories). Upload them with
npm run fonts:upload. Needs fontTools with brotli: pip install fonttools brotli
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public/fonts/timeless"
OUT = ROOT / "fonts-og"
JOBS = [
    ("TimelessSerifVF", "TimelessSerif-Light", {"wght": 300, "STYL": 0}),
    ("TimelessSansVF", "TimelessGrotesk-Regular", {"wght": 400, "ital": 0, "STYL": 0}),
    ("TimelessSansVF", "TimelessGrotesk-Medium", {"wght": 500, "ital": 0, "STYL": 0}),
]

OUT.mkdir(exist_ok=True)
for src, name, axes in JOBS:
    font = instantiateVariableFont(TTFont(SRC / f"{src}.woff2"), axes, updateFontNames=False)
    font.flavor = None
    font.save(OUT / f"{name}.ttf")
    print(f"fonts-og/{name}.ttf")
