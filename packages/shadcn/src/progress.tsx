import { ProgressRoot, ProgressTrack, ProgressIndicator } from '@effectweb/base-ui';
import { view } from 'effectweb';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

/** A determinate bar: `value` from 0 to `max` (100 by default); null shows an indeterminate pulse. */
export const Progress = view<
  Native<'div'> &
    Styled & {
      readonly value: number | null;
      readonly max?: number | undefined;
      readonly label?: string | undefined;
      readonly showValue?: boolean | undefined;
    }
>(({ class: className, value, max, label, showValue, children, ...rest }) => {
  const top = max ?? 100;
  const percent = value === null ? null : Math.max(0, Math.min(100, (value / top) * 100));
  return (
    <ProgressRoot
      value={value}
      max={top}
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={top}
      aria-valuenow={value ?? undefined}
      aria-label={label}
      class={cn('flex flex-wrap gap-3', className)}
      {...rest}
    >
      {label ? (
        <span class="text-sm font-medium" data-slot="progress-label">
          {label}
        </span>
      ) : null}
      {showValue && percent !== null ? (
        <span class="ml-auto text-sm text-muted-foreground tabular-nums" data-slot="progress-value">
          {Math.round(percent)}%
        </span>
      ) : null}
      {children}
      <ProgressTrack
        class="relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted"
        data-slot="progress-track"
      >
        <ProgressIndicator
          data-slot="progress-indicator"
          class={cn('h-full bg-primary transition-all', percent === null && 'w-1/3 animate-pulse')}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </ProgressTrack>
    </ProgressRoot>
  );
});
