import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { getInstallationById } from "../services/installationsService";

import { queryKeys } from "@/shared/constants/queryKeys";
import { formatDateTime } from "@/shared/utils/formatters";


export function InstallationDetailPage() {
  const { id } = useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.installationDetail(id),
    queryFn: () => getInstallationById(id),
    enabled: Boolean(id),
  });

  const item = data?.data;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[#1f140a]">Installation detail</h2>
        <Link className="text-sm text-brand-700 hover:underline" to="/installations">
          Back to installations
        </Link>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-black/10 bg-white p-5 text-sm text-black/60">
          Loading installation detail...
        </div>
      ) : null}

      {!isLoading && error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error.message}
        </div>
      ) : null}

      {!isLoading && item ? (
        <div className="rounded-xl border border-black/10 bg-white p-5">
          <dl className="grid gap-4 md:grid-cols-2">
            <DetailRow label="ID" value={item.id} />
            <DetailRow label="Platform" value={item.platform} />
            <DetailRow label="Shop identifier" value={item.shop_identifier} />
            <DetailRow label="Shop domain" value={item.shop_domain} />
            <DetailRow label="Email" value={item.email} />
            <DetailRow label="Status" value={item.status} />
            <DetailRow label="Has access token" value={String(item.has_access_token)} />
            <DetailRow label="Access token preview" value={item.access_token_preview} />
            <DetailRow label="Installed at" value={formatDateTime(item.installed_at)} />
            <DetailRow label="Uninstalled at" value={formatDateTime(item.uninstalled_at)} />
            <DetailRow label="Last seen at" value={formatDateTime(item.last_seen_at)} />
            <DetailRow label="Updated at" value={formatDateTime(item.updated_at)} />
          </dl>
          <div className="mt-4 rounded-lg bg-black/[0.03] p-3">
            <p className="mb-2 text-sm font-semibold">Metadata</p>
            <pre className="max-h-[360px] overflow-auto text-xs">
              {JSON.stringify(item.metadata || {}, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DetailRow({ label, value }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-black/50">{label}</dt>
      <dd className="mt-1 text-sm text-black/80">{value || "-"}</dd>
    </div>
  );
}
