# JAPT - Just A Planning Tool

Weekly planning for a small agency team. Tasks hang under goals, goals under clients (or *Intern*). You collect tasks in the Inbox, give them a goal, and drag them into the team's standard work blocks or into a longer work period. Meetings from the team's kSuite agenda (its link is a setting in Beheer) show between the blocks. Static site, no build step.

**Status: first local version.** Everything in the mockup works on local test data in your browser, plus the Bin, the three looks, the agenda link, backup and analysis export. Not built yet: the Supabase data layer and database migrations (the live address says so instead of falling back to local data), restoring a backup into the database, and the full README sections (setup, privacy, troubleshooting).

What the user sees and does is in the interaction mockup [`docs/JAPT_userinteraction_mockup.html`](docs/JAPT_userinteraction_mockup.html). What the software stores and decides is in [`docs/design.md`](docs/design.md).

## Trying it locally

1. Start a small web server in this folder: `python3 -m http.server 8766`
2. Open `http://localhost:8766/tests/load-testdata.html` and click **Testdata laden**. The test data is built around today, so it never goes stale.
3. Open `http://localhost:8766/`.

Everything stays in this browser (localStorage). The real database is only used on the live address (`productionHosts` in `config.js`).

## Tests

```bash
node tests/model.test.js
```

```bash
node tests/store.test.js
```

```bash
node tests/release.test.js
```

The first tests the rules (dates, blocks, work periods, lists, deadlines, repeats, order, filters). The second tests saving on the local data layer: all or nothing, undo, the check on changes by someone else, and the rules that need more than one row. The third checks that every file in `index.html` carries the app version, that no line of code is over 140 characters, and that the escape test has a step for every calendar view and Beheer tab.

**Escape test, in the browser:** open `http://localhost:8766/tests/escape.html` and click **Test starten**. It fills every text people can type with a piece of HTML, opens every screen, window, picker and tab (wide and phone-sized), and fails when that text ever becomes real HTML in the page instead of text. That would let a task title run as code for everyone who sees it. Your local data is put aside and put back. Run it before every release; a new screen or window needs a new step in `STEPS`.

## Code structure

One file per task; each file starts with what it is responsible for.

| File | Does |
|---|---|
| `config.js`, `version.js` | Settings that change rarely; app and database version |
| `i18n/nl.js`, `i18n/i18n.js` | All interface text, by key |
| `model.js` | The rules as pure functions, without DOM or storage |
| `tables.js` | The names of the database tables, for the Store and every data layer |
| `data-local.js`, `data-service.js` | Storage in this browser; picking the data layer |
| `store.js` | Data in memory; every action as one save with its undo |
| `ui.js` | Shared pieces: cards, windows, the Escape key, pickers, toast |
| `figures.js` | The small figures that sometimes walk by when a task is checked off |
| `drag.js` | Dragging a task: one handler for the page, each screen registers its drop zones |
| `calendar.js`, `tasks.js` | Taken page: calendar views; the task lists and form |
| `goals.js`, `inbox.js`, `manage.js` | Doelen, Inbox, Beheer |
| `agenda.js`, `export.js` | Meetings from the agenda link; backup and analysis export |
| `app.js` | Starting, version check, pages, reloading at natural moments |

## Possible future

Not built, but prepared for. Each can be added without changing the data that exists by then. The details are in [`docs/design.md`](docs/design.md), section 8.

- **Red for tasks only planned in the past:** an open task that was planned only on days that have passed is marked like a task planned after its deadline. Now it simply stays *Ingepland*.
- **Your own name on a new task** by default. A new task now starts with nobody on it.
- **Individual work blocks:** each person their own blocks, and planning a task in your block puts your name on it. Designed in the comment at the top of the mockup's script.
- **One agenda per person** instead of one shared team agenda.
- **An installable app (PWA)**, so week views can open in landscape on a phone.
- **Adding to the Inbox without a connection:** new Inbox tasks wait on the phone and are sent once there is a connection. The first version is already built for it (ids made in the app, one save per Inbox task that can safely be sent twice); what's left is the queue and a service worker, built together with the installable app.
- **Live updates** when a colleague changes something. The first version loads their changes when the app opens, when you come back to the tab, and when you move to another day or week.
- **A second interface language.**
- **More users: many small teams, not bigger teams.** The use case is an agency or a freelancer, and many of those, not the multinational. The database has a team on every row from the start, and teams are kept apart; signing up, creating teams and paying are not built.

## License

**Assumption:** the same as JAFT (MIT with the Commons Clause). See `LICENSE` once the repository is set up.
