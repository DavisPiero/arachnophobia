// Stops the browser's own zoom gestures from interfering with the game on phones.
// iOS Safari ignores `user-scalable=no` and can still double-tap-zoom or pinch-zoom, which zooms the page in
// and leaves the controls stuck. CSS `touch-action: none` covers most browsers; this covers the rest.
// Our controls use pointer events, so cancelling the browser's touch defaults does not affect them.
export function preventBrowserZoom() {
  const opts = { passive: false };
  // a second tap within 350 ms is a double tap: cancel it (the first tap still works normally)
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = performance.now();
    if (now - lastTouchEnd < 350 && e.cancelable && !isFormControl(e.target)) e.preventDefault();
    lastTouchEnd = now;
  }, opts);
  // pinch: more than one finger on a non-game layer, and Safari's gesture events
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 && e.cancelable) e.preventDefault(); }, opts);
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault(), opts);
  document.addEventListener('dblclick', (e) => e.preventDefault(), opts);
  // if the page did get zoomed somehow, snap it back by re-applying the viewport rule
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', () => {
      if (vv.scale > 1.01) {
        const meta = document.querySelector('meta[name=viewport]');
        if (!meta) return;
        const c = meta.content;
        meta.content = c + ', minimum-scale=1';
        requestAnimationFrame(() => { meta.content = c; });
      }
    });
  }
}

function isFormControl(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
}
