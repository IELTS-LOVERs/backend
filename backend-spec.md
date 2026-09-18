# BẢN ĐẶC TẢ KỸ THUẬT BACKEND (BACKEND TECHNICAL SPECIFICATION)

## HỆ THỐNG NỀN TẢNG LUYỆN THI IELTS TRỰC TUYẾN (IELTS ONLINE PLATFORM — MVP)

* **Vai trò:** Senior Backend Architect & Tech Lead  
* **Tài liệu:** `backend-spec.md`  
* **Phiên bản:** 1.1.0-MVP (Cập nhật: Bổ sung Change Password, Admin Reset, CRUD & Security Sanitization)  
* **Trạng thái:** Sẵn sàng triển khai mã nguồn (Ready for Implementation)

---

## 1\. TỔNG QUAN KIẾN TRÚC & NGUYÊN TẮC THIẾT KẾ

### 1.1. Bối cảnh & Phạm vi Hệ thống

* **Mục đích:** Cung cấp hệ thống quản lý lớp học, ngân hàng câu hỏi, tổ chức thi trực tuyến mô phỏng kỳ thi IELTS thực tế (Listening, Reading, Writing), tự động chấm trắc nghiệm/điền từ và hỗ trợ giáo viên chấm thủ công phần Viết.  
* **Kỹ năng hỗ trợ (MVP):** Listening, Reading, Writing (loại trừ Speaking khỏi phạm vi MVP).  
* **Nguyên tắc kỹ thuật cốt lõi:**  
  1. **Server-Authoritative Timing:** Thời gian thi (`startedAt`, `expiresAt`) do server quản lý và kiểm soát hoàn toàn. Client tuyệt đối không được tự gửi thời gian còn lại lên server. Server từ chối nộp bài nếu vượt quá hạn nộp cộng với biên độ trễ mạng trần (Grace Period: 15 giây).  
  2. **Zero Media Proxying:** Express API không xử lý dữ liệu nhị phân (binary stream) của media file lớn (Audio MP3/WAV, Hình ảnh biểu đồ). Client xin Presigned PUT URL từ Express và upload/stream trực tiếp qua MinIO / Cloudflare Tunnel.  
  3. **Idempotent Autosave:** Cơ chế cập nhật đáp án từng phần (incremental upsert) theo chu kỳ (debounce 2–5s) bảo toàn dữ liệu bài làm của học sinh khi tải lại trang (F5) hoặc ngắt kết nối mạng.  
  4. **Strict Schema & Type Safety:** 100% dữ liệu vào/ra được định kiểu bằng TypeScript (Strict Mode) và kiểm thực (validate) bởi Zod Schemas tại tầng HTTP Middleware.  
  5. **Data Projection & Security Sanitization (Chống rò rỉ đáp án):** Khi học sinh làm bài hoặc khôi phục trạng thái bài thi (`GET /api/attempts/:id`), tầng Service **bắt buộc loại bỏ hoàn toàn (strip) 2 trường `acceptedAnswers` và `explanation`** khỏi danh sách câu hỏi trả về client. Chỉ khi đã nộp bài và xem kết quả (`/result`) hoặc đối với quyền giáo viên/admin thì mới được xem đáp án.  
  6. **Cơ chế Mật khẩu tinh gọn (Không dùng SMTP trong MVP):** Để tối ưu thời gian triển khai, hệ thống hỗ trợ API `POST /api/auth/change-password` cho người dùng tự đổi mật khẩu khi đã đăng nhập. Trường hợp quên mật khẩu sẽ do **Admin reset thủ công** qua API `POST /api/users/:id/reset-password` (không tích hợp dịch vụ gửi mail OTP/Token qua SMTP bên thứ ba).

### 1.2. Sơ đồ Luồng Dữ liệu Tổng thể

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\[CLIENT BROWSER\]

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│          │

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(1) Xin Presigned URL    │ (3) Direct Stream / Direct Upload

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│          │

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;▼          ▼

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\[EXPRESS API\] ──► \[MINIO S3\] ◄── \[Cloudflare Tunnel\]

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;▼

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\[MONGODB\]

---

## 2\. CẤU TRÚC THƯ MỤC DỰ ÁN (MODULAR MONOLITH)

Cấu trúc mã nguồn tổ chức theo mô hình **Modular Monolith** nhằm đảm bảo tính phân tách độc lập giữa các nghiệp vụ:

api/

├── Dockerfile

├── package.json

├── tsconfig.json

├── src/

│   ├── app.ts                  \# Khởi tạo Express, cấu hình Global Middlewares

│   ├── server.ts               \# Khởi chạy HTTP Server, kết nối DB & MinIO

│   │

│   ├── config/                 \# Cấu hình hệ thống & biến môi trường

│   │   ├── env.ts              \# Zod validate process.env

│   │   ├── database.ts         \# Kết nối Mongoose ODM

│   │   ├── minio.ts            \# MinIO S3 Client instance

│   │   └── constants.ts        \# Hằng số hệ thống (IELTS Band tables, Grace periods)

│   │

│   ├── common/                 \# Dùng chung toàn hệ thống

│   │   ├── errors/             \# AppError, BadRequestError, UnauthorizedError, ...

│   │   ├── middlewares/        \# auth.middleware, rbac.middleware, validate.middleware, errorHandler

│   │   ├── types/              \# Express Request augmentation, Common Types

│   │   └── utils/              \# ielts-calculator.ts, string-normalizer.ts, response.util.ts

│   │

│   └── modules/                \# Các domain modules độc lập

│       ├── auth/               \# Xác thực, JWT, Refresh Token, Change Password

│       │   ├── auth.controller.ts

│       │   ├── auth.service.ts

│       │   ├── auth.validation.ts

│       │   └── auth.routes.ts

│       │

│       ├── users/              \# Quản lý tài khoản, User profile, Admin reset pass

│       │   ├── user.model.ts

│       │   ├── user.service.ts

│       │   ├── user.controller.ts

│       │   ├── user.validation.ts

│       │   └── user.routes.ts

│       │

│       ├── classes/            \# Quản lý lớp, tạo mã lớp, mời học sinh, xóa học sinh

│       │   ├── class.model.ts

│       │   ├── class.service.ts

│       │   ├── class.controller.ts

│       │   ├── class.validation.ts

│       │   └── class.routes.ts

│       │

│       ├── questions/          \# Ngân hàng câu hỏi IELTS (data Mixed)

│       │   ├── question.model.ts

│       │   ├── question.service.ts

│       │   ├── question.controller.ts

│       │   ├── question.validation.ts

│       │   └── question.routes.ts

│       │

│       ├── exams/              \# Quản lý đề thi, sections, clone đề, publish

│       │   ├── exam.model.ts

│       │   ├── exam.service.ts

│       │   ├── exam.controller.ts

│       │   ├── exam.validation.ts

│       │   └── exam.routes.ts

│       │

│       ├── assignments/        \# Phân phối bài thi cho lớp / học sinh

│       │   ├── assignment.model.ts

│       │   ├── assignment.service.ts

│       │   ├── assignment.controller.ts

│       │   ├── assignment.validation.ts

│       │   └── assignment.routes.ts

│       │

│       ├── attempts/           \# Core Exam Engine: Timer, Autosave, Submit, Recovery, Result

│       │   ├── attempt.model.ts

│       │   ├── attempt.service.ts

│       │   ├── attempt.controller.ts

│       │   ├── attempt.validation.ts

│       │   └── attempt.routes.ts

│       │

│       ├── grading/            \# Auto-grade (L/R) & Manual Grade (Writing), Pending List

│       │   ├── writing-review.model.ts

│       │   ├── grading.service.ts

│       │   ├── grading.controller.ts

│       │   ├── grading.validation.ts

│       │   └── grading.routes.ts

│       │

│       ├── media/              \# MinIO S3 Presigned URL & Metadata

│       │   ├── media.model.ts

│       │   ├── media.service.ts

│       │   ├── media.controller.ts

│       │   ├── media.validation.ts

│       │   └── media.routes.ts

│       │

│       └── anti-cheat/         \# Theo dõi sự kiện gian lận

│           ├── exam-event.model.ts

│           ├── anti-cheat.service.ts

│           ├── anti-cheat.controller.ts

│           ├── anti-cheat.validation.ts

│           └── anti-cheat.routes.ts

---

## 3\. QUY CHUẨN XỬ LÝ LỖI & RESPONSE ENVELOPE

Mọi HTTP Response của hệ thống đều tuân thủ cấu trúc đồng nhất:

### 3.1. Response Thành Công (HTTP 200, 201\)

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": { ... },

&nbsp;&nbsp;"meta": {

&nbsp;&nbsp;&nbsp;&nbsp;"page": 1,

&nbsp;&nbsp;&nbsp;&nbsp;"limit": 20,

&nbsp;&nbsp;&nbsp;&nbsp;"total": 100,

&nbsp;&nbsp;&nbsp;&nbsp;"totalPages": 5

&nbsp;&nbsp;}

}

### 3.2. Response Thất Bại (HTTP 4xx, 5xx)

{

&nbsp;&nbsp;"success": false,

&nbsp;&nbsp;"error": {

&nbsp;&nbsp;&nbsp;&nbsp;"code": "EXAM\_EXPIRED",

&nbsp;&nbsp;&nbsp;&nbsp;"message": "Thời gian làm bài thi đã kết thúc. Không thể gửi thêm đáp án.",

&nbsp;&nbsp;&nbsp;&nbsp;"details": null

&nbsp;&nbsp;}

}

### 3.3. Bảng Mã Lỗi Tiêu Chuẩn (Standard Error Codes)

| HTTP Status | Error Code | Mô tả |
| :---- | :---- | :---- |
| **400** | `VALIDATION_ERROR` | Dữ liệu đầu vào không khớp Zod Schema |
| **400** | `INVALID_CREDENTIALS` | Sai email hoặc mật khẩu |
| **400** | `OLD_PASSWORD_INCORRECT` | Mật khẩu cũ không chính xác khi đổi mật khẩu |
| **400** | `CLASS_CODE_INVALID` | Mã lớp không tồn tại hoặc không hợp lệ |
| **400** | `STUDENT_ALREADY_IN_CLASS` | Học sinh đã là thành viên của lớp này |
| **400** | `STUDENT_NOT_IN_CLASS` | Học sinh không thuộc lớp học này |
| **400** | `EXAM_ALREADY_SUBMITTED` | Bài thi đã được nộp trước đó |
| **400** | `EXAM_NOT_PUBLISHED` | Đề thi chưa được xuất bản |
| **400** | `EXAM_CANNOT_EDIT_PUBLISHED` | Không thể sửa hoặc xóa đề thi đã xuất bản |
| **401** | `UNAUTHORIZED` | Token không hợp lệ hoặc thiếu Authorization Header |
| **401** | `TOKEN_EXPIRED` | Access Token đã hết hạn |
| **401** | `REFRESH_TOKEN_INVALID` | Refresh Token không hợp lệ trong Cookie |
| **403** | `FORBIDDEN` | Người dùng không đủ quyền thực hiện hành động |
| **403** | `ATTEMPT_NOT_OWNED` | Học sinh không có quyền truy cập bài làm này |
| **403** | `EXAM_EXPIRED` | Hết giờ làm bài (Server timer exceeded) |
| **404** | `NOT_FOUND` | Tài nguyên yêu cầu không tồn tại trong DB |
| **409** | `CONFLICT` | Email đã tồn tại hoặc mã lớp bị trùng |
| **429** | `TOO_MANY_REQUESTS` | Vượt quá giới hạn gọi API (Rate limit) |
| **500** | `INTERNAL_SERVER_ERROR` | Lỗi máy chủ không mong muốn |

