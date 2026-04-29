# WooCommerce Plugin Backend Sync Update

## Summary
- Keep the current WooCommerce submission in review; ship backend sync as plugin update `0.2.0` after approval.
- The first sync version only sends installation tracking and monthly tip totals.
- The plugin should call SnapTip backend directly with `wp_remote_post()` instead of relying on WooCommerce webhooks as the primary sync path.

## Backend Changes
- `POST /internal/installations/woocommerce` upserts `app_installations` with `platform=woocommerce`.
- The install endpoint normalizes `shop_identifier` to a hostname and accepts optional `shop_domain`, `email`, `name`, `currency`, and `source` metadata.
- The install endpoint returns a per-site `sync_token` derived server-side from `WOOCOMMERCE_SYNC_TOKEN_SECRET`.
- `POST /internal/tip-totals/monthly` accepts WooCommerce totals authenticated by `x-snaptip-site-token`.

## Plugin Behavior
- Send installation data on plugin activation.
- Retry installation sync when an admin opens or saves settings.
- After an order with `_snaptip_amount > 0` is created or reaches a valid status, calculate the current month total from WooCommerce orders and send the absolute monthly total.
- Re-send the same monthly total on later eligible order status changes or retries; backend upsert keeps the operation idempotent.

## Privacy
- v0.2.0 sends only store metadata and monthly tip totals to `snaptip.tech`.
- It does not send customer names, customer emails, order line items, or per-order audit data.

## Release Checks
- Bump WooCommerce plugin version to `0.2.0`.
- Update plugin `README` and `changelog.txt` with the data sync disclosure.
- Run Woo/QIT-compatible checks before uploading the new version.
