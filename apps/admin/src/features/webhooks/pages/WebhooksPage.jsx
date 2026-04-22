import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { getWebhookEvents } from "../services/webhooksService";

import { queryKeys } from "@/shared/constants/queryKeys";
import { formatDateTime, truncateText } from "@/shared/utils/formatters";


const PAGE_SIZE = 20;

export function WebhooksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedEvent, setSelectedEvent] = useState(null);
  const page = Number(searchParams.get("page") || 1);
  const platform = searchParams.get("platform") || "";
  const topic = searchParams.get("topic") || "";
  const shopIdentifier = searchParams.get("shop_identifier") || "";

  const filters = {
    page,
    pageSize: PAGE_SIZE,
    platform,
    topic,
    shop_identifier: shopIdentifier,
  };

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: queryKeys.webhooks(filters),
    queryFn: () => getWebhookEvents(filters),
  });

  const rows = data?.data || [];
  const meta = data?.meta || { page: 1, totalPages: 1, total: 0 };

  function updateFilters(next) {
    const merged = {
      page: next.page ?? 1,
      platform: next.platform ?? platform,
      topic: next.topic ?? topic,
      shop_identifier: next.shop_identifier ?? shopIdentifier,
    };
    const nextParams = new URLSearchParams();
    if (merged.page > 1) nextParams.set("page", String(merged.page));
    if (merged.platform) nextParams.set("platform", merged.platform);
    if (merged.topic) nextParams.set("topic", merged.topic);
    if (merged.shop_identifier) {
      nextParams.set("shop_identifier", merged.shop_identifier);
    }
    setSearchParams(nextParams, { replace: true });
  }

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold text-[#1f140a]">Webhook events</h2>
        <p className="text-sm text-black/60">
          Inspect recent incoming webhooks and payloads.
        </p>
      </header>

      <div className="grid gap-3 rounded-xl border border-black/10 bg-white p-4 md:grid-cols-4">
        <select
          className="rounded border border-black/15 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          onChange={(event) =>
            updateFilters({ platform: event.target.value, page: 1 })
          }
          value={platform}
        >
          <option value="">All platforms</option>
          <option value="shopify">Shopify</option>
          <option value="woocommerce">WooCommerce</option>
        </select>
        <input
          className="rounded border border-black/15 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          onChange={(event) => updateFilters({ topic: event.target.value, page: 1 })}
          placeholder="Topic contains..."
          value={topic}
        />
        <input
          className="rounded border border-black/15 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          onChange={(event) =>
            updateFilters({ shop_identifier: event.target.value, page: 1 })
          }
          placeholder="Shop identifier contains..."
          value={shopIdentifier}
        />
        <div className="flex items-center text-sm text-black/50">
          {isFetching ? "Refreshing..." : " "}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-black/10 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-black/[0.03] text-left">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Platform</th>
              <th className="px-4 py-3">Topic</th>
              <th className="px-4 py-3">Shop</th>
              <th className="px-4 py-3">Received</th>
              <th className="px-4 py-3">Payload preview</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-4 text-black/60" colSpan={7}>
                  Loading webhook events...
                </td>
              </tr>
            ) : null}

            {!isLoading && error ? (
              <tr>
                <td className="px-4 py-4 text-red-700" colSpan={7}>
                  Failed to load webhooks: {error.message}
                </td>
              </tr>
            ) : null}

            {!isLoading && !error && rows.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-black/60" colSpan={7}>
                  No webhook event found.
                </td>
              </tr>
            ) : null}

            {!isLoading &&
              !error &&
              rows.map((item) => (
                <tr className="border-t border-black/10" key={item.id}>
                  <td className="px-4 py-3">{item.id}</td>
                  <td className="px-4 py-3">{item.platform}</td>
                  <td className="px-4 py-3">{item.topic}</td>
                  <td className="px-4 py-3">{item.shop_identifier || "-"}</td>
                  <td className="px-4 py-3">{formatDateTime(item.received_at)}</td>
                  <td className="px-4 py-3">{truncateText(item.payload_preview, 80)}</td>
                  <td className="px-4 py-3">
                    <button
                      className="text-brand-700 hover:underline"
                      onClick={() => setSelectedEvent(item)}
                      type="button"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <button
          className="rounded border border-black/20 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={meta.page <= 1}
          onClick={() => updateFilters({ page: page - 1 })}
          type="button"
        >
          Previous
        </button>
        <span className="text-sm text-black/60">
          Page {meta.page || 1} / {meta.totalPages || 1}
        </span>
        <button
          className="rounded border border-black/20 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={meta.page >= meta.totalPages}
          onClick={() => updateFilters({ page: page + 1 })}
          type="button"
        >
          Next
        </button>
      </div>

      {selectedEvent ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[80vh] w-full max-w-4xl overflow-auto rounded-xl bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#1f140a]">
                Webhook Event #{selectedEvent.id}
              </h3>
              <button
                className="rounded border border-black/20 px-3 py-1 text-sm"
                onClick={() => setSelectedEvent(null)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <p>
                <strong>Platform:</strong> {selectedEvent.platform}
              </p>
              <p>
                <strong>Topic:</strong> {selectedEvent.topic}
              </p>
              <p>
                <strong>Shop:</strong> {selectedEvent.shop_identifier || "-"}
              </p>
              <p>
                <strong>Received at:</strong> {formatDateTime(selectedEvent.received_at)}
              </p>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <p className="mb-1 text-sm font-semibold">Headers</p>
                <pre className="max-h-48 overflow-auto rounded bg-black/[0.03] p-3 text-xs">
                  {JSON.stringify(selectedEvent.headers || {}, null, 2)}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold">Payload</p>
                <pre className="max-h-64 overflow-auto rounded bg-black/[0.03] p-3 text-xs">
                  {selectedEvent.payload}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