---

## 4\. DATABASE MONGOOSE SCHEMAS, TYPESCRIPT INTERFACES & INDEXES

Tất cả các Model đều được cấu hình:

* `timestamps: true` (tự sinh `createdAt`, `updatedAt`)  
* `versionKey: false` (`__v` bị tắt)  
* Strict TypeScript Interface định hình kiểu dữ liệu.

### 4.1. User Model (`src/modules/users/user.model.ts`)

import { Schema, model, Document, Types } from "mongoose";

&nbsp;

export type UserRole \= "student" | "teacher" | "admin";

export type UserStatus \= "active" | "inactive" | "suspended";

&nbsp;

export interface IUser extends Document {

&nbsp;&nbsp;\_id: Types.ObjectId;

&nbsp;&nbsp;email: string;

&nbsp;&nbsp;passwordHash: string;

&nbsp;&nbsp;fullName: string;

&nbsp;&nbsp;phone?: string;

&nbsp;&nbsp;role: UserRole;

&nbsp;&nbsp;targetBand?: number; // Ví dụ: 6.5, 7.0, 8.0

&nbsp;&nbsp;avatarMediaId?: Types.ObjectId;

&nbsp;&nbsp;status: UserStatus;

&nbsp;&nbsp;createdAt: Date;

&nbsp;&nbsp;updatedAt: Date;

}

&nbsp;

const UserSchema \= new Schema\<IUser\>(

&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;email: { type: String, required: true, unique: true, lowercase: true, trim: true },

&nbsp;&nbsp;&nbsp;&nbsp;passwordHash: { type: String, required: true },

&nbsp;&nbsp;&nbsp;&nbsp;fullName: { type: String, required: true, trim: true },

&nbsp;&nbsp;&nbsp;&nbsp;phone: { type: String, trim: true },

&nbsp;&nbsp;&nbsp;&nbsp;role: { type: String, enum: \["student", "teacher", "admin"\], default: "student" },

&nbsp;&nbsp;&nbsp;&nbsp;targetBand: { type: Number, min: 0, max: 9.0 },

&nbsp;&nbsp;&nbsp;&nbsp;avatarMediaId: { type: Schema.Types.ObjectId, ref: "Media" },

&nbsp;&nbsp;&nbsp;&nbsp;status: { type: String, enum: \["active", "inactive", "suspended"\], default: "active" },

&nbsp;&nbsp;},

&nbsp;&nbsp;{ timestamps: true, versionKey: false }

);

&nbsp;

// Indexes

UserSchema.index({ email: 1 }, { unique: true });

UserSchema.index({ role: 1, status: 1 });

&nbsp;

export const UserModel \= model\<IUser\>("User", UserSchema);

### 4.2. Class Model (`src/modules/classes/class.model.ts`)

import { Schema, model, Document, Types } from "mongoose";

&nbsp;

export interface IClass extends Document {

&nbsp;&nbsp;\_id: Types.ObjectId;

&nbsp;&nbsp;name: string;

&nbsp;&nbsp;code: string; // 6 ký tự ngẫu nhiên (e.g. "IEL88A")

&nbsp;&nbsp;description?: string;

&nbsp;&nbsp;teacherId: Types.ObjectId;

&nbsp;&nbsp;students: Types.ObjectId\[\]; // Danh sách User IDs (role \= student)

&nbsp;&nbsp;createdAt: Date;

&nbsp;&nbsp;updatedAt: Date;

}

&nbsp;

const ClassSchema \= new Schema\<IClass\>(

&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;name: { type: String, required: true, trim: true },

&nbsp;&nbsp;&nbsp;&nbsp;code: { type: String, required: true, unique: true, uppercase: true, trim: true },

&nbsp;&nbsp;&nbsp;&nbsp;description: { type: String, trim: true },

&nbsp;&nbsp;&nbsp;&nbsp;teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },

&nbsp;&nbsp;&nbsp;&nbsp;students: \[{ type: Schema.Types.ObjectId, ref: "User" }\],

&nbsp;&nbsp;},

&nbsp;&nbsp;{ timestamps: true, versionKey: false }

);

&nbsp;

// Indexes

ClassSchema.index({ code: 1 }, { unique: true });

ClassSchema.index({ teacherId: 1 });

ClassSchema.index({ students: 1 });

&nbsp;

export const ClassModel \= model\<IClass\>("Class", ClassSchema);

### 4.3. Question Model (`src/modules/questions/question.model.ts`)

import { Schema, model, Document, Types } from "mongoose";

&nbsp;

export type SkillType \= "listening" | "reading" | "writing";

export type QuestionType \=

&nbsp;&nbsp;| "multiple\_choice"

&nbsp;&nbsp;| "form\_completion"

&nbsp;&nbsp;| "note\_completion"

&nbsp;&nbsp;| "table\_completion"

&nbsp;&nbsp;| "sentence\_completion"

&nbsp;&nbsp;| "matching"

&nbsp;&nbsp;| "map\_labelling"

&nbsp;&nbsp;| "diagram\_labelling"

&nbsp;&nbsp;| "matching\_headings"

&nbsp;&nbsp;| "summary\_completion"

&nbsp;&nbsp;| "true\_false\_not\_given"

&nbsp;&nbsp;| "yes\_no\_not\_given"

&nbsp;&nbsp;| "writing\_task\_1"

&nbsp;&nbsp;| "writing\_task\_2";

&nbsp;

export interface IQuestion extends Document {

&nbsp;&nbsp;\_id: Types.ObjectId;

&nbsp;&nbsp;skill: SkillType;

&nbsp;&nbsp;type: QuestionType;

&nbsp;&nbsp;part: number; // 1, 2, 3, 4 (Listening); 1, 2, 3 (Reading); 1, 2 (Writing)

&nbsp;&nbsp;prompt: string; // Nội dung câu hỏi/yêu cầu đề bài

&nbsp;&nbsp;content?: string; // Đoạn văn bản bổ sung, văn cảnh hoặc đoạn đọc ngắn

&nbsp;&nbsp;data: Record\<string, any\>; // Cấu hình linh hoạt: options\[\], matchingPairs\[\], blankPositions, ...

&nbsp;&nbsp;acceptedAnswers: string\[\]; // Danh sách đáp án chấp nhận chấm tự động

&nbsp;&nbsp;points: number; // Điểm số mặc định (thường là 1\)

&nbsp;&nbsp;explanation?: string; // Giải thích chi tiết đáp án

&nbsp;&nbsp;mediaIds: Types.ObjectId\[\]; // Tham chiếu Audio/Image S3 Media

&nbsp;&nbsp;createdBy: Types.ObjectId;

&nbsp;&nbsp;createdAt: Date;

&nbsp;&nbsp;updatedAt: Date;

}

&nbsp;

const QuestionSchema \= new Schema\<IQuestion\>(

&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;skill: { type: String, enum: \["listening", "reading", "writing"\], required: true },

&nbsp;&nbsp;&nbsp;&nbsp;type: { type: String, required: true },

&nbsp;&nbsp;&nbsp;&nbsp;part: { type: Number, required: true },

&nbsp;&nbsp;&nbsp;&nbsp;prompt: { type: String, required: true },

&nbsp;&nbsp;&nbsp;&nbsp;content: { type: String },

&nbsp;&nbsp;&nbsp;&nbsp;data: { type: Schema.Types.Mixed, default: {} },

&nbsp;&nbsp;&nbsp;&nbsp;acceptedAnswers: \[{ type: String, trim: true }\],

&nbsp;&nbsp;&nbsp;&nbsp;points: { type: Number, default: 1 },

&nbsp;&nbsp;&nbsp;&nbsp;explanation: { type: String },

&nbsp;&nbsp;&nbsp;&nbsp;mediaIds: \[{ type: Schema.Types.ObjectId, ref: "Media" }\],

&nbsp;&nbsp;&nbsp;&nbsp;createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

&nbsp;&nbsp;},

&nbsp;&nbsp;{ timestamps: true, versionKey: false }

);

&nbsp;

// Indexes

QuestionSchema.index({ skill: 1, part: 1, type: 1 });

QuestionSchema.index({ createdBy: 1 });

&nbsp;

export const QuestionModel \= model\<IQuestion\>("Question", QuestionSchema);

### 4.4. Exam Model (`src/modules/exams/exam.model.ts`)

import { Schema, model, Document, Types } from "mongoose";

import { SkillType } from "../questions/question.model";

&nbsp;

export type ExamStatus \= "draft" | "published" | "closed";

&nbsp;

export interface IExamSection {

&nbsp;&nbsp;skill: SkillType;

&nbsp;&nbsp;part: number;

&nbsp;&nbsp;title: string;

&nbsp;&nbsp;instructions?: string;

&nbsp;&nbsp;passageText?: string; // Đoạn văn đọc Reading Passage 1, 2, 3

&nbsp;&nbsp;mediaIds?: Types.ObjectId\[\]; // File Audio cho Listening Section hoặc hình ảnh chung

&nbsp;&nbsp;questionIds: Types.ObjectId\[\]; // Danh sách ID các câu hỏi thuộc Section này

}

&nbsp;

export interface IExam extends Document {

&nbsp;&nbsp;\_id: Types.ObjectId;

&nbsp;&nbsp;title: string;

&nbsp;&nbsp;description?: string;

&nbsp;&nbsp;durationMinutes: number; // Ví dụ: 60 (Reading/Writing), 40 (Listening)

&nbsp;&nbsp;sections: IExamSection\[\];

&nbsp;&nbsp;status: ExamStatus;

&nbsp;&nbsp;openAt?: Date;

&nbsp;&nbsp;closeAt?: Date;

&nbsp;&nbsp;createdBy: Types.ObjectId;

&nbsp;&nbsp;createdAt: Date;

&nbsp;&nbsp;updatedAt: Date;

}

&nbsp;

const ExamSectionSchema \= new Schema\<IExamSection\>(

&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;skill: { type: String, enum: \["listening", "reading", "writing"\], required: true },

&nbsp;&nbsp;&nbsp;&nbsp;part: { type: Number, required: true },

&nbsp;&nbsp;&nbsp;&nbsp;title: { type: String, required: true },

&nbsp;&nbsp;&nbsp;&nbsp;instructions: { type: String },

&nbsp;&nbsp;&nbsp;&nbsp;passageText: { type: String },

&nbsp;&nbsp;&nbsp;&nbsp;mediaIds: \[{ type: Schema.Types.ObjectId, ref: "Media" }\],

&nbsp;&nbsp;&nbsp;&nbsp;questionIds: \[{ type: Schema.Types.ObjectId, ref: "Question" }\],

&nbsp;&nbsp;},

&nbsp;&nbsp;{ \_id: false }

);

&nbsp;

