# KẾ HOẠCH TRIỂN KHAI BACKEND — IELTS ONLINE PLATFORM (MVP)

**Vai trò:** Technical Project Manager & Lead Architect  
**Tài liệu tham chiếu:** `project-spec.md`, `backend/backend-spec.md` (v1.1.0-MVP)  
**Ngày lập:** 17/09/2026  
**Mục đích:** Phân rã toàn bộ backend thành các task nhỏ, độc lập, tuần tự — sẵn sàng giao cho AI Coder (DeepSeek) thực thi từng bước.

---

## QUY ƯỚC CHUNG

- **Tech Stack:** Node.js 20 + Express.js + TypeScript (Strict Mode) + Mongoose 8 + Zod + JWT + MinIO SDK
- **Cấu trúc:** Modular Monolith — mỗi module trong `src/modules/<tên>/` gồm: `model.ts`, `service.ts`, `controller.ts`, `validation.ts`, `routes.ts`
- **Response:** Envelope chuẩn `{ success, data, meta?, error? }`
- **Auth:** JWT Access Token (15m) + HTTP-only Refresh Token Cookie (7d)
- **Validation:** Zod schemas tại middleware layer
- **Test:** Dùng Vitest (`npm test`). Từ Task 0.5 trở đi, mỗi task nên kèm ít nhất 1 unit test cơ bản
- **Out of scope (MVP):** Analytics/dashboard stats, lịch sử làm bài chi tiết, xem log anti-cheat của giáo viên, cập nhật profile (`PUT /users/me`), backup — nằm ngoài backend-spec v1.1.0-MVP, sẽ bổ sung ở version sau

---

## PHASE 0: KHỞI TẠO DỰ ÁN & HẠ TẦNG CƠ SỞ

### TASK 0.1 — Khởi tạo project Node.js + TypeScript + Express

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo project Node.js với TypeScript strict mode, cấu hình build, dev scripts, ESLint, Prettier |
| **Input** | Không có code trước đó — tạo mới hoàn toàn |
| **Output** | `api/package.json`, `api/tsconfig.json`, `api/eslint.config.mjs`, `api/.prettierrc`, `api/.env.example`, `api/.gitignore` |
| **Acceptance** | `npm install` thành công; `tsconfig.json` hợp lệ (strict, NodeNext, rootDir=src); `.env.example` đầy đủ biến theo Section 8. (Lưu ý: `npm run build`/`npm run dev` chỉ khả dụng từ Task 0.4 khi đã có file `src/`) |

**Prompt for Coder:**
> Trong thư mục `api/`, hãy khởi tạo project Node.js + Express + TypeScript (strict mode). Thực hiện:
> 1. Tạo `package.json` với scripts: `dev` (tsx watch), `build` (tsc), `start` (node dist/server.js), `test` (vitest run).
> 2. Cài đặt dependencies: `express`, `mongoose`, `zod`, `jsonwebtoken`, `bcrypt`, `cookie-parser`, `cors`, `helmet`, `express-rate-limit`, `minio`, `uuid`, `dotenv`. DevDeps: `typescript`, `@types/express`, `@types/node`, `@types/jsonwebtoken`, `@types/bcrypt`, `@types/cookie-parser`, `@types/cors`, `@types/uuid`, `tsx`, `vitest`, `eslint`, `@eslint/js`, `typescript-eslint`, `prettier`.
> 3. Tạo `tsconfig.json`: target ES2022, module NodeNext, strict true, outDir dist, rootDir src.
> 4. Tạo `.env.example` với các biến: `NODE_ENV`, `PORT=4000`, `HOST=0.0.0.0`, `CORS_ORIGIN=http://localhost:3000`, `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN=15m`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN=7d`, `MINIO_ENDPOINT`, `MINIO_PORT=9000`, `MINIO_USE_SSL=false`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET=ielts-media`, `PUBLIC_MEDIA_URL`, `EXAM_GRACE_PERIOD_SECONDS=15`, `ANTI_CHEAT_TAB_SWITCH_THRESHOLD=5`, `ANTI_CHEAT_FULLSCREEN_EXIT_THRESHOLD=2`, `ANTI_CHEAT_PASTE_THRESHOLD=3`.
> 5. Tạo `.gitignore` (node_modules, dist, .env, *.log).
> 6. Tạo `eslint.config.mjs` (ESLint 9 flat config, dùng `typescript-eslint`). Không tạo file source code (model/service/route/controller) nào ngoài cấu hình — các file trong `src/` sẽ được tạo ở các task tiếp theo.

---

### TASK 0.2 — Config layer: env.ts, database.ts, minio.ts, constants.ts

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo tầng config an toàn: validate env bằng Zod, kết nối MongoDB, khởi tạo MinIO client, hằng số IELTS |
| **Input** | `.env.example` từ Task 0.1 |
| **Output** | `src/config/env.ts`, `src/config/database.ts`, `src/config/minio.ts`, `src/config/constants.ts` |
| **Acceptance** | Import `env` không lỗi khi `.env` hợp lệ; throw lỗi rõ ràng khi thiếu biến |

**Prompt for Coder:**
> Tạo 4 file config trong `api/src/config/`:
>
> **1. `env.ts`:** Dùng Zod validate `process.env`. Parse tất cả biến từ `.env.example`. Export object `env` đã typed. Nếu parse thất bại, log lỗi chi tiết và `process.exit(1)`.
>
> **2. `database.ts`:** Export function `connectDB()` dùng Mongoose kết nối `env.MONGODB_URI`. Log thành công/thất bại. Cấu hình `mongoose.set('debug', env.NODE_ENV === 'development')`.
>
> **3. `minio.ts`:** Export MinIO `Client` instance từ `minio` package. Đọc config từ `env`. Export thêm function `ensureBucket(bucketName: string)` để tự động tạo bucket nếu chưa tồn tại.
>
> **4. `constants.ts`:** Chứa:
> - `LISTENING_BAND_TABLE: Record<number, number>` (bảng quy đổi 0-40 raw score → band score Listening theo chuẩn IELTS).
> - `READING_ACADEMIC_BAND_TABLE: Record<number, number>` (tương tự cho Reading Academic).
> - Function `calculateBandScore(rawScore: number, skill: 'listening' | 'reading'): number` — rawScore ≤ 3 trả 2.0, > 40 cap tại 40, tra bảng, fallback 2.5.
> - `EXAM_GRACE_PERIOD_SECONDS` từ env.
> - Các ngưỡng anti-cheat từ env.

---

### TASK 0.3 — Common layer: Error classes, Response utility, Middlewares cơ sở

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo hệ thống Error tùy chỉnh, response helper, validate middleware, error handler, rate limiter |
| **Input** | Bảng mã lỗi từ backend-spec.md (Section 3.3) |
| **Output** | `src/common/errors/AppError.ts`, `src/common/utils/response.util.ts`, `src/common/middlewares/validate.middleware.ts`, `src/common/middlewares/errorHandler.ts`, `src/common/middlewares/rateLimiter.ts`, `src/common/types/express.d.ts` |
| **Acceptance** | Throw `AppError` → errorHandler trả JSON đúng envelope format |

