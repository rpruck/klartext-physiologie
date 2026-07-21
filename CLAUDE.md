# CLAUDE.md

Guidance for working in this repo. Keep it current when the architecture shifts.

## What this is

**Klartext Physiologie** — a **Chrome MV3 browser extension** that reskins **[physiologie.cc](http://physiologie.cc/)**
(Hinghofer-Szalkay's *Reise durch die Physiologie*) into a calm, editorial reading experience and
adds local study tools: highlighting, margin notes, and figure zoom/pin. Everything is stored
locally (`chrome.storage.local`); the extension makes no network calls of its own.

The site is 1990s-era hand-authored HTML (latin-1, `<font>`/`bgcolor`/`<br>` tag soup, structure
encoded only visually). The extension does not restyle it in place — it **extracts and re-renders**
(see below).

`README.md` and `HANDOFF.md` predate the extension (they describe the original design prototype in
`prototype.html` and a not-yet-built extension). The shipping code lives in `src/` and is the source
of truth; treat those two docs as historical.

## Rendering strategy — "Strategy B" (extract & re-render)

`src/reskin.js` linearizes the page into an ordered token stream (inline runs stay inline; only
standalone lines can become headings), assembles a **semantic block model** (headings ranked from the
*original* computed font sizes, paragraphs, definition/glossary lists, figures with captions, data
tables, IMPP/box callouts), and emits clean HTML into a fresh `<main id="pr-reader">`. In-page
`<a name>`/`id` anchors are preserved as zero-width spans so intra-page links keep resolving. The
image-only landing page gets a bespoke hero (`renderHome()`).

Entry points: `PR.reskin.isHome() ? PR.reskin.renderHome() : PR.reskin.reflow()`.

### Where-am-I (chapter / section)

Nothing in a page's content states its place in the book, so `pageRef()` derives it from the URL
(`I.htm` hub · `I.1.htm` section · `IV.5A.htm` annex · `X2.htm` — chapter X's irregular hub name)
against the curated `CHAPTERS` table (titles copied verbatim from `Pruef.htm`). `reflow()` then emits
an eyebrow above the title (`renderCrumb`/`mountCrumb`: *Kapitel VIII · Respirationssystem… ·
Abschnitt 2*, linking up to the hub) and numbers index entries (`numberIndex`). Chapter I is the only
0-based chapter (`I.0` is its introduction) — `ordinal()` normalises that away. `mountCrumb` also
drops the repeated site chrome above the title (tagline + the chapter back-link), which the crumb now
states consistently.

## Architecture

Content scripts share one namespace, `window.__physioReskin` (aliased `PR`), and attach their APIs
to it (`PR.reskin`, `PR.settings`, `PR.ui`, `PR.tools`, `PR.anchor`, `PR.fonts`, `PR.store`,
`PR.activate`). Load order and orchestration matter:

- **`src/boot.css` + `src/boot.js`** (`document_start`) — kill the flash of the original page and
  paint the user's cached paper colour. `body` is `visibility:hidden` (layout preserved) until the
  reskin is ready, so `getComputedStyle().fontSize` stays truthful during heading measurement.
- **`document_end` chain** (order fixed in `manifest.json`): `store → visited → anchor → fonts →
  reskin → ui → tools → settings → activate → content`. `src/content.js` is the orchestrator; the critical
  invariant is **measure original sizes → build reader → apply settings → add `html.pr-on` → reveal
  (`html.pr-ready`)**. `content.css` is injected but inert until `.pr-on`.

Key files:

| File | Role |
|---|---|
| `src/reskin.js` | Strategy-B extraction + re-render pipeline |
| `src/content.css` | Light-DOM reader styles; every rule gated `html.pr-on` and scoped to `#pr-reader` |
| `src/settings.js` | Einstellungen panel state; `apply()` writes CSS vars on `:root` + `data-*` on `<html>` |
| `src/ui.js` / `src/ui.css` | Injected chrome in **one Shadow DOM** (host on `<html>`); `ui.css` fetched via `chrome.runtime.getURL` |
| `src/tools.js` | Study interactions (highlight / notes / pins / lightbox) |
| `src/anchor.js` | Self-healing annotation anchoring — the biggest correctness surface |
| `src/store.js` | `chrome.storage.local` wrapper + a tiny synchronous localStorage mirror for `boot.js` |
| `src/visited.js` | Records pages read (storage key `visited`) and tags links to them `.pr-seen`; off (record and all) when the `progress` setting is false, which content.css also gates the markers on via `html.pr-on[data-progress="1"]` |
| `src/fonts.js` | Registers the bundled woff2 faces from `fonts/` |
| `popup.html` / `src/popup.js` | Toolbar on/off switch |

### Theming / dark mode

`content.css` defines design tokens on `html.pr-on`, with per-background overrides keyed on
`html.pr-on[data-bg="..."]` (`neutral`, `paper`, `white`, `sepia`, `dark`). `settings.apply()`
writes the user's chosen accent to **`--accent-user`**; the theme derives `--accent` from it
(`--accent: var(--accent-user)` in light, lightened via `color-mix(... white)` in dark). Do **not**
write `--accent` directly from JS — an inline `:root` value beats the stylesheet override and
re-breaks dark-mode contrast. Shadow-UI tokens inherit across the boundary from `:root`; the panel
themes via `:host([data-bg="dark"])`.

## Testing

No automated tests. Test against real page HTML with the local harness (details in the project
memory, `reskin-testing`):

- `python3 -m http.server 8756` from the repo root (the site's figures are http-only; a localhost
  http page loads them without mixed-content errors).
- Real page snapshots go in `.test/` (gitignored, **latin-1** — use `grep -a`). Refresh with
  `curl -s http://physiologie.cc/<page> > .test/<page>`.
- `python3 dev/mkharness.py .test/<page> dev/harness_<x>.html` inlines the body and loads the real
  `src/*` chain (with an mtime cache-buster). Drive with the Playwright MCP.
- Representative spread: I.0 (callout-heavy), I.1 (densest, ~825 KB), VIII.2, Einheiten (tables),
  I.htm (hub), Pruef.htm (TOC), home.
- The harness stubs `chrome.storage.local` over `localStorage` (`pr.harness.*`) and
  `chrome.runtime.getURL`, so settings, annotations and the visited record persist and `ui.css`
  loads into the shadow. `?seen=/i.1.htm,/i.3.htm` preseeds the visited record.
- Harness caveats: the `<base href>` makes link hrefs resolve to physiologie.cc while
  `location.pathname` stays `/dev/…`, so a page never records itself as read; `isHome()` keys on
  `location.pathname`, so the homepage is only exercised via a real `/` path.

### Screenshots

Verification shots are throwaway: let the Playwright MCP name them into `.playwright-mcp/`
(gitignored) rather than passing a filename — the repo root is ignored for images precisely because
they used to pile up there. A shot only earns a place in `research/` (tracked) if it documents a
visual decision worth re-reading later, named `before-*` / `after-*`.

## Conventions

- Content scripts are plain IIFEs on the shared `PR` namespace — no bundler, no modules.
- MV3 rejects any extension-root filename starting with `_`; the harness generator/output live in
  `dev/` for that reason.
- Match the surrounding terse, heavily-commented style; comments explain *why*, not *what*.

## Git

Claude may create git commits directly in this repo (the user has authorized this).

- Use **[Conventional Commits](https://www.conventionalcommits.org/)** (`feat:`, `fix:`,
  `refactor:`, `docs:`, …); the common scope here is `reskin`.
- **Never** add co-authorship / `Co-Authored-By` trailers or any "generated by" attribution.
- The project commits directly to `main` (no PR flow). Push only when asked.
