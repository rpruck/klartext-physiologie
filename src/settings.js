/* ══════════════════════════════════════════════════════════════════════
   settings.js — the Einstellungen panel.

   apply() writes CSS custom properties on :root (they inherit through the
   shadow boundary, so both the light-DOM reskin and the shadow UI update) and
   sets data-* on <html> (which content.css keys off) + on the shadow host
   (so shadow CSS can theme, e.g. dark-mode danger colour).

   Ported almost verbatim from the prototype; the differences are: controls
   live in the shadow root (queried via PR.ui.shadow), and persistence is
   chrome.storage.local via PR.store (async) instead of localStorage.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const PR = (window.__physioReskin ||= {});

  const PROSE_FONTS = {
    eb: "'EB Garamond', Georgia, serif",
    cmu: "'CMU Serif','Latin Modern Roman', Georgia, serif",
    'source-serif': "'Source Serif 4', Georgia, serif",
    newsreader: "'Newsreader', Georgia, serif",
    inter: "'Inter', system-ui, sans-serif",
    'source-sans': "'Source Sans 3', system-ui, sans-serif",
    'plex-sans': "'IBM Plex Sans', system-ui, sans-serif",
  };
  const LABEL_FONTS = {
    'inter-label': "'Inter', system-ui, sans-serif",
    'space-mono': "'Space Mono', ui-monospace, monospace",
    'plex-mono': "'IBM Plex Mono', ui-monospace, monospace",
    'cmu-tt': "'CMU Typewriter Text', ui-monospace, monospace",
  };
  const NOTE_FONTS = {
    inter: "'Inter', system-ui, sans-serif",
    'plex-sans': "'IBM Plex Sans', system-ui, sans-serif",
    'source-sans': "'Source Sans 3', system-ui, sans-serif",
    eb: "'EB Garamond', Georgia, serif",
    'space-mono': "'Space Mono', ui-monospace, monospace",
  };
  const DEFAULTS = {
    proseFont: 'eb', labelFont: 'inter-label', noteFont: 'inter', fs: 19, lh: 1.68,
    measure: 680, gap: 1.0, align: 'justify', accent: '#0e8373',
    bg: 'neutral', hidedeco: true, frame: 'hairline', motion: true, progress: true,
    collapse: true, rail: true, laneImg: true, laneNotes: true,
  };
  const PAPER = { neutral: '#fbfbfb', paper: '#faf8f3', white: '#ffffff', sepia: '#f3ead6', dark: '#17140f' };

  let S = { ...DEFAULTS };

  async function load() {
    const stored = await PR.store.get('settings');
    S = Object.assign({}, DEFAULTS, stored || {});
    return S;
  }
  async function save() {
    await PR.store.set('settings', S);
    PR.store.mirror({ enabled: true, paper: PAPER[S.bg] || '#fbfbfb' });
  }

  const $ = (sel) => (PR.ui && PR.ui.shadow) ? PR.ui.shadow.querySelector(sel) : null;
  const $$ = (sel) => (PR.ui && PR.ui.shadow) ? [...PR.ui.shadow.querySelectorAll(sel)] : [];
  const setSeg = (sel, v) => $$(sel + ' button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v));
  const setToggle = (sel, v) => { const el = $(sel); if (el) el.setAttribute('aria-pressed', !!v); };
  // A lane button is a topbar pill, so it carries .active as well as the state.
  const setLane = (sel, v) => { const el = $(sel); if (el) { el.setAttribute('aria-pressed', !!v); el.classList.toggle('active', !!v); } };
  const markSwatch = () => $$('#swatches .cs').forEach((c) => c.classList.toggle('sel', c.dataset.c.toLowerCase() === String(S.accent).toLowerCase()));

  function apply() {
    const root = document.documentElement.style;
    root.setProperty('--font-prose', PROSE_FONTS[S.proseFont]);
    root.setProperty('--font-label', LABEL_FONTS[S.labelFont]);
    root.setProperty('--font-note', NOTE_FONTS[S.noteFont]);
    root.setProperty('--fs', S.fs + 'px');
    root.setProperty('--lh', S.lh);
    root.setProperty('--measure', S.measure + 'px');
    root.setProperty('--gap', S.gap + 'em');
    root.setProperty('--accent-user', S.accent);

    const d = document.documentElement;
    d.dataset.bg = S.bg;
    d.dataset.hidedeco = S.hidedeco ? '1' : '0';
    d.dataset.figframe = S.frame;
    d.dataset.motion = S.motion ? '1' : '0';
    d.dataset.align = S.align;
    d.dataset.progress = S.progress ? '1' : '0';   // content.css gates .pr-seen on this
    d.dataset.collapse = S.collapse ? '1' : '0';   // …and the accordion chrome on this
    d.dataset.rail = S.rail ? '1' : '0';
    d.dataset.laneImg = S.laneImg ? '1' : '0';       // content.css derives --lane-shift
    d.dataset.laneNotes = S.laneNotes ? '1' : '0';
    if (PR.ui && PR.ui.host) {
      PR.ui.host.dataset.bg = S.bg;                  // let shadow CSS theme…
      // …and reach the lane state: shadow rules can't select <html>'s attrs.
      PR.ui.host.dataset.laneImg = d.dataset.laneImg;
      PR.ui.host.dataset.laneNotes = d.dataset.laneNotes;
    }

    // reflect into shadow controls (if the UI is mounted)
    if ($('#proseFont')) {
      $('#proseFont').value = S.proseFont;
      $('#labelFont').value = S.labelFont;
      $('#noteFont').value = S.noteFont;
      $('#fs').value = S.fs; $('#fsVal').textContent = S.fs + 'px';
      $('#lh').value = S.lh; $('#lhVal').textContent = (+S.lh).toFixed(2);
      $('#measure').value = S.measure; $('#measureVal').textContent = S.measure + 'px';
      $('#gap').value = S.gap; $('#gapVal').textContent = (+S.gap).toFixed(2);
      $('#customColor').value = S.accent;
      setSeg('#alignSeg', S.align); setSeg('#bgSeg', S.bg); setSeg('#frameSeg', S.frame);
      setToggle('#hidedeco', S.hidedeco); setToggle('#motion', S.motion);
      setToggle('#progress', S.progress);
      setToggle('#collapse', S.collapse); setToggle('#rail', S.rail);
      markSwatch();
    }
    setLane('#laneImg', S.laneImg); setLane('#laneNotes', S.laneNotes);
    PR.tools && PR.tools.layoutNotes && PR.tools.layoutNotes();
  }

  // live-preview a single CSS var without a full apply (smooth slider drags)
  const setVar = (k, v) => document.documentElement.style.setProperty(k, v);

  function wire() {
    $('#proseFont').onchange = (e) => { S.proseFont = e.target.value; save(); apply(); };
    $('#labelFont').onchange = (e) => { S.labelFont = e.target.value; save(); apply(); };
    $('#noteFont').onchange = (e) => { S.noteFont = e.target.value; save(); apply(); };
    $('#fs').oninput = (e) => { S.fs = +e.target.value; $('#fsVal').textContent = S.fs + 'px'; setVar('--fs', S.fs + 'px'); PR.tools && PR.tools.layoutNotes && PR.tools.layoutNotes(); };
    $('#fs').onchange = save;
    $('#lh').oninput = (e) => { S.lh = +e.target.value; $('#lhVal').textContent = (+S.lh).toFixed(2); setVar('--lh', S.lh); PR.tools && PR.tools.layoutNotes && PR.tools.layoutNotes(); };
    $('#lh').onchange = save;
    $('#measure').oninput = (e) => { S.measure = +e.target.value; $('#measureVal').textContent = S.measure + 'px'; setVar('--measure', S.measure + 'px'); PR.tools && PR.tools.layoutNotes && PR.tools.layoutNotes(); };
    $('#measure').onchange = save;
    $('#gap').oninput = (e) => { S.gap = +e.target.value; $('#gapVal').textContent = (+S.gap).toFixed(2); setVar('--gap', S.gap + 'em'); PR.tools && PR.tools.layoutNotes && PR.tools.layoutNotes(); };
    $('#gap').onchange = save;
    $$('#alignSeg button').forEach((b) => b.onclick = () => { S.align = b.dataset.v; save(); apply(); });
    $$('#bgSeg button').forEach((b) => b.onclick = () => { S.bg = b.dataset.v; save(); apply(); });
    $$('#frameSeg button').forEach((b) => b.onclick = () => { S.frame = b.dataset.v; save(); apply(); });
    $$('#swatches .cs').forEach((c) => c.onclick = () => { S.accent = c.dataset.c; save(); apply(); });
    $('#customColor').oninput = (e) => { S.accent = e.target.value; setVar('--accent-user', S.accent); markSwatch(); };
    $('#customColor').onchange = save;
    $('#hidedeco').onclick = () => { S.hidedeco = !S.hidedeco; save(); apply(); };
    $('#motion').onclick = () => { S.motion = !S.motion; save(); apply(); };
    $('#progress').onclick = () => { S.progress = !S.progress; save(); apply(); retag(); };
    // Turning the accordion off must show the whole page at once; turning it
    // back on folds everything away again, which is what asking for it means.
    $('#collapse').onclick = () => {
      S.collapse = !S.collapse; save(); apply();
      PR.outline && PR.outline.openAll(!S.collapse);
    };
    $('#rail').onclick = () => { S.rail = !S.rail; save(); apply(); PR.progress && PR.progress.setVisible(S.rail); };
    // Lane toggles (topbar, not the panel — you reach for them while arranging
    // figures). Pins stay where they were dragged; only the column moves.
    $('#laneImg').onclick = () => { S.laneImg = !S.laneImg; save(); apply(); };
    $('#laneNotes').onclick = () => { S.laneNotes = !S.laneNotes; save(); apply(); };
    $('#resetBtn').onclick = () => { S = { ...DEFAULTS }; save(); apply(); retag(); PR.progress && PR.progress.setVisible(S.rail); };
    wireForget();
  }

  // Tracking just came (back) on: the open reader was never tagged and this
  // visit never recorded, so do both now rather than waiting for a reload.
  function retag() {
    if (S.progress && PR.visited) PR.visited.apply(document.getElementById('pr-reader'));
  }

  // Dropping the read history can't be undone — you'd have to re-walk the book
  // to rebuild it — so the button arms on the first click and forgets it was
  // asked after a few seconds. Not a setting, but this is where the panel's
  // controls get wired.
  function wireForget() {
    const b = $('#forgetBtn');
    if (!b) return;
    const idle = () => { b.classList.remove('armed'); b.textContent = b.dataset.label; };
    let armed = null;
    b.onclick = async () => {
      if (!armed) {
        b.classList.add('armed');
        b.textContent = 'Wirklich? Nochmal klicken';
        armed = setTimeout(() => { armed = null; idle(); }, 5000);
        return;
      }
      clearTimeout(armed); armed = null;
      if (PR.visited) await PR.visited.clear();
      b.classList.remove('armed');
      b.textContent = 'Gelöscht ✓';
      setTimeout(idle, 2000);
    };
  }

  PR.settings = {
    load, apply, wire, save,
    get: () => S,
    DEFAULTS, PROSE_FONTS, LABEL_FONTS, NOTE_FONTS,
  };
})();
