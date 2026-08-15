"""Erzeugt die PWA-Icons (abgehakte Liste, Blau/Grün für Business/Privat).

    python tools/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

BG = (27, 31, 38)
BUSINESS = (99, 141, 247)
PRIVAT = (79, 199, 168)
LINE = (58, 63, 73)

OUT = Path(__file__).resolve().parent.parent / "web" / "icons"
SS = 4  # Supersampling für weiche Kanten


def checklist(size, inset_ratio, rounded):
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, s - 1, s - 1], fill=BG)

    pad = s * inset_ratio
    row_h = (s - 2 * pad) / 3
    box = row_h * 0.5
    line_w = max(2, int(s * 0.035))

    colors = [BUSINESS, PRIVAT, LINE]
    for i, color in enumerate(colors):
        y = pad + i * row_h + row_h / 2
        x0 = pad
        # Checkbox
        d.rounded_rectangle(
            [x0, y - box / 2, x0 + box, y + box / 2], radius=box * 0.25, outline=color, width=line_w
        )
        if i < 2:
            d.line(
                [x0 + box * 0.22, y, x0 + box * 0.42, y + box * 0.22, x0 + box * 0.8, y - box * 0.22],
                fill=color,
                width=line_w,
                joint="curve",
            )
        # Textzeile
        lx0 = x0 + box * 1.5
        lx1 = s - pad
        d.line([lx0, y, lx1, y], fill=color, width=line_w)

    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    for size in (192, 512):
        checklist(size, 0.16, rounded=True).save(OUT / f"icon-{size}.png")

    m = Image.new("RGBA", (512, 512), BG)
    m.paste(checklist(512, 0.24, rounded=False), (0, 0))
    m.save(OUT / "icon-maskable-512.png")

    checklist(64, 0.14, rounded=True).save(OUT / "favicon.png")

    for f in sorted(OUT.iterdir()):
        print(f"{f.name}: {f.stat().st_size} bytes")


if __name__ == "__main__":
    main()