**Prompt for Coder:**
> Tạo common layer cho Express API trong `api/src/common/`:
>
> **1. `errors/AppError.ts`:** Class `AppError extends Error` với properties: `statusCode: number`, `errorCode: string`, `details?: any`. Thêm các subclass: `BadRequestError(code, message)` (400), `UnauthorizedError(code, message)` (401), `ForbiddenError(code, message)` (403), `NotFoundError(message?)` (404), `ConflictError(code, message)` (409), `TooManyRequestsError()` (429). Các error codes: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `OLD_PASSWORD_INCORRECT`, `CLASS_CODE_INVALID`, `STUDENT_ALREADY_IN_CLASS`, `STUDENT_NOT_IN_CLASS`, `EXAM_ALREADY_SUBMITTED`, `EXAM_NOT_PUBLISHED`, `EXAM_CANNOT_EDIT_PUBLISHED`, `UNAUTHORIZED`, `TOKEN_EXPIRED`, `REFRESH_TOKEN_INVALID`, `FORBIDDEN`, `ATTEMPT_NOT_OWNED`, `EXAM_EXPIRED`, `NOT_FOUND`, `CONFLICT`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`.
>
> **2. `utils/response.util.ts`:** Function `sendSuccess(res, data, statusCode?, meta?)` trả `{ success: true, data, meta }`. Function `sendError(res, error)` trả `{ success: false, error: { code, message, details } }`.
>
> **3. `middlewares/validate.middleware.ts`:** Middleware factory nhận Zod schema, validate `req.body`, `req.params`, `req.query`. Nếu lỗi throw `BadRequestError('VALIDATION_ERROR', ...)` với `details` chứa Zod issues.
>
> **4. `middlewares/errorHandler.ts`:** Express error handler (4 params). Nếu `err instanceof AppError` → trả JSON envelope với status tương ứng. Nếu không → log stack trace, trả 500 `INTERNAL_SERVER_ERROR`.
>
> **5. `middlewares/rateLimiter.ts`:** Export factory `createRateLimiter(maxRequests, windowMs)` dùng `express-rate-limit`.
>
> **6. `types/express.d.ts`:** Augment `Express.Request` thêm property `user?: { id: string, role: string, email: string }`.

---

### TASK 0.4 — App entry points: app.ts + server.ts

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo Express app với global middlewares và server entry point kết nối DB, MinIO, lắng nghe port |
| **Input** | Config layer (Task 0.2), Common layer (Task 0.3) |
| **Output** | `src/app.ts`, `src/server.ts` |
| **Acceptance** | `npm run dev` → server chạy port 4000, log "Connected to MongoDB", "MinIO bucket ready", "Server running on port 4000" |

**Prompt for Coder:**
> Tạo 2 file entry point trong `api/src/`:
>
> **1. `app.ts`:**
> - Import `express`, `cors`, `helmet`, `cookie-parser`.
> - Tạo Express app.
> - Cấu hình global middlewares theo thứ tự: `helmet()`, `cors({ origin: env.CORS_ORIGIN, credentials: true })`, `express.json({ limit: '10mb' })`, `express.urlencoded({ extended: true })`, `cookieParser()`.
> - Mount placeholder: `app.get('/api/health', (req, res) => sendSuccess(res, { status: 'ok', timestamp: new Date() }))`.
> - Cuối cùng mount `errorHandler` middleware.
> - Export `app`.
>
> **2. `server.ts`:**
> - Import `app`, `env`, `connectDB`, `ensureBucket`.
> - Gọi `connectDB()`, sau đó `ensureBucket(env.MINIO_BUCKET)`, sau đó `app.listen(env.PORT)`.
> - Log thông tin khởi chạy.
> - Xử lý `unhandledRejection` và `uncaughtException`: log error rồi `process.exit(1)`.

---

### TASK 0.5 — Utility: IELTS Calculator + String Normalizer

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo các utility functions phục vụ auto-grading và tính điểm IELTS |
| **Input** | Công thức từ backend-spec.md Section 5.7, 5.8 |
| **Output** | `src/common/utils/ielts-calculator.ts`, `src/common/utils/string-normalizer.ts` |
| **Acceptance** | Unit test: `roundIeltsBand(6.125) === 6.0`, `roundIeltsBand(6.25) === 6.5`, `roundIeltsBand(6.75) === 7.0`. `normalizeAnswer(" London  ") === "london"` |

**Prompt for Coder:**
> Tạo 2 utility files trong `api/src/common/utils/`:
>
> **1. `ielts-calculator.ts`:**
> - `roundIeltsBand(score: number): number` — Quy tắc: decimal < 0.25 → floor, decimal >= 0.25 và < 0.75 → floor + 0.5, decimal >= 0.75 → floor + 1.0.
> - `calculateWritingBand(task1Score: number, task2Score: number): number` — Công thức: `roundIeltsBand((task1 + task2 * 2) / 3)`.
> - `calculateOverallBand(scores: { listening?: number, reading?: number, writing?: number }): number` — Trung bình cộng các điểm có giá trị, áp dụng `roundIeltsBand`.
>
> **2. `string-normalizer.ts`:**
> - `normalizeAnswer(input: string): string` — Thực hiện: trim → toLowerCase → replace `/\s+/g` bằng 1 space → chuẩn hóa dấu nháy đơn (', ') thành `'` → loại bỏ ký tự đặc biệt không ảnh hưởng ngữ nghĩa.
> - `matchAnswer(studentAnswer: string, acceptedAnswers: string[]): boolean` — So khớp `normalizeAnswer(studentAnswer)` với từng `normalizeAnswer(accepted)` trong danh sách.

---

## PHASE 1: AUTH & USER MODULE

### TASK 1.1 — User Model

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo Mongoose schema/model cho User theo đúng spec |
| **Input** | backend-spec.md Section 4.1 |
| **Output** | `src/modules/users/user.model.ts` |
| **Acceptance** | TypeScript interfaces `IUser`, `UserRole`, `UserStatus` đúng. Indexes trên `email` (unique), `role + status` |

**Prompt for Coder:**
> Tạo file `api/src/modules/users/user.model.ts`:
>
> - Định nghĩa TypeScript types: `UserRole = "student" | "teacher" | "admin"`, `UserStatus = "active" | "inactive" | "suspended"`.
> - Interface `IUser extends Document` gồm: `_id: Types.ObjectId`, `email: string`, `passwordHash: string`, `fullName: string`, `phone?: string`, `role: UserRole`, `targetBand?: number` (min 0, max 9), `avatarMediaId?: Types.ObjectId` (ref: "Media"), `status: UserStatus`, `createdAt: Date`, `updatedAt: Date`.
> - Mongoose Schema: email unique/lowercase/trim/required, passwordHash required, fullName required/trim, role enum default "student", status enum default "active".
> - Indexes: `{ email: 1 }` unique, `{ role: 1, status: 1 }`.
> - Options: `timestamps: true`, `versionKey: false`.
> - Export `UserModel`.

---

### TASK 1.2 — Auth Module: Validation, Service, Controller, Routes

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Xây dựng toàn bộ Auth module: Register, Login, Refresh, Logout, Change Password |
| **Input** | backend-spec.md Section 5.1, 6.1 |
| **Output** | `src/modules/auth/auth.validation.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.controller.ts`, `src/modules/auth/auth.routes.ts` |
| **Acceptance** | 5 endpoints hoạt động: `POST /api/auth/register` (201), `POST /api/auth/login` (200 + Set-Cookie), `POST /api/auth/refresh` (200), `POST /api/auth/logout` (200), `POST /api/auth/change-password` (200) |

**Prompt for Coder:**
> Tạo Auth module trong `api/src/modules/auth/` gồm 4 file:
>
> **1. `auth.validation.ts`:** Zod schemas:
> - `RegisterSchema`: body { email (email), password (min 8), fullName (min 2), phone (optional), targetBand (number 0-9, optional, default 6.5) }.
> - `LoginSchema`: body { email (email), password (string) }.
> - `ChangePasswordSchema`: body { oldPassword (min 1), newPassword (min 8) }.
>
> **2. `auth.service.ts`:** Class `AuthService` (hoặc object):
> - `register(data)`: Check email trùng → throw `ConflictError('CONFLICT', 'Email đã tồn tại')`. Hash password bcrypt saltRounds=12. Tạo User role="student". Tạo access token (JWT, payload: `{ sub: userId, role, email }`, expires `env.JWT_ACCESS_EXPIRES_IN`). Tạo refresh token (expires `env.JWT_REFRESH_EXPIRES_IN`). Return `{ user, accessToken, refreshToken }`.
> - `login(email, password)`: Tìm user theo email → sai throw `BadRequestError('INVALID_CREDENTIALS')`. Bcrypt compare → sai throw tương tự. Tạo cặp token. Return `{ user, accessToken, refreshToken }`.
> - `refresh(refreshToken)`: Verify JWT → sai throw `UnauthorizedError('REFRESH_TOKEN_INVALID')`. Tìm user. Tạo access token mới. Return `{ accessToken }`.
> - `changePassword(userId, oldPassword, newPassword)`: Tìm user → verify old password → sai throw `BadRequestError('OLD_PASSWORD_INCORRECT')`. Hash new password. Update.
>
> **3. `auth.controller.ts`:** Mỗi handler gọi service, dùng `sendSuccess()`. Login và Register: set refresh token vào cookie `res.cookie('refreshToken', token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth', maxAge: 7*24*60*60*1000 })`. Response không trả refresh token trong body. Logout: clear cookie. `refresh` đọc refresh token từ `req.cookies.refreshToken` (KHÔNG dùng Bearer token).
>
> **4. `auth.routes.ts`:** Express Router mount tại `/api/auth`. Rate limiter (10 req / 15min) cho register, login và refresh. `authenticate` middleware CHỈ cho change-password. Quan trọng: `POST /refresh` và `POST /logout` KHÔNG dùng `authenticate` (access token) — chúng đọc refresh token từ cookie.

