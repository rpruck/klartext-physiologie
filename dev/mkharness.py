import re, sys, pathlib, os
src = pathlib.Path(sys.argv[1]).read_text(encoding='latin-1')
out = sys.argv[2]
BASE='http://localhost:8756'
# cache-buster = newest mtime across src/, so the browser refetches after edits
V = int(max(os.path.getmtime(p) for p in pathlib.Path('src').glob('*')))
m = re.search(r'<body([^>]*)>(.*)</body>', src, re.S|re.I)
# Keep the real <body> attributes (inline bgcolor/style/link colours) so the
# harness reproduces what the extension actually faces on the live page.
body_attrs = m.group(1) if m else ''
body = m.group(2) if m else src
scripts = ''.join(f'<script src="{BASE}/src/{f}?v={V}"></script>\n' for f in
  ['store.js','anchor.js','fonts.js','reskin.js','ui.js','tools.js','settings.js','activate.js','content.js'])
harness = f'''<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="http://physiologie.cc/">
<link rel="stylesheet" href="{BASE}/src/boot.css?v={V}">
<link rel="stylesheet" href="{BASE}/src/content.css?v={V}">
<title>harness {out}</title>
</head><body{body_attrs}>
{body}
<script src="{BASE}/src/boot.js"></script>
{scripts}</body></html>'''
pathlib.Path(out).write_text(harness, encoding='utf-8')
print("wrote", out)
