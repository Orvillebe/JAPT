# JAPT - Just A Planning Tool

Weekly planning for a small agency team. Tasks hang under goals, goals under clients (or *Intern*). You collect tasks in the Inbox (with photos in the note if you like), give them a goal, and drag them into the team's standard work blocks or into a longer work period. Meetings from the team's kSuite agenda (its link is a setting in Beheer) show between the blocks. Static site, no build step.

**Status: works against its own Supabase database, not live yet.** Everything in the mockup works, plus the Bin, the three looks, the agenda link, backup and analysis export, logins and teams. A test of the whole thing with a real mouse and phone is still to come.

What the user sees and does is in the interaction mockup [`docs/JAPT_userinteraction_mockup.html`](docs/JAPT_userinteraction_mockup.html). What the software stores and decides is in [`docs/design.md`](docs/design.md).

## Trying it locally

1. Start a small web server in this folder: `python3 -m http.server 8766`
2. Open `http://localhost:8766/tests/load-testdata.html` and click **Testdata laden**. The test data is built around today, so it never goes stale.
3. Open `http://localhost:8766/`.

Everything stays in this browser (localStorage), so trying things out can't touch the real database.

To work against the real database from your own computer, open `http://localhost:8766/?db=live` and log in. Without `?db=live` you are on the test data again.

## Installing it on your own database

JAPT is static files and a Supabase project. Someone else can run it on their own project with their own copy of this code; only `deployment.js` differs.

1. Make a Supabase project, in the EU if you are in the EU.
2. **Authentication > Sign In / Providers:** switch *Allow new users to sign up* off, keep *Confirm email* on.
3. **Authentication > URL Configuration:** set the Site URL to the address where JAPT will run. Links in invitation mails go there.
4. **Authentication > Users:** add your own login.
5. In the **SQL Editor**, run every file in `migrations/` once, in number order.
6. Change the team name in `tools/first-team.sql` and run it. Everyone who already has a login joins that team and gets access.
7. Fill in `deployment.js`: your address, the Project URL and the publishable key (Settings > API). Never the secret key.
8. Put the files online, on any host for static files.

**On an address that isn't in `deployment.js`, JAPT refuses to start**, so a forgotten address can't look as if it works while saving in one browser only.

**Adding someone:**

1. **Authentication > Users > Add user > Create new user:** their email and a password, with *Auto Confirm User* on.
2. **Table Editor > `members`:** a row for them is already there (named after their email before the @), because a new login joins the team by itself. Set `allowed` to true. Without it they can log in but see that they have no access.
3. **In JAPT, Beheer > Gebruikers:** their name and colour.
4. Give them the address and the password, not both in the same mail.

Not *Invite*: the invitation mail lets someone in once, but JAPT has no screen to choose a password yet, so they couldn't log in again. A password is changed in Supabase too, at the user. **Taking someone's access away:** `allowed` to false in `members`; their name stays on old tasks.

**Another backend than Supabase:** write one file for it, name it in `data-service.js`, `index.html` and `deployment.js`. `model.js`, the Store and the screens stay as they are. [`docs/data-layer.md`](docs/data-layer.md) says exactly what it must do, and `tests/contract.html` checks it.

## Restoring a backup

The free Supabase plan has no restorable backups, so the file from Beheer > Back-up is the safety net.

1. The migrations have run and the team exists (`tools/first-team.sql`). Logins are not in a backup: make them again first.
2. Open `tools/restore.html`, fill in the team and choose the file. It stays in your browser.
3. Paste the script in the **SQL Editor** and run it. The counts at the end should match the first lines of the script.

**With many photos** the script gets too large to paste (each photo is about 160 kB in it). Save it with *Bewaren als .sql* instead and run it from your own computer with `psql` and the connection string from Supabase (Connect > Session pooler), with the database password you keep:

```bash
psql "postgresql://postgres.<project>:<password>@<host>:5432/postgres" -f japt-restore.sql
```

By default the script only goes into an empty team, and otherwise stops without changing anything. **To put an older state back over a team that holds planning,** tick *Vervang wat nu in dit team staat*. Wiping and restoring then happen in one transaction: if anything fails, the team stays as it was. If it succeeds, everything made after the backup is gone, so make a backup of the current state first.

Someone from the backup is matched to someone in the team by login, or else by name. Without a match they come back without a login; link them in Table Editor > `members`. The agenda link comes back too, so keep a backup file as safe as the agenda itself.

## Updating

