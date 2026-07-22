/* ══════════════════════════════════════════════════════════════════════
   bookmarks.js — every mark in the book, in one drawer.

   The rail (progress.js) can only ever answer "where are the marks on THIS
   page" — it is a ruler of the page it stands in. But the reskin turns 200-odd
   files into one continuous read, so the question worth asking is "where did I
   mark something in the book", and nothing could answer it.

   Every page record already lives under page:<path> in the same storage area,
   so the list is one read of the lot (store.all()) and a sort. It never opens
   or fetches a page: the naming a row needs — the page's title, the section's
   title, the text it points at, when it was set — is captured by setMark() at
   the moment the mark is made and stored on the mark. The chapter and section
   NUMBER are the exception: reskin's pageRef() derives those from the path,
   which is the record's own key, so storing them would only let them rot.

   A row is a real <a href="/VIII.2.htm#pr-mark-<hash>-<n>">, so middle-click,
   open-in-new-tab and reload all work by themselves; progress.consumeHash()
   is what lands on the block at the other end.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const PR = (window.__physioReskin ||= {});

  const q = (s) => (PR.ui && PR.ui.shadow) ? PR.ui.shadow.querySelector(s) : null;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* ── the marks ─────────────────────────────────────────────────────────
     One entry per mark: the mark itself, the record it came out of, and the
     path to link at. `here` is the open page, whose record is read live —
     a mark set seconds ago is still sitting in the debounced save. */
  async function collect() {
    if (!PR.store) return [];
    const here = PR.store.pageKey();
    const all = await PR.store.all();
    if (PR.page) all[here] = PR.page.rec;
    const out = [];
    Object.keys(all).forEach((key) => {
      if (key.indexOf('page:') !== 0) return;
      const marks = (all[key] && all[key].marks) || [];
      marks.forEach((m, i) => out.push({ m, i, key, path: m.p || key.slice(5), here: key === here }));
    });
    /* Newest first. A mark from before this feature carries no date and has to
       go somewhere: the bottom, where it claims no recency it can't state —
       and among those, latest-added first, which is the only ordering their
       position in the record does tell us. */
    out.sort((a, b) => (b.m.t || 0) - (a.m.t || 0) || b.i - a.i);
    return out;
  }

  /* ── naming a row ──────────────────────────────────────────────────────── */
  // "Kapitel VIII · Abschnitt 2", or null for a page outside the book's
  // numbering (Pruef.htm, Einheiten.html, the home page).
  const where = (ref) =>
    ref ? 'Kapitel ' + ref.rom + (ref.num == null ? '' : ' · Abschnitt ' + PR.reskin.ordinal(ref)) : null;

  /* When it was set, stated rather than approximated: "vor 3 Stunden" reads
     nicely and answers nothing when two marks are minutes apart. The day is
     named while it is still worth naming, the clock time always. */
  const HHMM = { hour: '2-digit', minute: '2-digit' };
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  function when(t) {
    if (!t) return '';
    const d = new Date(t), now = new Date();
    const days = Math.round((midnight(now) - midnight(d)) / 864e5);
    const clock = d.toLocaleTimeString('de-DE', HHMM);
    if (days === 0) return 'Heute, ' + clock;
    if (days === 1) return 'Gestern, ' + clock;
    const date = d.toLocaleDateString('de-DE', d.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' });
    return date + ', ' + clock;
  }

  /* ── reading and writing another page's record ─────────────────────────
     The open page's record has a live object and a rail to repaint; every
     other page is a plain read-modify-write of its storage key. */
  async function readRec(entry) {
    if (entry.here && PR.page) return PR.page.rec;
    return (await PR.store.get(entry.key)) || null;
  }
  async function writeRec(entry, rec) {
    if (entry.here && PR.page) {
      PR.page.save();
      PR.progress && PR.progress.refresh && PR.progress.refresh();
      return;
    }
    await PR.store.set(entry.key, rec);
  }

  const toast = (msg, undo) => PR.tools && PR.tools.showToast &&
    PR.tools.showToast(msg, undo ? { actionLabel: 'Rückgängig', onAction: undo } : {});

  async function drop(entry) {
    const rec = await readRec(entry);
    const i = ((rec && rec.marks) || []).findIndex((x) => x.id === entry.m.id);
    if (i < 0) return;
    const [gone] = rec.marks.splice(i, 1);
    await writeRec(entry, rec);
    render();
    toast('Lesezeichen entfernt', async () => {
      const back = await readRec(entry);
      if (!back) return;
      back.marks = back.marks || [];
      back.marks.splice(Math.min(i, back.marks.length), 0, gone);
      await writeRec(entry, back);
      render();
    });
  }

  /* ── the drawer ────────────────────────────────────────────────────────── */
  function row(entry) {
    const m = entry.m;
    const item = el('div', 'bm-item' + (entry.here ? ' here' : ''));
    const a = el('a', 'bm-row');
    /* The book's own spelling of the page wins over the recorded path: the
       record key is lowercased (page:/i.0.htm) and the server is
       case-sensitive, so a mark set before the path was stored — or restored
       from that key — would otherwise link at a page that 404s. */
    const ref = PR.reskin && PR.reskin.pageRef && PR.reskin.pageRef(entry.path);
    a.href = (ref ? '/' + ref.file : entry.path) + '#pr-mark-' + m.b + '-' + m.n;

    const w = where(ref);
    if (w) {
      const line = el('span', 'bm-where', w);
      line.title = ref.title;                   // the chapter's full title
      a.appendChild(line);
    }
    // The page and the section inside it — the two names the crumb and the
    // accordion give the same place while you are standing on it.
    const names = [m.pageTitle, m.secTitle].filter((s) => s && s.trim());
    if (names.length) {
      const t = el('span', 'bm-title');
      names.forEach((n, i) => {
        if (i) t.appendChild(el('span', 'bm-dot', '·'));
        t.appendChild(el('span', null, n));
      });
      a.appendChild(t);
      if (m.label) a.appendChild(el('span', 'bm-prev', m.label));
    } else if (m.label) {
      // Nothing names this row but the passage itself — a mark set before the
      // list existed, or a page that never states a title (Pruef.htm opens
      // with prose). Let the passage be the name rather than leaving the row
      // headed by nothing.
      a.appendChild(el('span', 'bm-title', m.label));
    }

    const stamp = when(m.t);
    const time = el('time', 'bm-time', entry.here ? [stamp, 'diese Seite'].filter(Boolean).join(' · ') : stamp);
    if (m.t) time.dateTime = new Date(m.t).toISOString();
    a.appendChild(time);

    // A mark on the page you are standing on doesn't need a page load to reach.
    a.addEventListener('click', (ev) => {
      if (!entry.here || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
      ev.preventDefault();
      PR.ui && PR.ui.closeDrawer && PR.ui.closeDrawer();
      PR.progress && PR.progress.gotoMark && PR.progress.gotoMark(m);
    });

    const x = el('button', 'bm-x', '✕');
    x.type = 'button';
    x.title = 'Lesezeichen entfernen';
    x.setAttribute('aria-label', 'Lesezeichen entfernen');
    x.onclick = () => drop(entry);

    item.append(a, x);
    return item;
  }

  async function render() {
    const body = q('#marksBody'), count = q('#marksCount');
    if (!body) return;
    const list = await collect();
    if (count) count.textContent = list.length ? String(list.length) : '';
    body.innerHTML = '';
    if (!list.length) {
      const empty = el('div', 'bm-empty');
      empty.appendChild(el('p', null, 'Noch keine Lesezeichen.'));
      empty.appendChild(el('p', 'bm-hint', 'Das Bändchen oben rechts merkt sich die Stelle, an der du gerade liest — von jeder Seite des Buches aus.'));
      body.appendChild(empty);
      return;
    }
    list.forEach((entry) => body.appendChild(row(entry)));
  }

  function init() {
    const btn = q('#openMarks');
    if (!btn) return;
    btn.onclick = () => {
      PR.ui && PR.ui.openDrawer && PR.ui.openDrawer('#marks');
      render();
    };
  }

  PR.bookmarks = { init, render };
})();
