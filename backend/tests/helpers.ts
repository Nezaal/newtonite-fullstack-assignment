import bcrypt from "bcryptjs";
import request from "supertest";
import type { ItemType, Priority, Role, Status } from "../generated/prisma/enums";
import { createApp } from "../src/app";
import { signToken } from "../src/auth/jwt";
import { prisma } from "../src/db";

export const app = createApp();

// Safety: tests wipe tables, so refuse to run on anything that is not the test database.
function assertTestDatabase(): void {
  const name = new URL(process.env.DATABASE_URL ?? "").pathname.replace("/", "");
  if (!name.endsWith("_test")) throw new Error(`Refusing to wipe database "${name}": not a test database`);
}

export async function resetDb(): Promise<void> {
  assertTestDatabase();
  await prisma.$executeRawUnsafe(
    `TRUNCATE notifications, outbox_jobs, idempotency_keys, activity_events, comments, work_items, memberships, teams, users RESTART IDENTITY CASCADE`,
  );
}

export const PASSWORD = "Password123!";

export interface Fixture {
  teamA: number;
  teamB: number;
  admin: number;
  leadA: number;
  lead2A: number;
  memberA: number;
  member2A: number;
  viewerA: number;
  leadB: number;
  memberB: number;
}

// Two teams. A has two Leads, two Members and a Viewer. B has one Lead and one Member.
export async function seedFixture(): Promise<Fixture> {
  const passwordHash = await bcrypt.hash(PASSWORD, 4); // low cost: tests should be fast
  const makeUser = async (name: string, isAdmin = false) =>
    (await prisma.user.create({ data: { name, email: `${name.toLowerCase().replace(/\s/g, ".")}@test.com`, passwordHash, isAdmin } })).id;

  const teamA = (await prisma.team.create({ data: { name: "Alpha" } })).id;
  const teamB = (await prisma.team.create({ data: { name: "Beta" } })).id;
  const f: Fixture = {
    teamA,
    teamB,
    admin: await makeUser("Admin User", true),
    leadA: await makeUser("Lead A"),
    lead2A: await makeUser("Lead Two A"),
    memberA: await makeUser("Member A"),
    member2A: await makeUser("Member Two A"),
    viewerA: await makeUser("Viewer A"),
    leadB: await makeUser("Lead B"),
    memberB: await makeUser("Member B"),
  };
  const roles: [number, number, Role][] = [
    [f.leadA, teamA, "LEAD"],
    [f.lead2A, teamA, "LEAD"],
    [f.memberA, teamA, "MEMBER"],
    [f.member2A, teamA, "MEMBER"],
    [f.viewerA, teamA, "VIEWER"],
    [f.leadB, teamB, "LEAD"],
    [f.memberB, teamB, "MEMBER"],
  ];
  await prisma.membership.createMany({ data: roles.map(([userId, teamId, role]) => ({ userId, teamId, role })) });
  return f;
}

export interface ItemOptions {
  teamId: number;
  createdById: number;
  title?: string;
  description?: string;
  type?: ItemType;
  priority?: Priority;
  status?: Status;
  assigneeId?: number | null;
  dueDate?: Date | null;
  updatedAt?: Date;
}

// Inserts an item directly (fast setup that skips the API).
export async function makeItem(o: ItemOptions) {
  return prisma.workItem.create({
    data: {
      teamId: o.teamId,
      createdById: o.createdById,
      title: o.title ?? "Test item",
      description: o.description ?? "",
      type: o.type ?? "TASK",
      priority: o.priority ?? "MEDIUM",
      status: o.status ?? "OPEN",
      assigneeId: o.assigneeId ?? null,
      dueDate: o.dueDate ?? null,
      ...(o.updatedAt ? { updatedAt: o.updatedAt } : {}),
    },
  });
}

// Supertest wrapper that sends a login token for the given user id.
export function as(userId: number) {
  const bearer = `Bearer ${signToken(userId)}`;
  return {
    get: (url: string) => request(app).get(url).set("Authorization", bearer),
    post: (url: string) => request(app).post(url).set("Authorization", bearer),
    patch: (url: string) => request(app).patch(url).set("Authorization", bearer),
  };
}

export const anonymous = () => request(app);

export async function itemRow(id: number) {
  return prisma.workItem.findUniqueOrThrow({ where: { id } });
}

export async function eventsOf(itemId: number) {
  return prisma.activityEvent.findMany({ where: { itemId }, orderBy: { id: "asc" } });
}