const ExamSchema \= new Schema\<IExam\>(

&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;title: { type: String, required: true, trim: true },

&nbsp;&nbsp;&nbsp;&nbsp;description: { type: String, trim: true },

&nbsp;&nbsp;&nbsp;&nbsp;durationMinutes: { type: Number, required: true, default: 60 },

&nbsp;&nbsp;&nbsp;&nbsp;sections: \[ExamSectionSchema\],

&nbsp;&nbsp;&nbsp;&nbsp;status: { type: String, enum: \["draft", "published", "closed"\], default: "draft" },

&nbsp;&nbsp;&nbsp;&nbsp;openAt: { type: Date },

&nbsp;&nbsp;&nbsp;&nbsp;closeAt: { type: Date },

&nbsp;&nbsp;&nbsp;&nbsp;createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

&nbsp;&nbsp;},

&nbsp;&nbsp;{ timestamps: true, versionKey: false }

);

&nbsp;

// Indexes

ExamSchema.index({ status: 1, createdBy: 1 });

ExamSchema.index({ openAt: 1, closeAt: 1 });

&nbsp;

export const ExamModel \= model\<IExam\>("Exam", ExamSchema);

### 4.5. Assignment Model (`src/modules/assignments/assignment.model.ts`)

import { Schema, model, Document, Types } from "mongoose";

&nbsp;

export type AssignmentStatus \= "active" | "archived";

&nbsp;

export interface IAssignment extends Document {

&nbsp;&nbsp;\_id: Types.ObjectId;

&nbsp;&nbsp;examId: Types.ObjectId;

&nbsp;&nbsp;teacherId: Types.ObjectId;

&nbsp;&nbsp;classId?: Types.ObjectId; // Giao cho toàn bộ lớp

&nbsp;&nbsp;studentId?: Types.ObjectId; // Giao riêng cho từng học sinh

&nbsp;&nbsp;assignedAt: Date;

&nbsp;&nbsp;deadline?: Date;

&nbsp;&nbsp;status: AssignmentStatus;

&nbsp;&nbsp;createdAt: Date;

&nbsp;&nbsp;updatedAt: Date;

}

&nbsp;

const AssignmentSchema \= new Schema\<IAssignment\>(

&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },

&nbsp;&nbsp;&nbsp;&nbsp;teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },

&nbsp;&nbsp;&nbsp;&nbsp;classId: { type: Schema.Types.ObjectId, ref: "Class" },

&nbsp;&nbsp;&nbsp;&nbsp;studentId: { type: Schema.Types.ObjectId, ref: "User" },

&nbsp;&nbsp;&nbsp;&nbsp;assignedAt: { type: Date, default: Date.now },

&nbsp;&nbsp;&nbsp;&nbsp;deadline: { type: Date },

&nbsp;&nbsp;&nbsp;&nbsp;status: { type: String, enum: \["active", "archived"\], default: "active" },

&nbsp;&nbsp;},

&nbsp;&nbsp;{ timestamps: true, versionKey: false }

);

&nbsp;

// Indexes

AssignmentSchema.index({ classId: 1, status: 1 });

AssignmentSchema.index({ studentId: 1, status: 1 });

AssignmentSchema.index({ examId: 1 });

&nbsp;

export const AssignmentModel \= model\<IAssignment\>("Assignment", AssignmentSchema);

### 4.6. Attempt Model (`src/modules/attempts/attempt.model.ts`)

import { Schema, model, Document, Types } from "mongoose";

&nbsp;

export type AttemptStatus \= "in\_progress" | "submitted" | "expired";

&nbsp;

export interface IAttemptAnswer {

&nbsp;&nbsp;questionId: Types.ObjectId;

&nbsp;&nbsp;value: string; // Chuỗi câu trả lời hoặc đoạn văn Writing

&nbsp;&nbsp;savedAt: Date;

}

&nbsp;

export interface IAttemptScores {

&nbsp;&nbsp;listeningRaw?: number; // Số câu đúng (0-40)

&nbsp;&nbsp;listeningBand?: number; // Quy đổi 0.0 \- 9.0

&nbsp;&nbsp;readingRaw?: number; // Số câu đúng (0-40)

&nbsp;&nbsp;readingBand?: number; // Quy đổi 0.0 \- 9.0

&nbsp;&nbsp;writingTask1Band?: number;

&nbsp;&nbsp;writingTask2Band?: number;

&nbsp;&nbsp;writingBand?: number; // (Task 1 \+ Task 2 \* 2\) / 3

&nbsp;&nbsp;overallBand?: number; // Trung bình cộng làm tròn 0.5

}

&nbsp;

export interface IAttempt extends Document {

&nbsp;&nbsp;\_id: Types.ObjectId;

&nbsp;&nbsp;examId: Types.ObjectId;

&nbsp;&nbsp;studentId: Types.ObjectId;

&nbsp;&nbsp;assignmentId?: Types.ObjectId;

&nbsp;&nbsp;startedAt: Date;

&nbsp;&nbsp;expiresAt: Date; // Server-authoritative time

&nbsp;&nbsp;submittedAt?: Date;

&nbsp;&nbsp;status: AttemptStatus;

&nbsp;&nbsp;answers: IAttemptAnswer\[\];

&nbsp;&nbsp;scores: IAttemptScores;

&nbsp;&nbsp;suspicious: boolean;

&nbsp;&nbsp;createdAt: Date;

&nbsp;&nbsp;updatedAt: Date;

}

&nbsp;

const AttemptAnswerSchema \= new Schema\<IAttemptAnswer\>(

&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },

&nbsp;&nbsp;&nbsp;&nbsp;value: { type: String, required: true },

&nbsp;&nbsp;&nbsp;&nbsp;savedAt: { type: Date, default: Date.now },

&nbsp;&nbsp;},

&nbsp;&nbsp;{ \_id: false }

);

&nbsp;

const AttemptSchema \= new Schema\<IAttempt\>(

&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },

&nbsp;&nbsp;&nbsp;&nbsp;studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },

&nbsp;&nbsp;&nbsp;&nbsp;assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment" },

&nbsp;&nbsp;&nbsp;&nbsp;startedAt: { type: Date, required: true, default: Date.now },

&nbsp;&nbsp;&nbsp;&nbsp;expiresAt: { type: Date, required: true },

&nbsp;&nbsp;&nbsp;&nbsp;submittedAt: { type: Date },

&nbsp;&nbsp;&nbsp;&nbsp;status: { type: String, enum: \["in\_progress", "submitted", "expired"\], default: "in\_progress" },

&nbsp;&nbsp;&nbsp;&nbsp;answers: \[AttemptAnswerSchema\],

&nbsp;&nbsp;&nbsp;&nbsp;scores: {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;listeningRaw: { type: Number },

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;listeningBand: { type: Number },

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;readingRaw: { type: Number },

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;readingBand: { type: Number },

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;writingTask1Band: { type: Number },

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;writingTask2Band: { type: Number },

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;writingBand: { type: Number },

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;overallBand: { type: Number },

&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;suspicious: { type: Boolean, default: false },

&nbsp;&nbsp;},

&nbsp;&nbsp;{ timestamps: true, versionKey: false }

);

&nbsp;

// Indexes

AttemptSchema.index({ studentId: 1, examId: 1 });

AttemptSchema.index({ assignmentId: 1 });

AttemptSchema.index({ status: 1, expiresAt: 1 });

&nbsp;

export const AttemptModel \= model\<IAttempt\>("Attempt", AttemptSchema);

### 4.7. Writing Review Model (`src/modules/grading/writing-review.model.ts`)

import { Schema, model, Document, Types } from "mongoose";

&nbsp;

export interface ITaskGrade {

&nbsp;&nbsp;score: number; // Band score 0.0 \- 9.0 (bước 0.5)

&nbsp;&nbsp;comment?: string;

}

&nbsp;

export interface IWritingReview extends Document {

&nbsp;&nbsp;\_id: Types.ObjectId;

&nbsp;&nbsp;attemptId: Types.ObjectId;

&nbsp;&nbsp;studentId: Types.ObjectId;

&nbsp;&nbsp;teacherId: Types.ObjectId;

&nbsp;&nbsp;task1: ITaskGrade;

&nbsp;&nbsp;task2: ITaskGrade;

&nbsp;&nbsp;overallWritingScore: number; // Công thức: roundIelts((Task 1 \+ Task 2 \* 2\) / 3\)

&nbsp;&nbsp;generalFeedback?: string;

&nbsp;&nbsp;createdAt: Date;

&nbsp;&nbsp;updatedAt: Date;

}

&nbsp;

const WritingReviewSchema \= new Schema\<IWritingReview\>(

&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;attemptId: { type: Schema.Types.ObjectId, ref: "Attempt", required: true, unique: true },

&nbsp;&nbsp;&nbsp;&nbsp;studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },

&nbsp;&nbsp;&nbsp;&nbsp;teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },

&nbsp;&nbsp;&nbsp;&nbsp;task1: {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;score: { type: Number, required: true, min: 0, max: 9.0 },

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;comment: { type: String },

&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;task2: {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;score: { type: Number, required: true, min: 0, max: 9.0 },

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;comment: { type: String },

&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;overallWritingScore: { type: Number, required: true, min: 0, max: 9.0 },

&nbsp;&nbsp;&nbsp;&nbsp;generalFeedback: { type: String },

&nbsp;&nbsp;},

&nbsp;&nbsp;{ timestamps: true, versionKey: false }

);

&nbsp;

// Indexes

WritingReviewSchema.index({ attemptId: 1 }, { unique: true });

WritingReviewSchema.index({ teacherId: 1 });

WritingReviewSchema.index({ studentId: 1 });

&nbsp;

export const WritingReviewModel \= model\<IWritingReview\>("WritingReview", WritingReviewSchema);

### 4.8. Media Model (`src/modules/media/media.model.ts`)

import { Schema, model, Document, Types } from "mongoose";

&nbsp;

export type MediaType \= "audio" | "image";

&nbsp;

export interface IMedia extends Document {

&nbsp;&nbsp;\_id: Types.ObjectId;

&nbsp;&nbsp;bucket: string;

&nbsp;&nbsp;key: string; // S3 object key (e.g. "audio/2026/09/uuid\_listening-sec1.mp3")

&nbsp;&nbsp;originalName: string;

&nbsp;&nbsp;mimeType: string;

&nbsp;&nbsp;size: number; // Bytes

&nbsp;&nbsp;type: MediaType;

&nbsp;&nbsp;uploadedBy: Types.ObjectId;

&nbsp;&nbsp;createdAt: Date;

&nbsp;&nbsp;updatedAt: Date;

}

&nbsp;

const MediaSchema \= new Schema\<IMedia\>(

&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;bucket: { type: String, required: true },

&nbsp;&nbsp;&nbsp;&nbsp;key: { type: String, required: true, unique: true },

&nbsp;&nbsp;&nbsp;&nbsp;originalName: { type: String, required: true },

&nbsp;&nbsp;&nbsp;&nbsp;mimeType: { type: String, required: true },

&nbsp;&nbsp;&nbsp;&nbsp;size: { type: Number, required: true },

&nbsp;&nbsp;&nbsp;&nbsp;type: { type: String, enum: \["audio", "image"\], required: true },

&nbsp;&nbsp;&nbsp;&nbsp;uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

&nbsp;&nbsp;},

&nbsp;&nbsp;{ timestamps: true, versionKey: false }

);

&nbsp;

// Indexes

MediaSchema.index({ key: 1 }, { unique: true });

MediaSchema.index({ uploadedBy: 1 });

&nbsp;

export const MediaModel \= model\<IMedia\>("Media", MediaSchema);

