import type { ItemType, Priority, Status } from "../generated/prisma/enums";

export interface TeamPeople {
  readonly teamId: number;
  // Can create items and be assigned (MEMBER or LEAD)
  readonly workers: readonly number[];
  // Can approve (LEAD of the team)
  readonly leads: readonly number[];
  // Everyone who can comment (all roles)
  readonly everyone: readonly number[];
}

interface ItemRow {
  id: number;
  teamId: number;
  title: string;
  description: string;
  type: ItemType;
  priority: Priority;
  status: Status;
  assigneeId: number | null;
  createdById: number;
  dueDate: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface EventRow {
  itemId: number;
  userId: number;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
}

interface CommentRow {
  itemId: number;
  userId: number;
  body: string;
  createdAt: Date;
}

export interface SeedItems {
  readonly items: readonly ItemRow[];
  readonly events: readonly EventRow[];
  readonly comments: readonly CommentRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const TYPES_BY_TEAM: Readonly<Record<string, readonly ItemType[]>> = {
  Operations: ["INCIDENT", "TASK", "TASK"],
  Payments: ["PAYMENT", "PAYMENT", "INCIDENT", "TASK"],
  Compliance: ["COMPLIANCE", "COMPLIANCE", "TASK"],
  "Customer Support": ["CUSTOMER_ISSUE", "CUSTOMER_ISSUE", "INCIDENT", "TASK"],
};

const SUBJECTS: Readonly<Record<ItemType, readonly string[]>> = {
  INCIDENT: ["Database latency spike", "API gateway 5xx errors", "Login service outage", "Queue backlog growing", "Disk almost full"],
  CUSTOMER_ISSUE: ["Customer cannot reset password", "Invoice shows wrong amount", "Order stuck in processing", "Duplicate email notifications", "Account locked after login"],
  PAYMENT: ["Refund not received", "Payout delayed", "Card charged twice", "Chargeback review", "Settlement mismatch"],
  COMPLIANCE: ["KYC document expired", "Audit evidence missing", "Policy review overdue", "Data retention check", "Sanctions screening alert"],
  TASK: ["Update runbook", "Review access list", "Clean up old tickets", "Prepare weekly report", "Test backup restore"],
};

const SUFFIXES = ["(EU region)", "(US region)", "(APAC region)", "for premium accounts", "for new accounts", "after last release", "reported by support", "found in monitoring", "raised by finance", "flagged by audit"];

const COMMENT_BODIES = [
  "Looking into this now.",
  "Can someone share more details?",
  "I think this is related to the last release.",
  "Waiting on the customer to reply.",
  "Fix is ready, needs a review.",
  "Escalating, this is blocking others.",
  "Checked the logs, nothing unusual yet.",
  "Thanks, closing the loop on this.",
];

const PRIORITY_WEIGHTS: readonly (readonly [Priority, number])[] = [["LOW", 25], ["MEDIUM", 40], ["HIGH", 25], ["URGENT", 10]];

// Small deterministic random generator, so every seed run builds the same data.
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)];
}

function pickWeighted<T>(random: () => number, weighted: readonly (readonly [T, number])[]): T {
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return weighted[weighted.length - 1][0];
}

// The path an item walks through to reach its final status.
function statusPath(type: ItemType, finalStatus: Status): readonly Status[] {
  const needsApproval = type === "PAYMENT" || type === "COMPLIANCE";
  const full: readonly Status[] = needsApproval
    ? ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL", "RESOLVED", "CLOSED"]
    : ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
  return full.slice(0, full.indexOf(finalStatus) + 1);
}

function buildItem(
  random: () => number,
  id: number,
  teamName: string,
  people: TeamPeople,
  adminId: number,
  now: Date,
): { item: ItemRow; events: EventRow[]; comments: CommentRow[] } {
  const type = pick(random, TYPES_BY_TEAM[teamName]);
  const needsApproval = type === "PAYMENT" || type === "COMPLIANCE";
  const statusWeights: readonly (readonly [Status, number])[] = [
    ["OPEN", 30], ["IN_PROGRESS", 30], ["AWAITING_APPROVAL", needsApproval ? 10 : 0], ["RESOLVED", 15], ["CLOSED", 15],
  ];
  const status = pickWeighted(random, statusWeights);
  const path = statusPath(type, status);

  const createdById = pick(random, people.workers);
  const assigneeId = status === "OPEN" ? null : pick(random, people.workers);
  const createdAt = new Date(now.getTime() - random() * 90 * DAY_MS);
  const subject = pick(random, SUBJECTS[type]);
  const title = `${subject} ${pick(random, SUFFIXES)}`;

  // Event times move forward from createdAt towards now.
  const steps = (assigneeId === null ? 0 : 1) + (path.length - 1);
  const timeAt = (step: number) => new Date(createdAt.getTime() + ((now.getTime() - createdAt.getTime()) * (step + random() * 0.5)) / (steps + 1));

  const events: EventRow[] = [
    { itemId: id, userId: createdById, action: "created", oldValue: null, newValue: "OPEN", createdAt },
  ];
  let step = 0;
  if (assigneeId !== null) {
    step += 1;
    events.push({ itemId: id, userId: assigneeId, action: "assigned", oldValue: null, newValue: String(assigneeId), createdAt: timeAt(step) });
  }
  for (let i = 1; i < path.length; i++) {
    step += 1;
    // Approval step: a Lead who is not the assignee, or the admin.
    const approvers = [...people.leads.filter((lead) => lead !== assigneeId), adminId];
    const isApproval = path[i - 1] === "AWAITING_APPROVAL";
    const userId = isApproval ? pick(random, approvers) : (assigneeId as number);
    events.push({ itemId: id, userId, action: "status_changed", oldValue: path[i - 1], newValue: path[i], createdAt: timeAt(step) });
  }

  const commentCount = random() < 0.25 ? 1 + Math.floor(random() * 3) : 0;
  const comments: CommentRow[] = Array.from({ length: commentCount }, () => ({
    itemId: id,
    userId: pick(random, people.everyone),
    body: pick(random, COMMENT_BODIES),
    createdAt: new Date(createdAt.getTime() + random() * (now.getTime() - createdAt.getTime())),
  }));
  const commentEvents: EventRow[] = comments.map((c) => ({
    itemId: id, userId: c.userId, action: "commented", oldValue: null, newValue: null, createdAt: c.createdAt,
  }));

  const item: ItemRow = {
    id,
    teamId: people.teamId,
    title,
    description: `${subject}. ${pick(random, COMMENT_BODIES)} Please follow the team runbook.`,
    type,
    priority: pickWeighted(random, PRIORITY_WEIGHTS),
    status,
    assigneeId,
    createdById,
    dueDate: random() < 0.65 ? new Date(now.getTime() + (random() * 45 - 15) * DAY_MS) : null,
    // Starts at 1, +1 for every change after creation (comments don't change the item).
    version: events.length,
    createdAt,
    updatedAt: events[events.length - 1].createdAt,
  };
  return { item, events: [...events, ...commentEvents], comments };
}

export function buildSeedItems(
  count: number,
  teams: ReadonlyMap<string, TeamPeople>,
  adminId: number,
  now: Date,
): SeedItems {
  const random = makeRandom(42);
  const teamNames = [...teams.keys()];
  const built = Array.from({ length: count }, (_, index) => {
    const teamName = teamNames[index % teamNames.length];
    return buildItem(random, index + 1, teamName, teams.get(teamName)!, adminId, now);
  });
  return {
    items: built.map((b) => b.item),
    events: built.flatMap((b) => b.events),
    comments: built.flatMap((b) => b.comments),
  };
}
