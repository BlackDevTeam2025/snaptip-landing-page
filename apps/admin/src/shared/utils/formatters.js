export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export function truncateText(text, maxLength = 100) {
  const value = String(text || "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

export function formatMoney(amount, currency) {
  const numericAmount = Number(amount || 0);
  const normalizedCurrency = String(currency || "USD").toUpperCase();

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(numericAmount);
  } catch (_error) {
    return `${numericAmount.toFixed(2)} ${normalizedCurrency}`;
  }
}