---

### TASK 1.3 — Auth Middleware: authenticate + requireRoles (RBAC)

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo middleware xác thực JWT và phân quyền RBAC |
| **Input** | JWT specs từ backend-spec.md Section 5.1 |
| **Output** | `src/common/middlewares/auth.middleware.ts`, `src/common/middlewares/rbac.middleware.ts` |
| **Acceptance** | Request không có/sai Bearer token → 401. Request đúng token → `req.user` được set. `requireRoles('teacher')` → student bị 403 |

**Prompt for Coder:**
> Tạo 2 middleware files trong `api/src/common/middlewares/`:
>
> **1. `auth.middleware.ts`:** Export `authenticate` middleware:
> - Extract token từ `Authorization: Bearer <token>`.
> - Nếu không có header → throw `UnauthorizedError('UNAUTHORIZED', 'Token không hợp lệ hoặc thiếu Authorization Header')`.
> - Verify bằng `JWT_ACCESS_SECRET`. Nếu token hết hạn → throw `UnauthorizedError('TOKEN_EXPIRED', 'Access Token đã hết hạn')`. Nếu sai → throw `UnauthorizedError('UNAUTHORIZED', ...)`.
> - Decode payload, gán `req.user = { id: payload.sub, role: payload.role, email: payload.email }`.
> - Gọi `next()`.
>
> **2. `rbac.middleware.ts`:** Export `requireRoles(...roles: string[])` middleware factory:
> - Kiểm tra `req.user.role` có nằm trong `roles` không.
> - Nếu không → throw `ForbiddenError('FORBIDDEN', 'Người dùng không đủ quyền thực hiện hành động')`.

---

### TASK 1.4 — User Module: Service, Controller, Routes (Profile + Admin Reset Password)

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | API lấy profile và admin reset password |
| **Input** | backend-spec.md Section 6.1 endpoints 4 & 7 |
| **Output** | `src/modules/users/user.validation.ts`, `src/modules/users/user.service.ts`, `src/modules/users/user.controller.ts`, `src/modules/users/user.routes.ts` |
| **Acceptance** | `GET /api/users/me` → 200 trả user profile. `POST /api/users/:id/reset-password` → 200 (admin only) |

**Prompt for Coder:**
> Tạo User module trong `api/src/modules/users/` gồm 4 file:
>
> **1. `user.validation.ts`:** Zod schema:
> - `AdminResetPasswordSchema`: params { id: string }, body { newPassword: string min 8 }.
>
> **2. `user.service.ts`:**
> - `getProfile(userId)`: Tìm user theo ID, select loại bỏ `passwordHash`. Không tìm thấy → throw `NotFoundError`.
> - `resetPassword(userId, newPassword)`: Tìm user → hash newPassword bcrypt saltRounds=12 → update `passwordHash`. Không tìm thấy → throw `NotFoundError`.
>
> **3. `user.controller.ts`:**
> - `getMe`: Gọi `getProfile(req.user.id)`, trả `sendSuccess`.
> - `adminResetPassword`: Gọi `resetPassword(req.params.id, req.body.newPassword)`, trả `sendSuccess`.
>
> **4. `user.routes.ts`:** Mount tại `/api/users`.
> - `GET /me` → `authenticate` → `getMe`.
> - `POST /:id/reset-password` → `authenticate` + `requireRoles('admin')` + `validate(AdminResetPasswordSchema)` → `adminResetPassword`.

---

### TASK 1.5 — Mount Auth & User routes vào app.ts

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Gắn routes của Auth và User module vào Express app |
| **Input** | auth.routes.ts, user.routes.ts, app.ts |
| **Output** | Cập nhật `src/app.ts` |
| **Acceptance** | `GET /api/health`, `POST /api/auth/register`, `GET /api/users/me` đều accessible |

**Prompt for Coder:**
> Cập nhật file `api/src/app.ts`:
> - Import `authRoutes` từ `./modules/auth/auth.routes` và `userRoutes` từ `./modules/users/user.routes`.
> - Mount vào app: `app.use('/api/auth', authRoutes)` và `app.use('/api/users', userRoutes)`.
> - Đặt mount routes SAU các global middlewares và TRƯỚC errorHandler.

---

## PHASE 2: CLASS MANAGEMENT MODULE

### TASK 2.1 — Class Model

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo Mongoose model cho Class |
| **Input** | backend-spec.md Section 4.2 |
| **Output** | `src/modules/classes/class.model.ts` |
| **Acceptance** | Interface `IClass` đúng. Indexes: `code` unique, `teacherId`, `students` |

**Prompt for Coder:**
> Tạo file `api/src/modules/classes/class.model.ts`:
>
> - Interface `IClass extends Document`: `_id`, `name: string`, `code: string` (6 ký tự ngẫu nhiên VD "IEL88A"), `description?: string`, `teacherId: Types.ObjectId` (ref "User"), `students: Types.ObjectId[]` (ref "User"), `createdAt`, `updatedAt`.
> - Schema: name required/trim, code required/unique/uppercase/trim, description trim, teacherId required ref "User", students array ref "User".
> - Indexes: `{ code: 1 }` unique, `{ teacherId: 1 }`, `{ students: 1 }`.
> - `timestamps: true`, `versionKey: false`.
> - Export `ClassModel`.

---

### TASK 2.2 — Class Module: Validation, Service, Controller, Routes

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | CRUD lớp học + join class + thêm/xóa học sinh |
| **Input** | backend-spec.md Section 5.2, 6.2 |
| **Output** | `src/modules/classes/class.validation.ts`, `src/modules/classes/class.service.ts`, `src/modules/classes/class.controller.ts`, `src/modules/classes/class.routes.ts` |
| **Acceptance** | 6 endpoints: `GET /api/classes`, `POST /api/classes`, `GET /api/classes/:id`, `POST /api/classes/join`, `POST /api/classes/:id/students`, `DELETE /api/classes/:id/students/:studentId` |

**Prompt for Coder:**
> Tạo Class module trong `api/src/modules/classes/` gồm 4 file:
>
> **1. `class.validation.ts`:** Zod schemas:
> - `CreateClassSchema`: body { name (min 2), description (optional) }.
> - `JoinClassSchema`: body { code (length 6) }.
> - `AddStudentSchema`: params { id }, body { email (email) }.
>
> **2. `class.service.ts`:**
> - `generateClassCode()`: Sinh ngẫu nhiên 6 ký tự chữ hoa + số, loại trừ ký tự dễ nhầm `0, O, 1, I, L`. Kiểm tra unique trong DB, retry nếu trùng.
> - `createClass(teacherId, data)`: Gọi `generateClassCode()`, tạo Class mới.
> - `getClassesByUser(userId, role)`: Nếu teacher → `find({ teacherId })`. Nếu student → `find({ students: userId })`. Trả danh sách kèm `studentsCount`.
> - `getClassDetail(classId)`: Populate `students` (select: id, email, fullName, targetBand). Populate `teacherId` (select: id, fullName). Not found → throw `NotFoundError`.
> - `joinClass(studentId, code)`: Tìm class theo code → not found throw `BadRequestError('CLASS_CODE_INVALID')`. Kiểm tra đã là thành viên → throw `BadRequestError('STUDENT_ALREADY_IN_CLASS')`. Push studentId.
> - `addStudentByEmail(classId, teacherId, email)`: Verify class thuộc teacherId. Tìm user theo email (phải role student). Not found → throw `NotFoundError`. Đã trong class → throw `BadRequestError('STUDENT_ALREADY_IN_CLASS')`. Push.
> - `removeStudent(classId, teacherId, studentId)`: Verify ownership. Kiểm tra student trong class → throw `BadRequestError('STUDENT_NOT_IN_CLASS')` nếu không có. Pull studentId.
>
> **3. `class.controller.ts`:** Mỗi handler tương ứng 1 endpoint, dùng `sendSuccess`.
>
> **4. `class.routes.ts`:** Mount tại `/api/classes`.
> - `GET /` → authenticate → getClasses.
> - `POST /` → authenticate + requireRoles('teacher','admin') + validate → create.
> - `GET /:id` → authenticate → getDetail.
> - `POST /join` → authenticate + requireRoles('student') + validate → joinClass.
> - `POST /:id/students` → authenticate + requireRoles('teacher','admin') + validate → addStudent.
> - `DELETE /:id/students/:studentId` → authenticate + requireRoles('teacher','admin') → removeStudent.
>
> Cuối cùng mount routes vào `app.ts`: `app.use('/api/classes', classRoutes)`.

---

