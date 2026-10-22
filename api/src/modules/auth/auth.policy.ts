import { env } from "../../config/env.js";

/**
 * Các role bị giới hạn một phiên đăng nhập tại một thời điểm.
 *
 * Chính sách là "last-login-wins": thiết bị đăng nhập sau thay thế phiên cũ,
 * thiết bị cũ nhận 401 SESSION_REPLACED ở request kế tiếp.
 */
export function isSingleDeviceRole(role: string): boolean {
  return env.SINGLE_DEVICE_ROLES.includes(role as "student" | "teacher" | "admin");
}
