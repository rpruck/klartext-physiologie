# Handoff — physiologie.cc reskin → Chrome extension

This document is everything needed to build the **Chrome (MV3) extension** in a fresh session
without re-exploring the source site. Read it alongside `prototype.html` (the working design
prototype) and `README.md` (user-facing overview).

---

## 0 · Where we are

- **`prototype.html`** is a complete, self-contained, verified design prototype. It renders real
  chapter content from `physiologie.cc/I.1.htm`, applies the target reskin, and implements every
  interaction the extension needs (settings, image zoom/pin, highlighting, margin notes, undo).
- The extension does **not** exist yet. This handoff + the prototype's CSS/JS are the raw material.
- The prototype was built and signed off feature-by-feature with the user. Nothing about the visual
  design or interaction set is speculative — it's all been seen and approved.

### Immediate next actions
1. Get a **decision from the user on rendering strategy** (§5) — this shapes everything. Recommended
   default is **A (in-place restyle)** shipping first, reflow later.
2. Confirm the two small pending UX decisions carried over in `README.md` / the last session:
   - Note deletion currently has **both** a confirm dialog *and* an undo toast — offer to drop the
     confirm (undo alone is the modern pattern).
   - Pinned-figure resize is **bounded to the margin** (no text overlap). Confirm that's wanted vs.
     letting pinned figures float over the text when enlarged.
3. Scaffold the MV3 extension (§6), port CSS/JS from the prototype (§7), swap storage to
   `chrome.storage.local` with **per-page keys for annotations** (§6.4), and harden **annotation
   anchoring** (§6.5) — the single biggest correctness risk.

---

## 1 · Source site anatomy (physiologie.cc)

Old-web static site, **Netscape Composer** output, **ISO-8859-1**, **HTTP-only** (no HTTPS).

### Navigation / URL structure
```
index.html            → splash, links everything to Pruef.htm
Pruef.htm             → main table of contents (18 chapters + appendices)
  I.htm … XVIII.htm   → 18 chapter hubs (Roman numerals). Each hub lists its sections.
    I.0.htm … I.11.htm→ actual CONTENT pages.  Pattern: <Roman>.<section>.htm
  Appendices: RefWT.htm, Einheiten.html, Exk_Mol_etc.html, Hinweis2.html, Buch.htm,
              HHS.deutsch.htm, Lachen.htm
```
The extension should match **all** of `physiologie.cc/*` (content pages, hubs, TOC, appendices).
Chapter hubs and content pages share the same tag-soup markup, so one reskin covers them all;
the TOC/hub pages are mostly link lists and reskin trivially.

### Markup characteristics (why this is hard)
Representative content page `I.1.htm` tag histogram:
`font ×2470 · span ×4702 · br ×2041 · big ×806 · a ×780 · img ×660 · div ×396 · sup ×265 ·
hr ×124 · sub ×73 · small ×54 · table ×16 · center ×1`. **Zero `<h1>–<h6>`.**

- Structure is visual-only: headings are big/bold/coloured `<font>`/`<big>` runs; layout is `<br>`,
  `<center>`, and nested `<font>`/`<span>` with **inline styles** (high specificity — overrides need
  `!important` or DOM normalisation).
- `<body style="background-color: rgb(245,253,253)">` (some pages `251,255,254`).
- Charset is ISO-8859-1, but the content script reads the **already-decoded DOM**, so encoding is a
  non-issue for us.

### Heading inference (no semantic tags → use computed font-size)
Measured computed sizes on body-ish elements: **16px = body** (normal ×1978, bold ×594),
**13px = captions/fine print**, **18px ≈ subhead** (×40), **24px = section head** (×33),
**32px = page title** (×1). Heuristic used in the prototype's extractor:
```
fontSize >= 30 → h1 ; >= 24 → h2 ; >= 21 → h3
else if bold && fontSize >= 17 && short(<90 chars) → h3 (run-in)
else → body paragraph
```

### Image taxonomy — decorative vs content
660 `<img>` on one page; ~108 unique. Two classes:

