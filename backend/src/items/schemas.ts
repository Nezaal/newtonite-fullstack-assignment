import { z } from "zod";
import { ItemType, Priority, Status } from "../../generated/prisma/enums";

const id = z.number().int().positive();
const version = z.number().int().positive();
const title = z.string().trim().min(1, "Title is required").max(200);
const description = z.string().trim().max(5000);
const dueDate = z.iso.datetime();

export const VIEWS = ["assigned_to_me", "unassigned_urgent", "awaiting_my_approval", "overdue"] as const;
export type View = (typeof VIEWS)[number];

export const createItemBody = z.object({
  teamId: id,
  title,
  description: description.default(""),
  type: z.enum(ItemType),
  priority: z.enum(Priority).default("MEDIUM"),
  dueDate: dueDate.nullish(),
});

export const patchItemBody = z
  .object({
    version,
    title: title.optional(),
    description: description.optional(),
    priority: z.enum(Priority).optional(),
    dueDate: dueDate.nullable().optional(),
    teamId: id.optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== "version"), { message: "Nothing to change" });

export const assignBody = z.object({ assigneeId: id, version });

export const transitionBody = z.object({
  to: z.enum(Status),
  version,
  reason: z.string().trim().max(1000).optional(),
});

export const commentBody = z.object({ body: z.string().trim().min(1, "Comment cannot be empty").max(2000) });

const optionalId = z.coerce.number().int().positive().optional();

export const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  view: z.enum(VIEWS).optional(),
  teamId: optionalId,
  status: z.enum(Status).optional(),
  priority: z.enum(Priority).optional(),
  type: z.enum(ItemType).optional(),
  // "me", "none" (unassigned) or a user id
  assignee: z.union([z.literal("me"), z.literal("none"), z.coerce.number().int().positive()]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListQuery = z.infer<typeof listQuery>;

export const pageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
