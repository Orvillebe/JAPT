/**
 * JAPT Calendar views - what every part of the calendar needs to know about the view on screen.
 *
 * Responsibilities:
 *   - The table of view modes: per mode what differs (VIEWS)
 *   - The days on screen
 *   - Periods as shown: their text with a hidden weekend, the periods in view, whether one is running
 *
 * Loads before the other calendar files and knows none of them, so they all depend on this one and
 * never the other way round.
 */

const CalendarViews = (() => {
  const M = Model, { View, MODE } = UI;
  const PERIODS_SHOWN = 4;       // periods side by side in the period view
  const DAYS_PER_WEEK = 7;
  const td = () => M.today();

  /* ---------- the view modes ---------- */

  function oneDay(date) { return [date]; }
  function wholeWeek(date) { return M.weekDays(date); }
  function workDays(date) { return M.weekDays(date).filter(day => !M.isWeekend(day)); }

  function stepByDays(count) { return (date, direction) => M.addDays(date, direction * count); }
  // The start of the neighbouring period, or null when there is none to go to.
  function stepByPeriod(date, direction) {
    const period = Store.periodAt(date);
    if (direction > 0) return period ? M.addDays(period.end, 1) : null;
    const previous = period && Store.periodAt(M.addDays(period.start, -1));
    return previous ? previous.start : null;
  }

  const SURFACE = Object.freeze({ WEEK: 'week', PERIOD: 'period', LIST: 'list' });

  // What differs per view mode. A new view is a row here, and a SURFACES row in calendar.js if it draws
  // somewhere new.
  //   days          the days it shows; period and list have no days of their own, the bar still uses these
  //   hidesWeekend  Saturday and Sunday are left out of a period's span too
  //   step          the date that previous (-1) or next (1) goes to, or null to stay
  //   cssClass      the class on #weekView; style.css shows and hides the parts of the page with it
  //   needsAgenda   whether meetings are fetched for its days
  //   swipes        whether a finger can move it to the previous or next one (phone)
  //   swipesAtEnds  the browser itself scrolls between the columns in view (style.css); a finger only
  //                 moves it on past the first or last column
  //   surface       the part of the page it draws in (SURFACES in calendar.js says with what)
  const VIEWS = {
    [MODE.DAY]: {
      days: oneDay, hidesWeekend: false, step: stepByDays(1),
      cssClass: 'daymode', needsAgenda: true, swipes: true, surface: SURFACE.WEEK
    },
    [MODE.WORKWEEK]: {
      days: workDays, hidesWeekend: true, step: stepByDays(DAYS_PER_WEEK),
      cssClass: 'wkmode', needsAgenda: true, swipes: true, surface: SURFACE.WEEK
    },
    [MODE.WEEK]: {
      days: wholeWeek, hidesWeekend: false, step: stepByDays(DAYS_PER_WEEK),
      cssClass: 'wkmode', needsAgenda: true, swipes: true, surface: SURFACE.WEEK
    },
    [MODE.PERIOD]: {
      days: workDays, hidesWeekend: false, step: stepByPeriod,
      cssClass: 'cymode', needsAgenda: false, swipes: false, swipesAtEnds: true, surface: SURFACE.PERIOD
    },
    [MODE.LIST]: {
      days: workDays, hidesWeekend: false, step: stepByDays(DAYS_PER_WEEK),
      cssClass: 'listmode', needsAgenda: false, swipes: false, surface: SURFACE.LIST
    }
  };
  // The view settings are read back from this device unchecked, so an unknown saved mode can occur.
  const currentView = () => VIEWS[View.mode] || VIEWS[MODE.WORKWEEK];
  const VIEW_CLASSES = [...new Set(Object.values(VIEWS).map(view => view.cssClass))];

  const calDays = () => currentView().days(View.date);

  /* ---------- periods as shown ---------- */

  const isRunning = period => td() >= period.start && td() <= period.end;
  const isHiddenDay = day => currentView().hidesWeekend && M.isWeekend(day);

  // In Werkweek, Saturday and Sunday are hidden: a period's span then starts and ends on a weekday.
  function spanText(period) {
    let first = period.start, last = period.end;
    while (first <= last && isHiddenDay(first)) first = M.addDays(first, 1);
    while (last >= first && isHiddenDay(last)) last = M.addDays(last, -1);
    if (first > last) { first = period.start; last = period.end; }
    return t('time.span', { a: UI.fmtSp(first), z: UI.fmtSp(last) });
  }
  // Whether the period goes on, before or after these days, on a day that is shown.
  function moreVisible(period, days, back) {
    const direction = back ? -1 : 1;
    let day = M.addDays(back ? days[0] : days[days.length - 1], direction);
    while (back ? day >= period.start : day <= period.end) {
      if (!isHiddenDay(day)) return true;
      day = M.addDays(day, direction);
    }
    return false;
  }
  // The period the calendar date is in, and the next ones.
  function periodWindow() {
    const periods = [];
    let period = Store.periodAt(View.date);
    while (period && periods.length < PERIODS_SHOWN) {
      periods.push(period);
      period = Store.periodAt(M.addDays(period.end, 1));
    }
    return periods;
  }
  const inPeriodWindow = key => periodWindow().some(period => period.key === key);
  const periodPlace = period => ({ period: period.key });

  const yearOf = date => date.slice(0, 4);
  const yearSuffix = date => (yearOf(date) === yearOf(td()) ? '' : ' ' + yearOf(date));

  return {
    SURFACE, currentView, viewClasses: VIEW_CLASSES, calDays,
    isRunning, spanText, moreVisible, periodWindow, inPeriodWindow, periodPlace, yearOf, yearSuffix
  };
})();
