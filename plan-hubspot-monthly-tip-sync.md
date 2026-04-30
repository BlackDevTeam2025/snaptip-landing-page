# HubSpot Monthly Tip Sync Plan

## Summary
- Contact represents one SnapTip shop identity.
- Deal represents one monthly tip summary for one shop, platform, month, and currency.
- Postgres remains the source of truth; HubSpot receives synced CRM/reporting records.
- Sync is available by internal endpoint and by Vercel Cron.

## Backend Changes
- Add HubSpot API service for custom property setup, Contact upsert, Deal upsert, and Contact-to-Deal association.
- Add `hubspot_sync_jobs` plus HubSpot audit fields on `app_installations`.
- Add monthly summary DB query based on `installation_monthly_tip_totals`.
- Add internal endpoints:
  - `POST /internal/hubspot/setup`
  - `POST /internal/hubspot/sync-monthly-tips`
  - `GET /internal/cron/hubspot/monthly-tips`
- Add Vercel Cron for the first day of each month.

## HubSpot Mapping
- Contact unique property: `snaptip_installation_key`.
- Deal unique property: `snaptip_monthly_tip_key`.
- Deal uses `amount`, `closedate`, `pipeline=default`, `dealstage=closedwon`, and `deal_currency_code`.
- Unsupported HubSpot deal currencies are skipped and recorded in `hubspot_sync_jobs`.

## Verification
- Internal endpoints reject invalid auth.
- Setup endpoint is idempotent.
- Monthly sync creates or updates Contact and Deal.
- Sync records success, failure, or skipped status.
- Cron endpoint requires `CRON_SECRET`.
