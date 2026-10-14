import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.js";
import jwt from "jsonwebtoken";
import { UserModel, type IUser } from "../../modules/users/user.model.js";
import { signAccessToken, signRefreshToken } from "../../modules/auth/auth.service.js";
import { authenticate } from "./auth.middleware.js";
import type { AppError } from "../errors/AppError.js";

function makeUser(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: new mongoose.Types.ObjectId(),
    email: "student@example.com",
    role: "student",
    status: "active",
    tokenVersion: 0,
    ...overrides,
  } as unknown as IUser;
}

function run(token: string) {
  const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
  const res = {} as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe("authenticate (FIX-05 / FIX-20)", () => {
  it("accepts a valid access token and takes the role from the DB", async () => {
    const user = makeUser({ role: "teacher" });
    vi.spyOn(UserModel, "findById").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue(user),
    } as never);

    const { req, res, next } = run(signAccessToken(user));
    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({
      id: user._id.toString(),
      role: "teacher",
      email: "student@example.com",
    });
  });

  it("rejects a refresh token used as an access token", async () => {
    const user = makeUser();
    const { req, res, next } = run(signRefreshToken(user));
    await authenticate(req, res, next);

    const error = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as AppError;
    expect(error.errorCode).toBe("UNAUTHORIZED");
  });

  it("rejects when the tokenVersion no longer matches (revoked session)", async () => {
    const user = makeUser({ tokenVersion: 0 });
    const token = signAccessToken(user);
    vi.spyOn(UserModel, "findById").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue(makeUser({ tokenVersion: 3 })),
    } as never);

    const { req, res, next } = run(token);
    await authenticate(req, res, next);

    const error = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as AppError;
    expect(error.errorCode).toBe("TOKEN_REVOKED");
  });

  it("rejects a suspended user", async () => {
    const user = makeUser({ status: "suspended" });
    vi.spyOn(UserModel, "findById").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue(user),
    } as never);

    const { req, res, next } = run(signAccessToken(user));
    await authenticate(req, res, next);

    const error = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as AppError;
    expect(error.statusCode).toBe(401);
  });

  it("accepts a legacy token without a `type` claim during transition", async () => {
    const user = makeUser();
    const legacyToken = jwt.sign(
      { sub: user._id.toString(), role: "student", email: user.email, tokenVersion: 0 },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "1h" }
    );
    vi.spyOn(UserModel, "findById").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue(user),
    } as never);

    const { req, res, next } = run(legacyToken);
    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("rejects a malformed Authorization header before hitting the DB", async () => {
    const req = { headers: {} } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});