**Decorative (hide these).** Small, repeated icons/spacers. Top offenders by frequency:
`rechtspfeil.gif` (19×12 arrow, ×95), `Fingerzeig.jpg` (35×35 pointing finger, ×62),
`PlL.jpg`/`Platzhalter.jpg` (spacer gifs), `0L.jpg`/`0R.jpg` (12×12 corner dots),
`vitru.jpg`, `index_finger.jpg`, `arrow.jpg`, `Begriff.jpg`, `yellowball.jpg`, `dot_silver.jpg`,
`purpledot.jpeg`, `redball.gif`, `orangedot.jpg`, `mauveDot.jpg`, `excl_M.jpg`, `Icon_rund.jpg`,
`STERN.jpg`, `aster.jpg`, `nicebar.jpg` (500×14 divider bar), plus nav images
`nexttopic.gif`/`previous.gif` and splash art (`welcome2.jpg`, `reise1.jpg`, `man*.jpg`, `HHS*.jpg`,
Aesculapius snake, Ionic column, smiley, Dilbert cartoons).
> **Heuristic:** `min(naturalWidth, naturalHeight) < ~60px` **OR** filename ∈ known-decoration list
> **OR** it's a nav/splash image → hide. Keep a maintainable filename allow/deny list because size
> alone misclassifies a few.

**Content figures (keep + make interactive).** Large textbook scans, e.g. `HP4_3-10.jpg` (615×332),
`Grundschema.jpg` (430×434), `PLip-membr_2.jpg` (682×447), `PhyGl4_3.1,3.2.jpg` (648×589). Named
like `HP4_*`, `RDP9_*`, `BP_*`, etc.
> **Heuristic:** `naturalWidth >= 120 || naturalHeight >= 110` → treat as a figure (wrap, caption,
> click-to-zoom, pinnable). Captions are the `<font size="-2">`/13px text immediately following,
> often starting `"Abbildung:"` or `"Nach …"`.

### Colours to neutralise / preserve
- **Neutralise:** inline `rgb(0,0,153)` dark-blue table headers, assorted coloured `<font>` text,
  and the aqua page background → map onto the subtle palette (§4).
- **PRESERVE (important, easy to get wrong):** the **yellow boxes are meaningful**. The TOC states
  *"Anmerkungen in gelben Feldern nehmen exemplarisch Bezug auf vom IMPP abgefragte Inhalte"* — the
  yellow fields flag **exam-relevant (IMPP)** content. Do **not** hide them; restyle them as an
  accent **callout** (e.g. left-accent card labelled "IMPP"). Detect via yellowish background colour
  on a `<table>`/cell (`rgb(255,255,0)`-ish / high R+G, low B).

Before/after screenshots are in `research/` (`before-*` = original, `after-*` = prototype).

---

## 2 · What the reskin does (design intent)

Borrowed from **makingsoftware.com** (its own stack was inspected): warm off-white "paper",
near-black ink, a **Garamond-class serif for prose**, a small tracked **sans/mono for labels**
(kickers, figure numbers, captions), **one restrained accent** used only as line/tint (never fill),
a **narrow reading measure**, generous vertical rhythm, and quiet motion. This directly fixes the
user's complaints: too wide, garish colour, cluttered decorative images, dated type.

---

## 3 · Prototype feature inventory (all built & verified)

- **Settings panel** (injected, top-right ✦ Design): prose font, label font, note font, font size,
  line height, content width, paragraph spacing, text alignment, accent colour (swatches + custom),
  background (paper/white/sepia/dark), hide-decorative-images toggle, figure frame, motion toggle,
  reset. Persists. **Ships with the extension** (explicit user requirement).
- **Figures:** click → **preview (lightbox)** with **zoom** (scroll wheel toward cursor, − / +
  buttons with % readout, double-click toggle, drag-to-pan, click-% to reset). "An den Rand heften"
  → docks into the **left pin rail**. In the rail: **resize** (− / +, bounded to margin so it never
  overlaps text), **drag-reorder**, **collapse** to caption-only, unpin one, "Alle lösen".
