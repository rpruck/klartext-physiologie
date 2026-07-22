/* ══════════════════════════════════════════════════════════════════════
   progress.js — the reading rail: what you have read, and where you stopped.

   A hairline ruler pinned to the right edge (after makingsoftware.com): one
   tick per unit of the page, the ticks you have read faded back, the tick you
   are on in the accent, section labels and a percentage on hover.

   The ruler measures the OUTLINE, not the scrollbar. Ticks are shared out
   between outline.js's sections in proportion to how much text each holds, so
   folding a section away doesn't make the rail jump — which a scroll-derived
   ruler beside an accordion would do on every click. It also means progress is
   a real quantity we can store and restore, rather than a scroll offset that
   means nothing after a re-render.

   Per-page state lives in PR.page.rec:
     read   { sectionId: 0..1 }   high-water mark — reading never un-reads
     auto   { … }                 where you were when you last left the page
     marks  [ … ]                 bookmarks you set on purpose
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const PR = (window.__physioReskin ||= {});

  const PITCH = 10;                    // px between ticks (the reference's density)
  const READ_LINE = 0.33;              // where on screen "what I am reading" sits
  /* How far left of the window edge the rail starts paying attention. Widening
     the rail element itself to reach this far would blanket a 140px strip of
     the margin in pointer-events and take the text under it out of selection
     range on a narrow window — so the lane stays narrow and proximity is
     measured instead. */
  const REACH = 140;
  const REACH_TOP = 64;                // …but not up in the topbar's corner
  const q = (s) => (PR.ui && PR.ui.shadow) ? PR.ui.shadow.querySelector(s) : null;

  let reader = null;
  let SEGS = [];                       // [{ id, title, weight, ticks, from, sec, body }]
  let ticks = [];                      // rail tick elements, in order
  let total = 0, nTicks = 0;
  let raf = 0, autoTimer = null;

  const rec = () => (PR.page ? PR.page.rec : { read: {}, marks: [] });
  const readOf = (id) => (rec().read && rec().read[id]) || 0;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const on = () => document.documentElement.dataset.rail !== '0';

  /* ── the model ─────────────────────────────────────────────────────────
     One segment per section. A page with no outline (a hub, Pruef.htm) is one
     unnamed segment covering the whole reader, so the rail still tells you
     how far down you are. */
  function model() {
    const secs = (PR.outline && PR.outline.sections) || [];
    SEGS = secs.length
      ? secs.map((e) => ({ id: e.id, title: e.title, sec: e.sec, body: e.body, weight: Math.max(1, e.body.textContent.length) }))
      : [{ id: '_page', title: '', sec: reader, body: reader, weight: Math.max(1, reader.textContent.length) }];
    total = SEGS.reduce((a, s) => a + s.weight, 0);
  }

  /* ── the ruler ─────────────────────────────────────────────────────────── */
  function layout() {
    const rail = q('#pr-rail'), ticksEl = q('#railTicks'), labelsEl = q('#railLabels');
    if (!rail || !ticksEl) return;
    const h = rail.clientHeight;
    nTicks = Math.max(8, Math.floor(h / PITCH));
    // Share the ticks out by text weight, but never starve a short section of
    // its own mark — a section you cannot see is a section you cannot click.
    let used = 0;
    SEGS.forEach((s, i) => {
      s.ticks = i === SEGS.length - 1
        ? Math.max(1, nTicks - used)
        : Math.max(1, Math.round(nTicks * s.weight / total));
      s.from = used; used += s.ticks;
    });
    nTicks = used;

    ticksEl.innerHTML = '';
    labelsEl.innerHTML = '';
    ticks = [];
    const step = h / nTicks;
    SEGS.forEach((s, si) => {
      for (let k = 0; k < s.ticks; k++) {
        const t = document.createElement('span');
        t.className = 'rail-tick' + (k === 0 && SEGS.length > 1 ? ' head' : '');
        t.style.top = Math.round((s.from + k) * step) + 'px';
        t.dataset.seg = String(si);
        t.dataset.f = String((k + 0.5) / s.ticks);
        ticksEl.appendChild(t);
        ticks.push(t);
      }
      // The Begriffe list is the page's apparatus, not a step in its argument —
      // and its label sat on top of the abstract's, which is a step.
      if (SEGS.length > 1 && s.title && s.id !== '_gloss') {
        const l = document.createElement('button');
        l.className = 'rail-label';
        l.type = 'button';
        l.textContent = s.title;
        l.style.top = Math.round(s.from * step) + 'px';
        l.dataset.seg = String(si);
        labelsEl.appendChild(l);
        s.label = l;
      }
    });
    // Short sections sit a tick or two apart and their labels land on top of
    // each other. Drop the ones that can't be read; the tick is still there,
    // and hovering it still travels.
    let lastY = -99;
    SEGS.forEach((s) => {
      if (!s.label) return;
      const y = parseFloat(s.label.style.top);
      if (y - lastY < 15) s.label.classList.add('crowded');
      else lastY = y;
    });
    paint();
  }

  // Which tick a (segment, fraction) pair sits on.
  const tickAt = (si, f) => {
    const s = SEGS[si]; if (!s) return 0;
    return s.from + Math.min(s.ticks - 1, Math.floor(clamp01(f) * s.ticks));
  };

  /* ── paint ─────────────────────────────────────────────────────────────── */
  function paint() {
    if (!ticks.length) return;
    SEGS.forEach((s, si) => {
      const r = readOf(s.id);
      const folded = s.sec && s.sec.dataset && s.sec.dataset.open === '0';
      for (let k = 0; k < s.ticks; k++) {
        const t = ticks[s.from + k];
        if (!t) continue;
        t.classList.toggle('read', (k + 0.5) / s.ticks <= r);
        t.classList.toggle('folded', !!folded);
      }
      if (SEGS.length > 1) {
        const seg = PR.outline && PR.outline.at && PR.outline.at(s.id);
        if (seg) seg.btn.style.setProperty('--read', r.toFixed(3));
      }
    });
    const pct = Math.round(100 * SEGS.reduce((a, s) => a + s.weight * readOf(s.id), 0) / total);
    const el = q('#railPct'); if (el) el.textContent = pct + ' %';
    paintMarks();
  }

  /* ── where am I, and how much of this have I read ──────────────────────── */
  // → { si, f } for the block sitting on the reading line.
  function here() {
    const line = window.innerHeight * READ_LINE;
    for (let si = SEGS.length - 1; si >= 0; si--) {
      const r = SEGS[si].body.getBoundingClientRect();
      if (r.top <= line || si === 0) return { si, f: r.height > 0 ? clamp01((line - r.top) / r.height) : 0 };
    }
    return { si: 0, f: 0 };
  }

  function measure() {
    const store = rec();
    store.read = store.read || {};
    let changed = false;
    const line = window.scrollY + window.innerHeight * (1 - READ_LINE);
    SEGS.forEach((s) => {
      // Folded away is not read. Ask the section, not the geometry: a hidden
      // body is still an element in the flow, so its height is nearly-but-not
      // quite zero and everything you scrolled past would count as read.
      if (s.sec && s.sec.dataset && s.sec.dataset.open === '0') return;
      const r = s.body.getBoundingClientRect();
      if (r.height <= 0) return;
      const top = r.top + window.scrollY;
      const f = clamp01((line - top) / r.height);
      // High-water mark: scrolling back up is re-reading, not un-reading.
      if (f > (store.read[s.id] || 0) + 0.001) { store.read[s.id] = f; changed = true; }
    });
    if (changed) { PR.page && PR.page.save(); paint(); }
    const cur = here();
    const at = tickAt(cur.si, cur.f);
    ticks.forEach((t, i) => t.classList.toggle('now', i === at));
    // The section you are in names itself — no second label beside the tick,
    // which only landed on top of this one.
    SEGS.forEach((s, i) => { if (s.label) s.label.classList.toggle('now', i === cur.si); });
  }

  /* ── bookmarks ─────────────────────────────────────────────────────────
     Anchored the way annotations are — by the block's content hash, so a mark
     survives our own re-tokenising rather than a block count that doesn't. */
  const blockAt = (b, n) => {
    const all = [...reader.querySelectorAll('.pr-block[data-pr-b="' + b + '"]')];
    return all[n] || all[0] || null;
  };
  // The block the reader is looking at. Folded blocks are excluded by the
  // hidden attribute, not by their box: a content-visibility:hidden subtree
  // keeps reporting the geometry it had when it was last on screen.
  function blockOnLine() {
    const line = window.innerHeight * READ_LINE;
    let best = null, bestD = Infinity;
    reader.querySelectorAll('.pr-block').forEach((el) => {
      if (el.closest('[hidden]')) return;
      const r = el.getBoundingClientRect();
      if (!r.height) return;
      const d = Math.abs(r.top - line);
      if (d < bestD) { bestD = d; best = el; }
    });
    return best;
  }
  function describe(el) {
    const sec = PR.outline && PR.outline.sectionOf(el);
    const s = sec ? SEGS.find((x) => x.id === sec.dataset.sec) : null;
    const r = el.getBoundingClientRect();
    const br = s ? s.body.getBoundingClientRect() : null;
    return {
      b: el.dataset.prB, n: +(el.dataset.prN || 0),
      // A block in the preamble (the title, the abstract) belongs to no
      // section — it rides at the head of the rail, not inside the first one.
      sec: s ? s.id : '',
      f: br && br.height ? clamp01((r.top - br.top) / br.height) : 0,
      // Enough text for the list's two-line preview; the rail only ever shows
      // the first few words of it.
      label: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    };
  }
  /* What the page calls itself — stored on each mark because nothing in the
     URL says it. Same rule mountCrumb uses: only a heading at the top of the
     page is its title, and only a top-level one (the accordion's own heads sit
     inside a section). Deeper down it is body prose — Pruef.htm's first
     heading is "Humor hilft", two thirds of the way in. */
  function pageTitle() {
    const kids = reader ? [...reader.children] : [];
    const at = kids.findIndex((el) => /^H[1-3]$/.test(el.tagName));
    if (at < 0 || at > 7) return '';
    return (kids[at].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  function setMark() {
    const el = blockOnLine();
    if (!el) return;
    const m = describe(el);
    /* A bookmark is read back from OTHER pages (bookmarks.js), so it carries
       its own place with it. `p` is the pathname as the server spells it —
       pageKey() lowercases, and physiologie.cc is case-sensitive. */
    const s = SEGS.find((x) => x.id === m.sec);
    m.t = Date.now();
    m.p = location.pathname;
    m.pageTitle = pageTitle();
    m.secTitle = (s && s.title) || '';
    const store = rec();
    store.marks = store.marks || [];
    if (store.marks.some((x) => x.b === m.b && x.n === m.n)) { toast('Lesezeichen besteht bereits'); return; }
    m.id = 'm' + Math.floor(performance.now()).toString(36);
    store.marks.push(m);
    PR.page && PR.page.save();
    paintMarks();
    toast('Lesezeichen gesetzt', () => dropMark(m.id, true));
  }
  function dropMark(id, silent) {
    const store = rec();
    const i = (store.marks || []).findIndex((m) => m.id === id);
    if (i < 0) return;
    const [gone] = store.marks.splice(i, 1);
    PR.page && PR.page.save();
    paintMarks();
    if (!silent) toast('Lesezeichen entfernt', () => { store.marks.splice(Math.min(i, store.marks.length), 0, gone); PR.page && PR.page.save(); paintMarks(); });
  }
  function gotoMark(m, smooth) {
    const el = blockAt(m.b, m.n);
    if (!el) { toast('Diese Stelle ist nicht mehr auffindbar'); return; }
    PR.outline && PR.outline.reveal(el);
    el.scrollIntoView({ block: 'center', behavior: smooth === false ? 'auto' : 'smooth' });
  }
  /* A bookmark on another page is a plain link — #pr-mark-<hash>-<n> is the
     block anchor spelled into the URL, so the row needs no cross-navigation
     handshake and the browser's own middle-click / new-tab / reload all work.
     outline.applyState()'s goto() has already tried and shrugged at it: no
     element carries that id. The hash stays in the URL, so a reload returns
     here too. */
  const MARK_HASH = /^pr-mark-([0-9a-z]+)-(\d+)$/;
  function consumeHash() {
    const m = MARK_HASH.exec(decodeURIComponent((location.hash || '').slice(1)));
    if (!m) return;
    const land = () => gotoMark({ b: m[1], n: +m[2] }, false);
    land();
    /* …and again once the page has stopped growing under us. At document_end
       the figures are unloaded boxes and fitNatural() has yet to swap in their
       true sizes, so a block landed on now drifts hundreds of pixels off as
       everything above it settles. Landing is idempotent and instant. */
    if (document.readyState === 'complete') { setTimeout(land, 250); return; }
    window.addEventListener('load', () => { land(); setTimeout(land, 250); }, { once: true });
  }
  // The automatic one: where the reading line stood when the page was left.
  /* Where a mark stands in the page, as one comparable number: which segment,
     and how far through it. The preamble is segment -1, so it ranks below
     everything. */
  const rankOf = (m) => {
    const si = SEGS.findIndex((s) => s.id === m.sec);
    return si + 1 + Math.min(0.999, Math.max(0, m.f || 0));
  };
  function rememberSpot() {
    const el = blockOnLine();
    if (!el) return;
    const next = describe(el);
    /* A high-water mark, like the read fractions: scrolling back to re-read a
       sentence is re-reading, not un-reading, and the whole point of the mark
       is to hold the place you got to while you do it. It only ever moves
       forward — the rail's reset is what puts it back. */
    if (rec().auto && rankOf(rec().auto) >= rankOf(next)) return;
    rec().auto = next;
    PR.page && PR.page.save();
    paintMarks();
  }

  function paintMarks() {
    const wrap = q('#railMarks');
    if (!wrap || !ticks.length) return;
    const store = rec();
    const all = (store.auto ? [Object.assign({ id: '_auto', kind: 'auto' }, store.auto)] : [])
      .concat((store.marks || []).map((m) => Object.assign({ kind: 'mark' }, m)));
    wrap.innerHTML = '';
    all.forEach((m) => {
      const si = SEGS.findIndex((s) => s.id === m.sec);
      const t = si < 0 ? ticks[0] : ticks[tickAt(si, m.f)];
      if (!t) return;
      const el = document.createElement('div');
      el.className = 'rail-mark ' + m.kind;
      el.style.top = t.style.top;
      const go = document.createElement('button');
      go.className = 'rail-mark-go'; go.type = 'button';
      go.title = (m.kind === 'auto' ? 'Zuletzt gelesen — ' : 'Lesezeichen — ') + (m.label || '');
      const cap = document.createElement('span');
      cap.className = 'rail-mark-cap';
      cap.textContent = m.kind === 'auto' ? 'Zuletzt gelesen' : (m.label || 'Lesezeichen');
      el.append(go, cap);
      go.onclick = () => gotoMark(m);
      cap.onclick = () => gotoMark(m);
      if (m.kind === 'mark') {
        const x = document.createElement('button');
        x.className = 'rail-mark-x'; x.type = 'button'; x.textContent = '✕'; x.title = 'Lesezeichen entfernen';
        x.onclick = (ev) => { ev.stopPropagation(); dropMark(m.id); };
        el.appendChild(x);
      }
      wrap.appendChild(el);
    });
  }

  const toast = (msg, undo) => PR.tools && PR.tools.showToast &&
    PR.tools.showToast(msg, undo ? { actionLabel: 'Rückgängig', onAction: undo } : {});

  /* ── reset ─────────────────────────────────────────────────────────────
     Arms on the first click and forgets it was asked after a few seconds —
     the same shape as the panel's "Gelesenes vergessen", because it is the
     same kind of irreversible. The manual bookmarks are deliberate and stay. */
  function wireReset() {
    const b = q('#railReset');
    if (!b) return;
    let armed = null;
    const idle = () => { b.classList.remove('armed'); b.textContent = b.dataset.label; };
    b.onclick = () => {
      if (!armed) {
        b.classList.add('armed'); b.textContent = 'Wirklich?';
        armed = setTimeout(() => { armed = null; idle(); }, 5000);
        return;
      }
      clearTimeout(armed); armed = null; idle();
      const store = rec();
      const prev = { read: store.read, auto: store.auto };
      store.read = {}; store.auto = null;
      PR.page && PR.page.save();
      paint();
      toast('Fortschritt zurückgesetzt', () => { store.read = prev.read; store.auto = prev.auto; PR.page && PR.page.save(); paint(); });
    };
  }

  /* ── init ──────────────────────────────────────────────────────────────── */
  function init(root) {
    reader = root || document.getElementById('pr-reader');
    if (!reader) return;
    model();
    setVisible(on());
    layout();
    measure();
    wireReset();
    consumeHash();

    const btn = q('#bookmarkBtn');
    if (btn) btn.onclick = setMark;

    // Click a tick or a label to travel there; a folded section opens first.
    const jump = (si, f) => {
      const s = SEGS[si]; if (!s) return;
      if (PR.outline && s.sec !== reader) PR.outline.reveal(s.body);
      requestAnimationFrame(() => {
        const r = s.body.getBoundingClientRect();
        window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * READ_LINE + r.height * f, behavior: 'smooth' });
      });
    };
    const rail = q('#pr-rail');
    if (rail) rail.addEventListener('click', (ev) => {
      const t = ev.target.closest('.rail-tick, .rail-label');
      if (!t) return;
      jump(+t.dataset.seg, t.dataset.f ? +t.dataset.f : 0);
    });

    // Approach, not contact: the rail comes awake while the pointer is still a
    // finger's width to its left, and the CSS linger keeps it up on the way back.
    let wakeRaf = 0, awake = false;
    document.addEventListener('pointermove', (ev) => {
      if (wakeRaf) return;
      wakeRaf = requestAnimationFrame(() => {
        wakeRaf = 0;
        const near = ev.clientX >= window.innerWidth - REACH && ev.clientY >= REACH_TOP;
        if (near === awake) return;
        awake = near;
        if (rail) rail.classList.toggle('awake', near);
      });
    }, { passive: true });
    document.addEventListener('pointerleave', () => { awake = false; if (rail) rail.classList.remove('awake'); });

    const tick = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    window.addEventListener('scroll', () => {
      tick();
      clearTimeout(autoTimer);
      autoTimer = setTimeout(rememberSpot, 700);
    }, { passive: true });
    window.addEventListener('resize', () => { layout(); measure(); });
    window.addEventListener('pagehide', rememberSpot);
    document.addEventListener('visibilitychange', () => { if (document.hidden) rememberSpot(); });
  }

  // Sections opened or closed: the weights are unchanged (they are text, not
  // pixels), so only the folded styling and the live measurement move.
  function refresh() { paint(); measure(); }

  // The rail's own switch. Bookmarks are NOT the rail's feature — you can set
  // one and read the list back with the ruler turned off, so the pill stays.
  function setVisible(v) {
    const rail = q('#pr-rail');
    if (rail) rail.classList.toggle('off', !v);
  }

  PR.progress = { init, refresh, layout, setVisible, setMark, gotoMark };
})();
