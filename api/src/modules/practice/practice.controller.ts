import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as practiceService from "./practice.service.js";
import type { CatalogQuery, HeatmapQuery, WeeklyReportParams, WeeklyReportQuery } from "./practice.validation.js";

function requireUser(req: Request): NonNullable<Request["user"]> {
  if (!req.user) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }
  return req.user;
}

export async function getCatalog(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as CatalogQuery;
  const result = await practiceService.getPracticeCatalog(user.id, query);
  sendSuccess(res, result);
}

export async function getHeatmap(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as HeatmapQuery;
  const result = await practiceService.getPracticeHeatmap(
    { id: user.id, role: user.role },
    query
  );
  sendSuccess(res, result);
}

export async function getClassWeeklyReport(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { classId } = req.params as WeeklyReportParams;
  const { weekStart, studentId } = req.query as WeeklyReportQuery;

  const report = await practiceService.getClassWeeklyReport(
    { id: user.id, role: user.role },
    classId,
    weekStart,
    studentId
  );

  sendSuccess(res, report);
}

export async function getClassWeeklyReportCsv(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { classId } = req.params as WeeklyReportParams;
  const { weekStart, studentId } = req.query as WeeklyReportQuery;

  const report = await practiceService.getClassWeeklyReport(
    { id: user.id, role: user.role },
    classId,
    weekStart,
    studentId
  );

  const csv = practiceService.exportWeeklyReportCsv(report);
  const classCode = report.class.code || report.class.id;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="bao-cao-tuan-${encodeURIComponent(classCode)}-${report.week.from}.csv"`
  );
  // Add UTF-8 BOM so Microsoft Excel reads Vietnamese characters without error
  res.status(200).send("\uFEFF" + csv);
}
