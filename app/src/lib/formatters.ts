// ── Number formatters using en-IN locale (Indian numbering system) ──

const inLocale = 'en-IN';

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