### 4.9. Exam Event Model (Anti-cheat) (`src/modules/anti-cheat/exam-event.model.ts`)

import { Schema, model, Document, Types } from "mongoose";

&nbsp;

export type ExamEventType \=

&nbsp;&nbsp;| "TAB\_SWITCH"

&nbsp;&nbsp;| "WINDOW\_BLUR"

&nbsp;&nbsp;| "FULLSCREEN\_EXIT"

&nbsp;&nbsp;| "RELOAD"

&nbsp;&nbsp;| "COPY"

&nbsp;&nbsp;| "PASTE"

&nbsp;&nbsp;| "CUT"

&nbsp;&nbsp;| "CONTEXT\_MENU";

&nbsp;

export interface IExamEvent extends Document {

&nbsp;&nbsp;\_id: Types.ObjectId;

&nbsp;&nbsp;attemptId: Types.ObjectId;

&nbsp;&nbsp;studentId: Types.ObjectId;

&nbsp;&nbsp;type: ExamEventType;

&nbsp;&nbsp;timestamp: Date;

&nbsp;&nbsp;metadata?: Record\<string, any\>;

&nbsp;&nbsp;createdAt: Date;

}

&nbsp;

const ExamEventSchema \= new Schema\<IExamEvent\>(

&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;attemptId: { type: Schema.Types.ObjectId, ref: "Attempt", required: true },

&nbsp;&nbsp;&nbsp;&nbsp;studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },

&nbsp;&nbsp;&nbsp;&nbsp;type: {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;type: String,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;enum: \[

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"TAB\_SWITCH",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"WINDOW\_BLUR",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"FULLSCREEN\_EXIT",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"RELOAD",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"COPY",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"PASTE",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"CUT",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"CONTEXT\_MENU",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\],

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;required: true,

&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;timestamp: { type: Date, required: true, default: Date.now },

&nbsp;&nbsp;&nbsp;&nbsp;metadata: { type: Schema.Types.Mixed, default: {} },

&nbsp;&nbsp;},

&nbsp;&nbsp;{ timestamps: { createdAt: true, updatedAt: false }, versionKey: false }

);

&nbsp;

// Indexes

ExamEventSchema.index({ attemptId: 1, type: 1 });

ExamEventSchema.index({ studentId: 1 });

&nbsp;

export const ExamEventModel \= model\<IExamEvent\>("ExamEvent", ExamEventSchema);

---

## 5\. ĐẶC TẢ CHI TIẾT 10 MODULES NGHIỆP VỤ

### 5.1. Module Auth & Users

* **RBAC:** 3 roles: `student`, `teacher`, `admin`.  
* **JWT Architecture:**  
  * **Access Token:** Ký bằng `JWT_ACCESS_SECRET`, thời gian sống 15 phút. Gửi trong HTTP Request Header: `Authorization: Bearer <token>`. Payload chứa: `{ sub: userId, role, email }`.  
  * **Refresh Token:** Ký bằng `JWT_REFRESH_SECRET`, thời gian sống 7 ngày. Lưu trữ trong **HTTP-only, Secure, SameSite=Strict Cookie** với path `/api/auth`.  
* **Mật khẩu:** Hash bằng `bcrypt` với `saltRounds = 12`.  
* **Chính sách Đổi & Quên Mật Khẩu (Không dùng SMTP):**  
  * *Đổi mật khẩu:* Người dùng đã đăng nhập gọi `POST /api/auth/change-password` kèm mật khẩu cũ và mật khẩu mới.  
  * *Quên mật khẩu:* Admin reset mật khẩu cho người dùng qua `POST /api/users/:id/reset-password`. Hệ thống không cấu hình SMTP/gửi email token trong MVP.

### 5.2. Module Classes

* **Sinh Class Code:** Tự động tạo ngẫu nhiên chuỗi 6 ký tự gồm chữ cái in hoa và số (loại trừ các ký tự dễ nhầm lẫn như `0, O, 1, I, L`). Kiểm tra tính duy nhất trong database trước khi lưu.  
* **2 Luồng Thêm Học Sinh vào Lớp:**  
  1. *Học sinh tự nhập mã lớp:* Học sinh nhập Class Code trên giao diện học viên. Server tìm lớp theo `code`, kiểm tra học sinh đã thuộc `students` chưa \-\> push vào mảng `students`.  
  2. *Giáo viên mời trực tiếp qua Email:* Giáo viên nhập email học sinh. Server tìm User có email tương ứng \-\> thêm vào `students` của lớp.  
* **Quản lý danh sách lớp & học sinh:**  
  * Giáo viên xem danh sách các lớp mình phụ trách qua `GET /api/classes`.  
  * Xem chi tiết lớp và danh sách học sinh qua `GET /api/classes/:id`.  
  * Giáo viên có quyền loại học sinh khỏi lớp qua `DELETE /api/classes/:id/students/:studentId`.

### 5.3. Module Question Bank

* Quản lý tập trung toàn bộ câu hỏi phân loại theo `skill`, `part`, và `type`.  
* **Cấu hình động (`data: Mixed`):**  
  * *Multiple Choice:* `data: { options: [{ id: "A", text: "..." }, { id: "B", text: "..." }] }`  
  * *Matching:* `data: { premises: [...], targets: [...] }`  
  * *Summary Completion / Form Completion:* `data: { templateText: "Name: ... Age: [2] ..." }`  
  * *Map / Diagram Labelling:* `data: { diagramMediaId: "...", labels: [{ id: "A", x: 120, y: 300 }] }`  
* **Mảng `acceptedAnswers: string[]`:** Chứa danh sách các chuỗi câu trả lời được chấp nhận (ví dụ: `["theatre", "theater", "the theatre", "a theater"]`).  
* **CRUD Đầy đủ:** Hỗ trợ tạo mới, đọc chi tiết, cập nhật nội dung và xóa câu hỏi.

### 5.4. Module Exam Management

* Quản lý đề thi với mảng `sections` và trạng thái: `draft`, `published`, `closed`.  
* **HỖ TRỢ 2 PHƯƠNG THỨC THÊM CÂU HỎI VÀO ĐỀ THI:**  
  * **Phương thức 1: Chọn từ Question Bank có sẵn:** Giáo viên mở danh sách Question Bank, lọc theo Skill/Part, tích chọn và gán `questionIds` vào Section tương ứng.  
  * **Phương thức 2: Inline / Quick Create Question tại chỗ:** Ngay trong màn hình tạo/sửa đề, giáo viên nhấn "+ Tạo câu hỏi mới". Client gọi `POST /api/questions` lưu câu hỏi độc lập vào `Question` collection, nhận về `_id` và tự động gắn vào mảng `questionIds` của Section trong Exam hiện tại.  
* **Vòng đời & Quản lý Đề:**  
  * `GET /api/exams`: Danh sách đề thi (có thể lọc theo status).  
  * `GET /api/exams/:id`: Xem chi tiết cấu trúc đề thi.  
  * `PUT /api/exams/:id`: Cập nhật nội dung/sections của đề (chỉ cho phép khi status \= `draft`).  
  * `DELETE /api/exams/:id`: Xóa đề thi (chỉ cho phép khi status \= `draft`).  
  * `POST /api/exams/:id/clone`: Nhân bản đề thi sang bản sao mới ở trạng thái `draft`.  
  * `PATCH /api/exams/:id/publish` & `PATCH /api/exams/:id/close`: Mở hoặc đóng đề thi.

### 5.5. Module Assignments

* Hỗ trợ giao bài cho:  
  * Cả lớp qua `classId`.  
  * Hoặc từng học sinh cụ thể qua `studentId`.  
* Thiết lập `deadline`. Học sinh không thể bắt đầu làm bài nếu đã quá hạn nộp.  
* Xem danh sách bài tập của học sinh qua `GET /api/assignments/my`.

### 5.6. Module Attempts & Exam Engine (Core Engine)

* **1\. Server-Authoritative Timer:**  
  * Khi bắt đầu (`POST /api/attempts`):  
    * `startedAt = new Date()`  
    * `expiresAt = new Date(startedAt.getTime() + exam.durationMinutes * 60 * 1000)`  
    * Thời gian còn lại phía server: $\\text{remainingSeconds} \= \\max\\left(0, \\left\\lfloor \\frac{\\text{expiresAt} \- \\text{now}}{1000} \\right\\rfloor\\right)$.  
* **2\. Bảo mật chống rò rỉ đáp án (Data Projection / Sanitization Rule):**  
  * Khi học sinh gọi `POST /api/attempts` hoặc `GET /api/attempts/:id` (State recovery), API populate thông tin đề thi và câu hỏi nhưng **TUYỆT ĐỐI KHÔNG TRẢ VỀ** trường `acceptedAnswers` và `explanation`.  
* **3\. Endpoint Autosave (`PATCH /api/attempts/:id/answers`):**  
  * Nhận mảng answers cập nhật từ client: `answers: [{ questionId, value }]`.  
  * Thực hiện upsert từng câu hỏi trong mảng `attempt.answers`.  
  * Nếu `attempt.status !== "in_progress"` hoặc `now > expiresAt + GRACE_PERIOD (15s)` \-\> từ chối và trả lỗi `EXAM_EXPIRED`.  
* **4\. Endpoint State Recovery (`GET /api/attempts/:id`):**  
  * Khi học sinh F5 hoặc rớt mạng kết nối lại, trả về toàn bộ danh sách đáp án đã lưu kèm `remainingSeconds` tính chính xác tại thời điểm truy vấn.  
* **5\. Endpoint Submit (`POST /api/attempts/:id/submit`):**  
  * Kiểm tra thời gian: Cho phép độ trễ mạng tối đa 15 giây (`expiresAt + 15s`).  
  * Khóa trạng thái: Đổi `status = "submitted"` và `submittedAt = new Date()`.  
  * Kích hoạt **Auto-Grading Service** ngay lập tức cho Listening và Reading.  
* **6\. Endpoint View Result (`GET /api/attempts/:id/result`):**  
  * Dành cho học sinh xem lại bài thi sau khi nộp (hiển thị câu trả lời của mình, đáp án đúng `acceptedAnswers`, lời giải `explanation`, điểm số L/R và điểm/nhận xét Writing nếu giáo viên đã chấm).

### 5.7. Module Auto-Grading (Listening & Reading)

* **Thuật toán Chuẩn hóa Chuỗi (String Normalization):**  
  1. Loại bỏ khoảng trắng đầu/cuối chuỗi (`trim()`).  
  2. Chuyển đổi toàn bộ về chữ thường (`toLowerCase()`).  
  3. Gom nhiều khoảng trắng liên tiếp hoặc ký tự xuống dòng thành 1 dấu cách đơn (`replace(/\s+/g, " ")`).  
  4. Chuẩn hóa dấu nháy đơn và loại bỏ các ký tự đặc biệt không ảnh hưởng ngữ nghĩa.  
* **So khớp:** Đối chiếu chuỗi đã chuẩn hóa với danh sách `acceptedAnswers` của từng câu hỏi. Đúng được 1 điểm (`points = 1`).  
* **Bảng Quy đổi Điểm IELTS Band Score (0 \- 40 Raw Score):**

// src/config/constants.ts

