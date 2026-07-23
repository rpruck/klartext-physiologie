#!/usr/bin/env python3
"""Mirror physiologie.cc into ../archive/ — a flat, byte-exact local copy for
offline reference and change-tracking. Stdlib only; no wget on this box.

Why this shape:
  - The site is FLAT: every page (.htm/.html) and figure (.jpg/.gif/.png) lives
    in the server root, and links are bare relative names (href="I.1.htm",
    src="+1.jpg"). So a raw mirror into one directory is ALREADY navigable
    offline — relative links resolve among the co-located files, no rewriting.
  - We save RAW bytes (open 'wb'), so the latin-1 page text and the original
    quirks-mode doctype survive verbatim — the whole reason the extension can be
    developed against this copy instead of the live server.
  - nginx returns Last-Modified/ETag and honours If-Modified-Since, so a re-run
    is a cheap conditional crawl. Each run writes a manifest keyed by URL
    (sha256 + Last-Modified + size); re-running prints added/changed/removed vs
    the previous manifest — that is the change-tracking mechanism.
  - Navigation is only <a href>, assets only <img src>; we still scoop up
    link/script/area/background/style url() defensively so a future stylesheet
    wouldn't be silently missed.

Usage:
    python3 dev/archive.py                 # full crawl + dated zip
    python3 dev/archive.py --limit 5 --no-zip --verbose   # smoke test
    python3 dev/archive.py --force         # re-fetch everything (ignore 304)
"""
import argparse
import hashlib
import json
import re
import sys
import time
from collections import deque
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen

# The one host, apex + www. Links are relative, so this only screens out the
# external links the book scatters (wikipedia, dilbert, medunigraz, …).
HOSTS = {"physiologie.cc", "www.physiologie.cc"}
ROOT = "http://physiologie.cc/"
UA = ("klartext-physiologie-archiver/1.0 "
      "(+local archival copy; contact rapru.rp@gmail.com)")

# Chapter hubs — X's hub is the irregular X2.htm (mirrors CHAPTERS / PAGE_REF in
# src/reskin.js). Seeds only guard against orphans; the crawl from Pruef.htm (the
# master TOC) reaches everything reachable anyway.
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI",
         "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII"]
HUBS = ["X2.htm" if r == "X" else f"{r}.htm" for r in ROMAN]
SEEDS = ["index.html", "Pruef.htm", "HHS.deutsch.htm", *HUBS]

# Tags whose one attribute is a resource reference.
LINK_ATTRS = {"a": "href", "area": "href", "link": "href",
              "img": "src", "script": "src", "iframe": "src",
              "frame": "src", "embed": "src", "source": "src"}
CSS_URL = re.compile(r"""url\(\s*['"]?([^'")]+)""", re.I)


