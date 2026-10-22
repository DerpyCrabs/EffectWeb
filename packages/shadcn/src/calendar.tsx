import ChevronDown from '@effectweb/lucide/icons/chevron-down';
import ChevronLeft from '@effectweb/lucide/icons/chevron-left';
import ChevronRight from '@effectweb/lucide/icons/chevron-right';
import { domMount, list, modelOwner, observe, sequence, view } from 'effectweb';
import { buttonVariants } from './button.js';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

/** A calendar day as year, month (1-12) and day; time zones never enter the calendar. */
export interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}
export interface CalendarRange {
  readonly from: CalendarDay | undefined;
  readonly to: CalendarDay | undefined;
}
/** Which days are disabled: a list, bounds, a predicate, or a mix of them. */
export type CalendarMatcher =
  | CalendarDay
  | readonly CalendarDay[]
  | { readonly before?: CalendarDay | undefined; readonly after?: CalendarDay | undefined }
  | { readonly dayOfWeek: readonly number[] }
  | ((day: CalendarDay) => boolean);
export type CalendarSelection =
  | {
      readonly mode: 'single';
      readonly selected?: CalendarDay | undefined;
      readonly onSelect?: ((day: CalendarDay | undefined) => void) | undefined;
      readonly required?: boolean | undefined;
    }
  | {
      readonly mode: 'multiple';
      readonly selected?: readonly CalendarDay[] | undefined;
      readonly onSelect?: ((days: readonly CalendarDay[]) => void) | undefined;
      readonly min?: number | undefined;
      readonly max?: number | undefined;
    }
  | {
      readonly mode: 'range';
      readonly selected?: CalendarRange | undefined;
      readonly onSelect?: ((range: CalendarRange) => void) | undefined;
      readonly min?: number | undefined;
      readonly max?: number | undefined;
    };
export type CalendarOptions = CalendarSelection & {
  /** The first shown month; defaults to the selection or today. */
  readonly month?: CalendarDay | undefined;
  readonly defaultMonth?: CalendarDay | undefined;
  readonly onMonthChange?: ((month: CalendarDay) => void) | undefined;
  readonly numberOfMonths?: number | undefined;
  readonly disabled?: CalendarMatcher | readonly CalendarMatcher[] | undefined;
  /** Bounds for navigation and the dropdown years. */
  readonly startMonth?: CalendarDay | undefined;
  readonly endMonth?: CalendarDay | undefined;
  readonly showOutsideDays?: boolean | undefined;
  readonly showWeekNumber?: boolean | undefined;
  /** 0 is Sunday; defaults to the locale's first day. */
  readonly weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  readonly fixedWeeks?: boolean | undefined;
  readonly locale?: string | undefined;
  readonly today?: CalendarDay | undefined;
};
export interface CalendarState {
  readonly month: CalendarDay;
  readonly focused: CalendarDay | undefined;
  readonly selection: CalendarSelection['selected'];
}
/** The calendar day of a local Date. */
export const toCalendarDay = (date: Date): CalendarDay => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
  day: date.getDate(),
});
/** A local Date at midnight of a calendar day. */
export const fromCalendarDay = (day: CalendarDay) => new Date(day.year, day.month - 1, day.day);
/** Whether two calendar days are the same day; undefined never matches. */
export const sameDay = (a: CalendarDay | undefined, b: CalendarDay | undefined) =>
  !!a && !!b && a.year === b.year && a.month === b.month && a.day === b.day;
const compare = (a: CalendarDay, b: CalendarDay) =>
  a.year - b.year || a.month - b.month || a.day - b.day;