## PHASE 3: QUESTION BANK MODULE

### TASK 3.1 — Question Model

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo Mongoose model cho Question với data: Mixed |
| **Input** | backend-spec.md Section 4.3 |
| **Output** | `src/modules/questions/question.model.ts` |
| **Acceptance** | Interface `IQuestion` với `data: Record<string, any>`. Indexes trên `skill+part+type` và `createdBy` |

**Prompt for Coder:**
> Tạo file `api/src/modules/questions/question.model.ts`:
>
> - Types: `SkillType = "listening" | "reading" | "writing"`. `QuestionType = "multiple_choice" | "form_completion" | "note_completion" | "table_completion" | "sentence_completion" | "matching" | "map_labelling" | "diagram_labelling" | "matching_headings" | "summary_completion" | "true_false_not_given" | "yes_no_not_given" | "writing_task_1" | "writing_task_2"`.
> - Interface `IQuestion extends Document`: `_id`, `skill: SkillType`, `type: QuestionType`, `part: number` (1-4), `prompt: string` (nội dung câu hỏi), `content?: string` (đoạn văn bổ sung), `data: Record<string, any>` (cấu hình linh hoạt), `acceptedAnswers: string[]`, `points: number` (default 1), `explanation?: string`, `mediaIds: Types.ObjectId[]` (ref "Media"), `createdBy: Types.ObjectId` (ref "User"), timestamps.
> - Schema: skill enum required, type string required, part number required, prompt required, data `Schema.Types.Mixed` default `{}`, acceptedAnswers array string trim, points default 1, mediaIds ref "Media", createdBy ref "User" required.
> - Indexes: `{ skill: 1, part: 1, type: 1 }`, `{ createdBy: 1 }`.
> - `timestamps: true`, `versionKey: false`.
> - Export `QuestionModel`.

---

### TASK 3.2 — Question Module: Validation, Service, Controller, Routes (CRUD)

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | CRUD đầy đủ cho Question Bank với phân trang + lọc |
| **Input** | backend-spec.md Section 5.3, 6.3 |
| **Output** | `src/modules/questions/question.validation.ts`, `question.service.ts`, `question.controller.ts`, `question.routes.ts` |
| **Acceptance** | 5 endpoints: `POST /api/questions`, `GET /api/questions` (lọc + phân trang), `GET /api/questions/:id`, `PUT /api/questions/:id`, `DELETE /api/questions/:id` |

**Prompt for Coder:**
> Tạo Question module trong `api/src/modules/questions/` gồm 4 file:
>
> **1. `question.validation.ts`:** Zod schemas:
> - `CreateQuestionSchema`: body { skill (enum listening/reading/writing), type (string), part (int 1-4), prompt (min 1), content (optional), data (record, default {}), acceptedAnswers (array string, default []), points (number, default 1), explanation (optional), mediaIds (array string, optional, default []) }.
> - `UpdateQuestionSchema`: body tương tự CreateQuestionSchema nhưng tất cả optional (partial).
> - `ListQuestionsSchema`: query { skill (optional), part (optional number), type (optional), page (optional int default 1), limit (optional int default 20), createdBy (optional) }.
>
> **2. `question.service.ts`:**
> - `create(data, userId)`: Tạo Question mới, gán `createdBy = userId`.
> - `list(filters, page, limit)`: Build query từ filters (skill, part, type, createdBy). Phân trang `.skip((page-1)*limit).limit(limit)`. Trả `{ questions, total, page, limit, totalPages }`.
> - `getById(id)`: Tìm theo ID, not found → throw `NotFoundError`.
> - `update(id, data, userId)`: Tìm question, verify `createdBy === userId` hoặc role admin. Not found → throw. Cập nhật.
> - `delete(id, userId)`: Tương tự verify, xóa.
>
> **3. `question.controller.ts`:** Mỗi handler gọi service tương ứng.
>
> **4. `question.routes.ts`:** Mount tại `/api/questions`. Tất cả endpoints require `authenticate` + `requireRoles('teacher','admin')`.
>
> Mount vào `app.ts`: `app.use('/api/questions', questionRoutes)`.

---

## PHASE 4: EXAM MANAGEMENT MODULE

### TASK 4.1 — Exam Model

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo Mongoose model cho Exam với embedded Sections |
| **Input** | backend-spec.md Section 4.4 |
| **Output** | `src/modules/exams/exam.model.ts` |
| **Acceptance** | Interface `IExam` với `sections: IExamSection[]`. Indexes trên `status+createdBy` và `openAt+closeAt` |

**Prompt for Coder:**
> Tạo file `api/src/modules/exams/exam.model.ts`:
>
> - Types: `ExamStatus = "draft" | "published" | "closed"`.
> - Interface `IExamSection`: `skill: SkillType`, `part: number`, `title: string`, `instructions?: string`, `passageText?: string` (đoạn văn Reading), `mediaIds?: Types.ObjectId[]` (ref "Media"), `questionIds: Types.ObjectId[]` (ref "Question").
> - Interface `IExam extends Document`: `_id`, `title: string`, `description?: string`, `durationMinutes: number` (default 60), `sections: IExamSection[]`, `status: ExamStatus`, `openAt?: Date`, `closeAt?: Date`, `createdBy: Types.ObjectId` (ref "User"), timestamps.
> - `ExamSectionSchema`: sub-schema, `_id: false`.
> - `ExamSchema`: title required/trim, durationMinutes required default 60, sections array of ExamSectionSchema, status enum default "draft", createdBy required ref "User".
> - Indexes: `{ status: 1, createdBy: 1 }`, `{ openAt: 1, closeAt: 1 }`.
> - `timestamps: true`, `versionKey: false`.
> - Export `ExamModel`.

---

### TASK 4.2 — Exam Module: Validation, Service, Controller, Routes

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | CRUD đề thi + clone + publish + close |
| **Input** | backend-spec.md Section 5.4, 6.4 |
| **Output** | `src/modules/exams/exam.validation.ts`, `exam.service.ts`, `exam.controller.ts`, `exam.routes.ts` |
| **Acceptance** | 8 endpoints: `GET`, `POST`, `GET /:id`, `PUT /:id`, `DELETE /:id`, `POST /:id/clone`, `PATCH /:id/publish`, `PATCH /:id/close` |

**Prompt for Coder:**
> Tạo Exam module trong `api/src/modules/exams/` gồm 4 file:
>
> **1. `exam.validation.ts`:** Zod schemas:
> - `CreateExamSchema`: body { title (min 3), description (optional), durationMinutes (int 10-180, default 60), sections (array of { skill (enum), part (int 1-4), title (string), instructions (optional), passageText (optional), mediaIds (array string, optional), questionIds (array string, default []) }, default []), openAt (datetime optional), closeAt (datetime optional) }.
> - `UpdateExamSchema`: body tương tự nhưng tất cả optional.
>
> **2. `exam.service.ts`:**
> - `create(data, userId)`: Tạo Exam mới, `createdBy = userId`, status = "draft".
> - `list(userId, filters)`: Lọc `{ createdBy: userId }` + status filter. Phân trang.
> - `getById(id)`: Populate `sections.questionIds` để xem chi tiết câu hỏi. Not found → throw.
> - `update(id, data, userId)`: Verify ownership. Nếu `status !== 'draft'` → throw `BadRequestError('EXAM_CANNOT_EDIT_PUBLISHED')`. Cập nhật.
> - `delete(id, userId)`: Verify ownership. Nếu `status !== 'draft'` → throw `BadRequestError('EXAM_CANNOT_EDIT_PUBLISHED')`. Xóa.
> - `clone(id, userId)`: Deep copy exam, đổi title thành `[Bản sao] ${original.title}`, set status = "draft", createdBy = userId. Tạo mới.
> - `publish(id, userId)`: Verify ownership. Đổi status = "published".
> - `close(id, userId)`: Verify ownership. Đổi status = "closed".
>
> **3. `exam.controller.ts`:** Handler cho mỗi endpoint.
>
> **4. `exam.routes.ts`:** Mount tại `/api/exams`. Tất cả require `authenticate` + `requireRoles('teacher','admin')`.
>
> Mount vào `app.ts`: `app.use('/api/exams', examRoutes)`.

---

## PHASE 5: ASSIGNMENT MODULE

### TASK 5.1 — Assignment Model

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo Mongoose model cho Assignment |
| **Input** | backend-spec.md Section 4.5 |
| **Output** | `src/modules/assignments/assignment.model.ts` |
| **Acceptance** | Interface `IAssignment` đúng. Indexes trên `classId+status`, `studentId+status`, `examId` |

