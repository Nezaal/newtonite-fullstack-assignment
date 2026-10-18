import jwt from "jsonwebtoken";
import { prisma } from "../src/db";
import { beforeEach, describe, expect, it } from "vitest";
import { anonymous, as, PASSWORD, resetDb, seedFixture, type Fixture } from "./helpers";

let f: Fixture;

beforeEach(async () => {
  await resetDb();
  f = await seedFixture();
});

const login = (email: string, password: string) => anonymous().post("/auth/login").send({ email, password });

describe("login", () => {
  it("returns a token and the user for the right password", async () => {
    const res = await login("lead.a@test.com", PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({ id: f.leadA, name: "Lead A", isAdmin: false });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash/);
  });

  it("works with a different letter case in the email", async () => {
    expect((await login("  LEAD.A@test.com ", PASSWORD)).status).toBe(200);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const wrongPassword = await login("lead.a@test.com", "wrong");
    const unknownEmail = await login("nobody@test.com", "wrong");
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it("works end to end: the token from login opens /me", async () => {
    const { token } = (await login("member.a@test.com", PASSWORD)).body.data;
    const me = await anonymous().get("/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.teams).toEqual([{ id: f.teamA, name: "Alpha", role: "MEMBER" }]);
  });
});

describe("protected routes", () => {
  it("returns 401 without a token", async () => {
    expect((await anonymous().get("/items")).status).toBe(401);
    expect((await anonymous().get("/me")).status).toBe(401);
    expect((await anonymous().post("/items")).status).toBe(401);
  });

  it("returns 401 for garbage, tampered and expired tokens", async () => {
    const get = (token: string) => anonymous().get("/me").set("Authorization", `Bearer ${token}`);
    expect((await get("not-a-token")).status).toBe(401);

    const forged = jwt.sign({ sub: String(f.admin) }, "some-other-secret");
    expect((await get(forged)).status).toBe(401);

    const expired = jwt.sign({ sub: String(f.leadA) }, process.env.JWT_SECRET!, { expiresIn: -10 });
    expect((await get(expired)).status).toBe(401);

    const noneAlgorithm = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(`{"sub":"${f.admin}"}`).toString("base64url")}.`;
    expect((await get(noneAlgorithm)).status).toBe(401);
  });

  it("returns 401 if the user was deleted after the token was issued", async () => {
    await prisma.membership.deleteMany({ where: { userId: f.viewerA } });
    await prisma.user.delete({ where: { id: f.viewerA } });
    expect((await as(f.viewerA).get("/me")).status).toBe(401);
  });

  it("returns a JSON 404 for an unknown route", async () => {
    const res = await as(f.leadA).get("/nothing-here");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("answers the health check without a token", async () => {
    const res = await anonymous().get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