- **Highlighting:** select text → popover (teal/amber/rose/underline). **Right-click an existing
  highlight** → shadcn-style **context menu** (change colour, add/edit note, remove).
- **Margin notes:** anchored in the right gutter, level with the highlight. **Enter** finishes,
  **Shift+Enter** newline. **Hovering a note lights up its highlight.** Delete → confirm dialog.
- **Undo:** deleting a highlight/note or unpinning shows a **sonner-style toast** with **Rückgängig**.
- **Activation reveal:** on load the page is "drawn" top→bottom behind a sweeping accent line
  (⟲ Reveal replays it). This is the intended **extension turn-on animation**.

---

## 4 · Design tokens (copy verbatim from the prototype `:root` + `DEFAULTS`)

```
--accent : #0e8373
--paper  : #faf8f3   --ink : #20262a   --ink-soft : #5d6b6a
--measure: 680px (range 540–880)   --fs : 19px (16–24)   --lh : 1.68 (1.35–1.95)   --gap : 1em
Backgrounds: paper #faf8f3/#20262a · white #fff/#191c1e · sepia #f3ead6/#3b3225 · dark #17140f/#eee7db
```
Font stacks live in `PROSE_FONTS`, `LABEL_FONTS`, `NOTE_FONTS` maps in the prototype script.
Defaults: **prose = EB Garamond**, **label = Inter**, **note = Inter**.
Prototype loads EB Garamond / Inter / Source Serif 4 / Newsreader / Source Sans 3 / IBM Plex
Sans+Mono / Space Mono from **Google Fonts** and CMU Serif / CMU Typewriter from
`cdn.jsdelivr.net/npm/computer-modern@0.1.2`. **In the extension, bundle all as local `woff2`** and
serve via `@font-face` + `web_accessible_resources` (no network; respects offline/privacy).

---

## 5 · THE decision: rendering strategy (settle this first)

The reskin can restyle the real tag soup in place, or rebuild it into clean semantic HTML. This is
the biggest architectural fork.

**A · In-place restyle** — keep the original DOM; inject CSS overriding fonts/colour/width + light JS
to hide decorative images, wrap real figures, mount tools, and infer heading levels by tagging
elements (e.g. add `data-h="2"` based on computed font-size). Because inline styles/`<font>` win on
specificity, expect heavy `!important` and/or JS that strips inline `style`/`color`/`size`.
- *Pros:* safest — every link, in-page anchor (`#Z_Golgiapparat` etc.), table and scrap of content
  is preserved; robust across all 200+ pages; low risk of dropping content.
- *Cons:* the faked `<br>`-based layout and pseudo-headings only get so clean.

**B · Reader reflow** — parse the tag soup into a semantic model and re-render it (exactly what the
prototype demonstrates: a `BLOCKS` model → clean `<h*>/<p>/<figure>/<table>`). The prototype already
contains a **working DOM→model extractor** (see below) and the model→HTML renderer.
- *Pros:* looks exactly like the prototype; best typography and rhythm.
- *Cons:* riskier — must not drop content or break in-page anchors; heading/figure/caption/table
  detection must hold across every page; extraction heuristics need per-chapter spot-checks.

**Recommendation: ship A first** (reliable everywhere), then add a **"Leseansicht" (reflow) toggle**
that runs B. The prototype's extractor is the seed for B — it's the `page.evaluate` TreeWalker used
during exploration: walk `SHOW_ELEMENT|SHOW_TEXT`, accept `table/img/hr` + text; classify text runs
by computed font-size/weight into headings vs paragraphs; emit `{t:'h'|'p'|'fig'|'table'|'hr'}`.
Re-derive it from the prototype's `BLOCKS` shape and the §1 heuristics.

---

## 6 · Extension architecture (MV3)

