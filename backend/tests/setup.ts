import { afterAll } from "vitest";
import { prisma } from "../src/db";

afterAll(async () => {
  await prisma.$disconnect();
});