The app compares its database version with the database when it starts (`SCHEMA_VERSION` in `version.js`). An update with a new file in `migrations/` asks for this order: run the new migration first, then put the new files online. Until then the app says the database is out of date and saves nothing.

## Configuration

| File | For |
|---|---|
| `deployment.js` | What makes this installation this one: addresses, backend, Supabase project |
| `config.js` | Settings that change rarely, each with its reason: Bin days, reminder days, hours shown |
| Beheer, in the app | Work blocks, work period, first day of the week, people, the agenda link, the look (per device) |

## Privacy

- Your planning is stored in your own Supabase project. The agenda link is a setting in that database and is never in the code.
- Photos on tasks are stored in that same database, only readable by your team. They are made smaller in your browser first, which also leaves out what a camera writes into a photo, such as where it was taken.
- No telemetry and no analytics. Personal view settings (filters, folded lists, the look) stay on the device.
- The browser fetches the agenda straight from the agenda link, the fonts from Google Fonts, and two scripts from jsDelivr. Those scripts are pinned with an integrity hash, so a changed file is refused.
- Row Level Security in the database keeps teams apart; `tests/teams.test.js` proves it.
- The free Supabase plan has no restorable backups: make a backup in Beheer now and then.

## Troubleshooting

| You see | What it means |
|---|---|
| "JAPT is niet ingesteld voor het adres ..." | The address isn't in `productionHosts` in `deployment.js` |
| The database is out of date | A migration still has to run, in number order |
| You are logged in but have no access | Set `allowed` to true in Table Editor > `members` |
| Nothing changes after an update | Reload without the cache: Cmd+Shift+R |
| The project doesn't answer | The free plan pauses a project after about a week without use; resume it in Supabase |

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

```bash
node tests/restore.test.js
```

```bash
node tests/contract.test.js
```

```bash
node tests/supabase-layer.test.js
```

```bash
node tests/teams.test.js
```

The first tests the rules (dates, blocks, work periods, lists, deadlines, repeats, order, filters). The second tests saving on the local data layer: all or nothing, undo, the check on changes by someone else, and the rules that need more than one row. The third checks that every file in `index.html` carries the app version, that no line of code is over 140 characters, and that the escape test has a step for every calendar view and Beheer tab.

The fourth checks that a backup becomes a correct restore script. The fifth checks that the local data layer does what every data layer must do; `tests/contract.html?db=live` checks the same on the layer in `deployment.js`, from a browser where you are logged in. The sixth checks what the Supabase layer does with a request that hangs or gets no answer. The seventh runs against the real database and proves that one team can't reach another team's data: on every table and on the save function, a login of team A tries to read, add, change and delete what is team B's. It needs some setup first, see **Teams test** below.

**Escape test, in the browser:** open `http://localhost:8766/tests/escape.html` and click **Test starten**. It fills every text people can type with a piece of HTML, opens every screen, window, picker and tab (wide and phone-sized), and fails when that text ever becomes real HTML in the page instead of text. That would let a task title run as code for everyone who sees it. Your local data is put aside and put back. Run it before every release; a new screen or window needs a new step in `STEPS`.

**Teams test, against a real database:** run it after every new file in `migrations/` and before going live. The local version has no such rules, so this is the only proof that teams are kept apart.

It puts two test teams in the database it tests. Once JAPT is in real use, don't do that in the real database: give the test its own Supabase project. While the real database holds more than one team, a new login no longer joins the only team by itself.

1. Choose the database. For a separate one: make a new Supabase project and run every file in `migrations/` once, in number order.
2. In **Authentication > Users**, make two logins with **Auto Confirm**: `japt-test-a@example.com` and `japt-test-b@example.com`, with passwords of your choice.
3. In the **SQL Editor**, run `tools/teams-test-setup.sql` once.
4. Make `tests/teams-test.env`, which stays out of git. The last two lines only for a separate project; without them the test uses the database in `deployment.js`. The key is the publishable key, never the secret one.

   ```
   JAPT_TEST_A_PASSWORD=...
   JAPT_TEST_B_PASSWORD=...
   JAPT_TEST_SUPABASE_URL=https://....supabase.co
   JAPT_TEST_SUPABASE_KEY=...
   ```

5. Run `node tests/teams.test.js`. The first line says which database it tests. It removes its own test rows; the two teams and logins stay for the next run.
6. Used a database that is also for real work? Run `tools/teams-test-remove.sql` in the SQL Editor afterwards. It removes the two test teams and logins. On a separate project, leave them.

