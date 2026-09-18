import { z } from "zod";

export const PresignUploadSchema = z.object({
  body: z.object({
    filename: z.string().min(1, "Thiếu tên file"),
    mimeType: z.enum(["audio/mpeg", "audio/wav", "image/png", "image/jpeg"]),
    type: z.enum(["audio", "image"]),
    size: z.number().positive().max(100 * 1024 * 1024),
  }),
});

export type PresignUploadBody = z.infer<typeof PresignUploadSchema>["body"];
