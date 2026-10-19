import { OverlayPortal, type OverlayPortalProps } from './overlay-portal.js';
import type { PopupFocusOptions } from './popup-focus.js';
import { composeMounts } from 'effectweb';
import { logicalKey } from './direction.js';
import { Positioner, Arrow } from './positioner.js';
import { observe, view, modelOwner, type Source } from 'effectweb';
import {
  createValueController,
  type ValueOptions,
  type ValueState,
  type OpenState,
} from './controller.js';
import {
  createOverlay,
  popupBinding,
  triggerBinding,
  type OverlayHandle,
  type OverlayOptions,
  type PositionOptions,
} from './overlay.js';
import type { Native } from './types.js';
/** Create a parent-owned Menu handle; pass it to the parts and own its lifetime. */
export interface MenuState extends ValueState, OpenState {
  readonly highlightItemOnHover: boolean;
}
export interface MenuOptions extends OverlayOptions, ValueOptions {
  readonly highlightItemOnHover?: boolean | undefined;
}
/** Create a Menu handle: open state, the highlighted item, radio value and submenu links, shared by the trigger, popup and items. */
export function createMenu(options: MenuOptions = {}): MenuHandle {
  const overlay = createOverlay(options);
  const owner = modelOwner<MenuState>({
    ...overlay.source.model(),
    value: options.value ?? options.defaultValue ?? '',
    dirty: options.dirty ?? false,
    highlightItemOnHover: options.highlightItemOnHover ?? true,
  });
  owner.own(overlay.lifetime);
  owner.own(overlay.source.subscribe((state) => owner.patch(state)));
  return {
    ...overlay,
    source: owner.source,
    lifetime: owner,
    sync: (state: Partial<ReturnType<typeof owner.read>>) => {
      overlay.sync({
        ...(state.open === undefined ? {} : { open: state.open }),
        ...(state.disabled === undefined ? {} : { disabled: state.disabled }),
      });
      owner.patch(state);
    },
    setValue: (value: string) => {
      if (owner.read().disabled || owner.read().value === value) return;
      if (options.value === undefined) owner.patch({ value, dirty: true });
      options.onValueChange?.(value);
    },
  };
}
export interface MenuHandle extends OverlayHandle {
  readonly source: Source<MenuState>;
  readonly sync: (state: Partial<MenuState>) => void;
  readonly setValue: (value: string) => void;
}
export type MenuTriggerProps = Native<'button'> & { readonly menu: MenuHandle };
/** A button that opens the menu from its `menu` handle and reflects `aria-expanded`. */
export const MenuTrigger = view<MenuTriggerProps>(
  ({ menu, children, onClick, onKeyDown, ...rest }) =>
    observe(menu.source, (state) => (
      <button
        {...rest}
        type="button"
        use={composeMounts([rest.use, triggerBinding(menu)])}
        disabled={state.disabled || rest.disabled}
        aria-controls={`${menu.id}-popup`}
        aria-expanded={state.open}
        aria-haspopup="menu"
        data-open={state.open ? '' : undefined}
        data-closed={!state.open ? '' : undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) menu.toggle({ reason: 'trigger-press', event });
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            menu.openFromKey(event.key, event);
          }
        }}
      >
        {children}
      </button>
    )),
);
export type MenuPopupProps = Native<'div'> &
  PositionOptions &
  PopupFocusOptions & { readonly menu: MenuHandle };
/** The menu surface; arrow keys, Home, End and typeahead move between its items. */
export const MenuPopup = view<MenuPopupProps>(
  ({
    menu,
    children,
    side,
    align,
    sideOffset,
    alignOffset,
    collisionAvoidance,
    anchor,
    initialFocus,
    finalFocus,
    ...rest
  }) => (
    <div
      {...rest}
      id={`${menu.id}-popup`}
      role="menu"
      popover="manual"
      tabindex={-1}
      data-overlay-parent={menu.parent?.id}
      use={composeMounts([
        rest.use,
        popupBinding({
          handle: menu,
          initialFocus,
          finalFocus,
          kind: 'menu',
          side,
          align,
          sideOffset,
          alignOffset,
          collisionAvoidance,
          anchor,
        }),
      ])}
    >
      {children}
    </div>
  ),
);
/** A button that closes the menu. */
export const MenuClose = view<Native<'button'> & { readonly menu: MenuHandle }>(
  ({ menu, children, onClick, ...rest }) => (
    <button
      {...rest}
      type="button"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) menu.hide({ reason: 'close-press', event });
      }}
    >
      {children}
    </button>
  ),
);
/** A heading for the menu popup; its id comes from the handle. */
export const MenuTitle = view<Native<'h2'> & { readonly menu: MenuHandle }>(({ menu, ...rest }) => (
  <h2 {...rest} id={`${menu.id}-title`} />
));
/** Descriptive text for the menu popup; its id comes from the handle. */
export const MenuDescription = view<Native<'p'> & { readonly menu: MenuHandle }>(
  ({ menu, ...rest }) => <p {...rest} id={`${menu.id}-description`} />,
);
/** A selectable menu entry; `onSelect` runs on click, Enter or Space and the menu tree closes. */
export const MenuItem = view<
  Native<'button'> & { readonly menu: MenuHandle; readonly closeOnClick?: boolean | undefined }
