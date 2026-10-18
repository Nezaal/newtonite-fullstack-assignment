# Engineering decisions

The choices that matter most, each with the context, the options, what I chose, and what it costs.
Code references are to files in this repo.

---

## 1. PostgreSQL instead of MongoDB

**Context.** Work items have owners, teams, history and notifications that must agree with each other. Several
rules depend on "check, then change" being one indivisible step (two people claiming, stale edits).

**Options.**
- MongoDB: flexible documents, easy to start.
- PostgreSQL: relations, transactions, row locks, constraints, indexes, built-in full-text search.

**Choice.** PostgreSQL with Prisma.

**Why.**
- The claim is one statement, `UPDATE ... WHERE assignee_id IS NULL`, and the database decides the winner.
- One transaction can write the item, its history row, an outbox job and an idempotency key together.
- Unique constraints are the last line of defence (`notifications.job_id`, `idempotency_keys(user_id, key)`).
- Full-text search needs no extra system (a GIN index in the first migration).

**Trade-off.** Schema changes need migrations, and I used raw SQL for two things Prisma cannot express: the list
query with search (`items/queries.ts`) and the job-taking query with `FOR UPDATE SKIP LOCKED`
(`outbox/processor.ts`). Raw SQL is parameterised, but it is outside Prisma's type checking.

---

## 2. A version number for stale edits, instead of locking items

**Context.** Two people can open the same item. The second to save must not silently overwrite the first.

**Options.**
- Lock the item while someone edits: simple to explain, but locks get stuck when a tab is closed, and the app
  needs timeouts and "break the lock" logic.
- Last write wins: no blocking, but data is lost without anyone noticing.
- Version number (optimistic locking): no locks, conflicts are detected.

**Choice.** Every item has `version`, starting at 1 and going up by 1 on every change. Edit, assign and status
change must send the `version` they saw. The update is `UPDATE ... WHERE id = ? AND version = ?`. If no row
matches, the server answers `409` with the latest item. There is no automatic merge.

**Why two checks.** The code first compares versions (a cheap early answer), and the `WHERE version = ?` in the
update is the real guard against two requests that both read before either writes. `tests/race.test.ts` forces
exactly that interleaving; with the `WHERE` condition removed, 4 of its 5 tests fail.

**Frontend detail.** The edit form remembers the version it *started from*. The page refreshes in the
background, so using the version on screen would quietly overwrite someone else's change. The user chooses
"use the latest values" or "keep my edits".

**Trade-off.** Users sometimes see "someone else changed this item" and must retry. For claim, there is no
version: the conflict is "already owned", which is checked by the update's own condition.

---

## 3. Roles per team, enforced by one `can()` function

**Context.** People work in several teams with different powers (Viewer, Member, Lead), plus a global Admin.
Permissions checked in many places drift apart; permissions checked only in the browser are no permissions.

**Options.**
- Roles on the user: simple, but cannot say "Lead in Payments, Viewer in Operations".
- Custom permission sets per user: flexible, but heavy to build and to reason about.
- Fixed roles per team and one function.

**Choice.** `memberships(user, team, role)` and `can(user, action, item)` in `permissions/can.ts`, called by every
endpoint. The role is read from the database on every request, so a change takes effect at once.
Admin counts as Lead in every team. Nobody can approve their own item, not even an Admin.

**Hidden, not forbidden.** Items from other teams return `404`, the same answer as for an item that does not
exist, so nobody can learn which items exist. `403` is only used when you can see the item but may not do the
thing. Lists and counts are filtered with the same rules (`items/filters.ts`).

**The `actions` and `transitions` in an item response** tell the UI what to show, computed with the same
`can()`. The server still re-checks every request.

**Trade-off.** Fixed roles are less flexible than custom permissions. Reading the user's roles on every request
costs one small query.

---

## 4. History is written in the same transaction as the change

**Context.** The history must never disagree with the item: no change without a history row, no history row for
a change that did not happen.

**Options.** Write history afterwards (can be lost if the process dies in between), use a database trigger
(hidden from the code, harder to attach "who"), or write it in the same transaction.

