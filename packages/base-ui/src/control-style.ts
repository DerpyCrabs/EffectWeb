import type { JSX } from 'effectweb';
type Style = JSX.IntrinsicElements['div']['style'];
/** Preserve both supported native style forms while adding required control geometry. */
export function controlStyle(base: Exclude<Style, string | undefined>, custom: Style): Style {
  if (typeof custom !== 'string') return { ...base, ...custom };
  const declarations = Object.entries(base)
    .map(
      ([key, value]) =>
        `${key.startsWith('--') ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${String(value)}`,
    )
    .join(';');
  return `${declarations};${custom}`;
}
