/**
 * JAPT Landscape - Week and Werkweek lie down on a phone by themselves, also on a phone that can't turn.
 *
 * Responsibilities:
 *   - Locking the screen in landscape while a week view is shown on a phone, and letting go after
 *   - Where the browser only allows that in full screen (a tab in Chrome), going full screen first, as the
 *     mockup did; leaving full screen again when the week view is left
 *
 * Locking is only allowed shortly after a tap: switching views is one, so app.js and calendar.js call
 * sync after drawing. When it isn't allowed (another browser, an iPhone), the bar "Draai je gsm" stays (style.css).
 */

const Landscape = (() => {
  const PHONE_SIDE = 500;   // the short side of the screen, in CSS pixels: a phone, never a tablet or laptop
  const isPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= PHONE_SIDE;
  const canLock = () => !!(screen.orientation && screen.orientation.lock);

  let wanted = false, ownFullScreen = false;   // ownFullScreen: we asked for it, so we leave it again

  async function lock() {
    try { await screen.orientation.lock('landscape'); return; } catch { /* a tab: only in full screen */ }
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        ownFullScreen = true;
      }
      await screen.orientation.lock('landscape');
    } catch (e) {
      console.warn('Landscape not allowed here', e);   // the bar asks to turn the phone
    }
  }
  async function unlock() {
    try { screen.orientation.unlock(); } catch { /* nothing was locked */ }
    if (ownFullScreen && document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* already left */ }
    }
    ownFullScreen = false;
  }

  // After drawing: is a week view shown now? Only a change does something.
  function sync() {
    const { View, MODE } = UI;
    const on = View.page === 'tasks' && (View.mode === MODE.WEEK || View.mode === MODE.WORKWEEK);
    const want = on && isPhone() && canLock();
    if (want === wanted) return;
    wanted = want;
    if (want) lock(); else unlock();
  }

  // Swiping out of full screen lets go of the lock too: the next switch to a week view tries again.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && ownFullScreen) { ownFullScreen = false; wanted = false; }
  });

  return { sync };
})();