**Prompt for Coder:**
> Tạo file `api/src/modules/assignments/assignment.model.ts`:
>
> - Types: `AssignmentStatus = "active" | "archived"`.
> - Interface `IAssignment extends Document`: `_id`, `examId: Types.ObjectId` (ref "Exam"), `teacherId: Types.ObjectId` (ref "User"), `classId?: Types.ObjectId` (ref "Class"), `studentId?: Types.ObjectId` (ref "User"), `assignedAt: Date` (default Date.now), `deadline?: Date`, `status: AssignmentStatus`, timestamps.
> - Schema tương ứng. `examId` required, `teacherId` required.
> - Indexes: `{ classId: 1, status: 1 }`, `{ studentId: 1, status: 1 }`, `{ examId: 1 }`.
> - `timestamps: true`, `versionKey: false`.
> - Export `AssignmentModel`.

---

### TASK 5.2 — Assignment Module: Validation, Service, Controller, Routes

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Giao bài cho lớp/học sinh, học sinh xem danh sách bài tập |
| **Input** | backend-spec.md Section 5.5, 6.5 |
| **Output** | `src/modules/assignments/assignment.validation.ts`, `assignment.service.ts`, `assignment.controller.ts`, `assignment.routes.ts` |
| **Acceptance** | `POST /api/assignments` (201), `GET /api/assignments/my` (200) |

**Prompt for Coder:**
> Tạo Assignment module trong `api/src/modules/assignments/` gồm 4 file:
>
> **1. `assignment.validation.ts`:** Zod schema:
> - `CreateAssignmentSchema`: body { examId (string), classId (string optional), studentId (string optional), deadline (datetime optional) }. Thêm `.refine(data => data.classId || data.studentId, { message: "Cần chọn giao cho lớp (classId) hoặc học sinh (studentId)" })`.
>
> **2. `assignment.service.ts`:**
> - `create(data, teacherId)`: Verify exam tồn tại và status = "published" → nếu không throw `BadRequestError('EXAM_NOT_PUBLISHED')`. Nếu có `classId` → verify class tồn tại và thuộc teacherId. Tạo Assignment gán teacherId.
> - `getMyAssignments(studentId)`: Tìm assignments dành cho student này. Logic: tìm tất cả classes mà student tham gia → lấy assignments có `classId` trong danh sách đó HOẶC có `studentId` bằng student hiện tại. Populate `examId` (select: title, durationMinutes). Tính `submissionStatus` cho mỗi assignment: kiểm tra xem student đã có Attempt cho exam đó chưa (query AttemptModel). Trả danh sách kèm status: `not_started`, `in_progress`, `submitted`, `expired`.
>
> **3. `assignment.controller.ts`:** Handler cho create và getMyAssignments.
>
> **4. `assignment.routes.ts`:** Mount tại `/api/assignments`.
> - `POST /` → authenticate + requireRoles('teacher','admin') + validate → create.
> - `GET /my` → authenticate + requireRoles('student') → getMyAssignments.
>
> Mount vào `app.ts`: `app.use('/api/assignments', assignmentRoutes)`.

---

## PHASE 6: ATTEMPT & EXAM ENGINE (CORE)

### TASK 6.1 — Attempt Model

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo Mongoose model cho Attempt — trung tâm Exam Engine |
| **Input** | backend-spec.md Section 4.6 |
| **Output** | `src/modules/attempts/attempt.model.ts` |
| **Acceptance** | Interfaces `IAttempt`, `IAttemptAnswer`, `IAttemptScores` đúng. Indexes trên `studentId+examId`, `assignmentId`, `status+expiresAt` |

**Prompt for Coder:**
> Tạo file `api/src/modules/attempts/attempt.model.ts`:
>
> - Types: `AttemptStatus = "in_progress" | "submitted" | "expired"`.
> - Interface `IAttemptAnswer`: `questionId: Types.ObjectId`, `value: string`, `savedAt: Date`.
> - Interface `IAttemptScores`: `listeningRaw?: number`, `listeningBand?: number`, `readingRaw?: number`, `readingBand?: number`, `writingTask1Band?: number`, `writingTask2Band?: number`, `writingBand?: number`, `overallBand?: number`.
> - Interface `IAttempt extends Document`: `_id`, `examId` (ref "Exam"), `studentId` (ref "User"), `assignmentId?` (ref "Assignment"), `startedAt: Date`, `expiresAt: Date`, `submittedAt?: Date`, `status: AttemptStatus`, `answers: IAttemptAnswer[]`, `scores: IAttemptScores`, `suspicious: boolean` (default false), timestamps.
> - Sub-schema `AttemptAnswerSchema` (`_id: false`).
> - `AttemptSchema` với nested `scores` object (tất cả optional Number).
> - Indexes: `{ studentId: 1, examId: 1 }`, `{ assignmentId: 1 }`, `{ status: 1, expiresAt: 1 }`.
> - Thêm unique partial index chống duplicate attempt đang làm: `AttemptSchema.index({ studentId: 1, examId: 1 }, { unique: true, partialFilterExpression: { status: "in_progress" } })`.
> - `timestamps: true`, `versionKey: false`.
> - Export `AttemptModel`.

---

### TASK 6.2 — Attempt Module: Start Exam (POST /api/attempts)

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Endpoint khởi tạo phiên thi — Server-Authoritative Timer, Data Projection (strip đáp án) |
| **Input** | backend-spec.md Section 5.6 (1, 2), 6.6 (endpoint 1) |
| **Output** | `src/modules/attempts/attempt.validation.ts`, `attempt.service.ts` (hàm startAttempt), `attempt.controller.ts` (handler start), `attempt.routes.ts` |
| **Acceptance** | `POST /api/attempts` → 201, response chứa `attemptId`, `remainingSeconds`, exam data KHÔNG chứa `acceptedAnswers` và `explanation` |

**Prompt for Coder:**
> Tạo file mới hoặc bổ sung trong `api/src/modules/attempts/`:
>
> **1. `attempt.validation.ts`:** Zod schema:
> - `StartAttemptSchema`: body { examId (string), assignmentId (string optional) }.
> - `AutosaveAnswersSchema`: params { id }, body { answers: array of { questionId (string), value (string) } }.
>
> **2. `attempt.service.ts`:** Function `startAttempt(studentId, examId, assignmentId?)`:
> - Verify exam tồn tại và status = "published".
> - Nếu có `assignmentId`, verify assignment tồn tại và chưa quá deadline.
> - Nếu student ĐÃ có attempt `in_progress` cho exam này → trả lại attempt cũ kèm `remainingSeconds` và exam data (đã strip) để client resume (F5 / bấm "Làm bài" lại). Không tạo attempt mới.
> - Tính: `startedAt = new Date()`, `expiresAt = new Date(startedAt.getTime() + exam.durationMinutes * 60 * 1000)`.
> - Tạo Attempt mới.
> - **Data Projection (QUAN TRỌNG):** Populate exam.sections.questionIds nhưng dùng `.select('-acceptedAnswers -explanation')` để loại bỏ hoàn toàn 2 trường này khỏi response.
> - Tính `remainingSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))`.
> - Return attempt data + exam data (đã strip) + remainingSeconds.
>
> **3. `attempt.controller.ts`:** Handler `start`.
>
> **4. `attempt.routes.ts`:** Mount tại `/api/attempts`.
> - `POST /` → authenticate + requireRoles('student') + validate(StartAttemptSchema) → start.
>
> Mount vào `app.ts`: `app.use('/api/attempts', attemptRoutes)`.

---

### TASK 6.3 — Attempt Module: State Recovery (GET /api/attempts/:id)

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Khôi phục trạng thái bài thi khi F5/mất mạng — strip đáp án |
| **Input** | backend-spec.md Section 5.6 (4), 6.6 (endpoint 2) |
| **Output** | Bổ sung `attempt.service.ts`, `attempt.controller.ts`, `attempt.routes.ts` |
| **Acceptance** | `GET /api/attempts/:id` → 200, trả answers đã lưu + remainingSeconds + exam data (KHÔNG có acceptedAnswers, explanation). Nếu attempt không thuộc student → 403 |

