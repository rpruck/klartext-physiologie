#!/usr/bin/env python3
"""Pack the shipping extension into a Chrome Web Store .zip — stdlib only.

Why this shape:
  - The repo is a WORKING TREE, not a distributable. Next to the ~20 files the
    extension actually loads it holds a byte-exact mirror of physiologie.cc
    (../archive), a design prototype, dev tooling (this dir), test snapshots,
    screenshots, research notes and docs. A blocklist ("zip everything except
    X") would leak dev cruft or a whole third-party site the first time someone
    forgot an exclude — so we WHITELIST instead.
  - The manifest is the single source of truth for what an MV3 extension loads,
    and here it references EXACTLY the intended ship-set (all 19 src/ files, all
    of fonts/ via the fonts/* glob, the four icon PNGs). So the ship-set is
    derived from the manifest, not hand-maintained: add a content script or a
    web-accessible resource and it is packed automatically; nothing the manifest
    doesn't name (physio-logo.png, scan.svg, every dev file) ever gets in.
  - popup.js is the one runtime file the manifest doesn't name — it hangs off
    popup.html's <script src>. So we also read popup.html for its own deps.
  - We VALIDATE before zipping: every referenced file must exist, or we fail
    loudly with the list. A broken submission is caught here, not after upload.
  - The zip puts manifest.json at the ARCHIVE ROOT (no wrapper folder) — the Web
    Store rejects a manifest nested inside a directory. Entries are written in a
    deterministic order so re-packing an unchanged tree is reproducible.
  - Version is read-only. Bumping it (the Store rejects a non-increasing version)
    stays a deliberate one-line edit to manifest.json before packing.

Usage:
    python3 dev/pack.py                 # -> dist/klartext-physiologie[-v<ver>.zip]
    python3 dev/pack.py --out build     # write into build/ instead of dist/
"""
import argparse
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # repo root (dev/ is one down)
STAGE_NAME = "klartext-physiologie"             # unpacked dir + zip basename

# The one thing the manifest cannot tell us to ship. The extension is GPL-3, and
# §4 wants the licence text conveyed with the work — so a downloaded zip has to
# carry it, even though no MV3 file ever loads it. Keep this list at exactly the
# files that are legally part of the distribution, not a back door for extras.
EXTRAS = ["LICENSE"]


def die(msg):
    """Fail loudly — a bad package is worse than no package."""
    print(f"pack: error: {msg}", file=sys.stderr)
    sys.exit(1)


def manifest_refs(manifest):
    """Every path the manifest points at. fonts/* stays a glob for now — it is
    expanded against disk in resolve() — everything else is a literal file."""
    refs = ["manifest.json"]
    for cs in manifest.get("content_scripts", []):
        refs += cs.get("css", []) + cs.get("js", [])
    for war in manifest.get("web_accessible_resources", []):
        refs += war.get("resources", [])
    for group in (manifest.get("icons", {}), manifest.get("action", {}).get("default_icon", {})):
        refs += list(group.values())
    popup = manifest.get("action", {}).get("default_popup")
    if popup:
        refs.append(popup)
    return refs


def html_refs(html_path):
    """<script src> / <link href> local deps of an HTML entry point (popup.html
    → src/popup.js). Absolute URLs are page assets, not files we ship — skip."""
    text = html_path.read_text(encoding="utf-8")
    hits = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', text, re.I)
    hits += re.findall(r'<link[^>]+href=["\']([^"\']+)["\']', text, re.I)
    return [h for h in hits if not re.match(r'^(https?:)?//|^data:', h)]


def resolve(refs):
    """Turn the raw reference list into a sorted, de-duped set of real files.
    A `dir/*` glob is expanded against disk (this is how fonts/* pulls in the 50
    woff2 + LICENSES.md); every literal must exist or we die."""
    files, missing = set(), []
    for ref in refs:
        if ref.endswith("/*"):
            base = ROOT / ref[:-2]
            if not base.is_dir():
                missing.append(ref)
                continue
            for p in base.iterdir():
                if p.is_file() and not p.name.startswith("."):
                    files.add(p.relative_to(ROOT).as_posix())
        else:
            if (ROOT / ref).is_file():
                files.add(ref)
            else:
                missing.append(ref)
    if missing:
        die("referenced file(s) not found on disk:\n  " + "\n  ".join(sorted(missing)))
    return sorted(files)


def warn_orphans(shipped):
    """A src/ file on disk that nothing references is either dead code or a
    forgotten manifest entry — worth a heads-up, not a hard failure."""
    shipped = set(shipped)
    orphans = [
        p.relative_to(ROOT).as_posix()
        for p in (ROOT / "src").iterdir()
        if p.is_file() and not p.name.startswith(".")
        and p.relative_to(ROOT).as_posix() not in shipped
    ]
    for o in sorted(orphans):
        print(f"pack: warning: src/ file not referenced anywhere, NOT packed: {o}",
              file=sys.stderr)


def human(n):
    if n < 1024:
        return f"{n} B"
    for unit in ("KB", "MB"):
        n /= 1024
        if n < 1024 or unit == "MB":
            return f"{n:.1f} {unit}"


def main():
    ap = argparse.ArgumentParser(description="Pack the extension for the Chrome Web Store.")
    ap.add_argument("--out", default="dist", help="output directory (default: dist)")
    args = ap.parse_args()

    manifest_path = ROOT / "manifest.json"
    if not manifest_path.is_file():
        die("no manifest.json at repo root — run from the project, not elsewhere")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    version = manifest.get("version", "")
    if not re.fullmatch(r"\d+\.\d+(\.\d+){0,2}", version):
        die(f"manifest version {version!r} is not a valid x.y[.z] string")

    # Ship-set = manifest refs ∪ popup.html's own deps ∪ the licence.
    refs = manifest_refs(manifest)
    popup = manifest.get("action", {}).get("default_popup")
    if popup and (ROOT / popup).is_file():
        refs += html_refs(ROOT / popup)
    refs += EXTRAS
    files = resolve(refs)
    warn_orphans(files)

    # Fresh staging dir — an unpacked, Load-unpacked-able copy of exactly the zip.
    out_dir = ROOT / args.out
    stage = out_dir / STAGE_NAME
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True, exist_ok=True)
    for rel in files:
        dst = stage / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, dst)

    # Zip with manifest.json at the archive root (no wrapper folder), files in a
    # deterministic order so an unchanged tree packs byte-stably.
    zip_path = out_dir / f"{STAGE_NAME}-v{version}.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in files:
            zf.write(stage / rel, rel)

    unpacked = sum((ROOT / rel).stat().st_size for rel in files)
    print(f"pack: Klartext Physiologie v{version}")
    print(f"pack: {len(files)} files, {human(unpacked)} unpacked, "
          f"{human(zip_path.stat().st_size)} zipped")
    print(f"pack: staged  {stage.relative_to(ROOT)}/   (Load unpacked to verify)")
    print(f"pack: archive {zip_path.relative_to(ROOT)}   (upload this to the Web Store)")


if __name__ == "__main__":
    main()
