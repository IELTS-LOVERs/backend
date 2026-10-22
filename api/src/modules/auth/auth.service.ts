import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { BadRequestError, ConflictError, UnauthorizedError } from "../../common/errors/AppError.js";
import { logger } from "../../common/utils/logger.js";
import {
  UserModel,
  type IUser,
  type IRefreshSession,
} from "../users/user.model.js";
import { isSingleDeviceRole } from "./auth.policy.js";
import type { ChangePasswordBody, LoginBody, RegisterBody } from "./auth.validation.js";

const BCRYPT_SALT_ROUNDS = 12;
const MAX_REFRESH_SESSIONS = 5;
const DEFAULT_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * I-1: a just-rotated token may legitimately be presented again within this
 * window — two tabs racing on the same cookie jar send refresh requests with
 * the same token concurrently. Inside the window that is a benign race (the
 * session is rotated forward again); outside it, the same token is treated as a
 * genuine replay.
 */
const REFRESH_ROTATION_GRACE_MS = 2 * 60 * 1000;
/** How long rotated-out hashes are remembered for replay detection. */
const CONSUMED_HASH_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Upper bound of consumed hashes kept per session (small, hash-only). */
const MAX_CONSUMED_HASHES = 5;

/**
 * FIX-17: constant-time login. When the email is unknown we still run a bcrypt
 * compare against this dummy hash so attackers cannot distinguish
 * "user does not exist" from "wrong password" by timing. Computed once, lazily.
 */
let dummyPasswordHash: string | null = null;
function getDummyPasswordHash(): string {
  if (!dummyPasswordHash) {
    dummyPasswordHash = bcrypt.hashSync("__ielts_timing_attack_dummy__", BCRYPT_SALT_ROUNDS);
  }
  return dummyPasswordHash;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export interface AccessTokenPayload {
  sub: string;
  role: string;
  email: string;
  tokenVersion?: number;
  type?: "access";
  /** ID phiên đăng nhập (dùng cho chính sách một thiết bị). */
  sid?: string;
}

export interface RefreshTokenPayload {
  sub: string;
  role: string;
  email: string;
  tokenVersion?: number;
  type?: "refresh";
  sid?: string;
}

function buildPayload(user: IUser) {
  return {
    sub: user._id.toString(),
    role: user.role,
    email: user.email,
    tokenVersion: user.tokenVersion ?? 0,
  };
}

export function signAccessToken(user: IUser, sid: string = crypto.randomUUID()): string {
  return jwt.sign(
    { ...buildPayload(user), type: "access", sid },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    }
  );
}

export function signRefreshToken(user: IUser, sid: string = crypto.randomUUID()): string {
  // `jti` guarantees a fresh token per issuance even when the second-resolution
  // `iat`/`exp` are identical (otherwise rotation within the same second would
  // re-emit the exact same token and the session hash would not change).
  return jwt.sign(
    { ...buildPayload(user), type: "refresh", jti: crypto.randomUUID(), sid },
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    }
  );
}

export function generateTokens(user: IUser, sid: string = crypto.randomUUID()): AuthTokens {
  return {
    accessToken: signAccessToken(user, sid),
    refreshToken: signRefreshToken(user, sid),
  };
}

/** SHA-256 hash used to store refresh tokens server-side (never store raw). */
export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * I-1: keeps the hashes consumed by recent rotations (bounded + time-pruned)
 * so a concurrent second refresh can be recognized as a benign race.
 */
function buildConsumedHashes(
  session: IRefreshSession,
  now: Date
): Array<{ tokenHash: string; rotatedAt: Date }> {
  return [
    ...(session.consumedTokenHashes ?? []),
    { tokenHash: session.tokenHash, rotatedAt: now },
  ]
    .filter((entry) => now.getTime() - entry.rotatedAt.getTime() < CONSUMED_HASH_RETENTION_MS)
    .slice(-MAX_CONSUMED_HASHES)
    .map((entry) => ({ tokenHash: entry.tokenHash, rotatedAt: entry.rotatedAt }));
}

