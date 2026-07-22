/* ══════════════════════════════════════════════════════════════════════
   outline.js — the page's sections, and the accordion over them.

   A reskinned section page is one uninterrupted column: I.1 renders 880
   top-level blocks under 47 headings, and nothing in it says which of those
   headings are SECTIONS and which are steps inside one. The author does say
   so — once, at the top of the page, as a row of links into his own text
   separated by a glyph (reskin.js reads it back out as <nav class="pr-spine">).
   I.1 names nine of its forty-six headings there. That row is the outline.

   build() wraps everything between one section's start and the next in a
   <section class="pr-sec">, so the page opens as a list of its own contents
   and one section at a time is read. Where a page has no strip (the hubs,
   Pruef.htm, Einheiten) it falls back to one section per H2, and where that
   yields fewer than three it builds nothing at all.

   ORDER MATTERS (content.js): build() runs with every section still open, so
   anchor.assignBlockIds() can measure real block ancestry and tools.restore()
   can wrap its marks; only then does applyState() collapse anything.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const PR = (window.__physioReskin ||= {});

  const MIN_SECTIONS = 3;
  /* Folding costs a click, so it has to buy something. Measured across the
     book, a real section page runs from 34k characters (I.0, the shortest) to
     over 400k; the short reference pages that also happen to carry three
     headings — Einheiten is 2k — fit on a screen and only lose by it. */
  const MIN_TEXT = 6000;
  let reader = null;
  let SECS = [];                       // [{ id, title, sec, head, body, btn }]
  const byId = new Map();
  const rec = () => (PR.page ? PR.page.rec : {});

  /* Chrome hides a `hidden=until-found` subtree with content-visibility rather
     than display:none, so Ctrl+F still finds the text inside it and fires
     `beforematch` on the way to revealing it. That is the whole reason the
     accordion doesn't break the browser's own search. */
  const UNTIL_FOUND = 'onbeforematch' in document.documentElement;

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  // The file this page calls itself, so a link can be told from a jump. The dev
  // harness serves a page's body from another path under a <base href> and
  // declares the original here; on the live site the URL is the truth.
  const thisFile = () => (window.__prSelfFile || (location.pathname || '').split('/').pop() || '').toLowerCase();

  // The hash of a link that points into THIS page, or null. Both spellings
  // occur, often in the same strip: "#Organellen" and "I.1.htm#Organellen".
  function localHash(a) {
    const href = a.getAttribute('href') || '';
    const i = href.indexOf('#');
    if (i < 0) return null;
    const pre = href.slice(0, i).toLowerCase();
    if (pre && pre !== thisFile()) return null;
    return decodeURIComponent(href.slice(i + 1)) || null;
  }

  // The reader's own child that contains `node` (a section boundary is always
  // a top-level block, never the zero-width anchor span buried inside it).
  function topLevel(node) {
    let el = node;
    while (el && el.parentElement && el.parentElement !== reader) el = el.parentElement;
    return el && el.parentElement === reader ? el : null;
  }
  const anchorEl = (hash) => {
    try { return reader.querySelector('[id="' + CSS.escape(hash) + '"]'); } catch (e) { return null; }
  };
  function targetOf(hash) {
    const el = anchorEl(hash);
    return el ? topLevel(el) : null;
  }
  // Does this anchor OPEN its block, or is it a word marked inside one? The
  // first is a section start, the second a cross-reference into running prose.
  function opensBlock(hash, block) {
    const el = anchorEl(hash);
    if (!el || !block) return false;
    const r = document.createRange();
    r.setStart(block, 0);
    r.setEndBefore(el);
    return !r.toString().trim();
  }

  /* ── where the sections begin ───────────────────────────────────────────
     The page's own strip, if it has one: the first .pr-spine standing above
     the first H2. Measured across the book, the top strip is always there and
     the sub-indices further down (I.1 has five) always sit below their first
     heading, so the position alone tells them apart. */
  function spineNav(kids) {
    const firstH2 = kids.findIndex((el) => el.tagName === 'H2');
    const limit = firstH2 < 0 ? kids.length : firstH2;
    for (let i = 0; i < limit; i++) if (kids[i].classList && kids[i].classList.contains('pr-spine')) return kids[i];
    return null;
  }

  // → [{ at, title }] sorted by position, one per section, never two at once.
  function boundaries(kids) {
    const nav = spineNav(kids);
    const out = [];
    const seen = new Set();
    const spent = new Set();          // preamble blocks the outline has absorbed
    const add = (at, title) => {
      if (at == null || at < 0 || seen.has(at) || !norm(title)) return false;
      seen.add(at); out.push({ at, title: norm(title) });
      return true;
    };
    if (nav) {
      const navAt = kids.indexOf(nav);
      [...nav.querySelectorAll('a[href]')].forEach((a) => {
        const h = localHash(a);
        const t = h && targetOf(h);
        const at = t ? kids.indexOf(t) : -1;
        // A strip entry pointing back above the strip is a cross-reference,
        // not a section of the page below it.
        if (at > navAt) add(at, a.textContent);
      });
      out.sort((x, y) => x.at - y.at);
      if (out.length >= MIN_SECTIONS) {
        /* "Praktische Aspekte" and "Core messages" close nearly every page but
           are set off with their own glyphs (cloud3, redball) instead of being
           joined to the strip, so they sit beside it rather than in it. Sweep
           the rest of the preamble for them.
           The same region also holds the Definition shortcuts and the abstract,
           both of which link deep into the middle of sections — followed, they
           would cut those sections in half. Both are asides (a callout and the
           IMPP card); the page's own navigation is never one. */
        kids.slice(0, out[0].at).forEach((el) => {
          if (el.tagName === 'ASIDE') return;
          [...el.querySelectorAll('a[href]')].forEach((a) => {
            const h = localHash(a);
            const t = h && targetOf(h);
            const at = t ? kids.indexOf(t) : -1;
            if (at > navAt && opensBlock(h, t) && add(at, a.textContent)) spent.add(el);
          });
        });
        out.sort((x, y) => x.at - y.at);
        // Anything past the last of them still falls back to one per heading.
        const last = out[out.length - 1].at;
        kids.forEach((el, i) => { if (i > last && el.tagName === 'H2') add(i, el.textContent); });
        out.sort((x, y) => x.at - y.at);
        spent.add(nav);
        return { list: out, spent };
      }
    }
    // No usable strip: every top-level heading opens a section.
    const flat = [];
    kids.forEach((el, i) => { if (el.tagName === 'H2') flat.push({ at: i, title: norm(el.textContent) }); });
    return { list: flat.filter((b) => b.title), spent: new Set() };
  }

  const slug = (s) => (PR.anchor ? PR.anchor.fnv1a(s.toLowerCase()) : s.replace(/\W+/g, '-').toLowerCase());

  /* ── build ─────────────────────────────────────────────────────────────── */
  let seq = 0;
  // Fold `nodes` (consecutive children of the reader) into one section, in place.
  function makeSection(id, title, num, nodes) {
    const n = seq++;
    const sec = document.createElement('section');
    sec.className = 'pr-sec';
    sec.dataset.sec = id;
    sec.dataset.open = '1';

    const head = document.createElement('h2');
    head.className = 'pr-sec-head';
    const btn = document.createElement('button');
    btn.className = 'pr-sec-btn';
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', 'pr-sec-b-' + n);
    btn.innerHTML = '<span class="pr-sec-num"></span><span class="pr-sec-title"></span>' +
      '<span class="pr-sec-meter" aria-hidden="true"></span><span class="pr-sec-chev" aria-hidden="true"></span>';
    btn.querySelector('.pr-sec-num').textContent = num;
    btn.querySelector('.pr-sec-title').textContent = title;
    head.appendChild(btn);

    const body = document.createElement('div');
    body.className = 'pr-sec-body';
    body.id = 'pr-sec-b-' + n;

    reader.insertBefore(sec, nodes[0]);
    nodes.forEach((el) => body.appendChild(el));

    /* Closing a long section otherwise means scrolling all the way back to its
       head — which is exactly the thing you have just finished reading past. */
    const fold = document.createElement('button');
    fold.className = 'pr-sec-fold pr-chrome';
    fold.type = 'button';
    fold.textContent = 'Abschnitt einklappen';
    body.appendChild(fold);
    sec.append(head, body);

    const entry = { id, title, sec, head, body, btn, fold };
    byId.set(id, entry);
    btn.addEventListener('click', () => toggle(id));
    fold.addEventListener('click', () => close(id));
    if (UNTIL_FOUND) body.addEventListener('beforematch', () => open(id, false));
    return entry;
  }

  function build(root) {
    reader = root || document.getElementById('pr-reader');
    if (!reader) return 0;
    if (norm(reader.textContent).length < MIN_TEXT) return 0;
    const kids = [...reader.children];
    const { list, spent } = boundaries(kids);
    if (list.length < MIN_SECTIONS) return 0;

    list.forEach((b, n) => {
      const from = b.at, to = n + 1 < list.length ? list[n + 1].at : kids.length;
      // The id is the author's anchor where there is one — it survives our own
      // re-tokenising, which a positional index would not.
      const anchored = kids[from].querySelector && kids[from].querySelector('.pr-anchor[id]');
      const id = (anchored && anchored.id) || kids[from].id || slug(b.title);
      SECS.push(makeSection(id, b.title, String(n + 1), kids.slice(from, to)));
    });

    /* The page's Begriffe list is 25 entries of etymology above everything else
       — a reference table you consult, not the opening of the article. Left in
       the preamble it pushed the whole section list below the fold, which is
       the one thing this is here to prevent. Fold it too, unnumbered: it is not
       one of the author's sections, it is the page's apparatus. */
    const gloss = reader.querySelector(':scope > section.pr-gloss');
    if (gloss) {
      const label = gloss.querySelector('.pr-label');
      // …its own label is left in place, hidden by CSS while the section head
      // says the same word, so turning the accordion off restores it.
      SECS.unshift(makeSection('_gloss', (label && norm(label.textContent)) || 'Begriffe', '', [gloss]));
    }

    /* The strip — and the "Praktische Aspekte · Core messages" line beside it —
       now say exactly what the collapsed list says, one block below. Keep them
       in the DOM (the setting can turn the accordion off again) and let CSS
       drop them while the accordion stands; a block that also holds prose or an
       unconsumed link keeps its place. */
    spent.forEach((el) => {
      if (!el.isConnected) return;
      const links = [...el.querySelectorAll('a[href]')];
      const linked = links.map((a) => a.textContent).join('').replace(/\s+/g, '');
      if (linked && linked.length >= norm(el.textContent).replace(/\s+/g, '').length * 0.9) el.classList.add('pr-spine-used');
    });
    wireLinks();
    return SECS.length;
  }

  /* ── open / close ──────────────────────────────────────────────────────── */
  const sectionOf = (node) => (node && node.closest ? node.closest('.pr-sec') : null);
  const isOpen = (e) => e && e.sec.dataset.open === '1';

  function setOpen(e, on) {
    if (!e) return;
    e.sec.dataset.open = on ? '1' : '0';
    e.btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) { e.body.removeAttribute('hidden'); }
    else e.body.setAttribute('hidden', UNTIL_FOUND ? 'until-found' : '');
  }
  function remember() {
    if (!PR.page) return;
    rec().open = SECS.filter(isOpen).map((e) => e.id);
    PR.page.save();
  }
  function open(id, persist) {
    const e = byId.get(id); if (!e || isOpen(e)) return e;
    setOpen(e, true);
    if (persist !== false) remember();
    PR.progress && PR.progress.refresh && PR.progress.refresh();
    PR.tools && PR.tools.layoutNotes && PR.tools.layoutNotes();
    return e;
  }
  function close(id) {
    const e = byId.get(id); if (!e || !isOpen(e)) return;
    // Closing a section the reader has scrolled into pulls the page out from
    // under them — bring its head back to where their eyes already are.
    const above = e.sec.getBoundingClientRect().top < 0;
    setOpen(e, false);
    if (above) e.sec.scrollIntoView({ block: 'start', behavior: 'auto' });
    remember();
    PR.progress && PR.progress.refresh && PR.progress.refresh();
    PR.tools && PR.tools.layoutNotes && PR.tools.layoutNotes();
  }
  const toggle = (id) => (isOpen(byId.get(id)) ? close(id) : open(id));
  function openAll(on) {
    SECS.forEach((e) => setOpen(e, on !== false));
    remember();
    PR.progress && PR.progress.refresh && PR.progress.refresh();
    PR.tools && PR.tools.layoutNotes && PR.tools.layoutNotes();
  }

  // Expand whatever holds `node` and hand back the section (for deep links,
  // bookmarks and the rail, all of which land on blocks that may be folded away).
  function reveal(node) {
    const sec = sectionOf(node);
    if (!sec) return null;
    const e = byId.get(sec.dataset.sec);
    if (e && !isOpen(e)) open(e.id);
    return e;
  }

  /* ── in-page links ─────────────────────────────────────────────────────
     The book cross-references itself constantly (the Begriffe badges, every
     "s. dort", the sub-indices). Each of those targets may now be folded away,
     so open its section before the browser tries to scroll to it. */
  function goto(hash, smooth) {
    const t = hash && targetOf(hash);
    if (!t) return false;
    reveal(t);
    let el = null;
    try { el = reader.querySelector('[id="' + CSS.escape(hash) + '"]'); } catch (e) { /* bad id */ }
    (el || t).scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
    return true;
  }
  function wireLinks() {
    reader.addEventListener('click', (ev) => {
      const a = ev.target.closest && ev.target.closest('a[href]');
      if (!a || ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
      const h = localHash(a);
      if (!h) return;
      if (goto(h, true)) { ev.preventDefault(); history.replaceState(null, '', '#' + h); }
    });
    window.addEventListener('hashchange', () => goto(location.hash.slice(1), false));
  }

  /* ── state ─────────────────────────────────────────────────────────────── */
  function applyState() {
    if (!SECS.length) return;
    const stored = rec().open;
    // A page never opened before starts fully collapsed — that IS the feature.
    const want = new Set(Array.isArray(stored) ? stored : []);
    SECS.forEach((e) => setOpen(e, want.has(e.id)));
    // Whatever the URL points at outranks the stored state.
    if (location.hash.length > 1) goto(decodeURIComponent(location.hash.slice(1)), false);
    // restore() laid the notes out while everything was still open; the ones
    // belonging to marks just folded away have to leave the gutter again.
    PR.tools && PR.tools.layoutNotes && PR.tools.layoutNotes();
  }

  PR.outline = {
    build, applyState, open, close, toggle, openAll, reveal, goto, sectionOf,
    get sections() { return SECS; },
    at: (id) => byId.get(id),
    isOpen: (id) => isOpen(byId.get(id)),
  };
})();
