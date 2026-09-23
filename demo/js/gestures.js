// Touch-only swipe detection: swipe a task bubble to mark it complete,
// swipe an email row to mark it read. Visual feedback only (the surface
// follows the finger + the colored .swipe-reveal shows underneath) -- no
// vibration/haptics anywhere per spec. Desktop/non-touch users always have
// an equivalent tap control right on the element (tasks.js's
// .bubble-toggle checkbox, components.js's .context-mark-read button) --
// swipe is additive, never the only way to trigger the action.

function wireSwipe(el, { onSwipe, threshold = 60 } = {}) {
  const surface = el.querySelector('.swipeable-surface');
  if (!surface) return;

  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let decided = false; // once true: this gesture is a horizontal swipe, not a vertical scroll

  const setTransition = (on) => { surface.style.transition = on ? 'transform .18s ease' : 'none'; };
  setTransition(true);

  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    dx = 0;
    dragging = true;
    decided = false;
    setTransition(false);
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    const curDx = t.clientX - startX;
    const curDy = t.clientY - startY;
    if (!decided) {
      if (Math.abs(curDx) < 6 && Math.abs(curDy) < 6) return;
      decided = Math.abs(curDx) > Math.abs(curDy);
      // A predominantly vertical drag is a page scroll -- back off and let
      // the browser handle it instead of fighting it.
      if (!decided) { dragging = false; return; }
    }
    dx = curDx;
    surface.style.transform = `translateX(${dx}px)`;
  }, { passive: true });

  const finish = () => {
    if (!dragging) return;
    dragging = false;
    setTransition(true);
    surface.style.transform = 'translateX(0)';
    if (decided && Math.abs(dx) >= threshold && typeof onSwipe === 'function') onSwipe();
    dx = 0;
    decided = false;
  };

  el.addEventListener('touchend', finish);
  el.addEventListener('touchcancel', finish);
}
