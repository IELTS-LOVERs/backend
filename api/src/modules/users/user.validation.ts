import { z } from "zod";

export const AdminResetPasswordSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID người dùng"),
  }),
  body: z.object({
    newPassword: z.string().min(8, "Mật khẩu mới tối thiểu 8 ký tự"),
  }),
});

export type AdminResetPasswordBody = z.infer<typeof AdminResetPasswordSchema>["body"];
