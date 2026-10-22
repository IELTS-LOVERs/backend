import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as practiceController from "./practice.controller.js";
import { CatalogQuerySchema, HeatmapQuerySchema } from "./practice.validation.js";

const router = Router();

router.get(
  "/catalog",
  authenticate,
  requireRoles("student"),
  validate(CatalogQuerySchema),
  practiceController.getCatalog
);

router.get(
  "/heatmap",
  authenticate,
  validate(HeatmapQuerySchema),
  practiceController.getHeatmap
);

export { router as practiceRoutes };
export default router;
