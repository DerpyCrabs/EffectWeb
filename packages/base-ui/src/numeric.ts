/** Snap relative to the minimum without leaking binary floating-point noise. */
export function snapNumber(value: number, min = 0, max = Infinity, step = 1): number {
  const origin = Number.isFinite(min) ? min : 0;
  const increment = Number.isFinite(step) && step > 0 ? step : 1;
  const snapped = Number(
    (origin + Math.round((value - origin) / increment) * increment).toPrecision(14),
  );
  return Math.min(max, Math.max(min, snapped));
}
/** Parse localized digits, separators, signs and percent output from Intl.NumberFormat. */
export function parseNumber(
  text: string,
  locale?: string,
  options: Intl.NumberFormatOptions = {},
): number | null {
  const format = new Intl.NumberFormat(locale, options);
  const parts = [
    ...new Intl.NumberFormat(locale, { minimumFractionDigits: 1 }).formatToParts(-12345.6),
    ...format
      .formatToParts(-12345.6)
      .filter((part) => part.type !== 'decimal' && part.type !== 'group'),
  ];
  let normalized = text.trim();
  const accounting =
    options.currencySign === 'accounting' && normalized.includes('(') && normalized.includes(')');
  const digits = new Intl.NumberFormat(locale, { useGrouping: false });
  for (let i = 0; i < 10; i++) normalized = normalized.split(digits.format(i)).join(String(i));
  for (const part of parts) {
    if (part.type === 'decimal') normalized = normalized.split(part.value).join('.');
    else if (part.type === 'minusSign') normalized = normalized.split(part.value).join('-');
    else if (['group', 'currency', 'percentSign', 'unit', 'literal'].includes(part.type))
      normalized = normalized.split(part.value).join('');
  }
  normalized = normalized.replace(/[\s\u061c\u200e\u200f]/g, '');
  if (accounting) normalized = `-${normalized.replace(/[()]/g, '')}`;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized) / (options.style === 'percent' ? 100 : 1);
  return Number.isFinite(value) ? value : null;
}
/** Format a number using the requested locale and Intl options. */
export const formatNumber = (value: number, locale?: string, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(locale, options).format(value);
