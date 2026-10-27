import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as antiCheatController from "../anti-cheat/anti-cheat.controller.js";
import * as attemptController from "./attempt.controller.js";
import {
  AutosaveAnswersSchema,
  GetMyAttemptsSchema,
  StartAttemptSchema,
} from "./attempt.validation.js";

const router = Router();

router.post(
  "/",
  authenticate,
  requireRoles("student"),
  validate(StartAttemptSchema),
  attemptController.start
);
router.get(
  "/my",
  authenticate,
  validate(GetMyAttemptsSchema),
  attemptController.getMyAttempts
);
router.get("/:id", authenticate, attemptController.getAttempt);
router.get("/:id/revision", authenticate, attemptController.getRevision);
router.get("/:id/exam", authenticate, attemptController.getExamContent);
router.patch(
  "/:id/answers",
  authenticate,
  validate(AutosaveAnswersSchema),
  attemptController.autosave
);
router.post("/:id/submit", authenticate, attemptController.submit);
router.get("/:id/result", authenticate, attemptController.getResult);
router.get("/:id/events", authenticate, antiCheatController.getEvents);

export { router as attemptRoutes };
export default router;
