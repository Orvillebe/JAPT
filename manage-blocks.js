/**
 * JAPT Manage, tab Werkblokken - the team's standard week.
 *
 * Responsibilities:
 *   - Drawing the week grid, the block editor, and the panels for clearing and copying a day
 *   - Dragging in the grid: making, moving and resizing a block (quarters)
 *   - The tab's clicks and changes. What is changed applies from today.
 *
 * Owns selBlock, copyTo and grid. The window (manage.js) calls start() once with what every tab needs.
 * The rules are in docs/design.md (Work blocks).
 */

const ManageBlocks = (() => {
  const M = Model, { esc, cap, html } = UI;

  const MIN_PER_H = 60, HOURS_PER_DAY = 24;
  // The time lists of a block: from early morning to late evening, per quarter (blocks snap to quarters).
  // A block outside that range keeps its own time in the list.
  const TIME_FIRST = 5 * MIN_PER_H, TIME_LAST = 23 * MIN_PER_H + 45;
  // The week grid shows the calendar's usual day (config.js dayStart-dayEnd) with an hour of room on
  // either side to drag a block just outside it, and widens for blocks beyond that.
  const GRID_MARGIN_H = 1, GRID_PX_PER_H = 30, DRAG_START_PX = 4;
  const BLOCK_GAP_PX = 2;             // a block is drawn this much shorter, so neighbours stay apart
  const CLICK_BLOCK_MIN = 60;         // a click in an empty spot makes a block of an hour

  let selBlock = null, copyTo = [];
  let grid = { lo: JAPT_CONFIG.dayStart - GRID_MARGIN_H, px: GRID_PX_PER_H };

  // What every tab gets from the window, once, in start().
  let render, done, setErr, showErr, awaiting, askConfirm, setConfirm, getConfirm, CONFIRM, sectionHead;
  function start(shell) {
    ({ render, done, setErr, showErr, awaiting, askConfirm, setConfirm, getConfirm, CONFIRM, sectionHead } = shell);
  }
  // A new window starts with nothing selected.
  function reset() { selBlock = null; copyTo = []; }

  const currentBlocks = day => M.currentBlocks(Store.blocks(), day);
  const plannedOn = blocks => blocks.reduce((sum, x) => sum + Store.plannedFromToday(x.id), 0);

  /* ---------- tab: work blocks ---------- */

  function timeOpts(current) {
    const minutes = [];
    for (let m = TIME_FIRST; m <= TIME_LAST; m += M.SNAP) minutes.push(m);
    if (!minutes.includes(current)) minutes.push(current);
    return minutes.sort((x, y) => x - y).map(m => html`
      <option value="${M.hhmm2(m)}" ${m === current ? 'selected' : ''}>${M.hhmm2(m)}</option>`).join('');
  }

  // The hours the grid runs from and to: the usual day, wider for a block outside it.
  function gridHours(blocks) {
    const earliest = Math.floor(Math.min(...blocks.map(x => x.start / MIN_PER_H), HOURS_PER_DAY));
    const latest = Math.ceil(Math.max(...blocks.map(x => x.end / MIN_PER_H), 0));
    return {
      lo: Math.max(0, Math.min(JAPT_CONFIG.dayStart - GRID_MARGIN_H, earliest)),
      hi: Math.min(HOURS_PER_DAY, Math.max(JAPT_CONFIG.dayEnd + GRID_MARGIN_H, latest))
    };
  }
  const blockTop = (b, lo, px) => (b.start / MIN_PER_H - lo) * px;
  const blockHeight = (b, px) => (b.end - b.start) / MIN_PER_H * px - BLOCK_GAP_PX;

  function gridBlock(x, lo) {
    const box = `top:${blockTop(x, lo, GRID_PX_PER_H)}px;height:${blockHeight(x, GRID_PX_PER_H)}px`;
    return html`
      <div class="wkb ${selBlock === x.id ? 'sel' : ''}" data-bsel="${x.id}" style="${box}">
        <div class="hnd t"></div>
        <b>${UI.span(UI.fmt(x.start), UI.fmt(x.end))}</b>
        ${x.label ? `<span>${esc(x.label)}</span>` : ''}
        <div class="hnd b"></div>
      </div>`;
  }

  function dayClearButton(day) {
    if (!currentBlocks(day).length) return '<div class="wkclr"></div>';
    const on = awaiting(CONFIRM.DAY, day) ? 'on' : '';
    return html`
      <button type="button" class="wkclr ${on}" data-dayclear="${day}" title="${t('blocks.clear_title')}">
        ${t('blocks.clear')}
      </button>`;
  }

  function dayColumn(day, lo, hi) {
    const colStyle = `height:${(hi - lo) * GRID_PX_PER_H}px;background-size:100% ${GRID_PX_PER_H}px`;
    return html`
      <div class="wkd">
        <div class="wkh">${cap(t('wd.' + day))}</div>
        <div class="wkcol" data-day="${day}" style="${colStyle}">
          ${currentBlocks(day).map(x => gridBlock(x, lo)).join('')}
        </div>
        ${dayClearButton(day)}
      </div>`;
  }

  function hourAxis(lo, hi) {
    const hour = i => `<span style="top:${i * GRID_PX_PER_H}px">${lo + i}</span>`;
    const hours = Array.from({ length: hi - lo }, (_, i) => hour(i));
    return html`
      <div class="wkax">
        <div class="wkh">&nbsp;</div>
        <div class="wkaxi" style="height:${(hi - lo) * GRID_PX_PER_H}px">${hours.join('')}</div>
      </div>`;
  }

  function blockDeleteButton(sel, tasks) {
    if (awaiting(CONFIRM.BLOCK, sel.id)) {
      return html`
        <button type="button" class="mdel confirm" data-bdel="${sel.id}">
          ${tasks ? UI.tn('blocks.sure_tasks', tasks) : t('form.sure')}
        </button>`;
    }
    const label = t('blocks.delete');
    return html`
      <button type="button" class="ico" data-bdel="${sel.id}" title="${label}" aria-label="${label}">✕</button>`;
  }

  function blockNameField(sel) {
    if (awaiting(CONFIRM.BLOCK, sel.id)) return '';   // the confirmation takes this place in the row
    return html`
      <input type="text" data-bl="${sel.id}" value="${esc(sel.label)}" placeholder="${t('blocks.name_ph')}" 
        autocomplete="off">`;
  }

  const COPY_CHIP_COLOURS = '--pc:var(--accent);--pcl:var(--block-line)';
  const copyChip = d => html`
    <button type="button" class="wtog ${copyTo.includes(d) ? 'on' : ''}" style="${COPY_CHIP_COLOURS}" data-bcopy="${d}">
      ${cap(t('wd.' + d))}
    </button>`;

  function copyGoButton() {
    if (!copyTo.length) return '';
    const asking = awaiting(CONFIRM.COPY);
    const label = asking ? UI.tn('blocks.sure_tasks', plannedOn(copyTo.flatMap(currentBlocks))) : t('blocks.copy');
    return `<button type="button" class="${asking ? 'dgo' : 'primary'}" data-bcopygo>${label}</button>`;
  }

  function copyPanel(sel) {
    const chips = M.weekOrder().filter(d => d !== sel.day).map(copyChip).join('');
    return html`
      <div class="bcopy">
        <span class="fl">${t('blocks.copy_label', { day: UI.wdLong(sel.day).toLowerCase() })}</span>
        <div class="wrow">${chips}</div>
        ${copyGoButton()}
      </div>`;
  }

  function blockEditor() {
    const sel = Store.blocks().find(x => x.id === selBlock && !x.validTo);
    if (!sel) return `<div class="bedit none">${t('blocks.click_hint')}</div>`;
    return html`
      <div class="bedit">
        <div class="msec">${UI.wdLong(sel.day)}</div>
        <div class="mblk">
          <select data-bs="${sel.id}" aria-label="${t('blocks.start')}">${timeOpts(sel.start)}</select>
          <span class="mto">${t('time.to')}</span>
          <select data-be="${sel.id}" aria-label="${t('blocks.end')}">${timeOpts(sel.end)}</select>
          ${blockNameField(sel)}
          ${blockDeleteButton(sel, Store.plannedFromToday(sel.id))}
        </div>
        ${copyPanel(sel)}
      </div>`;
  }

  function dayClearPanel() {
    const confirmDel = getConfirm();
    if (!confirmDel || confirmDel.kind !== CONFIRM.DAY) return '';
    const day = confirmDel.id, blocks = currentBlocks(day), tasks = plannedOn(blocks);
    return html`
      <div class="gconf dayconf">
        <div class="gstat">
          <b>${t('blocks.clear_q', { day: UI.wdLong(day) })}</b> ${UI.tn('blocks.clear_n', blocks.length)}
          ${tasks ? ', ' + UI.tn('blocks.clear_tasks', tasks) : ''}.
        </div>
        <div class="gcbtns">
          <button type="button" data-dayclearno>${t('form.cancel')}</button>
          <button type="button" class="dgo" data-dayclearyes="${day}">${t('blocks.clear')}</button>
        </div>
      </div>`;
  }

  function blocksTab() {
    const { lo, hi } = gridHours(currentBlocks());
    grid = { lo, px: GRID_PX_PER_H };
    return html`
      ${sectionHead('blocks.title', t('blocks.hint'))}
      <p class="mhow">${t('blocks.how')}</p>
      <div class="wk">${hourAxis(lo, hi)}${M.weekOrder().map(day => dayColumn(day, lo, hi)).join('')}</div>
      ${dayClearPanel()}
      ${blockEditor()}`;
  }

  /* ---------- dragging blocks in the grid ---------- */

  let bd = null;
  function dragModeOf(target, block) {
    if (!block) return 'create';
    if (target.closest('.hnd.t')) return 'top';
    return target.closest('.hnd.b') ? 'bottom' : 'move';
  }
  function onDown(e) {
    const col = e.target.closest('.wkcol');
    if (!col || e.button > 0) return;
    const { lo, px: PXH } = grid, day = +col.dataset.day;
    const rect = col.getBoundingClientRect();
    const minAt = y => M.snap((lo + (y - rect.top) / PXH) * MIN_PER_H);
    const blk = e.target.closest('.wkb'), id = blk ? blk.dataset.bsel : null;
    const b = id ? Store.blocks().find(x => x.id === id) : null;
    const mode = dragModeOf(e.target, b);
    const ref = b ? { start: b.start, end: b.end } : { start: minAt(e.clientY), end: minAt(e.clientY) };
    bd = { mode, id, day, col, blk, lo, PXH, minAt, startY: e.clientY, ref, moved: false, cand: null, ghost: null };
    e.preventDefault();
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
    document.addEventListener('pointercancel', onUp, { once: true });
  }

  // The element that shows the drag: the block itself, or a ghost when making a new one.
  function dragElement(d) {
    if (d.blk) return d.blk;
    if (!d.ghost) {
      d.ghost = document.createElement('div');
      d.ghost.className = 'wkb ghost';
      d.col.appendChild(d.ghost);
    }
    return d.ghost;
  }
  function onMove(e) {
    const d = bd;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientY - d.startY) < DRAG_START_PX) return;   // a click, not a drag
    d.moved = true;
    const target = d.mode === 'move'
      ? M.snap(d.ref.start + (e.clientY - d.startY) / d.PXH * MIN_PER_H)
      : d.minAt(e.clientY);
    const cand = M.fitBlock(Store.blocks(), d.day, d.id, d.mode, d.ref, target);
    if (!cand) return;
    d.cand = cand;
    const el = dragElement(d);
    el.style.top = blockTop(cand, d.lo, d.PXH) + 'px';
    el.style.height = blockHeight(cand, d.PXH) + 'px';
    el.innerHTML = `<b>${UI.span(UI.fmt(cand.start), UI.fmt(cand.end))}</b>`;
  }
  async function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    const d = bd;
    bd = null;
    if (!d) return;
    setConfirm(null); setErr(''); copyTo = [];
    if (d.mode === 'create') {
      let cand = d.cand;
      if (!d.moved) {
        const clicked = { start: d.ref.start, end: d.ref.start };
        cand = M.fitBlock(Store.blocks(), d.day, null, 'create', clicked, d.ref.start + CLICK_BLOCK_MIN);
      }
      if (!cand) { setErr(t('blocks.no_room')); render(); return; }
      selBlock = await UI.act(() => Store.createBlock(d.day, cand.start, cand.end));
    } else {
      selBlock = d.id;
      if (d.moved && d.cand) {
        selBlock = (await UI.act(() => Store.reviseBlock(d.id, { start: d.cand.start, end: d.cand.end }))) || d.id;
      }
    }
    done();
  }

  /* ---------- clicks: work blocks ---------- */

  function toggleCopyDay(el) {
    const day = +el.dataset.bcopy;
    copyTo = copyTo.includes(day) ? copyTo.filter(x => x !== day) : [...copyTo, day];
    setConfirm(null);
    render();
  }
  async function copyToDays() {
    const src = Store.blocks().find(x => x.id === selBlock);
    if (!src) return;
    const hitsTasks = copyTo.flatMap(currentBlocks).some(x => Store.plannedFromToday(x.id));
    if (hitsTasks && !awaiting(CONFIRM.COPY)) { askConfirm(CONFIRM.COPY); return; }
    const days = copyTo;
    copyTo = [];
    setConfirm(null);
    await UI.act(() => Store.copyDay(src.day, days));
    done();
  }
  function toggleDayClear(el) {
    const day = +el.dataset.dayclear;
    setConfirm(awaiting(CONFIRM.DAY, day) ? null : { kind: CONFIRM.DAY, id: day });
    setErr('');
    render();
  }
  function cancelDayClear() { setConfirm(null); render(); }
  async function clearDay(el) {
    setConfirm(null);
    await UI.act(() => Store.clearDay(+el.dataset.dayclearyes));
    if (!Store.blocks().some(x => x.id === selBlock && !x.validTo)) { selBlock = null; copyTo = []; }
    done();
  }
  async function deleteBlock(el) {
    const id = el.dataset.bdel;
    if (!awaiting(CONFIRM.BLOCK, id)) { askConfirm(CONFIRM.BLOCK, id); return; }
    selBlock = null; copyTo = []; setConfirm(null);
    await UI.act(() => Store.removeBlock(id));
    done();
  }
  function selectBlock(el) {
    if (bd) return;   // still dragging: the drag decides when it ends
    selBlock = el.dataset.bsel;
    render();
  }

  /* ---------- changes ---------- */

  // Not saved: no redraw, so what was typed stays.
  async function saveBlock(id, fields) {
    const savedAs = await UI.act(() => Store.reviseBlock(id, fields));
    if (savedAs === null) return;
    selBlock = savedAs;
    done();
  }
  // The start moves the whole block, the end changes its length.
  function editedTimes(block, field) {
    if (field.dataset.bs) {
      const start = M.parseHm(field.value);
      return { start, end: start + (block.end - block.start) };
    }
    return { start: block.start, end: M.parseHm(field.value) };
  }
  async function changeBlock(field, id) {
    const b = Store.blocks().find(x => x.id === id);
    if (!b) return;
    if (field.dataset.bl !== undefined) { await saveBlock(b.id, { label: field.value.trim() }); return; }
    const times = editedTimes(b, field);
    const bad = Store.blockProblems(b.id, times.start, times.end);
    if (bad) { showErr(t(bad.time)); return; }   // no redraw: the time you chose stays, to correct it
    await saveBlock(b.id, times);
  }

  // The window's change event, for this tab's fields; false when the field is not one of them.
  function change(field) {
    const blockId = field.dataset.bs || field.dataset.be || field.dataset.bl;
    return blockId ? changeBlock(field, blockId) : false;
  }

  // Selector -> what a click on it does. The first match wins, in this order.
  const CLICKS = [
    ['[data-bcopy]', toggleCopyDay],
    ['[data-bcopygo]', copyToDays],
    ['[data-dayclear]', toggleDayClear],
    ['[data-dayclearno]', cancelDayClear],
    ['[data-dayclearyes]', clearDay],
    ['[data-bdel]', deleteBlock],
    ['.wkb[data-bsel]', selectBlock]
  ];

  // The window closed: a drag still going on ends with nothing.
  function cancelDrag() { bd = null; }

  return { start, reset, draw: blocksTab, clicks: CLICKS, change, pointerDown: onDown, cancelDrag };
})();
