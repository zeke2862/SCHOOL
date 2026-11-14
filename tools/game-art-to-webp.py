import sys
from PIL import Image, ImageDraw, ImageFilter

# 用法：to_webp.py 輸入.png 輸出.webp [邊長=192]
# 白底去背（從四個角落往內填滿接近白色的區域）→ 縮小 → 存成 WebP，並確認小於 30KB
src, dst = sys.argv[1], sys.argv[2]
side = int(sys.argv[3]) if len(sys.argv) > 3 else 192

im = Image.open(src).convert('RGB')
KEY = (255, 0, 255)
for corner in [(0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)]:
    ImageDraw.floodfill(im, corner, KEY, thresh=38)

rgba = im.convert('RGBA')
px = rgba.load()
mask = Image.new('L', rgba.size, 255)
mp = mask.load()
for y in range(rgba.height):
    for x in range(rgba.width):
        if px[x, y][:3] == KEY:
            mp[x, y] = 0
# 邊緣收一點點並柔化，去掉白色毛邊
mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
rgba.putalpha(mask)

# 裁到主體範圍再置中放進正方形
# 第 4 個參數 nocrop：不裁切（植物各階段要維持同樣大小的花盆，不能每張都被放大到填滿）
box = rgba.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
if box and not (len(sys.argv) > 4 and sys.argv[4] == 'nocrop'):
    rgba = rgba.crop(box)
w, h = rgba.size
scale = (side * 0.94) / max(w, h)
rgba = rgba.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
canvas.paste(rgba, ((side - rgba.width) // 2, side - rgba.height - round(side * 0.02)), rgba)

import os
for q in (82, 76, 70, 64, 58, 50):
    canvas.save(dst, 'WEBP', quality=q, method=6)
    size = os.path.getsize(dst)
    if size <= 30 * 1024:
        break
print(dst, side, 'q=%d' % q, '%.1f KB' % (size / 1024))
