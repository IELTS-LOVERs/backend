import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as assignmentController from "./assignment.controller.js";
import { CreateAssignmentSchema } from "./assignment.validation.js";

const router = Router();

router.post(
  "/",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(CreateAssignmentSchema),
  assignmentController.createAssignment
);
router.get(
  "/my",
  authenticate,
  requireRoles("student"),
  assignmentController.getMyAssignments
);

export { router as assignmentRoutes };
export default router;
