import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { createRateLimiter } from "../../common/middlewares/rateLimiter.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as antiCheatController from "./anti-cheat.controller.js";
import { LogExamEventSchema, SuspiciousReportSchema } from "./anti-cheat.validation.js";

const router = Router();

const eventRateLimiter = createRateLimiter(60, 60 * 1000);

router.post(
  "/events",
  authenticate,
  requireRoles("student"),
  eventRateLimiter,
  validate(LogExamEventSchema),
  antiCheatController.logEvent
);
router.get(
  "/suspicious",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(SuspiciousReportSchema),
  antiCheatController.getSuspiciousReport
);
router.get("/events/:attemptId", authenticate, antiCheatController.getEvents);


export { router as antiCheatRoutes };
export default router;
