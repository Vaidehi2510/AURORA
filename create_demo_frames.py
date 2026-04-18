"""
Generate synthetic CCTV-style demo frames for AURORA vision pipeline.
80 normal frames + 20 anomaly frames (person near electrical panel).
"""

from PIL import Image, ImageDraw, ImageFilter
import os, random, math

os.makedirs("demo_frames/normal", exist_ok=True)
os.makedirs("demo_frames/anomaly", exist_ok=True)

W, H = 640, 480

def draw_facility_background(draw, seed=0):
    random.seed(seed)
    # Floor
    draw.rectangle([0, 350, W, H], fill=(45, 45, 45))
    # Back wall
    draw.rectangle([0, 0, W, 350], fill=(62, 62, 62))
    # Wall panels / equipment racks
    draw.rectangle([60, 80, 160, 340], fill=(52, 52, 55))
    draw.rectangle([65, 85, 155, 160], fill=(40, 40, 43))
    draw.rectangle([65, 170, 155, 245], fill=(40, 40, 43))
    draw.rectangle([65, 255, 155, 330], fill=(40, 40, 43))
    # Electrical panel (target object — right side)
    draw.rectangle([440, 100, 580, 320], fill=(50, 52, 50))
    draw.rectangle([448, 108, 572, 180], fill=(38, 40, 38))
    draw.rectangle([448, 188, 572, 260], fill=(38, 40, 38))
    draw.rectangle([448, 268, 572, 312], fill=(38, 40, 38))
    # Small indicator lights on panel
    for y in range(120, 175, 12):
        draw.ellipse([456, y, 464, y+8], fill=(0, 180, 0))
    # Floor line
    draw.line([0, 350, W, 350], fill=(35, 35, 35), width=2)
    # Ceiling light (bright rectangle)
    draw.rectangle([260, 0, 380, 18], fill=(200, 200, 190))
    # Light cone effect (subtle)
    for i in range(8):
        alpha = 30 - i * 3
        draw.rectangle([260-i*10, 18, 380+i*10, 22+i*4],
                       fill=(70+i*2, 70+i*2, 68+i*2))

def add_noise(img, amount=8):
    import numpy as np
    arr = np.array(img).astype(int)
    noise = np.random.randint(-amount, amount, arr.shape)
    arr = np.clip(arr + noise, 0, 255).astype("uint8")
    return Image.fromarray(arr)

def add_scanlines(img):
    draw = ImageDraw.Draw(img)
    for y in range(0, H, 4):
        draw.line([0, y, W, y], fill=(0, 0, 0), width=1)
    return img

def draw_person(draw, x, y, shirt_color=(45, 65, 110)):
    """Draw a simple person silhouette near the electrical panel."""
    # Head
    draw.ellipse([x+10, y, x+40, y+35], fill=(185, 155, 130))
    # Neck
    draw.rectangle([x+20, y+33, x+30, y+42], fill=(175, 148, 125))
    # Torso
    draw.rectangle([x+5, y+42, x+45, y+110], fill=shirt_color)
    # Arms
    draw.rectangle([x-8, y+45, x+8, y+95], fill=shirt_color)
    draw.rectangle([x+42, y+45, x+58, y+95], fill=shirt_color)
    # Hands (near panel — reaching)
    draw.ellipse([x+50, y+85, x+62, y+100], fill=(185, 155, 130))
    # Legs
    draw.rectangle([x+8, y+110, x+25, y+175], fill=(35, 35, 55))
    draw.rectangle([x+27, y+110, x+44, y+175], fill=(35, 35, 55))
    # Feet
    draw.rectangle([x+5, y+172, x+28, y+182], fill=(25, 25, 25))
    draw.rectangle([x+25, y+172, x+48, y+182], fill=(25, 25, 25))

# ── 80 NORMAL FRAMES ─────────────────────────────────────────────────────────
print("Generating 80 normal frames...")
for i in range(80):
    img = Image.new("RGB", (W, H), color=(62, 62, 62))
    draw = ImageDraw.Draw(img)
    draw_facility_background(draw, seed=i % 5)
    img = img.filter(ImageFilter.GaussianBlur(radius=0.4))
    img = add_noise(img, amount=6)
    img = add_scanlines(img)
    img.save(f"demo_frames/normal/frame_{i:04d}.jpg", quality=85)

# ── 20 ANOMALY FRAMES ─────────────────────────────────────────────────────────
print("Generating 20 anomaly frames...")
for i in range(20):
    img = Image.new("RGB", (W, H), color=(62, 62, 62))
    draw = ImageDraw.Draw(img)
    draw_facility_background(draw, seed=0)
    # Person walks toward electrical panel across frames
    progress = i / 19.0
    x = int(300 + progress * 115)   # moves from x=300 toward panel at x=415
    y = int(160 + progress * 15)    # slight perspective shift
    draw_person(draw, x, y)
    img = img.filter(ImageFilter.GaussianBlur(radius=0.4))
    img = add_noise(img, amount=6)
    img = add_scanlines(img)
    img.save(f"demo_frames/anomaly/frame_{i:04d}.jpg", quality=85)

print("Done. Frames saved to demo_frames/normal/ and demo_frames/anomaly/")
print("Normal: 80 frames | Anomaly: 20 frames")
