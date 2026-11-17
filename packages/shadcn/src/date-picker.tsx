import { view, type JSX } from 'effectweb';
import { Calendar, type CalendarProps } from './calendar.js';
import { Popover, type PopoverProps } from './popover.js';
/** A calendar in a popover, with a caller-owned selection handle and trigger. */
export const DatePicker = view<
  CalendarProps & Pick<PopoverProps, 'open' | 'onOpenChange'> & { trigger: JSX.Element }
>(({ open, onOpenChange, trigger, ...calendar }) => (
  <Popover open={open} onOpenChange={onOpenChange} trigger={trigger}>
    <Calendar {...calendar} />
  </Popover>
));
