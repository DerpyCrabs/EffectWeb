import Search from '@effectweb/lucide/icons/search';
import { domBinding, modelOwner, observe, view, type JSX } from 'effectweb';
import { cn } from './cn.js';
import { Dialog, type DialogProps } from './dialog.js';
import type { Native, Styled } from './types.js';

export interface CommandOptions {
  /** Score an item against the search; 0 hides it. Defaults to a prefix, word and fuzzy match. */
  readonly filter?:
    | ((value: string, search: string, keywords: readonly string[]) => number)
    | undefined;
  /** Keep every item while the application filters itself. */
  readonly shouldFilter?: boolean | undefined;
  /** Wrap from the last item to the first with the arrow keys. */
  readonly loop?: boolean | undefined;
  readonly value?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
  readonly search?: string | undefined;
  readonly defaultSearch?: string | undefined;
  readonly onSearchChange?: ((search: string) => void) | undefined;
}
export interface CommandState {
  readonly search: string;
  /** The highlighted item's value. */
  readonly value: string;
  readonly count: number;
}
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** The default scorer: exact, prefix, word-boundary, contiguous, then subsequence matches. */
export function commandScore(value: string, search: string, keywords: readonly string[] = []) {
  const query = normalize(search.trim());
  if (!query) return 1;
  const candidates = [value, ...keywords].map(normalize);
  let best = 0;
  for (const candidate of candidates) {
    let score = 0;
    if (candidate === query) score = 1;
    else if (candidate.startsWith(query)) score = 0.9;
    else if (candidate.split(/[\s_-]+/u).some((word) => word.startsWith(query))) score = 0.8;
    else if (candidate.includes(query)) score = 0.6;
    else {
      let index = 0;
      for (const character of query) {
        index = candidate.indexOf(character, index);
        if (index < 0) break;
        index++;
      }
      if (index >= 0) score = 0.3;
    }
    best = Math.max(best, score);
  }
  return best;
}
/** Create a parent-owned Command handle shared by the input, list, groups and items. */
export function createCommand(options: CommandOptions = {}) {
  const owner = modelOwner<CommandState>({
    search: options.search ?? options.defaultSearch ?? '',
    value: options.value ?? options.defaultValue ?? '',
    count: 0,
  });
  let root: HTMLElement | undefined;
  const score = options.filter ?? commandScore;
  const items = () =>
    root ? [...root.querySelectorAll<HTMLElement>('[data-slot=command-item]')] : [];
  const visible = () => items().filter((item) => !item.hidden && item.dataset.disabled !== 'true');
  const setValue = (value: string) => {
    if (owner.read().value === value) return;
    if (options.value === undefined) owner.patch({ value });
    options.onValueChange?.(value);
  };
  /** Apply the search to the DOM: hide misses, empty groups, and keep a valid highlight. */
  const reconcile = () => {
    if (!root) return;
    const { search, value } = owner.read();
    const filtering = options.shouldFilter !== false;
    let count = 0;
    for (const item of items()) {
      const keywords = (item.dataset.keywords ?? '').split('\u001f').filter(Boolean);
      const matched = !filtering || score(item.dataset.value ?? '', search, keywords) > 0;
      item.hidden = !matched;
      if (matched) count++;
    }
    for (const group of root.querySelectorAll<HTMLElement>('[data-slot=command-group]'))
      group.hidden = !group.querySelector('[data-slot=command-item]:not([hidden])');
    for (const empty of root.querySelectorAll<HTMLElement>('[data-slot=command-empty]'))
      empty.hidden = count > 0;
    const candidates = visible();
    const highlighted = candidates.find((item) => item.dataset.value === value) ?? candidates[0];
    for (const item of items()) item.dataset.selected = item === highlighted ? 'true' : 'false';
    highlighted?.setAttribute('aria-selected', 'true');
    for (const item of candidates)
      if (item !== highlighted) item.setAttribute('aria-selected', 'false');
    if (owner.read().count !== count) owner.patch({ count });
    if (highlighted && highlighted.dataset.value !== value)
      setValue(highlighted.dataset.value ?? '');
    else if (!highlighted && value) setValue('');
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      reconcile();
    });
  };
  owner.own(owner.source.subscribe(schedule));
  return {
    source: owner.source,
    lifetime: owner,
    setValue,
    setSearch(search: string) {
      if (owner.read().search === search) return;
      if (options.search === undefined) owner.patch({ search });
      options.onSearchChange?.(search);
    },
    /** Move the highlight by `step` visible items. */
    move(step: number) {
      const candidates = visible();
      if (!candidates.length) return;
      const index = candidates.findIndex((item) => item.dataset.value === owner.read().value);
      let next = index + step;
      if (options.loop) next = ((next % candidates.length) + candidates.length) % candidates.length;
      else next = Math.max(0, Math.min(candidates.length - 1, next));
      setValue(candidates[next]!.dataset.value ?? '');
      candidates[next]!.scrollIntoView({ block: 'nearest' });
    },
    first: () => {
      const candidates = visible();
      if (candidates[0]) setValue(candidates[0].dataset.value ?? '');
    },
    last: () => {
      const candidates = visible();
      const item = candidates.at(-1);
      if (item) setValue(item.dataset.value ?? '');
    },
    /** Activate the highlighted item as a click would. */
    select() {
      const item = visible().find((candidate) => candidate.dataset.value === owner.read().value);
      item?.click();
    },
    /** Internal: adopt the root element whose items and groups are filtered. */
    attach(element: HTMLElement) {
      root = element;
      const changes = new MutationObserver(schedule);
      changes.observe(element, { childList: true, subtree: true });
      reconcile();
      return () => {
        changes.disconnect();
        if (root === element) root = undefined;
      };
    },
  };
}
export type CommandHandle = ReturnType<typeof createCommand>;
const acquireRoot = (element: HTMLElement, current: () => CommandHandle) =>
  current().attach(element);
