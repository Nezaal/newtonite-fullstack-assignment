import type { Role } from "../generated/prisma/enums";

// Every demo user logs in with this password. Local demo data only.
export const DEMO_PASSWORD = "Password123!";

export const TEAM_NAMES = ["Operations", "Payments", "Compliance", "Customer Support"] as const;

export interface SeedUser {
  readonly name: string;
  readonly email: string;
  readonly isAdmin: boolean;
  // team name -> role in that team
  readonly roles: Readonly<Record<string, Role>>;
}

export const SEED_USERS: readonly SeedUser[] = [
  { name: "Alice Admin", email: "admin@demo.com", isAdmin: true, roles: {} },
  { name: "Liam Lead", email: "lead.ops@demo.com", isAdmin: false, roles: { Operations: "LEAD" } },
  { name: "Priya Lead", email: "lead.payments@demo.com", isAdmin: false, roles: { Payments: "LEAD" } },
  { name: "Carlos Lead", email: "lead.compliance@demo.com", isAdmin: false, roles: { Compliance: "LEAD" } },
  { name: "Sara Lead", email: "lead.support@demo.com", isAdmin: false, roles: { "Customer Support": "LEAD" } },
  { name: "Mia Member", email: "member.ops@demo.com", isAdmin: false, roles: { Operations: "MEMBER" } },
  // Member in two teams
  { name: "Noah Member", email: "member.payments@demo.com", isAdmin: false, roles: { Payments: "MEMBER", "Customer Support": "MEMBER" } },
  { name: "Olivia Member", email: "member.compliance@demo.com", isAdmin: false, roles: { Compliance: "MEMBER" } },
  // Different role in different teams
  { name: "Ethan Member", email: "member.support@demo.com", isAdmin: false, roles: { "Customer Support": "MEMBER", Operations: "VIEWER" } },
  { name: "Vera Viewer", email: "viewer@demo.com", isAdmin: false, roles: { Operations: "VIEWER" } },
];
