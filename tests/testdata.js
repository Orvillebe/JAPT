/**
 * JAPT test data - a believable history to test with, never part of the app or the real database.
 *
 * Built around today (the Monday of this week is "week 0"), so it never goes stale:
 *   - two users, three clients (one with a long name), goals incl. one achieved and one grey
 *   - about forty tasks: long titles, deadlines (due soon, late, far away), a repeating task,
 *     tasks in several blocks, done tasks in past weeks, a full block, an empty week
 *   - work blocks that changed three weeks ago (the past keeps the old ones)
 *   - a work period of two weeks, with tasks in it
 *   - meetings, and an Inbox with a few unsorted tasks
 * Loaded by tests/load-testdata.html into the local version only.
 */

function createTestData(M) {
  const today = M.today(), w0 = M.addDays(today, -((M.weekday(today) + 6) % 7));   // Monday of this week
  const D = (week, dow) => M.addDays(w0, week * 7 + dow);                            // dow: 0 = Monday
  const iso = (ds, h = 9) => ds + `T${String(h).padStart(2, '0')}:00:00.000Z`;
  let n = 0; const id = p => `${p}-${String(++n).padStart(3, '0')}`;
  const meta = (ds = D(-6, 0)) => ({ createdAt: iso(ds), createdBy: 'u1', changedAt: iso(ds), changedBy: 'u1' });

  const members = [
    { id: 'u1', name: 'An', color: '#cf6a52', allowed: true, removedAt: null, ...meta() },
    { id: 'u2', name: 'Vincent', color: '#4f80bd', allowed: true, removedAt: null, ...meta() },
    // the local user, so whoever tests is also a member
    { id: 'local-user', name: 'Lokaal', color: '#4f9d6b', allowed: true, removedAt: null, ...meta() }
  ];
  const clients = [
    { id: 'c1', name: 'Klant A', ...meta() },
    { id: 'c2', name: 'Klant B', ...meta() },
    { id: 'c3', name: 'Stichting voor Circulaire Bouwmaterialen Vlaanderen', ...meta() }
  ];
  const G = (gid, name, clientId, hue, extra = {}) => ({ id: gid, name, note: '', clientId, hue, achievedOn: null, ...meta(), ...extra });
  const goals = [
    G('g1', 'Concept goedgekeurd krijgen', 'c1', 8, { note: 'Klant kiest één van de twee richtingen na de bespreking van donderdag.' }),
    G('g2', 'Nieuwe klant binnenhalen', null, 32),
    G('g3', 'Zichtbaarheid vergroten', null, 55),
    G('g4', 'Studio draaiend houden', null, -1),
    G('g5', 'Prototype opleveren', 'c2', 185, { note: 'Werkend prototype dat de klant zelf kan uitproberen.' }),
    G('g6', 'Nieuwe website live', null, 208, { achievedOn: D(-2, 4) }),
    G('g7', 'Materialenpaspoort voor alle gebouwen in de portefeuille uitwerken en laten valideren', 'c3', 325)
  ];

  const tasks = [], task_members = [], block_placements = [], period_placements = [];
  let pos = 0;
  function T(title, goalId, { who = [], stage = 'open', done = null, deadline = null, repeat = null, note = '' } = {}) {
    const tid = id('t');
    tasks.push({ id: tid, title, note, goalId, stage, doneOn: done, deadline, repeat, nextTaskId: null, position: (pos += 1024), ...meta() });
    who.forEach(m => task_members.push({ id: id('tm'), taskId: tid, memberId: m, ...meta() }));
    return tid;
  }

  // Blocks: the old standard week ended three weeks ago; the new one started then.
  const changed = D(-3, 0);
  const blocks = [];
  const B = (day, s, e, label = '', from = changed, to = null) => {
    const bid = id('b'); blocks.push({ id: bid, day, start: s * 60, end: e * 60, label, validFrom: from, validTo: to, ...meta(D(-6, 0)) }); return bid;
  };
  // old week (until the change): mornings only
  [1, 2, 3, 4, 5].forEach(d => B(d, 9, 12, '', D(-8, 0), M.addDays(changed, -1)));
  // current week
  const BL = {
    1: [B(1, 10, 12.5), B(1, 13.5, 17)],
    2: [B(2, 9, 12.5), B(2, 15, 17.5)],
    3: [B(3, 9, 12.5), B(3, 13.5, 15, 'Klantwerk'), B(3, 16, 17.5)],
    4: [B(4, 10, 12.5), B(4, 13.5, 17)],
    5: [B(5, 9, 12.5), B(5, 13.5, 16)]
  };
  const oldBlock = d => blocks.find(b => b.day === d && b.validTo);
  const P = (tid, week, dow, slot = 0) => {
    const date = D(week, dow), wd = M.weekday(date);
    const bid = date < changed ? oldBlock(wd).id : BL[wd][slot];
    block_placements.push({ id: id('bp'), taskId: tid, date, blockId: bid, position: (pos += 1024), ...meta() });
  };

  // this week, from the mockup
  const t1 = T('Mockup richting A', 'g1', { who: ['u2'], note: 'Eerste richting uitwerken als schets en mockup, klaar om te bespreken.' });
  const t2 = T('Mockup richting B', 'g1', { who: ['u2'], note: 'Tweede richting met een andere aanpak, zodat er iets te kiezen valt.' });
  const t3 = T('Offerte opstellen', 'g2', { who: ['u1'], note: 'Offerte met scope, planning en prijs.', deadline: D(0, 4) });
  const t4 = T('LinkedIn-post schrijven', 'g3', { who: ['u1'], note: 'Wekelijkse post schrijven op basis van een ruwe notitie.', deadline: D(0, 3), repeat: '1:w' });
  T('Prospectielijst nalopen', 'g2', { stage: 'backlog', note: 'Lijst met bedrijven doorlopen en prioriteren.' });
  const t6 = T('Mails beantwoorden', 'g4', { who: ['u1'], note: 'Inbox leegmaken en openstaande vragen beantwoorden.' });
  const t7 = T('Prototype testen', 'g5', { who: ['u1', 'u2'], note: 'Prototype uitproberen en bevindingen noteren.', deadline: D(0, 1) });
  T('Websiteteksten nalezen', 'g3', { stage: 'backlog', note: 'Teksten op de site nalopen op fouten en verouderde info.', deadline: D(1, 2) });
  const t9 = T('Factuur versturen', 'g4', { who: ['u1'], done: D(0, 0), note: 'Openstaande factuur klaarzetten en versturen.' });
  T('Werkplaats opruimen', 'g4', { note: 'Een interne taak.' });
  P(t3, 0, 0, 0); P(t6, 0, 0, 0); P(t3, 0, 1, 0); P(t1, 0, 2, 0); P(t2, 0, 2, 0); P(t7, 0, 2, 1); P(t9, 0, 0, 1);
  P(t4, 0, 3, 0);
  // a full block on Thursday
  ['Moodboard', 'Kleurpalet kiezen', 'Typografie vastleggen', 'Iconen schetsen', 'Presentatie opbouwen', 'Feedbackronde verwerken']
    .forEach(title => P(T(title, 'g1', { who: ['u2'] }), 0, 3, 1));
  // the long goal, with long titles
  const tl = T('Inventaris opmaken van alle bouwmaterialen in het eerste gebouw, inclusief herkomst en hergebruikmogelijkheden', 'g7', { who: ['u1', 'u2'], deadline: D(3, 4) });
  P(tl, 1, 1, 0); P(tl, 1, 3, 0);
  T('Validatieprotocol afstemmen met de externe auditor', 'g7', { stage: 'backlog', deadline: D(6, 4) });
  T('Template materialenpaspoort', 'g7', { who: ['u1'] });
  // late: planned after its deadline
  const late = T('Demo voorbereiden', 'g5', { who: ['u2'], deadline: D(0, 3) });
  P(late, 1, 0, 0);
  // next week and the week after
  P(T('Gebruikerstest plannen', 'g5', { who: ['u1'] }), 1, 2, 0);
  P(T('Nieuwsbrief opmaken', 'g3', { who: ['u1'] }), 1, 4, 1);
  // past weeks: done work, one open task only planned in the past
  for (let w = -5; w <= -1; w++) {
    P(T(`Weekplanning week ${w + 6}`, 'g4', { who: ['u1', 'u2'], done: D(w, 0) }), w, 0);
    P(T(`Klantcall voorbereiden (${w + 6})`, 'g1', { who: ['u2'], done: D(w, 2) }), w, 2);
    P(T(`Social media inplannen (${w + 6})`, 'g3', { who: ['u1'], done: D(w, 3) }), w, 3);
  }
  P(T('Website live zetten', 'g6', { who: ['u2'], done: D(-2, 4) }), -2, 4);
  P(T('Domeinnaam verhuizen', 'g6', { who: ['u1'], done: D(-3, 1) }), -3, 1);
  P(T('Oude contracten archiveren', 'g4', { who: ['u1'] }), -1, 1);   // open, only planned in the past
  // a repeating task done last month: its next one is in the backlog
  T('BTW-aangifte', 'g4', { who: ['u1'], stage: 'backlog', deadline: D(5, 2), repeat: '3:m' });
  // more open and backlog tasks
  ['Portfolio bijwerken', 'Case study schrijven', 'Spreekbeurt indienen'].forEach(x => T(x, 'g3', { stage: 'backlog' }));
  ['Lead opvolgen: architectenbureau', 'Kennismaking plannen'].forEach(x => T(x, 'g2', { who: ['u1'] }));
  T('Feedback klant verwerken in prototype', 'g5', { who: ['u2'], deadline: M.addDays(today, 3) });

  // work period: two weeks from the Monday of last week
  const period_segments = [{ id: 'ps-1', from: D(-1, 0), length: 14, unit: 'd', ...meta() }];
  const per = M.periodIn(today, period_segments);
  const inPer = T('Strategie volgend kwartaal', 'g4', { who: ['u1', 'u2'] });
  const inPer2 = T('Offerte Klant B nakijken', 'g5', {});
  [inPer, inPer2].forEach(tid => period_placements.push({ id: id('pp'), taskId: tid, periodStart: per.start, position: (pos += 1024), ...meta() }));

  // the Inbox
  ['Offerte maken', 'Prospectielijst checken', 'Foto’s van prototype maken', 'Nieuwe printfilament bestellen'].forEach(x => T(x, null, { stage: 'inbox' }));

  // meetings (locally instead of an agenda link)
  const MT = (week, dow, s, e, title) => ({ id: id('m'), date: D(week, dow), start: s * 60, end: e * 60, title });
  const test_meetings = [];
  for (let w = -2; w <= 3; w++) test_meetings.push(MT(w, 0, 9, 10, 'Teamoverleg'));
  test_meetings.push(MT(0, 1, 14, 15, 'Klantgesprek'), MT(0, 2, 15, 16, 'Sparring'), MT(0, 3, 8, 9, 'Kwartaalcheck'), MT(0, 4, 16, 17, 'Weekafsluiting'), MT(1, 2, 12.5, 13.5, 'Lunch met Klant A'));

  const app_settings = [
    { id: 'weekStart', value: 1, ...meta() },
    { id: 'deadlineDays', value: 7, ...meta() },
    { id: 'periodActive', value: true, ...meta() }
  ];

  return {
    schemaVersion: 1,
    data: { members, clients, goals, tasks, task_members, work_blocks: blocks, block_placements, period_segments, period_placements, calendars: [], app_settings, test_meetings }
  };
}

if (typeof module !== 'undefined') module.exports = createTestData;
