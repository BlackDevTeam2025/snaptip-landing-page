import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  getInstallations,
  sendBulkInstallationEmail,
} from "../services/installationsService";

import { queryKeys } from "@/shared/constants/queryKeys";
import { formatDateTime, formatMoney } from "@/shared/utils/formatters";


const PAGE_SIZE = 20;
const EMPTY_ROWS = [];

export function InstallationsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkMessage, setBulkMessage] = useState(null);
  const page = Number(searchParams.get("page") || 1);
  const platform = searchParams.get("platform") || "";
  const status = searchParams.get("status") || "";
  const q = searchParams.get("q") || "";

  const filters = {
    page,
    pageSize: PAGE_SIZE,
    platform,
    status,
    q,
  };

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: queryKeys.installations(filters),
    queryFn: () => getInstallations(filters),
  });

  const rows = data?.data || EMPTY_ROWS;
  const meta = data?.meta || { page: 1, totalPages: 1, total: 0 };
  const selectableRows = useMemo(
    () => rows.filter((row) => row.is_selectable_for_email),
    [rows]
  );
  const selectableIds = useMemo(
    () => new Set(selectableRows.map((row) => Number(row.id))),
    [selectableRows]
  );
  const selectedCount = selectedIds.size;
  const allSelectableSelected =
    selectableRows.length > 0 &&
    selectableRows.every((row) => selectedIds.has(Number(row.id)));

  const bulkEmailMutation = useMutation({
    mutationFn: (ids) => sendBulkInstallationEmail(ids),
    onSuccess: (payload) => {
      const sent = payload?.data?.sent ?? 0;
      const failed = payload?.data?.failed ?? 0;
      setBulkMessage({
        type: failed > 0 ? "warning" : "success",
        text:
          failed > 0
            ? `Sent ${sent} email(s), ${failed} failed.`
            : `Sent ${sent} email(s).`,
      });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["installations"] });
    },
    onError: (mutationError) => {
      setBulkMessage({
        type: "error",
        text: mutationError.message || "Failed to send bulk email.",
      });
    },
  });

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((id) => selectableIds.has(Number(id)))
      );
      return next.size === current.size ? current : next;
    });
  }, [selectableIds]);

  function updateFilters(next) {
    const merged = {
      page: next.page ?? 1,
      platform: next.platform ?? platform,
      status: next.status ?? status,
      q: next.q ?? q,
    };

    const nextParams = new URLSearchParams();
    if (merged.page > 1) nextParams.set("page", String(merged.page));
    if (merged.platform) nextParams.set("platform", merged.platform);
    if (merged.status) nextParams.set("status", merged.status);
    if (merged.q) nextParams.set("q", merged.q);
    setSearchParams(nextParams, { replace: true });
  }

  function toggleRow(id) {
    const numericId = Number(id);
    if (!selectableIds.has(numericId)) return;
    setBulkMessage(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(numericId)) {
        next.delete(numericId);
      } else {
        next.add(numericId);
      }
      return next;
    });
  }

  function toggleSelectAllCurrentPage() {
    setBulkMessage(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allSelectableSelected) {
        selectableRows.forEach((row) => next.delete(Number(row.id)));
      } else {
        selectableRows.forEach((row) => next.add(Number(row.id)));
      }
      return next;
    });
  }

  function handleSendBulkEmail() {
    bulkEmailMutation.mutate([...selectedIds]);
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[#1f140a]">Installations</h2>
          <p className="text-sm text-black/60">
            Manage installed/uninstalled stores across platforms.
          </p>
        </div>
        <div className="rounded-lg bg-brand-100 px-3 py-2 text-sm text-brand-900">
          Total: {meta.total ?? 0}
        </div>
      </header>

      <div className="grid gap-3 rounded-xl border border-black/10 bg-white p-4 md:grid-cols-4">
        <input
          className="rounded border border-black/15 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          onChange={(event) => updateFilters({ q: event.target.value, page: 1 })}
          placeholder="Search by shop/email"
          value={q}
        />
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
        <select
          className="rounded border border-black/15 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          onChange={(event) => updateFilters({ status: event.target.value, page: 1 })}
          value={status}
        >
          <option value="">All statuses</option>
          <option value="installed">Installed</option>
          <option value="uninstalled">Uninstalled</option>
          <option value="inactive">Inactive</option>
        </select>
        <div className="flex items-center text-sm text-black/50">
          {isFetching ? "Refreshing..." : " "}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white p-4">
        <div>
          <p className="text-sm font-semibold text-[#1f140a]">
            Bulk email selected installations
          </p>
          <p className="text-sm text-black/60">
            {selectedCount} selected. Only active installations with an email are selectable.
          </p>
        </div>
        <button
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={selectedCount === 0 || bulkEmailMutation.isPending}
          onClick={handleSendBulkEmail}
          type="button"
        >
          {bulkEmailMutation.isPending ? "Sending..." : "Send email"}
        </button>
      </div>

      {bulkMessage ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            bulkMessage.type === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : bulkMessage.type === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {bulkMessage.text}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-black/10 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-black/[0.03] text-left">
            <tr>
              <th className="px-4 py-3">
                <input
                  aria-label="Select all installations on this page"
                  checked={allSelectableSelected}
                  disabled={selectableRows.length === 0}
                  onChange={toggleSelectAllCurrentPage}
                  type="checkbox"
                />
              </th>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Platform</th>
              <th className="px-4 py-3">Shop</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Active Date</th>
              <th className="px-4 py-3">Deactivate Date</th>
              <th className="px-4 py-3">Tip Amount</th>
              <th className="px-4 py-3">Detail</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-4 text-black/60" colSpan={10}>
                  Loading installations...
                </td>
              </tr>
            ) : null}

            {!isLoading && error ? (
              <tr>
                <td className="px-4 py-4 text-red-700" colSpan={10}>
                  Failed to load installations: {error.message}
                </td>
              </tr>
            ) : null}

            {!isLoading && !error && rows.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-black/60" colSpan={10}>
                  No installation found.
                </td>
              </tr>
            ) : null}

            {!isLoading &&
              !error &&
              rows.map((item) => (
                <tr className="border-t border-black/10" key={item.id}>
                  <td className="px-4 py-3">
                    <input
                      aria-label={`Select ${item.shop_identifier || item.id}`}
                      checked={selectedIds.has(Number(item.id))}
                      disabled={!item.is_selectable_for_email}
                      onChange={() => toggleRow(item.id)}
                      title={getSelectionDisabledReason(item)}
                      type="checkbox"
                    />
                  </td>
                  <td className="px-4 py-3">{item.id}</td>
                  <td className="px-4 py-3 capitalize">{item.platform}</td>
                  <td className="px-4 py-3">{item.shop_identifier || "-"}</td>
                  <td className="px-4 py-3">{item.email || "-"}</td>
                  <td className="px-4 py-3">{item.status}</td>
                  <td className="px-4 py-3">{formatDateTime(item.active_at)}</td>
                  <td className="px-4 py-3">
                    {formatDateTime(item.deactivated_at)}
                  </td>
                  <td className="px-4 py-3">
                    {formatMoney(
                      item.current_month_tip_amount,
                      item.current_month_tip_currency || "USD"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link className="text-brand-700 hover:underline" to={`/installations/${item.id}`}>
                      Open
                    </Link>
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
    </section>
  );
}

function getSelectionDisabledReason(item) {
  if (item.is_selectable_for_email) return "";
  if (item.status !== "installed") return "Only active installations can receive email";
  if (!item.email) return "Email is missing";
  return "Not selectable";
}
