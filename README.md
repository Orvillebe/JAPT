# JAPT - Just A Planning Tool

Weekly planning for a small agency team. Tasks hang under goals, goals under clients (or *Intern*). You collect tasks in the Inbox, give them a goal, and drag them into the team's standard work blocks or into a longer work period. Meetings from the team's kSuite agenda (its link is a setting in Beheer) show between the blocks. Static site, no build step.

**Status: design.** Nothing is built yet. What the user sees and does is in the interaction mockup [`docs/JAPT_userinteraction_mockup.html`](docs/JAPT_userinteraction_mockup.html) (open it in a browser). What the software stores and decides is in [`docs/design.md`](docs/design.md). This README is filled in as the app is built: setup, usage, configuration, privacy, troubleshooting and code structure, as in JAFT.

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

## License

**Assumption:** the same as JAFT (MIT with the Commons Clause). See `LICENSE` once the repository is set up.
