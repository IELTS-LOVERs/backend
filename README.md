# IELTS LOVERs — Backend API

A production-ready, modular monolith backend service for online IELTS examinations (Listening, Reading, and Writing). Built with Node.js, Express 5, TypeScript (Strict Mode), MongoDB, and MinIO S3 object storage.

---

## Table of Contents

- [Overview](#overview)
- [Architecture & Design Principles](#architecture--design-principles)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Installation & Local Setup](#installation--local-setup)
  - [Option 1: Full Stack with Docker Compose (Recommended)](#option-1-full-stack-with-docker-compose-recommended)
  - [Option 2: Local Development Mode](#option-2-local-development-mode)
- [Database Seeding & Smoke Testing](#database-seeding--smoke-testing)
- [API Overview & Endpoints Reference](#api-overview--endpoints-reference)
  - [Response Envelope Format](#response-envelope-format)
  - [Authentication & Users](#1-authentication--users)
  - [Class Management](#2-class-management)
  - [Question Bank](#3-question-bank)
  - [Exam Management](#4-exam-management)
  - [Assignments](#5-assignments)
  - [Exam Engine & Attempts](#6-exam-engine--attempts)
  - [Grading & Writing Reviews](#7-grading--writing-reviews)
  - [Media Storage](#8-media-storage)
  - [Anti-Cheat Monitoring](#9-anti-cheat-monitoring)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [License](#license)

---

## Overview

The IELTS Online Platform provides an end-to-end examination engine simulating real-world academic IELTS computer-delivered tests. It supports:

- Secure user authentication with Role-Based Access Control (Student, Teacher, Administrator).
- Dynamic question banks covering multiple question archetypes (multiple choice, note/form completion, matching headings, writing tasks).
- Real-time exam taking with server-authoritative countdown timers, automatic answer preservation, and strict answer sanitization to prevent client-side inspection.
- Instant automated scoring for Listening and Reading based on official IELTS band tables, combined with teacher-reviewed scoring workflows for Writing tasks.
- Anti-cheat behavioral telemetry tracking suspicious tab switching, window blurring, fullscreen exits, and paste events.
- Direct-to-storage media handling using presigned URLs to minimize backend memory and I/O load.

---

## Architecture & Design Principles

1. **Modular Monolith:** Domain logic is partitioned into self-contained modules (`auth`, `users`, `classes`, `questions`, `exams`, `assignments`, `attempts`, `grading`, `media`, `anti-cheat`), sharing unified config, error, and middleware layers.
2. **Server-Authoritative Timing:** Test duration is tracked and verified strictly on the server (`startedAt`, `expiresAt`). Clients cannot dictate remaining time. Submissions and autosaves beyond the allotted duration plus a 15-second network grace window are rejected.
3. **Zero Media Proxying:** Express does not handle heavy binary payloads (audio/images). Clients request presigned PUT URLs and upload directly to MinIO S3 object storage.
4. **Idempotent Autosave:** Incremental answer persistence debounced at regular intervals ensures zero data loss upon page reloads or network drops.
5. **Data Projection & Anti-Leak Sanitization:** Candidate-facing endpoints (`POST /api/attempts`, `GET /api/attempts/:id`, `GET /api/exams/:id` for students) strip `acceptedAnswers` and `explanation` fields from all question structures. Answers are only made accessible after an attempt is marked as submitted/expired and fetched via the dedicated result endpoint.
6. **Strict Validation & Type Safety:** All incoming requests (body, params, query) are validated at the middleware layer using Zod schemas with TypeScript strict typing enabled throughout the entire pipeline.

---

## Technology Stack

- **Runtime:** Node.js 20+ (ESM module system)
- **Framework:** Express.js 5
- **Language:** TypeScript 5.8+ (Strict Mode, NodeNext module resolution)
- **Database:** MongoDB 8.0+ via Mongoose 9
- **Object Storage:** MinIO S3 (S3-compatible API)
- **Authentication:** JWT (Short-lived Access Tokens in headers, HTTP-only Refresh Tokens in Secure Cookies) + bcrypt password hashing (cost factor 12)
- **Validation:** Zod 4
- **Security Middlewares:** Helmet, CORS, Express Rate Limit
- **Testing:** Vitest

---

## Project Structure

```text
IELTSLOVERs/
├── docker-compose.yml          # Container orchestration (API, MongoDB, MinIO, Cloudflared)
├── backend/
│   ├── backend-spec.md         # Comprehensive technical specification
│   ├── implementation-plan.md  # Step-by-step development roadmap
│   └── api/
│       ├── package.json        # Dependencies and scripts
│       ├── tsconfig.json       # TypeScript compiler configuration
│       ├── Dockerfile          # Multi-stage production container build
│       └── src/
│           ├── server.ts       # HTTP bootstrap & infrastructure connection
│           ├── app.ts          # Express application initialization & routes
│           ├── config/         # Environment, database, MinIO, and IELTS constants
│           ├── common/         # Errors, middlewares, utilities, types
│           │   ├── errors/     # Custom AppError subclasses
│           │   ├── middlewares/# auth, rbac, validation, rate limiting, error handling
│           │   ├── types/      # Express request augmentations
│           │   └── utils/      # ielts-calculator, string-normalizer, response.util
│           ├── modules/        # Domain business modules
│           │   ├── anti-cheat/ # Behavioral telemetry & heuristics
│           │   ├── assignments/# Exam assignment management
│           │   ├── attempts/   # Core exam engine (timer, autosave, submission)
│           │   ├── auth/       # Authentication, token generation, password change
│           │   ├── classes/    # Classrooms, student enrollment, code generation
│           │   ├── exams/      # Exam management, sections, cloning, publishing
│           │   ├── grading/    # Manual writing reviews & grading queues
│           │   ├── media/      # MinIO presigned URL generator & confirmation
│           │   ├── questions/  # Question bank CRUD & data structures
│           │   └── users/      # User models, profiles, admin password reset
│           └── scripts/
│               ├── seed.ts     # Database seeder with sample accounts and tests
│               └── smoke-test.ts# End-to-end integration smoke runner
```

---

## Prerequisites

Ensure you have the following installed on your host system:

- Node.js >= 20.x
- npm >= 10.x
- Docker and Docker Compose (if running containerized services)

---

## Environment Configuration

A configuration template is located at `backend/api/.env.example`. Create a `.env` file in `backend/api/` (or copy from the example):

```bash
cp backend/api/.env.example backend/api/.env
```

Key environment variables:

| Variable | Description | Default / Example |
|---|---|---|
| `NODE_ENV` | Application runtime environment | `development` |
| `PORT` | API listening port | `4000` |
| `HOST` | Bind address | `0.0.0.0` |
| `CORS_ORIGIN` | Allowed web frontend origin | `http://localhost:3000` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/ielts_db` |
| `JWT_ACCESS_SECRET` | Secret key for signing access tokens | *(Required string)* |
| `JWT_ACCESS_EXPIRES_IN`| Access token validity duration | `15m` |
| `JWT_REFRESH_SECRET` | Secret key for signing refresh tokens | *(Required string)* |
| `JWT_REFRESH_EXPIRES_IN`| Refresh token validity duration | `7d` |
| `MINIO_ENDPOINT` | MinIO host | `localhost` or `minio` |
| `MINIO_PORT` | MinIO S3 API port | `9000` |
| `MINIO_USE_SSL` | Enable TLS/SSL for MinIO connection | `false` |
| `MINIO_ACCESS_KEY` | MinIO root username | `minioadmin` |
| `MINIO_SECRET_KEY` | MinIO root password | `minioadmin` |
| `MINIO_BUCKET` | Default storage bucket | `ielts-media` |
| `PUBLIC_MEDIA_URL` | Public base URL for media assets | `http://localhost:9000/ielts-media` |
| `EXAM_GRACE_PERIOD_SECONDS`| Network delay buffer for submit/autosave | `15` |
| `REQUIRE_ASSIGNMENT_FOR_ATTEMPT`| Require a valid assignment before starting an attempt | `false` (local) / `true` (docker-compose production) |
| `ANTI_CHEAT_TAB_SWITCH_THRESHOLD`| Max tab switches before flagging | `5` |
| `ANTI_CHEAT_FULLSCREEN_EXIT_THRESHOLD`| Max fullscreen exits before flagging | `2` |
| `ANTI_CHEAT_PASTE_THRESHOLD`| Max paste occurrences before flagging | `3` |

---

## Installation & Local Setup

### Option 1: Full Stack with Docker Compose (Recommended)

To spin up MongoDB, MinIO, and the API together:

```bash
# Start all core services in detached mode
docker compose up -d

# Verify container health status
docker compose ps
```

The services will be available at:
- Express API: `http://localhost:4000`
- API Healthcheck: `http://localhost:4000/api/health`
- MinIO S3 API: `http://localhost:9000`
- MinIO Web Console: `http://localhost:9001` (User: `minioadmin` / Pass: `minioadmin`)
- MongoDB: `localhost:27017`

To stop services:
```bash
docker compose down
```

---

### Option 2: Local Development Mode

If running MongoDB and MinIO locally or in separate containers, run the API directly on the host:

```bash
# Navigate to the backend application directory
cd backend/api

# Install dependencies
npm install

# Start development server with live reload (tsx)
npm run dev
```

To compile and execute production builds:

```bash
npm run build
npm start
```

---

## Database Seeding & Smoke Testing

### 1. Seeding Data
Populate the database with sample administrators, teachers, students, classroom enrollments, IELTS questions, and a mock exam:

```bash
cd backend/api
npm run seed
```

Default credentials created by the seeder:

| Role | Email | Password | Details |
|---|---|---|---|
| Admin | `admin@ielts.com` | `Admin@123` | System Administrator |
| Teacher | `teacher@ielts.com` | `Teacher@123` | Instructor & Exam Author |
| Student 1 | `student1@ielts.com` | `Student@123` | Enrolled in "IELTS Intensive K12" |
| Student 2 | `student2@ielts.com` | `Student@123` | Enrolled in "IELTS Intensive K12" |

### 2. End-to-End Smoke Test
Run automated HTTP workflows verifying full user lifecycles (register, login, create exam, take exam, autosave, submit, grade, and review):

```bash
cd backend/api
npm run smoke
```

### 3. Periodic Jobs

The platform ships two idempotent maintenance scripts that can be scheduled with `cron`, a systemd timer, or any scheduler:

```bash
cd backend/api

# Auto-submit and auto-grade attempts that passed expiresAt + grace (sets status "expired")
npm run auto-finalize

# Delete pending media records (and MinIO objects) never confirmed within 24h
npm run cleanup-media
```

Example crontab (every 5 minutes / hourly):

```cron
*/5 * * * * cd /srv/ielts/backend/api && npm run auto-finalize >> /var/log/ielts-auto-finalize.log 2>&1
0 * * * * cd /srv/ielts/backend/api && npm run cleanup-media >> /var/log/ielts-cleanup-media.log 2>&1
```

### 4. MongoDB & MinIO Backup

The compose file provides an optional scheduled MongoDB backup container based on `mongodump`:

```bash
# Start API + MongoDB + MinIO + periodic backup (24h interval, 14-day retention)
docker compose --profile backup up -d

# Backups are stored in the mongo_backup_data volume as ielts-YYYYmmdd-HHMMSS.archive.gz
docker compose exec mongo-backup ls -lh /backups
```

Restore a backup archive:

```bash
docker compose exec -T mongodb mongorestore --uri="mongodb://localhost:27017/ielts_db" --archive --gzip < backups/ielts-YYYYmmdd-HHMMSS.archive.gz
```

For MinIO media, mirror the bucket to an external disk or S3 endpoint (adjust credentials/alias):

```bash
mc alias set ielts http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mirror --overwrite ielts/ielts-media /backups/minio/ielts-media
```

---

## API Overview & Endpoints Reference

### Response Envelope Format

All responses strictly follow the standardized envelope convention.

#### Success Envelope (HTTP 200, 201)
```json
{
  "success": true,
  "data": {},
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

#### Failure Envelope (HTTP 4xx, 5xx)
```json
{
  "success": false,
  "error": {
    "code": "EXAM_EXPIRED",
    "message": "The exam session has ended. No further answers can be accepted.",
    "details": null
  }
}
```

---

### 1. Authentication & Users

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/auth/register` | Public (Rate Limited) | Register a new student account |
| POST | `/api/auth/login` | Public (Rate Limited) | Authenticate user, receive JWT & HTTP-only refresh cookie |
| POST | `/api/auth/refresh` | Public (Cookie) | Issue new Access Token using refresh cookie |
| POST | `/api/auth/logout` | Public (Cookie) | Clear refresh token cookie |
| POST | `/api/auth/change-password` | Authenticated | Change current user password |
| GET | `/api/users/me` | Authenticated | Retrieve current user profile |
| GET | `/api/users` | Admin | List users with role/status/search filters |
| POST | `/api/users` | Admin | Create a teacher or admin account |
| PATCH | `/api/users/:id/status` | Admin | Activate, deactivate or suspend a user |
| POST | `/api/users/:id/reset-password` | Admin | Manually reset a user password |

---

### 2. Class Management

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/classes` | Authenticated | List classrooms relevant to requesting user |
| POST | `/api/classes` | Teacher, Admin | Create a new classroom with auto-generated 6-char code |
| GET | `/api/classes/:id` | Authenticated | View classroom details and student roster |
| POST | `/api/classes/join` | Student | Join a classroom using a 6-character code |
| POST | `/api/classes/:id/students` | Teacher, Admin | Add student to classroom by email |
| DELETE | `/api/classes/:id/students/:studentId` | Teacher, Admin | Remove a student from classroom |

---

### 3. Question Bank

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/questions` | Teacher, Admin | Create a new question item |
| GET | `/api/questions` | Teacher, Admin | Paginated question search (defaults to own questions, `?scope=all` for the shared bank) |
| GET | `/api/questions/:id` | Teacher, Admin | Retrieve question item details (owner or `?scope=all`) |
| PUT | `/api/questions/:id` | Teacher, Admin (Owner) | Update an existing question |
| DELETE | `/api/questions/:id` | Teacher, Admin (Owner) | Delete a question item |

---

### 4. Exam Management

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/exams` | Teacher, Admin | List exams created by user (or all for admin) |
| POST | `/api/exams` | Teacher, Admin | Create a new exam structure in `draft` state |
| GET | `/api/exams/:id` | Teacher, Admin | View exam detail with populated questions |
| PUT | `/api/exams/:id` | Teacher, Admin (Owner) | Modify exam sections (draft status only) |
| DELETE | `/api/exams/:id` | Teacher, Admin (Owner) | Delete an exam (draft status only) |
| POST | `/api/exams/:id/clone` | Teacher, Admin | Duplicate an existing exam as a new draft |
| PATCH | `/api/exams/:id/publish` | Teacher, Admin (Owner) | Publish exam for assignments and taking |
| PATCH | `/api/exams/:id/close` | Teacher, Admin (Owner) | Close exam to prevent new sessions |

---

### 5. Assignments

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/assignments` | Teacher, Admin | Assign published exam to classroom or individual student |
| GET | `/api/assignments/my` | Student | List assignments with current progress/submission status |
| GET | `/api/assignments/:id/export` | Teacher, Admin (Owner) | Download a CSV score report for the assignment |

---

### 6. Exam Engine & Attempts

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/attempts` | Student | Start exam session; returns sanitized questions & server timer |
| GET | `/api/attempts/:id` | Authenticated (Owner) | State recovery on reload (sanitized questions & saved answers) |
| PATCH | `/api/attempts/:id/answers`| Authenticated (Owner) | Periodic idempotent autosave of candidate answers |
| POST | `/api/attempts/:id/submit` | Authenticated (Owner) | Lock attempt and trigger immediate L/R auto-grading |
| GET | `/api/attempts/:id/result` | Authenticated (Owner) | Retrieve full result breakdown, correct answers, and feedback |

---

### 7. Grading & Writing Reviews

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/grading/pending` | Teacher, Admin | View list of submitted exams awaiting Writing assessment |
| GET | `/api/attempts/:id/grading` | Teacher, Admin | Retrieve student Writing submission, prompt, and word count |
| POST | `/api/writing-reviews` | Teacher, Admin | Submit manual Task 1/Task 2 marks, compute overall band |

---

### 8. Media Storage

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/media/presign` | Teacher, Admin | Generate presigned PUT URL for direct MinIO upload |
| POST | `/api/media/:id/confirm` | Authenticated (Owner) | Confirm object presence in MinIO and activate media record |

---

### 9. Anti-Cheat Monitoring

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/anti-cheat/events` | Student (Rate Limited) | Record client telemetry (`TAB_SWITCH`, `FULLSCREEN_EXIT`, `PASTE`, `INTERRUPTION`, ...) |
| GET | `/api/anti-cheat/suspicious` | Teacher, Admin | List suspicious attempts (owned exams/assignments) with per-type event counts |

### 10. Analytics

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/analytics/exams/:id` | Teacher, Admin (Owner) | Accuracy per Section/Part, hardest questions, band distribution |
| GET | `/api/analytics/classes/:id` | Teacher, Admin (Owner) | Per-student and class-wide Listening/Reading/Writing/Overall averages |
| GET | `/api/analytics/student/progress` | Authenticated | Score timeline; students are scoped to their own data |

---

## Testing & Quality Assurance

The codebase includes an extensive suite of unit and integration tests executed using Vitest.

```bash
cd backend/api

# Run entire test suite once
npm test

# Run tests in watch mode
npm run test:watch

# Execute code style linter
npm run lint
```

Test coverage encompasses:
- Pure business logic (IELTS rounding algorithms, string normalization, word counters).
- Data models (Mongoose schema defaults, indexing definitions, timestamps).
- Middleware validation (Zod schema rejection, parameter casting, route guards).
- Service workflows (attempt timer calculation, auto-grading pipelines, authorization checkers).

---

## License

Private and proprietary. Developed for the IELTS Online Platform project. All rights reserved.
