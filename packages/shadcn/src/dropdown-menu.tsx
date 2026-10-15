import * as Base from '@effectweb/base-ui/menu';
import ChevronRight from '@effectweb/lucide/icons/chevron-right';
import type { Native } from '@effectweb/base-ui/types';
import { controllerView, list, modelOwner, observe, sequence, view, type JSX } from 'effectweb';
import { createMenu, menuAnchorBinding, nextIndex, type MenuHandle } from '@effectweb/base-ui';
import Check from '@effectweb/lucide/icons/check';
import { cn } from './cn.js';
import type { Align, Side } from './placement.js';
export type MenuEntry =
  | {
      readonly kind: 'item';
      readonly label: JSX.Element;
      readonly onSelect: () => void;
      readonly disabled?: boolean | undefined;
      readonly variant?: 'default' | 'destructive' | undefined;
      readonly inset?: boolean | undefined;
      readonly shortcut?: string | undefined;
      readonly icon?: JSX.Element;
    }
  | {
      readonly kind: 'checkbox';
      readonly label: JSX.Element;
      readonly checked: boolean;
      readonly onCheckedChange: (checked: boolean) => void;
      readonly disabled?: boolean | undefined;
    }
  | { readonly kind: 'label'; readonly label: JSX.Element; readonly inset?: boolean | undefined }
  | { readonly kind: 'separator' }
  | {
      readonly kind: 'submenu';
      readonly label: JSX.Element;
      readonly items: readonly MenuEntry[];
      readonly disabled?: boolean | undefined;
    }
  | {
      readonly kind: 'radio';
      readonly label: JSX.Element;
      readonly value: string;
      readonly checked: boolean;
      readonly onSelect: () => void;
      readonly disabled?: boolean | undefined;
    };

export interface DropdownMenuProps {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly trigger: JSX.Element;
  readonly items: ReadonlyArray<MenuEntry>;
  readonly side?: Side | undefined;
  readonly align?: Align | undefined;
  readonly sideOffset?: number | undefined;
  readonly class?: string | undefined;
  readonly 'aria-label'?: string | undefined;
}

/** The item an arrow key moves focus to. */
export const nextMenuItem = (count: number, current: number, key: string): number | null =>
  nextIndex(count, current, key);
