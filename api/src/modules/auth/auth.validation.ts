import { z } from "zod";

export const RegisterSchema = z.object({
  body: z.object({
    email: z.email("Email không hợp lệ"),
    password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
    fullName: z.string().min(2, "Họ tên tối thiểu 2 ký tự"),
    phone: z.string().optional(),
    targetBand: z.number().min(0).max(9).default(6.5),
  }),
});

export const LoginSchema = z.object({
  body: z.object({
    email: z.email("Email không hợp lệ"),
    password: z.string().min(1, "Vui lòng nhập mật khẩu"),
  }),
});

export const ChangePasswordSchema = z.object({
  body: z.object({
    oldPassword: z.string().min(1, "Vui lòng nhập mật khẩu hiện tại"),
    newPassword: z.string().min(8, "Mật khẩu mới tối thiểu 8 ký tự"),
  }),
});

export type RegisterBody = z.infer<typeof RegisterSchema>["body"];
export type LoginBody = z.infer<typeof LoginSchema>["body"];
export type ChangePasswordBody = z.infer<typeof ChangePasswordSchema>["body"];
