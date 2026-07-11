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

    // 1 · Restructure the page into a centred reader column.
    const reader = PR.reskin.wrapReader();

    // 2 · Infer heading levels from the ORIGINAL computed sizes (before .pr-on).
    PR.reskin.measureHeadings(reader);

    // 3 · Classify tables/images + strip the site's presentational cruft.
    PR.reskin.transform(reader);

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
    }

    // 6 · Turn the reskin on (CSS was inert until now).
    d.classList.add('pr-on');

    // 7 · Wire the study tools, then restore this page's annotations.
    if (PR.anchor && PR.anchor.assignBlockIds) PR.anchor.assignBlockIds(reader);
    if (PR.tools && PR.tools.init) PR.tools.init();
    const pageKey = PR.store ? PR.store.pageKey() : null;
    const page = pageKey ? (await PR.store.get(pageKey)) || {} : {};
    if (PR.tools && PR.tools.restore) PR.tools.restore(page);

    // 8 · Reveal + (M9) play the activation animation once per session.
    reveal();
    PR.activate && PR.activate.play && PR.activate.play();

    // 9 · React to settings / enable changes from other tabs or the popup (M9).
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