export const LISTENING\_BAND\_TABLE: Record\<number, number\> \= {

&nbsp;&nbsp;39: 9.0, 40: 9.0,

&nbsp;&nbsp;37: 8.5, 38: 8.5,

&nbsp;&nbsp;35: 8.0, 36: 8.0,

&nbsp;&nbsp;32: 7.5, 33: 7.5, 34: 7.5,

&nbsp;&nbsp;30: 7.0, 31: 7.0,

&nbsp;&nbsp;26: 6.5, 27: 6.5, 28: 6.5, 29: 6.5,

&nbsp;&nbsp;23: 6.0, 24: 6.0, 25: 6.0,

&nbsp;&nbsp;18: 5.5, 19: 5.5, 20: 5.5, 21: 5.5, 22: 5.5,

&nbsp;&nbsp;16: 5.0, 17: 5.0,

&nbsp;&nbsp;13: 4.5, 14: 4.5, 15: 4.5,

&nbsp;&nbsp;10: 4.0, 11: 4.0, 12: 4.0,

&nbsp;&nbsp;8: 3.5, 9: 3.5,

&nbsp;&nbsp;6: 3.0, 7: 3.0,

&nbsp;&nbsp;4: 2.5, 5: 2.5

};

&nbsp;

export const READING\_ACADEMIC\_BAND\_TABLE: Record\<number, number\> \= {

&nbsp;&nbsp;39: 9.0, 40: 9.0,

&nbsp;&nbsp;37: 8.5, 38: 8.5,

&nbsp;&nbsp;35: 8.0, 36: 8.0,

&nbsp;&nbsp;33: 7.5, 34: 7.5,

&nbsp;&nbsp;30: 7.0, 31: 7.0, 32: 7.0,

&nbsp;&nbsp;27: 6.5, 28: 6.5, 29: 6.5,

&nbsp;&nbsp;23: 6.0, 24: 6.0, 25: 6.0, 26: 6.0,

&nbsp;&nbsp;19: 5.5, 20: 5.5, 21: 5.5, 22: 5.5,

&nbsp;&nbsp;15: 5.0, 16: 5.0, 17: 5.0, 18: 5.0,

&nbsp;&nbsp;13: 4.5, 14: 4.5,

&nbsp;&nbsp;10: 4.0, 11: 4.0, 12: 4.0,

&nbsp;&nbsp;8: 3.5, 9: 3.5,

&nbsp;&nbsp;6: 3.0, 7: 3.0,

&nbsp;&nbsp;4: 2.5, 5: 2.5

};

&nbsp;

export function calculateBandScore(rawScore: number, skill: "listening" | "reading"): number {

&nbsp;&nbsp;if (rawScore \<= 3\) return 2.0;

&nbsp;&nbsp;if (rawScore \> 40\) rawScore \= 40;

&nbsp;&nbsp;const table \= skill \=== "listening" ? LISTENING\_BAND\_TABLE : READING\_ACADEMIC\_BAND\_TABLE;

&nbsp;&nbsp;return table\[rawScore\] ?? 2.5;

}

### 5.8. Module Writing Grading (Manual Review & Teacher Workflow)

* Chấm thủ công bởi giáo viên (không dùng AI trong MVP).  
* **Công thức Tính điểm Writing IELTS:**

$$\\text{Writing Band} \= \\frac{\\text{Task 1 Score} \+ (\\text{Task 2 Score} \\times 2)}{3}$$

* **Quy tắc Làm tròn Điểm IELTS:**  
  * Phần lẻ $\< 0.25 \\rightarrow$ làm tròn xuống band nguyên gần nhất (ví dụ: $6.125 \\rightarrow 6.0$).  
  * Phần lẻ $\\ge 0.25$ và $\< 0.75 \\rightarrow$ làm tròn thành $.5$ (ví dụ: $6.25 \\rightarrow 6.5$; $6.625 \\rightarrow 6.5$).  
  * Phần lẻ $\\ge 0.75 \\rightarrow$ làm tròn lên band nguyên tiếp theo (ví dụ: $6.75 \\rightarrow 7.0$).

// src/common/utils/ielts-calculator.ts

export function roundIeltsBand(score: number): number {

&nbsp;&nbsp;const floor \= Math.floor(score);

&nbsp;&nbsp;const decimal \= score \- floor;

&nbsp;&nbsp;if (decimal \< 0.25) {

&nbsp;&nbsp;&nbsp;&nbsp;return floor;

&nbsp;&nbsp;} else if (decimal \< 0.75) {

&nbsp;&nbsp;&nbsp;&nbsp;return floor \+ 0.5;

&nbsp;&nbsp;} else {

&nbsp;&nbsp;&nbsp;&nbsp;return floor \+ 1.0;

&nbsp;&nbsp;}

}

&nbsp;

export function calculateOverallBand(scores: {

&nbsp;&nbsp;listening?: number;

&nbsp;&nbsp;reading?: number;

&nbsp;&nbsp;writing?: number;

}): number {

&nbsp;&nbsp;const validScores: number\[\] \= \[\];

&nbsp;&nbsp;if (scores.listening \!== undefined) validScores.push(scores.listening);

&nbsp;&nbsp;if (scores.reading \!== undefined) validScores.push(scores.reading);

&nbsp;&nbsp;if (scores.writing \!== undefined) validScores.push(scores.writing);

&nbsp;

&nbsp;&nbsp;if (validScores.length \=== 0\) return 0;

&nbsp;&nbsp;const rawAvg \= validScores.reduce((a, b) \=\> a \+ b, 0\) / validScores.length;

&nbsp;&nbsp;return roundIeltsBand(rawAvg);

}

* **Luồng chấm bài của Giáo viên:**  
  * Giáo viên gọi `GET /api/grading/pending` để xem danh sách bài nộp cần chấm Writing.  
  * Mở bài thi qua `GET /api/attempts/:id/grading` để đọc bài viết Task 1, Task 2 của học sinh kèm số từ thực tế.  
  * Nhập điểm và nhận xét qua `POST /api/writing-reviews`.

### 5.9. Module Media & MinIO Integration

* Express API đóng vai trò cấp quyền (Presigned URL Signer), không trực tiếp nhận stream dữ liệu lớn.  
* **Quy trình Upload Media:**  
  1. Client gửi `POST /api/media/presign` kèm `{ filename, mimeType, type: "audio" | "image" }`.  
  2. Server kiểm tra MIME type (`audio/mpeg`, `audio/wav`, `image/png`, `image/jpeg`).  
  3. Server tạo S3 object key duy nhất dạng: `uploads/{type}/{YYYY}/{MM}/{uuid}_{cleanFilename}`.  
  4. Server gọi `minioClient.presignedPutObject(bucket, key, 15 * 60)` (hết hạn sau 15 phút).  
  5. Server trả về `uploadUrl` (Presigned PUT URL) và `mediaId` (tạo trước bản ghi `Media` ở DB).  
  6. Client thực hiện HTTP `PUT` trực tiếp từ browser lên `uploadUrl` với binary payload.  
  7. Client gọi `POST /api/media/:id/confirm` để xác nhận file upload thành công.  
* **Public Streaming:** Truy cập trực tiếp qua domain cấu hình qua Cloudflare Tunnel: `PUBLIC_MEDIA_URL = https://media.yourdomain.com/<bucket>/<key>`.

### 5.10. Module Anti-cheat Events

* **Các sự kiện ghi nhận:** `TAB_SWITCH`, `WINDOW_BLUR`, `FULLSCREEN_EXIT`, `RELOAD`, `COPY`, `PASTE`, `CUT`, `CONTEXT_MENU`.  
* **Ngưỡng Cảnh báo Tự động (`suspicious = true`):**  
  * `TAB_SWITCH` \+ `WINDOW_BLUR` $\\ge 5$ lần.  
  * `FULLSCREEN_EXIT` $\\ge 2$ lần.  
  * `PASTE` $\\ge 3$ lần (trong phần Writing).  
* Khi vượt ngưỡng, server tự động cập nhật cờ `suspicious = true` trên `AttemptModel`.

---

## 6\. DANH MỤC RESTFUL API ENDPOINTS & ZOD SCHEMAS

### 6.1. Authentication & Users Endpoints

#### 1\. POST `/api/auth/register`

* **Mô tả:** Đăng ký tài khoản học sinh mới.  
* **Middleware:** `rateLimiter(10, "15m")`  
* **Zod Schema:**

export const RegisterSchema \= z.object({

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;email: z.string().email("Email không hợp lệ"),

&nbsp;&nbsp;&nbsp;&nbsp;password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),

&nbsp;&nbsp;&nbsp;&nbsp;fullName: z.string().min(2, "Họ tên tối thiểu 2 ký tự"),

&nbsp;&nbsp;&nbsp;&nbsp;phone: z.string().optional(),

&nbsp;&nbsp;&nbsp;&nbsp;targetBand: z.number().min(0).max(9).optional().default(6.5),

&nbsp;&nbsp;}),

});

* **Response 201:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"user": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e85d1c262f3b9200000001",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"email": "student@example.com",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"fullName": "Nguyen Van A",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"role": "student",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"targetBand": 6.5

&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;"accessToken": "eyJhbGciOiJIUzI1NiIs..."

&nbsp;&nbsp;}

}

#### 2\. POST `/api/auth/login`

* **Mô tả:** Đăng nhập hệ thống, trả access token và đặt refresh token vào HTTP-only cookie.  
* **Middleware:** `rateLimiter(10, "15m")`  
* **Zod Schema:**

export const LoginSchema \= z.object({

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;email: z.string().email(),

&nbsp;&nbsp;&nbsp;&nbsp;password: z.string(),

&nbsp;&nbsp;}),

});

* **Response 200:** (Set-Cookie: `refreshToken=...; HttpOnly; Secure; SameSite=Strict; Path=/api/auth`)

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"user": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e85d1c262f3b9200000001",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"email": "student@example.com",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"fullName": "Nguyen Van A",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"role": "student"

&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;"accessToken": "eyJhbGciOiJIUzI1NiIs..."

&nbsp;&nbsp;}

}

#### 3\. POST `/api/auth/change-password` (MỚI)

* **Mô tả:** Người dùng đã đăng nhập tự thay đổi mật khẩu của mình.  
* **Middleware:** `authenticate`  
* **Zod Schema:**

export const ChangePasswordSchema \= z.object({

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;oldPassword: z.string().min(1, "Vui lòng nhập mật khẩu hiện tại"),

&nbsp;&nbsp;&nbsp;&nbsp;newPassword: z.string().min(8, "Mật khẩu mới tối thiểu 8 ký tự"),

&nbsp;&nbsp;}),

});

* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": { "message": "Đổi mật khẩu thành công" }

}

#### 4\. POST `/api/users/:id/reset-password` (MỚI — Admin Reset Thủ Công)

* **Mô tả:** Quản trị viên hỗ trợ đặt lại mật khẩu thủ công cho học sinh/giáo viên khi quên mật khẩu (thay thế dịch vụ gửi email SMTP).  
* **Middleware:** `authenticate`, `requireRoles("admin")`  
* **Zod Schema:**

export const AdminResetPasswordSchema \= z.object({

&nbsp;&nbsp;params: z.object({ id: z.string() }),

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;newPassword: z.string().min(8, "Mật khẩu mới tối thiểu 8 ký tự"),

&nbsp;&nbsp;}),

});

* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": { "message": "Đặt lại mật khẩu người dùng thành công" }

}

#### 5\. POST `/api/auth/refresh`

* **Mô tả:** Cấp access token mới dựa trên Refresh Token lưu trong Cookie.  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"accessToken": "eyJhbGciOiJIUzI1NiIs..."

