export type CloseInteraction = 'mouse' | 'touch' | 'pen' | 'keyboard' | '';
export interface PopupFocusOptions {
  readonly initialFocus?:
    | boolean
    | { readonly current: HTMLElement | null }
    | ((openType: CloseInteraction) => boolean | HTMLElement | null | void)
    | undefined;
  readonly finalFocus?:
    | boolean
    | { readonly current: HTMLElement | null }
    | ((closeType: CloseInteraction) => boolean | HTMLElement | null | void)
    | undefined;
}

export function restorePopupFocus(
  finalFocus: PopupFocusOptions['finalFocus'],
  fallback: HTMLElement | undefined,
  interaction: CloseInteraction,
) {
  const target =
    typeof finalFocus === 'function'
      ? finalFocus(interaction)
      : finalFocus === undefined
        ? true
        : finalFocus;
  if (target === true || target === null) fallback?.focus();
  else if (target && typeof target === 'object') {
    if ('current' in target) target.current?.focus();
    else target.focus();
  }
}

export function focusPopupInitially(
  initialFocus: PopupFocusOptions['initialFocus'],
  fallback: HTMLElement | undefined,
  previous: Element | null,
  interaction: CloseInteraction,
) {
  const beforeCallback = previous?.ownerDocument.activeElement;
  const target =
    typeof initialFocus === 'function'
      ? initialFocus(interaction)
      : initialFocus === undefined
        ? true
        : initialFocus;
  if (target === true || target === null) fallback?.focus();
  else if (target && typeof target === 'object') {
    if ('current' in target) (target.current ?? fallback)?.focus();
    else target.focus();
  } else if (
    previous instanceof HTMLElement &&
    previous.ownerDocument.activeElement === beforeCallback &&
    beforeCallback !== previous
  ) {
    // Native dialogs may autofocus while opening, even when the adapter disables autofocus.
    previous.focus();
  }
}
