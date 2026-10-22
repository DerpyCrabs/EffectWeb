DOM measurements can force layout when another binding has just changed the page. Use the DOM binding's lifetime when independent elements need to measure geometry and then publish state or change styles.

```tsx check
import { domBinding, view, type DomLifetime } from 'effectweb';

type SizeInput = { setWidth: (width: number) => void };
const trackWidth = (element: HTMLDivElement, input: () => SizeInput, lifetime: DomLifetime) => {
  const measurement = lifetime.measure({
    read: () => element.getBoundingClientRect().width,
    write: (width) => input().setWidth(width),
  });
  const observer = new ResizeObserver(measurement.schedule);
  observer.observe(element);
  measurement.schedule();
  return { update: measurement.schedule, dispose: () => observer.disconnect() };
};
export const Width = view<SizeInput>((props) => <div use={domBinding(props, trackWidth)} />);
```

The third setup argument of `domBinding`, or second of `domMount`, owns the measurement. Call `schedule()` when geometry may have changed. Repeated requests coalesce into one animation frame. All participating bindings in the same owning Window read before any of them write; separate windows have separate queues. This coordinates only opted-in measurements, not arbitrary browser callbacks or DOM work.

Keep `read` synchronous and free of DOM writes or state publications. Return the measured value for `write`. A write must not measure layout again: if its mutation requires a second measurement, schedule a later frame. Neither callback may return a Promise. Create measurements during setup, not in view bodies or on every update.

`cancel()` discards pending work without ending the measurement; it can be scheduled again. Replacement or disposal of the binding automatically cancels its measurements, including results already read but not yet written. Scheduling, cancelling or changing binding data while a result is waiting invalidates that result. Changing data reschedules a pending measurement to read the latest input. Scheduling from a read or write runs in a later frame. An idle measurement does not run merely because data changed: return `update: measurement.schedule` when updates should trigger measurement.

Read and write failures are reported through the binding's existing error handler after the batch; other measurements still finish. Owned measurements are cancelled before user cleanup, even if cleanup throws. Observers and event listeners remain ordinary binding resources: disconnect them in `dispose` as shown above.

This is intended for size-dependent layout, overflow decisions and anchored controls. It is not a replacement for CSS layout, `ResizeObserver`, immediate event handling or animation sequencing. Deferring an immediate focus or pointer gesture until a frame can change behavior. For animations that intentionally measure both before and after a mutation, represent those as distinct frames instead of placing both measurements in one `write`.
