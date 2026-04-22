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
 * @param {{ page?: number, pageSize?: number, platform?: string, topic?: string, shop_identifier?: string, from?: string, to?: string }} params
 */
export function getWebhookEvents(params) {
  return apiRequest(`/admin-api/webhooks${buildQuery(params)}`);
}
