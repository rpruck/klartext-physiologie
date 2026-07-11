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

  // ── image taxonomy ──────────────────────────────────────────────────────
  // Chapter navigation images → replace with a clean text link (keeping href).
  const NAV = {
    'previous.gif': '‹ Zurück',
    'nexttopic.gif': 'Weiter ›',
    'man_KapUe.jpg': 'Kapitelübersicht',
  };
  // Known decorative junk (icons, dots, spacer gifs, label banners, splash art).
  // Size alone misclassifies several of these (vitru 120×136, merke2, trumpetS,
  // Begriff, FuA, FKH), so this list is the primary signal.
  const DECO = new Set([
    'rechtspfeil.gif', 'fingerzeig.jpg', 'pll.jpg', 'platzhalter.jpg',
    '0l.jpg', '0r.jpg', 'vitru.jpg', 'index_finger.jpg', 'arrow.jpg',
    'begriff.jpg', 'begriffe.jpg', 'yellowball.jpg', 'dot_silver.jpg',
    'purpledot.jpeg', 'redball.gif', 'orangedot.jpg', 'mauvedot.jpg',
    'excl_m.jpg', 'icon_rund.jpg', 'stern.jpg', 'aster.jpg', 'nicebar.jpg',
    'blue_ani.gif', 'def_kl.jpg', 'pharm.jpg', 'histor.jpg', 'merke2.jpg',
    'merke.jpg', 'trumpets.jpg', 'trumpet.jpg', 'fua.jpg', 'fkh.jpg',
    'nexttopic.gif', 'previous.gif', // (handled by NAV first; here as backstop)
  ]);
  // Splash / branding art on hubs and the home page.
  const DECO_PREFIX = /^(man|hhs|reise|welcome|dilbert|smiley|aeskulap|saeule)/i;

  function isDecoName(f) {
    f = f.toLowerCase();
    return DECO.has(f) || DECO_PREFIX.test(f);
  }

  function convertNav(img, label) {
    const a = img.closest('a[href]');
    if (a) {
      a.textContent = label;
      a.classList.add('pr-nav');
      img.remove();
    } else {
      img.classList.add('pr-deco');
    }
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

  // Size-based fallback for images not on either list. naturalWidth is 0 until
  // the image loads and there are no width/height attrs, so defer to `load`.
  function decideBySize(img) {
    const run = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w && !h) return;               // still unknown → leave inline
      if (w >= 120 || h >= 110) wrapFigure(img);
      else if (Math.min(w, h) < 60) img.classList.add('pr-deco');
      // 60–120px: ambiguous, leave inline (rare)
    };
    if (img.complete && img.naturalWidth) run();
    else img.addEventListener('load', run, { once: true });
  }

  function classifyImages(root) {
    root = root || document.getElementById('pr-reader') || document.body;
    root.querySelectorAll('img').forEach((img) => {
      const f = base(img.getAttribute('src'));
      if (NAV[f]) { convertNav(img, NAV[f]); return; }
      if (isDecoName(f)) { img.classList.add('pr-deco'); return; }
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
