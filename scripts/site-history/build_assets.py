"""Turn the raw captures in shots/ into the assets the /site-history page uses.

Usage: python3 build_assets.py <repo> <full-history-clone> <shots-dir>
Writes public/site-history/<date>-<sha>-{cover,thumb,full}.webp and src/data/siteHistory.json into
<repo>. Consecutive snapshots that look the same as the previous one are dropped. The change notes come
from `git log` in <full-history-clone> (the homepage-related commits since the previous snapshot).
"""
import json, os, subprocess, sys
from PIL import Image, ImageChops, ImageStat

REPO, HIST_REPO, SHOTS = sys.argv[1], sys.argv[2], sys.argv[3]
OUT = os.path.join(REPO, 'public/site-history')
FULL_W, FULL_MAX_H = 720, 6000
os.makedirs(OUT, exist_ok=True)

def git(*args):
    return subprocess.run(['git', '-C', HIST_REPO, *args], capture_output=True, text=True).stdout.strip()

def diff_score(a, b):
    a = a.convert('L').resize((180, 112)); b = b.convert('L').resize((180, 112))
    return ImageStat.Stat(ImageChops.difference(a, b)).mean[0]

metas = []
for f in os.listdir(SHOTS):
    if f.endswith('.json'):
        m = json.load(open(os.path.join(SHOTS, f)))
        if os.path.exists(os.path.join(SHOTS, m['sha'] + '-cover.png')): metas.append(m)
metas.sort(key=lambda m: m['date'])

for f in os.listdir(OUT):
    if f.endswith('.webp'): os.remove(os.path.join(OUT, f))

kept, prev_cover, prev_full = [], None, None
for i, m in enumerate(metas):
    cover = Image.open(os.path.join(SHOTS, m['sha'] + '-cover.png')).convert('RGB')
    full = Image.open(os.path.join(SHOTS, m['sha'] + '-full.png')).convert('RGB')
    last = i == len(metas) - 1
    if prev_cover is not None and not last:
        score = diff_score(prev_cover, cover)
        h = min(full.height, prev_full.height)
        full_score = ImageStat.Stat(ImageChops.difference(
            prev_full.crop((0, 0, prev_full.width, h)).convert('L').resize((120, 480)),
            full.crop((0, 0, full.width, h)).convert('L').resize((120, 480)))).mean[0]
        if score < 1.2 and full_score < 1.0 and abs(full.height - prev_full.height) < 120:
            print('same as previous, skip', m['sha'], round(score, 2), round(full_score, 2)); continue
    base = f"{m['date']}-{m['sha']}"
    cover.resize((1200, 750), Image.LANCZOS).save(os.path.join(OUT, base + '-cover.webp'), 'WEBP', quality=74, method=6)
    cover.resize((288, 180), Image.LANCZOS).save(os.path.join(OUT, base + '-thumb.webp'), 'WEBP', quality=70, method=6)
    fh = round(full.height * FULL_W / full.width)
    small = full.resize((FULL_W, fh), Image.LANCZOS)
    if fh > FULL_MAX_H: small = small.crop((0, 0, FULL_W, FULL_MAX_H)); fh = FULL_MAX_H
    small.save(os.path.join(OUT, base + '-full.webp'), 'WEBP', quality=62, method=6)
    since = int(git('rev-list', '--count', f"{kept[-1]['sha']}..{m['sha']}")) if kept else int(git('rev-list', '--count', m['sha']))
    kept.append({
        'sha': m['sha'], 'date': m['date'],
        'cover': f'/site-history/{base}-cover.webp', 'thumb': f'/site-history/{base}-thumb.webp',
        'full': f'/site-history/{base}-full.webp', 'fullHeight': fh, 'fullWidth': FULL_W,
        'commits': since, 'previous': kept[-1]['sha'] if kept else None,
        'subject': git('log', '-1', '--format=%s', m['sha'])[:140],
        # What changed on the homepage since the previous snapshot, newest first, from the commit log.
        'changes': [line[:120] for line in git('log', '--no-merges', '--format=%s',
            *( [f"{kept[-1]['sha']}..{m['sha']}"] if kept else [m['sha']] ),
            '--', 'pages/index.js', 'src/components', 'src/layout', 'styles', 'public/assets/css').splitlines()
            if line.strip() and not line.lower().startswith(('merge ', 'revert "'))][:3],
    })
    prev_cover, prev_full = cover, full

data = {'repo': 'https://github.com/YuqiGuo105/Portfolio', 'viewport': [1440, 900], 'snapshots': kept}
os.makedirs(os.path.join(REPO, 'src/data'), exist_ok=True)
json.dump(data, open(os.path.join(REPO, 'src/data/siteHistory.json'), 'w'), indent=1, ensure_ascii=False)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print(len(kept), 'snapshots,', total // 1024, 'KB')
