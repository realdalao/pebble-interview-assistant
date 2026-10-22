"""Make icon background transparent: flood-fill white margins (incl. watermark) from corners."""
from PIL import Image
from collections import deque
from pathlib import Path

ASSETS = Path(__file__).resolve().parent
SRC = ASSETS / "macOS_app_icon_design__rounded_2026-09-29T14-50-38.png"
DST = ASSETS / "icon.png"

img = Image.open(SRC).convert("RGBA")
w, h = img.size
px = img.load()

def near_white(p, tol=38):
    r, g, b, a = p
    return r > 255 - tol and g > 255 - tol and b > 255 - tol

# BFS from all border pixels, clearing connected near-white area
seen = [[False] * w for _ in range(h)]
q = deque()
for x in range(w):
    for y in (0, h - 1):
        q.append((x, y))
for y in range(h):
    for x in (0, w - 1):
        q.append((x, y))
cleared = 0
while q:
    x, y = q.popleft()
    if x < 0 or x >= w or y < 0 or y >= h or seen[y][x]:
        continue
    seen[y][x] = True
    p = px[x, y]
    if not near_white(p):
        continue
    px[x, y] = (255, 255, 255, 0)
    cleared += 1
    q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

# Feather: soften 1px alpha edge inside the shape boundary
alpha = img.split()[3].point(lambda a: 0 if a < 128 else (255 if a > 200 else a))
img.putalpha(alpha)

img.save(DST)
print(f"cleared {cleared}px, size {img.size}, saved {DST}")