## Code structure

One file per task; each file starts with what it is responsible for.

| File | Does |
|---|---|
| `deployment.js` | What makes this installation this one: addresses, backend, Supabase project |
| `config.js`, `version.js` | Settings that change rarely; app and database version |
| `i18n/nl.js`, `i18n/i18n.js` | All interface text, by key |
| `model.js` | The rules as pure functions, without DOM or storage |
| `tables.js` | The names of the database tables, for the Store and every data layer |
| `data-service.js` | Picks the data layer; what each one must do is in `docs/data-layer.md` |
| `data-local.js`, `data-supabase.js` | Storage in this browser; storage in Supabase, and the login |
| `store.js` | Data in memory; every action as one save with its undo |
| `ui.js` | Shared pieces: cards, windows, the Escape key, toast |
| `filter-picker.js`, `goal-picker.js`, `deadline-picker.js` | The fold-out lists to choose filters, a goal, a deadline with its repeat |
| `figures.js` | The small figures that sometimes walk by when a task is checked off |
| `drag.js` | Dragging a task: one handler for the page, each screen registers its drop zones |
| `calendar-views.js` | The table of calendar views, the days on screen, periods as shown |
| `calendar.js` | Taken page, right: the bar, drawing, dropping, swiping |
| `calendar-week.js`, `calendar-period.js`, `calendar-list.js`, `calendar-card.js` | The day and week views, the work-period view, the list view, the open task card |
| `tasks.js` | Taken page, left: the task lists and the form |
| `goals.js`, `inbox.js` | Doelen, Inbox |
| `photos.js` | Photos on a task: the note field with its camera button, making a photo smaller, the row of photos, full screen |
| `manage.js` | The Beheer window: tabs and drawing |
| `manage-blocks.js`, `manage-period.js`, `manage-other.js` | The tabs Werkblokken and Werkperiode; the seven small tabs |
| `agenda.js`, `export.js` | Meetings from the agenda link; backup and analysis export |
| `app.js` | Starting, login, version check, pages, loading changes at natural moments and every 20 s in view |
| `icon.svg` | The icon: a month page with one day circled by hand, as in the Orville logo. `icon-192.png`, `icon-512.png` (Android) and `apple-touch-icon.png` (iPhone, square: iOS rounds it) are made from it with Chrome: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --window-size=512,512 --default-background-color=00000000 --screenshot=icon-512.png icon.svg` |
| `migrations/` | The database, one numbered file per change |
| `tools/` | `first-team.sql` for a new installation, `restore.html` to put a backup back, `teams-test-setup.sql` and `teams-test-remove.sql` for the teams test |

## Possible future

Not built, but prepared for. Each can be added without changing the data that exists by then. The details are in [`docs/design.md`](docs/design.md), section 8.

- **Red for tasks only planned in the past:** an open task that was planned only on days that have passed is marked like a task planned after its deadline. Now it simply stays *Ingepland*.
- **Your own name on a new task** by default. A new task now starts with nobody on it.
- **Individual work blocks:** each person their own blocks, and planning a task in your block puts your name on it. Designed in the comment at the top of the mockup's script.
- **One agenda per person** instead of one shared team agenda.
- **An installable app (PWA)**, so week views can open in landscape on a phone.
- **Adding to the Inbox without a connection:** new Inbox tasks wait on the phone and are sent once there is a connection. The first version is already built for it (ids made in the app, one save per Inbox task that can safely be sent twice); what's left is the queue and a service worker, built together with the installable app.
- **Sharing a photo to JAPT from an Android phone**, straight into a new Inbox task. Needs the installable app above and a small service worker. Not possible on iPhone.
- **Live updates** when a colleague changes something. The first version loads their changes when the app opens, when you come back to the tab, and when you move to another day or week.
- **Inviting someone from JAPT** instead of adding them in the database: an email address in Beheer > Gebruikers, the invitation mail, choosing a password in JAPT, and access switched on and off in Beheer.
- **A second interface language.**
- **More users: many small teams, not bigger teams.** The use case is an agency or a freelancer, and many of those, not the multinational. The database has a team on every row from the start, and teams are kept apart; signing up, creating teams from the app, inviting from the app and paying are not built.

## License

MIT with the Commons Clause: you may use, copy, change and share JAPT freely, but selling it (including a paid product or service built mainly on it) requires written permission from Orville. See `LICENSE`.
