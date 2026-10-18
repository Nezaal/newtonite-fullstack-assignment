# Newtonite Challenge — "Operations Under Pressure"

Internship take-home for Newtonite (Software Engineering, full-stack). Build an internal web app where teams create, assign, track and resolve operational work items.

- **Deadline:** submit Google Form by **Mon 19 Oct 2026, 10:00 AM IST**. Aim for **9:30 AM**.
- **Judged on:** engineering judgement, not feature count. A small system that behaves correctly beats a big half-done one.
- **After submission:** live demo + discussion. Must be able to explain or modify any line live.

## How to work with me (Nezaal)

- Keep explanations brief and in simple language. No jargon unless I ask.
- Don't guess or assume. Ask when something is unclear.
- Explain the reasoning behind each step, since I have to defend it in the interview.
- Prefer minimal changes when editing existing work.
- Commit after each phase (they want a clean commit history, not one giant commit).

## Stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (frontend + backend) | Type safety, fewer bugs |
| Backend | Node.js + Express | Familiar, fast to build |
| Database | PostgreSQL | Transactions, row locks, constraints, indexes, full-text search |
| ORM | Prisma | Migrations + type safety |
| Frontend | React (Vite) + TanStack Query | Separate API already exists, no SSR needed; TanStack gives caching, refetch, optimistic update rollback |
| Background jobs | Postgres outbox table + worker | Job saved in same transaction as the change; no extra system |
| Tests | Vitest (runner) + Supertest (HTTP requests to Express) | API-level tests on critical behaviour |
| Run | Docker Compose (app + Postgres) | One-command setup for reviewer |

**AWS:** not part of the build. Mention in docs as the "10× scale" answer (RDS + read replicas, SQS instead of outbox, ECS). Optional live link at the very end only: a single EC2 free-tier instance running the same `docker compose up`.

## Phase plan

| Phase | Work | Status |
|---|---|---|
| 1 | Open questions + assumptions | ✅ Done (below) |
| 2 | Design: tables, API, status flow, permissions | ✅ Done (below) |
| 3 | Project setup: repo, Docker Compose, Prisma migrations, seed (3–4 teams, ~10 users across roles, a few thousand items) | ⏭ Next |
| 4 | Login (JWT) + middleware loading team roles + one `can(user, action, item)` function used everywhere | |
| 5 | Work-item API + critical behaviours (filters, search, cursor pagination, version check, atomic claim, transitions, idempotency, activity log in same transaction) | |
| 6 | Frontend: login, dashboard, filtered list, item page with history + comments, actions, conflict messages, optimistic rollback | |
| 7 | Outbox worker: retries, backoff, max attempts, idempotent handler | |
| 8 | Tests for dangerous behaviours | |
| 9 | README, ENGINEERING_DECISIONS.md, known limitations, architecture diagram, fresh-clone check, demo video, submit form | |
| 10 | Interview prep | |

---

## Phase 1 — Assumptions

### Work item
1. **One entity** with a `type`: Incident, Customer Issue, Payment, Compliance, Task. All share the same basics; type is for filters and rules.
2. **Fields:** title, description, type, priority, status, team, assignee, created by, due date, version, timestamps.
3. **Priority:** Low, Medium, High, Urgent.
4. **Exactly one team** per item. Moving team is a Lead action and is logged.
5. **One assignee** (or none). Others help via comments. The brief's core problem is unclear ownership.

### Workflow
6. **Statuses:** Open → In Progress → Awaiting Approval → Resolved → Closed.
7. **Approval needed only for Payment and Compliance.** Other types go In Progress → Resolved directly.
8. **Rejection:** Awaiting Approval → In Progress, reason required.
9. **Reopen:** Resolved → In Progress allowed. **Closed is final.**
10. **No self-approval:** approver can't be the assignee.
11. **Who changes status:** the assignee or a Lead of that team.

### Roles and access
12. **Roles per team:** Viewer, Member, Lead. Plus one global **Admin** flag on the user.
13. **Powers:** Viewer = read + comment. Member = + create, claim unassigned, edit/move own items. Lead = + assign anyone, approve, change any priority, move team. Admin = everything.
14. **Other teams' items are invisible:** return **404** (not 403), so existence isn't revealed.
15. **Member can release their own item.** Giving it to someone else is Lead-only.

### Concurrency
16. **Two claims at once:** first wins, second gets **409** "already claimed by X".
17. **Outdated save:** rejected with **409** + latest data. No auto-merge.
18. **Double-click / retry:** **Idempotency-Key** header on create item and add comment. Keys kept 24h. Claim and transitions are already safe because they check the current state.
19. **Many updates at once:** each change = one DB transaction + version check.