&nbsp;&nbsp;}

}

#### 6\. POST `/api/auth/logout`

* **Mô tả:** Đăng xuất và xóa cookie.  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": { "message": "Đăng xuất thành công" }

}

#### 7\. GET `/api/users/me`

* **Mô tả:** Lấy thông tin tài khoản hiện tại.  
* **Middleware:** `authenticate`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e85d1c262f3b9200000001",

&nbsp;&nbsp;&nbsp;&nbsp;"email": "student@example.com",

&nbsp;&nbsp;&nbsp;&nbsp;"fullName": "Nguyen Van A",

&nbsp;&nbsp;&nbsp;&nbsp;"role": "student",

&nbsp;&nbsp;&nbsp;&nbsp;"targetBand": 6.5

&nbsp;&nbsp;}

}

---

### 6.2. Classes Endpoints

#### 1\. GET `/api/classes` (MỚI)

* **Mô tả:** Lấy danh sách lớp học (Giáo viên xem các lớp mình tạo; Học sinh xem các lớp mình tham gia).  
* **Middleware:** `authenticate`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": \[

&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8601c262f3b9200000002",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"name": "IELTS Intensive K12",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"code": "KH79E2",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"description": "Lớp ôn cấp tốc mục tiêu 7.0",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"studentsCount": 15

&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;\]

}

#### 2\. POST `/api/classes`

* **Mô tả:** Tạo lớp học mới (Giáo viên / Admin).  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Zod Schema:**

export const CreateClassSchema \= z.object({

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;name: z.string().min(2, "Tên lớp tối thiểu 2 ký tự"),

&nbsp;&nbsp;&nbsp;&nbsp;description: z.string().optional(),

&nbsp;&nbsp;}),

});

* **Response 201:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8601c262f3b9200000002",

&nbsp;&nbsp;&nbsp;&nbsp;"name": "IELTS Intensive K12",

&nbsp;&nbsp;&nbsp;&nbsp;"code": "KH79E2",

&nbsp;&nbsp;&nbsp;&nbsp;"description": "Lớp ôn cấp tốc mục tiêu 7.0",

&nbsp;&nbsp;&nbsp;&nbsp;"teacherId": "66e85d1c262f3b9200000000",

&nbsp;&nbsp;&nbsp;&nbsp;"studentsCount": 0

&nbsp;&nbsp;}

}

#### 3\. GET `/api/classes/:id` (MỚI)

* **Mô tả:** Xem chi tiết thông tin lớp học và danh sách học sinh.  
* **Middleware:** `authenticate`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8601c262f3b9200000002",

&nbsp;&nbsp;&nbsp;&nbsp;"name": "IELTS Intensive K12",

&nbsp;&nbsp;&nbsp;&nbsp;"code": "KH79E2",

&nbsp;&nbsp;&nbsp;&nbsp;"description": "Lớp ôn cấp tốc mục tiêu 7.0",

&nbsp;&nbsp;&nbsp;&nbsp;"students": \[

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e85d1c262f3b9200000001",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"email": "student@example.com",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"fullName": "Nguyen Van A",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"targetBand": 6.5

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;&nbsp;&nbsp;\]

&nbsp;&nbsp;}

}

#### 4\. POST `/api/classes/join`

* **Mô tả:** Học sinh tự nhập Class Code để tham gia lớp.  
* **Middleware:** `authenticate`, `requireRoles("student")`  
* **Zod Schema:**

export const JoinClassSchema \= z.object({

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;code: z.string().length(6, "Mã lớp gồm 6 ký tự"),

&nbsp;&nbsp;}),

});

* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"classId": "66e8601c262f3b9200000002",

&nbsp;&nbsp;&nbsp;&nbsp;"name": "IELTS Intensive K12",

&nbsp;&nbsp;&nbsp;&nbsp;"message": "Tham gia lớp học thành công"

&nbsp;&nbsp;}

}

#### 5\. POST `/api/classes/:id/students`

* **Mô tả:** Giáo viên thêm trực tiếp học sinh vào lớp bằng email.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Zod Schema:**

export const AddStudentSchema \= z.object({

&nbsp;&nbsp;params: z.object({ id: z.string() }),

&nbsp;&nbsp;body: z.object({ email: z.string().email() }),

});

* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"message": "Đã thêm học sinh vào lớp",

&nbsp;&nbsp;&nbsp;&nbsp;"student": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e85d1c262f3b9200000001",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"email": "student@example.com",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"fullName": "Nguyen Van A"

&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;}

}

#### 6\. DELETE `/api/classes/:id/students/:studentId` (MỚI)

* **Mô tả:** Giáo viên xóa/loại học sinh khỏi lớp học.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": { "message": "Đã xóa học sinh khỏi lớp học" }

}

---

### 6.3. Question Bank Endpoints

#### 1\. POST `/api/questions`

* **Mô tả:** Tạo mới câu hỏi trong Question Bank (hoặc Quick Create khi đang soạn đề).  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Zod Schema:**

export const CreateQuestionSchema \= z.object({

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;skill: z.enum(\["listening", "reading", "writing"\]),

&nbsp;&nbsp;&nbsp;&nbsp;type: z.string(),

&nbsp;&nbsp;&nbsp;&nbsp;part: z.number().int().min(1).max(4),

&nbsp;&nbsp;&nbsp;&nbsp;prompt: z.string().min(1),

&nbsp;&nbsp;&nbsp;&nbsp;content: z.string().optional(),

&nbsp;&nbsp;&nbsp;&nbsp;data: z.record(z.any()).default({}),

&nbsp;&nbsp;&nbsp;&nbsp;acceptedAnswers: z.array(z.string()).default(\[\]),

&nbsp;&nbsp;&nbsp;&nbsp;points: z.number().default(1),

&nbsp;&nbsp;&nbsp;&nbsp;explanation: z.string().optional(),

&nbsp;&nbsp;&nbsp;&nbsp;mediaIds: z.array(z.string()).optional().default(\[\]),

&nbsp;&nbsp;}),

});

* **Response 201:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8621c262f3b9200000003",

&nbsp;&nbsp;&nbsp;&nbsp;"skill": "listening",

&nbsp;&nbsp;&nbsp;&nbsp;"part": 1,

&nbsp;&nbsp;&nbsp;&nbsp;"type": "form\_completion",

&nbsp;&nbsp;&nbsp;&nbsp;"prompt": "Write NO MORE THAN TWO WORDS for each answer.",

&nbsp;&nbsp;&nbsp;&nbsp;"acceptedAnswers": \["student centre", "student center"\],

&nbsp;&nbsp;&nbsp;&nbsp;"points": 1

&nbsp;&nbsp;}

}

#### 2\. GET `/api/questions`

* **Mô tả:** Lọc danh sách câu hỏi trong ngân hàng theo skill, part, type.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": \[

&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8621c262f3b9200000003",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"skill": "listening",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"part": 1,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"type": "form\_completion",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"prompt": "Write NO MORE THAN TWO WORDS for each answer."

&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;\],

&nbsp;&nbsp;"meta": { "page": 1, "limit": 20, "total": 1 }

}

#### 3\. GET `/api/questions/:id` (MỚI)

* **Mô tả:** Xem chi tiết một câu hỏi trong Question Bank.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8621c262f3b9200000003",

&nbsp;&nbsp;&nbsp;&nbsp;"skill": "listening",

&nbsp;&nbsp;&nbsp;&nbsp;"part": 1,

&nbsp;&nbsp;&nbsp;&nbsp;"type": "form\_completion",

&nbsp;&nbsp;&nbsp;&nbsp;"prompt": "Write NO MORE THAN TWO WORDS for each answer.",

&nbsp;&nbsp;&nbsp;&nbsp;"acceptedAnswers": \["student centre", "student center"\],

&nbsp;&nbsp;&nbsp;&nbsp;"explanation": "Audio mentions 'visit the student center'",

&nbsp;&nbsp;&nbsp;&nbsp;"points": 1

&nbsp;&nbsp;}

}

#### 4\. PUT `/api/questions/:id` (MỚI)

* **Mô tả:** Cập nhật nội dung câu hỏi trong Question Bank.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8621c262f3b9200000003",

&nbsp;&nbsp;&nbsp;&nbsp;"message": "Cập nhật câu hỏi thành công"

&nbsp;&nbsp;}

}

#### 5\. DELETE `/api/questions/:id` (MỚI)

* **Mô tả:** Xóa câu hỏi khỏi Question Bank.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": { "message": "Xóa câu hỏi thành công" }

}

---

### 6.4. Exam Management Endpoints

#### 1\. GET `/api/exams` (MỚI)

* **Mô tả:** Lấy danh sách đề thi do giáo viên sở hữu (hỗ trợ lọc status: `draft`, `published`, `closed`).  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": \[

&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8641c262f3b9200000004",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"title": "IELTS Academic Mock Test 01",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"durationMinutes": 60,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"status": "published",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"createdAt": "2026-09-16T10:00:00.000Z"

&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;\],

&nbsp;&nbsp;"meta": { "page": 1, "limit": 20, "total": 1 }

}

#### 2\. POST `/api/exams`

* **Mô tả:** Tạo mới đề thi IELTS.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Zod Schema:**

export const CreateExamSchema \= z.object({

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;title: z.string().min(3),

&nbsp;&nbsp;&nbsp;&nbsp;description: z.string().optional(),

&nbsp;&nbsp;&nbsp;&nbsp;durationMinutes: z.number().int().min(10).max(180).default(60),

&nbsp;&nbsp;&nbsp;&nbsp;sections: z.array(

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;z.object({

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;skill: z.enum(\["listening", "reading", "writing"\]),

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;part: z.number().int().min(1).max(4),

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;title: z.string(),

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;instructions: z.string().optional(),

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;passageText: z.string().optional(),

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;mediaIds: z.array(z.string()).optional(),

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;questionIds: z.array(z.string()).default(\[\]),

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;})

&nbsp;&nbsp;&nbsp;&nbsp;).default(\[\]),

&nbsp;&nbsp;&nbsp;&nbsp;openAt: z.string().datetime().optional(),

&nbsp;&nbsp;&nbsp;&nbsp;closeAt: z.string().datetime().optional(),

&nbsp;&nbsp;}),

});

* **Response 201:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8641c262f3b9200000004",

&nbsp;&nbsp;&nbsp;&nbsp;"title": "IELTS Academic Mock Test 01",

&nbsp;&nbsp;&nbsp;&nbsp;"durationMinutes": 60,

&nbsp;&nbsp;&nbsp;&nbsp;"status": "draft",

&nbsp;&nbsp;&nbsp;&nbsp;"sectionsCount": 3

&nbsp;&nbsp;}

}

#### 3\. GET `/api/exams/:id` (MỚI)

* **Mô tả:** Xem chi tiết toàn bộ cấu trúc Sections và câu hỏi của đề thi (phục vụ màn hình Preview hoặc Soạn đề của giáo viên).  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8641c262f3b9200000004",

&nbsp;&nbsp;&nbsp;&nbsp;"title": "IELTS Academic Mock Test 01",

&nbsp;&nbsp;&nbsp;&nbsp;"durationMinutes": 60,

&nbsp;&nbsp;&nbsp;&nbsp;"status": "draft",

