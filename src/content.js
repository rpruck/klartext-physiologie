/* ══════════════════════════════════════════════════════════════════════
   content.js — document_end orchestrator.

   Enforces the boot ordering that everything else depends on:
     · MEASURE heading sizes BEFORE the reskin is applied (.pr-on), so the
       computed font-sizes read are the site's originals, not ours.
     · Only un-hide the page (.pr-ready) once the reskin + annotations are in
       place, so the reader never sees a half-built page.

   Modules attach their APIs to the shared PR namespace (window.__physioReskin),
   which is common to every content-script file in this isolated world.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const PR = (window.__physioReskin ||= {});
  const d = document.documentElement;

  function reveal() {
    d.style.removeProperty('background'); // hand the canvas back to body's --paper
    d.classList.add('pr-ready');
  }

  async function boot() {
    // 0 · Respect the global on/off switch (toggled from the toolbar popup).
    const enabled = PR.store ? ((await PR.store.get('enabled')) !== false) : true;
    if (!enabled) {
      if (PR.store) { PR.store.mirror({ enabled: false }); PR.store.onChanged(onStorageChanged); }
      reveal();
      return;
    }
    if (PR.store) PR.store.mirror({ enabled: true });

    // Register bundled fonts up front (document-scoped @font-face, harmless
    // even before the reskin sets font-family). The page is hidden until
    // .pr-ready, so there's no FOIT.
    PR.fonts && PR.fonts.inject();

    // 1 · Extract the tag soup into a semantic block model and re-render clean
    //     HTML into a fresh #pr-reader. Reads the site's ORIGINAL computed sizes
    //     (body is still visibility:hidden per boot.css, .pr-on not yet added).
    //     The homepage is all image-links with no text nav, so it gets a
    //     bespoke hero instead of the generic reflow.
    const reader = PR.reskin.isHome() ? PR.reskin.renderHome() : PR.reskin.reflow();

    // 4 · Load settings, then mount the Shadow-DOM UI (must exist before
    //     apply() reflects values into its controls).
    if (PR.settings) await PR.settings.load();
    if (PR.ui) await PR.ui.mount();

    // 5 · Apply settings (writes CSS vars on :root + data-* on <html>).
    if (PR.settings) {
      PR.settings.apply();
      PR.settings.wire();
    } else {
      d.dataset.bg = 'neutral'; d.dataset.align = 'justify';
      d.dataset.hidedeco = '1'; d.dataset.figframe = 'hairline'; d.dataset.motion = '1';
      d.dataset.progress = '1'; d.dataset.collapse = '1'; d.dataset.rail = '1';
      d.dataset.laneImg = '1'; d.dataset.laneNotes = '1';
    }

    // 6 · Turn the reskin on (CSS was inert until now).
    d.classList.add('pr-on');

    // 7 · Mark links to pages already read (and record this one) — before the
    //     reveal, so the markers are there on first paint.
    if (PR.visited) await PR.visited.apply(reader);

    // 8 · Load this page's record (annotations, open sections, read progress),
    //     then build the section outline — with every section still OPEN, so
    //     assignBlockIds measures real block ancestry and restore() can wrap
    //     its marks. Only after that does applyState() fold anything away.
    if (PR.page) await PR.page.load();
    if (PR.outline) PR.outline.build(reader);
    if (PR.anchor && PR.anchor.assignBlockIds) PR.anchor.assignBlockIds(reader);
    if (PR.tools && PR.tools.init) PR.tools.init();
    if (PR.tools && PR.tools.restore) PR.tools.restore();
    if (PR.outline) PR.outline.applyState();
    if (PR.progress) PR.progress.init(reader);
    if (PR.bookmarks) PR.bookmarks.init();
    if (PR.inspect) PR.inspect.init(reader);

    // 9 · Reveal the finished page + play the one-time activation animation.
    reveal();
    PR.activate && PR.activate.play && PR.activate.play();

    // 10 · React to settings / enable changes from other tabs or the popup (M9).
    if (PR.store) PR.store.onChanged(onStorageChanged);
  }

  function onStorageChanged(changes) {
    // Enable/disable toggled (popup or another tab): reload so the page rebuilds
    // cleanly — the reskin's DOM stripping can't be reverted in place.
    if (changes.enabled) { location.reload(); return; }
    if (changes.settings && PR.settings) {
      // re-apply settings changed in another tab
      PR.settings.load().then(() => PR.settings.apply());
    }
  }

  // Guard so one thrown module never strands the page hidden.
  try {
    boot().catch(function (err) {
      console.error('[physiologie·reskin] boot failed:', err);
      reveal();
    });
  } catch (err) {
    console.error('[physiologie·reskin] boot threw:', err);
    reveal();
  }
})();
