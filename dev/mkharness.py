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
  ['store.js','visited.js','anchor.js','fonts.js','reskin.js','ui.js','tools.js','outline.js','progress.js',
   'bookmarks.js','settings.js','activate.js','content.js'])
# A localStorage-backed chrome.storage.local, so anything that persists
# (settings, annotations, the visited record) is exercisable here too.
# ?seen=/i.1.htm,/i.2.htm preseeds the visited record before boot.
stub = '''<script>
(function () {
  // Which page this harness stands in for. The <base href> makes the body's
  // links resolve to physiologie.cc while location.pathname stays /dev/…, so
  // "does this link point at the page I am on?" can't be answered from the URL
  // here. Only the harness needs it; on the live site pathname is the truth.
  window.__prSelfFile = 'SELF_';
  const K = (k) => 'pr.harness.' + k;
  const rd = (k) => { try { const v = localStorage.getItem(K(k)); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; } };
  window.chrome = window.chrome || {};
  chrome.storage = { local: {
    // get(null) is "the whole store" — bookmarks.js walks every page:* record
    // with it, so the stub has to answer it or the list reads back empty.
    get(key, cb) {
      const o = {};
      if (key === null || key === undefined) {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k.indexOf('pr.harness.') !== 0) continue;
          const bare = k.slice('pr.harness.'.length);
          const v = rd(bare); if (v !== undefined) o[bare] = v;
        }
      } else { const v = rd(key); if (v !== undefined) o[key] = v; }
      cb(o);
    },
    set(obj, cb) { for (const k in obj) localStorage.setItem(K(k), JSON.stringify(obj[k])); cb && cb(); },
    remove(key, cb) { localStorage.removeItem(K(key)); cb && cb(); },
  }, onChanged: { addListener() {} } };
  // same cache-buster as the <script>/<link> tags, so an edited ui.css lands
  chrome.runtime = chrome.runtime || { getURL: (p) => 'BASE_/' + p + '?v=V_' };
  const seen = new URLSearchParams(location.search).get('seen');
  if (seen !== null) {
    const rec = {};
    seen.split(',').filter(Boolean).forEach((p) => { rec[p.toLowerCase()] = 1; });
    chrome.storage.local.set({ visited: rec });
  }
})();
</script>
'''.replace('BASE_', BASE).replace('V_', str(V)).replace('SELF_', pathlib.Path(sys.argv[1]).name.lower())
harness = f'''<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="http://physiologie.cc/">
<link rel="stylesheet" href="{BASE}/src/boot.css?v={V}">
<link rel="stylesheet" href="{BASE}/src/content.css?v={V}">
<title>harness {out}</title>
</head><body{body_attrs}>
{body}
{stub}<script src="{BASE}/src/boot.js"></script>
{scripts}</body></html>'''
pathlib.Path(out).write_text(harness, encoding='utf-8')
print("wrote", out)
