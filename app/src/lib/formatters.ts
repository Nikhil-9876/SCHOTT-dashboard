// ── Number and currency formatters ──

const inLocale = 'en-IN';
const euroLocale = 'en-IE';

/** Format as Indian Rupees: ₹X,XX,XXX */
export function formatINR(value: number): string {
  return new Intl.NumberFormat(inLocale, {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Shorthand: ₹8.5L for values ≥ 1,00,000 */
export function formatLakh(value: number): string {
  if (value >= 100000) {
    const lakhs = value / 100000;
    return `₹${lakhs % 1 === 0 ? lakhs.toFixed(0) : lakhs.toFixed(1)}L`;
  }
  return formatINR(value);
}

/** Plain number in en-IN format: 5,60,141 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(inLocale).format(value);
}

/** Percentage: 3.14% */
export function formatPercent(value: number, decimals = 2): string {
  // value stored as decimal (0.0314) → multiply by 100
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Percentage already in percent units (e.g. 1.24 → "1.24%") */
export function formatPercentDirect(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/** Format INR without currency symbol shorthand */
export function formatINRShort(value: number): string {
  return `₹${new Intl.NumberFormat(inLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

/** Format as Euro: €1,234.56 */
export function formatEUR(value: number, decimals = 2): string {
  return new Intl.NumberFormat(euroLocale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Compact Euro for cards while keeping FIOLAX cost reporting in EUR. */
export function formatEURCompact(value: number): string {
  if (value >= 1000000) return `€${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `€${(value / 1000).toFixed(1)}K`;
  return formatEUR(value);
}

/**
 * Compute the number of inclusive days between two ISO date strings.
 * If `end` is null/undefined the current date is used (campaign still running).
 * Returns null when start is missing.
 */
export function computeDays(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start) return null;
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
}

/** Format a day count as "42d", or "—" when null. */
export function formatDays(days: number | null): string {
  if (days === null || days === undefined) return '—';
  return `${days}d`;
}
