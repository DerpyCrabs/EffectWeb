import { view } from 'effectweb';
import LoaderCircle from '@effectweb/lucide/icons/loader-circle';
import { cn } from './cn.js';

/** An animated SVG status icon with a configurable accessible label. */
export const Spinner = view<{
  readonly class?: string | undefined;
  readonly label?: string | undefined;
}>((props) => (
  <LoaderCircle
    data-slot="spinner"
    role="status"
    aria-label={props.label ?? 'Loading'}
    class={cn('size-4 animate-spin', props.class)}
  />
));
