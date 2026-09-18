import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as analyticsController from "./analytics.controller.js";
import {
  ClassAnalyticsSchema,
  ExamAnalyticsSchema,
  StudentProgressSchema,
} from "./analytics.validation.js";

const router = Router();

router.get(
  "/exams/:id",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(ExamAnalyticsSchema),
  analyticsController.getExamAnalytics
);
router.get(
  "/classes/:id",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(ClassAnalyticsSchema),
  analyticsController.getClassAnalytics
);
router.get(
  "/student/progress",
  authenticate,
  validate(StudentProgressSchema),
  analyticsController.getStudentProgress
);

export { router as analyticsRoutes };
export default router;