&nbsp;&nbsp;&nbsp;&nbsp;"sections": \[

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"skill": "reading",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"part": 1,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"title": "Passage 1: The History of Tea",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"passageText": "Tea is one of the most widely consumed beverages...",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"questionIds": \[ "66e8621c262f3b9200000003" \]

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;&nbsp;&nbsp;\]

&nbsp;&nbsp;}

}

#### 4\. PUT `/api/exams/:id` (MỚI)

* **Mô tả:** Cập nhật thông tin và danh sách câu hỏi trong đề thi (Chỉ cho phép khi đề ở trạng thái `draft`).  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8641c262f3b9200000004",

&nbsp;&nbsp;&nbsp;&nbsp;"message": "Cập nhật đề thi thành công"

&nbsp;&nbsp;}

}

#### 5\. DELETE `/api/exams/:id` (MỚI)

* **Mô tả:** Xóa đề thi (Chỉ cho phép khi đề ở trạng thái `draft`).  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": { "message": "Xóa đề thi thành công" }

}

#### 6\. POST `/api/exams/:id/clone`

* **Mô tả:** Nhân bản đề thi sang bản sao mới ở trạng thái `draft`.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 201:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8641c262f3b9200000005",

&nbsp;&nbsp;&nbsp;&nbsp;"title": "\[Bản sao\] IELTS Academic Mock Test 01",

&nbsp;&nbsp;&nbsp;&nbsp;"status": "draft"

&nbsp;&nbsp;}

}

#### 7\. PATCH `/api/exams/:id/publish`

* **Mô tả:** Xuất bản đề thi để sẵn sàng giao bài.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8641c262f3b9200000004",

&nbsp;&nbsp;&nbsp;&nbsp;"status": "published"

&nbsp;&nbsp;}

}

#### 8\. PATCH `/api/exams/:id/close` (MỚI)

* **Mô tả:** Khóa/Đóng đề thi.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8641c262f3b9200000004",

&nbsp;&nbsp;&nbsp;&nbsp;"status": "closed"

&nbsp;&nbsp;}

}

---

### 6.5. Assignments Endpoints

#### 1\. POST `/api/assignments`

* **Mô tả:** Giao bài thi cho lớp hoặc học sinh cụ thể.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Zod Schema:**

export const CreateAssignmentSchema \= z.object({

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;examId: z.string(),

&nbsp;&nbsp;&nbsp;&nbsp;classId: z.string().optional(),

&nbsp;&nbsp;&nbsp;&nbsp;studentId: z.string().optional(),

&nbsp;&nbsp;&nbsp;&nbsp;deadline: z.string().datetime().optional(),

&nbsp;&nbsp;}).refine((data) \=\> data.classId || data.studentId, {

&nbsp;&nbsp;&nbsp;&nbsp;message: "Cần chọn giao cho lớp (classId) hoặc học sinh (studentId)",

&nbsp;&nbsp;}),

});

* **Response 201:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8661c262f3b9200000006",

&nbsp;&nbsp;&nbsp;&nbsp;"examId": "66e8641c262f3b9200000004",

&nbsp;&nbsp;&nbsp;&nbsp;"classId": "66e8601c262f3b9200000002",

&nbsp;&nbsp;&nbsp;&nbsp;"deadline": "2026-09-30T23:59:59.000Z",

&nbsp;&nbsp;&nbsp;&nbsp;"status": "active"

&nbsp;&nbsp;}

}

#### 2\. GET `/api/assignments/my`