/** The palette: filters its items by the input and moves the highlight with the keyboard. */
export const Command = view<Native<'div'> & Styled & { readonly command: CommandHandle }>(
  ({ command, class: className, children, onKeyDown, ...rest }) => (
    <div
      data-slot="command"
      class={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
        className,
      )}
      use={domBinding(command, acquireRoot)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'ArrowDown') command.move(1);
        else if (event.key === 'ArrowUp') command.move(-1);
        else if (event.key === 'Home') command.first();
        else if (event.key === 'End') command.last();
        else if (event.key === 'Enter') command.select();
        else return;
        event.preventDefault();
      }}
      {...rest}
    >
      {children}
    </div>
  ),
);
/** The palette inside a modal dialog. */
export const CommandDialog = view<
  DialogProps & { readonly command: CommandHandle; readonly commandClass?: string | undefined }
>(({ command, commandClass, children, title, description, class: className, ...rest }) => (
  <Dialog
    {...rest}
    title={title ?? 'Command Palette'}
    description={description ?? 'Search for a command to run...'}
    class={cn('overflow-hidden p-0 [&>[data-slot=dialog-header]]:sr-only', className)}
  >
    <Command
      command={command}
      class={cn(
        '**:data-[slot=command-input-wrapper]:h-12 **:data-[slot=command-input]:h-12 **:data-[slot=command-group]:px-2 **:data-[slot=command-item]:px-2 **:data-[slot=command-item]:py-3 **:data-[slot=command-item]_svg:size-5 **:data-[slot=command-input-wrapper]_svg:size-5',
        commandClass,
      )}
    >
      {children}
    </Command>
  </Dialog>
));
/** The search input. */
export const CommandInput = view<
  Native<'input'> & { readonly command: CommandHandle; readonly class?: string | undefined }
>(({ command, class: className, onInput, ...rest }) =>
  observe(command.source, ({ search }) => (
    <div data-slot="command-input-wrapper" class="flex h-9 items-center gap-2 border-b px-3">
      <Search class="size-4 shrink-0 opacity-50" />
      <input
        data-slot="command-input"
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        autocomplete="off"
        spellcheck={false}
        value={search}
        class={cn(
          'flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        onInput={(event) => {
          onInput?.(event);
          if (!event.defaultPrevented) command.setSearch(event.currentTarget.value);
        }}
        {...rest}
      />
    </div>
  )),
);
/** The scrolling list of groups and items. */
export const CommandList = view<Native<'div'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <div
      data-slot="command-list"
      role="listbox"
      class={cn('max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto', className)}
      {...rest}
    >
      {children}
    </div>
  ),
);
/** Shown while no item matches the search. */
export const CommandEmpty = view<Native<'div'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <div
      data-slot="command-empty"
      role="presentation"
      class={cn('py-6 text-center text-sm', className)}
      hidden
      {...rest}
    >
      {children}
    </div>
  ),
);
/** A titled group of items, hidden while none of them match. */
export const CommandGroup = view<Native<'div'> & Styled & { readonly heading?: JSX.Element }>(
  ({ class: className, heading, children, ...rest }) => (
    <div
      data-slot="command-group"
      role="group"
      class={cn('overflow-hidden p-1 text-foreground', className)}
      {...rest}
    >
      {heading ? (
        <div
          data-slot="command-group-heading"
          class="px-2 py-1.5 text-xs font-medium text-muted-foreground"
        >
          {heading}
        </div>
      ) : null}
      {children}
    </div>
  ),
);
/** A line between groups. */
export const CommandSeparator = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    data-slot="command-separator"
    role="separator"
    class={cn('-mx-1 h-px bg-border', className)}
    {...rest}
  />
));
/** An item: `value` identifies it for highlighting, `keywords` extend the match, `select` runs on Enter or click. */
export const CommandItem = view<
  Native<'div'> &
    Styled & {
      readonly command: CommandHandle;
      readonly value: string;
      readonly keywords?: readonly string[] | undefined;
      readonly disabled?: boolean | undefined;
      /** Runs when the item is chosen by Enter or click. */
      readonly select?: ((value: string) => void) | undefined;
    }
>(
  ({
    command,
    value,
    keywords,
    disabled,
    select,
    class: className,
    children,
    onClick,
    onPointerMove,
    ...rest
  }) => (
    <div
      data-slot="command-item"
      role="option"
      data-value={value}
      data-keywords={keywords?.join('\u001f')}
      data-disabled={disabled ? 'true' : undefined}
      aria-disabled={disabled ? 'true' : undefined}
      class={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        if (!event.defaultPrevented && !disabled) command.setValue(value);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) return;
        command.setValue(value);
        select?.(value);
      }}
      {...rest}
    >
      {children}
    </div>
  ),
);
/** A keyboard shortcut hint at the end of an item. */
export const CommandShortcut = view<Native<'span'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <span
      data-slot="command-shortcut"
      class={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...rest}
    >
      {children}
    </span>
  ),
);