function menuController(props: DropdownMenuProps) {
  const owner = modelOwner({ props });
  const menu = createMenu({
    get open() {
      return owner.read().props.open;
    },
    defaultOpen: props.defaultOpen,
    onOpenChange: (open) => owner.read().props.onOpenChange?.(open),
  });
  owner.own(menu.lifetime);
  return {
    source: owner.source,
    menu,
    lifetime: owner,
    receive: (next: DropdownMenuProps) => {
      owner.patch({ props: next });
      if (next.open !== undefined) menu.sync({ open: next.open });
    },
  };
}
type SubmenuProps = {
  readonly menu: MenuHandle;
  readonly entry: Extract<MenuEntry, { kind: 'submenu' }>;
};
function submenuController(props: SubmenuProps) {
  const owner = modelOwner({ props });
  const submenu = createMenu({ parent: props.menu });
  owner.own(submenu.lifetime);
  return {
    source: owner.source,
    submenu,
    lifetime: owner,
    receive: (next: SubmenuProps) => owner.patch({ props: next }),
  };
}
const Submenu = controllerView(
  { controller: submenuController },
  view((model) => (
    <>
      <DropdownMenuSubTrigger
        menu={model.props.menu}
        submenu={model.actions.submenu}
        disabled={model.props.entry.disabled}
      >
        {model.props.entry.label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent menu={model.actions.submenu}>
        <Entries menu={model.actions.submenu} items={model.props.entry.items} />
      </DropdownMenuSubContent>
    </>
  )),
);
type RadioEntry = Extract<MenuEntry, { kind: 'radio' }>;
type EntryGroup =
  | Exclude<MenuEntry, RadioEntry>
  | { readonly kind: 'radios'; readonly items: readonly RadioEntry[] };
/** Adjacent radio entries form one independent selection group. */
function groupEntries(items: readonly MenuEntry[]): EntryGroup[] {
  const groups: EntryGroup[] = [];
  for (const entry of items) {
    const last = groups.at(-1);
    if (entry.kind !== 'radio') groups.push(entry);
    else if (last?.kind === 'radios')
      groups[groups.length - 1] = { kind: 'radios', items: [...last.items, entry] };
    else groups.push({ kind: 'radios', items: [entry] });
  }
  return groups;
}
type RadioEntriesProps = { readonly menu: MenuHandle; readonly items: readonly RadioEntry[] };
const RadioEntries = controllerView(
  {
    controller: (props: RadioEntriesProps) => {
      const owner = modelOwner({ props });
      const value = () => owner.read().props.items.find((entry) => entry.checked)?.value ?? '';
      const menu = createMenu({
        parent: props.menu,
        get value() {
          return value();
        },
        onValueChange: (next) =>
          owner
            .read()
            .props.items.find((entry) => entry.value === next)
            ?.onSelect(),
      });
      owner.own(menu.lifetime);
      return {
        source: owner.source,
        menu,
        lifetime: owner,
        receive: (next: RadioEntriesProps) => {
          owner.patch({ props: next });
          menu.sync({ value: value() });
        },
      };
    },
  },
  view((model) => (
    <DropdownMenuRadioGroup>
      {list(
        model.props.items,
        (entry) => entry.value,
        (entry) => (
          <DropdownMenuRadioItem
            menu={model.actions.menu}
            value={entry.value}
            disabled={entry.disabled}
          >
            {entry.label}
          </DropdownMenuRadioItem>
        ),
      )}
    </DropdownMenuRadioGroup>
  )),
);
const Entries = view<{ readonly menu: MenuHandle; readonly items: readonly MenuEntry[] }>(
  (props) => (
    <>
      {list(sequence(groupEntries(props.items)), (entry) =>
        entry.kind === 'separator' ? (
          <DropdownMenuSeparator />
        ) : entry.kind === 'label' ? (
          <DropdownMenuLabel inset={entry.inset}>{entry.label}</DropdownMenuLabel>
        ) : entry.kind === 'submenu' ? (
          <Submenu menu={props.menu} entry={entry} />
        ) : entry.kind === 'radios' ? (
          <RadioEntries menu={props.menu} items={entry.items} />
        ) : entry.kind === 'checkbox' ? (
          <DropdownMenuCheckboxItem
            menu={props.menu}
            checked={entry.checked}
            onCheckedChange={entry.onCheckedChange}
            disabled={entry.disabled}
          >
            {entry.label}
          </DropdownMenuCheckboxItem>
        ) : (
          <DropdownMenuItem
            menu={props.menu}
            disabled={entry.disabled}
            inset={entry.inset}
            variant={entry.variant}
            onClick={entry.onSelect}
          >
            {entry.icon}
            {entry.label}
            {entry.shortcut ? <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut> : null}
          </DropdownMenuItem>
        ),
      )}
    </>
  ),
);
/** A menu whose controller is owned by this view. */
export const DropdownMenu = controllerView(
  { controller: menuController },
  view((model) => (
    <span
      data-slot="dropdown-menu"
      class="inline-block"
      use={menuAnchorBinding(model.actions.menu)}
      onClick={(event) => {
        if (event.currentTarget.firstElementChild?.contains(event.target as Node))
          model.actions.menu.toggle();
      }}
      onKeyDown={(event) => {
        if (
          event.currentTarget.firstElementChild?.contains(event.target as Node) &&
          (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        ) {
          event.preventDefault();
          model.actions.menu.openFromKey(event.key);
        }
      }}
    >
      {model.props.trigger}
      <DropdownMenuContent
        menu={model.actions.menu}
        side={model.props.side ?? 'bottom'}
        align={model.props.align ?? 'start'}
        sideOffset={model.props.sideOffset ?? 4}
        aria-label={model.props['aria-label']}
        data-slot="dropdown-menu-content"
        class={model.props.class}
      >
        <Entries menu={model.actions.menu} items={model.props.items} />
      </DropdownMenuContent>
    </span>
  )),
);

/** The button that opens a dropdown menu; takes the `menu` handle. */
export const DropdownMenuTrigger = view<Base.MenuTriggerProps>((props) => (
  <Base.MenuTrigger {...props} data-slot="dropdown-menu-trigger" />
));
/** Groups dropdown menu entries. */
export const DropdownMenuGroup = view<Parameters<typeof Base.MenuGroup>[0]>((props) => (
  <Base.MenuGroup {...props} data-slot="dropdown-menu-group" />
));
/** Groups radio entries sharing the menu value. */
export const DropdownMenuRadioGroup = view<Parameters<typeof Base.MenuRadioGroup>[0]>((props) => (
  <Base.MenuRadioGroup {...props} data-slot="dropdown-menu-radio-group" />
));
/** A structural group; the parent owns the submenu handle and passes it to trigger and content. */
export const DropdownMenuSub = view<Native<'div'>>((props) => (
  <div {...props} data-slot="dropdown-menu-sub" />
));

/** The styled dropdown menu popup. */
export const DropdownMenuContent = view<Parameters<typeof Base.MenuPopup>[0]>(
  ({ class: className, children, ...props }) => (
    <Base.MenuPopup
      side="bottom"
      align="start"
      alignOffset={0}
      sideOffset={4}
      {...props}
      data-slot="dropdown-menu-content"
      class={cn(
        'cn-menu-target cn-menu-translucent z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95',
        className,
      )}
    >
      {children}
    </Base.MenuPopup>
  ),
);

/** The styled submenu popup. */
export const DropdownMenuSubContent = view<Parameters<typeof Base.MenuPopup>[0]>(
  ({ class: className, children, ...props }) => (
    <Base.MenuPopup
      side="right"
      align="start"
      alignOffset={-3}
      sideOffset={0}
      {...props}
      data-slot="dropdown-menu-sub-content"
      class={cn(
        'cn-menu-target cn-menu-translucent w-auto min-w-[96px] rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
        className,
      )}
    >
      {children}
    </Base.MenuPopup>
  ),
);

/** A styled menu entry with `variant` and `inset`. */
export const DropdownMenuItem = view<
  Parameters<typeof Base.MenuItem>[0] & { readonly inset?: boolean | undefined } & {
    readonly variant?: 'default' | 'destructive' | undefined;
  }
>(({ class: className, children, inset, variant = 'default', ...props }) => (
  <Base.MenuItem
    {...props}
    data-slot="dropdown-menu-item"
    data-inset={inset ? '' : undefined}
    data-variant={variant}
    class={cn(
      "group/dropdown-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
      className,
    )}
  >
    {children}
  </Base.MenuItem>
));

/** A styled menu entry with a check indicator. */
export const DropdownMenuCheckboxItem = view<
  Parameters<typeof Base.MenuCheckboxItem>[0] & { readonly inset?: boolean | undefined }
>(({ class: className, children, inset, ...props }) => (
  <Base.MenuCheckboxItem
    {...props}
    data-slot="dropdown-menu-checkbox-item"
    data-inset={inset ? '' : undefined}
    class={cn(
      "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
  >
    <span
      class="pointer-events-none absolute right-2 flex items-center justify-center"
      data-slot="dropdown-menu-checkbox-item-indicator"
    >
      {props.checked ? <Check /> : null}
    </span>
    {children}
  </Base.MenuCheckboxItem>
));

/** A styled radio entry with a dot indicator. */
export const DropdownMenuRadioItem = view<
  Parameters<typeof Base.MenuRadioItem>[0] & { readonly inset?: boolean | undefined }
>(({ class: className, children, inset, ...props }) => (
  <Base.MenuRadioItem
    {...props}
    data-slot="dropdown-menu-radio-item"
    data-inset={inset ? '' : undefined}
    class={cn(
      "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
  >
    <span
      class="pointer-events-none absolute right-2 flex items-center justify-center"
      data-slot="dropdown-menu-radio-item-indicator"
    >
      {observe(props.menu.source, (state) => (state.value === props.value ? <Check /> : null))}
    </span>
    {children}
  </Base.MenuRadioItem>
));

/** A styled menu label. */
export const DropdownMenuLabel = view<
  Parameters<typeof Base.MenuGroupLabel>[0] & { readonly inset?: boolean | undefined }
>(({ class: className, children, inset, ...props }) => (
  <Base.MenuGroupLabel
    {...props}
    data-slot="dropdown-menu-label"
    data-inset={inset ? '' : undefined}
    class={cn('px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7', className)}
  >
    {children}
  </Base.MenuGroupLabel>
));

/** A styled menu separator. */
export const DropdownMenuSeparator = view<Parameters<typeof Base.MenuSeparator>[0]>(
  ({ class: className, children, ...props }) => (
    <Base.MenuSeparator
      {...props}
      data-slot="dropdown-menu-separator"
      class={cn('-mx-1 my-1 h-px bg-border', className)}
    >
      {children}
    </Base.MenuSeparator>
  ),
);

/** Right-aligned shortcut text in a menu entry. */
export const DropdownMenuShortcut = view<Native<'span'>>(
  ({ class: className, children, ...props }) => (
    <span
      {...props}
      data-slot="dropdown-menu-shortcut"
      class={cn(
        'ml-auto text-xs tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground',
        className,
      )}
    >
      {children}
    </span>
  ),
);

/** A styled entry that opens a submenu. */
export const DropdownMenuSubTrigger = view<
  Parameters<typeof Base.MenuSubmenuTrigger>[0] & { readonly inset?: boolean | undefined }
>(({ class: className, children, inset, ...props }) => (
  <Base.MenuSubmenuTrigger
    {...props}
    data-slot="dropdown-menu-sub-trigger"
    data-inset={inset ? '' : undefined}
    class={cn(
      "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
  >
    {children}
    <ChevronRight class="cn-rtl-flip ml-auto" />
  </Base.MenuSubmenuTrigger>
));
