import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as assignmentController from "./assignment.controller.js";
import {
  CreateAssignmentSchema,
  ListAssignmentsQuerySchema,
  UpdateAssignmentSchema,
} from "./assignment.validation.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(ListAssignmentsQuerySchema),
  assignmentController.getAssignments
);
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
router.get(
  "/:id",
  authenticate,
  requireRoles("teacher", "admin"),
  assignmentController.getAssignment
);
router.get(
  "/:id/export",
  authenticate,
  requireRoles("teacher", "admin"),
  assignmentController.exportAssignmentReport
);
router.patch(
  "/:id",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(UpdateAssignmentSchema),
  assignmentController.updateAssignment
);
router.delete(
  "/:id",
  authenticate,
  requireRoles("teacher", "admin"),
  assignmentController.deleteAssignment
);
router.get(
  "/:id/progress",
  authenticate,
  requireRoles("teacher", "admin"),
  assignmentController.getAssignmentProgress
);

export { router as assignmentRoutes };
export default router;