**Prompt for Coder:**
> Bổ sung vào Attempt module:
>
> **Trong `attempt.service.ts`** thêm function `getAttemptForRecovery(attemptId, studentId)`:
> - Tìm attempt theo ID. Not found → throw `NotFoundError`.
> - Verify `attempt.studentId === studentId`. Sai → throw `ForbiddenError('ATTEMPT_NOT_OWNED')`.
> - Populate exam và exam.sections.questionIds, **strip `acceptedAnswers` và `explanation`** (dùng `.select('-acceptedAnswers -explanation')` hoặc map xóa thủ công).
> - Tính `remainingSeconds = Math.max(0, Math.floor((attempt.expiresAt - Date.now()) / 1000))`.
> - Nếu `remainingSeconds <= 0` và `status === 'in_progress'` → tự động update `status = 'expired'`.
> - Return { attemptId, status, remainingSeconds, answers, exam (đã strip) }.
>
> **Trong `attempt.controller.ts`** thêm handler `getAttempt`.
>
> **Trong `attempt.routes.ts`** thêm:
> - `GET /:id` → authenticate → getAttempt.

---

### TASK 6.4 — Attempt Module: Autosave (PATCH /api/attempts/:id/answers)

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Idempotent upsert đáp án từng phần |
| **Input** | backend-spec.md Section 5.6 (3), 6.6 (endpoint 3) |
| **Output** | Bổ sung `attempt.service.ts`, `attempt.controller.ts`, `attempt.routes.ts` |
| **Acceptance** | `PATCH /api/attempts/:id/answers` → 200. Upsert đúng: cập nhật nếu questionId đã tồn tại, thêm mới nếu chưa có. Từ chối nếu expired hoặc submitted |

**Prompt for Coder:**
> Bổ sung vào Attempt module:
>
> **Trong `attempt.service.ts`** thêm function `autosaveAnswers(attemptId, studentId, answers: { questionId: string, value: string }[])`:
> - Tìm attempt, verify ownership (`ATTEMPT_NOT_OWNED`).
> - Kiểm tra `status !== 'in_progress'` → throw `BadRequestError('EXAM_ALREADY_SUBMITTED')`.
> - Kiểm tra `Date.now() > expiresAt + EXAM_GRACE_PERIOD_SECONDS * 1000` → throw `ForbiddenError('EXAM_EXPIRED')`.
> - Duyệt mỗi answer: tìm trong `attempt.answers` theo `questionId`. Nếu đã tồn tại → update `value` và `savedAt = new Date()`. Nếu chưa → push mới.
> - Save attempt.
> - Tính `serverRemainingSeconds`.
> - Return `{ savedCount: answers.length, serverRemainingSeconds }`.
>
> **Trong `attempt.controller.ts`** thêm handler `autosave`.
>
> **Trong `attempt.routes.ts`** thêm:
> - `PATCH /:id/answers` → authenticate + validate(AutosaveAnswersSchema) → autosave.

---

### TASK 6.5 — Attempt Module: Submit + Auto-Grading (POST /api/attempts/:id/submit)

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Nộp bài, khóa attempt, chấm tự động Listening/Reading |
| **Input** | backend-spec.md Section 5.6 (5), 5.7, 6.6 (endpoint 4) |
| **Output** | Bổ sung `attempt.service.ts`, `attempt.controller.ts`, `attempt.routes.ts` |
| **Acceptance** | `POST /api/attempts/:id/submit` → 200. Attempt locked status="submitted". Scores Listening/Reading được tính và lưu vào DB |

**Prompt for Coder:**
> Bổ sung vào Attempt module:
>
> **Trong `attempt.service.ts`** thêm function `submitAttempt(attemptId, studentId)`:
> 1. Tìm attempt, verify ownership.
> 2. Kiểm tra `status !== 'in_progress'` → throw `BadRequestError('EXAM_ALREADY_SUBMITTED')`.
> 3. Kiểm tra thời gian: `Date.now() > expiresAt + EXAM_GRACE_PERIOD * 1000` → throw `ForbiddenError('EXAM_EXPIRED')`.
> 4. Đổi `status = 'submitted'`, `submittedAt = new Date()`.
> 5. **Auto-grading Listening & Reading:**
>    - Populate exam → lấy tất cả questions thuộc skill "listening" hoặc "reading".
>    - Với mỗi câu hỏi: tìm answer tương ứng trong `attempt.answers`. Dùng `matchAnswer(studentAnswer, question.acceptedAnswers)` từ `string-normalizer.ts`. Nếu match → cộng `question.points` (không hardcode +1).
>    - Tổng raw score cho listening và reading riêng.
>    - Dùng `calculateBandScore(rawScore, skill)` từ `constants.ts` để quy đổi band.
>    - Gán `scores.listeningRaw`, `scores.listeningBand`, `scores.readingRaw`, `scores.readingBand`.
>    - KHÔNG tính `overallBand` ở bước này: để `overallBand = undefined` (null) chờ chấm Writing. Riêng đề KHÔNG có section `writing` thì tính ngay `overallBand = calculateOverallBand({ listening, reading })`.
> 6. Dùng MongoDB session/transaction cho bước lock attempt + ghi scores để tránh trạng thái dở dang nếu crash giữa chừng (nếu không dùng replica set, tối thiểu làm atomic update rồi re-fetch).
> 7. Save attempt. Return attempt data với scores.
>
> **Trong `attempt.controller.ts`** thêm handler `submit`.
>
> **Trong `attempt.routes.ts`** thêm:
> - `POST /:id/submit` → authenticate → submit.

---

### TASK 6.6 — Attempt Module: View Result (GET /api/attempts/:id/result)

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Học sinh xem kết quả chi tiết sau khi nộp — hiển thị đáp án đúng, giải thích, điểm |
| **Input** | backend-spec.md Section 5.6 (6), 6.6 (endpoint 5) |
| **Output** | Bổ sung `attempt.service.ts`, `attempt.controller.ts`, `attempt.routes.ts` |
| **Acceptance** | `GET /api/attempts/:id/result` → 200. Response chứa `acceptedAnswers`, `explanation`, `isCorrect` cho mỗi câu hỏi. Chỉ trả khi status="submitted" |

**Prompt for Coder:**
> Bổ sung vào Attempt module:
>
> **Trong `attempt.service.ts`** thêm function `getAttemptResult(attemptId, studentId)`:
> 1. Tìm attempt, verify ownership.
> 2. Kiểm tra `status !== 'submitted'` → throw `BadRequestError('Bài thi chưa được nộp')`.
> 3. Populate exam với đầy đủ questions (LẦN NÀY KHÔNG strip `acceptedAnswers` và `explanation` vì đây là xem kết quả).
> 4. Build `details[]`: với mỗi question → tìm student answer → dùng `matchAnswer()` → trả `{ questionId, studentAnswer, acceptedAnswers, isCorrect, explanation }`.
> 5. Tìm WritingReview nếu có (query WritingReviewModel by attemptId).
> 6. Return `{ attemptId, status, scores, writingReview (nếu có), details }`.
>
> **Trong `attempt.controller.ts`** thêm handler `getResult`.
>
> **Trong `attempt.routes.ts`** thêm:
> - `GET /:id/result` → authenticate → getResult.

---

## PHASE 7: GRADING MODULE (Writing Review)

### TASK 7.1 — WritingReview Model

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo Mongoose model cho WritingReview |
| **Input** | backend-spec.md Section 4.7 |
| **Output** | `src/modules/grading/writing-review.model.ts` |
| **Acceptance** | Interface `IWritingReview` đúng. Index `attemptId` unique, `teacherId`, `studentId` |

**Prompt for Coder:**
> Tạo file `api/src/modules/grading/writing-review.model.ts`:
>
> - Interface `ITaskGrade`: `score: number` (0-9, bước 0.5), `comment?: string`.
> - Interface `IWritingReview extends Document`: `_id`, `attemptId: Types.ObjectId` (ref "Attempt"), `studentId: Types.ObjectId` (ref "User"), `teacherId: Types.ObjectId` (ref "User"), `task1: ITaskGrade`, `task2: ITaskGrade`, `overallWritingScore: number` (0-9), `generalFeedback?: string`, timestamps.
> - Schema: attemptId required unique, studentId required, teacherId required, task1.score required min 0 max 9, task2.score required min 0 max 9, overallWritingScore required min 0 max 9.
> - Indexes: `{ attemptId: 1 }` unique, `{ teacherId: 1 }`, `{ studentId: 1 }`.
> - `timestamps: true`, `versionKey: false`.
> - Export `WritingReviewModel`.

---

### TASK 7.2 — Grading Module: Service, Controller, Routes

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Pending list, grading view, submit writing review |
| **Input** | backend-spec.md Section 5.8, 6.7 |
| **Output** | `src/modules/grading/grading.validation.ts`, `grading.service.ts`, `grading.controller.ts`, `grading.routes.ts` |
| **Acceptance** | `GET /api/grading/pending`, `GET /api/attempts/:id/grading`, `POST /api/writing-reviews` |