/** I-1: rotate a session in memory (used for multi-session roles). */
function rotateSession(session: IRefreshSession, newRefreshToken: string): void {
  const now = new Date();
  session.consumedTokenHashes = buildConsumedHashes(session, now);
  session.tokenHash = hashRefreshToken(newRefreshToken);
}

function resolveRefreshExpiry(refreshToken: string): Date {
  const decoded = jwt.decode(refreshToken) as { exp?: number } | null;
  if (decoded?.exp) return new Date(decoded.exp * 1000);
  return new Date(Date.now() + DEFAULT_REFRESH_TTL_MS);
}

function buildRefreshSession(
  refreshToken: string,
  sessionId: string,
  userAgent?: string,
  consumedTokenHashes: IRefreshSession["consumedTokenHashes"] = []
): IRefreshSession {
  return {
    sessionId,
    tokenHash: hashRefreshToken(refreshToken),
    createdAt: new Date(),
    expiresAt: resolveRefreshExpiry(refreshToken),
    ...(userAgent ? { userAgent } : {}),
    consumedTokenHashes,
  };
}

/**
 * Persists a new refresh session (hash only).
 *
 * - Role bị giới hạn một thiết bị: thay toàn bộ danh sách bằng đúng phiên mới
 *   và cập nhật `activeSessionId` (last-login-wins).
 * - Role còn lại: giữ tối đa MAX_REFRESH_SESSIONS phiên như cũ.
 */
async function persistRefreshSession(
  user: IUser,
  refreshToken: string,
  sessionId: string,
  userAgent?: string
): Promise<void> {
  if (isSingleDeviceRole(user.role)) {
    // Re-login from the same browser reuses the sid. Carry recent consumed
    // hashes forward so an in-flight refresh from another tab is still
    // recognized as a benign race instead of a replay.
    const previous = (user.refreshSessions ?? []).find(
      (session) => session.sessionId === sessionId
    );
    const consumed = previous ? buildConsumedHashes(previous, new Date()) : [];
    user.refreshSessions = [
      buildRefreshSession(refreshToken, sessionId, userAgent, consumed),
    ];
    user.activeSessionId = sessionId;
    await user.save();
    return;
  }

  const now = new Date();
  const active = (user.refreshSessions ?? []).filter(
    (session) => session.expiresAt.getTime() > now.getTime()
  );

  active.push(buildRefreshSession(refreshToken, sessionId, userAgent));

  active.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  user.refreshSessions = active.slice(0, MAX_REFRESH_SESSIONS);
  await user.save();
}

/**
 * Signs a fresh token pair and records the refresh session server-side.
 *
 * `reuseSessionId` is set when the caller proves it is the same browser/device
 * that already owns the active session (refresh cookie matches). Reusing the
 * sid keeps existing tabs on that browser working instead of "kicking" them.
 */
export async function issueTokens(
  user: IUser,
  userAgent?: string,
  reuseSessionId?: string
): Promise<AuthTokens> {
  const sessionId = reuseSessionId ?? crypto.randomUUID();
  const tokens = generateTokens(user, sessionId);
  await persistRefreshSession(user, tokens.refreshToken, sessionId, userAgent);
  return tokens;
}

/**
 * Checks whether a refresh token supplied during login belongs to the current
 * active session. Used to distinguish "same browser, second tab" from a real
 * second device.
 */
function resolveReusableSessionId(
  user: IUser,
  presentedRefreshToken?: string
): string | undefined {
  if (!presentedRefreshToken || !isSingleDeviceRole(user.role)) return undefined;

  try {
    const payload = jwt.verify(
      presentedRefreshToken,
      env.JWT_REFRESH_SECRET
    ) as RefreshTokenPayload;

    if (payload.type !== "refresh") return undefined;
    if (payload.sub !== user._id.toString()) return undefined;
    if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) return undefined;

    const tokenHash = hashRefreshToken(presentedRefreshToken);
    const target = (user.refreshSessions ?? []).find(
      (session) =>
        session.tokenHash === tokenHash ||
        (session.consumedTokenHashes ?? []).some(
          (candidate) => candidate.tokenHash === tokenHash
        )
    );

    if (target?.sessionId && target.sessionId === user.activeSessionId) {
      return target.sessionId;
    }
  } catch {
    // Token không hợp lệ/hết hạn → coi như thiết bị mới.
  }

  return undefined;
}

