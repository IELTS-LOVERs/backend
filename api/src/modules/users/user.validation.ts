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

export const ListUsersSchema = z.object({
  query: z.object({
    role: z.enum(["student", "teacher", "admin"]).optional(),
    status: z.enum(["active", "inactive", "suspended"]).optional(),
    search: z.string().max(100).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

export const CreateUserSchema = z.object({
  body: z.object({
    email: z.email("Email không hợp lệ"),
    password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
    fullName: z.string().min(2, "Họ tên tối thiểu 2 ký tự"),
    phone: z.string().optional(),
    role: z.enum(["teacher", "admin"]).default("teacher"),
    targetBand: z.coerce.number().min(0).max(9).optional(),
  }),
});

export const UpdateUserStatusSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID người dùng"),
  }),
  body: z.object({
    status: z.enum(["active", "inactive", "suspended"]),
  }),
});

export type AdminResetPasswordBody = z.infer<typeof AdminResetPasswordSchema>["body"];
export type UpdateProfileBody = z.infer<typeof UpdateProfileSchema>["body"];
export type ListUsersQuery = z.infer<typeof ListUsersSchema>["query"];
export type CreateUserBody = z.infer<typeof CreateUserSchema>["body"];
export type UpdateUserStatusBody = z.infer<typeof UpdateUserStatusSchema>["body"];
