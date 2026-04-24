import { apiRequest } from "@/shared/api/apiClient";

function buildQuery(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

/**
 * @param {{ page?: number, pageSize?: number, platform?: string, status?: string, q?: string }} params
 */
export function getInstallations(params) {
  return apiRequest(`/admin-api/installations${buildQuery(params)}`);
}

/**
 * @param {string|number} id
 */
export function getInstallationById(id) {
  return apiRequest(`/admin-api/installations/${id}`);
}

/**
 * @param {Array<string|number>} installationIds
 */
export function sendBulkInstallationEmail(installationIds) {
  return apiRequest("/admin-api/installations/bulk-email", {
    method: "POST",
    body: { installationIds },
  });
}
