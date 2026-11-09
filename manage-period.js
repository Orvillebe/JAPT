/**
 * JAPT Manage, tab Werkperiode - setting up the work period.
 *
 * Responsibilities:
 *   - Drawing the form to set up a period, or to change it from the next period
 *   - The tab's clicks and changes: making, changing, switching off and on
 *
 * Holds no state of its own. The window (manage.js) calls start() once with what every tab needs.
 * The rules are in docs/design.md (Work period).
 */

const ManagePeriod = (() => {
  const M = Model, { $, html } = UI;

  const DAYS_PER_WEEK = 7;
  const UNIT = Object.freeze({ MONTHS: 'm', DAYS: 'd' });   // how a period's length is stored
  const PERIOD_MIN_LENGTH = 1, PERIOD_MAX_LENGTH = 60;      // in the unit chosen in the form
  const PERIOD_DEFAULT_WEEKS = 2;     // what a new period starts from
  const PERIOD_FIELDS = ['mCyN', 'mCyU', 'mCyStart'];

  // What every tab gets from the window, once, in start().
  let done, showErr, body, sectionHead;
  function start(shell) { ({ done, showErr, body, sectionHead } = shell); }

  const td = () => M.today();

  /* ---------- tab: work period ---------- */

  const inWeeks = sg => sg.unit !== UNIT.MONTHS && sg.length % DAYS_PER_WEEK === 0;
  const inDays = sg => sg.unit !== UNIT.MONTHS && sg.length % DAYS_PER_WEEK !== 0;
  const lengthInUnit = sg => (inWeeks(sg) ? sg.length / DAYS_PER_WEEK : sg.length);

  const unitOption = (value, chosen, label) => `<option value="${value}" ${chosen ? 'selected' : ''}>${label}</option>`;
  const unitSelect = sg => html`
    <select id="mCyU" aria-label="${t('period.unit')}">
      ${unitOption(DAYS_PER_WEEK, inWeeks(sg), t('unit.w'))}
      ${unitOption(1, inDays(sg), t('unit.d'))}
      ${unitOption(UNIT.MONTHS, sg.unit === UNIT.MONTHS, t('unit.m'))}
    </select>`;

  const periodLengthField = (number, sg) => html`
    <label class="f mdl">
      <span class="fl">${t('period.length')}</span>
      <span class="mlen">
        <input type="number" id="mCyN" min="${PERIOD_MIN_LENGTH}" max="${PERIOD_MAX_LENGTH}" step="1" value="${number}">
        ${unitSelect(sg)}
      </span>
    </label>`;
  const periodStartField = (labelKey, value) => html`
    <label class="f mdl">
      <span class="fl">${t(labelKey)}</span>
      <input type="date" id="mCyStart" value="${value}">
    </label>`;

  const periodSetupForm = () => html`
    ${periodLengthField(PERIOD_DEFAULT_WEEKS, { length: PERIOD_DEFAULT_WEEKS * DAYS_PER_WEEK })}
    ${periodStartField('period.first_from', M.weekFirst(td()))}
    <button type="button" class="primary" data-cymake>${t('period.make')}</button>`;

  const periodButtons = on => (on
    ? html`
      <button type="button" class="primary" data-cysave disabled>${t('period.confirm')}</button>
      <button type="button" data-cytoggle>${t('period.off')}</button>`
    : `<button type="button" class="primary" data-cytoggle>${t('period.on')}</button>`);

  function periodChangeForm() {
    const segs = Store.segments(), last = segs[segs.length - 1], on = Store.periodActive();
    const started = !(segs.length === 1 && last.from > td());
    const startKey = started ? 'period.next_from' : 'period.first_from';
    const startValue = started ? M.nextPeriodStart(segs) : last.from;
    return html`
      ${on ? '' : `<p class="mstate">${t('period.off_state')}</p>`}
      ${periodLengthField(lengthInUnit(last), last)}
      ${periodStartField(startKey, startValue)}
      ${started && on ? `<p class="mhint">${t('period.change_hint')}</p>` : ''}
      <div class="mact">${periodButtons(on)}</div>
      ${on ? `<p class="mhint">${t('period.off_hint')}</p>` : ''}`;
  }

  const cyclesTab = () => sectionHead('period.title', t('period.hint'))
    + (Store.periodSetUp() ? periodChangeForm() : periodSetupForm());

  /* ---------- clicks and changes: work period ---------- */

  function periodForm() {
    const entered = Math.round(+$('mCyN').value) || PERIOD_MIN_LENGTH;
    const n = Math.max(PERIOD_MIN_LENGTH, Math.min(PERIOD_MAX_LENGTH, entered)), unit = $('mCyU').value;
    return unit === UNIT.MONTHS ? { length: n, unit: UNIT.MONTHS } : { length: n * +unit, unit: UNIT.DAYS };
  }
  // Saves what is filled in with this Store action. When it can't be saved nothing is redrawn, so what
  // you typed stays.
  async function saveForm(storeAction) {
    const { length, unit } = periodForm(), from = $('mCyStart').value;
    const bad = Store.periodProblems(from);
    if (bad) { showErr(t(Object.values(bad)[0])); return; }
    if ((await UI.act(() => storeAction(from, length, unit))) !== null) done();
  }
  async function makePeriod() {
    const { length, unit } = periodForm();
    const saved = await UI.act(() => Store.setupPeriod($('mCyStart').value || td(), length, unit));
    if (saved !== null) done();
  }
  const savePeriod = () => saveForm(Store.changePeriod);
  async function togglePeriod() {
    // Switching on also takes what you just filled in.
    if (!Store.periodActive()) { await saveForm(Store.switchPeriodOn); return; }
    const back = await UI.act(() => Store.switchPeriodOff());
    if (back === null) return;
    done();
    if (back) UI.toast(UI.tn('toast.back_to_open', back));
  }
  function enablePeriodSave() {
    const b = body().querySelector('[data-cysave]');
    if (b) b.disabled = false;
  }

  // These fields only wake up the save button: the window keeps its question and message.
  function changeQuiet(field) {
    if (!PERIOD_FIELDS.includes(field.id)) return false;
    enablePeriodSave();
    return true;
  }

  // Selector -> what a click on it does. The first match wins, in this order.
  const CLICKS = [
    ['[data-cymake]', makePeriod],
    ['[data-cysave]', savePeriod],
    ['[data-cytoggle]', togglePeriod]
  ];

  return { start, draw: cyclesTab, clicks: CLICKS, changeQuiet };
})();
