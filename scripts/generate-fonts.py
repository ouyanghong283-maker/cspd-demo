"""Download the complete variable Chinese font as locally served Unicode subsets.

Unlike text-only subsets, this also covers arbitrary user-entered Chinese names.
No application runtime request reaches Google; every font URL is local.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import re
import urllib.request
import time

root = Path(__file__).resolve().parents[1]
folder = root / 'public' / 'fonts'
request = urllib.request.Request(
    'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400..700&display=swap',
    headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'},
)
css = urllib.request.urlopen(request, timeout=30).read().decode()
urls = list(dict.fromkeys(re.findall(r'url\(([^)]+)\)', css)))

def download(item):
    index, url = item
    name = f'noto-sc-full-{index}.woff2'
    path = folder / name
    if path.exists() and path.stat().st_size > 100:
        return url, name, path.stat().st_size
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(url, timeout=10).read()
            break
        except Exception:
            if attempt == 3:
                raise
            time.sleep(0.5)
    print(f'Downloaded font subset {index}', flush=True)
    (folder / name).write_bytes(data)
    return url, name, len(data)

with ThreadPoolExecutor(max_workers=4) as executor:
    files = list(executor.map(download, enumerate(urls)))
for url, name, _ in files:
    css = css.replace(url, f'/fonts/{name}')
(folder / 'fonts.css').write_text(css)
print(f'Installed {len(files)} local variable font subsets, {sum(size for _, _, size in files)} bytes')
