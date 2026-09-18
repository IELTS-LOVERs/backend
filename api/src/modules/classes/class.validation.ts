import { z } from "zod";

export const CreateClassSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Tên lớp tối thiểu 2 ký tự"),
    description: z.string().optional(),
  }),
});

export const JoinClassSchema = z.object({
  body: z.object({
    code: z.string().length(6, "Mã lớp gồm 6 ký tự"),
  }),
});

export const AddStudentSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID lớp học"),
  }),
  body: z.object({
    email: z.email("Email không hợp lệ"),
  }),
});

export type CreateClassBody = z.infer<typeof CreateClassSchema>["body"];
export type JoinClassBody = z.infer<typeof JoinClassSchema>["body"];
export type AddStudentBody = z.infer<typeof AddStudentSchema>["body"];
