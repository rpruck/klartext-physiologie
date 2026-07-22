/* ══════════════════════════════════════════════════════════════════════
   reskin.js — Strategy B: extract the tag soup into a semantic block model
   and re-render clean HTML.

   The site encodes structure only visually and ambiguously (a large/bold run
   may be a heading, an emphasised term, a caption, or callout text), so no
   in-place restyle can recover it. Instead we LINEARIZE: walk the DOM in
   order, concatenating INLINE runs (span/font/i/b/a/sup/sub…) into a continuous
   stream so emphasis stays inline (<em>/<strong>); only STANDALONE lines (text
   bounded by <br>/block edges) are eligible to be headings, and font-size only
   ranks them into h1/h2/h3.

   content.js calls, at document_end (BEFORE .pr-on, while boot.css keeps the
   body visibility:hidden so getComputedStyle still reports the site's original
   sizes):
     PR.reskin.isHome() ? PR.reskin.renderHome() : PR.reskin.reflow()
   Both wipe <body> and mount a clean <main id="pr-reader">, returned to the
   caller so anchor.assignBlockIds / tools can wire onto it.

   In-page anchors (<a name>/id) are preserved as zero-width
   <span class="pr-anchor" id="…"> at their source position, so intra-page
   links (I.1.htm#Z_Golgiapparat …) keep resolving.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const PR = (window.__physioReskin ||= {});

  const INLINE = new Set(['A', 'SPAN', 'FONT', 'B', 'I', 'EM', 'STRONG', 'BIG', 'SMALL',
    'SUP', 'SUB', 'U', 'TT', 'ABBR', 'MARK', 'S', 'STRIKE', 'NOBR', 'CODE', 'WBR', 'Q', 'CITE', 'VAR']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'LINK', 'META', 'IFRAME', 'MAP', 'AREA']);

  const base = (s) => (s || '').split('/').pop().split('?')[0].split('#')[0];
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  /* ── image taxonomy ─────────────────────────────────────────────────── */
  const NAV_LABEL = {
    // man_KapUe points at Pruef.htm — the book's index, not the chapter's; the
    // chapter overview is the hub, which the crumb links to.
    'previous.gif': '‹ Zurück', 'nexttopic.gif': 'Weiter ›', 'man_kapue.jpg': 'Inhaltsverzeichnis',
    'homebut.jpg': 'Startseite', 'los_gehts.jpg': 'Los geht’s ›', 'rechtsblau.jpg': 'Weiter ›',
    'linksblau.jpg': '‹ Zurück', 'fua.jpg': 'Fragen & Antworten',
    'reise12.jpg': 'Zu den Prüfungsfragen', 'reise3.jpg': 'Zu den Prüfungsfragen',
  };
  // Single-use decorative art (mascots, motto banners, section labels) that the
  // size/repeat heuristics can't catch. Maintained deny-list — deco detection on
  // this site is inherently a curated list plus the size/repeat/aspect signals.
  // greenbutton.jpg is NOT a pager — it's the badge that marks a reference-value
  // block ("● Calcium / ☞ s. dort"), 86× across the book and never once a next
  // link. As a nav image it rendered a stray "Weiter ›" pill mid-article that
  // jumped to RefWT.htm, doubling the "Referenzwerte"/"dort" link beside it.
  // Drop the badge: 67 of those blocks link RefWT themselves, the rest print
  // the values inline.
  const DECO = new Set(['greenbutton.jpg',
    'begriff.jpg', 'begriffe.jpg', 'exkurs.jpg', 'spruchband.jpg', 'snake.jpg',
    'column.gif', 'smile1.jpeg', 'openacc.jpg', 'lstrc_archivelogo.png', 'merke.jpg', 'merke2.jpg',
    'pharm.jpg', 'histor.jpg', 'fkh.jpg', 'anw.jpg', 'orientierung.jpg', 'etym.jpg', 'vitru.jpg',
    'life_has_meaning.jpg', 'dt_real.jpg', 'ohne_physio.jpeg', 'ohne_physio.jpg']);

  /* ── section labels ─────────────────────────────────────────────────────
     The author sets his section markers as pictures of words — a blackletter
     "Historisches", a "DEFINITION" plate, a "Merke:" stick figure. They carry
     structure nothing else on the page states (where a digression begins, what
     kind it is), so read the word back out instead of dropping the image with
     the rest of the deco. Wording is transcribed from the images themselves.
       wrap    the picture opens a container (a margin-left div) that IS the block
       lead    the picture heads a line; the label belongs to what follows
       banner  a standalone wordmark that acts as a section heading
     Anw.jpg reads "Klinik · Alltag · Praxis · Anwendung", but every link that
     points at its anchor calls the section "Praktische Aspekte" — use the
     book's own words for it. FKH.jpg ("FEEDBACK") sits inside a mailto: in the
     footer and vitru.jpg is a bullet glyph, not a label; both stay deco. */
  const LABELS = {
    'histor.jpg': { text: 'Historisches', kind: 'wrap' },
    'pharm.jpg': { text: 'Pharmakologie', kind: 'wrap' },
    'begriffe.jpg': { text: 'Begriffe', kind: 'lead' },
    'def_kl.jpg': { text: 'Definition', kind: 'lead' },
    'merke.jpg': { text: 'Merke', kind: 'lead' },
    'merke2.jpg': { text: 'Merke', kind: 'lead' },
    'etym.jpg': { text: 'Etymologie', kind: 'lead' },
    'exkurs.jpg': { text: 'Exkurs', kind: 'lead' },
    'anw.jpg': { text: 'Praktische Aspekte', kind: 'banner' },
    'orientierung.jpg': { text: 'Orientierung', kind: 'banner' },
  };
  const labelOf = (f) => LABELS[f] || null;
  // The badge that marks a word as defined in this page's Begriffe list. It
  // always points at the page's own #BEG, so the definitions are local.
  const GLOSS_BADGE = 'begriff.jpg';
  // NB: no /^hhs/ prefix — that hid the author portrait under Strategy A.
  const DECO_PREFIX = /^(reise|welcome|dilbert|smiley|aeskulap|saeule|spruch)/i;
  const isDecoName = (f) => { f = f.toLowerCase(); return DECO.has(f) || DECO_PREFIX.test(f); };
  const isFigureSize = (w, h) => (w * h >= 11000) || (Math.min(w, h) >= 120);

  function imgSize(img) {
    const styleDim = (p) => {
      const m = (img.getAttribute('style') || '').match(new RegExp('(?:^|;|\\s)' + p + ':\\s*(\\d+(?:\\.\\d+)?)px', 'i'));
      return m ? Math.round(parseFloat(m[1])) : 0;
    };
    // Prefer the DECLARED box (markup) over intrinsic, so classification does
    // not race image load at document_end.
    const w = parseInt(img.getAttribute('width'), 10) || styleDim('width') || img.naturalWidth || 0;
    const h = parseInt(img.getAttribute('height'), 10) || styleDim('height') || img.naturalHeight || 0;
    return [w, h];
  }
  /* The declared box is the site's 1990s layout hint, not the picture's own
     size: the hubs float a 631×407 scan beside the section list at 200×129,
     and a handful of in-text figures are halved the same way. In a 680px
     reading column that reads as a stamp. Show the scan at its own resolution
     instead — the attributes stay as the pre-load box reservation, and the
     column (max-width:100%) still caps it, so we never upscale past 1:1. */
  function fitNatural(im, declaredW) {
    const grow = () => { if (im.naturalWidth > declaredW) { im.width = im.naturalWidth; im.height = im.naturalHeight; } };
    if (im.complete && im.naturalWidth) grow(); else im.addEventListener('load', grow, { once: true });
  }
  function isPageLink(href) {
    if (!href || href[0] === '#') return false;
    if (/^(mailto|javascript):/i.test(href) || /^https?:\/\//i.test(href) || href.includes('#')) return false;
    return /\.html?$/i.test(base(href));
  }
  function navLabel(f, href, alt) {
    if (NAV_LABEL[f]) return NAV_LABEL[f];
    const b = base(href).toLowerCase();
    const rom = b.match(/^([ivxlc]+)\.html?$/);
    if (rom) return 'Kapitel ' + rom[1].toUpperCase() + ' ›';
    if (/^index\.html?$/.test(b)) return 'Startseite';
    if (/^pruef/.test(b)) return 'Prüfungsfragen ›';
    return (alt && alt.trim()) || 'Weiter ›';
  }
  /* ── chapter pager ──────────────────────────────────────────────────────
     Every hub carries the same prev/next control, hand-authored three ways:
     numeral and arrow inside one <a>, or split across two <a>s sharing the
     href, in either order. The split shapes used to render as an arrow pill
     PLUS a stray "II." text link, and the merged shape as a bare "I." with the
     arrow dropped as deco — so the same control looked different on every
     page. Collapse all of them to one pill per destination. */
  // \d? because chapter X is filed as X2.htm — the only irregular one of the 18.
  const CHAPTER_HREF = /^(x{0,3})(ix|iv|v?i{0,3})\d?\.html?$/i;
  const ARROW_DIR = {
    'linksblau.jpg': 'prev', 'previous.gif': 'prev',
    'rechtsblau.jpg': 'next', 'nexttopic.gif': 'next', 'greenbutton.jpg': 'next',
  };
  const chapterLabel = (num, dir) => (dir === 'prev' ? '‹ Kapitel ' + num : 'Kapitel ' + num + ' ›');

  /* ── where am I? ────────────────────────────────────────────────────────
     Nothing on a page says which chapter it belongs to — the hub prints its
     title, the section pages print a differently-worded back-link, and neither
     shows a number. The URL is the only reliable signal, so map it against the
     master table (the titles are Pruef.htm's, verbatim). */
  const CHAPTERS = {
    I: 'Allgemeine Grundlagen, Physiologie der Zelle',
    II: 'Humoral-neuronale Steuerung und Kontrolle',
    III: 'Leberfunktionen, hepatobiliäres System',
    IV: 'Ernährung und Verdauungssystem',
    V: 'Energie- und Stoffwechsel',
    VI: 'Physiologie des Herzens',
    VII: 'Kreislauf, Blut, Lymphe',
    VIII: 'Respirationssystem, Atemgastransport',
    IX: 'Nierenfunktion und ableitende Harnwege',
    X: 'Blutdruck, Wasserhaushalt, Säure-Basen-Status',
    XI: 'Mineral- und Eisenhaushalt, Knochensystem',
    XII: 'Spezielle Endokrinologie',
    XIII: 'Sexualität, Reproduktion, Entwicklung, Wachstum',
    XIV: 'Funktion der Sinnesorgane',
    XV: 'Körperhaltung und Motorik',
    XVI: 'Integrative Funktionen des Nervensystems',
    XVII: 'Immunologische Grundlagen',
    XVIII: 'Integration der Organsysteme',
  };
  // I.htm (hub) · I.1.htm (section) · IV.5A.htm (a section's annex) ·
  // X2.htm (chapter X's hub — the one irregular file name, hence trailing \d?).
  const PAGE_REF = /^(x{0,3})(ix|iv|v?i{0,3})(?:\.(\d+)([a-z])?)?\d?\.html?$/i;
  function pageRef(file) {
    const m = PAGE_REF.exec(base(file));
    if (!m) return null;
    const rom = (m[1] + m[2]).toUpperCase();
    if (!CHAPTERS[rom]) return null;
    const num = m[3] == null ? null : +m[3];
    return { rom, num, annex: m[4] || '', title: CHAPTERS[rom], hub: rom === 'X' ? 'X2.htm' : rom + '.htm' };
  }
  // Chapter I numbers its sections from 0 (I.0 is the introduction); every
  // other chapter starts at 1. Normalise so "Abschnitt 1" is always the first.
  const ordinal = (ref) => (ref.rom === 'I' ? ref.num + 1 : ref.num) + ref.annex;
  function chapterNav(a) {
    const href = a.getAttribute('href');
    const m = href && CHAPTER_HREF.exec(base(href));
    if (!m || !(m[1] || m[2])) return null;
    const dir = [...a.querySelectorAll('img')]
      .map((im) => ARROW_DIR[base(im.getAttribute('src')).toLowerCase()]).find(Boolean) || null;
    // A bare numeral or an arrow is the pager; anything else is prose that
    // happens to link to the chapter (the Prüfungsfragen index), leave it be.
    if (!dir && !/^[ivxlc]+\.?$/i.test(norm(a.textContent))) return null;
    return { href, dir, num: (m[1] + m[2]).toUpperCase() };
  }

  function imgCounts(root) {
    const c = new Map();
    root.querySelectorAll('img').forEach((im) => { const f = base(im.getAttribute('src')).toLowerCase(); c.set(f, (c.get(f) || 0) + 1); });
    return c;
  }
  function classifyImg(img, counts) {
    const f = base(img.getAttribute('src')).toLowerCase();
    const a = img.closest('a[href]');
    const sole = a && !a.textContent.trim() && a.querySelectorAll('img').length === 1;
    const [w, h] = imgSize(img);
    const asNav = () => ({ kind: 'nav', href: a.getAttribute('href'), label: navLabel(f, a.getAttribute('href'), img.getAttribute('alt')) });
    // A named control wins outright (reise*.jpg is both a pager and a DECO_PREFIX
    // match). Everything else on the deny-list stays deco even when it links out —
    // otherwise a badge picks up navLabel's "Weiter ›" fallback and poses as a pager.
    if (sole && NAV_LABEL[f]) return asNav();
    if (isDecoName(f)) return { kind: 'deco' };
    if (sole && isPageLink(a.getAttribute('href')) && !isFigureSize(w, h)) return asNav();
    if (counts.get(f) >= 3) return { kind: 'deco' };
    if (!w || !h) return { kind: 'inline' };
    const mn = Math.min(w, h), aspect = mn ? Math.max(w, h) / mn : 99;
    if (mn < 55 || w * h < 4000) return { kind: 'deco' };
    if (aspect >= 4.5 && mn <= 60) return { kind: 'deco' };
    if (isFigureSize(w, h)) return { kind: 'fig', src: img.getAttribute('src'), w, h, alt: img.getAttribute('alt') || '' };
    return { kind: 'deco' };
  }

  /* A 'wrap' label opens a container that is exactly the digression — always a
     <div style="margin-left:40px"> with the picture as its first child. The
     container is what gives us the EXTENT, which the label alone can't state.
     Only the image's own innermost block ancestor counts, or the outer wrappers
     it happens to open would each nest another callout around the same text. */
  function wrapLabel(el) {
    const im = el.querySelector('img');
    if (!im) return null;
    const lab = labelOf(base(im.getAttribute('src')).toLowerCase());
    if (!lab || lab.kind !== 'wrap') return null;
    let p = im.parentElement;
    while (p && INLINE.has(p.tagName)) p = p.parentElement;
    if (p !== el) return null;
    const r = document.createRange();
    r.setStart(el, 0); r.setEndBefore(im);
    if (norm(r.toString())) return null;          // must OPEN the container
    const len = norm(el.textContent).length;
    return (len >= 60 && len <= 6000) ? lab : null;
  }

  /* Bullets are pictures too: spheres, asterisks, arrows, all set at the head
     of a line with a hard space after them. Size is what separates a bullet
     glyph from a small figure; position is what separates it from the badges
     that trail a word. The one shape this would also catch is the 12×12
     marker in front of "Abbildung: …" captions — assemble() rejects those on
     the caption wording instead. */
  const isBulletSize = (w, h) => w && h && Math.min(w, h) >= 8 && Math.max(w, h) <= 60;
  const ARROW_BULLET = /(pfeil|arrow)/i;

  /* ── table taxonomy ─────────────────────────────────────────────────── */
  function parseColor(s) {
    if (!s) return null; s = s.trim().toLowerCase();
    if (s === 'yellow') return { r: 255, g: 255, b: 0 };
    if (s === 'white') return { r: 255, g: 255, b: 255 };
    if (s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return null;
    if (s[0] === '#') { const h = s.slice(1); const x = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      if (x.length >= 6) return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16) }; }
    const m = s.match(/\d+/g);
    return m && m.length >= 3 ? { r: +m[0], g: +m[1], b: +m[2] } : null;
  }
  // A table's OWN rows/cells — never a nested table's.
  const boxRows = (t) => [...t.querySelectorAll(':scope > tbody > tr, :scope > tr')];
  const rowCells = (r) => [...r.querySelectorAll(':scope > td, :scope > th')];
  const cellBg = (c) => parseColor(c.getAttribute && c.getAttribute('bgcolor')) || parseColor(c.style && c.style.backgroundColor);
  const isYellowish = (p) => p && p.r >= 248 && p.g >= 235 && p.b < p.g && (p.r - p.b) >= 6;
  const isBluish = (p) => p && p.b >= 110 && p.r < 90 && p.g < 90;
  const isColored = (p) => p && !(p.r >= 250 && p.g >= 250 && p.b >= 250);
  function isCellBold(c) {
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); let any = false, n;
    while ((n = w.nextNode())) {
      if (!n.textContent.trim()) continue; any = true;
      const cs = getComputedStyle(n.parentElement);
      if (!(cs.fontWeight === 'bold' || +cs.fontWeight >= 600)) return false;
    }
    return any;
  }
  function classifyTable(t) {
    const cells = [...t.querySelectorAll('td, th')];
    const anyBlue = cells.some((c) => isBluish(cellBg(c)));
    const anyColored = cells.some((c) => isColored(cellBg(c))) || isColored(cellBg(t));
    // One column is a titled box, not a grid — the site paints "Prinzipien in
    // der Physiologie" as a 2-row/1-column table (title cell, then the bulleted
    // body). Read as data it collapsed into two run-on rows.
    const singleCell = boxRows(t).every((r) => rowCells(r).length <= 1);
    if (singleCell && anyColored) {
      const yellow = cells.some((c) => isYellowish(cellBg(c))) || isYellowish(cellBg(t));
      return yellow ? 'impp' : 'box';
    }
    if (!singleCell && (anyBlue || anyColored)) return 'data';
    return 'layout';
  }

  /* ══ token stream ══════════════════════════════════════════════════════ */
  function tokenize(root, counts, baseline) {
    const toks = [];
    // nothing but whitespace since the last line break
    function atLineStart() {
      for (let i = toks.length - 1; i >= 0; i--) {
        const t = toks[i];
        if (t.k === 'br' || t.k === 'block') return true;
        if (t.k === 'text' && !t.text.trim()) continue;
        if (t.k === 'anchor') continue;
        return false;
      }
      return true;
    }
    function walk(node, st) {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          const t = n.textContent;
          if (t && t.trim()) toks.push({ k: 'text', text: t.replace(/\s+/g, ' '), st });
          else if (t && /\s/.test(t) && toks.length && toks[toks.length - 1].k === 'text') toks.push({ k: 'text', text: ' ', st });
          continue;
        }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName;
        if (SKIP.has(tag)) continue;

        const anchorId = n.id || (tag === 'A' ? n.getAttribute('name') : null);
        if (anchorId) toks.push({ k: 'anchor', id: anchorId });

        if (tag === 'BR') { toks.push({ k: 'br' }); continue; }
        if (tag === 'HR') { toks.push({ k: 'hr' }); continue; }
        if (tag === 'A' && n.getAttribute('href')) {
          const cn = chapterNav(n);
          if (cn) {
            // The two halves of a split pager are always adjacent siblings;
            // whichever half carries the arrow decides the direction.
            const last = toks[toks.length - 1];
            if (last && last.k === 'nav' && last.href === cn.href) {
              if (cn.dir && !last.dir) { last.dir = cn.dir; last.label = chapterLabel(cn.num, cn.dir); }
            } else {
              toks.push({ k: 'nav', href: cn.href, label: chapterLabel(cn.num, cn.dir), dir: cn.dir });
            }
            continue; // never walk in — the numeral and the arrow are the pill
          }
        }
        if (tag === 'IMG') {
          const f = base(n.getAttribute('src')).toLowerCase();
          const lab = labelOf(f);
          // 'wrap' labels are consumed by their container below; the picture
          // itself has nothing left to say once the word is out.
          if (lab && lab.kind !== 'wrap') { toks.push({ k: 'label', text: lab.text, banner: lab.kind === 'banner' }); continue; }
          if (f === GLOSS_BADGE) { toks.push({ k: 'gloss' }); continue; }
          const c = classifyImg(n, counts);
          if (c.kind === 'fig') toks.push({ k: 'fig', ...c });
          else if (c.kind === 'nav') toks.push({ k: 'nav', href: c.href, label: c.label });
          else if (c.kind === 'deco' && atLineStart() && isBulletSize(...imgSize(n))) toks.push({ k: 'bullet', src: f });
          continue;
        }
        if (tag === 'TABLE') {
          const kind = classifyTable(n);
          if (kind === 'layout') { toks.push({ k: 'block' }); walk(n, st); toks.push({ k: 'block' }); }
          else toks.push({ k: 'table', kind, el: n, st });
          continue;
        }
        if (INLINE.has(tag)) {
          const ns = Object.assign({}, st);
          const cs = getComputedStyle(n);
          if (tag === 'A' && n.getAttribute('href')) ns.href = n.getAttribute('href');
          if (tag === 'B' || tag === 'STRONG') ns.b = true;
          if (tag === 'I' || tag === 'EM' || tag === 'CITE' || tag === 'VAR') ns.i = true;
          if (tag === 'SUP') ns.sup = true;
          if (tag === 'SUB') ns.sub = true;
          if (cs.fontWeight === 'bold' || +cs.fontWeight >= 600) ns.b = true;
          if (cs.fontStyle === 'italic') ns.i = true;
          ns.size = parseFloat(cs.fontSize) || baseline;
          walk(n, ns);
          continue;
        }
        toks.push({ k: 'block' });
        const wrap = wrapLabel(n);
        if (wrap) toks.push({ k: 'label', text: wrap.text, wrap: 'open' });
        walk(n, st);
        if (wrap) toks.push({ k: 'label', wrap: 'close' });
        toks.push({ k: 'block' });
      }
    }
    walk(root, { size: baseline });
    return toks;
  }

  function measureBaseline(root) {
    const hist = new Map();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (!el) continue;
      const fs = Math.round(parseFloat(getComputedStyle(el).fontSize) || 16);
      hist.set(fs, (hist.get(fs) || 0) + n.textContent.trim().length);
    }
    let best = 16, bestN = -1;
    hist.forEach((v, k) => { if (v > bestN && k >= 12 && k <= 20) { bestN = v; best = k; } });
    return best;
  }

  /* ══ assemble blocks ═══════════════════════════════════════════════════ */
  const GLOSS = /^[A-ZÄÖÜ][^:]{0,30}:\s+\S/;
  // Inside the page's Begriffe list the label already says these lines are
  // entries, so the shape alone is enough — no need for the capital and the
  // short term the loose-in-prose rule above needs to stay honest ("eosinophil:
  // …", "Hodgkin-Huxley-Gleichungen zum Membranpotential: …").
  const GLOSS_LOOSE = /^[^:]{1,60}:\s+\S/;
  // "Abbildung: …" / "Nach …" — a caption, both when it trails a figure and
  // when the 12×12 marker in front of it looks like a bullet.
  const CAP = /^\s*(Abbildung|Abb\.|Abb\b|Nach\s|Fig\.|©)/;
  // A caption is always written as a title line, a <br>, then where it came
  // from ("Nach einer Vorlage bei Silverthorn…"). Merged into one paragraph the
  // citation reads as part of the title, so split it back off at that break.
  // The leading .? absorbs the odd letter the source orphans onto the front of
  // the line (VIII.2: "…Thorax-Lungen-Systems<br>N</font>Nach einer Vorlage…"),
  // a typo the original renders as "NNach" too — keep the text, fix the place.
  const CAP_SRC = /^\s*.?\s*(Nach\b|©|Aus\s|Quelle|Modifiziert|Adaptiert|Fig\.)/;
  // Some citations sit in a <div> of their own rather than a <br> away, so they
  // survive the merge as a paragraph and print under the figure in body type.
  // Standing alone the line has to announce itself: prose may open "Aus diesen
  // Gründen…" or "Nach der Geburt…", a citation names a source.
  const CAP_SRC_BLOCK = /^\s*(Nach einer Vorlage|Nach\s+\p{Lu}|©)/u;

  /* ── drawn hierarchies ──────────────────────────────────────────────────
     I.0 draws its system hierarchy as a centred stack of <br>-separated lines
     with a lone ↑ between the levels. No line is heading-shaped, so all of them
     fall into one paragraph and the ladder reads "↑ Körper ↑ physiologisches
     System ↑ …". Detect the shape and keep the stack. NOT keyed on
     text-align:center — I.0 nests a left-aligned prose div inside a centred
     one, so alignment says nothing here. */
  const ARROW_ONLY = /^[←-⇿⬀-⬑\s ]+$/;
  const LADDER_STEP_MAX = 44;

  // → { title, src } — the caption's own line break decides where the citation
  //   starts; a caption that never states a source is all title.
  function splitCaption(p) {
    for (const at of p.brk || []) {
      const tail = norm(p.runs.slice(at + 1).map((r) => r.text).join(''));
      if (CAP_SRC.test(tail)) return { title: p.runs.slice(0, at), src: p.runs.slice(at + 1) };
    }
    return { title: p.runs, src: null };
  }

  function assemble(toks, baseline) {
    const lines = [];
    let cur = [];
    const flush = () => { lines.push({ runs: cur }); cur = []; };
    for (const t of toks) {
      if (t.k === 'text') cur.push({ text: t.text, st: t.st });
      else if (t.k === 'anchor') cur.push({ text: '', anchor: t.id });
      else if (t.k === 'bullet') cur.push({ text: '', bullet: t.src });
      else if (t.k === 'gloss') cur.push({ text: '', gloss: true });
      else if (t.k === 'br' || t.k === 'block') flush();
      else if (t.k === 'fig' || t.k === 'nav' || t.k === 'table' || t.k === 'label') { flush(); lines.push({ special: t }); }
      else if (t.k === 'hr') { flush(); lines.push({ special: { k: 'hr' } }); }
    }
    flush();

    const lineText = (l) => norm(l.runs ? l.runs.map((r) => r.text).join('') : '');
    const lineMaxSize = (l) => l.runs.reduce((m, r) => Math.max(m, r.st && r.st.size || baseline), 0);
    const lineBold = (l) => { const p = l.runs.filter((r) => r.text.trim()); return p.length && p.every((r) => r.st && r.st.b); };
    const lineAnchors = (l) => (l.runs || []).filter((r) => r.anchor).map((r) => r.anchor);
    // a bullet only counts when it OPENS the line — trailing glyphs are badges
    const lineBullet = (l) => {
      for (const r of (l.runs || [])) {
        if (r.bullet) return r.bullet;
        if ((r.text || '').trim()) return null;
      }
      return null;
    };
    const lineLinked = (l) => { const p = (l.runs || []).filter((r) => (r.text || '').trim()); return p.length > 0 && p.every((r) => r.st && r.st.href); };
    // "Abbildung: Hierarchie-Ebenen…" and "Nach: Mommaerts et al…." both have
    // the shape of a glossary entry. Left unguarded the caption seeds glossFlag
    // and its own source line is then emitted as a definition, detached from
    // the figure it belongs to.
    const isGloss = (l) => l.runs && GLOSS.test(lineText(l)) && lineText(l).length <= 200 && !CAP.test(lineText(l));
    const glossFlag = lines.map((l) => !l.special && isGloss(l));

    /* Tag the members of every arrow ladder. A line joins when it is nothing
       but arrows or a short label; a run only counts as a ladder with at least
       two of each, which the inline "A → B" of ordinary prose can never reach
       (those never stand on a line of their own). */
    const ladderMember = (l) => {
      if (l.special) return false;
      const t = lineText(l);
      if (!t) return false;
      if (ARROW_ONLY.test(t)) return 'arrow';
      if (t.length > LADDER_STEP_MAX || /[.!?:;]\s|[.!?]$/.test(t)) return false;
      return lineBullet(l) ? false : 'step';
    };
    for (let i = 0; i < lines.length;) {
      const kinds = [];
      let j = i;
      for (let k; j < lines.length && (k = ladderMember(lines[j])); j++) kinds.push(k);
      if (kinds.filter((k) => k === 'arrow').length >= 2 && kinds.filter((k) => k === 'step').length >= 2) {
        for (let k = i; k < j; k++) lines[k].ladder = kinds[k - i];
      }
      i = j > i ? j : i + 1;
    }

    function headingLevel(l) {
      const txt = lineText(l);
      if (!txt || txt.length > 90) return 0;
      if (/[,;(]$/.test(txt) || /^[)\];:,.]/.test(txt)) return 0;
      if (/:\s+[^=]*=/.test(txt)) return 0;                  // "Term: x = y" etymology → never a heading
      const sz = lineMaxSize(l), bold = lineBold(l);
      const big = sz >= baseline * 1.12;
      if (!big && !bold) return 0;
      // The hubs set their section index in bold; a line that is nothing but a
      // link is a TOC entry, not a heading. Only size still promotes it.
      if (!big && lineLinked(l)) return 0;
      if (/[.!?]\s+\S/.test(txt)) return 0;                  // reads like a full sentence
      if (sz >= baseline * 1.7) return 1;
      if (sz >= baseline * 1.32) return 2;
      if (big) return 3;
      if (bold) return 3;
      return 0;
    }

    const blocks = [];
    let para = null, deflist = null, ladder = null, pending = [], label = null, inGloss = false;
    const drain = () => { const a = pending; pending = []; return a; };
    // A 'lead' label belongs to the block that FOLLOWS it, so it is claimed
    // when that block starts — not when it is flushed, which can be much later.
    const takeLabel = () => { const l = label; label = null; return l; };
    // brk records where lines were joined, the one thing the merge would
    // otherwise destroy — a caption needs it back to peel its source line off.
    const flushPara = () => { if (para && norm(para.runs.map((r) => r.text).join(''))) blocks.push({ t: 'p', runs: para.runs, brk: para.brk, anchors: para.anchors, bullet: para.bullet, label: para.label }); para = null; };
    const flushDef = () => { if (deflist && deflist.items.length) blocks.push({ t: 'deflist', items: deflist.items, anchors: deflist.anchors, label: deflist.label }); deflist = null; };
    const flushLadder = () => { if (ladder && ladder.items.length) blocks.push({ t: 'ladder', items: ladder.items, anchors: ladder.anchors }); ladder = null; };
    const flushGroups = () => { flushPara(); flushDef(); flushLadder(); };

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.special) {
        flushGroups();
        const s = l.special, anchors = drain();
        if (s.k === 'fig') blocks.push({ t: 'fig', src: s.src, w: s.w, h: s.h, alt: s.alt, cap: null, anchors });
        else if (s.k === 'nav') blocks.push({ t: 'nav', href: s.href, label: s.label, dir: s.dir, anchors });
        else if (s.k === 'hr') blocks.push({ t: 'hr', anchors });
        else if (s.k === 'table') blocks.push({ t: 'table', kind: s.kind, el: s.el, anchors });
        else if (s.k === 'label') {
          // A label emits no block of its own (the callout it opens, or the
          // block it prefixes, does) — hand the anchors it drained back so the
          // in-page links they carry land on real content.
          if (s.wrap === 'open') blocks.push({ t: 'open', label: s.text, anchors });
          else if (s.banner) blocks.push({ t: 'h', level: 2, runs: [{ text: s.text, st: {} }], anchors });
          else {
            if (s.wrap) blocks.push({ t: 'close' });
            else { label = s.text; if (s.text === 'Begriffe') inGloss = true; }
            pending.push(...anchors);
          }
        }
        continue;
      }
      const txt = lineText(l), anchors = lineAnchors(l);
      if (!txt) {
        if (anchors.length) { if (para) para.runs.push(...l.runs.filter((r) => r.anchor)); else if (deflist) deflist.items[deflist.items.length - 1] && deflist.items[deflist.items.length - 1].runs.push(...l.runs.filter((r) => r.anchor)); else pending.push(...anchors); }
        else flushGroups();
        continue;
      }
      if (l.ladder) {
        if (!ladder) { flushGroups(); ladder = { items: [], anchors: drain() }; }
        ladder.items.push({ runs: l.runs, arrow: l.ladder === 'arrow' });
        continue;
      }
      flushLadder();
      // A bullet line always starts a fresh item; wrapped continuation lines
      // then fall into it like any other paragraph. "Abbildung: …" is a caption
      // whose marker only looks like a bullet — never a one-item list.
      const bullet = lineBullet(l);
      if (bullet && !CAP.test(txt)) { flushGroups(); para = { runs: [], brk: [], anchors: drain(), bullet, label: takeLabel() }; }

      const isEntry = !CAP.test(txt) && ((glossFlag[i] && (glossFlag[i - 1] || glossFlag[i + 1])) ||
        (inGloss && GLOSS_LOOSE.test(txt) && txt.length <= 300));
      if (!bullet && isEntry) {
        flushPara();
        if (!deflist) deflist = { items: [], anchors: drain(), label: takeLabel() };
        deflist.items.push({ runs: l.runs });
        continue;
      }
      inGloss = false;   // the first line that isn't an entry ends the list
      flushDef();
      const lvl = bullet ? 0 : headingLevel(l);
      if (lvl) { flushPara(); blocks.push({ t: 'h', level: lvl, runs: l.runs, anchors: drain(), label: takeLabel() }); continue; }
      if (!para) para = { runs: [], brk: [], anchors: drain(), label: takeLabel() };
      if (para.runs.length) { para.brk.push(para.runs.length); para.runs.push({ text: ' ', st: {} }); }
      para.runs.push(...l.runs);
    }
    flushGroups();

    // The hubs paint the pager as "prev · TITLE · next", which lands a lone
    // pill above the heading and another below — two controls where there is
    // one. Fold the leading pill down past the title so both halves end up
    // adjacent and renderBlocks gathers them into a single row.
    for (let i = 0; i < blocks.length - 1; i++) {
      if (blocks[i].t === 'nav' && blocks[i].dir && blocks[i + 1].t === 'h') blocks.splice(i + 1, 0, blocks.splice(i, 1)[0]);
    }

    // Chapter indexes (Prüfungsfragen, the hub pages) are just runs of lines
    // that hold nothing but a link. As prose paragraphs they get full leading
    // and a 16-entry index runs past the bottom of the viewport, so tag runs of
    // them for renderBlocks to gather into one tight list.
    const isLinkOnly = (b) => {
      if (b.t !== 'p' || b.bullet) return false;
      const words = b.runs.filter((r) => (r.text || '').trim());
      return words.length > 0 && words.every((r) => r.st && r.st.href) &&
        norm(b.runs.map((r) => r.text).join('')).length <= 120;
    };
    for (let i = 0; i < blocks.length; i++) {
      if (!isLinkOnly(blocks[i])) continue;
      let j = i; while (j < blocks.length && isLinkOnly(blocks[j])) j++;
      if (j - i >= 3) for (let k = i; k < j; k++) blocks[k].linkitem = true;
      i = j - 1;
    }

    // attach "Abbildung/Nach/©" caption paragraphs to the figure above.
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].t !== 'fig') continue;
      const nxt = blocks[i + 1];
      if (nxt && nxt.t === 'p') {
        const txt = norm(nxt.runs.map((r) => r.text).join(''));
        if (CAP.test(txt) && txt.length < 320) { blocks[i].cap = splitCaption(nxt); blocks.splice(i + 1, 1); }
      }
      // then the citation, where a block boundary rather than a <br> split it
      // off and splitCaption never saw it.
      const cap = blocks[i].cap, src = blocks[i + 1];
      if (!cap || cap.src || !src || src.t !== 'p' || src.bullet || src.label) continue;
      const txt = norm(src.runs.map((r) => r.text).join(''));
      if (CAP_SRC_BLOCK.test(txt) && txt.length < 320) { cap.src = src.runs; blocks.splice(i + 1, 1); }
    }
    return blocks;
  }

  /* ══ glossary ══════════════════════════════════════════════════════════
     Every page carries one "Begriffe" list (anchor #BEG) and sprinkles a small
     green badge behind words it defines there. The badge trails the word, and
     the word is rarely the entry verbatim — the text inflects it (Pleuraspalt →
     Pleura, teleologisch → Teleologie, Phrenikusnerven → Phrenikusnerv), so
     match on a normalised shared prefix over the last few words, longest window
     first. No entry found (Pinozytose, "Thrifty genes") still marks the word and
     links it to the list; it just has nothing to show on hover. */
  let glossary = null;
  const isGlossList = (b) => b.t === 'deflist' &&
    (b.label === 'Begriffe' || (b.anchors || []).includes('BEG') ||
     b.items.some((it) => it.runs.some((r) => r.anchor === 'BEG')));
  function buildGlossary(blocks) {
    const map = new Map();
    for (const b of blocks) {
      if (!isGlossList(b)) continue;
      for (const it of b.items) {
        const [term, def] = splitAtColon(it.runs);
        const t = norm(term.map((r) => r.text).join('')), d = norm(def.map((r) => r.text).join(''));
        if (t && d) map.set(t, d);
      }
    }
    return map.size ? map : null;
  }
  const foldTerm = (s) => s.toLowerCase().replace(/ß/g, 'ss').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  /* The word in the text and the entry in the list rarely agree letter for
     letter, so score a normalised shared prefix — but it has to cover most of
     the longer of the two, or "Diffusionsgesetz (nach Adolf Fick" matches
     Diffusion on its first nine letters. Inflection happens inside ONE word, so
     a multi-word window has to be the entry itself, near enough. */
  function scoreTerm(a, b, oneWord) {
    if (a === b) return 100;
    const short = Math.min(a.length, b.length);
    let p = 0; while (p < short && a[p] === b[p]) p++;
    if (p / Math.max(a.length, b.length) < 0.4) return 0;
    if (p === short && short >= 5) return 50 + short;   // one contains the other
    return (oneWord && p >= 6) ? 20 + p : 0;
  }
  const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
  // → the term as it stands in the text, and its definition
  function matchTerm(text) {
    if (!glossary) return null;
    const starts = [];
    const re = /\S+/g; let m;
    while ((m = re.exec(text))) starts.push(m.index);
    let best = null;
    for (let w = 1; w <= 4 && w <= starts.length; w++) {
      // a window can open on a bracket ("(Clathrin-Mechanismus") — punctuation
      // around the term, not part of it
      const cand = text.slice(starts[starts.length - w]).replace(EDGE, '');
      const nc = foldTerm(cand);
      if (nc.length < 2) continue;
      glossary.forEach((def, term) => {
        const s = scoreTerm(nc, foldTerm(term), w === 1);
        if (s && (!best || s > best.score)) best = { score: s, text: cand, len: cand.length, def };
      });
    }
    return best;
  }
  const TRAIL = /[^\p{L}\p{N}]+$/u;
  function markTerm(out) {
    let tail = '';
    for (let i = out.length - 1; i >= 0 && tail.length < 60; i--) tail = (out[i].text || '') + tail;
    // spaces and punctuation sit between the word and the badge that trails it
    const trimmed = tail.replace(TRAIL, '');
    if (!trimmed) return;
    let skip = tail.length - trimmed.length;
    const hit = matchTerm(trimmed);
    // no entry → still mark the last word, so the cross-reference survives
    const last = trimmed.slice(trimmed.lastIndexOf(' ') + 1);
    let len = hit ? hit.len : last.length;
    const def = hit ? hit.def : '';
    // the whole term even where the source splits it across runs (B|iomembranen)
    const whole = hit ? hit.text : last;
    for (let j = out.length - 1; j >= 0 && len > 0; j--) {
      const r = out[j], t = r.text || '';
      if (!t) continue;
      let end = t.length;
      if (skip) { const cut = Math.min(skip, end); end -= cut; skip -= cut; if (!end) continue; }
      const take = Math.min(len, end);
      const from = end - take;
      len -= take;
      const parts = [];
      const mid = t.slice(from, end);
      if (from) parts.push(Object.assign({}, r, { text: t.slice(0, from) }));
      // a two-word term can straddle runs; the space between them is not a term
      parts.push(mid.trim() ? Object.assign({}, r, { text: mid, st: Object.assign({}, r.st, { term: def, whole }) })
        : Object.assign({}, r, { text: mid }));
      if (end < t.length) parts.push(Object.assign({}, r, { text: t.slice(end) }));
      out.splice(j, 1, ...parts);
    }
  }
  function resolveGloss(runs) {
    if (!runs.some((r) => r.gloss)) return runs;
    const out = [];
    for (const r of runs) { if (r.gloss) markTerm(out); else out.push(r); }
    return out;
  }

  /* ══ render ════════════════════════════════════════════════════════════ */
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function renderRuns(runs) {
    let html = '';
    for (const r of resolveGloss(runs)) {
      if (r.anchor) html += '<span class="pr-anchor" id="' + esc(r.anchor) + '"></span>';
      if (r.brk) { html += '<br>'; continue; }
      let t = esc(r.text || '');
      if (!t) continue;
      const st = r.st || {};
      if (st.sup) t = '<sup>' + t + '</sup>';
      if (st.sub) t = '<sub>' + t + '</sub>';
      if (st.b && st.i) t = '<strong><em>' + t + '</em></strong>';
      else if (st.b) t = '<strong>' + t + '</strong>';
      else if (st.i) t = '<em>' + t + '</em>';
      if (st.term !== undefined) {
        t = '<a class="pr-term" href="' + esc(st.href || '#BEG') + '"' +
          (st.term ? ' data-term="' + esc(st.whole || '') + '" data-def="' + esc(st.term) + '"' : '') + '>' + t + '</a>';
      } else if (st.href) t = '<a href="' + esc(st.href) + '">' + t + '</a>';
      html += t;
    }
    return html.replace(/\s+/g, ' ');
  }
  function splitAtColon(runs) {
    const term = [], def = []; let done = false;
    for (const r of runs) {
      if (done || r.anchor) { (done ? def : term).push(r); continue; }
      const idx = (r.text || '').indexOf(':');
      if (idx < 0) { term.push(r); continue; }
      const before = r.text.slice(0, idx), after = r.text.slice(idx + 1);
      if (before) term.push(Object.assign({}, r, { text: before }));
      if (after.trim()) def.push(Object.assign({}, r, { text: after.replace(/^\s+/, '') }));
      done = true;
    }
    return [term, def];
  }
  /* A cell's <br>s ARE its content: "Acetylcholin (M2) / GABA / Histamin" is
     three ligands, and dropping them merged the words into "…(M2)GABAHistamin".
     Kept — except where the author hard-wrapped a word to fit the 1990s column
     ("G-Protein-<br>gekoppelte"), where the break is typography, not structure. */
  function renderInlineOf(el, counts, baseline) {
    const runs = [];
    for (const t of tokenize(el, counts, baseline)) {
      if (t.k === 'text') runs.push({ text: t.text, st: t.st });
      else if (t.k === 'anchor') runs.push({ text: '', anchor: t.id });
      else if (t.k === 'br' || t.k === 'block') runs.push({ brk: true });
    }
    const out = [];
    // '' when there is nothing to break away from — swallows leading and
    // doubled breaks without a second pass
    const tail = () => {
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].brk) return '';
        const t = (out[i].text || '').trim();
        if (t) return t;
      }
      return '';
    };
    let trim = false;                    // the indent the source opens the next line with
    for (let r of runs) {
      if (r.brk) {
        const t = tail();
        if (!t) continue;
        trim = true;
        if (!/-$/.test(t)) out.push(r);  // else the break was a hard-wrapped word
        continue;
      }
      if (trim && r.text) {
        const t = r.text.replace(/^\s+/, '');
        if (!t && !r.anchor) continue;
        if (t) { r = Object.assign({}, r, { text: t }); trim = false; }
      }
      out.push(r);
    }
    while (out.length && out[out.length - 1].brk) out.pop();
    return renderRuns(out);
  }
  const cellSpan = (c, a) => Math.max(1, parseInt(c.getAttribute(a), 10) || 1);
  /* The grids lean on rowspan to group rows — "GPCR" stands beside the three
     receptor families under it. Dropped, every row the span shortened slid a
     column to the left and the whole table sheared. Walk the grid keeping a
     per-column carry of what is still occupied from above, so a row knows its
     true width and whether it is short because of a span (keep it) or because
     it is a full-width title row (promote it to the caption). */
  function gridRows(el) {
    const carry = [];
    return [...el.querySelectorAll('tr')].filter((tr) => tr.closest('table') === el).map((tr) => {
      const cells = rowCells(tr);
      let col = 0, held = 0;
      for (const c of cells) {
        while (carry[col] > 0) { col++; held++; }
        const cs = cellSpan(c, 'colspan');
        for (let k = 0; k < cs; k++) carry[col + k] = cellSpan(c, 'rowspan');
        col += cs;
      }
      let width = col;
      for (; col < carry.length; col++) if (carry[col] > 0) { held++; width = col + 1; }
      for (let k = 0; k < carry.length; k++) if (carry[k] > 0) carry[k]--;
      return { cells, width, held };
    });
  }
  function renderTable(block, counts, baseline) {
    const { kind, el } = block;
    if (kind === 'data') {
      const grid = gridRows(el);
      const maxCols = Math.max(1, ...grid.map((g) => g.width));
      const out = document.createElement('table'); out.className = 'pr-data';
      const rows = grid.filter((g) => g.cells.length);
      const isFull = (g) => g && g.cells.length === 1 && !g.held && maxCols > 1 && cellSpan(g.cells[0], 'rowspan') === 1;
      // Only the rows the table OPENS with are its title. The same full-width
      // shape further down divides the grid into two blocks ("Ligandenaktivierte
      // Ca++-Kanäle", halfway through I.1's channel table) — hoisted into the
      // caption it tore the second half loose from what names it.
      let lead = 0;
      while (isFull(rows[lead])) lead++;
      const heads = rows.slice(0, lead).map((g) => g.cells[0]);
      const body = rows.slice(lead);
      // The site never writes a <th>; it paints the column headings instead —
      // one tint right across the row, body cells left white. isBluish catches
      // only the dark blue a few pages use, so read the row off that contrast
      // too: the top row, and any row opening a block a divider just started.
      const mixed = body.some((g) => g.cells.some((c) => !isColored(cellBg(c))));
      body.forEach((g, i) => {
        const band = isFull(g);
        const head = !band && mixed && (i === 0 || isFull(body[i - 1])) && g.cells.every((c) => isColored(cellBg(c)));
        const row = document.createElement('tr');
        g.cells.forEach((c) => {
          const td = document.createElement('td');
          const cs = cellSpan(c, 'colspan'), rs = cellSpan(c, 'rowspan');
          if (band) td.colSpan = maxCols;
          else if (cs > 1) td.colSpan = cs;
          if (rs > 1) td.rowSpan = rs;
          if (band) td.className = 'pr-band';
          else if (head || isBluish(cellBg(c)) || isCellBold(c)) td.className = 'pr-th';
          td.innerHTML = renderInlineOf(c, counts, baseline);
          row.appendChild(td);
        });
        out.appendChild(row);
      });
      if (heads.length) out.insertBefore(tableHead(heads, counts, baseline), out.firstChild);
      return out;
    }
    const wrap = document.createElement(kind === 'impp' ? 'aside' : 'div');
    wrap.className = kind === 'impp' ? 'pr-impp' : 'pr-box';
    const blocksOf = (node) => renderBlocks(assemble(tokenize(node, counts, baseline), baseline), counts, baseline);
    // A stack of one-cell rows is a titled box: row 1 names it, the rest is the
    // body. Rendered as one lump, the title ran straight into its source line
    // and the body's bulleted lines into one paragraph.
    const cells = boxRows(el).map((r) => rowCells(r)[0]).filter(Boolean);
    if (cells.length >= 2) {
      wrap.appendChild(boxHead(cells[0], counts, baseline));
      cells.slice(1).forEach((c) => wrap.appendChild(blocksOf(c)));
    } else wrap.appendChild(blocksOf(el));
    return wrap;
  }
  /* → { title, src } — a title cell holds the name and, set smaller, where it
     came from ("Nach Feher J, Quantitative Human Physiology…"). That size drop
     is the only thing separating them, so split on it. Same two-part shape as a
     figure caption; a titled box and a data table both open with one. */
  function headRuns(cell, counts, baseline) {
    // The site pads a title cell with a 10×5 Platzhalter.jpg on a line of its
    // own, which assemble reads as a blank line and flushes the paragraph on.
    // So the cell is rarely ONE block, and taking the first alone dropped every
    // source line sitting behind a spacer ("Nach Albert Einstein 1905"). Join
    // them back up; the size drop below still decides where the title ends.
    const parts = assemble(tokenize(cell, counts, baseline), baseline).filter((x) => x.t === 'p' || x.t === 'h');
    if (!parts.length) return null;
    const runs = [];
    for (const p of parts) { if (runs.length) runs.push({ text: ' ', st: {} }); runs.push(...p.runs); }
    // A sup/sub is set smaller by definition — measured, the "++" of "Ca++"
    // reads as the size drop and cuts the title in half.
    const full = (r) => (r.text || '').trim() && !(r.st && (r.st.sup || r.st.sub));
    const words = runs.filter(full);
    const max = words.reduce((m, r) => Math.max(m, (r.st && r.st.size) || 0), 0);
    const cut = max ? runs.findIndex((r) => full(r) && ((r.st && r.st.size) || max) <= max - 1.5) : -1;
    return cut < 0 ? { title: runs, src: null } : { title: runs.slice(0, cut), src: runs.slice(cut) };
  }
  function boxHead(cell, counts, baseline) {
    const frag = document.createDocumentFragment();
    const h = headRuns(cell, counts, baseline);
    if (!h) return frag;
    const add = (cls, runs) => { const p = document.createElement('p'); p.className = cls; p.innerHTML = renderRuns(runs); frag.appendChild(p); };
    add('pr-box-title', h.title);
    if (h.src) add('pr-box-sub', h.src);
    return frag;
  }
  // The table's title row is the figure caption's shape, so give it the figure
  // caption's look. Extra promoted rows are always a further source line.
  function tableHead(cells, counts, baseline) {
    const cap = document.createElement('caption');
    const add = (cls, runs) => {
      const s = document.createElement('span'); s.className = cls;
      s.innerHTML = renderRuns(runs).trim();
      if (s.innerHTML) cap.appendChild(s);
    };
    cells.forEach((c, i) => {
      const h = headRuns(c, counts, baseline);
      if (!h) return;
      if (i === 0) { add('pr-figcap-title', h.title); if (h.src) add('pr-figcap-src', h.src); }
      else add('pr-figcap-src', h.title.concat(h.src || []));
    });
    return cap;
  }
  function emitAnchors(frag, ids, seen) {
    for (const id of ids || []) { if (!id || seen.has(id)) continue; seen.add(id); const s = document.createElement('span'); s.className = 'pr-anchor'; s.id = id; frag.appendChild(s); }
  }
  // Direction is only ever encoded in the label's arrow (navLabel bakes it in).
  const navRank = (label) => (/^\s*‹/.test(label) ? 0 : /›\s*$/.test(label) ? 2 : 1);

  const labelEl = (text) => { const p = document.createElement('p'); p.className = 'pr-label'; p.textContent = text; return p; };
  const bulletKind = (src) => (ARROW_BULLET.test(src) ? 'arrow' : 'dot');

  function renderBlocks(blocks, counts, baseline, seen) {
    seen = seen || new Set();
    const frag = document.createDocumentFragment();
    // Callouts nest: 'open'/'close' pairs move where the following blocks land.
    const stack = [];
    let into = frag, navGroup = null, linkList = null, list = null, listOf = null;
    for (const b of blocks) {
      if (b.t === 'open') {
        emitAnchors(into, b.anchors, seen);
        const box = document.createElement('aside');
        box.className = 'pr-callout';
        box.appendChild(labelEl(b.label));
        into.appendChild(box);
        stack.push(into); into = box;
        navGroup = linkList = list = null;
        continue;
      }
      if (b.t === 'close') { if (stack.length) into = stack.pop(); navGroup = linkList = list = null; continue; }
      if (b.t === 'nav') {
        linkList = list = null;
        emitAnchors(into, b.anchors, seen);
        if (!navGroup) { navGroup = document.createElement('nav'); navGroup.className = 'pr-navrow'; into.appendChild(navGroup); }
        const a = document.createElement('a'); a.className = 'pr-nav'; a.href = b.href; a.textContent = b.label;
        // The source usually paints "Weiter" left of "Zurück"; sort into pager
        // order instead (back · everything else · forward), stably.
        const rank = navRank(b.label);
        navGroup.insertBefore(a, [...navGroup.children].find((c) => navRank(c.textContent) > rank) || null);
        continue;
      }
      navGroup = null;
      if (b.t === 'p' && b.linkitem) {
        list = null;
        emitAnchors(into, b.anchors, seen);
        if (!linkList) { linkList = document.createElement('nav'); linkList.className = 'pr-linklist'; into.appendChild(linkList); }
        const p = document.createElement('p'); p.innerHTML = renderRuns(b.runs); linkList.appendChild(p);
        continue;
      }
      linkList = null;
      // Runs of bullet paragraphs are one list — but only while the glyph stays
      // the same, since a new glyph starts a new list in the source too.
      if (b.t === 'p' && b.bullet) {
        emitAnchors(into, b.anchors, seen);
        const kind = bulletKind(b.bullet);
        if (!list || listOf !== kind) {
          list = document.createElement('ul'); list.className = 'pr-list'; list.dataset.bullet = kind;
          listOf = kind; into.appendChild(list);
        }
        const li = document.createElement('li'); li.innerHTML = renderRuns(b.runs); list.appendChild(li);
        continue;
      }
      list = null;
      emitAnchors(into, b.anchors, seen);
      // A 'lead' label names the block that follows it; a labelled paragraph is
      // a callout of one, a labelled heading just takes the label as its kicker.
      let box = into;
      if (b.label && b.t !== 'deflist') {
        if (b.t === 'h') into.appendChild(labelEl(b.label));
        else { box = document.createElement('aside'); box.className = 'pr-callout'; box.appendChild(labelEl(b.label)); into.appendChild(box); }
      }
      if (b.t === 'h') { const h = document.createElement('h' + b.level); h.innerHTML = renderRuns(b.runs); box.appendChild(h); }
      else if (b.t === 'p') { const p = document.createElement('p'); p.innerHTML = renderRuns(b.runs); if (norm(p.textContent) || p.querySelector('[id]')) box.appendChild(p); }
      else if (b.t === 'hr') box.appendChild(document.createElement('hr'));
      else if (b.t === 'deflist') {
        const dl = document.createElement('dl'); dl.className = 'pr-defs';
        // The source pads its entries with hard spaces and stray breaks; a
        // definition list is a grid, so the padding only knocks it off its rails.
        for (const it of b.items) { const [term, def] = splitAtColon(it.runs); const dt = document.createElement('dt'); dt.innerHTML = renderRuns(term).trim(); const dd = document.createElement('dd'); dd.innerHTML = renderRuns(def).trim(); dl.appendChild(dt); dl.appendChild(dd); }
        // The page's own Begriffe list: a labelled, tightly-set glossary rather
        // than the airy two-column definition list prose uses.
        if (isGlossList(b)) {
          dl.classList.add('pr-defs-tight');
          const sec = document.createElement('section'); sec.className = 'pr-gloss';
          sec.append(labelEl(b.label || 'Begriffe'), dl);
          box.appendChild(sec);
        } else box.appendChild(dl);
      }
      else if (b.t === 'fig') {
        const fig = document.createElement('figure'); fig.className = 'pr-fig';
        const im = document.createElement('img'); im.src = b.src; if (b.w) im.width = b.w; if (b.h) im.height = b.h; im.loading = 'lazy'; im.alt = b.alt || '';
        fitNatural(im, b.w || 0);
        fig.appendChild(im);
        // The title names the figure, the second line says where it came from —
        // two lines in the source, and they read as one run-on caption merged.
        if (b.cap) {
          const fc = document.createElement('figcaption'); fc.className = 'pr-figcap';
          const t = document.createElement('span'); t.className = 'pr-figcap-title'; t.innerHTML = renderRuns(b.cap.title).trim();
          fc.appendChild(t);
          if (b.cap.src) { const s = document.createElement('span'); s.className = 'pr-figcap-src'; s.innerHTML = renderRuns(b.cap.src).trim(); fc.appendChild(s); }
          fig.appendChild(fc);
        }
        box.appendChild(fig);
      }
      else if (b.t === 'ladder') {
        const d = document.createElement('div'); d.className = 'pr-ladder';
        for (const it of b.items) {
          const e = document.createElement(it.arrow ? 'span' : 'p');
          e.className = it.arrow ? 'pr-ladder-arrow' : 'pr-ladder-step';
          if (it.arrow) e.setAttribute('aria-hidden', 'true');
          e.innerHTML = renderRuns(it.runs);
          d.appendChild(e);
        }
        box.appendChild(d);
      }
      else if (b.t === 'table') box.appendChild(renderTable(b, counts, baseline));
    }
    const holder = document.createElement('div');
    holder.appendChild(frag);
    // A list of one is more often a caption marker that looked like a bullet
    // than a list — hand those back to the prose.
    holder.querySelectorAll(':scope ul.pr-list').forEach((ul) => {
      if (ul.children.length !== 1) return;
      const p = document.createElement('p'); p.innerHTML = ul.firstElementChild.innerHTML;
      ul.replaceWith(p);
    });
    return holder;
  }

  // Drop duplicate ids (keep first) so #anchors resolve unambiguously.
  function dedupeIds(reader) {
    const seen = new Set();
    reader.querySelectorAll('[id]').forEach((el) => { if (seen.has(el.id)) el.removeAttribute('id'); else seen.add(el.id); });
  }

  /* ── eyebrow ────────────────────────────────────────────────────────────
     A hub and a section page look identical once reskinned — same title
     treatment, same pager. Print the position instead:
       hub      Kapitel VIII · Übersicht
       section  Kapitel VIII · Respirationssystem… · Abschnitt 2   (→ the hub) */
  function renderCrumb(ref) {
    const nav = document.createElement('nav');
    nav.className = 'pr-crumb';
    const up = document.createElement(ref.num == null ? 'span' : 'a');
    up.className = 'pr-crumb-up';
    if (ref.num != null) up.href = ref.hub;
    const kap = document.createElement('span');
    kap.className = 'pr-crumb-kap';
    kap.textContent = 'Kapitel ' + ref.rom;
    up.appendChild(kap);
    if (ref.num != null) {
      const t = document.createElement('span');
      t.className = 'pr-crumb-of';
      t.textContent = ref.title;
      up.appendChild(t);
    }
    const sec = document.createElement('span');
    sec.className = 'pr-crumb-sec';
    sec.textContent = ref.num == null ? 'Übersicht' : 'Abschnitt ' + ordinal(ref);
    nav.append(up, sec);
    return nav;
  }

  // Above every title the site prints the same chrome: a site tagline and, on
  // section pages, a bare link back to the chapter under yet another name. The
  // crumb says both — and says them the same way on every page — so drop them.
  const TAGLINE = /^(Eine Reise durch die Physiologie|Physiologie lernen\b|Wie funktioniert der menschliche Körper\?$)/;
  function mountCrumb(reader, ref) {
    const kids = [...reader.children];
    let at = kids.findIndex((el) => /^H[1-3]$/.test(el.tagName));
    // Only trust a title near the top; deeper down it's body prose, and the
    // crumb belongs above the fold either way.
    if (at < 0 || at > 7) at = 0;
    for (let i = at - 1; i >= 0; i--) {
      const el = kids[i];
      if (el.tagName !== 'P') continue;
      const txt = norm(el.textContent), a = el.querySelector('a[href]');
      const backLink = a && norm(a.textContent) === txt &&
        base(a.getAttribute('href')).toLowerCase() === ref.hub.toLowerCase();
      if (TAGLINE.test(txt) || backLink) { el.remove(); at--; }
    }
    reader.insertBefore(renderCrumb(ref), reader.children[at] || null);
  }

  // Dropping the chrome above the title can leave the Inhaltsverzeichnis pill
  // and the prev/next pager as two stacked rows; they're one control. Fold them
  // together and re-sort into pager order (back · rest · forward).
  function mergeNavRows(reader) {
    reader.querySelectorAll('.pr-navrow + .pr-navrow').forEach((row) => {
      const into = row.previousElementSibling;
      while (row.firstChild) into.appendChild(row.firstChild);
      row.remove();
      [...into.children].sort((a, b) => navRank(a.textContent) - navRank(b.textContent))
        .forEach((a) => into.appendChild(a));
    });
  }

  // Number the index entries so a hub reads as a numbered chapter contents and
  // the numbers match the "Abschnitt n" the section page then shows. Only on
  // pages that HAVE an index (a hub, or Pruef.htm) — inside a section the same
  // shape is a run of "siehe auch" cross-references, which numbers would fake
  // into a contents.
  function numberIndex(reader, ref) {
    if (ref && ref.num != null) return;
    reader.querySelectorAll('.pr-linklist > p').forEach((p) => {
      // One entry, but the source often splits it across several <a>s sharing
      // the href (I.5's title is six of them) — accept those, reject real lists.
      const hrefs = [...p.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
      if (!hrefs.length || hrefs.some((h) => h !== hrefs[0])) return;
      if (hrefs[0].includes('#')) return;      // deep link into a section, not the section
      const to = pageRef(hrefs[0]);
      if (!to) return;
      const n = document.createElement('span');
      n.className = 'pr-linknum';
      n.textContent = to.num == null ? to.rom : ordinal(to) + '.';
      p.insertBefore(n, p.firstChild);
    });
  }

  function mountReader(reader) {
    // The site's <body> carries an inline background-color (plus legacy
    // bgcolor/link attrs); inline style outranks content.css's
    // `html.pr-on body { background: var(--paper) }` and bleeds through —
    // invisible on light themes (the site is near-white), glaring in dark.
    const b = document.body;
    b.removeAttribute('style');
    ['bgcolor', 'background', 'text', 'link', 'alink', 'vlink'].forEach((a) => b.removeAttribute(a));
    b.innerHTML = '';
    b.appendChild(reader);
    return reader;
  }

  /* ══ public entry points ═══════════════════════════════════════════════ */
  function reflow() {
    const src = document.body;
    const baseline = measureBaseline(src);
    const counts = imgCounts(src);
    const blocks = assemble(tokenize(src, counts, baseline), baseline);
    // Index the Begriffe list before rendering: renderRuns resolves the badges
    // against it, wherever they sit (prose, headings, nested box tables).
    glossary = buildGlossary(blocks);
    const rendered = renderBlocks(blocks, counts, baseline);
    const reader = document.createElement('main');
    reader.id = 'pr-reader';
    while (rendered.firstChild) reader.appendChild(rendered.firstChild);
    const ref = pageRef(location.pathname);
    numberIndex(reader, ref);
    if (ref) mountCrumb(reader, ref);
    mergeNavRows(reader);
    mountReader(reader);
    dedupeIds(reader);
    return reader;
  }

  // The landing page is all image-links with no text nav and decorative art;
  // the generic pipeline would leave orphan figures and no entry point. Emit a
  // curated hero instead (title · author portrait · one clear CTA).
  const isHome = () => ['/', '/index.html', '/index.htm', '/index.php'].includes((location.pathname || '/').toLowerCase());

  function renderHome() {
    // Read what we can from the live page, with byte-stable fallbacks.
    const portrait = document.querySelector('img[src*="HHS25" i]');
    const portraitSrc = (portrait && portrait.getAttribute('src')) || 'HHS25.jpg';
    const pruef = document.querySelector('a[href*="Pruef.htm" i]');
    const pruefHref = (pruef && pruef.getAttribute('href')) || 'Pruef.htm';
    const author = document.querySelector('a[href*="HHS" i][href$=".htm" i]');
    const authorHref = (author && author.getAttribute('href')) || 'HHS.deutsch.htm';

    const reader = document.createElement('main');
    reader.id = 'pr-reader';
    reader.className = 'pr-home';
    const hero = document.createElement('div');
    hero.className = 'pr-hero';

    const h1 = document.createElement('h1');
    h1.textContent = 'Physiologie des Menschen';
    const sub = document.createElement('p');
    sub.className = 'pr-hero-sub';
    sub.textContent = 'Eine Reise durch die Funktionen des menschlichen Körpers';

    const nav = document.createElement('nav');
    nav.className = 'pr-navrow';
    const cta = document.createElement('a');
    cta.className = 'pr-nav'; cta.href = pruefHref; cta.textContent = 'Zu den Prüfungsfragen';
    nav.appendChild(cta);

    // NOT a figure.pr-fig: tools.js claims every reader figure for the lightbox,
    // which swallowed the click and made this link dead. Portrait and label are
    // one link instead, so both halves of the affordance navigate.
    const bio = document.createElement('a');
    bio.className = 'pr-author'; bio.href = authorHref;
    const im = document.createElement('img'); im.src = portraitSrc; im.alt = ''; im.loading = 'lazy';
    const cap = document.createElement('span'); cap.className = 'pr-author-cap'; cap.textContent = 'Über den Autor';
    bio.append(im, cap);

    hero.append(h1, sub, nav, bio);
    reader.appendChild(hero);
    return mountReader(reader);
  }

  PR.reskin = { reflow, renderHome, isHome };
})();
