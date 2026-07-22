/* ══════════════════════════════════════════════════════════════════════
   anchor.js — robust annotation anchoring (the biggest correctness surface).

   Replaces the prototype's positional {b,start,end} with a self-healing
   anchor: a content-hash block id (stable on a byte-stable site, and — unlike
   a positional counter — resilient to our own block-detection changes) plus a
   W3C-style text-quote (exact + prefix/suffix) fallback.

   assignBlockIds() marks every text-bearing block with class .pr-block and
   data-pr-b = FNV1a(normalized textContent), building a hash→elements map.
   buildAnchor() captures a selection; resolveAnchor() re-finds it on load.
   wrapRange()/globalOffset() operate on char offsets within a block's text
   nodes and are reused verbatim by the highlight code.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const PR = (window.__physioReskin ||= {});

  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  const getReader = () => document.getElementById('pr-reader') || document.body;
  const hashMap = new Map();

  function textNodes(el) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const a = []; let n;
    while ((n = w.nextNode())) {
      const p = n.parentElement;
      if (p && p.closest('.pr-deco')) continue; // skip hidden decoration
      a.push(n);
    }
    return a;
  }
  const blockText = (block) => textNodes(block).map((n) => n.textContent).join('');

  function globalOffset(block, node, off) {
    let pos = 0;
    for (const tn of textNodes(block)) { if (tn === node) return pos + off; pos += tn.textContent.length; }
    return pos;
  }

  // Wrap [start,end) of a block's concatenated text in <mark class="hl">.
  function wrapRange(block, start, end, color, id, hasNote) {
    const nodes = textNodes(block); let pos = 0;
    nodes.forEach((node) => {
      const len = node.textContent.length, ns = pos, ne = pos + len; pos += len;
      if (ne <= start || ns >= end) return;
      const s = Math.max(0, start - ns), en = Math.min(len, end - ns);
      const r = document.createRange(); r.setStart(node, s); r.setEnd(node, en);
      const m = document.createElement('mark');
      m.className = 'hl' + (hasNote ? ' has-note' : '');
      m.dataset.color = color; m.dataset.hid = id;
      try { r.surroundContents(m); } catch (err) { /* crosses element boundary — skip that fragment */ }
    });
  }

  const isBlockLevel = (el) => {
    const d = getComputedStyle(el).display;
    return d === 'block' || d === 'list-item' || d === 'table-cell' || d === 'flow-root' || d === 'table-caption';
  };

  // Mark each text node's nearest block-level ancestor as a .pr-block, so text
  // buried in inline <font>/<span> soup still gets a stable block to anchor to.
  // Runs AFTER .pr-on so display reflects the reskin (headings are block, etc.).
  function assignBlockIds(root) {
    root = root || getReader();
    hashMap.clear();
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const blocks = new Set(); let n;
    while ((n = tw.nextNode())) {
      if (!n.textContent.trim()) continue;
      // Controls we injected into the reader are not the page's text. Left in,
      // every section's "Abschnitt einklappen" hashed to the same block and
      // crowded the map with rows nothing can ever anchor to.
      if (n.parentElement && n.parentElement.closest('.pr-chrome')) continue;
      let el = n.parentElement;
      while (el && el !== root && !isBlockLevel(el)) el = el.parentElement;
      if (el && el !== root) blocks.add(el);
    }
    blocks.forEach((el) => {
      el.classList.add('pr-block');
      const hash = fnv1a(norm(el.textContent));
      let arr = hashMap.get(hash);
      if (!arr) { arr = []; hashMap.set(hash, arr); }
      el.dataset.prB = hash;
      el.dataset.prN = String(arr.length);
      arr.push(el);
    });
    return blocks.size;
  }

  // Capture a fresh selection's block-relative offsets + text-quote.
  function buildAnchor(range, block) {
    const s0 = globalOffset(block, range.startContainer, range.startOffset);
    const e0 = globalOffset(block, range.endContainer, range.endOffset);
    const start = Math.min(s0, e0), end = Math.max(s0, e0);
    const full = blockText(block);
    return {
      blockHash: block.dataset.prB,
      nthOfHash: +(block.dataset.prN || 0),
      start, end,
      exact: full.slice(start, end),
      prefix: full.slice(Math.max(0, start - 32), start),
      suffix: full.slice(end, end + 32),
    };
  }

  // Find the offset of the anchor's text within a block: prefer prefix+exact+
  // suffix, else the occurrence of `exact` nearest the recorded offset.
  function locate(full, a) {
    if (a.prefix || a.suffix) {
      const probe = a.prefix + a.exact + a.suffix;
      const i = full.indexOf(probe);
      if (i >= 0) return i + a.prefix.length;
    }
    if (!a.exact) return -1;
    let idx = -1, best = Infinity, from = 0, i;
    while ((i = full.indexOf(a.exact, from)) >= 0) {
      const d = Math.abs(i - a.start);
      if (d < best) { best = d; idx = i; }
      from = i + 1;
    }
    return idx;
  }

  // Resolve an anchor to { block, start, end } (or null if unrecoverable).
  function resolveAnchor(a) {
    const tryBlock = (blk) => {
      if (!blk) return null;
      const full = blockText(blk);
      if (a.exact && full.slice(a.start, a.end) === a.exact) return { block: blk, start: a.start, end: a.end };
      const idx = locate(full, a);
      if (idx >= 0) return { block: blk, start: idx, end: idx + a.exact.length };
      return null;
    };
    const arr = hashMap.get(a.blockHash);
    if (arr && arr.length) {
      const hit = tryBlock(arr[a.nthOfHash]) || tryBlock(arr[0]);
      if (hit) return hit;
    }
    // self-heal: the block hash changed (our tokenizing changed / content moved);
    // scan every block for the quote.
    if (a.exact) {
      for (const blk of getReader().querySelectorAll('.pr-block')) {
        const hit = tryBlock(blk);
        if (hit) return hit;
      }
    }
    return null;
  }

  PR.anchor = {
    assignBlockIds, buildAnchor, resolveAnchor, wrapRange, globalOffset, textNodes, blockText,
    fnv1a, norm,
  };
})();
