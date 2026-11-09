/**
 * JAPT deadline picker - a date field with its own calendar and a row Herhalen.
 *
 * Responsibilities:
 *   - The button that shows the date and repeat, and the button that clears them
 *   - The calendar: made when it opens and removed when it closes
 *   - Keeping the value in the hidden date field
 */

const DeadlinePicker = (() => {
  const M = Model;
  const { html, cap, fmtDay, REP_ICON, repText, onEscape, onWindowClose } = UI;

  // Its own calendar with a row Herhalen. The hidden date field holds the value (.value the date,
  // .dataset.rep the repeat 'n:u'); the button shows them. The calendar exists only while it is open.
  const DK_PRESETS = [
    ['', 'repeat.never'],
    ['1:w', 'repeat.week'],
    ['2:w', 'repeat.two_weeks'],
    ['1:m', 'repeat.month'],
    ['3:m', 'repeat.three_months']
  ];
  const DK_YEARS_BACK = 1, DK_YEARS = 9;   // the year list: last year and the eight after it
  const DK_CUSTOM_COUNT = 2, DK_CUSTOM_UNIT = 'w';   // where Aangepast starts when nothing is chosen yet
  const DK_MAX_COUNT = 99;                 // "every 99 months" is already far beyond any real use
  const DK_MONTH_NAME_MAX = 7;             // longer month names are shortened, so the bar fits
  const MONTHS_IN_YEAR = 12, DAYS_IN_WEEK = 7;
  let dk = null;

  function dkText(i) {
    if (!i.value) return `<span class="dkph">${t('deadline.pick')}</span>`;
    const rep = i.dataset.rep;
    const repeat = rep ? `<span class="dkrep">${REP_ICON} ${repText(rep)}</span>` : '';
    return `<span>${fmtDay(i.value)} ${M.parseD(i.value).getUTCFullYear()}</span>${repeat}`;
  }

  function dxSync(i) {
    const w = i.parentElement;
    w.classList.toggle('has', !!i.value);
    w.querySelector('.dkf').innerHTML = dkText(i);
    i.dispatchEvent(new Event('dxsync', { bubbles: true }));
  }

  function setDeadline(i, date, rep) {
    i.value = date || '';
    i.dataset.rep = date ? rep || '' : '';
    dxSync(i);
  }

  function dkFieldButton(i) {
    const field = document.createElement('button');
    field.type = 'button';
    field.className = 'dkf';
    field.setAttribute('aria-haspopup', 'dialog');
    field.addEventListener('click', e => {
      e.preventDefault();
      dkOpen(i);
    });
    return field;
  }

  function dkClearButton(i) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'dclr';
    clear.textContent = '×';
    clear.setAttribute('aria-label', t('deadline.clear_aria'));
    clear.addEventListener('click', e => {
      e.preventDefault();
      setDeadline(i, '', '');
    });
    return clear;
  }

  function wrapDeadline(i) {
    const w = document.createElement('span');
    w.className = 'dwrap';
    i.before(w);
    w.appendChild(i);
    i.hidden = true;
    i.tabIndex = -1;
    w.insertBefore(dkFieldButton(i), i);
    w.appendChild(dkClearButton(i));
    dxSync(i);
  }

  function dkClose() {
    if (!dk) return false;
    dk.bk.remove();
    dk.pop.remove();
    dk = null;
    return true;
  }

  function dkState(i) {
    const base = M.parseD(i.value || M.today()), rep = i.dataset.rep || '';
    return {
      i,
      sel: i.value || '',
      rep,
      y: base.getUTCFullYear(),
      m: base.getUTCMonth(),
      custom: !!rep && !DK_PRESETS.some(p => p[0] === rep)
    };
  }

  function dkOpen(i) {
    dkClose();
    const bk = document.createElement('div');
    bk.className = 'dkbk';
    const pop = document.createElement('div');
    pop.className = 'dkpop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', t('deadline.aria'));
    const host = i.closest('dialog') || document.body;
    host.append(bk, pop);
    dk = { st: dkState(i), bk, pop };
    bk.addEventListener('click', dkClose);
    pop.addEventListener('click', dkClick);
    pop.addEventListener('change', dkChange);
    pop.addEventListener('input', dkInput);
    dkDraw();
  }

  const dkq = sel => dk.pop.querySelector(sel);

  function dkMonthSelect(st) {
    const monthName = k => {
      const name = t('mo.' + k);
      return name.length > DK_MONTH_NAME_MAX ? name.slice(0, 3) : name;
    };
    const option = k => `<option value="${k}" ${k === st.m ? 'selected' : ''}>${monthName(k)}</option>`;
    const options = Array.from({ length: MONTHS_IN_YEAR }, (_, k) => option(k)).join('');
    return `<select data-dkm aria-label="${t('deadline.month')}">${options}</select>`;
  }

  function dkYearSelect(st) {
    const firstYear = M.parseD(M.today()).getUTCFullYear() - DK_YEARS_BACK;
    const years = Array.from({ length: DK_YEARS }, (_, n) => firstYear + n);
    if (!years.includes(st.y)) years.push(st.y);
    const options = years.sort().map(y => `<option ${y === st.y ? 'selected' : ''}>${y}</option>`).join('');
    return `<select data-dky aria-label="${t('deadline.year')}">${options}</select>`;
  }

  function dkWeekdayHeads() {
    const weekStart = M.getWeekStart();
    const head = k => `<span>${cap(t('wd.' + (weekStart + k) % DAYS_IN_WEEK))}</span>`;
    return Array.from({ length: DAYS_IN_WEEK }, (_, k) => head(k)).join('');
  }

  function dkDayButton(ds, day, selected) {
    const isSelected = ds === selected;
    const classes = `dkd ${ds === M.today() ? 'today' : ''} ${isSelected ? 'sel' : ''}`;
    const pressed = isSelected ? 'aria-pressed="true"' : '';
    return `<button type="button" class="${classes}" data-dkd="${ds}" ${pressed}>${day}</button>`;
  }

  // Empty cells first, so the 1st lands under its weekday.
  function dkDayCells({ y, m, sel }) {
    const firstWeekday = new Date(Date.UTC(y, m, 1)).getUTCDay();
    let cells = '<span></span>'.repeat((firstWeekday - M.getWeekStart() + DAYS_IN_WEEK) % DAYS_IN_WEEK);
    const lastDay = M.daysIn(y, m);
    for (let day = 1; day <= lastDay; day++) {
      cells += dkDayButton(M.toDs(new Date(Date.UTC(y, m, day))), day, sel);
    }
    return cells;
  }

  // Repeating needs a date to count from, so without one the pills are off.
  function dkPills(st) {
    const disabled = !st.sel ? 'disabled' : '';
    const pill = (value, on, label) =>
      `<button type="button" class="dkpill ${on ? 'on' : ''}" data-dkr="${value}" ${disabled}>${label}</button>`;
    const presets = DK_PRESETS.map(([value, key]) => pill(value, !st.custom && st.rep === value, t(key)));
    return presets.join('') + pill('custom', st.custom, t('repeat.custom'));
  }

  function dkCustomRow(st) {
    const p = M.parseRepeat(st.rep);
    const count = p ? p.n : DK_CUSTOM_COUNT, chosenUnit = p ? p.u : DK_CUSTOM_UNIT;
    const unitOption = u => `<option value="${u}" ${chosenUnit === u ? 'selected' : ''}>${t('unit.' + u)}</option>`;
    return html`
      <div class="dkcus">
        <span>${t('repeat.every')}</span>
        <input type="number" data-dkn min="1" max="${DK_MAX_COUNT}" value="${count}" aria-label="${t('repeat.count')}">
        <select data-dku aria-label="${t('repeat.unit')}">${['d', 'w', 'm'].map(unitOption).join('')}</select>
      </div>`;
  }

  function dkDraw() {
    const { st, pop } = dk;
    pop.innerHTML = html`
      <div class="dkh">
        <button type="button" data-dk="prev" aria-label="${t('deadline.prev')}">‹</button>
        ${dkMonthSelect(st)}
        ${dkYearSelect(st)}
        <button type="button" data-dk="next" aria-label="${t('deadline.next')}">›</button>
      </div>
      <div class="dkw">${dkWeekdayHeads()}</div>
      <div class="dkg">${dkDayCells(st)}</div>
      <div class="dkl">${REP_ICON} ${t('repeat.label')}</div>
      <div class="dkpills">${dkPills(st)}</div>
      ${st.custom ? dkCustomRow(st) : ''}
      <div class="dkbtns">
        <button type="button" data-dk="clear">${t('deadline.clear')}</button>
        <button type="button" class="primary" data-dk="ok">${t('deadline.ok')}</button>
      </div>`;
  }

  function dkCommit() {
    const { st } = dk;
    setDeadline(st.i, st.sel, st.rep);
    dkClose();
  }

  function dkChooseRepeat(st, choice) {
    if (choice === 'custom') {
      st.custom = true;
      if (!st.rep) st.rep = `${DK_CUSTOM_COUNT}:${DK_CUSTOM_UNIT}`;
    } else {
      st.custom = false;
      st.rep = choice;
    }
  }

  function dkStepMonth(st, step) {
    st.m += step;
    if (st.m < 0) { st.m = MONTHS_IN_YEAR - 1; st.y--; }
    if (st.m >= MONTHS_IN_YEAR) { st.m = 0; st.y++; }
  }

  function dkClick(e) {
    const { st } = dk, b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.dkd) {
      st.sel = b.dataset.dkd;
      dkDraw();
      return;
    }
    if (b.dataset.dkr !== undefined) {
      dkChooseRepeat(st, b.dataset.dkr);
      dkDraw();
      return;
    }
    const action = b.dataset.dk;
    if (action === 'prev' || action === 'next') {
      dkStepMonth(st, action === 'next' ? 1 : -1);
      dkDraw();
    } else if (action === 'clear') {
      st.sel = '';
      st.rep = '';
      dkCommit();
    } else if (action === 'ok') {
      dkCommit();
    }
  }

  function dkChange(e) {
    const { st } = dk, d = e.target.dataset;
    if (d.dkm !== undefined) { st.m = +e.target.value; dkDraw(); }
    else if (d.dky !== undefined) { st.y = +e.target.value; dkDraw(); }
    else if (d.dku !== undefined) dkInput();
  }

  function dkInput() {
    const { st } = dk, countField = dkq('[data-dkn]'), unitField = dkq('[data-dku]');
    if (!countField || !unitField) return;
    const count = Math.max(1, Math.min(DK_MAX_COUNT, Math.round(+countField.value) || 1));
    st.rep = `${count}:${unitField.value}`;
  }

  // Registered when this file loads, before anything else: the innermost pop-up.
  onEscape(dkClose);
  onWindowClose(dkClose);

  return { wrap: wrapDeadline, set: setDeadline, close: dkClose };
})();
