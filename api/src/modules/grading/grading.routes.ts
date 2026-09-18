import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as gradingController from "./grading.controller.js";
import { GradeWritingSchema } from "./grading.validation.js";

const gradingRouter = Router();

gradingRouter.get(
  "/pending",
  authenticate,
  requireRoles("teacher", "admin"),
  gradingController.getPending
);

const writingReviewRouter = Router();

writingReviewRouter.post(
  "/",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(GradeWritingSchema),
  gradingController.gradeWriting
);

const gradingAttemptRouter = Router();

gradingAttemptRouter.get(
  "/:id/grading",
  authenticate,
  requireRoles("teacher", "admin"),
  gradingController.getForGrading
);

export { gradingRouter as gradingRoutes };
export { writingReviewRouter as writingReviewRoutes };
export { gradingAttemptRouter as gradingAttemptRoutes };
export default gradingRouter;
