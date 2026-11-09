# The data layer

JAPT talks to its storage through one object, `DataService`. Changing the storage means writing one file that offers the functions below. `model.js`, the Store and the screens stay as they are.

**To add a backend**

1. Write `data-<name>.js` with a function that returns the object described here.
2. Add it to `LAYERS` in `data-service.js`, and to `index.html`.
3. Set `backend: '<name>'` in `deployment.js`.
4. Open `tests/contract.html?db=live`. Every line must pass.

**What your backend must enforce itself**

A browser can be changed by whoever uses it, so nothing in it can protect data. Your backend must make sure that someone only reaches the data of their own team, that the rules in `migrations/` hold (fixed forms, unique names, references within one team), and that it fills in who and when itself. On Supabase that is `migrations/`, and `tests/teams.test.js` proves it. On another backend you write the equivalent.

## Data

All functions speak in the app's own terms: camelCase fields, and the table names in `tables.js`. How you store them is up to you.

- **Ids** are made in the app. They are text of letters, digits, `-` and `_`.
- **`changedAt`** is a version: the app only compares it for equality and sends it back. Every saved change must give it a new value.
- **Dates** are `'YYYY-MM-DD'`, times of day are minutes after midnight, moments are ISO text.
- **Empty values** are `null`.
- **Who and when:** `createdBy`, `createdAt`, `changedBy` and `changedAt` are filled in by you, on every save.
- **Rows** keep every field they were given. The fields per table are in `docs/design.md`, section 4; the less obvious ones are `start`, `end` (work_blocks), `date`, `partStart` (block_placements), `from` (period_segments).
- **The Bin:** a row in `clients`, `goals` or `tasks` with `deletedAt` is in the Bin.

## Functions

All are `async` unless noted.

| Function | Does |
|---|---|
| `needsLogin` | A boolean, not a function: whether there is a login |
| `signIn(email, password)` | Logs in; throws when that fails |
| `signOut()` | Logs out |
| `getSession()` | `{userId, email}`, or `null` when nobody is logged in |
| `hasAccess()` | Whether the person logged in may use this; also picks their team. Called before anything is loaded |
| `schemaVersion()` | The number of the last migration that has run, `0` for an empty database. Throws on anything else, such as no connection |
| `loadAll()` | `{table: rows}` for every table in `TABLES`: no rows in the Bin, and no rows in `TASK_TABLES` of a task in the Bin |
| `loadBin()` | `{clients, goals, tasks}` that are in the Bin |
| `batch(ops)` | See below |
| `purgeBin(beforeIso)` | Removes for good what went to the Bin before that moment, and what belongs to those tasks. A task not in the Bin and not done, whose goal is in the Bin, goes to the Inbox (`goalId` null, `stage` `'inbox'`) |
| `exportAll()` | `{table: rows}` with everything, also what is in the Bin, for the backup |
| `testMeetings()` | Meetings for testing without an agenda link; `[]` is fine |

## `batch(ops)`

Several changes, **all or nothing**: if one fails, none is saved.

```js
{ op: 'insert', table, row, ifNew? }              // ifNew: a row that exists is left alone, the result is null
{ op: 'update', table, id, fields, ifChangedAt? }
{ op: 'upsert', table, id, fields }               // adds the row when it doesn't exist
{ op: 'remove', table, id, ifChangedAt? }         // a row that doesn't exist is no error
```

Returns the stored rows in the same order, `null` for a removal.

**`ifChangedAt`:** when the row's `changedAt` is no longer this value, someone else changed it. Refuse the whole batch by throwing an error with `code: 'conflict'`. The screens depend on that exact code. An `update` of a row that doesn't exist throws too, with any other error.

A batch can add a row and refer to it in any order.
