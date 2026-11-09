/**
 * JAPT Drag - dragging a task, for every screen.
 *
 * Responsibilities:
 *   - What is being dragged: {task, from, fromPeriod}, set first thing on dragstart, so a problem later
 *     on can never leave an old drag behind
 *   - One dragover and one drop listener for the whole page; screens register drop zones
 *   - Marking the target (.over) and the spot between two tasks (.ins-before / .ins-after)
 *   - Ending a drag through end(), also when the dragged card is gone before the browser's dragend
 *
 * A dragged element carries data-task, and data-from (a place, model.js placeText) when it sits in a
 * block or period, and data-from-period when it is shown in the period view. A drop zone is
 *   { find(el)                -> its target element around el, or null
 *     accepts(drag)           -> whether this task may be dropped here
 *     over(e, target, drag)   -> false to refuse this spot, or {el, after} to mark a spot, or null
 *     drop(target, drag, spot) -> saves; spot is what over() said for the drop point
 *     leave()                 -> optional: the pointer left this zone or the drag ended }
 * Zones are asked in the order they were registered.
 */

const Drag = (() => {
  const M = Model;
  const zones = [], onStarts = [], onEnds = [];
  let cur = null, active = null;   // the drag, and the zone the pointer is over

  const current = () => cur;
  const zone = z => { zones.push(z); };
  const onStart = f => { onStarts.push(f); };
  const onEnd = f => { onEnds.push(f); };

  function clearMarks() {
    document.querySelectorAll('.ins-before,.ins-after').forEach(x => x.classList.remove('ins-before', 'ins-after'));
  }
  function clearOver(keep) {
    document.querySelectorAll('.over').forEach(x => { if (x !== keep) x.classList.remove('over'); });
  }
  function leave() { if (active && active.leave) active.leave(); active = null; clearMarks(); clearOver(null); }

  function end() {
    if (!cur) return;
    cur = null; leave();
    document.body.classList.remove('dragging-any');
    document.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging'));
    onEnds.forEach(f => f());
  }

  // The zone and target under the pointer that take this task.
  function hit(e) {
    if (!cur || !e.target.closest) return null;
    for (const z of zones) { const el = z.find(e.target); if (el && z.accepts(cur)) return { z, el }; }
    return null;
  }

  document.addEventListener('dragstart', e => {
    const el = e.target.closest && e.target.closest('[data-task][draggable="true"]'); if (!el) return;
    cur = { task: el.dataset.task, from: M.parsePlace(el.dataset.from), fromPeriod: el.dataset.fromPeriod || null };
    onStarts.forEach(f => f(cur));
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', cur.task);
    // styled one moment later, so the browser's drag image is the card as it was
    setTimeout(() => {
      if (!cur) return;
      el.classList.add('dragging');
      document.body.classList.add('dragging-any');
    }, 0);
  });
  document.addEventListener('dragend', end);

  document.addEventListener('dragover', e => {
    const h = hit(e);
    if (!h) { leave(); return; }
    if (active && active !== h.z) leave();
    active = h.z;
    clearMarks();
    const spot = h.z.over(e, h.el, cur);
    if (spot === false) { clearOver(null); return; }   // refused: no drop allowed here
    e.preventDefault();
    clearOver(h.el); h.el.classList.add('over');
    if (spot) spot.el.classList.add(spot.after ? 'ins-after' : 'ins-before');
  });

  document.addEventListener('drop', e => {
    const h = hit(e); if (!h) return;
    const spot = h.z.over(e, h.el, cur);
    if (spot === false) return;
    e.preventDefault();
    const d = cur;
    end();
    h.z.drop(h.el, d, spot);
  });

  return { current, zone, onStart, onEnd, end };
})();
