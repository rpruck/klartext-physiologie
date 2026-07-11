/* ══════════════════════════════════════════════════════════════════════
   reskin.js — Strategy-A DOM transforms (the highest-risk code).

   Pipeline (called from content.js in this order):
     wrapReader()      move body content into #pr-reader (centred measure)
     measureHeadings() BEFORE .pr-on — infer heading levels from the site's
                       ORIGINAL computed font-sizes, tag data-pr-h
     transform()       classify tables (M4) + images (M3), then strip the
                       site's presentational cruft so the reskin CSS applies
                       to a clean DOM

   Heading map (measured on real pages): 32px title / 24px section /
   18px subhead / 16px body / 13px caption.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const PR = (window.__physioReskin ||= {});

  function directText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.trim();
  }

  const base = (s) => (s || '').split('/').pop().split('?')[0].split('#')[0];

  /* ── image taxonomy ──────────────────────────────────────────────────────
     Three buckets: NAVIGATION (button/arrow images whose only job is to link
     somewhere → become clean text links), DECORATION (icons, dots, spacers,
     label banners, mascots → hidden), and FIGURES (the informative scientific
     illustrations → kept, zoomable, pinnable).

     Signals, in order of trust:
       1. A lone image inside a link to another PAGE is navigation. Real
          figures that link do so with a #anchor ("see this figure in
          context"); pure page links (II.htm, I.0.htm, Pruef.htm) are nav.
       2. Decorative markers REPEAT — a file used 3+ times on one page is
          structural chrome (rechtspfeil x95, Fingerzeig x62, dots, spacers).
          Real figures appear exactly once.
       3. Size — tiny (< 55px short side), thin label banners, and small
          ambiguous graphics are decoration; anything with real area
          (>= 11000px2 or >= 120px short side) is a figure.
     A short curated name list is only a backstop for single-use decorative art
     (mascots/labels on hub pages) that slips past the heuristics. */

  // Known navigation button/arrow images → labelled text links (keys lowercase).
  const NAV_LABEL = {
    'previous.gif': '‹ Zurück',
    'nexttopic.gif': 'Weiter ›',
    'man_kapue.jpg': 'Kapitelübersicht',
    'homebut.jpg': 'Startseite',
    'los_gehts.jpg': 'Los geht’s ›',
    'rechtsblau.jpg': 'Weiter ›',
    'linksblau.jpg': '‹ Zurück',
    'greenbutton.jpg': 'Weiter ›',
    'fua.jpg': 'Fragen & Antworten',
    'reise12.jpg': 'Zu den Prüfungsfragen',
    'reise3.jpg': 'Zu den Prüfungsfragen',
  };

  // Single-use decorative art (mascots, motto banners, section labels) that the
  // size/repeat heuristics cannot catch on their own. Dots/spacers/icons are
  // caught by repeat count and size, so this list stays short.
  const DECO = new Set([
    'begriff.jpg', 'begriffe.jpg', 'exkurs.jpg', 'spruchband.jpg', 'snake.jpg',
    'column.gif', 'smile1.jpeg', 'openacc.jpg', 'lstrc_archivelogo.png',
    'life_has_meaning.jpg', 'dt_real.jpg', 'vitru.jpg', 'merke.jpg', 'merke2.jpg',
    'pharm.jpg', 'histor.jpg', 'fkh.jpg', 'anw.jpg', 'orientierung.jpg', 'etym.jpg',
  ]);
  // Splash / branding / mascot art on hubs and the home page.
  const DECO_PREFIX = /^(hhs|reise|welcome|dilbert|smiley|aeskulap|saeule)/i;

  function isDecoName(f) {
    f = f.toLowerCase();
    return DECO.has(f) || DECO_PREFIX.test(f);
  }

  // A figure is worth keeping/zooming when it has real area; small single-use
  // graphics (chapter badges, "Exkurs" labels) are decoration.
  function isFigureSize(w, h) {
    return (w * h >= 11000) || (Math.min(w, h) >= 120);
  }

  // Intrinsic size if the image has loaded, else the size declared in markup.
  // This site states sizes inline (style="width:615px; height:332px") and the
  // reskin classifies at document_end BEFORE images load, so the markup size is
  // what we usually read — naturalWidth just refines it once loaded.
  const styleDim = (img, prop) => {
    const m = (img.getAttribute('style') || '').match(new RegExp('(?:^|;|\\s)' + prop + ':\\s*(\\d+(?:\\.\\d+)?)px', 'i'));
    return m ? Math.round(parseFloat(m[1])) : 0;
  };
  function imgSize(img) {
    const w = img.naturalWidth || parseInt(img.getAttribute('width'), 10) || styleDim(img, 'width') || 0;
    const h = img.naturalHeight || parseInt(img.getAttribute('height'), 10) || styleDim(img, 'height') || 0;
    return [w, h];
  }

  // href points to another page on this site (not an in-page #anchor, not an
  // external site, not mailto) — the hallmark of a navigation button.
  function isPageLink(href) {
    if (!href) return false;
    if (href[0] === '#') return false;
    if (/^(mailto|javascript):/i.test(href)) return false;
    if (/^https?:\/\//i.test(href)) return false;   // external → not site nav
    if (href.includes('#')) return false;            // #anchor → figure reference
    return /\.html?$/i.test(base(href));
  }

  function navLabel(f, href, alt) {
    if (NAV_LABEL[f]) return NAV_LABEL[f];
    const b = base(href).toLowerCase();
    const rom = b.match(/^([ivxlc]+)\.html?$/);
    if (rom) return 'Kapitel ' + rom[1].toUpperCase() + ' ›';
    if (/^index\.html?$/.test(b)) return 'Startseite';
    if (/^pruef/.test(b)) return 'Zu den Prüfungsfragen';
    if (alt && alt.trim()) return alt.trim();
    return 'Weiter ›';
  }

  // The anchor contains only this image (no visible text of its own).
  function isSoleImageLink(a) {
    return a && !a.textContent.trim() && a.querySelectorAll('img').length === 1;
  }
  // A sibling link to the same target already carries text, so the arrow image
  // is redundant and can simply be dropped.
  function hasRedundantTextLink(a) {
    const href = a.getAttribute('href');
    for (const sib of [a.previousElementSibling, a.nextElementSibling]) {
      if (sib && sib.tagName === 'A' && sib.getAttribute('href') === href && sib.textContent.trim()) return true;
    }
    return false;
  }

  // Turn a navigation image into a clean text link — or drop it entirely when an
  // equivalent text link already sits beside it.
  function convertNav(img, a, label) {
    if (hasRedundantTextLink(a)) {
      img.remove();
      if (!a.textContent.trim() && !a.querySelector('img')) a.remove();
      return;
    }
    a.textContent = label;
    a.classList.add('pr-nav');
    img.remove();
  }

  function wrapFigure(img) {
    if (img.closest('figure.pr-fig')) return;
    const fig = document.createElement('figure');
    fig.className = 'pr-fig';
    img.parentNode.insertBefore(fig, img);
    fig.appendChild(img);
    img.classList.add('pr-figimg');
    img.dataset.prFig = '1'; // M6 wires click-to-zoom/pin off this
  }

  // Size-based decision for images that are not nav / known-deco / repeated.
  // Sizes usually come from the markup (see imgSize); if an image declares none
  // and hasn't loaded, defer until its intrinsic size is known.
  function decideBySize(img) {
    const decide = () => {
      const [w, h] = imgSize(img);
      if (!w || !h) return;                        // still unknown → leave inline
      const mn = Math.min(w, h), aspect = mn ? Math.max(w, h) / mn : 99;
      if (mn < 55 || w * h < 4000) { img.classList.add('pr-deco'); return; }    // dots/spacers/thin rules
      if (aspect >= 4.5 && mn <= 60) { img.classList.add('pr-deco'); return; }  // label banners
      if (isFigureSize(w, h)) { wrapFigure(img); return; }
      img.classList.add('pr-deco');                 // small single-use graphic
    };
    const [w, h] = imgSize(img);
    if (w && h) decide();
    else if (!img.complete) img.addEventListener('load', decide, { once: true });
    // else: loaded but sizeless (broken image) → leave inline
  }

  function classifyImages(root) {
    root = root || document.getElementById('pr-reader') || document.body;
    const imgs = [...root.querySelectorAll('img')];

    // Per-page occurrence count: a file used 3+ times is structural chrome.
    // Classify on the lower-cased basename so name lookups are case-insensitive
    // (the site mixes Los_gehts.jpg / man_KapUe.jpg / FuA.jpg); the real src
    // attribute is never touched, so images still load.
    const counts = new Map();
    imgs.forEach((img) => { const f = base(img.getAttribute('src')).toLowerCase(); counts.set(f, (counts.get(f) || 0) + 1); });

    imgs.forEach((img) => {
      const f = base(img.getAttribute('src')).toLowerCase();
      const a = img.closest('a[href]');
      const sole = isSoleImageLink(a);

      // 1 · navigation — known nav art (any size), or a lone image linking to a
      //     page. The figure-size guard keeps a genuine illustration that merely
      //     happens to link out from being demoted to a text link.
      if (a && sole) {
        const [w, h] = imgSize(img);
        if (NAV_LABEL[f] || (isPageLink(a.getAttribute('href')) && !isFigureSize(w, h))) {
          convertNav(img, a, navLabel(f, a.getAttribute('href'), img.getAttribute('alt')));
          return;
        }
      }
      // 2 · known decorative art (mascots, labels) — backstop for single-use junk.
      if (isDecoName(f)) { img.classList.add('pr-deco'); return; }
      // 3 · repeated markers (icons, dots, spacers, arrows used many times).
      if (counts.get(f) >= 3) { img.classList.add('pr-deco'); return; }
      // 4 · everything else decided by size (deferred until load if unknown).
      decideBySize(img);
    });
    tagCaptions(root);
  }

  // ── tables ──────────────────────────────────────────────────────────────
  function parseColor(s) {
    if (!s) return null;
    s = s.trim().toLowerCase();
    if (s === 'yellow') return { r: 255, g: 255, b: 0 };
    if (s === 'white') return { r: 255, g: 255, b: 255 };
    if (s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return null;
    if (s[0] === '#') {
      const h = s.slice(1);
      const x = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      if (x.length >= 6) return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16) };
    }
    const m = s.match(/\d+/g);
    return m && m.length >= 3 ? { r: +m[0], g: +m[1], b: +m[2] } : null;
  }
  const cellBg = (c) => parseColor(c.getAttribute && c.getAttribute('bgcolor')) ||
    parseColor(c.style && c.style.backgroundColor);
  const isYellowish = (p) => p && p.r >= 248 && p.g >= 235 && p.b < p.g && (p.r - p.b) >= 6;
  const isBluish = (p) => p && p.b >= 110 && p.r < 90 && p.g < 90;
  const isColored = (p) => p && !(p.r >= 250 && p.g >= 250 && p.b >= 250);

  // Classify each table BEFORE stripInline removes bgcolor. IMPP/yellow boxes
  // are exam-relevance callouts and must be PRESERVED (never hidden).
  function classifyTables(root) {
    root = root || document.getElementById('pr-reader') || document.body;
    root.querySelectorAll('table').forEach((t) => {
      if (t.parentElement && t.parentElement.closest('table.pr-impp, table.pr-box, table.pr-data')) return;
      const tds = t.querySelectorAll('td');
      const cells = [...t.querySelectorAll('td, th')];
      const anyBlue = cells.some((c) => isBluish(cellBg(c)));
      const anyColored = cells.some((c) => isColored(cellBg(c))) || isColored(cellBg(t));
      const singleCell = tds.length <= 1;

      if (singleCell && anyColored) {
        const yellow = cells.some((c) => isYellowish(cellBg(c))) || isYellowish(cellBg(t));
        t.classList.add(yellow ? 'pr-impp' : 'pr-box');
        if (yellow) {
          const cap = document.createElement('caption');
          cap.className = 'pr-impp-cap';
          cap.textContent = 'IMPP · prüfungsrelevant';
          t.insertBefore(cap, t.firstChild);
        }
      } else if (!singleCell && (anyBlue || anyColored)) {
        t.classList.add('pr-data');
        cells.forEach((c) => { if (isBluish(cellBg(c))) c.classList.add('pr-th'); });
      }
      // else: an uncoloured multi-cell table is treated as layout — left alone.
    });
  }

  // Style the "Abbildung: …" / "Nach …" caption runs without moving nodes
  // (moving them would perturb annotation offsets). Tag their nearest inline
  // container so CSS can render it as a caption.
  function tagCaptions(root) {
    const CAP = /^\s*(Abbildung|Abb\.|Abb\b|Nach\s|Fig\.)/;
    root.querySelectorAll('font, span, small, i, div').forEach((el) => {
      const t = directText(el);
      if (t && CAP.test(t) && t.length < 320 && !el.querySelector('img')) {
        el.classList.add('pr-figcap');
      }
    });
  }

  // Move every body child into a single reader wrapper. Safe: <a name>
  // anchors and ids ride along inside the moved nodes, so intra-page links
  // keep resolving.
  function wrapReader() {
    let r = document.getElementById('pr-reader');
    if (r) return r;
    r = document.createElement('div');
    r.id = 'pr-reader';
    const body = document.body;
    while (body.firstChild) r.appendChild(body.firstChild);
    body.appendChild(r);
    return r;
  }

  // Infer heading levels from computed font-size. MUST run before .pr-on so
  // the sizes read are the site's originals, not the reskin's.
  function measureHeadings(root) {
    root = root || document.getElementById('pr-reader') || document.body;
    let n1 = 0, n2 = 0, n3 = 0;
    root.querySelectorAll('*').forEach((el) => {
      if (el.dataset.prH) return;
      const txt = directText(el);
      if (!txt) return;
      const fs = parseFloat(getComputedStyle(el).fontSize) || 0;
      const len = txt.length;
      let lvl = 0;
      if (fs >= 30 && len < 200) lvl = 1;
      else if (fs >= 22 && len < 200) lvl = 2;
      else if (fs >= 17 && len < 100) lvl = 3; // length guard: skip large emphasis runs
      if (lvl) {
        el.dataset.prH = String(lvl);
        if (lvl === 1) n1++; else if (lvl === 2) n2++; else n3++;
      }
    });
    return { h1: n1, h2: n2, h3: n3 };
  }

  // Remove the presentational cruft that would otherwise fight the reskin.
  // Runs AFTER measurement (which needs the original sizes) and AFTER table
  // classification (which needs the original bgcolor).
  function stripInline(root) {
    root = root || document.getElementById('pr-reader') || document.body;
    root.querySelectorAll('font[face]').forEach((f) => f.removeAttribute('face'));
    root.querySelectorAll('font[color]').forEach((f) => f.removeAttribute('color'));
    root.querySelectorAll('font[size]').forEach((f) => f.removeAttribute('size'));
    // Backgrounds were already read by classifyTables; now neutralise them
    // uniformly. Intentional colour comes back via classes (.pr-impp/.pr-data…).
    root.querySelectorAll('[bgcolor]').forEach((el) => el.removeAttribute('bgcolor'));
    root.querySelectorAll('[style]').forEach((el) => {
      const s = el.style;
      s.removeProperty('color');
      s.removeProperty('background');
      s.removeProperty('background-color');
      s.removeProperty('font-family');
      s.removeProperty('font-size');
      s.removeProperty('line-height');
      s.removeProperty('letter-spacing');
    });
  }

  // Full Strategy-A transform. Image/table classification land in M3/M4;
  // for now the ordering contract is fixed so those slot in cleanly.
  function transform(root) {
    root = root || document.getElementById('pr-reader') || document.body;
    if (PR.reskin.classifyTables) PR.reskin.classifyTables(root); // M4 (reads bgcolor first)
    if (PR.reskin.classifyImages) PR.reskin.classifyImages(root); // M3
    stripInline(root);
  }

  PR.reskin = {
    wrapReader, measureHeadings, stripInline, transform, directText,
    classifyImages, wrapFigure, tagCaptions, classifyTables, base,
  };
})();
