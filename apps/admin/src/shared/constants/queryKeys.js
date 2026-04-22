export const queryKeys = {
  auth: {
    me: ["auth", "me"],
  },
  installations: (filters) => ["installations", filters],
  installationDetail: (id) => ["installations", "detail", id],
  webhooks: (filters) => ["webhooks", filters],
};
