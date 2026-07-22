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

The shipping code lives in `src/` and is the source of truth; `README.md` is the user-facing
overview. `prototype.html` (+ `serve.command`) is the pre-extension design prototype — kept for
reference, never a description of what ships.

## Rendering strategy — "Strategy B" (extract & re-render)

`src/reskin.js` linearizes the page into an ordered token stream (inline runs stay inline; only
standalone lines can become headings), assembles a **semantic block model** (headings ranked from the
*original* computed font sizes, paragraphs, definition/glossary lists, lists, figures with captions,
data tables, IMPP/box/labelled callouts), and emits clean HTML into a fresh `<main id="pr-reader">`.
In-page `<a name>`/`id` anchors are preserved as zero-width spans so intra-page links keep resolving.
The image-only landing page gets a bespoke hero (`renderHome()`).

Entry points: `PR.reskin.isHome() ? PR.reskin.renderHome() : PR.reskin.reflow()`.

### Structure the author drew instead of wrote

A lot of this book's semantics is *pictures of words and glyphs*, which the deco heuristics used to
throw away wholesale. Three families are read back out (`LABELS`, `GLOSS_BADGE`, `isBulletSize` in
`reskin.js`):

- **Section labels** — `Histor.jpg` "Historisches", `PHARM.jpg`, `DEF_kl.jpg`, `merke2.jpg`,
  `Etym.jpg`, `exkurs.jpg`, `Anw.jpg` ("Praktische Aspekte" — the wording every link to its `#PrA`
  anchor uses), `Orientierung.jpg`. Three shapes: `wrap` (the picture opens a
  `<div style="margin-left:40px">` that *is* the digression → `<aside class="pr-callout">` around the
  whole container), `lead` (heads a line → labels the block that follows), `banner` (a standalone
  wordmark → an `<h2>`). Labels render as `<p class="pr-label">`, never a heading — `mountCrumb()`
  finds the page title by scanning for the first `H1|H2|H3` and a label heading would hijack it.
  `FKH.jpg` ("FEEDBACK", a footer mailto banner) and `vitru.jpg` (a separator glyph) stay deco.
- **Glossary badges** — `Begriff.jpg` trails a word the page's Begriffe list defines. `buildGlossary`
  indexes that list (always `#BEG`, always local), `matchTerm` maps the inflected word back to its
  entry on a normalised shared prefix (Pleuraspalt → Pleura, teleologisch → Teleologie), and
  `renderRuns` wraps it as `a.pr-term[data-def]`; `tools.js` hangs a hover card off that. A word with
  no entry still gets the dashed rule, just no card.
- **Image bullets** — small glyphs (spheres, asterisks, arrows) at the head of a line become
  `<ul class="pr-list" data-bullet="arrow|dot">`. A list of one is handed back to the prose, since an
  isolated marker is usually the 12×12 dot in front of an "Abbildung: …" caption.