### History
20. **Logged:** create, status, assignee, priority, team, field edits, comments.
21. **History is add-only.** Never edited or deleted.
22. **Comments can't be edited/deleted** in v1.

### Users, notifications, dashboard
23. **No sign-up.** Seeded users, email + password login, JWT.
24. **Notify when:** assigned to you, needs your approval, your item was rejected.
25. **Delivery:** in-app notification list, created by the background worker. No email.
26. **Dashboard views:** Assigned to me, Unassigned urgent, Awaiting my approval, Overdue.
27. **Search/filter:** text search on title + description; filter by team, status, priority, type, assignee; 25 per page; server-side only.
28. **Live updates:** refetch on tab focus + every ~30s on dashboard. No websockets.

### Not building in v1
Email, file attachments, SSO, sign-up / user admin screens, websockets, comment edits, custom roles.

---

## Phase 2 — Design

### Tables (keep fields simple)

```
users            id, name, email, password_hash, is_admin, created_at
teams            id, name
memberships      user_id, team_id, role (VIEWER | MEMBER | LEAD)        -- PK (user_id, team_id)
work_items       id, team_id, title, description, type, priority, status,
                 assignee_id (nullable), created_by, due_date (nullable),
                 version (int, starts at 1, +1 on every change), created_at, updated_at
comments         id, item_id, user_id, body, created_at
activity_events  id, item_id, user_id, action, old_value, new_value, note, created_at   -- add-only
idempotency_keys user_id, key, response, created_at                     -- PK (user_id, key)
outbox_jobs      id, type, payload, status (PENDING | DONE | FAILED), attempts,
                 last_error, run_after, created_at
notifications    id, user_id, item_id, job_id (UNIQUE), message, is_read, created_at
```

- `activity_events.note` holds things like a rejection reason.
- `notifications.job_id` is unique, so a job processed twice can't create two notifications.

**Indexes:**
- `work_items`: (team_id, status), (assignee_id, status), (team_id, updated_at, id), full-text on title + description
- `activity_events`: (item_id, created_at)

### API

| Endpoint | Purpose | Rule |
|---|---|---|
| `POST /auth/login` | Log in, get token | |
| `GET /me` | My info + teams + roles | |
| `GET /dashboard` | Counts for the 4 views | |
| `GET /items` | List: filters, `q`, `view=`, `cursor=`, `limit` | Only my teams' items |
| `POST /items` | Create | Idempotency-Key |
| `GET /items/:id` | Detail | 404 if not my team |
| `PATCH /items/:id` | Edit title, description, priority, due date, team | Requires `version` |
| `POST /items/:id/claim` | Take unassigned item | Conditional update: only if no assignee |
| `POST /items/:id/release` | Give up my item | |
| `POST /items/:id/assign` | Lead assigns someone | Requires `version` |
| `POST /items/:id/transition` | Change status (incl. approve/reject) | Requires `version`; allowed-moves check |
| `GET /items/:id/activity` | History, paginated | |
| `GET /items/:id/comments`, `POST /items/:id/comments` | Comments | Idempotency-Key on POST |
| `GET /teams/:id/members` | Assign dropdown | |
| `GET /notifications`, `POST /notifications/:id/read` | My notifications | |

- **Cursor pagination**, not page numbers: page numbers get slow on big tables and skip/repeat rows when data changes.
- **Separate claim / assign / transition endpoints**: each action has its own rules and permissions in one clear place.

### Status flow

```
Open ──(transition, needs assignee)──► In Progress ◄──────────────┐
  ▲                                     │       │                 │
  └──────────── release ────────────────┘       │ Payment /       │ reject (Lead, reason required)
                                                │ Compliance      │
                                    other types ▼                 │
                                        │   Awaiting Approval ────┘
                                        │       │ approve (Lead/Admin, not the assignee)
                                        ▼       ▼
                                        Resolved ──► Closed (final)
                                           └── reopen ──► In Progress
```

- **Claim and assign only set the owner.** Status changes happen through `/transition`.
- **Release** removes the owner; if the item is In Progress it goes back to Open.