class LinkParser(HTMLParser):
    """Collect every resource reference in a page: tag attributes, [background],
    and url() in style attributes and <style> blocks."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self._in_style = False

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        attr = LINK_ATTRS.get(tag)
        if attr and d.get(attr):
            self.links.append(d[attr])
        if d.get("background"):
            self.links.append(d["background"])
        if d.get("style"):
            self.links += CSS_URL.findall(d["style"])
        if tag == "style":
            self._in_style = True

    def handle_endtag(self, tag):
        if tag == "style":
            self._in_style = False

    def handle_data(self, data):
        if self._in_style:
            self.links += CSS_URL.findall(data)


def extract(body):
    """Return the raw href/src strings in an HTML byte string. Parse as latin-1
    (never fails; filenames are ASCII anyway) — decode is for parsing only, the
    saved bytes are untouched."""
    p = LinkParser()
    try:
        p.feed(body.decode("latin-1", "replace"))
    except Exception as e:                       # a malformed 1990s page is data, not a crash
        print(f"  ! parse warning: {e}", file=sys.stderr)
    return p.links


def normalize(url, base):
    """Resolve `url` against `base`, drop the #fragment, canonicalise to
    http://physiologie.cc/…, keep path case (server is case-sensitive). Return
    None for off-site / non-http / mailto: / javascript: / anchors."""
    url = (url or "").strip()
    if not url or url[0] == "#" or url.startswith(
            ("mailto:", "javascript:", "tel:", "data:")):
        return None
    s = urlsplit(urljoin(base, url))
    if s.scheme not in ("http", "https"):
        return None
    if (s.hostname or "").lower() not in HOSTS:
        return None
    path = s.path or "/"
    if path.endswith("/"):                       # /  and  /index.html are one page
        path += "index.html"
    return urlunsplit(("http", "physiologie.cc", path, s.query, ""))


def is_page_ext(url):
    """Heuristic (pre-fetch, for the --limit gate): does this URL look like a
    page rather than an asset?"""
    if not url:
        return False
    p = urlsplit(url).path.lower()
    seg = p.rsplit("/", 1)[-1]
    return p.endswith((".htm", ".html")) or "." not in seg


def is_html(headers, url):
    ct = (headers.get("Content-Type") or "").lower()
    if "text/html" in ct or "xhtml" in ct:
        return True
    return urlsplit(url).path.lower().endswith((".htm", ".html"))


def request_url(url):
    """Percent-encode the path for the request line, keeping the chars nginx
    serves literally (+ and *, both verified 200) and % (so an already-encoded
    name is not double-encoded)."""
    s = urlsplit(url)
    return urlunsplit((s.scheme, s.netloc,
                       quote(s.path, safe="/+*!$&'()~@:,;=-._%"), s.query, ""))


def local_path(site, url):
    """Where this URL is saved: site/<path>, percent-decoded to the real byte
    filename (+1.jpg, not %2B1.jpg)."""
    path = unquote(urlsplit(url).path.lstrip("/")) or "index.html"
    return site / path


def fetch(url, prior, args):
    """Return (status, headers, body|None). body is None on 304 and on error.
    Conditional GET off the prior manifest unless --force; retry timeouts/5xx."""
    req = Request(request_url(url), headers={"User-Agent": UA, "Accept": "*/*"})
    if not args.force and prior:
        if prior.get("last_modified"):
            req.add_header("If-Modified-Since", prior["last_modified"])
        if prior.get("etag"):
            req.add_header("If-None-Match", prior["etag"])
    last = None
    for attempt in range(args.retries + 1):
        try:
            with urlopen(req, timeout=args.timeout) as r:
                return r.status, dict(r.headers), r.read()
        except HTTPError as e:
            if e.code == 304:
                return 304, dict(e.headers or {}), None
            if e.code in (429, 500, 502, 503, 504) and attempt < args.retries:
                last = e
                time.sleep(args.delay * 2 ** attempt + 0.5)
                continue
            return e.code, dict(e.headers or {}), None
        except (URLError, TimeoutError, OSError) as e:
            last = e
            if attempt < args.retries:
                time.sleep(args.delay * 2 ** attempt + 0.5)
                continue
    print(f"  ! giving up on {url}: {last}", file=sys.stderr)
    return None, {}, None


def save(site, url, body, seen_ci):
    """Write bytes to site/<path>. Guard against a case-only collision on macOS's
    case-insensitive FS: if a differently-cased URL already wrote different bytes
    to the same file, warn and disambiguate rather than clobber."""
    lp = local_path(site, url)
    key = str(lp).lower()
    prev = seen_ci.get(key)
    if prev and prev[1] != url and prev[0].read_bytes() != body:
        alt = lp.with_name(lp.stem + "~" + hashlib.sha256(url.encode()).hexdigest()[:6] + lp.suffix)
        print(f"  ! case collision: {url} vs {prev[1]} -> {alt.name}", file=sys.stderr)
        lp = alt
    lp.parent.mkdir(parents=True, exist_ok=True)
    lp.write_bytes(body)
    seen_ci[key] = (lp, url)
    return lp


def parse_args():
    ap = argparse.ArgumentParser(description="Mirror physiologie.cc for archival.")
    here = Path(__file__).resolve().parent.parent          # repo root (dev/ -> ..)
    ap.add_argument("--out", default=str(here / "archive"),
                    help="output root (default: <repo>/archive)")
    ap.add_argument("--delay", type=float, default=0.6, help="seconds between requests")
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--force", action="store_true", help="re-fetch all (ignore 304)")
    ap.add_argument("--no-zip", action="store_true", help="skip the dated zip")
    ap.add_argument("--limit", type=int, default=0, help="cap pages fetched (smoke test)")
    ap.add_argument("--verbose", action="store_true", help="print every resource")
    return ap.parse_args()


def main():
    args = parse_args()
    out = Path(args.out).resolve()
    site = out / "site"
    site.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"

    prior = {}
    if manifest_path.exists():
        try:
            prior = json.loads(manifest_path.read_text()).get("resources", {})
        except Exception as e:
            print(f"! could not read prior manifest ({e}); treating as first run",
                  file=sys.stderr)

    queue = deque()
    known = set()

    def enqueue(u, front=False):
        if u and u not in known:
            known.add(u)
            (queue.appendleft if front else queue.append)(u)

    for s in SEEDS:
        enqueue(normalize(s, ROOT))

    manifest = {}                 # url -> record, this run
    broken = []                   # {url, status}
    seen_ci = {}                  # lower(localpath) -> (Path, url)
    pages = assets = total_bytes = fetched = 0

    while queue:
        url = queue.popleft()
        # --limit caps PAGES; assets always ride along so a page's figures land.
        if args.limit and pages >= args.limit and is_page_ext(url):
            continue

        status, headers, body = fetch(url, prior.get(url), args)
        fetched += 1
        time.sleep(args.delay)

        if status == 304:                        # unchanged — keep the prior record + file
            rec = dict(prior[url])
            rec["status"] = 304
            rec["fetched_at"] = _now()
            manifest[url] = rec
            html = is_page_ext(url)
            if html and (existing := site / rec["local"].split("/", 1)[-1]).exists():
                # re-scan the on-disk copy so links off an unchanged page are still followed
                for link in extract(existing.read_bytes()):
                    nu = normalize(link, url)
                    enqueue(nu, front=not is_page_ext(nu))
            _log(args, fetched, 304, 0, url)
            continue

        if body is None or status != 200:
            broken.append({"url": url, "status": status})
            _log(args, fetched, status, 0, url)
            continue

        lp = save(site, url, body, seen_ci)
        total_bytes += len(body)
        html = is_html(headers, url)
        manifest[url] = {
            "local": str(lp.relative_to(out)),
            "status": 200,
            "length": len(body),
            "last_modified": headers.get("Last-Modified"),
            "etag": headers.get("ETag"),
            "content_type": headers.get("Content-Type"),
            "sha256": hashlib.sha256(body).hexdigest(),
            "fetched_at": _now(),
        }
        if html:
            pages += 1
            for link in extract(body):
                nu = normalize(link, url)
                enqueue(nu, front=not is_page_ext(nu))   # figures to the front
        else:
            assets += 1
        _log(args, fetched, 200, len(body), url)

    # ── manifest + change diff ────────────────────────────────────────────
    # A full crawl is authoritative (a URL gone from it is genuinely removed);
    # a --limit run must not nuke untouched prior entries, so merge.
    resources = manifest if not args.limit else {**prior, **manifest}
    manifest_path.write_text(json.dumps({
        "site": ROOT,
        "crawled_at": _now(),
        "resources": resources,
        "broken": broken,
    }, indent=2, ensure_ascii=False))

    print(f"\n─ done: {pages} pages · {assets} assets · "
          f"{total_bytes / 1e6:.1f} MB · {fetched} requests")
    # A --limit run walks an arbitrary frontier, so "added/removed vs last run"
    # is noise; the diff is only meaningful when the whole site was crawled.
    if prior and not args.limit:
        prior_u, now_u = set(prior), set(manifest)
        added = sorted(now_u - prior_u)
        removed = sorted(prior_u - now_u)
        changed = sorted(u for u in now_u & prior_u
                         if manifest[u].get("sha256") and prior[u].get("sha256")
                         and manifest[u]["sha256"] != prior[u]["sha256"])
        print(f"  changed: {len(changed)}  added: {len(added)}  removed: {len(removed)}")
        for u in changed[:40]:
            print(f"    ~ {u}")
        for u in added[:40]:
            print(f"    + {u}")
        for u in removed[:40]:
            print(f"    - {u}")
    if broken:
        print(f"  broken/non-200: {len(broken)}")
        for b in broken[:40]:
            print(f"    {b['status']}  {b['url']}")
    print(f"  manifest: {manifest_path}")

    if not args.no_zip:
        zpath = out / f"physiologie.cc-{date.today().isoformat()}.zip"
        import zipfile
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(site.rglob("*")):
                if p.is_file():
                    z.write(p, p.relative_to(out))
            z.write(manifest_path, manifest_path.relative_to(out))
        print(f"  zip: {zpath} ({zpath.stat().st_size / 1e6:.1f} MB)")


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _log(args, n, status, size, url):
    if args.verbose or status != 200 or is_page_ext(url):
        print(f"[{n:>4}] {status} {size:>8} {url}")


if __name__ == "__main__":
    main()