- **Drawn hierarchies** — a centred stack of `<br>`-separated levels with a lone ↑ between them
  (I.0's system hierarchy). Nothing in it is heading-shaped, so linearizing flattened the whole
  ladder into one run-on paragraph. A run of lines that are each either arrow-only or a short label,
  with ≥2 of each, becomes `div.pr-ladder`. Content-based, deliberately **not** keyed on
  `text-align:center` — I.0 nests a left-aligned prose div inside a centred one.

A table whose rows all hold **one** cell is a titled box, not a data grid (`classifyTable`): row 1
becomes `.pr-box-title` + `.pr-box-sub` (split by `headRuns`, where the source drops the font size for
its source line), the rest goes through the normal block pipeline so its bulleted lines become a real
list.

A data grid keeps its `rowspan`/`colspan` — the site groups rows with them ("GPCR" beside its three
receptor families) and dropping them slid every shortened row a column left. `gridRows` walks the
table with a per-column carry so each row knows its true width *and* whether it is short because of a
span above. That tells the three full-width shapes apart: the rows a table **opens** with are its
title (`tableHead` → `.pr-figcap-title`/`-src` in a `<caption>`, the same two-part treatment as a
figure), the same shape partway down is a divider between blocks of the grid (`td.pr-band`), and a
short row under a span is just a row. Headings are painted, never `<th>`: a row whose cells are *all*
coloured where body cells are not becomes `.pr-th` — the top row, and any row a divider just opened.
Inside a cell the `<br>`s are content ("Acetylcholin (M2) / GABA / Histamin" is three ligands, and
dropped they merged into one word), so `renderInlineOf` keeps them — except after a trailing hyphen,
where the author hard-wrapped a word to fit the 1990s column.

Figure captions are the same two-part shape: "Abbildung: …" over the source it came from ("Nach einer
Vorlage bei …"), separated by a `<br>` — or, on a few pages, by a whole `<div>`. `assemble` records
where it joined lines (`brk`) so `splitCaption` can peel the citation back off, and the block-boundary
variant is absorbed from the paragraph after the figure (`CAP_SRC_BLOCK`, deliberately stricter, since
prose may legitimately open "Nach der Geburt…"). Both halves render inside one `figcaption.pr-figcap`
as `.pr-figcap-title` + `.pr-figcap-src`, styled to match the box title/sub pair above. Left merged,
the caption lines also seed the glossary heuristic — hence the `CAP` guards in `isGloss`/`isEntry`.

- **The section strip** — near the top of every section page the author prints his own contents:
  a row of links into the page separated by `vitru.jpg` (30×34). It is the only statement the
  book makes about which of a page's headings are *sections*: I.1 names nine of its forty-six,
  and every one of those nine anchors lands on a heading. `SPINE_SEP` in `reskin.js` reads it
  back as `<nav class="pr-spine">`; `outline.js` builds the page's collapsible sections from it.
  The glyph is the discriminator, not the position — directly underneath sits an
  identically-shaped row of links to the page's *definitions*, separated by `dot_silver.jpg`
  under a `DEF_kl.jpg` label. An entry is everything between two separators, aimed at the first
  link in it: the source splits some entries across two `<a>`s sharing a target ("Bewegung und" +
  " Transport, Kompartimentierung") and leaves the chemistry outside the link ("Calcium" then
  "(Ca++)"). It may not *open* with unlinked text — "Natriumkanäle · Spannungsgesteuert · …" is a
  heading with a strip after it. The mid-page strips (I.1 has six) are the same shape and render
  as compact sub-indices.

### Provenance — reading the original back

Every heuristic above was tuned by comparing the rendered result against the markup it came from,
and the pipeline destroys that markup (`mountReader` wipes `<body>`). Two additions make the
comparison a feature rather than a second browser window with the extension switched off:

- **The stamp.** `ord(el)` in `reskin.js` numbers a source element the first time the walk consults
  it and writes `data-pr-o` on it. The number rides `token → line → block → rendered element`: a
  text token takes it from the text node's parent, `fig`/`table`/`label`/`nav`/`bullet` tokens from
  their own element, a line from the first run that has one, a block from its opening line
  (the grouped shapes — para, deflist, ladder — keep their own, since they are flushed long after
  it), and `renderBlocks` writes it out through `stamp()`. Deflist entries, ladder steps, spine
  links, caption halves and table rows/cells are stamped individually, so a jump lands on the
  entry rather than on the list. Lazy on purpose: only consulted elements are numbered.
  This is what text matching could never do — the label blocks whose words are *pictures*, the box
  titles split by `headRuns`, the hyphen-unwrapped cells, the `"NNach"` typo, the 12×12 dot in
  front of every "Abbildung:" caption. Synthetic blocks (the crumb, the pager pills, the home hero)
  carry no stamp and `inspect.js` falls back to the nearest stamped block above them.
- **The snapshot.** `takeSnapshot()` runs as the first statement of `mountReader()` — the one point
  after *all* stamping (box tables re-enter `tokenize`/`renderBlocks` from inside `renderTable`) and
  before the attribute stripping, so the body keeps the `bgcolor` and link colours it was drawn
  with. Held as a string for the session (~900 KB on I.1) and read by `PR.reskin.snapshot()`.
  `<script>` comes out of the clone: the book has none, but the dev harness loads the whole `src/`
  chain from `<body>`, and a `srcdoc` frame is same-origin — left in, the snapshot reskinned itself
  inside its own window. `<base href>` is `document.baseURI`, not `location.href`, so the harness's
  own `<base>` keeps resolving the figures.

`inspect.js` is then one `closest('[data-pr-o]')` and one `querySelector`. It arms from a topbar
icon (`html.pr-inspect` gives the reader a crosshair and suppresses selection, which also keeps
`tools.js`'s highlight popover out of the way), draws a hairline above the block under the pointer,
and on click renders the snapshot into an `<iframe srcdoc>` scrolled to the match. The picker
**stays armed** while the window is open and later picks only move the marker — never re-render —
so shrinking the window to one half turns the reader into a walkable comparison. A target with no
shape worth flashing (that 12×12 dot, an empty `<a name>`) grows to the first ancestor that has
one. Geometry persists under its own `inspect` storage key, not in `settings`.

### Sections and reading progress

A section page is otherwise one uninterrupted column, so `src/outline.js` folds it into an
accordion and `src/progress.js` draws a ruler of it down the right edge.

- **`outline.js`** — the spine above the first `H2` gives the sections; the rest of the preamble
  is swept for the `#PrA`/`#cm` links the author sets off with `cloud3.jpg`/`redball.gif`
  (skipping asides, and requiring the anchor to *open* its block, or the Definition shortcuts
  would cut sections in half); anything past the last of those falls back to one section per
  `H2`. Fewer than three sections, or under 6 000 characters of text (Einheiten is 2 000; I.0,
  the shortest real page, is 34 800), and nothing is built. The row title is the **strip's**
  label, not the target heading — "Zellmembran" scans better than "Zellmembran: Panta rhei", and
  it works where the target is a paragraph (I.0). The page's Begriffe list is folded too,
  unnumbered: 25 entries of etymology above everything else pushed the whole list below the fold.
  Bodies are hidden with **`hidden="until-found"`**, so Ctrl+F still finds folded text and
  reveals it via `beforematch` — that is the whole reason the accordion doesn't break the
  browser's own search.
- **`progress.js`** — ticks are shared between sections by *text weight*, not pixels, so folding
  a section doesn't make the rail jump. Read state is a high-water fraction per section; read
  ticks fade. One automatic "zuletzt gelesen" mark plus any number of manual bookmarks, anchored
  by the `.pr-block` content hash like annotations are. The automatic one is a high-water mark
  too (`rankOf` orders marks by segment + fraction): scrolling back to re-read a sentence is
  re-reading, not un-reading, and holding the place you got to while you do it is the whole job.
  Only the rail's reset moves it back. The rail opens on *approach* (`REACH`, a `pointermove`
  proximity test adding `.awake`) rather than on hover — widening the element to reach that far
  would blanket 140px of margin in `pointer-events` and take the text under it out of selection
  range on a narrow window.
- **`bookmarks.js`** — the same marks read back across the whole book, in a drawer beside
  Einstellungen. The rail can only ever answer "where are the marks on *this* page", so the
  question the reskin makes worth asking — where did I mark something in the *book* — had no
  surface. Every page record lives under `page:<path>` in one storage area, so the list is one
  `store.all()` and a sort by recency (undated marks — set before this existed — sort last, newest
  added first, the only order their position in the record states). It never opens a page: the
  naming a row needs (`pageTitle`, `secTitle`, `label`, `t`) is captured by `setMark()` and stored
  **on the mark**. Chapter and section numbers are the exception — `pageRef()`/`ordinal()` derive
  those from the path, so storing them would only let them rot. The link target is derived too:
  `pageRef().file` rebuilds the page as the *server* spells it (uppercase numeral and annex,
  always `.htm`), because `pageKey()` lowercases and physiologie.cc is case-sensitive — a row
  linking at `/i.0.htm` 404s. A row is a real `<a href="…#pr-mark-<hash>-<n>">`, which makes
  middle-click and new-tab free; `consumeHash()` lands on the block at the other end, and lands
  again on `load`, because at `document_end` the figures are unsized boxes and everything above
  the target is still moving. Setting and listing marks are the two halves of one topbar pill and
  are **independent of the rail** — the "Fortschrittsleiste" toggle hides the ruler only.

Two traps this cost real time on, both from `content-visibility: hidden`:

- A folded body is **still an element in the flow** — with padding it kept a few pixels of height
  and everything you scrolled past counted as read. `.pr-sec-body` gets its padding only when open.
- Descendants of a folded subtree keep reporting the geometry they had when last on screen, so
  `getBoundingClientRect()` cannot answer "is this visible". `closest('[hidden]')` can, and
  `layoutNotes`/`blockOnLine` both use it.

`content.js`'s order is load-bearing: **build the outline with every section open** → `assignBlockIds`
→ `tools.restore` → *then* `applyState()` folds. Reversed, block ancestry is measured through
hidden nodes and no highlight can be restored.

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
  reskin → ui → tools → outline → progress → bookmarks → inspect → settings → activate → content`. `src/content.js` is the
  orchestrator; the critical invariant is **measure original sizes → build reader → apply settings →
  add `html.pr-on` → build the outline open → assign block ids → restore annotations → fold →
  reveal (`html.pr-ready`)**. `content.css` is injected but inert until `.pr-on`.

Key files:

| File | Role |
|---|---|
| `src/reskin.js` | Strategy-B extraction + re-render pipeline |
| `src/content.css` | Light-DOM reader styles; every rule gated `html.pr-on` and scoped to `#pr-reader` |
| `src/settings.js` | Einstellungen panel state; `apply()` writes CSS vars on `:root` + `data-*` on `<html>` |
| `src/ui.js` / `src/ui.css` | Injected chrome in **one Shadow DOM** (host on `<html>`); `ui.css` fetched via `chrome.runtime.getURL` |
| `src/outline.js` | The page's sections, read off the author's strip, and the accordion over them |
| `src/progress.js` | The reading rail: read-state per section, bookmarks, per-page reset |
| `src/bookmarks.js` | Every bookmark in the book, in one drawer — read straight out of storage |
| `src/inspect.js` | The original beside the reskin: pick a block, read the markup it came from |
| `src/tools.js` | Study interactions (highlight / notes / pins / lightbox / glossary hover card) |
| `src/anchor.js` | Self-healing annotation anchoring — the biggest correctness surface |
| `src/store.js` | `chrome.storage.local` wrapper, the shared per-page record (`PR.page`), and a tiny synchronous localStorage mirror for `boot.js` |
| `src/visited.js` | Records pages read (storage key `visited`) and tags links to them `.pr-seen`; off (record and all) when the `progress` setting is false, which content.css also gates the markers on via `html.pr-on[data-progress="1"]` |
| `src/fonts.js` | Registers the bundled woff2 faces from `fonts/` |
| `popup.html` / `src/popup.js` | Toolbar on/off switch |

### The three lanes (figures · text · notes)

Pinned figures float in the left margin, the column sits in the middle, margin notes hang off its
right edge. Two topbar icon toggles (`laneImg`/`laneNotes`, persisted settings, mirrored to
`<html>` **and** the shadow host as `data-lane-img`/`data-lane-notes`) collapse either side lane:
`content.css` derives **`--lane-shift`** from the pair and slides the column with `left` — it keeps
`margin: 0 auto`, so its width never changes and every geometry consumer keeps reading
`getBoundingClientRect()`. The surviving margin gets the whole spare width; collapsing the *image*
lane is also how figures and notes end up on the same side. `ui.css` reads the same variable across
the shadow boundary (the note gutter travels with the column, widens when the image lane is off, and
is `display:none` when its own lane is — which `layoutNotes()` also early-returns on).

A pin may be pushed **past** an edge: `clampXY` in `tools.js` is the one rule the drag and every
re-render share (they used to disagree, so a parked pin was hauled back on the next resize), and it
allows any position that leaves `PEEK` (44px) of the card on screen — measured against
`clientWidth`, since a strip under the scrollbar is not a strip. Such a pin gets `.offscreen`
(dimmed); double-clicking its bar parks it back beside the column, in whichever margin is currently
the roomier one (`parkX`, which `defaultPin` uses too — with a lane collapsed the two margins are
wildly lopsided).

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
- **The book runs in quirks mode**, and the harness carries the page's own doctype so it does too.
  `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">` has no system identifier, which
  makes every page `BackCompat` (I.1's doctype is worse still — its *name* is `doctype`, not
  `html`). The consequence that bites: `document.documentElement.clientHeight` is the height of the
  **document**, not the viewport (10 616px on X.1). Measure the viewport off
  `document.scrollingElement` — `<body>` in quirks, `<html>` in standards, the viewport in both.
  The harness used to emit a clean `<!doctype html>`, which hid this class of bug entirely.
- Representative spread: I.0 (callout-heavy), I.1 (densest, ~825 KB), VIII.2, Einheiten (tables),
  I.htm (hub), Pruef.htm (TOC), home.
- The harness stubs `chrome.storage.local` over `localStorage` (`pr.harness.*`) and
  `chrome.runtime.getURL`, so settings, annotations and the visited record persist and `ui.css`
  loads into the shadow. `?seen=/i.1.htm,/i.3.htm` preseeds the visited record. `get(null)`
  answers with the whole store, which is how `bookmarks.js` finds every `page:*` record.
- Harness caveats: the `<base href>` makes link hrefs resolve to physiologie.cc while
  `location.pathname` stays `/dev/…`, so a page never records itself as read, every harness page
  shares one page record, and a bookmark set there names no chapter (`pageRef` has no `I.1.htm` to
  read) — seed a `pr.harness.page:/i.1.htm` record by hand to exercise that. `isHome()` keys on
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