const addDays = (day: CalendarDay, count: number) => {
  const date = fromCalendarDay(day);
  date.setDate(date.getDate() + count);
  return toCalendarDay(date);
};
const addMonths = (month: CalendarDay, count: number): CalendarDay => {
  const date = new Date(month.year, month.month - 1 + count, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: 1 };
};
const daysInMonth = (month: CalendarDay) => new Date(month.year, month.month, 0).getDate();
const weekNumber = (day: CalendarDay) => {
  const date = fromCalendarDay(day);
  const thursday = new Date(date);
  thursday.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const first = new Date(thursday.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((thursday.getTime() - first.getTime()) / 86400000 - 3 + ((first.getDay() + 6) % 7)) / 7,
    )
  );
};
function matches(day: CalendarDay, matcher: CalendarMatcher): boolean {
  if (typeof matcher === 'function') return matcher(day);
  if (Array.isArray(matcher))
    return (matcher as readonly CalendarDay[]).some((other) => sameDay(day, other));
  if ('dayOfWeek' in matcher) return matcher.dayOfWeek.includes(fromCalendarDay(day).getDay());
  if ('year' in matcher) return sameDay(day, matcher as CalendarDay);
  const bounds = matcher as { before?: CalendarDay; after?: CalendarDay };
  return (
    (bounds.before !== undefined && compare(day, bounds.before) < 0) ||
    (bounds.after !== undefined && compare(day, bounds.after) > 0)
  );
}
const firstWeekDay = (locale: string | undefined) => {
  const info = (Intl.Locale.prototype as { getWeekInfo?: () => { firstDay: number } }).getWeekInfo;
  try {
    const week = info ? info.call(new Intl.Locale(locale ?? navigator.language)) : undefined;
    return week ? week.firstDay % 7 : 0;
  } catch {
    return 0;
  }
};
const selectionOf = (options: CalendarSelection) => options.selected;
const startOfSelection = (options: CalendarSelection): CalendarDay | undefined => {
  if (options.mode === 'single') return options.selected;
  if (options.mode === 'multiple') return options.selected?.[0];
  return options.selected?.from;
};
/** Create a parent-owned Calendar handle: the shown month, focus and selection shared by the grid parts. */
export function createCalendar(options: CalendarOptions) {
  const today = options.today ?? toCalendarDay(new Date());
  const initial = options.month ?? options.defaultMonth ?? startOfSelection(options) ?? today;
  const owner = modelOwner<CalendarState>({
    month: { year: initial.year, month: initial.month, day: 1 },
    focused: undefined,
    selection: selectionOf(options),
  });
  const disabled = (day: CalendarDay) => {
    const matchers =
      options.disabled === undefined
        ? []
        : Array.isArray(options.disabled) && !('year' in options.disabled)
          ? (options.disabled as readonly CalendarMatcher[])
          : [options.disabled as CalendarMatcher];
    return (
      matchers.some((matcher) => matches(day, matcher)) ||
      (options.startMonth !== undefined && compare(day, { ...options.startMonth, day: 1 }) < 0) ||
      (options.endMonth !== undefined &&
        compare(day, { ...options.endMonth, day: daysInMonth(options.endMonth) }) > 0)
    );
  };
  const setMonth = (month: CalendarDay) => {
    const next = { year: month.year, month: month.month, day: 1 };
    if (options.startMonth && compare(next, { ...options.startMonth, day: 1 }) < 0) return;
    if (options.endMonth && compare(next, { ...options.endMonth, day: 1 }) > 0) return;
    if (compare(owner.read().month, next) === 0) return;
    if (options.month === undefined) owner.patch({ month: next });
    options.onMonthChange?.(next);
  };
  const select = (day: CalendarDay) => {
    if (disabled(day)) return;
    if (options.mode === 'single') {
      const current = owner.read().selection as CalendarDay | undefined;
      const next = sameDay(current, day) && !options.required ? undefined : day;
      if (options.selected === undefined) owner.patch({ selection: next });
      options.onSelect?.(next);
    } else if (options.mode === 'multiple') {
      const current = (owner.read().selection as readonly CalendarDay[] | undefined) ?? [];
      const present = current.some((other) => sameDay(other, day));
      if (present && options.min !== undefined && current.length <= options.min) return;
      if (!present && options.max !== undefined && current.length >= options.max) return;
      const next = present ? current.filter((other) => !sameDay(other, day)) : [...current, day];
      if (options.selected === undefined) owner.patch({ selection: next });
      options.onSelect?.(next);
    } else {
      const current = (owner.read().selection as CalendarRange | undefined) ?? {
        from: undefined,
        to: undefined,
      };
      let next: CalendarRange;
      if (!current.from || current.to) next = { from: day, to: undefined };
      else if (compare(day, current.from) < 0) next = { from: day, to: current.from };
      else if (sameDay(day, current.from)) next = { from: undefined, to: undefined };
      else next = { from: current.from, to: day };
      if (next.from && next.to) {
        const length =
          Math.round(
            (fromCalendarDay(next.to).getTime() - fromCalendarDay(next.from).getTime()) / 86400000,
          ) + 1;
        if (options.min !== undefined && length < options.min) return;
        if (options.max !== undefined && length > options.max) return;
      }
      if (options.selected === undefined) owner.patch({ selection: next });
      options.onSelect?.(next);
    }
  };
  const focus = (day: CalendarDay) => {
    owner.patch({ focused: day });
    const month = owner.read().month;
    const count = options.numberOfMonths ?? 1;
    const last = addMonths(month, count - 1);
    if (compare({ ...day, day: 1 }, month) < 0) setMonth(day);
    else if (compare({ ...day, day: 1 }, last) > 0) setMonth(addMonths(day, 1 - count));
  };
  return {
    source: owner.source,
    lifetime: owner,
    options,
    today,
    weekStartsOn: options.weekStartsOn ?? firstWeekDay(options.locale),
    disabled,
    select,
    setMonth,
    previousMonth: () => setMonth(addMonths(owner.read().month, -1)),
    nextMonth: () => setMonth(addMonths(owner.read().month, 1)),
    focus,
    /** Move focus by days, weeks, months or years from the focused or first selected day. */
    moveFocus(unit: 'day' | 'week' | 'month' | 'year', count: number) {
      const from = owner.read().focused ?? startOfSelection(options) ?? today;
      const next =
        unit === 'day'
          ? addDays(from, count)
          : unit === 'week'
            ? addDays(from, count * 7)
            : unit === 'month'
              ? {
                  ...addMonths(from, count),
                  day: Math.min(from.day, daysInMonth(addMonths(from, count))),
                }
              : {
                  ...from,
                  year: from.year + count,
                  day: Math.min(from.day, daysInMonth({ ...from, year: from.year + count })),
                };
      focus(next);
    },
    sync(next: Partial<Pick<CalendarOptions, 'month' | 'selected'>>) {
      if (next.month) owner.patch({ month: { ...next.month, day: 1 } });
      if ('selected' in next)
        owner.patch({ selection: next.selected as CalendarState['selection'] });
    },
  };
}
export type CalendarHandle = ReturnType<typeof createCalendar>;
/** The weeks of a month as rows of days, including outside days to fill the grid. */
export function monthGrid(month: CalendarDay, weekStartsOn: number, fixedWeeks = false) {
  const first = fromCalendarDay({ ...month, day: 1 });
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const start = addDays({ ...month, day: 1 }, -lead);
  const total = daysInMonth(month);
  const weeks = fixedWeeks ? 6 : Math.ceil((lead + total) / 7);
  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, index) => addDays(start, week * 7 + index)),
  );
}
const dayState = (handle: CalendarHandle, day: CalendarDay) => {
  const options = handle.options;
  const selection = handle.source.model().selection;
  if (options.mode === 'single')
    return {
      selected: sameDay(selection as CalendarDay | undefined, day),
      rangeStart: false,
      rangeEnd: false,
      rangeMiddle: false,
    };
  if (options.mode === 'multiple')
    return {
      selected: ((selection as readonly CalendarDay[] | undefined) ?? []).some((other) =>
        sameDay(other, day),
      ),
      rangeStart: false,
      rangeEnd: false,
      rangeMiddle: false,
    };
  const range = (selection as CalendarRange | undefined) ?? { from: undefined, to: undefined };
  const rangeStart = sameDay(range.from, day);
  const rangeEnd = sameDay(range.to, day);
  const rangeMiddle =
    !!range.from && !!range.to && compare(day, range.from) > 0 && compare(day, range.to) < 0;
  return {
    selected: rangeStart || rangeEnd || rangeMiddle,
    rangeStart: rangeStart && !!range.to && !rangeEnd,
    rangeEnd: rangeEnd && !rangeStart,
    rangeMiddle,
  };
};
export interface CalendarProps extends Native<'div'>, Styled {
  readonly calendar: CalendarHandle;
  readonly captionLayout?: 'label' | 'dropdown' | 'dropdown-months' | 'dropdown-years' | undefined;
  readonly buttonVariant?: Parameters<typeof buttonVariants>[0] extends infer P
    ? P extends { variant?: infer V }
      ? V
      : never
    : never;
}
const monthName = (locale: string | undefined, month: CalendarDay, style: 'long' | 'short') =>
  new Intl.DateTimeFormat(locale, {
    month: style,
    year: style === 'long' ? 'numeric' : undefined,
  }).format(fromCalendarDay(month));
