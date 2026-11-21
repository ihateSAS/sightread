#!/usr/bin/env python3
"""Generate a resolution-independent background: streaking light arcs over black.

Vector on purpose. The earlier version upscaled a 1600px photo to 4K and blurred
it, which is why it looked soft. This is drawn as SVG, so it is sharp at 4K, 8K,
retina, or any size, and weighs a fraction of the raster.
"""
import math
import random

W, H = 3840, 2160
CX, CY = 2540, 1080          # where the arcs converge
TILT = -17                   # degrees, the sweep direction
ACCENT = "#047cfc"
random.seed(7)

parts = []
parts.append(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
    f'width="{W}" height="{H}" preserveAspectRatio="xMidYMid slice">'
)
parts.append(f"""<defs>
  <radialGradient id="pool" cx="66%" cy="50%" r="58%">
    <stop offset="0%" stop-color="{ACCENT}" stop-opacity="0.40"/>
    <stop offset="38%" stop-color="#1b5fbe" stop-opacity="0.20"/>
    <stop offset="72%" stop-color="#08111f" stop-opacity="0.06"/>
    <stop offset="100%" stop-color="#05070b" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="core" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.05"/>
    <stop offset="42%" stop-color="#e8f2ff" stop-opacity="0.95"/>
    <stop offset="72%" stop-color="#9fc8ff" stop-opacity="0.65"/>
    <stop offset="100%" stop-color="#3f7fd6" stop-opacity="0.18"/>
  </linearGradient>
  <linearGradient id="halo" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="#8fbcff" stop-opacity="0"/>
    <stop offset="55%" stop-color="#a9ccff" stop-opacity="0.30"/>
    <stop offset="100%" stop-color="#3d6ea8" stop-opacity="0.05"/>
  </linearGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
    <stop offset="52%" stop-color="#05070b" stop-opacity="0"/>
    <stop offset="86%" stop-color="#05070b" stop-opacity="0.82"/>
    <stop offset="100%" stop-color="#05070b" stop-opacity="1"/>
  </linearGradient>
</defs>""")

parts.append(f'<rect width="{W}" height="{H}" fill="#05070b"/>')
parts.append(f'<rect width="{W}" height="{H}" fill="url(#pool)"/>')

# ---- starfield: crisp dots, brighter near the arcs ----
stars = []
for _ in range(620):
    x = random.uniform(0, W)
    y = random.uniform(0, H)
    d = math.hypot((x - CX) / W, (y - CY) / H)
    o = max(0.03, 0.55 - d * 0.85) * random.uniform(0.35, 1.0)
    r = random.choice([0.9, 0.9, 1.2, 1.2, 1.6, 2.1])
    stars.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="#cfe2ff" opacity="{o:.3f}"/>')
parts.append('<g id="stars">' + "".join(stars) + "</g>")

# ---- the arcs: nested ellipses sharing a focus ----
parts.append(f'<g transform="rotate({TILT} {CX} {CY})" fill="none" stroke-linecap="round">')
for i in range(54):
    rx = 420 + i * 47 + random.uniform(-14, 14)
    ry = rx * random.uniform(0.19, 0.245)
    width = 0.8 + (1 - i / 54) * 3.4 + random.uniform(-0.3, 0.5)
    width = max(0.7, width)

    # the innermost arcs are the hot core; the rest recede into the dark
    if i < 9:
        stroke, op = "url(#core)", min(0.95, 0.92 - i * 0.075)
    elif i < 20:
        stroke, op = "url(#core)", 0.42 - (i - 9) * 0.028
    else:
        stroke, op = "url(#halo)", max(0.03, 0.20 - (i - 20) * 0.006)

    start = random.uniform(96, 128)
    end = start + random.uniform(200, 300)
    parts.append(
        f'<ellipse cx="{CX}" cy="{CY}" rx="{rx:.1f}" ry="{ry:.1f}" '
        f'stroke="{stroke}" stroke-width="{width:.2f}" opacity="{op:.3f}" '
        f'stroke-dasharray="none"/>'
    )

    # a few broken fragments so the rings don't read as mechanical
    if i % 4 == 1:
        seg = random.uniform(18, 46)
        parts.append(
            f'<ellipse cx="{CX}" cy="{CY}" rx="{rx:.1f}" ry="{ry:.1f}" '
            f'stroke="{stroke}" stroke-width="{width * 1.6:.2f}" opacity="{max(0.05, op * 0.75):.3f}" '
            f'stroke-dasharray="{seg:.0f} {random.uniform(220, 520):.0f}" '
            f'stroke-dashoffset="{random.uniform(0, 360):.0f}"/>'
        )
parts.append("</g>")

# ---- horizon glow under the arcs, then fade to black ----
parts.append(f'<ellipse cx="{CX - 300}" cy="{CY + 210}" rx="1850" ry="150" fill="url(#pool)" opacity="0.85"/>')
parts.append(f'<rect width="{W}" height="{H}" fill="url(#floor)"/>')
parts.append("</svg>")

svg = "\n".join(parts)
out = "/Users/djh/Desktop/home/kimi-hackathon/app/public/bg.svg"
with open(out, "w") as f:
    f.write(svg)
print("wrote", out, len(svg) // 1024, "KB (vector — sharp at any size)")