export async function register(
  data: RegisterBody,
  userAgent?: string
): Promise<{ user: IUser } & AuthTokens> {
  const email = data.email.toLowerCase().trim();

  const existing = await UserModel.findOne({ email });
  if (existing) {
    throw new ConflictError("CONFLICT", "Email đã tồn tại.");
  }

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);

  const user = await UserModel.create({
    email,
    passwordHash,
    fullName: data.fullName,
    phone: data.phone,
    targetBand: data.targetBand,
    role: "student",
    status: "active",
  });

  const tokens = await issueTokens(user, userAgent);
  return { user, ...tokens };
}

export async function login(
  data: LoginBody,
  userAgent?: string,
  presentedRefreshToken?: string
): Promise<{ user: IUser } & AuthTokens> {
  const user = await UserModel.findOne({ email: data.email.toLowerCase().trim() });

  if (!user || user.status === "suspended") {
    // FIX-17: run a dummy compare so unknown emails take the same time as a
    // wrong password (no timing oracle).
    await bcrypt.compare(data.password, getDummyPasswordHash()).catch(() => {});
    logger.warn("auth.login_failed", { email: data.email, reason: "unknown_or_suspended" });
    throw new BadRequestError("INVALID_CREDENTIALS", "Sai email hoặc mật khẩu.");
  }

  const isPasswordValid = await bcrypt.compare(data.password, user.passwordHash);
  if (!isPasswordValid) {
    logger.warn("auth.login_failed", {
      email: data.email,
      userId: user._id.toString(),
      reason: "invalid_password",
    });
    throw new BadRequestError("INVALID_CREDENTIALS", "Sai email hoặc mật khẩu.");
  }

  logger.info("auth.login_succeeded", { userId: user._id.toString(), role: user.role });

  // Same browser / second tab: reuse the active session id so logging in again
  // does not invalidate the other tabs. A different device has no matching
  // cookie and gets a fresh sid (last-login-wins).
  const reuseSessionId = resolveReusableSessionId(user, presentedRefreshToken);
  const tokens = await issueTokens(user, userAgent, reuseSessionId);
  return { user, ...tokens };
}

/**
 * FIX-04/H-05: refresh with rotation. The supplied refresh token must map to a
 * live server-side session; on success we issue a new access token AND rotate
 * the refresh token (the old hash is replaced). A token that verifies but has
 * no matching session is treated as a replay → all sessions are revoked.
 */
