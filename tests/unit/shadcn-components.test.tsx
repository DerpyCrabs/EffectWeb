// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { mount, view } from 'effectweb';
import { ButtonGroup, ButtonGroupSeparator } from '@effectweb/shadcn';
import { Button } from '@effectweb/shadcn';
import { Calendar, createCalendar, monthGrid, type CalendarDay } from '@effectweb/shadcn';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  createCarousel,
} from '@effectweb/shadcn';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  commandScore,
  createCommand,
} from '@effectweb/shadcn';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@effectweb/shadcn';
import { createResizable, ResizableLayout, ResizablePanelGroup } from '@effectweb/shadcn';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  document.body.replaceChildren();
});
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const render = (element: ReturnType<typeof view>) => {
  const host = document.body.appendChild(document.createElement('div'));
  const rendered = mount(host, element as never, { model: () => ({}), subscribe: () => () => {} });
  cleanup.push(() => rendered.dispose());
  return host;
};

it('a button group joins buttons and separators', async () => {
  const host = render(
    view(() => (
      <ButtonGroup orientation="vertical">
        <Button>One</Button>
        <ButtonGroupSeparator />
        <Button>Two</Button>
      </ButtonGroup>
    )),
  );
  await tick();
  const group = host.querySelector('[data-slot=button-group]')!;
  expect(group.getAttribute('role')).toBe('group');
  expect(group.getAttribute('data-orientation')).toBe('vertical');
  expect(
    host.querySelector('[data-slot=button-group-separator]')!.getAttribute('data-orientation'),
  ).toBe('vertical');
});

it('an OTP input renders its slots and submits the code under its name', async () => {
  const values: string[] = [];
  const host = render(
    view(() => (
      <InputOTP length={4} name="code" onValueChange={(value) => values.push(value)}>
        {(otp) => (
          <InputOTPGroup>
            <InputOTPSlot otp={otp} index={0} />
            <InputOTPSlot otp={otp} index={1} />
            <InputOTPSlot otp={otp} index={2} />
            <InputOTPSlot otp={otp} index={3} />
          </InputOTPGroup>
        )}
      </InputOTP>
    )),
  );
  await tick();
  await tick();
  const slots = [...host.querySelectorAll<HTMLInputElement>('[data-slot=input-otp-slot]')];
  expect(slots).toHaveLength(4);
  slots[0]!.value = '7';
  slots[0]!.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
  expect(values).toEqual(['7']);
  expect(host.querySelector<HTMLInputElement>('input[name=code]')!.value).toBe('7');
});

it('a command palette filters items, hides empty groups, and moves the highlight', async () => {
  const chosen: string[] = [];
  const command = createCommand();
  cleanup.push(() => command.lifetime.dispose());
  const host = render(
    view(() => (
      <Command command={command}>
        <CommandInput command={command} placeholder="Search" />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup heading="Files">
            <CommandItem command={command} value="open" select={(value) => chosen.push(value)}>
              Open file
            </CommandItem>
            <CommandItem
              command={command}
              value="save"
              keywords={['persist']}
              select={(value) => chosen.push(value)}
            >
              Save
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="View">
            <CommandItem command={command} value="zoom" select={(value) => chosen.push(value)}>
              Zoom
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    )),
  );
  await tick();
  await tick();
  await tick();
  const items = () => [...host.querySelectorAll<HTMLElement>('[data-slot=command-item]')];
  const groups = () => [...host.querySelectorAll<HTMLElement>('[data-slot=command-group]')];
  const empty = host.querySelector<HTMLElement>('[data-slot=command-empty]')!;
  expect(items().map((item) => item.hidden)).toEqual([false, false, false]);
  expect(items()[0]!.dataset.selected).toBe('true');
  expect(empty.hidden).toBe(true);
  command.setSearch('pers');
  await tick();
  await tick();
  expect(items().map((item) => item.hidden)).toEqual([true, false, true]);
  expect(groups().map((group) => group.hidden)).toEqual([false, true]);
  expect(command.source.model().value).toBe('save');
  command.setSearch('nothing here');
  await tick();
  await tick();
  expect(empty.hidden).toBe(false);
  expect(command.source.model().count).toBe(0);
  command.setSearch('');
  await tick();
  await tick();
  const root = host.querySelector<HTMLElement>('[data-slot=command]')!;
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await tick();
  await tick();
  expect(command.source.model().value).toBe('zoom');
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(chosen).toEqual(['zoom']);
  expect(commandScore('Open file', 'opn')).toBeGreaterThan(0);
  expect(commandScore('Open file', 'xyz')).toBe(0);
});

