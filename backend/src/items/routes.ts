import { Router, type Response } from "express";
import { prisma } from "../db";
import { currentUser } from "../auth/types";
import { idempotencyKey, parseInput, sendData, userAndId } from "../http";
import type { IdempotentResult } from "../idempotency";
import { addComment, listActivity, listComments } from "./history";
import { loadDto } from "./loader";
import { patchItem } from "./patch-service";
import { listItems } from "./queries";
import { assignBody, commentBody, createItemBody, listQuery, pageQuery, patchItemBody, transitionBody } from "./schemas";
import { assignItem, claimItem, createItem, releaseItem } from "./service";
import { transitionItem } from "./transition-service";

export const itemsRouter = Router();

// A replayed Idempotency-Key gets the stored answer back, with a header saying so.
function sendIdempotent(res: Response, result: IdempotentResult): void {
  res.setHeader("Idempotent-Replayed", String(result.replayed));
  res.status(result.response.status).json(result.response.body);
}

itemsRouter.get("/items", async (req, res) => {
  const query = parseInput(listQuery, req.query);
  const { items, nextCursor } = await listItems(currentUser(req), query);
  sendData(res, items, { nextCursor, limit: query.limit });
});

itemsRouter.post("/items", async (req, res) => {
  const user = currentUser(req);
  const input = parseInput(createItemBody, req.body);
  sendIdempotent(res, await createItem(user, input, idempotencyKey(req)));
});

itemsRouter.get("/items/:id", async (req, res) => {
  const { user, id } = userAndId(req);
  sendData(res, await loadDto(prisma, user, id));
});

itemsRouter.patch("/items/:id", async (req, res) => {
  const { user, id } = userAndId(req);
  sendData(res, await patchItem(user, id, parseInput(patchItemBody, req.body)));
});

itemsRouter.post("/items/:id/claim", async (req, res) => {
  const { user, id } = userAndId(req);
  sendData(res, await claimItem(user, id));
});

itemsRouter.post("/items/:id/release", async (req, res) => {
  const { user, id } = userAndId(req);
  sendData(res, await releaseItem(user, id));
});

itemsRouter.post("/items/:id/assign", async (req, res) => {
  const { user, id } = userAndId(req);
  sendData(res, await assignItem(user, id, parseInput(assignBody, req.body)));
});

itemsRouter.post("/items/:id/transition", async (req, res) => {
  const { user, id } = userAndId(req);
  sendData(res, await transitionItem(user, id, parseInput(transitionBody, req.body)));
});

itemsRouter.get("/items/:id/activity", async (req, res) => {
  const { user, id } = userAndId(req);
  const { events, nextCursor } = await listActivity(user, id, parseInput(pageQuery, req.query));
  sendData(res, events, { nextCursor });
});

itemsRouter.get("/items/:id/comments", async (req, res) => {
  const { user, id } = userAndId(req);
  const { comments, nextCursor } = await listComments(user, id, parseInput(pageQuery, req.query));
  sendData(res, comments, { nextCursor });
});

itemsRouter.post("/items/:id/comments", async (req, res) => {
  const { user, id } = userAndId(req);
  const { body } = parseInput(commentBody, req.body);
  sendIdempotent(res, await addComment(user, id, body, idempotencyKey(req)));
});
