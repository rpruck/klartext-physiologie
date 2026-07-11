# physiologie · reskin

A reskin of **[physiologie.cc](http://physiologie.cc/)** — Hinghofer-Szalkay's *Reise durch die
Physiologie* — inspired by the calm, editorial feel of **[makingsoftware.com](https://www.makingsoftware.com/)**.
Eventual target: a **Chrome extension** that restyles the site in place and adds studying tools
(image zoom/pin, highlighting, margin notes), all stored locally.

This repo currently contains the **interactive design prototype** — the thing to play with and
tune *before* we build the extension.

---

## Quick start

**Double-click `serve.command`** (macOS). It serves the folder locally and opens the prototype at
`http://localhost:8756/prototype.html`.

> Why a server instead of just opening the file? The original site is **http-only**, and Chrome
> blocks http images on a `file://` page (mixed content). Serving over `http://localhost` lets the
> real figures load. If a figure ever can't load you'll see a labelled placeholder instead of a
> broken image.

Alternatively, from a terminal in this folder:

```bash
python3 -m http.server 8756
# then open http://localhost:8756/prototype.html
```

---

## What the prototype does

It renders **real content from `physiologie.cc/I.1.htm`** (Kapitel I — *Membransysteme,
Zellorganellen, Rezeptoren, Apoptose*): headings, prose, the Greek/Latin etymology box, three real
figures loaded from the live site, and both real data tables. On top of that:

### Live design controls (top-right **✦ Design**)
| Control | Options |
|---|---|
| **Lesefont** (prose) | **EB Garamond** (default) · Computer Modern (CMU Serif) · Source Serif 4 · Newsreader · Inter · Source Sans 3 · IBM Plex Sans |
| **Label-/Bildtextfont** | **Inter** (default) · Space Mono · IBM Plex Mono · CMU Typewriter |
| **Notizfont** | **Inter** (default) · IBM Plex Sans · Source Sans 3 · EB Garamond · Space Mono |
| **Schriftgröße / Zeilenhöhe** | sliders |
| **Textbreite** (measure) | 540–880 px |
| **Absatzabstand / Textsatz** | spacing slider · left / justified |
| **Akzentfarbe** | `#0e8373` default + presets + custom picker |
| **Hintergrund** | Papier · Weiß · Sepia · Dunkel |
| **Bilder** | hide decorative junk (on) · figure frame: hairline / shadow / none |
| **Bewegung** | scroll-reveal + micro-interactions on/off |

All settings persist to `localStorage` and re-apply on reload.

### Study interactions
- **Figures** — click one to open the **preview**, where you can **zoom with the scroll wheel or the
  − / + buttons** (double-click toggles zoom, drag to pan, click the % to reset). From the preview,
  **„An den Rand heften"** docks the figure in the sticky left rail. In the rail you can **resize** a
  figure with its **− / + buttons** (it grows to fill the margin, never into the text), **drag to
  reorder**, **collapse** to caption-only (▾/▸), unpin one (✕), or **„Alle lösen"** to clear all.
  Size, order and collapsed state persist.
- **Highlighting** — select text → a popover offers four styles (teal / amber / rose / underline).
  **Right-click any existing highlight** for a context menu to **change its colour or remove it**,
  or add/edit its note.
- **Margin notes** — from the selection popover (or a highlight's context menu) choose **✎ Notiz**;
  a note appears in the right gutter, level with the highlighted text. **Enter** finishes the note,
  **Shift+Enter** adds a line break. **Hovering a note lights up its highlight** so you can see what
  it refers to. Deleting a note asks for confirmation first (and leaves the highlight intact).
- **Undo** — deleting a highlight, a note, or unpinning figures raises a **sonner-style toast** with
  a **Rückgängig** (undo) action. Everything persists locally.
- **Activation reveal** — on load, the reskinned page is "drawn" top→bottom behind a sweeping
  accent line. Replay it any time with **⟲ Reveal** in the top bar. This previews the animation the
  extension will play when it activates on a page.

---

## Design direction (why it looks the way it does)

Extracted from makingsoftware.com's own stack and adapted:

- **Warm paper, near-black ink.** Background `#faf8f3`, not stark white; text is a soft near-black.
- **Serif prose + monospace labels.** A Garamond-class serif carries the reading; a small,
  tracked, uppercase **monospace** handles the "technical" bits — kickers, figure numbers
  (`ABB. 1`), captions, UI labels. This is the single strongest cue from the reference site.
- **One restrained accent** (`#0e8373`), used as *line and tint* — heading rules, table header
  underline, figure numbers, links, note markers — **never as a fill**. Colour appears in small
  doses, which is the opposite of the original's blue/yellow/green blocks.
- **Narrow measure** (~680 px default) so lines stay ~65–75 characters — directly fixes the
  "content too wide" complaint.
- **Generous vertical rhythm** and quiet **scroll-reveal** motion (respects
  `prefers-reduced-motion`).

### What the original throws at us (findings)
`physiologie.cc` is 1990s Netscape-Composer HTML: thousands of `<font>`/`<span>` tags, layout by
`<br>` and `<center>`, **no semantic headings** (hierarchy is faked with font sizes: 32px title /
24px section / 18px subhead / 16px body), inline colours like `rgb(0,0,153)`, and **hundreds of
decorative images** — repeated arrows (`rechtspfeil.gif` ×95), pointing fingers (`Fingerzeig.jpg`),
spacer gifs, coloured dots, a Vitruvian-man bullet. Real figures are the large ones (≥ ~120px).
The reskin's job: neutralise inline colour, infer a real type hierarchy from font size, hide the
decoration, and constrain width. See `research/` for before/after screenshots.

---

## From prototype → Chrome extension (planned)

The prototype's CSS and interaction JS are written to port directly into a Manifest V3 content
script. Sketch:

```
manifest.json          # MV3; matches http://physiologie.cc/*
  content.css          # the reskin (this prototype's <style>, tag-soup-hardened with !important)
  content.js           # classify + hide deco imgs, infer headings, wrap figures, mount tools
  activate.js          # the top→bottom reveal animation, played once when the extension turns on
  tools.js             # preview zoom/pan, pin rail (resize/reorder/collapse), highlight w/ right-click menu, margin notes
  settings.js          # the ✦ Design panel — kept in full so users can tune everything to their needs
  options.html         # the settings panel as an options/popup page
  fonts/               # EB Garamond, CMU Serif, Inter, etc. bundled (no network)
```

The **settings panel ships with the extension** (per request) so every reader can adjust fonts,
width, colour, spacing and image handling. Settings + highlights + notes move from `localStorage`
to `chrome.storage.local`. The **activation reveal** (this prototype's ⟲ Reveal) becomes the
turn-on animation.

**Open decision — rendering strategy** (this is the main thing to settle before building):

- **A · In-place restyle.** Keep the original DOM; inject CSS that overrides fonts/colours/width
  and hides decoration; light JS to wrap figures and mount tools. *Safest* — every link, anchor and
  scrap of content is preserved — but the faked heading structure and `<br>` layout only get so
  clean.
- **B · Reader reflow.** Parse the tag soup into a clean semantic model (exactly what this prototype
  demonstrates) and re-render it. *Closest to the prototype's look*, but riskier: must not drop
  content or break in-page anchors, and heading/figure detection has to be robust across all 200+
  pages.
- **Recommended: A now, with a "Leseansicht" (reflow) toggle later.** Ship the in-place restyle
  first for reliability across the whole site, then add reflow as an optional mode.

---

## Files
```
prototype.html   the interactive prototype (self-contained)
serve.command    double-click launcher (macOS)
HANDOFF.md       full spec + plan for building the Chrome extension
research/        before/after screenshots + notes
README.md        this file
```
