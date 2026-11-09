/**
 * JAPT Agenda - meetings from the team's agenda, read-only.
 *
 * Responsibilities:
 *   - Reading the agenda link from Beheer (a kSuite ICS link) straight from the browser; kSuite allows
 *     that (access-control-allow-origin: *, checked 7 November 2026, docs/design.md, Meetings)
 *   - Turning repeating meetings into dates for the days on screen (ical.js), in local time
 *   - Keeping the result in memory for agendaMinutes (config.js); nothing is stored
 *   - Locally without a link: the meetings from the test data
 *   - When it fails: no meetings and a quiet note in the calendar bar; the reason in the console
 *
 * Whole-day items (holidays, birthdays) are left out: the calendar shows hours, and they would cover
 * the work blocks. Assumption, see docs/design.md.
 */

const Agenda = (() => {
  const M = Model;
  let source = null;        // {url, at, events} or {local, list}
  let loading = null, failedFlag = false;
  let win = null, byDay = new Map();   // the expanded window: {from, to}, date -> meetings

  const failed = () => failedFlag;
  function reset() { source = null; win = null; byDay = new Map(); failedFlag = false; }

  const on = ds => byDay.get(ds) || [];

  // Make sure the meetings for these days are known; draws again once they are.
  function ensure(days) {
    if (!days.length) return;
    const url = Store.calendarUrl(), from = days[0], to = days[days.length - 1];
    const notOld = () => Date.now() - source.at < JAPT_CONFIG.agendaMinutes * 60000;
    const fresh = source && (source.local ? !url : source.url === url && notOld());
    if (fresh) { if (!win || from < win.from || to > win.to) expand(from, to); return; }
    if (loading) return;
    loading = (url ? readLink(url) : readLocal())
      .then(() => { expand(from, to); App.renderWhenFree(); })
      .finally(() => { loading = null; });
  }

  async function readLocal() {
    let list = [];
    try { list = DataService.testMeetings ? await DataService.testMeetings() : []; } catch (e) { console.error(e); }
    source = { local: true, list }; failedFlag = false;
  }
  async function readLink(url) {
    try {
      if (typeof ICAL === 'undefined') throw new Error('ical.js did not load');
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const comp = new ICAL.Component(ICAL.parse(await res.text()));
      comp.getAllSubcomponents('vtimezone').forEach(tz => ICAL.TimezoneService.register(tz));
      const vevents = comp.getAllSubcomponents('vevent'), events = [], exceptions = [];
      vevents.forEach(v => {
        const ev = new ICAL.Event(v);
        (ev.isRecurrenceException() ? exceptions : events).push(ev);
      });
      // a moved or cancelled single meeting of a series belongs to that series
      exceptions.forEach(x => {
        const s = events.find(e => e.uid === x.uid);
        if (s) s.relateException(x); else events.push(x);
      });
      source = { url, at: Date.now(), events }; failedFlag = false;
    } catch (e) {
      console.warn('Agenda not reachable', e);
      source = { url, at: Date.now(), events: [] }; failedFlag = true;
    }
  }

  // Expand around the asked days (four weeks back, eight ahead), so moving a week is instant.
  function expand(from, to) {
    win = { from: M.addDays(from, -28), to: M.addDays(to, 56) };
    byDay = new Map();
    const put = m => { if (!byDay.has(m.date)) byDay.set(m.date, []); byDay.get(m.date).push(m); };
    if (source.local) source.list.filter(m => m.date >= win.from && m.date <= win.to).forEach(put);
    else for (const ev of source.events) {
      try { occurrences(ev, win).forEach(put); } catch (e) { console.warn('Meeting skipped', ev.summary, e); }
    }
    byDay.forEach(v => v.sort((a, b) => a.start - b.start));
  }
  const toMeeting = (title, s, e) => {
    const date = M.localDs(s), end = M.localDs(e) === date ? e.getHours() * 60 + e.getMinutes() : 24 * 60;
    const start = s.getHours() * 60 + s.getMinutes();
    return { date, start, end: Math.max(end, start + 15), title: title || '' };
  };
  function occurrences(ev, w) {
    if (ev.startDate.isDate) return [];   // whole-day items stay out
    const out = [], lo = new Date(w.from + 'T00:00:00'), hi = new Date(M.addDays(w.to, 1) + 'T00:00:00');
    if (!ev.isRecurring()) {
      const s = ev.startDate.toJSDate(), e = ev.endDate.toJSDate();
      if (s >= lo && s < hi) out.push(toMeeting(ev.summary, s, e));
      return out;
    }
    const it = ev.iterator();
    for (let next = it.next(), n = 0; next && n < 5000; next = it.next(), n++) {
      const d = ev.getOccurrenceDetails(next), s = d.startDate.toJSDate();
      if (s >= hi) break;
      const cancelled = d.item.getFirstPropertyValue('status') === 'CANCELLED';
      if (s >= lo && !cancelled) out.push(toMeeting(d.item.summary, s, d.endDate.toJSDate()));
    }
    return out;
  }

  return { ensure, on, failed, reset };
})();