it('resizable panels share space within their bounds by keyboard and pointer', async () => {
  const layouts: Record<string, number>[] = [];
  const resizable = createResizable({
    panels: [
      { id: 'left', minSize: 20 },
      { id: 'right', maxSize: 70 },
    ],
    onLayout: (sizes) => layouts.push({ ...sizes }),
  });
  cleanup.push(() => resizable.lifetime.dispose());
  const host = render(
    view(() => (
      <ResizablePanelGroup resizable={resizable}>
        <ResizableLayout resizable={resizable} render={(id) => <span>{id}</span>} />
      </ResizablePanelGroup>
    )),
  );
  await tick();
  await tick();
  expect(resizable.source.model().sizes).toEqual({ left: 50, right: 50 });
  const handle = host.querySelector<HTMLElement>('[data-slot=resizable-handle]')!;
  expect(handle.getAttribute('aria-orientation')).toBe('vertical');
  handle.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
  );
  expect(resizable.source.model().sizes).toEqual({ left: 60, right: 40 });
  handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  expect(resizable.source.model().sizes).toEqual({ left: 30, right: 70 });
  expect(layouts.at(-1)).toEqual({ left: 30, right: 70 });
  await tick();
  const left = host.querySelector<HTMLElement>('[data-panel-id=left]')!;
  expect(left.style.flex).toContain('30');
});

it('a carousel tracks its slides and the buttons move between them', async () => {
  const selected: number[] = [];
  const carousel = createCarousel({ onSelect: (index) => selected.push(index) });
  cleanup.push(() => carousel.lifetime.dispose());
  const host = render(
    view(() => (
      <Carousel carousel={carousel}>
        <CarouselContent carousel={carousel}>
          <CarouselItem carousel={carousel}>One</CarouselItem>
          <CarouselItem carousel={carousel}>Two</CarouselItem>
          <CarouselItem carousel={carousel}>Three</CarouselItem>
        </CarouselContent>
        <CarouselPrevious carousel={carousel} />
        <CarouselNext carousel={carousel} />
      </Carousel>
    )),
  );
  await tick();
  await tick();
  expect(carousel.source.model()).toMatchObject({
    index: 0,
    count: 3,
    canScrollPrev: false,
    canScrollNext: true,
  });
  host.querySelector<HTMLButtonElement>('[data-slot=carousel-next]')!.click();
  expect(carousel.source.model().index).toBe(1);
  host.querySelector<HTMLButtonElement>('[data-slot=carousel-next]')!.click();
  host.querySelector<HTMLButtonElement>('[data-slot=carousel-next]')!.click();
  expect(carousel.source.model()).toMatchObject({ index: 2, canScrollNext: false });
  host.querySelector<HTMLButtonElement>('[data-slot=carousel-previous]')!.click();
  expect(selected).toEqual([1, 2, 1]);
});

it('a calendar lays out months, selects by mode and navigates by keyboard', async () => {
  const grid = monthGrid({ year: 2026, month: 10, day: 1 }, 1);
  expect(grid[0]!.map((day) => day.day)).toEqual([28, 29, 30, 1, 2, 3, 4]);
  const picks: (CalendarDay | undefined)[] = [];
  const calendar = createCalendar({
    mode: 'single',
    defaultMonth: { year: 2026, month: 10, day: 1 },
    today: { year: 2026, month: 10, day: 21 },
    weekStartsOn: 1,
    disabled: { before: { year: 2026, month: 10, day: 5 } },
    onSelect: (day) => picks.push(day),
  });
  cleanup.push(() => calendar.lifetime.dispose());
  const host = render(view(() => <Calendar calendar={calendar} />));
  await tick();
  await tick();
  const button = (day: string) => host.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)!;
  expect(host.querySelector('[aria-live=polite]')!.textContent).toContain('2026');
  expect(button('2026-10-3').disabled).toBe(true);
  expect(button('2026-10-21').closest('td')!.dataset.today).toBe('true');
  button('2026-10-9').click();
  await tick();
  expect(picks).toEqual([{ year: 2026, month: 10, day: 9 }]);
  expect(button('2026-10-9').dataset.selectedSingle).toBe('true');
  const root = host.querySelector<HTMLElement>('[data-slot=calendar]')!;
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await tick();
  expect(calendar.source.model().focused).toEqual({ year: 2026, month: 10, day: 16 });
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
  await tick();
  expect(calendar.source.model().month).toEqual({ year: 2026, month: 11, day: 1 });
  host.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!.click();
  expect(calendar.source.model().month).toEqual({ year: 2026, month: 10, day: 1 });
  const range = createCalendar({ mode: 'range', defaultMonth: { year: 2026, month: 10, day: 1 } });
  cleanup.push(() => range.lifetime.dispose());
  range.select({ year: 2026, month: 10, day: 10 });
  range.select({ year: 2026, month: 10, day: 3 });
  expect(range.source.model().selection).toEqual({
    from: { year: 2026, month: 10, day: 3 },
    to: { year: 2026, month: 10, day: 10 },
  });
  const multiple = createCalendar({
    mode: 'multiple',
    max: 1,
    defaultMonth: { year: 2026, month: 10, day: 1 },
  });
  cleanup.push(() => multiple.lifetime.dispose());
  multiple.select({ year: 2026, month: 10, day: 1 });
  multiple.select({ year: 2026, month: 10, day: 2 });
  expect(multiple.source.model().selection).toEqual([{ year: 2026, month: 10, day: 1 }]);
});
