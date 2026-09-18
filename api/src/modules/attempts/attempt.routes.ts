import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as attemptController from "./attempt.controller.js";
import { AutosaveAnswersSchema, StartAttemptSchema } from "./attempt.validation.js";

const router = Router();

router.post(
  "/",
  authenticate,
  requireRoles("student"),
  validate(StartAttemptSchema),
  attemptController.start
);
router.get("/:id", authenticate, attemptController.getAttempt);
router.patch(
  "/:id/answers",
  authenticate,
  validate(AutosaveAnswersSchema),
  attemptController.autosave
);
router.post("/:id/submit", authenticate, attemptController.submit);
router.get("/:id/result", authenticate, attemptController.getResult);

export { router as attemptRoutes };
export default router;
