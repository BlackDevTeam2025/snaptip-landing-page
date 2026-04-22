import { apiRequest } from "@/shared/api/apiClient";

/**
 * @param {{ email: string, password: string }} payload
 */
export function login(payload) {
  return apiRequest("/admin-api/auth/login", {
    method: "POST",
    body: payload,
  });
}

export function logout() {
  return apiRequest("/admin-api/auth/logout", {
    method: "POST",
  });
}

export function getMe() {
  return apiRequest("/admin-api/auth/me");
}

/**
 * @param {{ currentPassword: string, newPassword: string }} payload
 */
export function changePassword(payload) {
  return apiRequest("/admin-api/auth/change-password", {
    method: "POST",
    body: payload,
  });
}
