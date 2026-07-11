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

  function figCaption(img) {
    const fig = img.closest('figure.pr-fig') || img;
    if (fig.querySelector && fig.querySelector('.pr-figcap')) return fig.querySelector('.pr-figcap').textContent.trim();
    let el = fig.nextElementSibling, hops = 0;
    while (el && hops < 5) {
      if (el.classList && el.classList.contains('pr-figcap')) return el.textContent.trim();
      const inner = el.querySelector && el.querySelector('.pr-figcap');
      if (inner) return inner.textContent.trim();
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

  // ── pin rail ─────────────────────────────────────────────────────────────
  function pinFigure(fig) {
    if (PINS.find((p) => p.src === fig.src)) return; // no dupes
    PINS.push({ src: fig.src, cap: fig.cap || '', num: fig.num || '' });
    persist(); renderPins();
  }
  function renderPins() {
    const pinRail = q('#pinRail'); if (!pinRail) return;
    pinRail.classList.toggle('empty', PINS.length === 0);
    const head = PINS.length
      ? `<div class="pin-head"><span class="pin-head-title">Angeheftet · ${PINS.length}</span><button class="pin-unpin-all">Alle lösen</button></div>`
      : '';
    pinRail.innerHTML = head + PINS.map((p, i) =>
      `<div class="pin${p.collapsed ? ' collapsed' : ''}" draggable="true" data-key="${encodeURIComponent(p.src)}" style="${p.w ? `width:${p.w}px` : ''}">` +
        `<img src="${p.src}" alt="" draggable="false" onerror="this.style.minHeight='40px'">` +
        `<div class="pin-bar">` +
          `<span class="pin-grip" title="Ziehen zum Umordnen">⠿</span>` +
          `<span class="pin-cap"></span>` +
          `<button class="pin-zoom" data-i="${i}" data-dir="-1" title="Kleiner">−</button>` +
          `<button class="pin-zoom" data-i="${i}" data-dir="1" title="Größer">+</button>` +
          `<button class="pin-collapse" data-i="${i}" title="${p.collapsed ? 'Ausklappen' : 'Einklappen'}">${p.collapsed ? '▸' : '▾'}</button>` +
          `<button class="pin-x" data-i="${i}" title="Lösen">✕</button>` +
        `</div>` +
      `</div>`).join('');
    // set captions as text (avoid HTML injection from live caption text)
    qa('.pin').forEach((el, i) => { const c = el.querySelector('.pin-cap'); if (c) c.textContent = `${PINS[i].num || ''} ${PINS[i].cap || ''}`.trim(); });
    qa('.pin img').forEach((im, i) => im.onclick = () => { if (!PINS[i].collapsed) openLightbox(PINS[i].src, PINS[i].cap, PINS[i].num); });
    qa('.pin-zoom').forEach((b) => b.onclick = () => resizePin(+b.dataset.i, +b.dataset.dir, b.closest('.pin')));
    qa('.pin-collapse').forEach((b) => b.onclick = () => { const i = +b.dataset.i; PINS[i].collapsed = !PINS[i].collapsed; persist(); renderPins(); });
    qa('.pin-x').forEach((x) => x.onclick = () => {
      const i = +x.dataset.i; const [removed] = PINS.splice(i, 1); persist(); renderPins();
      showToast('Abbildung gelöst', { actionLabel: 'Rückgängig', onAction: () => { PINS.splice(Math.min(i, PINS.length), 0, removed); persist(); renderPins(); } });
    });
    const all = pinRail.querySelector('.pin-unpin-all');
    if (all) all.onclick = () => {
      const backup = PINS.slice(); PINS.length = 0; persist(); renderPins();
      showToast('Alle Abbildungen gelöst', { actionLabel: 'Rückgängig', onAction: () => { PINS.push(...backup); persist(); renderPins(); } });
    };
    qa('.pin').forEach((pin) => {
      pin.addEventListener('dragstart', (e) => { pin.classList.add('dragging'); if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', pin.dataset.key); } catch (_) {} } });
      pin.addEventListener('dragend', () => { pin.classList.remove('dragging'); commitPinOrder(); });
    });
  }
  function getDragAfterElement(y) {
    const pinRail = q('#pinRail');
    let closest = { offset: -Infinity, el: null };
    pinRail.querySelectorAll('.pin:not(.dragging)').forEach((child) => {
      const box = child.getBoundingClientRect(); const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset, el: child };
    });
    return closest.el;
  }
  function pinDragOver(e) {
    const pinRail = q('#pinRail');
    const dragging = pinRail.querySelector('.pin.dragging'); if (!dragging) return;
    e.preventDefault();
    const after = getDragAfterElement(e.clientY);
    if (after == null) pinRail.appendChild(dragging); else pinRail.insertBefore(dragging, after);
  }
  function commitPinOrder() {
    const pinRail = q('#pinRail');
    const order = [...pinRail.querySelectorAll('.pin')].map((el) => decodeURIComponent(el.dataset.key));
    PINS.sort((a, b) => order.indexOf(a.src) - order.indexOf(b.src));
    persist(); renderPins();
  }
  function resizePin(i, dir, pin) {
    const pinRail = q('#pinRail');
    if (!pin || !PINS[i] || !pinRail) return;
    const cs = getComputedStyle(pinRail);
    const railInner = Math.round(pinRail.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const cur = PINS[i].w || Math.round(pin.getBoundingClientRect().width);
    const w = Math.max(150, Math.min(railInner, cur + dir * 46)); // grows into the margin, never the text
    PINS[i].w = w; pin.style.width = w + 'px'; persist();
    pin.querySelectorAll('.pin-zoom').forEach((b) => { b.disabled = (+b.dataset.dir < 0 && w <= 150) || (+b.dataset.dir > 0 && w >= railInner); });
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
    let lastBottom = 0;
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
    }
    // popover: choose a colour / add note
    qa('#hlPop .sw').forEach((sw) => sw.onclick = () => { if (pending) commitHighlight(sw.dataset.color); hidePop(); window.getSelection().removeAllRanges(); });
    const act = q('#hlPop .act[data-act="note"]');
    if (act) act.onclick = () => { const h = pending ? commitHighlight('teal') : null; hidePop(); window.getSelection().removeAllRanges(); if (h) addOrEditNote(h.id); };
    // dismissers (shadow clicks retarget to the host at document level)
    document.addEventListener('mousedown', (e) => { const inUI = e.target === PR.ui.host; if (!inUI) { hidePop(); closeCtx(); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hidePop(); closeCtx(); closeLightbox(); } });
    // keep notes aligned to their marks as the page scrolls / resizes
    const relayout = () => { cancelAnimationFrame(notesRaf); notesRaf = requestAnimationFrame(layoutNotes); };
    window.addEventListener('scroll', relayout, { passive: true });
    window.addEventListener('resize', relayout);
    const pinRail = q('#pinRail');
    if (pinRail) pinRail.addEventListener('dragover', pinDragOver);
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