### 6.1 File layout
```
manifest.json
src/
  content.css        # the reskin — ported from prototype <style> (hardened with !important)
  content.js         # boot: classify+hide deco imgs, tag headings, wrap figures, mount panel+tools
  reskin.js          # DOM transforms (A) and/or model extract+render (B)
  tools.js           # preview zoom/pan · pin rail (resize/reorder/collapse) · highlight+ctx menu · notes · toaster · confirm
  settings.js        # ✦ Design panel + apply() + chrome.storage sync
  activate.js        # top→bottom reveal on turn-on
  store.js           # chrome.storage.local wrapper (global settings + per-page annotations)
fonts/               # *.woff2 (EB Garamond, CMU Serif/Typewriter, Inter, Source Serif 4,
                     #        Source Sans 3, IBM Plex Sans/Mono, Newsreader, Space Mono)
icons/               # 16/32/48/128
```

### 6.2 manifest.json (sketch)
```jsonc
{
  "manifest_version": 3,
  "name": "physiologie · reskin",
  "version": "0.1.0",
  "permissions": ["storage"],
  "action": { "default_title": "physiologie reskin" },   // toolbar toggle for the panel
  "content_scripts": [{
    "matches": ["http://physiologie.cc/*", "http://www.physiologie.cc/*"],
    "css": ["src/content.css"],
    "js": ["src/store.js","src/reskin.js","src/tools.js","src/settings.js","src/activate.js","src/content.js"],
    "run_at": "document_end"
  }],
  "web_accessible_resources": [{
    "resources": ["fonts/*"],
    "matches": ["http://physiologie.cc/*", "http://www.physiologie.cc/*"]
  }]
}
```
`@font-face` `src: url(chrome-extension://__MSG_@@extension_id__/fonts/…woff2)` — or use
`chrome.runtime.getURL('fonts/…')` to build the stylesheet in JS. **Mixed content is NOT a problem
here** (unlike the file:// prototype): the content script runs inside the http page, so the site's
http images load fine.

### 6.3 Content-script boot order
1. Read settings from storage → set CSS vars + `data-*` on `<html>`/`<body>` (same as prototype
   `apply()`).
2. Run reskin transforms (A): hide decorative imgs, tag heading levels, wrap `<img>` figures in
   `<figure>` + caption, restyle tables, promote yellow boxes to IMPP callouts, constrain width.
3. Mount the settings panel, pin rail, note gutter, toaster, lightbox, context menu (inject the
   prototype's markup).
4. Restore this page's annotations (highlights/notes/pins) from storage and re-anchor them.
5. Play the activation reveal.

### 6.4 Storage model (KEY CHANGE from prototype)
Prototype uses `localStorage` with single-page keys. In the extension:
- **Settings = global**: `chrome.storage.local['settings']`.
- **Annotations = per page**: key by normalised path, e.g.
  `chrome.storage.local['page:/I.1.htm'] = { highlights:[…], notes:[…], pins:[…] }`.
  (The prototype's `physio.reskin.{settings,highlights,pins}` keys collapse to this.)
- Wrap all reads/writes in `store.js` (async). Note `chrome.storage` is async — the prototype's
  synchronous `load/save` calls become `await`/callbacks.

### 6.5 Annotation anchoring (BIGGEST correctness risk)
The prototype anchors highlights as `{ b: <block index>, start, end }` where `b` is a `data-b`
counter assigned during render. That's stable **only because the prototype's content is a fixed
`BLOCKS` array.** On the real site it will break if block indexing isn't deterministic or the DOM
shifts. Harden with a **robust, self-healing anchor** (W3C-annotation style):
- Store, per highlight: a **container selector/path** + **text-quote** (`exact` + short `prefix`/
  `suffix`) + char offset as a hint.
- On load, resolve by: find container → search its text for the quote (offset as tiebreaker) → wrap.
  Fall back to prefix/suffix search if offsets moved. Drop (don't crash) if unresolvable.
- Keep the existing `wrapRange(el,start,end,…)` splitter (it's solid); only the *anchor lookup*
  needs upgrading. In **reflow (B)** mode, anchor to the reconstructed block's stable id derived from
  its source (e.g. a hash of the heading path), not a positional counter.

### 6.6 Settings panel & activation
Port `settings.js` (control wiring + `apply()`) and `activate.js` (the reveal) almost verbatim.
Toolbar `action` click → toggle the injected panel (and/or a popup mirror). Decide whether the reveal
plays **every load** or **once per session** (recommend once per session via a storage flag, with the
⟲ Reveal control kept for manual replay).

---

## 7 · Porting map — where each piece lives in `prototype.html`

The `<script>` is sectioned by numbered banner comments:
```
1 REAL CONTENT   BLOCKS[]                         → replace with live DOM (A) or extractor output (B)
2 RENDER         render(), hlblock/data-b         → the model→HTML renderer (reflow B)
3 SETTINGS       PROSE/LABEL/NOTE_FONTS, DEFAULTS,
                 apply(), all control wiring       → settings.js  (swap localStorage→chrome.storage)
4 REVEAL-ON-SCROLL IntersectionObserver           → keep as-is
5 FIGURE ZOOM+PIN openLightbox/lbZoomAt/lbApply,
                 pin rail render/resize/reorder/
                 collapse, pinDragOver             → tools.js
6 HIGHLIGHTS+NOTES wrapRange, globalOffset,
                 commitHighlight, removeHighlight,
                 restoreHighlight, context menu,
                 confirmDialog, showToast,
                 makeNote, layoutNotes             → tools.js  (upgrade anchoring per §6.5)
7 GLOBAL EVENTS  esc/mousedown/scroll/resize       → keep
8 ACTIVATION     playReveal()                      → activate.js
9 BOOT           render→apply→renderPins→reveal    → content.js orchestration
```
CSS: the entire `<style>` block is the design system + component styles. Move to `content.css`,
scope defensively (prefix a root class, e.g. `html.pr-on …`) so page styles can't leak in and our
styles reliably win. Expect to add `!important` on core type/colour resets to beat inline `<font>`.

---

## 8 · Gotchas & pitfalls
- **Inline-style specificity:** `<font>` attrs and inline `style=` beat plain selectors. Either
  `!important` the resets or strip inline `style/color/size/bgcolor` in JS on content nodes.
- **In-page anchors** (`I.1.htm#Z_Golgiapparat`): preserve `id`/`name` attributes when transforming
  (esp. in reflow mode) or intra-page links break.
- **Don't hide the yellow IMPP boxes** (§1). Test that they become callouts, not casualties.
- **Decorative-image list needs maintenance** — size heuristic misses a few; keep a filename list.
- **Async storage** — no synchronous reads; guard first paint (apply settings ASAP to avoid FOUC;
  consider injecting a tiny critical-CSS var block at `document_start`).
- **`chrome.storage.local` quota** is generous but not infinite; annotations are small text — fine.
- **Reveal + real content:** the prototype reveal covers a synthetic page; on the live DOM make sure
  the cover matches the (themed) background so it reads as "drawing in," not a flash.
- Match **both** `physiologie.cc` and `www.physiologie.cc`.

## 9 · Open questions for the user
1. **Rendering strategy** — A-first-then-B (recommended) vs straight to B? (§5)
2. **Note delete:** keep confirm **and** undo, or undo only?
3. **Pinned resize:** margin-bounded (current) or allow floating over text when enlarged?
4. **Reveal cadence:** every page load vs once per session (recommended)?
5. **Distribution:** personal/unpacked load, or Chrome Web Store listing (affects icons, privacy
   policy, review)?

## 10 · Testing
- Spot-check the reskin on a spread of pages: a content page (`I.1.htm`), a physiology-heavy one
  (`VI.htm`/`VIII.htm` sections), a chapter hub (`I.htm`), the TOC (`Pruef.htm`), and an appendix
  (`Einheiten.html`) — heading inference and figure/deco classification must hold on all.
- Verify annotations **survive reload** and re-anchor correctly (§6.5) — the key regression risk.
- Confirm figures (site's http images) load inside the extension, and bundled fonts load offline.
- Re-run the prototype's interaction checks (zoom/pin/resize/reorder/collapse, highlight ctx menu,
  notes with Enter/Shift+Enter + hover-lightup, confirm, undo toasts) against the live DOM.

---
*Prototype and this handoff produced with Claude Code. `serve.command` runs the prototype locally.*
