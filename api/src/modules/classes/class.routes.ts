import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as practiceController from "../practice/practice.controller.js";
import { WeeklyReportQuerySchema } from "../practice/practice.validation.js";
import * as classController from "./class.controller.js";
import {
  AddStudentSchema,
  CreateClassSchema,
  JoinClassSchema,
  UpdateClassSchema,
} from "./class.validation.js";

const router = Router();

router.get(
  "/:classId/reports/weekly.csv",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(WeeklyReportQuerySchema),
  practiceController.getClassWeeklyReportCsv
);
router.get(
  "/:classId/reports/weekly",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(WeeklyReportQuerySchema),
  practiceController.getClassWeeklyReport
);

router.get("/", authenticate, classController.getClasses);
router.post(
  "/",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(CreateClassSchema),
  classController.createClass
);
router.post(
  "/join",
  authenticate,
  requireRoles("student"),
  validate(JoinClassSchema),
  classController.joinClass
);
// REQ-002: học sinh tự rời lớp.
router.post(
  "/:id/leave",
  authenticate,
  requireRoles("student"),
  classController.leaveClass
);
router.get("/:id", authenticate, classController.getClassDetail);
router.patch(
  "/:id",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(UpdateClassSchema),
  classController.updateClass
);
router.delete(
  "/:id",
  authenticate,
  requireRoles("teacher", "admin"),
  classController.deleteClass
);
router.post(
  "/:id/students",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(AddStudentSchema),
  classController.addStudent
);
router.delete(
  "/:id/students/:studentId",
  authenticate,
  requireRoles("teacher", "admin"),
  classController.removeStudent
);

export { router as classRoutes };
export default router;
