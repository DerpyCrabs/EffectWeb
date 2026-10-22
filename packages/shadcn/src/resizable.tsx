import GripVertical from '@effectweb/lucide/icons/grip-vertical';
import { domBinding, list, modelOwner, observe, sequence, view, type JSX } from 'effectweb';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

export interface ResizablePanelOptions {
  readonly id: string;
  /** Percent of the group; the remainder is shared by panels without one. */
  readonly defaultSize?: number | undefined;
  readonly minSize?: number | undefined;
  readonly maxSize?: number | undefined;
}
export interface ResizableOptions {
  readonly direction?: 'horizontal' | 'vertical' | undefined;
  readonly panels: readonly ResizablePanelOptions[];
  /** Called with the sizes by id after a drag or keyboard change. */
  readonly onLayout?: ((sizes: Readonly<Record<string, number>>) => void) | undefined;
}
export interface ResizableState {
  readonly direction: 'horizontal' | 'vertical';
  readonly sizes: Readonly<Record<string, number>>;
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
function initialSizes(panels: readonly ResizablePanelOptions[]) {
  const fixed = panels.filter((panel) => panel.defaultSize !== undefined);
  const used = fixed.reduce((sum, panel) => sum + panel.defaultSize!, 0);
  const rest = panels.length - fixed.length;
  const share = rest ? Math.max(0, 100 - used) / rest : 0;
  return Object.fromEntries(panels.map((panel) => [panel.id, panel.defaultSize ?? share]));
}
/** Create a parent-owned handle for a group of resizable panels; the group, panels and handles share it. */
export function createResizable(options: ResizableOptions) {
  const owner = modelOwner<ResizableState>({
    direction: options.direction ?? 'horizontal',
    sizes: initialSizes(options.panels),
  });
  const bounds = (id: string) => {
    const panel = options.panels.find((candidate) => candidate.id === id);
    return { min: panel?.minSize ?? 0, max: panel?.maxSize ?? 100 };
  };
  const neighbours = (handleIndex: number) => {
    const before = options.panels[handleIndex];
    const after = options.panels[handleIndex + 1];
    return before && after ? ([before.id, after.id] as const) : undefined;
  };
  return {
    source: owner.source,
    lifetime: owner,
    panels: options.panels,
    /** Grow the panel before a handle by `delta` percent, shrinking the one after it. */
    resize(handleIndex: number, delta: number) {
      const pair = neighbours(handleIndex);
      if (!pair) return;
      const [first, second] = pair;
      const sizes = owner.read().sizes;
      const total = sizes[first]! + sizes[second]!;
      const a = bounds(first);
      const b = bounds(second);
      const next = clamp(
        sizes[first]! + delta,
        Math.max(a.min, total - b.max),
        Math.min(a.max, total - b.min),
      );
      if (next === sizes[first]) return;
      const updated = { ...sizes, [first]: next, [second]: total - next };
      owner.patch({ sizes: updated });
      options.onLayout?.(updated);
    },
    setSizes(sizes: Readonly<Record<string, number>>) {
      owner.patch({ sizes: { ...owner.read().sizes, ...sizes } });
      options.onLayout?.(owner.read().sizes);
    },
  };
}
export type ResizableHandle = ReturnType<typeof createResizable>;
/** The container of panels and handles, laid out along `direction`. */
export const ResizablePanelGroup = view<
  Native<'div'> & Styled & { readonly resizable: ResizableHandle }
>(({ resizable, class: className, children, ...rest }) =>
  observe(resizable.source, (state) => (
    <div
      data-slot="resizable-panel-group"
      data-resizable-group=""
      aria-orientation={state.direction}
      class={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
      {...rest}
    >
      {children}
    </div>
  )),
);
/** A panel sized from the handle; its `id` matches the group's panel options. */
export const ResizablePanel = view<
  Native<'div'> & Styled & { readonly resizable: ResizableHandle; readonly id: string }
>(({ resizable, id, class: className, children, ...rest }) =>
  observe(resizable.source, (state) => (
    <div
      data-slot="resizable-panel"
      data-panel-id={id}
      class={cn('min-w-0 min-h-0 overflow-hidden', className)}
      style={{ flex: `${state.sizes[id] ?? 0} 1 0px` }}
      {...rest}
    >
      {children}
    </div>
  )),
);
const acquireDrag = (
  element: HTMLElement,
  current: () => { readonly resizable: ResizableHandle; readonly index: number },
) => {
  let last = 0;
  const move = (event: PointerEvent) => {
    const { resizable, index } = current();
    const group = element.closest<HTMLElement>('[data-resizable-group]');
    if (!group) return;
    const vertical = resizable.source.model().direction === 'vertical';
    const extent = vertical ? group.clientHeight : group.clientWidth;
    const position = vertical ? event.clientY : event.clientX;
    if (!extent) return;
    resizable.resize(index, ((position - last) / extent) * 100);
    last = position;
  };
  const up = () => {
    element.removeAttribute('data-resize-handle-active');
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', up);
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const vertical = current().resizable.source.model().direction === 'vertical';
    last = vertical ? event.clientY : event.clientX;
    element.setPointerCapture(event.pointerId);
    element.setAttribute('data-resize-handle-active', 'pointer');
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
  };
  element.addEventListener('pointerdown', down);
  return () => {
    up();
    element.removeEventListener('pointerdown', down);
  };
};
/** The draggable separator between two panels; arrows move it by one percent, Shift by ten. */
export const ResizableHandle = view<
  Native<'div'> &
    Styled & {
      readonly resizable: ResizableHandle;
      /** The position of the handle: between panels `index` and `index + 1`. */
      readonly index: number;
      readonly withHandle?: boolean | undefined;
    }
>(({ resizable, index, withHandle, class: className, onKeyDown, ...rest }) =>
  observe(resizable.source, (state) => {
    const before = resizable.panels[index];
    const after = resizable.panels[index + 1];
    const size = before ? (state.sizes[before.id] ?? 0) : 0;
    return (
      <div
        data-slot="resizable-handle"
        role="separator"
        tabindex={0}
        aria-orientation={state.direction === 'vertical' ? 'horizontal' : 'vertical'}
        aria-valuenow={Math.round(size)}
        aria-valuemin={before?.minSize ?? 0}
        aria-valuemax={before?.maxSize ?? 100}
        aria-controls={before && after ? `${before.id} ${after.id}` : undefined}
        use={domBinding({ resizable, index }, acquireDrag)}
        class={cn(
          'relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90',
          state.direction === 'vertical' ? 'cursor-row-resize' : 'cursor-col-resize',
          className,
        )}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          const step = event.shiftKey ? 10 : 1;
          const vertical = state.direction === 'vertical';
          const grow = vertical ? 'ArrowDown' : 'ArrowRight';
          const shrink = vertical ? 'ArrowUp' : 'ArrowLeft';
          if (event.key === grow) resizable.resize(index, step);
          else if (event.key === shrink) resizable.resize(index, -step);
          else if (event.key === 'Home') resizable.resize(index, -100);
          else if (event.key === 'End') resizable.resize(index, 100);
          else return;
          event.preventDefault();
        }}
        {...rest}
      >
        {withHandle ? (
          <div class="z-10 flex h-4 w-3 items-center justify-center rounded-xs border bg-border">
            <GripVertical class="size-2.5" />
          </div>
        ) : null}
      </div>
    );
  }),
);
/** Panels and handles for a list of panel options, for the common layout. */
export const ResizableLayout = view<{
  readonly resizable: ResizableHandle;
  readonly withHandle?: boolean | undefined;
  readonly render: (id: string) => JSX.Element;
}>(({ resizable, withHandle, render }) =>
  list(sequence(resizable.panels.map((panel) => panel.id)), (id, index) => (
    <>
      {index > 0 ? (
        <ResizableHandle resizable={resizable} index={index - 1} withHandle={withHandle} />
      ) : null}
      <ResizablePanel resizable={resizable} id={id}>
        {render(id)}
      </ResizablePanel>
    </>
  )),
);
