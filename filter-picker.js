/**
 * JAPT filter pickers - the fold-out lists that filter the tasks (shared by the sidebar and the list view).
 *
 * Responsibilities:
 *   - Drawing a picker with the current choice; its list is made when it opens and removed when it closes
 *   - Keeping the choices in View.filter, and dropping choices for things that no longer exist
 *   - Saying whether a task passes the filters and how many filters are on
 */

const FilterPicker = (() => {
  const M = Model;
  const { $, esc, html, View, NO_FILTER, byClient, pstyle, goalDot, onEscape } = UI;

  // A filter is a fold-out list with checkboxes, in the same look as the pickers in the forms. Only one
  // is open at a time; its list exists only while it is open.
  let msOpen = null;                 // id of the open picker
  const msShown = new Map();         // id -> {elId, key}: where each picker is drawn, to draw it again
  const MS = {
    who: {
      all: 'filter.everyone',
      kind: 'chips',
      opts: () => [
        ...Store.members().map(u => ({ v: u.id, t: u.name, who: u.id })),
        { v: 'none', t: t('filter.nobody'), who: null }
      ]
    },
    goal: {
      all: 'filter.all_goals',
      kind: 'rows',
      opts: () => byClient(Store.openGoals()).flatMap(x => [
        { head: x.name },
        ...x.goals.map(g => ({ v: g.id, t: g.name, dot: g }))
      ])
    },
    client: {
      all: 'filter.all_clients',
      kind: 'rows',
      opts: () => [
        ...Store.clients().map(c => ({ v: c.id, t: c.name })),
        { v: 'intern', t: t('client.intern') }
      ]
    }
  };

  const choices = key => MS[key].opts().filter(o => !o.head);

  function msBox(key, option) {
    const checked = View.filter[key].includes(option.v) ? 'checked' : '';
    return `<input type="checkbox" data-msk="${key}" value="${esc(option.v)}" ${checked}>`;
  }

  // "Nobody" is not a person, so it has no colour of its own.
  function msChip(key, option) {
    const colours = option.who != null ? pstyle(option.who) : '--pc:var(--grey-d);--pcl:var(--grey-b)';
    return `<label class="mswho" style="${colours}">${msBox(key, option)}<span>${esc(option.t)}</span></label>`;
  }

  function msRow(key, option) {
    if (option.head) return `<div class="gph">${esc(option.head)}</div>`;
    const dot = option.dot ? goalDot(option.dot) : '';
    return `<label class="msr">${dot}<span class="gpt">${esc(option.t)}</span>${msBox(key, option)}</label>`;
  }

  function msList(key) {
    const m = MS[key];
    const drawOption = m.kind === 'chips' ? msChip : msRow;
    const body = m.opts().map(option => drawOption(key, option)).join('');
    return html`
      <div class="msbk"></div>
      <div class="msb ${m.kind}">${body || `<div class="none-msg">${t('filter.nothing')}</div>`}</div>`;
  }

  function msRender(elId, key, host) {
    const id = host + '-' + key, sel = View.filter[key], open = msOpen === id;
    msShown.set(id, { elId, key });
    const names = choices(key).filter(o => sel.includes(o.v)).map(o => o.t);
    const label = names.length ? esc(names.join(', ')) : t(MS[key].all);
    $(elId).innerHTML = html`
      <div class="ms ${open ? 'open' : ''}" data-msid="${id}">
        <button type="button" class="mss ${names.length ? 'on' : ''}" aria-expanded="${open}">${label}</button>
        ${open ? msList(key) : ''}
      </div>`;
  }

  function msRedraw(id) {
    const shown = msShown.get(id);
    if (shown && $(shown.elId)) msRender(shown.elId, shown.key, id.split('-')[0]);
  }

  function msClose() {
    if (!msOpen) return false;
    const id = msOpen;
    msOpen = null;
    msRedraw(id);
    return true;
  }

  function msToggle(id) {
    const wasOpen = msOpen === id;
    msClose();
    if (!wasOpen) {
      msOpen = id;
      msRedraw(id);
    }
  }

  const clearFilter = () => {
    View.filter = NO_FILTER();
    View.save();
  };

  // A filter on something that no longer exists (an achieved or deleted goal, a removed person, a
  // deleted client) is dropped. App.render calls this once before drawing.
  function pruneFilter() {
    let changed = false;
    for (const key of Object.keys(MS)) {
      const ok = choices(key).map(o => o.v), keep = View.filter[key].filter(v => ok.includes(v));
      if (keep.length !== View.filter[key].length) {
        View.filter[key] = keep;
        changed = true;
      }
    }
    if (changed) View.save();
  }

  function onFilterClick(e) {
    if (e.target.closest('.msbk')) { msClose(); return; }
    const button = e.target.closest('.ms > .mss');
    if (button) { msToggle(button.parentElement.dataset.msid); return; }
    if (!e.target.closest('.ms')) msClose();
  }

  function applyFilterBox(box) {
    const values = View.filter[box.dataset.msk], i = values.indexOf(box.value);
    if (box.checked && i < 0) values.push(box.value);
    else if (!box.checked && i >= 0) values.splice(i, 1);
  }

  function initFilters(onChange) {
    document.addEventListener('click', onFilterClick);
    onEscape(msClose);
    document.addEventListener('change', e => {
      const box = e.target.closest('input[data-msk]');
      if (!box) return;
      applyFilterBox(box);
      View.save();
      onChange();
    });
  }

  const passes = k => M.passes(k, View.filter, Store.goal, Store.whoOf);
  const filterCount = () => M.filterCount(View.filter);

  return {
    render: msRender, close: msClose, init: initFilters, passes,
    count: filterCount, clear: clearFilter, prune: pruneFilter
  };
})();
