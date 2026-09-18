import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as antiCheatController from "./anti-cheat.controller.js";
import { LogExamEventSchema } from "./anti-cheat.validation.js";

const router = Router();

router.post(
  "/events",
  authenticate,
  requireRoles("student"),
  validate(LogExamEventSchema),
  antiCheatController.logEvent
);

export { router as antiCheatRoutes };
export default router;
