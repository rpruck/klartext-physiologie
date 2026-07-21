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
    'previous.gif': '‹ Zurück', 'nexttopic.gif': 'Weiter ›', 'man_kapue.jpg': 'Kapitelübersicht',
    'homebut.jpg': 'Startseite', 'los_gehts.jpg': 'Los geht’s ›', 'rechtsblau.jpg': 'Weiter ›',
    'linksblau.jpg': '‹ Zurück', 'greenbutton.jpg': 'Weiter ›', 'fua.jpg': 'Fragen & Antworten',
    'reise12.jpg': 'Zu den Prüfungsfragen', 'reise3.jpg': 'Zu den Prüfungsfragen',
  };
  // Single-use decorative art (mascots, motto banners, section labels) that the
  // size/repeat heuristics can't catch. Maintained deny-list — deco detection on
  // this site is inherently a curated list plus the size/repeat/aspect signals.
  const DECO = new Set(['begriff.jpg', 'begriffe.jpg', 'exkurs.jpg', 'spruchband.jpg', 'snake.jpg',
    'column.gif', 'smile1.jpeg', 'openacc.jpg', 'lstrc_archivelogo.png', 'merke.jpg', 'merke2.jpg',
    'pharm.jpg', 'histor.jpg', 'fkh.jpg', 'anw.jpg', 'orientierung.jpg', 'etym.jpg', 'vitru.jpg',
    'life_has_meaning.jpg', 'dt_real.jpg', 'ohne_physio.jpeg', 'ohne_physio.jpg']);
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
    if (sole && (NAV_LABEL[f] || (isPageLink(a.getAttribute('href')) && !isFigureSize(w, h))))
      return { kind: 'nav', href: a.getAttribute('href'), label: navLabel(f, a.getAttribute('href'), img.getAttribute('alt')) };
    if (isDecoName(f)) return { kind: 'deco' };
    if (counts.get(f) >= 3) return { kind: 'deco' };
    if (!w || !h) return { kind: 'inline' };
    const mn = Math.min(w, h), aspect = mn ? Math.max(w, h) / mn : 99;
    if (mn < 55 || w * h < 4000) return { kind: 'deco' };
    if (aspect >= 4.5 && mn <= 60) return { kind: 'deco' };
    if (isFigureSize(w, h)) return { kind: 'fig', src: img.getAttribute('src'), w, h, alt: img.getAttribute('alt') || '' };
    return { kind: 'deco' };
  }

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
    const directCells = [...t.querySelectorAll(':scope > tbody > tr > td, :scope > tr > td')];
    const singleCell = directCells.length <= 1;
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
        if (tag === 'IMG') {
          const c = classifyImg(n, counts);
          if (c.kind === 'fig') toks.push({ k: 'fig', ...c });
          else if (c.kind === 'nav') toks.push({ k: 'nav', href: c.href, label: c.label });
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
        walk(n, st);
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

  function assemble(toks, baseline) {
    const lines = [];
    let cur = [];
    const flush = () => { lines.push({ runs: cur }); cur = []; };
    for (const t of toks) {
      if (t.k === 'text') cur.push({ text: t.text, st: t.st });
      else if (t.k === 'anchor') cur.push({ text: '', anchor: t.id });
      else if (t.k === 'br' || t.k === 'block') flush();
      else if (t.k === 'fig' || t.k === 'nav' || t.k === 'table') { flush(); lines.push({ special: t }); }
      else if (t.k === 'hr') { flush(); lines.push({ special: { k: 'hr' } }); }
    }
    flush();

    const lineText = (l) => norm(l.runs ? l.runs.map((r) => r.text).join('') : '');
    const lineMaxSize = (l) => l.runs.reduce((m, r) => Math.max(m, r.st && r.st.size || baseline), 0);
    const lineBold = (l) => { const p = l.runs.filter((r) => r.text.trim()); return p.length && p.every((r) => r.st && r.st.b); };
    const lineAnchors = (l) => (l.runs || []).filter((r) => r.anchor).map((r) => r.anchor);
    const isGloss = (l) => l.runs && GLOSS.test(lineText(l)) && lineText(l).length <= 200;
    const glossFlag = lines.map((l) => !l.special && isGloss(l));

    function headingLevel(l) {
      const txt = lineText(l);
      if (!txt || txt.length > 90) return 0;
      if (/[,;(]$/.test(txt) || /^[)\];:,.]/.test(txt)) return 0;
      if (/:\s+[^=]*=/.test(txt)) return 0;                  // "Term: x = y" etymology → never a heading
      const sz = lineMaxSize(l), bold = lineBold(l);
      const big = sz >= baseline * 1.12;
      if (!big && !bold) return 0;
      if (/[.!?]\s+\S/.test(txt)) return 0;                  // reads like a full sentence
      if (sz >= baseline * 1.7) return 1;
      if (sz >= baseline * 1.32) return 2;
      if (big) return 3;
      if (bold) return 3;
      return 0;
    }

    const blocks = [];
    let para = null, deflist = null, pending = [];
    const drain = () => { const a = pending; pending = []; return a; };
    const flushPara = () => { if (para && norm(para.runs.map((r) => r.text).join(''))) blocks.push({ t: 'p', runs: para.runs, anchors: para.anchors }); para = null; };
    const flushDef = () => { if (deflist && deflist.items.length) blocks.push({ t: 'deflist', items: deflist.items, anchors: deflist.anchors }); deflist = null; };
    const flushGroups = () => { flushPara(); flushDef(); };

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.special) {
        flushGroups();
        const s = l.special, anchors = drain();
        if (s.k === 'fig') blocks.push({ t: 'fig', src: s.src, w: s.w, h: s.h, alt: s.alt, cap: '', anchors });
        else if (s.k === 'nav') blocks.push({ t: 'nav', href: s.href, label: s.label, anchors });
        else if (s.k === 'hr') blocks.push({ t: 'hr', anchors });
        else if (s.k === 'table') blocks.push({ t: 'table', kind: s.kind, el: s.el, anchors });
        continue;
      }
      const txt = lineText(l), anchors = lineAnchors(l);
      if (!txt) {
        if (anchors.length) { if (para) para.runs.push(...l.runs.filter((r) => r.anchor)); else if (deflist) deflist.items[deflist.items.length - 1] && deflist.items[deflist.items.length - 1].runs.push(...l.runs.filter((r) => r.anchor)); else pending.push(...anchors); }
        else flushGroups();
        continue;
      }
      if (glossFlag[i] && (glossFlag[i - 1] || glossFlag[i + 1])) {
        flushPara();
        if (!deflist) deflist = { items: [], anchors: drain() };
        deflist.items.push({ runs: l.runs });
        continue;
      }
      flushDef();
      const lvl = headingLevel(l);
      if (lvl) { flushPara(); blocks.push({ t: 'h', level: lvl, runs: l.runs, anchors: drain() }); continue; }
      if (!para) para = { runs: [], anchors: drain() };
      if (para.runs.length) para.runs.push({ text: ' ', st: {} });
      para.runs.push(...l.runs);
    }
    flushGroups();

    // attach "Abbildung/Nach/©" caption paragraphs to the figure above.
    const CAP = /^\s*(Abbildung|Abb\.|Abb\b|Nach\s|Fig\.|©)/;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].t !== 'fig') continue;
      const nxt = blocks[i + 1];
      if (nxt && nxt.t === 'p') {
        const txt = norm(nxt.runs.map((r) => r.text).join(''));
        if (CAP.test(txt) && txt.length < 320) { blocks[i].cap = txt; blocks.splice(i + 1, 1); }
      }
    }
    return blocks;
  }

  /* ══ render ════════════════════════════════════════════════════════════ */
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function renderRuns(runs) {
    let html = '';
    for (const r of runs) {
      if (r.anchor) html += '<span class="pr-anchor" id="' + esc(r.anchor) + '"></span>';
      let t = esc(r.text || '');
      if (!t) continue;
      const st = r.st || {};
      if (st.sup) t = '<sup>' + t + '</sup>';
      if (st.sub) t = '<sub>' + t + '</sub>';
      if (st.b && st.i) t = '<strong><em>' + t + '</em></strong>';
      else if (st.b) t = '<strong>' + t + '</strong>';
      else if (st.i) t = '<em>' + t + '</em>';
      if (st.href) t = '<a href="' + esc(st.href) + '">' + t + '</a>';
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
  function renderInlineOf(el, counts, baseline) {
    const toks = tokenize(el, counts, baseline);
    const runs = [];
    for (const t of toks) { if (t.k === 'text') runs.push({ text: t.text, st: t.st }); else if (t.k === 'anchor') runs.push({ text: '', anchor: t.id }); }
    return renderRuns(runs);
  }
  function renderTable(block, counts, baseline) {
    const { kind, el } = block;
    if (kind === 'data') {
      const rows = [...el.querySelectorAll('tr')];
      const maxCols = Math.max(1, ...rows.map((tr) => tr.querySelectorAll('td, th').length));
      const out = document.createElement('table'); out.className = 'pr-data';
      let capText = '';
      rows.forEach((tr) => {
        const cells = [...tr.querySelectorAll('td, th')];
        if (cells.length <= 1 && maxCols > 1) { const t = norm(tr.textContent); if (t) capText += (capText ? ' — ' : '') + t; return; }
        const row = document.createElement('tr');
        cells.forEach((c) => {
          const td = document.createElement('td');
          if (isBluish(cellBg(c)) || isCellBold(c)) td.className = 'pr-th';
          td.innerHTML = renderInlineOf(c, counts, baseline);
          row.appendChild(td);
        });
        if (row.children.length) out.appendChild(row);
      });
      if (capText) { const cap = document.createElement('caption'); cap.textContent = capText; out.insertBefore(cap, out.firstChild); }
      return out;
    }
    const wrap = document.createElement(kind === 'impp' ? 'aside' : 'div');
    wrap.className = kind === 'impp' ? 'pr-impp' : 'pr-box';
    if (kind === 'impp') { const k = document.createElement('div'); k.className = 'pr-impp-cap'; k.textContent = 'IMPP · prüfungsrelevant'; wrap.appendChild(k); }
    wrap.appendChild(renderBlocks(assemble(tokenize(el, counts, baseline), baseline), counts, baseline));
    return wrap;
  }
  function emitAnchors(frag, ids, seen) {
    for (const id of ids || []) { if (!id || seen.has(id)) continue; seen.add(id); const s = document.createElement('span'); s.className = 'pr-anchor'; s.id = id; frag.appendChild(s); }
  }
  function renderBlocks(blocks, counts, baseline, seen) {
    seen = seen || new Set();
    const frag = document.createDocumentFragment();
    let navGroup = null;
    for (const b of blocks) {
      if (b.t === 'nav') {
        emitAnchors(frag, b.anchors, seen);
        if (!navGroup) { navGroup = document.createElement('nav'); navGroup.className = 'pr-navrow'; frag.appendChild(navGroup); }
        const a = document.createElement('a'); a.className = 'pr-nav'; a.href = b.href; a.textContent = b.label; navGroup.appendChild(a);
        continue;
      }
      navGroup = null;
      emitAnchors(frag, b.anchors, seen);
      if (b.t === 'h') { const h = document.createElement('h' + b.level); h.innerHTML = renderRuns(b.runs); frag.appendChild(h); }
      else if (b.t === 'p') { const p = document.createElement('p'); p.innerHTML = renderRuns(b.runs); if (norm(p.textContent) || p.querySelector('[id]')) frag.appendChild(p); }
      else if (b.t === 'hr') frag.appendChild(document.createElement('hr'));
      else if (b.t === 'deflist') {
        const dl = document.createElement('dl'); dl.className = 'pr-defs';
        for (const it of b.items) { const [term, def] = splitAtColon(it.runs); const dt = document.createElement('dt'); dt.innerHTML = renderRuns(term); const dd = document.createElement('dd'); dd.innerHTML = renderRuns(def); dl.appendChild(dt); dl.appendChild(dd); }
        frag.appendChild(dl);
      }
      else if (b.t === 'fig') {
        const fig = document.createElement('figure'); fig.className = 'pr-fig';
        const im = document.createElement('img'); im.src = b.src; if (b.w) im.width = b.w; if (b.h) im.height = b.h; im.loading = 'lazy'; im.alt = b.alt || '';
        fig.appendChild(im);
        if (b.cap) { const fc = document.createElement('figcaption'); fc.className = 'pr-figcap'; fc.textContent = b.cap; fig.appendChild(fc); }
        frag.appendChild(fig);
      }
      else if (b.t === 'table') frag.appendChild(renderTable(b, counts, baseline));
    }
    const holder = document.createElement('div');
    holder.appendChild(frag);
    return holder;
  }

  // Drop duplicate ids (keep first) so #anchors resolve unambiguously.
  function dedupeIds(reader) {
    const seen = new Set();
    reader.querySelectorAll('[id]').forEach((el) => { if (seen.has(el.id)) el.removeAttribute('id'); else seen.add(el.id); });
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
    const rendered = renderBlocks(assemble(tokenize(src, counts, baseline), baseline), counts, baseline);
    const reader = document.createElement('main');
    reader.id = 'pr-reader';
    while (rendered.firstChild) reader.appendChild(rendered.firstChild);
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

    const fig = document.createElement('figure');
    fig.className = 'pr-fig';
    const a = document.createElement('a'); a.href = 'HHS.deutsch.htm';
    const im = document.createElement('img'); im.src = portraitSrc; im.alt = 'Der Autor'; im.loading = 'lazy';
    a.appendChild(im); fig.appendChild(a);
    const fc = document.createElement('figcaption'); fc.className = 'pr-figcap'; fc.textContent = 'Über den Autor';
    fig.appendChild(fc);

    hero.append(h1, sub, nav, fig);
    reader.appendChild(hero);
    return mountReader(reader);
  }

  PR.reskin = { reflow, renderHome, isHome };
})();
