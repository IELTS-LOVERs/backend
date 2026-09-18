import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as questionController from "./question.controller.js";
import {
  CreateQuestionSchema,
  ListQuestionsSchema,
  UpdateQuestionSchema,
} from "./question.validation.js";

const router = Router();

router.use(authenticate, requireRoles("teacher", "admin"));

router.post("/", validate(CreateQuestionSchema), questionController.createQuestion);
router.get("/", validate(ListQuestionsSchema), questionController.listQuestions);
router.get("/:id", questionController.getQuestion);
router.put("/:id", validate(UpdateQuestionSchema), questionController.updateQuestion);
router.delete("/:id", questionController.deleteQuestion);

export { router as questionRoutes };
export default router;
