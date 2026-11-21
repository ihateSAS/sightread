#!/usr/bin/env python3
"""Derive a unique background from the attached starfield/streak photo.

Not a rescale of the original: mirrored, recropped, reduced to a blue duotone,
softened, vignetted and grained. The red/orange band is intentionally dropped so
the result reads as its own image.
"""
from PIL import Image, ImageOps, ImageFilter, ImageDraw, ImageChops
import os

SRC = "/Users/djh/Desktop/home/.cloud-attachments/debfa3747bd195ca7ccc1532a4ed335948e9e48665d2b5dfda207fa60e19ba61.webp"
LOGO = "/Users/djh/Desktop/home/kimi-hackathon/logo/sightread-icon.png"
OUT = "/Users/djh/Desktop/home/kimi-hackathon/app/public/bg.webp"
OUT_ALT = "/Users/djh/Desktop/home/kimi-hackathon/app/public/bg.jpg"


def sample_accent(path):
    """Most common strongly-blue pixel in the logo — the blob colour."""
    im = Image.open(path).convert("RGB").resize((200, 200))
    best = {}
    for r, g, b in im.getdata():
        if b > 120 and b - r > 60 and b - g > 30 and g > r:
            best[(r // 8 * 8, g // 8 * 8, b // 8 * 8)] = best.get((r // 8 * 8, g // 8 * 8, b // 8 * 8), 0) + 1
    if not best:
        return (30, 123, 245)
    (r, g, b), _ = max(best.items(), key=lambda kv: kv[1])
    return (r + 4, g + 4, b + 4)


accent = sample_accent(LOGO)
print("accent sampled from logo: #%02x%02x%02x" % accent)

src = Image.open(SRC).convert("RGB")
W, H = src.size
print("source:", W, "x", H)

# 1. mirror — the composition is no longer the borrowed one
img = ImageOps.mirror(src)

# 2. recrop: take the middle band, off-centre, so the curve sits right of centre
cw, ch = int(W * 0.78), int(H * 0.62)
left = int(W * 0.10)
top = int(H * 0.16)
img = img.crop((left, top, left + cw, top + ch))

# 3. target 16:9 at 2x for crispness on retina
TW, TH = 2560, 1440
img = ImageOps.fit(img, (TW, TH), method=Image.LANCZOS, centering=(0.55, 0.62))

# 4. blue duotone: kill the original colour entirely
gray = ImageOps.grayscale(img)
# levels: lift the black point so the empty space goes truly black
BLACK_POINT, WHITE_POINT = 58, 252
span = WHITE_POINT - BLACK_POINT
gray = gray.point(lambda v: int(min(255, max(0, v - BLACK_POINT) * (255 / span))))
img = ImageOps.colorize(gray, black=(3, 5, 10), white=(228, 240, 255))

# 5. let the accent tint the bright core, so the image belongs to the brand
tint = Image.new("RGB", (TW, TH), accent)
img = Image.blend(img, ImageChops.multiply(img, tint), 0.18)

# crush the midtones: the streak should glow out of black, not sit on grey
img = Image.eval(img, lambda v: int(255 * ((v / 255) ** 1.55)))

# 6. soften — background must never compete with the type
img = img.filter(ImageFilter.GaussianBlur(1.6))

# 7. darken toward the edges so the centre column stays readable
vig = Image.radial_gradient("L").resize((TW, TH))
vig = vig.point(lambda v: int(96 + (v / 255) * 159))
img = ImageChops.multiply(img, Image.merge("RGB", (vig, vig, vig)))

# 8. push the whole thing down in luminance; the page adds its own contrast
img = Image.eval(img, lambda v: int(v * 0.78))

# 9. fine grain so gradients don't band in video compression
# noise is centred on 128, so offset by -128: the grain adds ~0, not mid-grey
noise = Image.effect_noise((TW, TH), 5).convert("L")
noise_rgb = Image.merge("RGB", (noise, noise, noise))
img = ImageChops.add(img, noise_rgb, scale=1.0, offset=-128)

# 10. fade to near-black at the very bottom for the footer / type
fade = Image.new("L", (1, TH))
for y in range(TH):
    t = y / TH
    fade.putpixel((0, y), int(255 * (1 - max(0.0, (t - 0.80) / 0.20) ** 1.7)))
fade = fade.resize((TW, TH))
img = Image.composite(img, Image.new("RGB", (TW, TH), (4, 6, 10)), fade)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.save(OUT, "WEBP", quality=82, method=6)
img.save(OUT_ALT, "JPEG", quality=82, optimize=True, progressive=True)
print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
print("wrote", OUT_ALT, os.path.getsize(OUT_ALT) // 1024, "KB")
