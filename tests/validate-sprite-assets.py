#!/usr/bin/env python3
"""Read-only PNG geometry checks, independent of the browser's sprite renderer."""
import hashlib
import json
import math
from pathlib import Path
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / 'public/assets/sprites'
REPORT = ROOT / 'output/qa/sprite-assets-validation-20261001.json'
SLUGS = {'king', 'yeonguijeong', 'pansoe-blue', 'pansoe-green',
         'commoner-man', 'commoner-woman', 'dokkaebi'}
THRESHOLD = 128  # Ignore weak transparent halos when measuring source geometry.
report = {'date': '2026-10-01', 'alphaThreshold': THRESHOLD, 'assets': [], 'failures': [],
          'method': 'Actual PNG alpha silhouettes, cell bounds, lower shoe union, and portrait head coverage. Foot center may be transparent between two shoes.'}


def require(ok, slug, message, **detail):
    if not ok:
        report['failures'].append({'slug': slug, 'message': message, **detail})


def count(mask):
    return mask.histogram()[255]


def frame_values(meta):
    for pose, value in meta['frames'].items():
        frames = value if isinstance(value, list) else [value]
        for index, frame in enumerate(frames):
            yield pose, index, ({'x': frame, 'y': 0} if isinstance(frame, (int, float)) else frame)


index = json.loads((SPRITES / 'index.json').read_text())
require(set(index) == SLUGS, '*', 'Required role set differs', actual=sorted(index))

for slug, meta in index.items():
    try:
        image_path = SPRITES / meta.get('file', f'{slug}.png')
        image = Image.open(image_path)
        require(image.format == 'PNG', slug, 'Asset is not a PNG')
        require('A' in image.getbands(), slug, 'Asset has no alpha channel')
        alpha = image.convert('RGBA').getchannel('A')
        mask = alpha.point(lambda a: 255 if a >= THRESHOLD else 0)
        w, h = meta['w'], meta['h']
        require((w, h) == (512, 512), slug, 'Source cell contract differs', actual=[w, h])
        require(image.size == (w * 3, h * 2), slug, 'Expected two rows by three columns', actual=list(image.size))
        require(meta.get('worldHeight') == (42 if slug == 'dokkaebi' else 48), slug, 'Wrong logical body height')
        require(meta.get('hitWidth') == 14, slug, 'Wrong logical hit half-width')
        require(0 <= meta.get('top', 0) < meta['foot'][1] < h, slug, 'Invalid reference top/foot')
        hist = alpha.histogram()
        require(hist[0] > image.width * image.height / 2, slug, 'Transparent background occupies less than half the sheet')
        require(count(mask) > 0, slug, 'Empty opaque silhouette')
        asset = {'slug': slug, 'file': str(image_path), 'sha256': hashlib.sha256(image_path.read_bytes()).hexdigest(),
                 'canvas': list(image.size), 'alphaZero': hist[0], 'alpha128Up': count(mask),
                 'nativePixelGrid': bool(meta.get('nativePixelGrid')),
                 'cells': [], 'referencedFrames': 0}

        cells = {}
        for row in range(2):
            for col in range(3):
                x, y = col * w, row * h
                cell = mask.crop((x, y, x + w, y + h))
                bbox = cell.getbbox()
                require(bbox is not None, slug, 'Empty source cell', cell=[col, row])
                if bbox is None:
                    continue
                require(bbox[0] > 1 and bbox[1] > 1 and bbox[2] < w - 1 and bbox[3] < h - 1,
                        slug, 'Opaque character touches a source cell edge', cell=[col, row], bbox=list(bbox))
                # This measures the union of both shoes; the union center need not itself be painted.
                band_top = math.floor(bbox[1] + (bbox[3] - bbox[1]) * 0.9)
                lower = cell.crop((0, band_top, w, bbox[3])).getbbox()
                shoe_center = (lower[0] + lower[2] - 1) / 2
                expected_foot = [shoe_center, bbox[3] - 1]
                cells[(x, y)] = {'mask': cell, 'bbox': bbox, 'expectedFoot': expected_foot}
                entry = {'source': [x, y], 'bbox': list(bbox), 'opaquePixels': count(cell),
                         'shoeUnionCenter': expected_foot}
                asset['cells'].append(entry)

        for pose, phase, frame in frame_values(meta):
            x, y = frame['x'], frame.get('y', 0)
            foot = frame.get('foot', meta['foot'])
            require(x >= 0 and y >= 0 and x + w <= image.width and y + h <= image.height,
                    slug, 'Referenced frame exceeds PNG bounds', pose=pose, phase=phase)
            require((x, y) in cells, slug, 'Referenced frame is not a source cell', pose=pose, phase=phase)
            require(len(foot) == 2 and 0 <= foot[0] < w and 0 <= foot[1] < h,
                    slug, 'Foot anchor exceeds its source cell', pose=pose, phase=phase, foot=foot)
            if (x, y) not in cells:
                continue
            expected = cells[(x, y)]['expectedFoot']
            require(abs(foot[0] - expected[0]) <= 2 and abs(foot[1] - expected[1]) <= 1,
                    slug, 'Foot does not match the bottom shoe union', pose=pose, phase=phase,
                    foot=foot, measured=expected)
            asset['referencedFrames'] += 1

        front_value = meta['frames']['south']
        front = front_value[0] if isinstance(front_value, list) else front_value
        if isinstance(front, (int, float)):
            front = {'x': front, 'y': 0}
        front_cell = cells[(front['x'], front.get('y', 0))]
        foot = front.get('foot', meta['foot'])
        top = max(0, min(h - 1, meta.get('top', 0)))
        # Match the specified crop contract, then test it against the independent alpha silhouette.
        crop = max(1, min(w, h - top, math.floor((foot[1] - top) * 0.62 + 0.5)))
        left = max(0, min(w - crop, math.floor(foot[0] - crop / 2 + 0.5)))
        bbox = front_cell['bbox']
        require(abs(top - bbox[1]) <= 1, slug, 'Front top differs from actual opaque silhouette', top=top, actual=bbox[1])
        head_bottom = min(top + crop, math.floor(bbox[1] + (bbox[3] - bbox[1]) * 0.30))
        head_all = count(front_cell['mask'].crop((0, bbox[1], w, head_bottom)))
        head_crop = count(front_cell['mask'].crop((left, bbox[1], left + crop, head_bottom)))
        head_fraction = head_crop / head_all if head_all else 0
        require(head_fraction >= 0.95, slug, 'Portrait clips substantial head/hat pixels', headCoverage=head_fraction)
        asset['portrait'] = {'cellLocalCrop': [left, top, crop, crop], 'headCoverage': head_fraction}
        asset['visibleHeightAtMapScale'] = meta['worldHeight'] * 0.70 * (0.8 if slug == 'dokkaebi' else 1)
        report['assets'].append(asset)
    except Exception as error:
        report['failures'].append({'slug': slug, 'message': str(error)})

report['passed'] = not report['failures']
report['assetCount'] = len(report['assets'])
report['sourceCells'] = sum(len(a['cells']) for a in report['assets'])
report['referencedFrames'] = sum(a['referencedFrames'] for a in report['assets'])
REPORT.parent.mkdir(parents=True, exist_ok=True)
REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: report[key] for key in ['passed', 'assetCount', 'sourceCells', 'referencedFrames', 'failures']}, ensure_ascii=False))
sys.exit(0 if report['passed'] else 1)
