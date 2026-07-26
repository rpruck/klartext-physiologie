# Changelog

All notable changes to **Klartext Physiologie** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-07-27

First release. A Chrome MV3 extension that re-renders
[physiologie.cc](http://physiologie.cc/) as a reading surface and adds local study tools.

### Reading

- **Extract & re-render.** The site encodes its structure visually only — no headings, layout by
  `<br>` and `<center>`, thousands of `<font>` tags — so the page is linearised into a token
  stream, assembled into a semantic block model, and re-emitted as clean HTML. Headings are ranked
  from the *original* computed font sizes rather than guessed.
- **Structure the author drew instead of wrote** is read back out: section labels stamped as images
  (`Historisches`, `PHARM`, `Merke`, …), glossary badges, image bullets, and the centred arrow
  ladders. Data tables keep their `rowspan`/`colspan`; layout tables are dissolved; the yellow
  emphasis boxes survive as callouts.
- **Where-am-I.** Nothing in a page states its place in the book, so it is derived from the URL and
  printed above the title — *Kapitel I · Allgemeine Grundlagen … · Abschnitt 1* — with the chapter
  linking back to its hub. Hub index entries are numbered the same way.
- **Sections.** The author names his sections once, at the top, as a row of links separated by a
  small glyph. That row is read back out and the page folds into those sections. Ctrl+F still finds
  text inside a folded section and opens it.
- **The reading rail** down the right edge: one tick per unit of the page, grouped by section, read
  ticks fading behind you. Per-section meters, hover for names and percentage, click a tick to
  travel there, per-page reset.
- **Bookmarks** — one automatic high-water mark that only ever moves forward, plus any number of
  your own, collected across the whole book in one drawer.
- **Read-tracking.** Pages you have opened are recorded locally and links to them are marked.
- **Figures at their own resolution**, with their captions; the decorative layer is hidden and
  navigation button-images become plain text links.

### Studying

- **Highlighting** in teal, amber, rose or underline, with right-click to recolour, annotate or
  remove.
- **Margin notes** anchored in the right gutter, level with their highlight.
- **Figure lightbox** — scroll/button/double-click zoom, drag to pan — and *„An den Rand heften"* to
  pin a figure as a draggable, resizable card that persists per page.
- **Undo** on every destructive action, via toast.
- **Original ansehen** — arm the scanner, point at any block, and the untouched original opens in a
  window scrolled to the markup that produced it, with that markup marked.
- Annotations are re-anchored by content hash plus a W3C-style text quote, so they survive reloads
  and page shifts.

### Appearance

- **Einstellungen** panel: seven bundled reading faces, size, line height, measure, paragraph
  spacing, justification, accent colour, and five backgrounds including a full dark mode.
- Three lanes — pinned figures left, column centre, notes right — with either side lane
  collapsible.

### Privacy

- Stores everything in `chrome.storage.local`. Makes **no network requests of its own**; the
  typefaces are bundled. Runs on `physiologie.cc` and nowhere else.

[0.1.0]: https://github.com/rpruck/klartext-physiologie/releases/tag/v0.1.0
