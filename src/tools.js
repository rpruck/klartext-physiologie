/* ══════════════════════════════════════════════════════════════════════
   tools.js — study interactions (ported from prototype §5/§6).

   All UI lives in the shadow root (queried via PR.ui.shadow); the reader and
   its highlight marks live in the light DOM. Positioning that used the
   prototype's CSS grid now uses viewport coordinates. Persistence is per-page
   chrome.storage (PR.store), keyed by pathname, holding { highlights, pins }.

   M6: lightbox (zoom/pan) · pin rail (resize/reorder/collapse) · toaster.
   M7/M8 extend PAGE.highlights + notes.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const PR = (window.__physioReskin ||= {});
  const q = (s) => (PR.ui && PR.ui.shadow) ? PR.ui.shadow.querySelector(s) : null;
  const qa = (s) => (PR.ui && PR.ui.shadow) ? [...PR.ui.shadow.querySelectorAll(s)] : [];

  // ── shared per-page state ────────────────────────────────────────────────
  let PAGE = { highlights: [], pins: [] };
  let PINS = PAGE.pins;
  let saveTimer = null;
  function persist() {
    if (!PR.store) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      PR.store.set(PR.store.pageKey(), { highlights: PAGE.highlights, pins: PAGE.pins });
    }, 120); // debounce rapid edits (drag-resize, reorder)
  }

  // ── toaster (sonner-style undo) ──────────────────────────────────────────
  function showToast(msg, opts = {}) {
    const toaster = q('#toaster');
    if (!toaster) return null;
    const t = document.createElement('div');
    t.className = 'sonner';
    t.innerHTML = `<span class="sonner-msg"></span>` + (opts.actionLabel ? `<button class="sonner-action"></button>` : '');
    t.querySelector('.sonner-msg').textContent = msg;
    if (opts.actionLabel) t.querySelector('.sonner-action').textContent = opts.actionLabel;
    toaster.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    let timer = null;
    const dismiss = () => { if (t._done) return; t._done = true; clearTimeout(timer); t.classList.remove('show'); t.classList.add('hide'); setTimeout(() => t.remove(), 320); };
    const arm = (ms) => { clearTimeout(timer); timer = setTimeout(dismiss, ms); };
    t.addEventListener('mouseenter', () => clearTimeout(timer));
    t.addEventListener('mouseleave', () => arm(2500));
    if (opts.actionLabel) t.querySelector('.sonner-action').onclick = () => { try { opts.onAction && opts.onAction(); } finally { dismiss(); } };
    arm(opts.duration || 5000);
    return t;
  }

  // ── lightbox (preview + zoom + pan) ──────────────────────────────────────
  let lbCurrent = null, lbScale = 1, lbX = 0, lbY = 0;

  // A caption is a title over its source line; the lightbox has room for the
  // name of the figure, not the citation behind it.
  const capText = (el) => (el.querySelector('.pr-figcap-title') || el).textContent.trim();

  function figCaption(img) {
    const fig = img.closest('figure.pr-fig') || img;
    if (fig.querySelector && fig.querySelector('.pr-figcap')) return capText(fig.querySelector('.pr-figcap'));
    let el = fig.nextElementSibling, hops = 0;
    while (el && hops < 5) {
      if (el.classList && el.classList.contains('pr-figcap')) return capText(el);
      const inner = el.querySelector && el.querySelector('.pr-figcap');
      if (inner) return capText(inner);
      el = el.nextElementSibling; hops++;
    }
    return '';
  }

  function openLightbox(src, cap, num) {
    const lightbox = q('#lightbox'), lbImg = q('#lbImg'), lbCap = q('#lbCap');
    if (!lightbox) return;
    lbCurrent = { src, cap, num };
    lbImg.src = src;
    lbCap.textContent = '';
    if (num) { const s = document.createElement('span'); s.className = 'fignum'; s.textContent = num; lbCap.appendChild(s); }
    lbCap.appendChild(document.createTextNode(cap || ''));
    lightbox.classList.add('show');
    lbScale = 1; lbX = 0; lbY = 0; lbApply(false);
  }
  function closeLightbox() { const lb = q('#lightbox'); if (lb) lb.classList.remove('show'); }

  function lbApply(anim) {
    const lbImg = q('#lbImg'); if (!lbImg) return;
    lbImg.style.transition = anim ? 'transform .18s var(--ease)' : 'none';
    lbImg.style.transform = `translate(${lbX}px,${lbY}px) scale(${lbScale})`;
    lbImg.classList.toggle('zoomed', lbScale > 1);
    const pct = q('#lbZoomPct'); if (pct) pct.textContent = Math.round(lbScale * 100) + ' %';
  }
  function lbClampPan() {
    const lbImg = q('#lbImg'); if (!lbImg) return;
    const maxX = (lbScale - 1) * lbImg.clientWidth / 2 + 30, maxY = (lbScale - 1) * lbImg.clientHeight / 2 + 30;
    lbX = Math.max(-maxX, Math.min(maxX, lbX)); lbY = Math.max(-maxY, Math.min(maxY, lbY));
  }
  function lbZoomAt(factor, clientX, clientY, anim) {
    const lbImg = q('#lbImg'); if (!lbImg) return;
    const prev = lbScale;
    lbScale = Math.max(1, Math.min(6, lbScale * factor));
    if (clientX != null && lbScale !== prev) {
      const r = lbImg.getBoundingClientRect();
      const cx = clientX - (r.left + r.width / 2), cy = clientY - (r.top + r.height / 2), ratio = lbScale / prev;
      lbX += cx * (1 - ratio); lbY += cy * (1 - ratio);
    }
    if (lbScale === 1) { lbX = 0; lbY = 0; }
    lbClampPan(); lbApply(!!anim);
  }
  function lbReset() { lbScale = 1; lbX = 0; lbY = 0; lbApply(true); }

  function wireLightbox() {
    const lightbox = q('#lightbox'), lbImg = q('#lbImg');
    if (!lightbox) return;
    q('#lbClose').onclick = closeLightbox;
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
    q('#lbPin').onclick = () => { if (lbCurrent) { pinFigure(lbCurrent); closeLightbox(); } };
    lightbox.addEventListener('wheel', (e) => { if (!lightbox.classList.contains('show')) return; e.preventDefault(); lbZoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY, false); }, { passive: false });
    q('#lbZoomIn').onclick = () => lbZoomAt(1.3, null, null, true);
    q('#lbZoomOut').onclick = () => lbZoomAt(1 / 1.3, null, null, true);
    q('#lbZoomPct').onclick = lbReset;
    lbImg.addEventListener('dblclick', (e) => { if (lbScale > 1) lbReset(); else lbZoomAt(2.2, e.clientX, e.clientY, true); });
    let lbPan = false, pSX = 0, pSY = 0, pX0 = 0, pY0 = 0;
    lbImg.addEventListener('pointerdown', (e) => { if (lbScale <= 1) return; e.preventDefault(); lbPan = true; pSX = e.clientX; pSY = e.clientY; pX0 = lbX; pY0 = lbY; lbImg.classList.add('grabbing'); try { lbImg.setPointerCapture(e.pointerId); } catch (_) {} });
    lbImg.addEventListener('pointermove', (e) => { if (!lbPan) return; lbX = pX0 + (e.clientX - pSX); lbY = pY0 + (e.clientY - pSY); lbClampPan(); lbApply(false); });
    const end = (e) => { if (!lbPan) return; lbPan = false; lbImg.classList.remove('grabbing'); try { lbImg.releasePointerCapture(e.pointerId); } catch (_) {} };
    lbImg.addEventListener('pointerup', end);
    lbImg.addEventListener('pointercancel', end);
  }

  // ── pinned figures (free-floating, draggable, freely resizable) ───────────
  // A pin is a fixed HUD card the reader parks anywhere and sizes freely — from
  // a thumbnail in the margin up to the full text width (and beyond) to read
  // fine labels while scrolling the prose. Position + width persist per page.
  const PIN_MIN = 150;
  const pinMax = () => Math.min(1200, Math.round(window.innerWidth * 0.96));

  // New pins land in the left margin, right-aligned to the text column, and are
  // as wide as the margin comfortably allows (never the old cramped 260px cap).
  function defaultPin() {
    const measure = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--measure')) || 680;
    const margin = Math.max(0, (window.innerWidth - measure) / 2);
    const w = Math.round(Math.max(240, Math.min(400, margin - 24)));
    const left = margin > w + 28 ? Math.round(margin - w - 20) : 16;
    const top = 84 + (PINS.length * 26) % 260;
    return { x: left, y: top, w: Math.max(PIN_MIN, w) };
  }

  const pinEl = (src) => qa('.pin').find((el) => decodeURIComponent(el.dataset.key) === src);

  // Keep a pin's stored geometry inside the viewport (e.g. after a resize or a
  // reload at a different window size) so it never comes back off-screen.
  function clampGeom(p) {
    const w = Math.max(PIN_MIN, Math.min(pinMax(), p.w || 300));
    const x = Math.max(4, Math.min(window.innerWidth - w - 4, p.x == null ? 16 : p.x));
    const y = Math.max(4, Math.min(window.innerHeight - 48, p.y == null ? 84 : p.y));
    return { w, x, y };
  }

  function pinFigure(fig) {
    const existing = pinEl(fig.src);
    if (PINS.find((p) => p.src === fig.src)) { // already pinned → flash it, don't dupe
      if (existing) { existing.classList.remove('flash'); void existing.offsetWidth; existing.classList.add('flash'); }
      return;
    }
    PINS.push(Object.assign({ src: fig.src, cap: fig.cap || '', num: fig.num || '' }, defaultPin()));
    persist(); renderPins();
  }

  function renderPins() {
    const rail = q('#pinRail'); if (!rail) return;
    rail.classList.toggle('empty', PINS.length === 0);
    rail.innerHTML = PINS.map((p, i) => {
      const g = clampGeom(p); p.x = g.x; p.y = g.y; p.w = g.w; // normalise stored geom
      return `<figure class="pin${p.collapsed ? ' collapsed' : ''}" data-key="${encodeURIComponent(p.src)}" style="left:${g.x}px;top:${g.y}px;width:${g.w}px">` +
        `<div class="pin-bar">` +
          `<span class="pin-grip" title="Ziehen zum Verschieben">⠿</span>` +
          `<span class="pin-cap"></span>` +
          `<button class="pin-btn pin-zoom" data-i="${i}" data-dir="-1" title="Kleiner">−</button>` +
          `<button class="pin-btn pin-zoom" data-i="${i}" data-dir="1" title="Größer">+</button>` +
          `<button class="pin-btn pin-collapse" data-i="${i}" title="${p.collapsed ? 'Ausklappen' : 'Einklappen'}">${p.collapsed ? '▸' : '▾'}</button>` +
          `<button class="pin-btn pin-x" data-i="${i}" title="Lösen">✕</button>` +
        `</div>` +
        `<div class="pin-body"><img src="${p.src}" alt="" draggable="false" onerror="this.classList.add('pin-broken')"></div>` +
        `<span class="pin-resize" title="Größe ändern"></span>` +
      `</figure>`;
    }).join('');
    // captions set as text (avoid HTML injection from live caption text)
    qa('.pin').forEach((el, i) => { const c = el.querySelector('.pin-cap'); if (c) c.textContent = `${PINS[i].num || ''} ${PINS[i].cap || ''}`.trim(); });
    qa('.pin-body img').forEach((im, i) => im.onclick = () => { if (!PINS[i].collapsed) openLightbox(PINS[i].src, PINS[i].cap, PINS[i].num); });
    qa('.pin-zoom').forEach((b) => b.onclick = () => stepPin(+b.dataset.i, +b.dataset.dir));
    qa('.pin-collapse').forEach((b) => b.onclick = () => { const i = +b.dataset.i; PINS[i].collapsed = !PINS[i].collapsed; persist(); renderPins(); });
    qa('.pin-x').forEach((x) => x.onclick = () => {
      const i = +x.dataset.i; const [removed] = PINS.splice(i, 1); persist(); renderPins();
      showToast('Abbildung gelöst', { actionLabel: 'Rückgängig', onAction: () => { PINS.splice(Math.min(i, PINS.length), 0, removed); persist(); renderPins(); } });
    });
    qa('.pin').forEach((el, i) => wirePin(el, i));
  }

  // +/- buttons: quick width steps (free drag-resize lives on the corner handle).
  function stepPin(i, dir) {
    const p = PINS[i]; if (!p) return;
    p.w = Math.max(PIN_MIN, Math.min(pinMax(), clampGeom(p).w + dir * 60));
    const el = pinEl(p.src); if (el) el.style.width = p.w + 'px';
    persist();
  }

  function wirePin(el, i) {
    const p = PINS[i]; if (!p) return;
    const raise = () => { qa('.pin').forEach((o) => o.style.zIndex = '40'); el.style.zIndex = '41'; };
    el.addEventListener('pointerdown', raise, true);

    // drag to move — grab anywhere on the bar except its buttons
    const bar = el.querySelector('.pin-bar');
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.pin-btn')) return;
      e.preventDefault(); raise();
      const g = clampGeom(p); const x0 = e.clientX, y0 = e.clientY, px = g.x, py = g.y;
      el.classList.add('grabbing');
      try { bar.setPointerCapture(e.pointerId); } catch (_) {}
      const move = (ev) => {
        p.x = Math.max(4, Math.min(window.innerWidth - 40, px + (ev.clientX - x0)));
        p.y = Math.max(4, Math.min(window.innerHeight - 40, py + (ev.clientY - y0)));
        el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
      };
      const up = (ev) => { bar.removeEventListener('pointermove', move); el.classList.remove('grabbing'); try { bar.releasePointerCapture(ev.pointerId); } catch (_) {} persist(); };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up, { once: true });
      bar.addEventListener('pointercancel', up, { once: true });
    });

    // drag the corner handle to resize width freely; height follows the image
    const handle = el.querySelector('.pin-resize');
    if (handle) handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); raise();
      const x0 = e.clientX, w0 = clampGeom(p).w;
      el.classList.add('resizing');
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      const move = (ev) => { p.w = Math.max(PIN_MIN, Math.min(pinMax(), w0 + (ev.clientX - x0))); el.style.width = p.w + 'px'; };
      const up = (ev) => { handle.removeEventListener('pointermove', move); el.classList.remove('resizing'); try { handle.releasePointerCapture(ev.pointerId); } catch (_) {} persist(); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up, { once: true });
      handle.addEventListener('pointercancel', up, { once: true });
    });
  }

  // Re-clamp pins into view on window resize (no rebuild → keeps handlers).
  function reflowPins() {
    qa('.pin').forEach((el, i) => {
      const p = PINS[i]; if (!p) return;
      const g = clampGeom(p); p.x = g.x; p.y = g.y; p.w = g.w;
      el.style.left = g.x + 'px'; el.style.top = g.y + 'px'; el.style.width = g.w + 'px';
    });
  }

  // ── highlights (light-DOM marks, per-page storage, robust anchoring) ──────
  const HLS = () => PAGE.highlights;
  const A = () => PR.anchor;
  let _seq = 0;
  const uid = () => 'h' + Math.floor(performance.now()).toString(36) + '-' + (_seq++);
  const hlMarks = (id) => [...document.querySelectorAll('#pr-reader mark.hl[data-hid="' + id + '"]')];
  let pending = null; // { anchor, block } — a fresh selection awaiting a colour

  function commonBlock(range) {
    const sc = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
    const ec = range.endContainer.nodeType === 3 ? range.endContainer.parentElement : range.endContainer;
    const sb = sc && sc.closest('.pr-block');
    const eb = ec && ec.closest('.pr-block');
    return (sb && sb === eb) ? sb : null; // must sit fully inside one block
  }
  function handleSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hidePop();
    const range = sel.getRangeAt(0);
    const block = commonBlock(range);
    if (!block || !range.toString().trim()) return hidePop();
    pending = { anchor: A().buildAnchor(range, block), block };
    showPopAt(range.getBoundingClientRect());
  }
  function showPopAt(rect) {
    const pop = q('#hlPop'); if (!pop) return;
    pop.style.left = (rect.left + rect.width / 2) + 'px';
    pop.style.top = rect.top + 'px';
    pop.classList.add('show');
  }
  function hidePop() { const pop = q('#hlPop'); if (pop) pop.classList.remove('show'); }

  function commitHighlight(color) {
    if (!pending) return null;
    const h = Object.assign({ id: uid(), color, note: null }, pending.anchor);
    HLS().push(h); persist();
    A().wrapRange(pending.block, h.start, h.end, color, h.id, false);
    pending = null; return h;
  }
  function recolor(id, color) {
    const h = HLS().find((x) => x.id === id); if (h) { h.color = color; persist(); }
    hlMarks(id).forEach((m) => m.dataset.color = color);
  }
  function unwrap(id) {
    hlMarks(id).forEach((m) => { const p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); p.normalize(); });
  }
  function removeHighlight(id) {
    const removed = HLS().find((x) => x.id === id);
    unwrap(id);
    PAGE.highlights = HLS().filter((x) => x.id !== id); persist(); layoutNotes();
    if (removed) showToast(removed.note && removed.note.trim() ? 'Markierung & Notiz entfernt' : 'Markierung entfernt',
      { actionLabel: 'Rückgängig', onAction: () => restoreHighlight(removed) });
  }
  function restoreHighlight(h) {
    if (HLS().find((x) => x.id === h.id)) return;
    HLS().push(h); persist();
    const r = A().resolveAnchor(h);
    if (r) A().wrapRange(r.block, r.start, r.end, h.color, h.id, !!(h.note && h.note.trim().length));
    layoutNotes();
  }
  function restoreHighlights() {
    HLS().forEach((h) => {
      const r = A().resolveAnchor(h);
      if (r) A().wrapRange(r.block, r.start, r.end, h.color, h.id, !!(h.note && h.note.length));
    });
    layoutNotes();
  }
  function markHasNote(id, on) { hlMarks(id).forEach((m) => m.classList.toggle('has-note', on)); }

  // ── context menu on an existing highlight ─────────────────────────────────
  let ctx = null, ctxHid = null;
  function ensureCtx() {
    if (ctx) return ctx;
    ctx = document.createElement('div'); ctx.className = 'ctx-menu';
    PR.ui.shadow.appendChild(ctx);
    ctx.addEventListener('click', (e) => {
      const sw = e.target.closest('.ctx-sw');
      if (sw) { recolor(ctxHid, sw.dataset.color); closeCtx(); return; }
      const item = e.target.closest('.ctx-item'); if (!item) return;
      if (item.dataset.act === 'remove') removeHighlight(ctxHid);
      else if (item.dataset.act === 'note') addOrEditNote(ctxHid);
      closeCtx();
    });
    return ctx;
  }
  function openCtx(x, y, hid) {
    ensureCtx(); ctxHid = hid;
    const h = HLS().find((z) => z.id === hid); const cur = h ? h.color : 'teal'; const hasNote = h && h.note != null;
    ctx.innerHTML =
      `<div class="ctx-label">Markierung</div>` +
      `<div class="ctx-colors">` +
      ['teal', 'amber', 'rose', 'underline'].map((c) => `<span class="ctx-sw${c === cur ? ' sel' : ''}" data-color="${c}"></span>`).join('') +
      `</div><div class="ctx-sep"></div>` +
      `<button class="ctx-item" data-act="note">✎ ${hasNote ? 'Notiz bearbeiten' : 'Notiz hinzufügen'}</button>` +
      `<div class="ctx-sep"></div>` +
      `<button class="ctx-item danger" data-act="remove">✕ Markierung entfernen</button>`;
    ctx.style.left = x + 'px'; ctx.style.top = y + 'px'; ctx.classList.add('show');
    requestAnimationFrame(() => {
      const r = ctx.getBoundingClientRect();
      if (r.right > innerWidth - 8) ctx.style.left = (innerWidth - r.width - 8) + 'px';
      if (r.bottom > innerHeight - 8) ctx.style.top = (innerHeight - r.height - 8) + 'px';
    });
  }
  function closeCtx() { if (ctx) ctx.classList.remove('show'); ctxHid = null; }

  // ── promise-based confirm dialog (in the shadow root) ─────────────────────
  function confirmDialog(title, msg, okLabel = 'Löschen') {
    return new Promise((res) => {
      PR.ui.shadow.querySelectorAll('.confirm-back').forEach((el) => el.remove());
      const back = document.createElement('div'); back.className = 'confirm-back';
      const box = document.createElement('div'); box.className = 'confirm'; box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true');
      const h3 = document.createElement('h3'); h3.textContent = title;
      const p = document.createElement('p'); p.textContent = msg;
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<button class="cancel">Abbrechen</button><button class="danger ok"></button>`;
      row.querySelector('.ok').textContent = okLabel;
      box.append(h3, p, row); back.appendChild(box); PR.ui.shadow.appendChild(back);
      requestAnimationFrame(() => back.classList.add('show'));
      const done = (v) => { back.classList.remove('show'); document.removeEventListener('keydown', onKey); setTimeout(() => back.remove(), 220); res(v); };
      const onKey = (ev) => { if (ev.key === 'Escape') done(false); if (ev.key === 'Enter') done(true); };
      row.querySelector('.cancel').onclick = () => done(false);
      row.querySelector('.ok').onclick = () => done(true);
      back.addEventListener('mousedown', (ev) => { if (ev.target === back) done(false); });
      document.addEventListener('keydown', onKey);
      setTimeout(() => row.querySelector('.ok').focus(), 30);
    });
  }

  // ── margin notes (M8) ─────────────────────────────────────────────────────
  function addOrEditNote(id) {
    const h = HLS().find((x) => x.id === id); if (!h) return;
    if (h.note == null) h.note = '';
    persist(); layoutNotes(); focusNote(id);
  }
  let notesRaf = 0;
  function layoutNotes() {
    const gutter = q('#noteGutter'); if (!gutter) return;
    const withNotes = HLS().filter((h) => h.note != null); // null = none, '' = empty-but-open
    gutter.querySelectorAll('.note').forEach((n) => { if (!withNotes.find((h) => h.id === n.dataset.id)) n.remove(); });
    const gutterTop = gutter.getBoundingClientRect().top; // fixed → viewport coords
    // -Infinity, not 0: clamping to the gutter top made every note whose mark
    // had scrolled off pile up there, and on a page with many notes that stack
    // buried the ones belonging to marks actually on screen. Notes now travel
    // with their marks and are clipped by the gutter's overflow.
    let lastBottom = -Infinity;
    withNotes
      .map((h) => ({ h, mark: document.querySelector('#pr-reader mark.hl[data-hid="' + h.id + '"]') }))
      .filter((o) => o.mark)
      .sort((a, b) => a.mark.getBoundingClientRect().top - b.mark.getBoundingClientRect().top)
      .forEach(({ h, mark }) => {
        let note = gutter.querySelector('.note[data-id="' + h.id + '"]');
        if (!note) { note = makeNote(h); gutter.appendChild(note); }
        const top = mark.getBoundingClientRect().top - gutterTop - 6;
        const y = Math.max(top, lastBottom);
        note.style.top = y + 'px';
        lastBottom = y + note.offsetHeight + 12;
      });
    gutter.classList.toggle('has-notes', withNotes.length > 0);
  }
  function makeNote(h) {
    const note = document.createElement('div'); note.className = 'note'; note.dataset.id = h.id;
    const ta = document.createElement('textarea'); ta.placeholder = 'Randnotiz…'; ta.value = (h.note || '').trim();
    const meta = document.createElement('div'); meta.className = 'note-meta';
    meta.innerHTML = `<span class="note-tag">Notiz</span><button class="note-del" title="Notiz löschen">✕</button>`;
    note.append(ta, meta);
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    const lightUp = (on) => hlMarks(h.id).forEach((m) => m.classList.toggle('note-hover', on));
    ta.addEventListener('input', () => { h.note = ta.value; persist(); grow(); layoutNotes(); markHasNote(h.id, !!ta.value.trim()); });
    ta.addEventListener('focus', () => lightUp(true));
    ta.addEventListener('blur', () => { lightUp(false); if (!ta.value.trim()) { h.note = null; persist(); markHasNote(h.id, false); note.remove(); layoutNotes(); } });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); } });
    note.addEventListener('mouseenter', () => { note.classList.add('hovered'); lightUp(true); });
    note.addEventListener('mouseleave', () => { note.classList.remove('hovered'); if (PR.ui.shadow.activeElement !== ta) lightUp(false); });
    meta.querySelector('.note-del').addEventListener('click', async () => {
      if (ta.value.trim()) { // per user's choice: confirm AND undo
        const ok = await confirmDialog('Notiz löschen?', 'Diese Randnotiz wird dauerhaft entfernt. Die Markierung bleibt bestehen.');
        if (!ok) return;
      }
      const prev = h.note;
      h.note = null; persist(); markHasNote(h.id, false); lightUp(false); note.remove(); layoutNotes();
      if (prev && prev.trim()) showToast('Notiz gelöscht', { actionLabel: 'Rückgängig', onAction: () => { h.note = prev; persist(); markHasNote(h.id, !!prev.trim()); layoutNotes(); } });
    });
    requestAnimationFrame(grow);
    return note;
  }
  function focusNote(id) { const n = q('.note[data-id="' + id + '"] textarea'); if (n) n.focus(); }

  /* ── glossary hover card ─────────────────────────────────────────────────
     reskin.js marks every word the author badged as "defined in this page's
     Begriffe list" with a.pr-term[data-def]. One card is mounted and moved
     around rather than one per term — there can be 20+ on a page. It lives in
     the light DOM (inside the reader) so it inherits the theme tokens, and is
     position:fixed so a table's overflow can't clip it. */
  let tip = null, tipTimer = null, tipFor = null;
  const TIP_GAP = 10;
  function hideTip() { clearTimeout(tipTimer); tipFor = null; if (tip) tip.classList.remove('show'); }
  function showTip(a) {
    const reader = document.getElementById('pr-reader');
    if (!reader) return;
    if (!tip) { tip = document.createElement('div'); tip.className = 'pr-tip'; reader.appendChild(tip); }
    tipFor = a;
    tip.innerHTML = '';
    // data-term, not the link text: the source sometimes splits a word across
    // spans ("B|iomembranen"), which marks the term as two adjacent links.
    const term = document.createElement('b'); term.textContent = a.dataset.term || a.textContent.trim();
    tip.append(term, document.createTextNode(a.dataset.def));
    // measure first, then place: above the word if there is room, else below,
    // and always clamped into the viewport.
    tip.style.left = '0px'; tip.style.top = '0px';
    const r = a.getBoundingClientRect(), t = tip.getBoundingClientRect();
    const above = r.top > t.height + TIP_GAP;
    tip.style.top = (above ? r.top - t.height - TIP_GAP : r.bottom + TIP_GAP) + 'px';
    tip.style.left = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left)) + 'px';
    tip.classList.add('show');
  }
  function wireTips(reader) {
    const enter = (e) => {
      const a = e.target.closest && e.target.closest('a.pr-term[data-def]');
      if (!a || a === tipFor) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => showTip(a), 120);
    };
    const leave = (e) => {
      const a = e.target.closest && e.target.closest('a.pr-term[data-def]');
      if (a && a === tipFor) hideTip();
      else if (a) clearTimeout(tipTimer);
    };
    reader.addEventListener('mouseover', enter);
    reader.addEventListener('mouseout', leave);
    reader.addEventListener('focusin', enter);
    reader.addEventListener('focusout', leave);
    window.addEventListener('scroll', hideTip, { passive: true });
  }

  // ── init / restore ───────────────────────────────────────────────────────
  function init() {
    wireLightbox();
    const reader = document.getElementById('pr-reader');
    if (reader) {
      reader.addEventListener('click', (e) => {
        const img = e.target.closest('figure.pr-fig img, img.pr-figimg');
        if (!img) return;
        e.preventDefault();
        openLightbox(img.currentSrc || img.src, figCaption(img), '');
      });
      reader.addEventListener('mouseup', () => setTimeout(handleSelection, 0));
      reader.addEventListener('contextmenu', (e) => {
        const m = e.target.closest('mark.hl'); if (!m) return;
        e.preventDefault(); openCtx(e.clientX, e.clientY, m.dataset.hid);
      });
      reader.addEventListener('dblclick', (e) => { const m = e.target.closest('mark.hl.has-note'); if (m) focusNote(m.dataset.hid); });
      wireTips(reader);
    }
    // popover: choose a colour / add note
    qa('#hlPop .sw').forEach((sw) => sw.onclick = () => { if (pending) commitHighlight(sw.dataset.color); hidePop(); window.getSelection().removeAllRanges(); });
    const act = q('#hlPop .act[data-act="note"]');
    if (act) act.onclick = () => { const h = pending ? commitHighlight('teal') : null; hidePop(); window.getSelection().removeAllRanges(); if (h) addOrEditNote(h.id); };
    // dismissers (shadow clicks retarget to the host at document level)
    document.addEventListener('mousedown', (e) => { const inUI = e.target === PR.ui.host; if (!inUI) { hidePop(); closeCtx(); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hidePop(); closeCtx(); closeLightbox(); hideTip(); } });
    // keep notes aligned to their marks as the page scrolls / resizes;
    // re-clamp floating pins into view when the window resizes
    const relayout = () => { cancelAnimationFrame(notesRaf); notesRaf = requestAnimationFrame(layoutNotes); };
    window.addEventListener('scroll', relayout, { passive: true });
    window.addEventListener('resize', () => { relayout(); reflowPins(); });
  }

  function restore(page) {
    PAGE.highlights = (page && page.highlights) || [];
    PAGE.pins = (page && page.pins) || [];
    PINS = PAGE.pins;
    renderPins();
    restoreHighlights();
  }

  PR.tools = {
    init, restore, restoreHighlights, showToast, openLightbox, closeLightbox,
    pinFigure, renderPins, persist, layoutNotes,
    get page() { return PAGE; },
  };
})();