| From → To | Who | Rule |
|---|---|---|
| Open → In Progress | Assignee or Lead | Must have an assignee |
| In Progress → Open | Assignee or Lead | Via release; owner removed |
| In Progress → Awaiting Approval | Assignee or Lead | Payment / Compliance only |
| In Progress → Resolved | Assignee or Lead | Other types only |
| Awaiting Approval → Resolved | Lead / Admin | Not the assignee |
| Awaiting Approval → In Progress | Lead / Admin | Reason required |
| Resolved → In Progress | Assignee or Lead | Reopen |
| Resolved → Closed | Assignee or Lead | Final |

Any other move → rejected by the server.

### Permissions ("own" = assigned to you)

| Action | Viewer | Member | Lead | Admin |
|---|---|---|---|---|
| See team items | ✅ | ✅ | ✅ | ✅ |
| Comment | ✅ | ✅ | ✅ | ✅ |
| Create item | ❌ | ✅ | ✅ | ✅ |
| Claim unassigned | ❌ | ✅ | ✅ | ✅ |
| Release | ❌ | Own | ✅ | ✅ |
| Edit fields / priority | ❌ | Own | ✅ | ✅ |
| Change status | ❌ | Own | ✅ | ✅ |
| Assign to someone else | ❌ | ❌ | ✅ | ✅ |
| Approve / reject | ❌ | ❌ | ✅ (not own) | ✅ (not own) |
| Move item to another team | ❌ | ❌ | ✅ | ✅ |

**Enforcement:** one function `can(user, action, item)` called by every endpoint, using the user's role **in that item's team**. UI hiding is convenience only.

---

## Critical behaviours (must work + be tested)

| Situation | How | Test |
|---|---|---|
| Two users claim same item | `UPDATE work_items SET assignee_id=? WHERE id=? AND assignee_id IS NULL`; 0 rows → 409 | Fire two claims in parallel; exactly one succeeds |
| Stale edit | Client sends `version`; update `WHERE version = ?`, then +1; mismatch → 409 + latest item | Old version rejected, data unchanged |
| Duplicate request | `Idempotency-Key` header; store key + response; repeat returns stored response | Same key twice → one item, same response |
| Workflow rules | Allowed-transitions map on server; approval only by Lead of that team, not the assignee | Open → Closed rejected; non-Lead approval rejected; self-approval rejected |
| Resource-level auth | Every query and action scoped to user's teams + role via `can()` | Outsider gets 404 on read and write |
| Reliable async | Outbox row written in same transaction; worker retries with backoff, caps attempts, handler idempotent | Job processed twice → one notification; failing job retries then marked FAILED |
| Optimistic UI | Update UI immediately; roll back + show server reason on 409/403 | Optional |

**Every change writes its activity event in the same DB transaction**, so history can never disagree with the item.

---

## Deliverables checklist

**Repo** (`newtonite-ops-<rollno>`): clean commit history, `docker-compose.yml`, seed data with demo users per role, no secrets committed, `.env.example`.

**README:** what the app does (3–4 lines), prerequisites, exact run commands, demo logins per role, how to run tests, known limitations, architecture diagram (Mermaid).

**ENGINEERING_DECISIONS.md** (~5 decisions; each: context, options, choice, trade-off):
1. PostgreSQL over MongoDB: transactions, row locks, relations. Trade-off: migrations.
2. Version number for stale edits (optimistic locking) instead of locking items while editing. Trade-off: users sometimes see "item changed, reload".
3. Roles per team, checked on server via one `can()` function. Trade-off: fixed roles less flexible than custom permissions.
4. Activity log in same transaction as the change. Trade-off: table grows, needs indexes + pagination.
5. Sync main actions, async notifications via Postgres outbox. Trade-off: a few seconds' delay; jobs may run twice, so handlers must be idempotent.
6. (Optional) What we chose not to build.

**Tests:** all pass with one command.

**Optional:** demo video (3–5 min), "next week I would…" list, live link.

## Interview prep (Phase 10)

- Architecture in 60s: browser → API → Postgres → worker.
- What happens when things fail: DB down, worker crashes mid-job, network retry, two users colliding.
- Which assumptions to check with a product manager first.
- Most important part of the system and why.
- At 10× scale: read replicas, partition activity table, search engine, dedicated queue (SQS), websockets.
- Next week's work.
- Be ready to modify live, e.g. "add a new status", "let Leads reassign items".

## Common mistakes to avoid

- Plain CRUD with no concurrency / idempotency / auth logic.
- Permissions checked only in the frontend.
- Loading all items into the browser.
- Updating the item and writing history in separate steps.
- Tests that only check "page loads".
- README that doesn't work on a fresh machine.
- AI-generated code I can't explain.
