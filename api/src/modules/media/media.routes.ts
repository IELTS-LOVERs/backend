import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as mediaController from "./media.controller.js";
import { ListMediaSchema, PresignUploadSchema } from "./media.validation.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(ListMediaSchema),
  mediaController.listMedia
);
router.post(
  "/presign",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(PresignUploadSchema),
  mediaController.presignUpload
);
router.post("/:id/confirm", authenticate, mediaController.confirmUpload);
router.delete(
  "/:id",
  authenticate,
  requireRoles("teacher", "admin"),
  mediaController.deleteMedia
);

export { router as mediaRoutes };
export default router;
