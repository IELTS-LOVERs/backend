import { z } from "zod";

export const AdminResetPasswordSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID người dùng"),
  }),
  body: z.object({
    newPassword: z.string().min(8, "Mật khẩu mới tối thiểu 8 ký tự"),
  }),
});

export const UpdateProfileSchema = z.object({
  body: z.object({
    fullName: z.string().min(2, "Họ và tên tối thiểu 2 ký tự").optional(),
    phone: z.string().optional(),
    targetBand: z.coerce.number().min(0).max(9).optional(),
    avatarMediaId: z.string().optional(),
  }),
});

export type AdminResetPasswordBody = z.infer<typeof AdminResetPasswordSchema>["body"];
export type UpdateProfileBody = z.infer<typeof UpdateProfileSchema>["body"];
