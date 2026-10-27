import { z } from "zod";

export const CatalogQuerySchema = z.object({
  query: z.object({
    collectionName: z.string().max(120).optional(),
    skill: z.enum(["listening", "reading", "writing"]).optional(),
    part: z.coerce.number().int().min(1).max(4).optional(),
    search: z.string().max(200).optional(),
  }),
});

export const HeatmapQuerySchema = z.object({
  query: z.object({
    studentId: z.string().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    // Backward compatibility aliases
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
  }),
});

export const WeeklyReportQuerySchema = z.object({
  params: z.object({
    classId: z.string().min(1, "Thiếu ID lớp học"),
  }),
  query: z.object({
    weekStart: z.iso.date().optional(),
    studentId: z.string().optional(),
  }),
});

export type CatalogQuery = z.infer<typeof CatalogQuerySchema>["query"];
export type HeatmapQuery = z.infer<typeof HeatmapQuerySchema>["query"];
export type WeeklyReportQuery = z.infer<typeof WeeklyReportQuerySchema>["query"];
export type WeeklyReportParams = z.infer<typeof WeeklyReportQuerySchema>["params"];
