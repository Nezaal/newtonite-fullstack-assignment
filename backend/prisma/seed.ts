import bcrypt from "bcryptjs";
import { PrismaClient } from "../generated/prisma/client";
import { DEMO_PASSWORD, SEED_USERS, TEAM_NAMES } from "./seed-data";
import { buildSeedItems, type TeamPeople } from "./seed-items";

const ITEM_COUNT = 4000;
const BATCH_SIZE = 1000;
const BCRYPT_ROUNDS = 10;

const prisma = new PrismaClient();

function chunk<T>(rows: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
}

// Wipe everything so the seed can be run again. RESTART IDENTITY makes ids start from 1.
async function clearTables(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE notifications, outbox_jobs, idempotency_keys, activity_events, comments, work_items, memberships, teams, users RESTART IDENTITY CASCADE`,
  );
}

async function createPeople(): Promise<{ adminId: number; teams: Map<string, TeamPeople> }> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

  const teamRows = await Promise.all(TEAM_NAMES.map((name) => prisma.team.create({ data: { name } })));
  const teamIds = new Map(teamRows.map((team) => [team.name, team.id]));

  const userRows = await Promise.all(
    SEED_USERS.map((user) =>
      prisma.user.create({ data: { name: user.name, email: user.email, passwordHash, isAdmin: user.isAdmin } }),
    ),
  );

  const memberships = SEED_USERS.flatMap((user, index) =>
    Object.entries(user.roles).map(([teamName, role]) => ({
      userId: userRows[index].id,
      teamId: teamIds.get(teamName)!,
      role,
    })),
  );
  await prisma.membership.createMany({ data: memberships });

  const teams = new Map<string, TeamPeople>(
    TEAM_NAMES.map((name) => {
      const inTeam = memberships.filter((m) => m.teamId === teamIds.get(name));
      const workers = inTeam.filter((m) => m.role !== "VIEWER").map((m) => m.userId);
      const leads = inTeam.filter((m) => m.role === "LEAD").map((m) => m.userId);
      return [name, { teamId: teamIds.get(name)!, workers, leads, everyone: inTeam.map((m) => m.userId) }];
    }),
  );
  const adminId = userRows[SEED_USERS.findIndex((user) => user.isAdmin)].id;
  return { adminId, teams };
}

async function createItems(adminId: number, teams: Map<string, TeamPeople>): Promise<void> {
  const { items, events, comments } = buildSeedItems(ITEM_COUNT, teams, adminId, new Date());

  for (const batch of chunk(items, BATCH_SIZE)) await prisma.workItem.createMany({ data: batch });
  // Items were inserted with fixed ids, so move the id counter past them.
  await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('work_items', 'id'), ${items.length})`);

  for (const batch of chunk(events, BATCH_SIZE)) await prisma.activityEvent.createMany({ data: batch });
  for (const batch of chunk(comments, BATCH_SIZE)) await prisma.comment.createMany({ data: batch });
}

async function main(): Promise<void> {
  // Used by docker compose: seed the first time only, never wipe data that people have created.
  if (process.argv.includes("--if-empty") && (await prisma.user.count()) > 0) {
    console.log("Database already has data, skipping seed.");
    return;
  }
  await clearTables();
  const { adminId, teams } = await createPeople();
  await createItems(adminId, teams);
  console.log(`Seeded ${TEAM_NAMES.length} teams, ${SEED_USERS.length} users, ${ITEM_COUNT} items.`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
