# Engineering decisions

These are the choices I would explain first if you asked "why did you build it this way?"
Each one says what the problem was, what I considered, what I picked, and what it costs.

---

## 1. PostgreSQL, not MongoDB

**The problem.** A work item, its owner, its history and its notifications all have to agree with each other.
Several rules also depend on "check, then change" happening as one step (like two people claiming the same item).

**Options.** MongoDB is easy to start with. PostgreSQL gives me transactions, row locks, constraints and
built-in search.

**I picked PostgreSQL (with Prisma).** For example, a claim is a single statement, "set the owner, but only if
nobody owns it yet", and the database decides who wins. One transaction can also save the item, its history,
a background job and an idempotency key together. Search needs no extra service.

**The cost.** Changing the tables means writing migrations. And in two places I wrote raw SQL because Prisma
can't express it (the search list, and the worker picking jobs). It's parameterised, but Prisma isn't checking its types.

---

## 2. A version number for stale edits, instead of locking

**The problem.** Two people open the same item. The second one to save must not quietly erase the first one's change.

**Options.** Lock the item while someone edits (locks get stuck when a tab is closed). Let the last save win
(changes get lost silently). Or use a version number.

**I picked the version number.** Every item has a `version` that goes up by 1 on every change. Editing, assigning
and changing status all send the version the user saw. The database only updates the row if that version is
still the current one. If not, the server answers `409` with the latest item. There is no automatic merging.

I check the version twice. The first check is an early, cheap answer. The second one, inside the update itself,
is the one that really protects us when two requests arrive at the same moment. I wrote a test that forces
that exact situation, and it fails if I remove the second check.

The edit form also remembers the version it *started* from. The page refreshes in the background, so without
this, saving would send the newer version and overwrite someone else's change without any warning.

**The cost.** People sometimes see "someone else changed this" and have to retry. That's the price of not locking.

---

## 3. Roles per team, checked in one place

**The problem.** One person can be a Lead in Payments and only a Viewer in Operations. If permission checks are
scattered around, they drift apart. If they're only in the browser, they aren't real.

**Options.** One role per user (too simple). Custom permissions per user (too heavy). Fixed roles per team.

**I picked fixed roles per team and a single `can(user, action, item)` function.** Every endpoint calls it.
The roles are read from the database on every request, so a change applies immediately. An Admin counts as a
Lead in every team. Nobody can approve their own item, not even an Admin.

Items from other teams return `404`, the same as an item that doesn't exist, so nobody can find out what exists.
`403` is only for "you can see it, but you can't do that".

**The cost.** Fixed roles are less flexible than custom permissions, and there's one small extra query per request.

---

## 4. History is saved in the same transaction as the change

**The problem.** The history must never disagree with the item. No change without a history row, and no history
row for a change that didn't happen.

**Options.** Write the history afterwards (lost if the server dies in between), use a database trigger (hidden,
and it doesn't know who did it), or write it in the same transaction.

**I picked the same transaction.** If anything fails, the change and its history are undone together. I tested
this by making the history insert fail on purpose and checking that the claim was rolled back. History rows are
only ever added, never edited or deleted.

**The cost.** The table only grows. It has an index and is read page by page. At a much larger scale I'd split or
archive it.

---

## 5. Notifications go through an outbox, not straight from the request

**The problem.** Notifying people is secondary. A broken notification must not break the main action, but once a
change is saved, its notification must not get lost.

**Options.** Send it during the request (slow, and it can fail the action). Push to a queue after saving (the save
can succeed and the push fail, so the notification is lost). Or save a "job" row in the same transaction and let a
separate worker handle it.

**I picked the job table and a worker.** The job is saved together with the change, so they stand or fall together.
The worker takes jobs so that two workers never get the same one. If a worker crashes mid-job, the job comes back
after 30 seconds. A failing job is retried with longer and longer waits (2s, 4s, 8s, 16s) and is marked `FAILED`
after 5 tries.

Because a job can run twice, the handler is safe to repeat: the notifications table has a unique `job_id`, so a
second insert is refused and treated as "already done".

I used the same idea for the duplicate-request key on "create item" and "add comment". The key is saved in the same
transaction as the work, so both exist or neither does. If two identical requests arrive together, the database
lets one win and the other returns the winner's answer. Keys older than 24 hours are ignored and cleaned up.

**The cost.** A notification can arrive a few seconds late, and a job can run more than once (handled, as above).
At a much bigger scale this table would become a real queue like SQS.

---

## What I chose not to build

- **Websockets.** The page refreshes when you come back to the tab and every 30 seconds. Simpler, but up to 30 seconds behind.
- **Email, file uploads, SSO, sign-up and user screens, editing comments, custom roles.** Not needed to show the
  core behaviour, and each one adds more to test.
- **Page numbers.** I used cursor paging, which stays fast on big tables and doesn't repeat or skip rows when
  data changes between pages.
- **A compiled production build.** The containers run the TypeScript with `tsx`. Fewer moving parts, slower start.

## When things go wrong

| What happens | What the system does |
|---|---|
| Two people claim the same item | One wins. The other gets `409` naming the owner, and the screen rolls back and shows why |
| Someone saves an old copy | `409` with the latest item. Nothing changes |
| Double click or browser retry | Same key, so one item or comment and the same answer back |
| The server dies mid-request | The transaction rolls back. No half-done change |
| The database is down | `/health` reports it, users get a plain error, details stay in the server log |
| The worker crashes mid-job | The job comes back after the lease ends and is safely repeated |
| A job keeps failing | Retried with longer waits, then `FAILED` with the error saved |
| Someone asks for another team's item | `404`, same as a missing one |
| Token expired or fake | `401`, and the app goes back to the login page |

## What I would check with a product manager first

- Should Admins also be told when approval is needed? What if a team has only one Lead?
- Can a Lead approve an item they created, as opposed to one assigned to them?
- Should a comment change the item's "last updated" time?
- Can a Viewer comment? (I assumed yes.)
- Can an Admin ever reopen a Closed item? (I assumed no.)
- What should happen to someone's open items when they leave a team?

## Next week

Mark-all-read for notifications, UI tests with Playwright, email through the same outbox, a compiled production
image, and checking that a reused idempotency key has the same request body.
