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
    bg: 'neutral', hidedeco: true, frame: 'hairline', motion: true,
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
    if (PR.ui && PR.ui.host) PR.ui.host.dataset.bg = S.bg; // let shadow CSS theme

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
      markSwatch();
    }
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
    $('#resetBtn').onclick = () => { S = { ...DEFAULTS }; save(); apply(); };
  }

  PR.settings = {
    load, apply, wire, save,
    get: () => S,
    DEFAULTS, PROSE_FONTS, LABEL_FONTS, NOTE_FONTS,
  };
})();