export async function refresh(
  refreshToken: string | undefined,
  userAgent?: string
): Promise<RefreshResult> {
  if (!refreshToken) {
    throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "Refresh Token không hợp lệ.");
  }

  let payload: RefreshTokenPayload;

  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  } catch {
    logger.warn("auth.refresh_failed", { reason: "invalid_token" });
    throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "Refresh Token không hợp lệ.");
  }

  // FIX-20: refresh endpoint must only accept refresh tokens.
  if (payload.type !== "refresh") {
    logger.warn("auth.refresh_failed", { reason: "wrong_token_type" });
    throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "Refresh Token không hợp lệ.");
  }

  const user = await UserModel.findById(payload.sub);
  if (!user || user.status === "suspended") {
    logger.warn("auth.refresh_failed", { userId: payload.sub, reason: "user_unavailable" });
    throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "Refresh Token không hợp lệ.");
  }

  if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
    logger.warn("auth.refresh_failed", { userId: payload.sub, reason: "token_revoked" });
    throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "Refresh Token không hợp lệ.");
  }

  const now = Date.now();
  const tokenHash = hashRefreshToken(refreshToken);
  const sessions = user.refreshSessions ?? [];
  const enforced = isSingleDeviceRole(user.role);
  const sessionReplacedError = () =>
    new UnauthorizedError(
      "SESSION_REPLACED",
      "Phiên đăng nhập đã được thay thế bởi thiết bị khác."
    );

  // I-1: locate the session by its CURRENT hash first; the expiry check is a
  // separate, clean 401 (no global revocation).
  let target: IRefreshSession | undefined;
  let benignRace = false;

  const current = sessions.find((entry) => entry.tokenHash === tokenHash);

  if (current) {
    if (
      enforced &&
      user.activeSessionId &&
      current.sessionId &&
      current.sessionId !== user.activeSessionId
    ) {
      logger.warn("auth.refresh_replaced", { userId: payload.sub });
      throw sessionReplacedError();
    }
    target = current;
  } else {
    // Not the current hash — it may be a hash consumed by a recent rotation.
    for (const entry of sessions) {
      const consumed = (entry.consumedTokenHashes ?? []).find(
        (candidate) => candidate.tokenHash === tokenHash
      );
      if (!consumed) continue;

      if (
        enforced &&
        user.activeSessionId &&
        entry.sessionId &&
        entry.sessionId !== user.activeSessionId
      ) {
        logger.warn("auth.refresh_replaced", { userId: payload.sub });
        throw sessionReplacedError();
      }

      const age = now - consumed.rotatedAt.getTime();

      if (age <= REFRESH_ROTATION_GRACE_MS) {
        // Benign multi-tab race: another tab rotated this same token moments
        // ago. Accept and rotate the session forward again.
        target = entry;
        benignRace = true;
        break;
      }

      // Genuine replay of a long-consumed token → assume theft and revoke
      // every session plus outstanding access tokens (atomic to avoid
      // resurrecting a session that another login just created).
      logger.warn("auth.refresh_reuse_detected", { userId: payload.sub, ageMs: age });
      await UserModel.updateOne(
        { _id: user._id },
        {
          $set: { refreshSessions: [] },
          $inc: { tokenVersion: 1 },
          $unset: { activeSessionId: 1 },
        }
      );
      throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "Refresh Token không hợp lệ.");
    }
  }

  if (!target) {
    // Unknown hash: the session was logged out, pruned (max-session cap),
    // replaced by another login, or simply never existed. For single-device
    // roles with a live active session this means "another device logged in".
    if (enforced && user.activeSessionId) {
      logger.warn("auth.refresh_replaced", { userId: payload.sub, reason: "unknown_session" });
      throw sessionReplacedError();
    }
    logger.warn("auth.refresh_failed", { userId: payload.sub, reason: "unknown_session" });
    throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "Refresh Token không hợp lệ.");
  }

  if (target.expiresAt.getTime() <= now) {
    // The 7-day remember-me window is over. Prune the session; do NOT revoke
    // the user's other (still valid) sessions.
    if (enforced) {
      const pullMatch = target.sessionId
        ? { sessionId: target.sessionId }
        : { tokenHash: target.tokenHash };
      await UserModel.updateOne(
        { _id: user._id },
        { $pull: { refreshSessions: pullMatch } }
      );
      if (target.sessionId && user.activeSessionId === target.sessionId) {
        await UserModel.updateOne(
          { _id: user._id, activeSessionId: target.sessionId },
          { $unset: { activeSessionId: 1 } }
        );
      }
    } else {
      user.refreshSessions = sessions.filter((entry) => entry !== target);
      await user.save();
    }
    logger.warn("auth.refresh_failed", { userId: payload.sub, reason: "session_expired" });
    throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "Refresh Token không hợp lệ.");
  }

  // Legacy sessions created before the single-device policy have no sessionId.
  // Adopt them once (this device becomes the active session).
  if (enforced && !target.sessionId) {
    if (user.activeSessionId) {
      logger.warn("auth.refresh_replaced", { userId: payload.sub, reason: "legacy_session" });
      throw sessionReplacedError();
    }

    const sessionId = crypto.randomUUID();
    const newAccessToken = signAccessToken(user, sessionId);
    const newRefreshToken = signRefreshToken(user, sessionId);
    const upgraded: IRefreshSession = {
      sessionId,
      tokenHash: hashRefreshToken(newRefreshToken),
      createdAt: target.createdAt,
      expiresAt: target.expiresAt,
      ...(target.userAgent ? { userAgent: target.userAgent } : {}),
      consumedTokenHashes: buildConsumedHashes(target, new Date(now)),
    };

    const result = await UserModel.updateOne(
      { _id: user._id, "refreshSessions.tokenHash": target.tokenHash },
      { $set: { refreshSessions: [upgraded], activeSessionId: sessionId } }
    );
    if (result.matchedCount === 0) {
      throw sessionReplacedError();
    }

    logger.info("auth.refresh_legacy_upgraded", { userId: payload.sub });
    void userAgent;
    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  const sessionId = target.sessionId ?? crypto.randomUUID();
  if (!target.sessionId) target.sessionId = sessionId;
  const newAccessToken = signAccessToken(user, sessionId);
  const newRefreshToken = signRefreshToken(user, sessionId);

  // Rotate in place, preserving the original session's createdAt/expiresAt so
  // the 7-day "remember me" window does not slide forward on every refresh.
  if (enforced) {
    // Atomic conditional update: if another device logged in between our read
    // and this write, the filter no longer matches and we must NOT overwrite
    // the newer session.
    const consumed = buildConsumedHashes(target, new Date(now));
    const result = await UserModel.updateOne(
      {
        _id: user._id,
        activeSessionId: sessionId,
        "refreshSessions.sessionId": sessionId,
      },
      {
        $set: {
          "refreshSessions.$.tokenHash": hashRefreshToken(newRefreshToken),
          "refreshSessions.$.consumedTokenHashes": consumed,
        },
      }
    );
    if (result.matchedCount === 0) {
      logger.warn("auth.refresh_replaced", { userId: payload.sub, reason: "concurrent_login" });
      throw sessionReplacedError();
    }
  } else {
    rotateSession(target, newRefreshToken);
    user.refreshSessions = sessions.filter((entry) => entry.expiresAt.getTime() > now);
    await user.save();
  }

  if (benignRace) {
    logger.info("auth.refresh_concurrent_race", { userId: payload.sub });
  } else {
    logger.info("auth.refresh_rotated", { userId: payload.sub });
  }
  void userAgent;

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

/**
 * FIX-04: server-side logout. Removes exactly the session identified by the
 * refresh token hash. Idempotent — an unparseable/unknown token is a no-op.
 */
export async function logout(refreshToken?: string): Promise<void> {
  if (!refreshToken) return;

  let payload: RefreshTokenPayload;
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  } catch {
    return;
  }

  const user = await UserModel.findById(payload.sub);
  if (!user) return;

  const tokenHash = hashRefreshToken(refreshToken);
  const target = (user.refreshSessions ?? []).find((entry) => entry.tokenHash === tokenHash);
  const sessionId = target?.sessionId ?? payload.sid;

  // Atomic pull so a slow logout from the old device can never clear the
  // session that a newer login just created.
  const update: Record<string, unknown> = {
    $pull: { refreshSessions: { tokenHash } },
  };
  if (sessionId && user.activeSessionId === sessionId) {
    update.$unset = { activeSessionId: 1 };
  }
  await UserModel.updateOne({ _id: user._id }, update);

  logger.info("auth.logout", { userId: payload.sub });
}

export async function changePassword(
  userId: string,
  data: ChangePasswordBody
): Promise<void> {
  const user = await UserModel.findById(userId);

  if (!user) {
    throw new UnauthorizedError("UNAUTHORIZED", "Tài khoản không tồn tại.");
  }

  const isOldPasswordValid = await bcrypt.compare(data.oldPassword, user.passwordHash);
  if (!isOldPasswordValid) {
    logger.warn("auth.change_password_failed", { userId, reason: "old_password_incorrect" });
    throw new BadRequestError("OLD_PASSWORD_INCORRECT", "Mật khẩu cũ không chính xác.");
  }

  user.passwordHash = await bcrypt.hash(data.newPassword, BCRYPT_SALT_ROUNDS);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  // Password change invalidates every refresh session (all devices).
  user.refreshSessions = [];
  user.activeSessionId = undefined;
  await user.save();

  logger.info("auth.password_changed", { userId });
}