/** A month grid with navigation, selection and keyboard movement, styled like shadcn's calendar. */
export const Calendar = view<CalendarProps>(
  ({
    calendar,
    captionLayout = 'label',
    buttonVariant = 'ghost',
    class: className,
    onKeyDown,
    ...rest
  }) =>
    observe(calendar.source, (state) => {
      const options = calendar.options;
      const locale = options.locale;
      const months = Array.from({ length: options.numberOfMonths ?? 1 }, (_, index) =>
        addMonths(state.month, index),
      );
      const weekdayNames = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(2023, 0, 1 + ((calendar.weekStartsOn + index) % 7));
        return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
      });
      const years = (() => {
        const start = options.startMonth?.year ?? state.month.year - 100;
        const end = options.endMonth?.year ?? state.month.year + 10;
        return Array.from({ length: end - start + 1 }, (_, index) => start + index);
      })();
      const dropdownMonths = captionLayout === 'dropdown' || captionLayout === 'dropdown-months';
      const dropdownYears = captionLayout === 'dropdown' || captionLayout === 'dropdown-years';
      return (
        <div
          data-slot="calendar"
          class={cn(
            'group/calendar w-fit bg-background p-3 [--cell-size:--spacing(8)] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent',
            className,
          )}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented) return;
            const moves: Record<string, ['day' | 'week' | 'month' | 'year', number]> = {
              ArrowLeft: ['day', -1],
              ArrowRight: ['day', 1],
              ArrowUp: ['week', -1],
              ArrowDown: ['week', 1],
              PageUp: [event.shiftKey ? 'year' : 'month', -1],
              PageDown: [event.shiftKey ? 'year' : 'month', 1],
            };
            const move = moves[event.key];
            if (move) {
              event.preventDefault();
              calendar.moveFocus(move[0], move[1]);
              return;
            }
            if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              const from = state.focused ?? calendar.today;
              const offset = (fromCalendarDay(from).getDay() - calendar.weekStartsOn + 7) % 7;
              calendar.focus(addDays(from, event.key === 'Home' ? -offset : 6 - offset));
            }
          }}
          {...rest}
        >
          <div class="relative flex flex-col gap-4 md:flex-row">
            <div class="absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1">
              <button
                type="button"
                aria-label="Previous month"
                class={cn(
                  buttonVariants({ variant: buttonVariant }),
                  'size-(--cell-size) p-0 select-none aria-disabled:opacity-50',
                )}
                onClick={() => calendar.previousMonth()}
              >
                <ChevronLeft class="size-4 rtl:rotate-180" />
              </button>
              <button
                type="button"
                aria-label="Next month"
                class={cn(
                  buttonVariants({ variant: buttonVariant }),
                  'size-(--cell-size) p-0 select-none aria-disabled:opacity-50',
                )}
                onClick={() => calendar.nextMonth()}
              >
                <ChevronRight class="size-4 rtl:rotate-180" />
              </button>
            </div>
            {list(
              months,
              (month) => `${month.year}-${month.month}`,
              (month, monthIndex) => {
                const grid = monthGrid(month, calendar.weekStartsOn, options.fixedWeeks);
                const first = monthIndex === 0;
                return (
                  <div
                    class="flex w-full flex-col gap-4"
                    data-month={`${month.year}-${month.month}`}
                  >
                    <div class="flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)">
                      {first && (dropdownMonths || dropdownYears) ? (
                        <div class="flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium">
                          {dropdownMonths ? (
                            <span class="relative flex h-8 items-center gap-1 rounded-md border border-input pr-1 pl-2 text-sm shadow-xs has-focus:border-ring has-focus:ring-[3px] has-focus:ring-ring/50">
                              {monthName(locale, month, 'short')}
                              <ChevronDown class="size-3.5 text-muted-foreground" />
                              <select
                                aria-label="Month"
                                class="absolute inset-0 opacity-0"
                                value={String(month.month)}
                                onChange={(event) =>
                                  calendar.setMonth({
                                    ...month,
                                    month: Number(event.currentTarget.value),
                                  })
                                }
                              >
                                {list(
                                  sequence(Array.from({ length: 12 }, (_, index) => index + 1)),
                                  (value) => (
                                    <option value={String(value)}>
                                      {monthName(
                                        locale,
                                        { year: month.year, month: value, day: 1 },
                                        'short',
                                      )}
                                    </option>
                                  ),
                                )}
                              </select>
                            </span>
                          ) : (
                            <span>{monthName(locale, month, 'short')}</span>
                          )}
                          {dropdownYears ? (
                            <span class="relative flex h-8 items-center gap-1 rounded-md border border-input pr-1 pl-2 text-sm shadow-xs has-focus:border-ring has-focus:ring-[3px] has-focus:ring-ring/50">
                              {month.year}
                              <ChevronDown class="size-3.5 text-muted-foreground" />
                              <select
                                aria-label="Year"
                                class="absolute inset-0 opacity-0"
                                value={String(month.year)}
                                onChange={(event) =>
                                  calendar.setMonth({
                                    ...month,
                                    year: Number(event.currentTarget.value),
                                  })
                                }
                              >
                                {list(sequence(years), (year) => (
                                  <option value={String(year)}>{String(year)}</option>
                                ))}
                              </select>
                            </span>
                          ) : (
                            <span>{month.year}</span>
                          )}
                        </div>
                      ) : (
                        <span class="text-sm font-medium select-none" aria-live="polite">
                          {monthName(locale, month, 'long')}
                        </span>
                      )}
                    </div>
                    <table
                      class="w-full border-collapse"
                      role="grid"
                      aria-label={monthName(locale, month, 'long')}
                    >
                      <thead>
                        <tr class="flex">
                          {options.showWeekNumber ? (
                            <th class="w-(--cell-size) select-none" aria-label="Week number" />
                          ) : null}
                          {list(sequence(weekdayNames), (name) => (
                            <th
                              class="flex-1 rounded-md text-[0.8rem] font-normal text-muted-foreground select-none"
                              scope="col"
                            >
                              {name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {list(
                          grid,
                          (week) => `${week[0]!.year}-${week[0]!.month}-${week[0]!.day}`,
                          (week) => (
                            <tr class="mt-2 flex w-full">
                              {options.showWeekNumber ? (
                                <td class="text-[0.8rem] text-muted-foreground select-none">
                                  <div class="flex size-(--cell-size) items-center justify-center text-center">
                                    {String(weekNumber(week[0]!))}
                                  </div>
                                </td>
                              ) : null}
                              {list(
                                week,
                                (day) => `${day.year}-${day.month}-${day.day}`,
                                (day) => {
                                  const outside =
                                    day.month !== month.month || day.year !== month.year;
                                  if (outside && options.showOutsideDays === false)
                                    return (
                                      <td class="group/day relative aspect-square h-full w-full p-0" />
                                    );
                                  const info = dayState(calendar, day);
                                  const isDisabled = calendar.disabled(day);
                                  const focused = sameDay(state.focused, day);
                                  const isToday = sameDay(calendar.today, day);
                                  const single =
                                    info.selected &&
                                    !info.rangeStart &&
                                    !info.rangeEnd &&
                                    !info.rangeMiddle;
                                  return (
                                    <td
                                      class={cn(
                                        'group/day relative aspect-square h-full w-full p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-md',
                                        options.showWeekNumber
                                          ? '[&:nth-child(2)[data-selected=true]_button]:rounded-l-md'
                                          : '[&:first-child[data-selected=true]_button]:rounded-l-md',
                                        info.rangeStart && 'rounded-l-md bg-accent',
                                        info.rangeMiddle && 'rounded-none',
                                        info.rangeEnd && 'rounded-r-md bg-accent',
                                        isToday &&
                                          'rounded-md bg-accent text-accent-foreground data-[selected=true]:rounded-none',
                                        outside &&
                                          'text-muted-foreground aria-selected:text-muted-foreground',
                                        isDisabled && 'text-muted-foreground opacity-50',
                                      )}
                                      data-selected={info.selected ? 'true' : undefined}
                                      data-focused={focused ? 'true' : undefined}
                                      data-today={isToday ? 'true' : undefined}
                                      data-outside={outside ? 'true' : undefined}
                                      role="gridcell"
                                      aria-selected={info.selected ? 'true' : undefined}
                                    >
                                      <button
                                        type="button"
                                        tabindex={
                                          focused ||
                                          (!state.focused &&
                                            (single ||
                                              (!info.selected && day.day === 1 && !outside)))
                                            ? 0
                                            : -1
                                        }
                                        disabled={isDisabled}
                                        aria-disabled={isDisabled ? 'true' : undefined}
                                        aria-label={new Intl.DateTimeFormat(locale, {
                                          dateStyle: 'long',
                                        }).format(fromCalendarDay(day))}
                                        data-day={`${day.year}-${day.month}-${day.day}`}
                                        data-selected-single={single ? 'true' : undefined}
                                        data-range-start={info.rangeStart ? 'true' : undefined}
                                        data-range-end={info.rangeEnd ? 'true' : undefined}
                                        data-range-middle={info.rangeMiddle ? 'true' : undefined}
                                        use={focused ? focusWhenMounted : undefined}
                                        class={cn(
                                          buttonVariants({ variant: 'ghost', size: 'icon' }),
                                          'flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-ring/50 data-[range-end=true]:rounded-md data-[range-end=true]:rounded-r-md data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:rounded-md data-[range-start=true]:rounded-l-md data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground dark:hover:text-accent-foreground [&>span]:text-xs [&>span]:opacity-70',
                                        )}
                                        onClick={() => {
                                          calendar.focus(day);
                                          calendar.select(day);
                                        }}
                                      >
                                        {String(day.day)}
                                      </button>
                                    </td>
                                  );
                                },
                              )}
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              },
            )}
          </div>
        </div>
      );
    }),
);
const focusWhenMounted = domMount((element: HTMLButtonElement) => {
  if (
    element.ownerDocument.activeElement?.closest('[data-slot=calendar]') ===
    element.closest('[data-slot=calendar]')
  )
    element.focus();
});
