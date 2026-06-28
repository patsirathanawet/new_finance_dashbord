"""
ตัดวงกลม BMS จาก logo-extracted.png
- หา bbox ของ pixel ที่มีสี (หัวใจแดง, ข้อความ, swoosh น้ำเงิน) — ไม่ใช่ขาว/เทา
- crop กรอบรอบ + circular mask → PNG พื้นโปร่งใส
"""
from PIL import Image, ImageDraw

SRC = 'D:/งาน/พัฒนาโปรแกรม/new_finance_dashboard/new_finance_dashboard/tools/source/logo-extracted.png'
DST = 'D:/งาน/พัฒนาโปรแกรม/new_finance_dashboard/new_finance_dashboard/public/bms-logo.png'

src = Image.open(SRC).convert('RGBA')
W, H = src.size
print(f'Source: {W}x{H}')

# หา bbox ของ logo elements (หัวใจแดง, BMS น้ำเงิน, swoosh) — ที่มี saturation ชัดเจน
# **ตัด pixel ที่มืดสุด ๆ ออก** (= shadow ใต้วงกลม) เพื่อไม่ให้ดึง center ลงล่าง
min_x, min_y, max_x, max_y = W, H, 0, 0
colored_count = 0
for y in range(H):
    for x in range(W):
        r, g, b, _ = src.getpixel((x, y))
        max_c = max(r, g, b)
        min_c = min(r, g, b)
        sat = max_c - min_c
        # criteria: pixel มี saturation ≥ 40 (สีชัด — ไม่ใช่ shadow gray)
        if sat >= 40:
            colored_count += 1
            if x < min_x: min_x = x
            if y < min_y: min_y = y
            if x > max_x: max_x = x
            if y > max_y: max_y = y

print(f'Colored pixels: {colored_count}')
print(f'Colored bbox: ({min_x},{min_y}) to ({max_x},{max_y})')

cx = (min_x + max_x) // 2
cy = (min_y + max_y) // 2
size = max(max_x - min_x, max_y - min_y)
radius = size // 2 + 30  # เผื่อ shadow rim ของวงกลม
print(f'Center: ({cx},{cy}), radius: {radius}')

# Crop กรอบสี่เหลี่ยมรอบวงกลม (square)
left = max(0, cx - radius)
top = max(0, cy - radius)
right = min(W, cx + radius)
bot = min(H, cy + radius)

# ปรับให้เป็นจัตุรัสสมบูรณ์ — center crop
crop_w = right - left
crop_h = bot - top
crop_size = min(crop_w, crop_h)
# re-center
left = max(0, cx - crop_size // 2)
top = max(0, cy - crop_size // 2)
right = left + crop_size
bot = top + crop_size

cropped = src.crop((left, top, right, bot))
cw, ch = cropped.size
print(f'Cropped square: {cw}x{ch}')

# Mask วงกลมเต็มพื้นที่
mask = Image.new('L', (cw, ch), 0)
draw = ImageDraw.Draw(mask)
mr = min(cw, ch) // 2 - 2
draw.ellipse((cw // 2 - mr, ch // 2 - mr, cw // 2 + mr, ch // 2 + mr), fill=255)

result = cropped.copy()
result.putalpha(mask)

# Trim
bbox = result.getbbox()
if bbox:
    result = result.crop(bbox)

# Resize ให้เหมาะกับ web
TARGET = 256
if max(result.size) > TARGET:
    result.thumbnail((TARGET, TARGET), Image.LANCZOS)

print(f'Final: {result.size}')
result.save(DST, 'PNG', optimize=True)
print(f'Saved: {DST}')
