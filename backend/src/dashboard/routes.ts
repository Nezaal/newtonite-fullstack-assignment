import { Router } from "express";
import { currentUser } from "../auth/types";
import { sendData } from "../http";
import { dashboardCounts } from "../items/queries";

export const dashboardRouter = Router();

dashboardRouter.get("/dashboard", async (req, res) => {
  sendData(res, await dashboardCounts(currentUser(req)));
});