**Choice.** Every mutation runs in `prisma.$transaction` and calls `logActivity(tx, ...)` with the same `tx`
(`items/activity.ts`). `activity_events` is add-only; nothing updates or deletes it.
`tests/claim.test.ts` makes the history insert fail on purpose and checks that the claim is undone.

**Trade-off.** The table only grows. It has an index on `(item_id, created_at)` and is read with cursor paging.
At large scale it would be partitioned or archived.

---

## 5. Main actions are synchronous; notifications go through a Postgres outbox

**Context.** Notifying people is secondary. A failing notification must not fail or slow the main action, but a
committed change must never lose its notification.

**Options.** Send inside the request (slow, and fails the action), push to a queue like SQS after the commit
(the commit can succeed and the push fail, so a notification is lost), or write a job row in the same
transaction and let a worker handle it.

**Choice.** The transaction that changes an item also inserts rows into `outbox_jobs`. A separate worker takes jobs
with `FOR UPDATE SKIP LOCKED` (so two workers never take the same job) and a lease (so a job taken by a worker
that then crashes reappears after 30 seconds). Failures retry with waits of 2s, 4s, 8s, 16s and the job becomes
`FAILED` after 5 attempts. A job that keeps crashing its worker is also given up on.

**Safe to run twice.** Delivery is at-least-once, so the handler must be idempotent: `notifications.job_id` is
unique, a second insert is refused by the database, and the handler treats that as "already done".
One job means one recipient means one notification.

**Idempotency keys** for create item and add comment use the same idea: the key is saved in the same transaction
as the work, so either both exist or neither does. Two identical requests at the same moment are settled by the
primary key; the loser's work is rolled back and it returns the winner's response. Keys older than 24 hours are
ignored and deleted by the worker.

**Trade-off.** Notifications can arrive a few seconds late, and a job can run more than once. Both are handled
by design rather than hidden. At 10x scale this table becomes SQS.

---

## 6. Things I chose not to build (and why)

- **Websockets.** The page refetches on tab focus and every 30 seconds. Simple and robust; costs up to 30 s of delay.
- **Email, attachments, SSO, sign-up and user admin screens, comment editing, custom roles.** Not needed to show
  the core behaviours, and each adds surface area to test.
- **Offset pagination.** Cursor paging on `(updated_at, id)` stays fast on big tables and does not repeat or skip
  rows when data changes between pages (`tests/list.test.ts` checks this).
- **A compiled production build.** The containers run TypeScript through `tsx`. Fewer moving parts for the reviewer;
  slower startup and a larger image.

---

## What happens when things fail

| Situation | What happens |
|---|---|
| Two users claim the same item | The database lets one `UPDATE` match. The other gets `409 ALREADY_CLAIMED` naming the owner. The UI rolls back its optimistic update and shows the reason |
| Someone saves an outdated copy | `409 VERSION_CONFLICT` with the latest item; nothing is changed; the UI shows the latest version |
| Browser retries or double click | Same `Idempotency-Key`: one item or comment, same response with `Idempotent-Replayed: true` |
| The API dies halfway through a request | The transaction rolls back: no half change, no orphan history row or job |
| The database is down | `/health` returns 503, requests return a generic 500 (details only in the server log), the worker logs and retries |
| The worker crashes during a job | The lease runs out, another run takes the job; the handler is safe to repeat |
| A job keeps failing | Retried with growing waits, then `FAILED` with `last_error` kept for inspection |
| Someone asks for an item in another team | `404`, identical to a missing item |
| Token expired or tampered | `401`; the app sends the user back to the login page |

## What I would confirm with a product manager first

- Should approval notifications also reach Admins, and what if a team has only one Lead?
- Can a Lead approve an item they created (as opposed to one assigned to them)?
- Should comments change the item's "last updated" time and the version?
- Should a Viewer be able to comment? (I assumed yes.)
- Should closed items ever be reopened by an Admin? (I assumed no: Closed is final.)
- What should happen to open items when someone leaves a team?

## Next week

Mark-all-read and notification paging, an integration test that drives the UI (Playwright), email delivery
through the same outbox, a compiled production image, per-key request hashing for idempotency,
and a read replica for the dashboard counts.