**Prompt for Coder:**
> Tạo Grading module trong `api/src/modules/grading/` gồm 4 file:
>
> **1. `grading.validation.ts`:** Zod schema:
> - `GradeWritingSchema`: body { attemptId (string), task1: { score (number 0-9), comment (optional) }, task2: { score (number 0-9), comment (optional) }, generalFeedback (optional) }.
>
> **2. `grading.service.ts`:**
> - `getPendingWritingSubmissions(teacherId)`: Tìm tất cả Attempts có `status = 'submitted'`. Join exam → lọc exam phải có ít nhất 1 section `skill = 'writing'`. Join check exam.createdBy === teacherId (hoặc assignment.teacherId). Left join WritingReview → chỉ lấy những attempt chưa có review. Populate student name, email. Populate exam title. Return danh sách.
> - `getAttemptForGrading(attemptId, teacherId)`: Tìm attempt, verify status = "submitted". **Verify phân quyền: attempt phải thuộc đề do giáo viên này sở hữu** — populate `examId.createdBy` (và/hoặc `assignmentId.teacherId`); nếu không thuộc teacherId → throw `ForbiddenError('FORBIDDEN')`. Populate exam. Lấy các câu hỏi writing (type writing_task_1, writing_task_2). Map student answers cho writing questions. Tính word count cho mỗi task bằng `value.split(/\s+/).filter(Boolean).length`. Return { attemptId, student info, writingTasks: [{ task, prompt, studentContent, wordCount }] }.
> - `gradeWriting(data, teacherId)`: Tìm attempt, verify submitted + **verify phân quyền như trên**. Kiểm tra chưa có WritingReview cho attempt này (hoặc cho phép cập nhật). Tính `overallWritingScore = calculateWritingBand(task1.score, task2.score)`. Tạo WritingReview. Cập nhật `attempt.scores.writingTask1Band`, `writingTask2Band`, `writingBand`, rồi re-calculate `overallBand = calculateOverallBand({ listening, reading, writing })`. Save attempt.
>
> **3. `grading.controller.ts`:** Handler cho mỗi endpoint.
>
> **4. `grading.routes.ts`:** Mount tại `/api/grading` và `/api/writing-reviews`.
> - `GET /api/grading/pending` → authenticate + requireRoles('teacher','admin') → getPending.
> - `GET /api/attempts/:id/grading` → authenticate + requireRoles('teacher','admin') → getForGrading (thêm route vào attemptRoutes hoặc grading routes).
> - `POST /api/writing-reviews` → authenticate + requireRoles('teacher','admin') + validate → gradeWriting.
>
> Mount vào `app.ts`.

---

## PHASE 8: MEDIA MODULE (MinIO Integration)

### TASK 8.1 — Media Model

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo Mongoose model cho Media metadata |
| **Input** | backend-spec.md Section 4.8 |
| **Output** | `src/modules/media/media.model.ts` |
| **Acceptance** | Interface `IMedia` đúng. Index `key` unique, `uploadedBy` |

**Prompt for Coder:**
> Tạo file `api/src/modules/media/media.model.ts`:
>
> - Types: `MediaType = "audio" | "image"`.
> - Interface `IMedia extends Document`: `_id`, `bucket: string`, `key: string` (S3 object key, VD: "audio/2026/09/uuid_file.mp3"), `originalName: string`, `mimeType: string`, `size: number` (bytes), `type: MediaType`, `uploadedBy: Types.ObjectId` (ref "User"), timestamps.
> - Schema: bucket required, key required unique, originalName required, mimeType required, size required, type enum required, uploadedBy required ref "User".
> - Indexes: `{ key: 1 }` unique, `{ uploadedBy: 1 }`.
> - `timestamps: true`, `versionKey: false`.
> - Export `MediaModel`.

---

### TASK 8.2 — Media Module: Presigned Upload + Confirm

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Zero Media Proxying: cấp presigned URL để client upload trực tiếp lên MinIO |
| **Input** | backend-spec.md Section 5.9, 6.8 |
| **Output** | `src/modules/media/media.validation.ts`, `media.service.ts`, `media.controller.ts`, `media.routes.ts` |
| **Acceptance** | `POST /api/media/presign` → 200 trả `uploadUrl` + `mediaId`. `POST /api/media/:id/confirm` → 200 |

**Prompt for Coder:**
> Tạo Media module trong `api/src/modules/media/` gồm 4 file:
>
> **1. `media.validation.ts`:** Zod schema:
> - `PresignUploadSchema`: body { filename (string), mimeType (enum "audio/mpeg" | "audio/wav" | "image/png" | "image/jpeg"), type (enum "audio" | "image"), size (number max 100*1024*1024 = 100MB) }.
>
> **2. `media.service.ts`:**
> - `createPresignedUpload(data, userId)`:
>   1. Tạo S3 key: `uploads/${data.type}/${year}/${month}/${uuid}_${cleanFilename}` (loại bỏ ký tự đặc biệt từ filename).
>   2. Tạo bản ghi Media trong DB (model Media theo Section 4.8 KHÔNG có field `status`; `confirm` chỉ xác nhận file tồn tại, không cần lưu trạng thái pending/confirmed riêng).
>   3. Gọi `minioClient.presignedPutObject(env.MINIO_BUCKET, key, 15 * 60)` để lấy presigned PUT URL.
>   4. Return `{ mediaId, uploadUrl, publicUrl: env.PUBLIC_MEDIA_URL + '/' + key, expiresInSeconds: 900 }`.
> - `confirmUpload(mediaId, userId)`:
>   1. Tìm media, verify ownership.
>   2. Kiểm tra file thực sự tồn tại trên MinIO bằng `minioClient.statObject()`.
>   3. Return `{ id: mediaId, status: 'confirmed' }`.
>
> **3. `media.controller.ts`:** Handler cho presign và confirm.
>
> **4. `media.routes.ts`:** Mount tại `/api/media`.
> - `POST /presign` → authenticate + requireRoles('teacher','admin') + validate → presign.
> - `POST /:id/confirm` → authenticate → confirm.
>
> Mount vào `app.ts`: `app.use('/api/media', mediaRoutes)`.

---

## PHASE 9: ANTI-CHEAT MODULE

### TASK 9.1 — ExamEvent Model

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Tạo Mongoose model cho Anti-cheat Events |
| **Input** | backend-spec.md Section 4.9 |
| **Output** | `src/modules/anti-cheat/exam-event.model.ts` |
| **Acceptance** | Interface `IExamEvent` đúng. Indexes trên `attemptId+type`, `studentId` |

**Prompt for Coder:**
> Tạo file `api/src/modules/anti-cheat/exam-event.model.ts`:
>
> - Types: `ExamEventType = "TAB_SWITCH" | "WINDOW_BLUR" | "FULLSCREEN_EXIT" | "RELOAD" | "COPY" | "PASTE" | "CUT" | "CONTEXT_MENU"`.
> - Interface `IExamEvent extends Document`: `_id`, `attemptId: Types.ObjectId` (ref "Attempt"), `studentId: Types.ObjectId` (ref "User"), `type: ExamEventType`, `timestamp: Date`, `metadata?: Record<string, any>`, `createdAt: Date`.
> - Schema: attemptId required, studentId required, type enum required, timestamp default Date.now, metadata Mixed default {}.
> - Timestamps: chỉ `createdAt`, KHÔNG có `updatedAt` (`{ timestamps: { createdAt: true, updatedAt: false } }`).
> - `versionKey: false`.
> - Indexes: `{ attemptId: 1, type: 1 }`, `{ studentId: 1 }`.
> - Export `ExamEventModel`.

---

### TASK 9.2 — Anti-cheat Module: Log Event + Suspicious Detection

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Ghi nhận sự kiện gian lận + tự động bật cờ suspicious khi vượt ngưỡng |
| **Input** | backend-spec.md Section 5.10, 6.9 |
| **Output** | `src/modules/anti-cheat/anti-cheat.validation.ts`, `anti-cheat.service.ts`, `anti-cheat.controller.ts`, `anti-cheat.routes.ts` |
| **Acceptance** | `POST /api/anti-cheat/events` → 200. Khi TAB_SWITCH + WINDOW_BLUR ≥ 5 → attempt.suspicious = true |