* **Mô tả:** Học sinh xem danh sách bài tập được giao cho mình.  
* **Middleware:** `authenticate`, `requireRoles("student")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": \[

&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8661c262f3b9200000006",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"examTitle": "IELTS Academic Mock Test 01",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"durationMinutes": 60,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"deadline": "2026-09-30T23:59:59.000Z",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"submissionStatus": "not\_started"

&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;\]

}

---

### 6.6. Attempts & Exam Engine Endpoints (Core Engine)

#### 1\. POST `/api/attempts`

* **Mô tả:** Bắt đầu phiên làm bài thi (Khởi tạo Server Timer).  
* **Middleware:** `authenticate`, `requireRoles("student")`  
* **Zod Schema:**

export const StartAttemptSchema \= z.object({

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;examId: z.string(),

&nbsp;&nbsp;&nbsp;&nbsp;assignmentId: z.string().optional(),

&nbsp;&nbsp;}),

});

* **Response 201:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"attemptId": "66e8681c262f3b9200000007",

&nbsp;&nbsp;&nbsp;&nbsp;"examId": "66e8641c262f3b9200000004",

&nbsp;&nbsp;&nbsp;&nbsp;"startedAt": "2026-09-16T15:00:00.000Z",

&nbsp;&nbsp;&nbsp;&nbsp;"expiresAt": "2026-09-16T16:00:00.000Z",

&nbsp;&nbsp;&nbsp;&nbsp;"remainingSeconds": 3600,

&nbsp;&nbsp;&nbsp;&nbsp;"status": "in\_progress"

&nbsp;&nbsp;}

}

#### 2\. GET `/api/attempts/:id` (State Recovery — Đã Lọc Bỏ Đáp Án)

* **Mô tả:** Khôi phục trạng thái bài thi khi học sinh reload trang hoặc rớt mạng kết nối lại.  
* **Bảo mật:** Backend BẮT BUỘC strip (loại trừ) trường `acceptedAnswers` và `explanation` khi trả về cho học sinh.  
* **Middleware:** `authenticate`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"attemptId": "66e8681c262f3b9200000007",

&nbsp;&nbsp;&nbsp;&nbsp;"status": "in\_progress",

&nbsp;&nbsp;&nbsp;&nbsp;"remainingSeconds": 2450,

&nbsp;&nbsp;&nbsp;&nbsp;"answers": \[

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"questionId": "66e8621c262f3b9200000003",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"value": "student centre"

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;&nbsp;&nbsp;\],

&nbsp;&nbsp;&nbsp;&nbsp;"exam": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8641c262f3b9200000004",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"title": "IELTS Academic Mock Test 01",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"sections": \[

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"skill": "listening",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"part": 1,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"title": "Part 1",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"questions": \[

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e8621c262f3b9200000003",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"prompt": "Write NO MORE THAN TWO WORDS for each answer.",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"type": "form\_completion",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"points": 1

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\]

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\]

&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;}

}

#### 3\. PATCH `/api/attempts/:id/answers` (Autosave)

* **Mô tả:** Tự động đồng bộ đáp án định kỳ từ client lên server.  
* **Middleware:** `authenticate`  
* **Zod Schema:**

export const AutosaveAnswersSchema \= z.object({

&nbsp;&nbsp;params: z.object({ id: z.string() }),

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;answers: z.array(

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;z.object({

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;questionId: z.string(),

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;value: z.string(),

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;})

&nbsp;&nbsp;&nbsp;&nbsp;),

&nbsp;&nbsp;}),

});

* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"savedCount": 2,

&nbsp;&nbsp;&nbsp;&nbsp;"serverRemainingSeconds": 2400

&nbsp;&nbsp;}

}

#### 4\. POST `/api/attempts/:id/submit`

* **Mô tả:** Nộp bài thi, khóa attempt và kích hoạt chấm tự động Listening/Reading.  
* **Middleware:** `authenticate`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"attemptId": "66e8681c262f3b9200000007",

&nbsp;&nbsp;&nbsp;&nbsp;"status": "submitted",

&nbsp;&nbsp;&nbsp;&nbsp;"submittedAt": "2026-09-16T15:58:30.000Z",

&nbsp;&nbsp;&nbsp;&nbsp;"scores": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"listeningRaw": 32,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"listeningBand": 7.5,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"readingRaw": 28,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"readingBand": 6.5,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"writingBand": null,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"overallBand": null

&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;}

}

#### 5\. GET `/api/attempts/:id/result` (MỚI — Học sinh xem kết quả chi tiết)

* **Mô tả:** Học sinh xem lại chi tiết bài làm đã nộp: đối chiếu câu trả lời của mình với đáp án đúng (`acceptedAnswers`), xem giải thích chi tiết, điểm số L/R và điểm/nhận xét Writing (nếu đã được giáo viên chấm).  
* **Middleware:** `authenticate`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"attemptId": "66e8681c262f3b9200000007",

&nbsp;&nbsp;&nbsp;&nbsp;"status": "submitted",

&nbsp;&nbsp;&nbsp;&nbsp;"scores": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"listeningBand": 7.5,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"readingBand": 6.5,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"writingBand": 6.5,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"overallBand": 7.0

&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;"writingReview": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"task1": { "score": 6.0, "comment": "Good overview but lacking data precision." },

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"task2": { "score": 7.0, "comment": "Strong argument structure and vocabulary." },

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"generalFeedback": "Great job overall\!"

&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;"details": \[

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"questionId": "66e8621c262f3b9200000003",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"studentAnswer": "student center",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"acceptedAnswers": \["student centre", "student center"\],

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"isCorrect": true,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"explanation": "Audio mentions 'visit the student center'."

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;&nbsp;&nbsp;\]

&nbsp;&nbsp;}

}

---

### 6.7. Writing Reviews & Grading Endpoints

#### 1\. GET `/api/grading/pending` (MỚI)

* **Mô tả:** Giáo viên lấy danh sách các bài nộp cần chấm Writing (hiển thị trên Teacher Dashboard).  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": \[

&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"attemptId": "66e8681c262f3b9200000007",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"studentName": "Nguyen Van A",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"studentEmail": "student@example.com",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"examTitle": "IELTS Academic Mock Test 01",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"submittedAt": "2026-09-16T15:58:30.000Z",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"hasSuspiciousActivity": false

&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;\],

&nbsp;&nbsp;"meta": { "totalPending": 1 }

}

#### 2\. GET `/api/attempts/:id/grading` (MỚI)

* **Mô tả:** Giáo viên mở giao diện chấm Writing của một học sinh (hiển thị đề bài, nội dung bài viết Task 1, Task 2 và số từ thực tế).  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"attemptId": "66e8681c262f3b9200000007",

&nbsp;&nbsp;&nbsp;&nbsp;"student": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e85d1c262f3b9200000001",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"fullName": "Nguyen Van A"

&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;"writingTasks": \[

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"task": 1,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"prompt": "The chart below shows...",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"studentContent": "The given bar chart illustrates...",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"wordCount": 178

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"task": 2,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"prompt": "Some people believe that...",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"studentContent": "In modern society, education plays...",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"wordCount": 285

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;&nbsp;&nbsp;\]

&nbsp;&nbsp;}

}

#### 3\. POST `/api/writing-reviews`

* **Mô tả:** Giáo viên chấm điểm và nhập nhận xét bài Writing.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Zod Schema:**

export const GradeWritingSchema \= z.object({

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;attemptId: z.string(),

&nbsp;&nbsp;&nbsp;&nbsp;task1: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;score: z.number().min(0).max(9),

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;comment: z.string().optional(),

&nbsp;&nbsp;&nbsp;&nbsp;}),

&nbsp;&nbsp;&nbsp;&nbsp;task2: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;score: z.number().min(0).max(9),

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;comment: z.string().optional(),

&nbsp;&nbsp;&nbsp;&nbsp;}),

&nbsp;&nbsp;&nbsp;&nbsp;generalFeedback: z.string().optional(),

&nbsp;&nbsp;}),

});

* **Response 201:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e86a1c262f3b9200000008",

&nbsp;&nbsp;&nbsp;&nbsp;"attemptId": "66e8681c262f3b9200000007",

&nbsp;&nbsp;&nbsp;&nbsp;"task1Score": 6.0,

&nbsp;&nbsp;&nbsp;&nbsp;"task2Score": 7.0,

&nbsp;&nbsp;&nbsp;&nbsp;"overallWritingScore": 6.5,

&nbsp;&nbsp;&nbsp;&nbsp;"attemptOverallBand": 7.0

&nbsp;&nbsp;}

}

---

### 6.8. Media Endpoints (MinIO S3 Integration)

#### 1\. POST `/api/media/presign`

* **Mô tả:** Tạo Presigned PUT URL để upload trực tiếp audio/image lên MinIO.  
* **Middleware:** `authenticate`, `requireRoles("teacher", "admin")`  
* **Zod Schema:**

export const PresignUploadSchema \= z.object({

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;filename: z.string(),

&nbsp;&nbsp;&nbsp;&nbsp;mimeType: z.enum(\["audio/mpeg", "audio/wav", "image/png", "image/jpeg"\]),

&nbsp;&nbsp;&nbsp;&nbsp;type: z.enum(\["audio", "image"\]),

&nbsp;&nbsp;&nbsp;&nbsp;size: z.number().max(100 \* 1024 \* 1024), // Tối đa 100MB

&nbsp;&nbsp;}),

});

* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"mediaId": "66e86c1c262f3b9200000009",

&nbsp;&nbsp;&nbsp;&nbsp;"uploadUrl": "https://media-api.example.com/ielts-media/audio/2026/09/uuid\_part1.mp3?X-Amz-Signature=...",

&nbsp;&nbsp;&nbsp;&nbsp;"publicUrl": "https://media.example.com/ielts-media/audio/2026/09/uuid\_part1.mp3",

&nbsp;&nbsp;&nbsp;&nbsp;"expiresInSeconds": 900

&nbsp;&nbsp;}

}

#### 2\. POST `/api/media/:id/confirm`

* **Mô tả:** Xác nhận file đã upload lên MinIO thành công để kích hoạt bản ghi Media.  
* **Middleware:** `authenticate`  
* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"id": "66e86c1c262f3b9200000009",

&nbsp;&nbsp;&nbsp;&nbsp;"status": "confirmed"

&nbsp;&nbsp;}

}

---

### 6.9. Anti-cheat Endpoints

#### 1\. POST `/api/anti-cheat/events`

* **Mô tả:** Ghi nhận sự kiện bất thường từ client. Tự động bật cờ `suspicious` khi vượt ngưỡng.  
* **Middleware:** `authenticate`, `requireRoles("student")`  
* **Zod Schema:**

export const LogExamEventSchema \= z.object({

&nbsp;&nbsp;body: z.object({

&nbsp;&nbsp;&nbsp;&nbsp;attemptId: z.string(),

&nbsp;&nbsp;&nbsp;&nbsp;type: z.enum(\[

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"TAB\_SWITCH",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"WINDOW\_BLUR",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"FULLSCREEN\_EXIT",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"RELOAD",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"COPY",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"PASTE",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"CUT",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"CONTEXT\_MENU",

&nbsp;&nbsp;&nbsp;&nbsp;\]),

&nbsp;&nbsp;&nbsp;&nbsp;timestamp: z.string().datetime().optional(),

&nbsp;&nbsp;&nbsp;&nbsp;metadata: z.record(z.any()).optional(),

&nbsp;&nbsp;}),

});

* **Response 200:**

{

&nbsp;&nbsp;"success": true,

&nbsp;&nbsp;"data": {

&nbsp;&nbsp;&nbsp;&nbsp;"recorded": true,

&nbsp;&nbsp;&nbsp;&nbsp;"suspiciousFlag": false

&nbsp;&nbsp;}

}

---

## 7\. HẠ TẦNG TRIỂN KHAI & CẤU HÌNH DOCKER

### 7.1. Dockerfile cho Express API (`api/Dockerfile`)

\# Stage 1: Build TypeScript

FROM node:20-alpine AS builder

&nbsp;

WORKDIR /app

&nbsp;

COPY package\*.json tsconfig.json ./

RUN npm ci

&nbsp;

COPY src ./src

RUN npm run build

&nbsp;

\# Stage 2: Production Runner

FROM node:20-alpine AS runner

&nbsp;

WORKDIR /app

&nbsp;

ENV NODE\_ENV=production

&nbsp;

COPY package\*.json ./

RUN npm ci \--only=production

&nbsp;

COPY \--from=builder /app/dist ./dist

&nbsp;

USER node

&nbsp;

EXPOSE 4000

&nbsp;

CMD \["node", "dist/server.js"\]

### 7.2. Docker Compose (`docker-compose.yml`)

version: '3.8'

&nbsp;

services:

&nbsp;&nbsp;\# 1\. Express API Service

&nbsp;&nbsp;api:

&nbsp;&nbsp;&nbsp;&nbsp;build:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;context: ./api

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;dockerfile: Dockerfile

&nbsp;&nbsp;&nbsp;&nbsp;container\_name: ielts\_api

&nbsp;&nbsp;&nbsp;&nbsp;restart: always

&nbsp;&nbsp;&nbsp;&nbsp;environment:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- NODE\_ENV=production

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- PORT=4000

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- MONGODB\_URI=mongodb://root:Secr3tMongoPass@mongodb:27017/ielts\_db?authSource=admin

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- JWT\_ACCESS\_SECRET=super-secure-access-secret-32-chars

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- JWT\_REFRESH\_SECRET=super-secure-refresh-secret-32-chars

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- MINIO\_ENDPOINT=minio

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- MINIO\_PORT=9000

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- MINIO\_USE\_SSL=false

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- MINIO\_ACCESS\_KEY=minioAdminKey

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- MINIO\_SECRET\_KEY=minioAdminSecretPassword123

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- MINIO\_BUCKET=ielts-media

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- PUBLIC\_MEDIA\_URL=https://media.yourdomain.com

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- CORS\_ORIGIN=https://yourdomain.com

&nbsp;&nbsp;&nbsp;&nbsp;depends\_on:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- mongodb

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- minio

&nbsp;&nbsp;&nbsp;&nbsp;ports:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- "4000:4000"

&nbsp;&nbsp;&nbsp;&nbsp;networks:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- ielts\_network

&nbsp;

&nbsp;&nbsp;\# 2\. MongoDB Database

&nbsp;&nbsp;mongodb:

&nbsp;&nbsp;&nbsp;&nbsp;image: mongo:7.0

&nbsp;&nbsp;&nbsp;&nbsp;container\_name: ielts\_mongodb

&nbsp;&nbsp;&nbsp;&nbsp;restart: always

&nbsp;&nbsp;&nbsp;&nbsp;environment:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- MONGO\_INITDB\_ROOT\_USERNAME=root

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- MONGO\_INITDB\_ROOT\_PASSWORD=Secr3tMongoPass

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- MONGO\_INITDB\_DATABASE=ielts\_db

&nbsp;&nbsp;&nbsp;&nbsp;volumes:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- mongo\_data:/data/db

&nbsp;&nbsp;&nbsp;&nbsp;networks:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- ielts\_network

&nbsp;

&nbsp;&nbsp;\# 3\. MinIO Object Storage

&nbsp;&nbsp;minio:

&nbsp;&nbsp;&nbsp;&nbsp;image: minio/minio:latest

&nbsp;&nbsp;&nbsp;&nbsp;container\_name: ielts\_minio

&nbsp;&nbsp;&nbsp;&nbsp;restart: always

&nbsp;&nbsp;&nbsp;&nbsp;command: server /data \--console-address ":9001"

&nbsp;&nbsp;&nbsp;&nbsp;environment:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- MINIO\_ROOT\_USER=minioAdminKey

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- MINIO\_ROOT\_PASSWORD=minioAdminSecretPassword123

&nbsp;&nbsp;&nbsp;&nbsp;volumes:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- minio\_data:/data

&nbsp;&nbsp;&nbsp;&nbsp;ports:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- "9000:9000"

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- "9001:9001"

&nbsp;&nbsp;&nbsp;&nbsp;networks:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- ielts\_network

&nbsp;

&nbsp;&nbsp;\# 4\. Cloudflare Tunnel

&nbsp;&nbsp;cloudflared:

&nbsp;&nbsp;&nbsp;&nbsp;image: cloudflare/cloudflared:latest

&nbsp;&nbsp;&nbsp;&nbsp;container\_name: ielts\_cloudflared

&nbsp;&nbsp;&nbsp;&nbsp;restart: always

&nbsp;&nbsp;&nbsp;&nbsp;command: tunnel run

&nbsp;&nbsp;&nbsp;&nbsp;environment:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- TUNNEL\_TOKEN=eyJhIjoiY2xvdWRmbGFyZS10dW5uZWwtdG9rZW4i...

&nbsp;&nbsp;&nbsp;&nbsp;networks:

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\- ielts\_network

&nbsp;

volumes:

&nbsp;&nbsp;mongo\_data:

&nbsp;&nbsp;&nbsp;&nbsp;driver: local

&nbsp;&nbsp;minio\_data:

&nbsp;&nbsp;&nbsp;&nbsp;driver: local

&nbsp;

networks:

&nbsp;&nbsp;ielts\_network:

&nbsp;&nbsp;&nbsp;&nbsp;driver: bridge

---

## 8\. FILE CẤU HÌNH MÔI TRƯỜNG (.env.example)

\# \==========================================

\# IELTS PLATFORM BACKEND ENVIRONMENT CONFIG

\# \==========================================

&nbsp;

\# Server Config

NODE\_ENV=development

PORT=4000

HOST=0.0.0.0

CORS\_ORIGIN=http://localhost:3000

&nbsp;

\# MongoDB Connection

MONGODB\_URI=mongodb://root:Secr3tMongoPass@localhost:27017/ielts\_db?authSource=admin

&nbsp;

\# JWT Authentication

JWT\_ACCESS\_SECRET=change-this-to-a-very-long-and-secure-random-secret-key-32-chars

JWT\_ACCESS\_EXPIRES\_IN=15m

JWT\_REFRESH\_SECRET=change-this-to-another-super-secure-random-secret-key-32-chars

JWT\_REFRESH\_EXPIRES\_IN=7d

&nbsp;

\# MinIO / S3 Compatible Storage

MINIO\_ENDPOINT=localhost

MINIO\_PORT=9000

MINIO\_USE\_SSL=false

MINIO\_ACCESS\_KEY=minioAdminKey

MINIO\_SECRET\_KEY=minioAdminSecretPassword123

MINIO\_BUCKET=ielts-media

&nbsp;

\# Public Media URL (Cloudflare Tunnel or Direct CDN Domain)

PUBLIC\_MEDIA\_URL=http://localhost:9000/ielts-media

&nbsp;

\# Exam Engine Timing Rules

EXAM\_GRACE\_PERIOD\_SECONDS=15

ANTI\_CHEAT\_TAB\_SWITCH\_THRESHOLD=5

ANTI\_CHEAT\_FULLSCREEN\_EXIT\_THRESHOLD=2

ANTI\_CHEAT\_PASTE\_THRESHOLD=3

---

*Toàn bộ nội dung bản đặc tả kỹ thuật hoàn thiện v1.1.0-MVP đã được cập nhật.*

&nbsp;