>(({ menu, children, onClick, onPointerMove, closeOnClick, ...rest }) => (
  <button
    {...rest}
    type="button"
    role="menuitem"
    tabindex={-1}
    data-disabled={rest.disabled ? '' : undefined}
    onPointerMove={(event) => {
      onPointerMove?.(event);
      if (
        !event.defaultPrevented &&
        !rest.disabled &&
        menu.source.model().highlightItemOnHover &&
        event.pointerType !== 'touch'
      )
        event.currentTarget.focus();
    }}
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented && closeOnClick !== false) menu.closeTree();
    }}
  >
    {children}
  </button>
));
/** A menu entry with a checked state; takes `checked` and `onCheckedChange`. */
export const MenuCheckboxItem = view<
  Native<'button'> & {
    readonly menu: MenuHandle;
    readonly checked: boolean;
    readonly closeOnClick?: boolean | undefined;
    readonly onCheckedChange?: ((checked: boolean) => void) | undefined;
  }
>(({ menu, checked, closeOnClick = false, onCheckedChange, children, onClick, ...rest }) => (
  <button
    {...rest}
    type="button"
    role="menuitemcheckbox"
    data-disabled={rest.disabled ? '' : undefined}
    tabindex={-1}
    aria-checked={checked}
    data-checked={checked ? '' : undefined}
    data-unchecked={!checked ? '' : undefined}
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented) {
        onCheckedChange?.(!checked);
        if (closeOnClick) menu.closeTree();
      }
    }}
  >
    {children}
  </button>
));
/** Own an independent menu radio selection; controlled values change only through sync. */
export const createMenuRadioGroup = (options: ValueOptions = {}) => createValueController(options);
export type MenuRadioGroupHandle = ReturnType<typeof createMenuRadioGroup>;
/** Pass the same explicit radioGroup to each item belonging to this group. */
export const MenuRadioGroup = view<Native<'div'> & { readonly radioGroup?: MenuRadioGroupHandle }>(
  ({ radioGroup: _radioGroup, ...props }) => <div {...props} role="group" />,
);
/** A menu entry selected when its `value` matches the handle value. */
export const MenuRadioItem = view<
  Native<'button'> & {
    readonly menu: MenuHandle;
    readonly radioGroup?: MenuRadioGroupHandle;
    readonly closeOnClick?: boolean;
    readonly value: string;
  }
>(({ menu, radioGroup, closeOnClick = false, value, children, onClick, ...rest }) =>
  observe(radioGroup?.source ?? menu.source, (state) => (
    <button
      {...rest}
      type="button"
      role="menuitemradio"
      disabled={rest.disabled || state.disabled}
      data-disabled={rest.disabled || state.disabled ? '' : undefined}
      tabindex={-1}
      aria-checked={state.value === value}
      data-checked={state.value === value ? '' : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          (radioGroup ?? menu).setValue(value);
          if (closeOnClick) menu.closeTree();
        }
      }}
    >
      {children}
    </button>
  )),
);
/** An entry that opens a submenu created with `createMenu({ parent })`; takes both `menu` and `submenu`. */
export const MenuSubmenuTrigger = view<
  Native<'button'> & { readonly menu: MenuHandle; readonly submenu: MenuHandle }
>(({ menu: _menu, submenu, children, onKeyDown, onPointerEnter, onClick, ...rest }) =>
  observe(submenu.source, (state) => (
    <button
      {...rest}
      type="button"
      role={rest.role ?? 'menuitem'}
      tabindex={-1}
      data-open={state.open ? '' : undefined}
      data-closed={!state.open ? '' : undefined}
      data-disabled={rest.disabled || state.disabled ? '' : undefined}
      disabled={rest.disabled || state.disabled}
      aria-haspopup="menu"
      aria-expanded={state.open}
      aria-controls={`${submenu.id}-popup`}
      use={triggerBinding(submenu)}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (!event.defaultPrevented && !rest.disabled) submenu.showDelayed();
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) submenu.setOpen(true, { reason: 'trigger-press', event });
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (
          !event.defaultPrevented &&
          logicalKey(event.key, event.currentTarget) === 'ArrowRight'
        ) {
          event.preventDefault();
          submenu.setOpen(true, { reason: 'trigger-press', event });
        }
      }}
    >
      {children}
    </button>
  )),
);
/** Groups menu entries under a label. */
export const MenuGroup = view<Native<'div'>>((props) => <div {...props} role="group" />);
/** The label of a menu group. */
export const MenuGroupLabel = view<Native<'div'>>((props) => <div {...props} />);
/** A separator between menu groups. */
export const MenuSeparator = view<Native<'div'>>((props) => <div {...props} role="separator" />);

/** Positions the menu popup against its trigger or a submenu trigger. */
export const MenuPositioner = view<Native<'div'> & PositionOptions & { readonly menu: MenuHandle }>(
  ({ menu, ...rest }) => <Positioner {...rest} handle={menu} />,
);
/** An arrow element aligned to the menu anchor. */
export const MenuArrow = view<Native<'span'> & { readonly menu: MenuHandle }>(
  ({ menu, ...rest }) => <Arrow {...rest} handle={menu} />,
);

export type MenuPortalProps = Omit<OverlayPortalProps, 'handle'> & { readonly menu: MenuHandle };
/** Mount popup content while open or exiting; keepMounted explicitly retains closed content. */
export const MenuPortal = view<MenuPortalProps>(({ menu, ...props }) => (
  <OverlayPortal handle={menu} {...props} />
));