**Prompt for Coder:**
> Tạo Anti-cheat module trong `api/src/modules/anti-cheat/` gồm 4 file:
>
> **1. `anti-cheat.validation.ts`:** Zod schema:
> - `LogExamEventSchema`: body { attemptId (string), type (enum TAB_SWITCH, WINDOW_BLUR, FULLSCREEN_EXIT, RELOAD, COPY, PASTE, CUT, CONTEXT_MENU), timestamp (datetime optional), metadata (record any, optional) }.
>
> **2. `anti-cheat.service.ts`:**
> - `logEvent(data, studentId)`:
>   1. Verify attempt tồn tại, thuộc studentId, và status = "in_progress".
>   2. Tạo ExamEvent mới.
>   3. **Kiểm tra ngưỡng suspicious:**
>      - Count events cho attempt này: `TAB_SWITCH` + `WINDOW_BLUR` >= `env.ANTI_CHEAT_TAB_SWITCH_THRESHOLD` (5).
>      - `FULLSCREEN_EXIT` >= `env.ANTI_CHEAT_FULLSCREEN_EXIT_THRESHOLD` (2).
>      - `PASTE` >= `env.ANTI_CHEAT_PASTE_THRESHOLD` (3).
>   4. Nếu bất kỳ điều kiện nào thỏa → update `AttemptModel.updateOne({ _id: attemptId }, { suspicious: true })`.
>   5. Return `{ recorded: true, suspiciousFlag: attempt.suspicious }`.
>
> **3. `anti-cheat.controller.ts`:** Handler cho logEvent.
>
> **4. `anti-cheat.routes.ts`:** Mount tại `/api/anti-cheat`.
> - `POST /events` → authenticate + requireRoles('student') + validate → logEvent.
>
> Mount vào `app.ts`: `app.use('/api/anti-cheat', antiCheatRoutes)`.
>
> **Ghi chú:** Anti-cheat chỉ mang tính răn đe/hỗ trợ giáo viên review (client tự report nên có thể bị bypass). Ngưỡng `PASTE ≥ 3 "trong phần Writing"` theo spec không phân biệt được skill trong event model hiện tại — chấp nhận đếm PASTE toàn cục trong MVP và ghi rõ giới hạn này vào code comment.

---

## PHASE 10: DOCKER & DEPLOYMENT

### TASK 10.1 — Dockerfile cho API

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Multi-stage Dockerfile tối ưu cho production |
| **Input** | backend-spec.md Section 7.1 |
| **Output** | `api/Dockerfile` |
| **Acceptance** | `docker build -t ielts-api ./api` thành công. Image size < 200MB |

**Prompt for Coder:**
> Tạo file `api/Dockerfile` — multi-stage build:
>
> **Stage 1 (builder):** `FROM node:20-alpine AS builder`. WORKDIR /app. COPY package*.json tsconfig.json. RUN npm ci. COPY src. RUN npm run build.
>
> **Stage 2 (runner):** `FROM node:20-alpine AS runner`. WORKDIR /app. ENV NODE_ENV=production. COPY package*.json. RUN npm ci --only=production. COPY --from=builder /app/dist ./dist. USER node. EXPOSE 4000. CMD ["node", "dist/server.js"].

---

### TASK 10.2 — Docker Compose

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | docker-compose.yml cho toàn bộ stack: API + MongoDB + MinIO + Cloudflared |
| **Input** | backend-spec.md Section 7.2 |
| **Output** | `docker-compose.yml` (ở root project) |
| **Acceptance** | `docker compose up -d` → 4 containers chạy, API truy cập được tại localhost:4000/api/health |

**Prompt for Coder:**
> Tạo file `docker-compose.yml` tại thư mục root project:
>
> Services:
> 1. **api**: build context `./api`, container_name `ielts_api`, restart always, env vars từ `.env.example` (dùng placeholder), depends_on mongodb + minio, ports 4000:4000, network ielts_network.
> 2. **mongodb**: image `mongo:7.0`, container_name `ielts_mongodb`, restart always, env MONGO_INITDB_ROOT_USERNAME, MONGO_INITDB_ROOT_PASSWORD, MONGO_INITDB_DATABASE=ielts_db, volume mongo_data:/data/db, network ielts_network.
> 3. **minio**: image `minio/minio:latest`, container_name `ielts_minio`, restart always, command `server /data --console-address ":9001"`, env MINIO_ROOT_USER + MINIO_ROOT_PASSWORD, volume minio_data:/data, ports 9000:9000 + 9001:9001, network ielts_network.
> 4. **cloudflared**: image `cloudflare/cloudflared:latest`, container_name `ielts_cloudflared`, restart always, command `tunnel run`, env TUNNEL_TOKEN (placeholder), network ielts_network.
>
> Volumes: mongo_data (local), minio_data (local).
> Networks: ielts_network (bridge).

---

## PHASE 11: SEED DATA & SMOKE TEST

### TASK 11.1 — Database Seed Script

| Mục | Chi tiết |
|---|---|
| **Mục tiêu** | Script tạo dữ liệu mẫu để test toàn bộ flow |
| **Input** | Tất cả models đã tạo |
| **Output** | `api/src/scripts/seed.ts` |
| **Acceptance** | Chạy `npx tsx src/scripts/seed.ts` → tạo thành công 1 admin, 1 teacher, 2 students, 1 class, 5 questions, 1 exam, 1 assignment |

**Prompt for Coder:**
> Tạo file `api/src/scripts/seed.ts`:
>
> Script chạy độc lập (không qua Express). Import tất cả models, connectDB, bcrypt.
> Tạo dữ liệu theo thứ tự:
> 1. **Users:** 1 admin (email: admin@ielts.com, pass: Admin@123), 1 teacher (teacher@ielts.com, pass: Teacher@123), 2 students (student1@ielts.com, student2@ielts.com, pass: Student@123).
> 2. **Class:** 1 class tên "IELTS Intensive K12", teacherId = teacher, students = [student1, student2].
> 3. **Questions:** 5 câu hỏi mẫu: 2 listening (form_completion, multiple_choice), 2 reading (true_false_not_given, matching_headings), 1 writing (writing_task_1). Mỗi câu có acceptedAnswers hợp lệ.
> 4. **Exam:** 1 đề gồm 3 sections (listening part 1, reading part 1, writing part 1), gán questionIds tương ứng, status = "published", durationMinutes = 60.
> 5. **Assignment:** Giao exam cho class, deadline = 30 ngày sau.
> 6. Log tóm tắt dữ liệu đã tạo, disconnect DB.
>
> Thêm script `"seed": "tsx src/scripts/seed.ts"` vào package.json.
>
> Ngoài ra, tạo thêm `api/src/scripts/smoke-test.ts` (hoặc file `.http`/curl) để verify end-to-end sau khi seed: register → login → create class → create question → create exam → publish → assign → start attempt → autosave → submit → grade writing → get result. Chạy `npx tsx src/scripts/smoke-test.ts` phải trả kết quả không lỗi.

---

## TÓM TẮT CÁC PHASES VÀ THỨ TỰ THỰC THI

| Phase | Nội dung | Số Tasks | Phụ thuộc |
|:---:|---|:---:|---|
| **0** | Khởi tạo project, Config, Common, Entry points, Utils | 5 | Không |
| **1** | Auth & User Module (Register, Login, JWT, RBAC, Profile) | 5 | Phase 0 |
| **2** | Class Management (CRUD, Join, Add/Remove students) | 2 | Phase 1 |
| **3** | Question Bank (CRUD + Filter + Pagination) | 2 | Phase 1 |
| **4** | Exam Management (CRUD, Clone, Publish, Close) | 2 | Phase 3 |
| **5** | Assignment (Giao bài, Xem bài tập) | 2 | Phase 2, 4 |
| **6** | Attempt & Exam Engine (Start, Recovery, Autosave, Submit, Result) | 6 | Phase 5 |
| **7** | Grading Module (Writing Review) | 2 | Phase 6 |
| **8** | Media Module (MinIO Presigned Upload) | 2 | Phase 1 |
| **9** | Anti-cheat (Log Events, Suspicious Detection) | 2 | Phase 6 |
| **10** | Docker & Deployment | 2 | All |
| **11** | Seed Data & Smoke Test | 1 | All |
| | **TỔNG CỘNG** | **33 Tasks** | |

---

> **Ghi chú cho người điều phối:** Thực thi các task tuần tự trong mỗi Phase. Các Phase 2, 3, 8 có thể chạy song song vì không phụ thuộc lẫn nhau (chỉ phụ thuộc Phase 1). Phase 9 có thể chạy song song với Phase 7. Mỗi task hoàn thành nên test thủ công bằng Postman/curl trước khi chuyển task tiếp.
