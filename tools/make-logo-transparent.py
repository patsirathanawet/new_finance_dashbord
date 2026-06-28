"""
ทำให้พื้นหลังของ bms-logo.png โปร่งใส (transparent)
- ใช้ flood fill จาก 4 มุม → background pixels เป็น transparent
- ส่วน white circle ใน heart (BMS badge) ยังเก็บไว้ — ไม่โดน flood เพราะมี outline สีแดงล้อม
"""
from PIL import Image, ImageDraw

SRC = 'bms-logo.png'
DST = 'bms-logo.png'  # overwrite

orig = Image.open(SRC).convert('RGBA')
w, h = orig.size
print(f'Image: {w}x{h}, mode={orig.mode}')

# สร้าง mask copy เป็น RGB เพื่อ flood fill
mask = orig.convert('RGB').copy()

# Flood fill จาก 4 มุม + edge mids ด้วย magic color (magenta)
MAGIC = (255, 0, 255)
THRESH = 0  # strict — เฉพาะ pure white (255,255,255) เท่านั้น
seeds = [
    (0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),  # 4 corners เท่านั้น
]
for sx, sy in seeds:
    ImageDraw.floodfill(mask, (sx, sy), MAGIC, thresh=THRESH)

# Build output: ที่ mask เป็น MAGIC → set alpha=0, ที่อื่นคงเดิม
orig_px = list(orig.getdata())
mask_px = list(mask.getdata())
new_px = []
transparent_count = 0
for i in range(len(orig_px)):
    if mask_px[i] == MAGIC:
        new_px.append((255, 255, 255, 0))  # fully transparent
        transparent_count += 1
    else:
        new_px.append(orig_px[i])

print(f'Total pixels: {len(orig_px)}')
print(f'Made transparent: {transparent_count} ({100 * transparent_count / len(orig_px):.1f}%)')

orig.putdata(new_px)
orig.save(DST, 'PNG')
print(f'Saved: {DST}')
