"""Independent visual witness for route feet, using the unchanged concept PNG.

The navigation implementation is not imported. Tan dirt is checked directly in
the image; visible stone entrance aprons and the gate's hidden passage are small,
manually identified exceptions. This is a regression check, not a proof that
every decorative pixel has semantic meaning.
"""
import json
import math
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMAGE = ROOT / "public/assets/joseon/v2/map-concept-v1.png"
image = Image.open(IMAGE).convert("RGB")
sx, sy = image.width / 1216, image.height / 800

# Source-image coordinates, traced from the visible stone stairs/forecourts.
APRONS = [
    ("palace steps", [(606, 255), (705, 281), (688, 348), (603, 317)]),
    ("west upper steps", [(306, 365), (374, 380), (355, 416), (291, 395)]),
    ("library forecourt", [(1060, 358), (1175, 380), (1278, 375), (1284, 411), (1173, 430), (1067, 400)]),
    ("west lower steps", [(119, 701), (194, 727), (187, 763), (121, 740)]),
    ("east lower forecourt", [(1035, 734), (1160, 761), (1276, 746), (1222, 802), (1110, 818), (1030, 780)]),
    ("workshop steps", [(731, 821), (844, 844), (884, 874), (790, 897), (729, 873)]),
    ("tavern forecourt", [(346, 849), (439, 870), (457, 909), (349, 897)]),
    ("gate apron", [(617, 519), (828, 516), (836, 591), (611, 591)]),
]

# The passage is concealed by the baked gate roof. It is explicitly bounded;
# accepting arbitrary roof colors anywhere would mask bad route coordinates.
GATE_PORTAL = [(713, 377), (729, 377), (729, 578), (713, 578)]
ROOFS = [
    [(550, 141), (809, 56), (963, 149), (855, 233), (623, 191)],
    [(116, 292), (249, 208), (375, 294), (271, 345)],
    [(1090, 274), (1195, 202), (1288, 286), (1189, 332)],
    [(111, 628), (209, 566), (356, 651), (251, 701)],
    [(1005, 676), (1190, 565), (1326, 658), (1168, 734)],
    [(690, 789), (811, 711), (885, 780), (794, 816)],
    [(368, 801), (440, 762), (577, 817), (506, 856), (371, 826)],
]

def inside(point, polygon):
    x, y = point
    odd = False
    for i, (ax, ay) in enumerate(polygon):
        bx, by = polygon[i - 1]
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            odd = not odd
    return odd

def dirt(rgb):
    r, g, b = rgb
    return r >= 145 and g >= 105 and 42 <= b <= 175 and 18 <= r - g <= 80 and 20 <= g - b <= 95

payload = json.load(sys.stdin)
failures = []
counts = {"dirt": 0, "stoneApron": 0, "gatePortal": 0}
for sample in payload["samples"]:
    p = (sample["x"] * sx, sample["y"] * sy)
    x, y = round(p[0]), round(p[1])
    if not (0 <= x < image.width and 0 <= y < image.height):
        failures.append({**sample, "reason": "outside image"})
        continue
    if inside(p, GATE_PORTAL):
        counts["gatePortal"] += 1
        continue
    if any(inside(p, polygon) for _, polygon in APRONS):
        counts["stoneApron"] += 1
        continue
    if any(inside(p, polygon) for polygon in ROOFS):
        failures.append({**sample, "source": [round(p[0], 2), round(p[1], 2)], "reason": "building roof"})
        continue
    # Small decorative pixels (flowers, pebbles, shadows) may cover the exact
    # center. The nearby underlying surface must still have clear dirt support.
    hits, total = 0, 0
    for dy in range(-5, 6):
        for dx in range(-5, 6):
            if dx * dx + dy * dy > 25:
                continue
            xx, yy = x + dx, y + dy
            if 0 <= xx < image.width and 0 <= yy < image.height:
                hits += dirt(image.getpixel((xx, yy)))
                total += 1
    fraction = hits / max(total, 1)
    if fraction >= 0.22:
        counts["dirt"] += 1
    else:
        failures.append({**sample, "source": [round(p[0], 2), round(p[1], 2)], "rgb": image.getpixel((x, y)), "dirtFraction": round(fraction, 3)})

print(json.dumps({"image": str(IMAGE), "method": "Independent tan-dirt pixel neighborhoods, manually traced stone aprons and one bounded gate passage; conservative visible roof exclusions.",
                  "limitations": "Decorative pixels and occluded passage areas are classified by their nearby surface or explicit physical apron bounds; browser QA remains necessary.",
                  "sampleCount": len(payload["samples"]), "accepted": counts,
                  "failedCount": len(failures), "failures": failures[:100]}, ensure_ascii=False))
