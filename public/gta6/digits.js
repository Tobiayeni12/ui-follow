// Shared by the GTA 6 overlays.

/**
 * Draw `text` (e.g. "23:59:41" or "11,546") as fixed-width cells so the
 * layout never jitters as digits change width. Cells are only rebuilt when
 * the digit/separator *pattern* changes (9,999 → 10,000), otherwise just the
 * changed characters are updated in place.
 * @returns {boolean} true if the cells were rebuilt (callers re-fit then)
 */
export function renderDigits(container, text, { animate = false } = {}) {
  const chars = Array.from(String(text));
  const shape = chars.map((c) => (/\d/.test(c) ? 'd' : c)).join('');

  if (container.dataset.shape !== shape) {
    container.textContent = '';
    for (const c of chars) {
      const el = document.createElement('span');
      el.className = /\d/.test(c) ? 'd' : 's';
      el.textContent = c;
      el.dataset.t = c; // lets CSS draw an outline copy of the glyph behind it (::before)
      container.appendChild(el);
    }
    container.dataset.shape = shape;
    return true;
  }

  chars.forEach((c, i) => {
    const el = container.children[i];
    if (el.textContent === c) return;
    el.textContent = c;
    el.dataset.t = c;
    if (animate && el.classList.contains('d')) {
      el.classList.remove('tick');
      // eslint-disable-next-line no-unused-expressions
      el.offsetWidth; // restart the animation
      el.classList.add('tick');
    }
  });
  return false;
}

/** Scale `el` down (never up) so it always fits inside the browser source. */
export function fitToViewport(el, margin = 0.94) {
  const w = el.offsetWidth; // layout size, unaffected by the scale transform
  const h = el.offsetHeight;
  if (!w || !h) return;
  const k = Math.min(1, (window.innerWidth * margin) / w, (window.innerHeight * margin) / h);
  el.style.setProperty('--fit', k.toFixed(4));
}
