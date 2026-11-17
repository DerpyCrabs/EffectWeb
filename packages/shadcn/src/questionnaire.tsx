import { composeMounts, domBinding, view, viewWindow } from 'effectweb';
import { cn } from './cn.js';
import { Button } from './button.js';
import { Input } from './input.js';
import type { Native, Styled } from './types.js';

type QuestionnaireProps = Native<'form'> &
  Styled & {
    readonly onComplete?: ((answers: FormData) => void) | undefined;
    readonly onStepChange?: ((index: number) => void) | undefined;
  };
function acquireSteps(form: HTMLFormElement, current: () => QuestionnaireProps) {
  const win = viewWindow(form);
  const items = () =>
    [...form.querySelectorAll<HTMLFieldSetElement>('[data-slot="questionnaire-item"]')].filter(
      (item) => item.form === form,
    );
  let index = 0;
  const display = () => {
    const steps = items();
    index = Math.max(0, Math.min(index, steps.length - 1));
    for (const [i, step] of steps.entries()) step.hidden = i !== index;
    for (const progress of form.querySelectorAll('[data-slot="questionnaire-progress"]')) {
      const text = steps.length ? `${index + 1} / ${steps.length}` : '';
      if (progress.textContent !== text) progress.textContent = text;
    }
    for (const button of form.querySelectorAll<HTMLButtonElement>('[data-step-action]')) {
      const action = button.dataset.stepAction;
      button.hidden =
        action === 'submit'
          ? index < steps.length - 1
          : action === 'previous'
            ? index === 0
            : index === steps.length - 1;
    }
  };
  const valid = () => {
    const controls = items()[index]?.elements;
    return (
      !controls ||
      [...controls].every(
        (control) =>
          !('reportValidity' in control) || (control as HTMLInputElement).reportValidity(),
      )
    );
  };
  const go = (next: number) => {
    index = next;
    display();
    items()[index]?.focus();
    current().onStepChange?.(index);
  };
  const click = (event: MouseEvent) => {
    const action =
      event.target instanceof win.Element &&
      event.target.closest<HTMLElement>('[data-step-action]')?.dataset.stepAction;
    if (event.defaultPrevented || !action || action === 'submit') return;
    if (action === 'previous') go(index - 1);
    else if (action === 'skip' || valid()) go(index + 1);
  };
  const submit = (event: SubmitEvent) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (!valid()) return;
    if (index < items().length - 1) go(index + 1);
    else current().onComplete?.(new win.FormData(form));
  };
  const observer = new win.MutationObserver(display);
  observer.observe(form, { childList: true, subtree: true });
  display();
  form.addEventListener('click', click);
  form.addEventListener('submit', submit);
  return {
    update: display,
    dispose() {
      observer.disconnect();
      form.removeEventListener('click', click);
      form.removeEventListener('submit', submit);
    },
  };
}
/** A native multi-step form that validates each step and emits its collected answers. */
export const Questionnaire = view<QuestionnaireProps>(
  ({ onComplete, onStepChange, use, class: className, ...props }) => (
    <form
      {...props}
      noValidate
      data-slot="questionnaire"
      class={cn('flex flex-col gap-4', className)}
      use={composeMounts([use, domBinding({ onComplete, onStepChange }, acquireSteps)])}
    />
  ),
);
/** Progress of a questionnaire step. */
export const QuestionnaireProgress = view<Native<'output'> & Styled>(
  ({ class: className, ...props }) => (
    <output
      aria-live="polite"
      data-slot="questionnaire-progress"
      class={cn(
        'min-h-[1lh] w-fit min-w-[14ch] text-xs font-medium text-muted-foreground tabular-nums',
        className,
      )}
      {...props}
    />
  ),
);
/** Item of a questionnaire step. */
export const QuestionnaireItem = view<Native<'fieldset'> & Styled>(
  ({ class: className, ...props }) => (
    <fieldset
      tabIndex={-1}
      data-slot="questionnaire-item"
      class={cn('flex min-w-0 flex-col gap-4 border-0 p-0 outline-none hidden:hidden', className)}
      {...props}
    />
  ),
);
/** Title of a questionnaire step. */
export const QuestionnaireTitle = view<Native<'legend'> & Styled>(
  ({ class: className, ...props }) => (
    <legend
      data-slot="questionnaire-title"
      class={cn(
        'cn-font-heading text-base leading-snug font-medium text-pretty [&:not(:has(~[data-slot=questionnaire-description]))]:mb-4',
        className,
      )}
      {...props}
    />
  ),
);
/** Description of a questionnaire step. */
export const QuestionnaireDescription = view<Native<'p'> & Styled>(
  ({ class: className, ...props }) => (
    <p
      data-slot="questionnaire-description"
      class={cn('text-sm text-pretty text-muted-foreground', className)}
      {...props}
    />
  ),
);
/** Choices of a questionnaire step. */
export const QuestionnaireChoices = view<Native<'div'> & Styled>(
  ({ class: className, ...props }) => (
    <div
      role="group"
      data-slot="questionnaire-choices"
      class={cn('group/questionnaire-choices grid min-w-0 gap-2', className)}
      {...props}
    />
  ),
);
/** ChoiceDescription of a questionnaire step. */
export const QuestionnaireChoiceDescription = view<Native<'span'> & Styled>(
  ({ class: className, ...props }) => (
    <span
      data-slot="questionnaire-choice-description"
      class={cn('text-muted-foreground', className)}
      {...props}
    />
  ),
);
/** Input of a questionnaire step. */
export const QuestionnaireInput = view<Native<'input'> & Styled>((props) => (
  <Input data-slot="questionnaire-input" {...props} />
));
/** Error of a questionnaire step. */
export const QuestionnaireError = view<Native<'p'> & Styled>(({ class: className, ...props }) => (
  <p
    role="alert"
    data-slot="questionnaire-error"
    class={cn('mt-2 text-sm text-destructive', className)}
    {...props}
  />
));
/** Actions of a questionnaire step. */
export const QuestionnaireActions = view<Native<'div'> & Styled>(
  ({ class: className, ...props }) => (
    <div
      data-slot="questionnaire-actions"
      class={cn(
        'grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 sm:min-h-8',
        className,
      )}
      {...props}
    />
  ),
);
/** A labelled native choice that contributes its value to the completed form. */
export const QuestionnaireChoice = view<Native<'input'> & Styled>(
  ({ children, class: className, type = 'radio', ...props }) => (
    <label class={cn('flex items-center gap-2', className)} data-slot="questionnaire-choice">
      <input type={type} {...props} />
      {children}
    </label>
  ),
);
/** Previous action for the current questionnaire step. */
export const QuestionnairePrevious = view<Native<'button'> & Styled>(({ children, ...props }) => (
  <Button
    data-slot="questionnaire-previous"
    variant="outline"
    type="button"
    data-step-action="previous"
    {...props}
  >
    {children ?? 'Previous'}
  </Button>
));
/** Next action for the current questionnaire step. */
export const QuestionnaireNext = view<Native<'button'> & Styled>(({ children, ...props }) => (
  <Button
    data-slot="questionnaire-next"
    variant="default"
    type="button"
    data-step-action="next"
    {...props}
  >
    {children ?? 'Next'}
  </Button>
));
/** Skip action for the current questionnaire step. */
export const QuestionnaireSkip = view<Native<'button'> & Styled>(({ children, ...props }) => (
  <Button
    data-slot="questionnaire-skip"
    variant="outline"
    type="button"
    data-step-action="skip"
    {...props}
  >
    {children ?? 'Skip'}
  </Button>
));
/** Submit action for the current questionnaire step. */
export const QuestionnaireSubmit = view<Native<'button'> & Styled>(({ children, ...props }) => (
  <Button
    data-slot="questionnaire-submit"
    variant="default"
    type="submit"
    data-step-action="submit"
    {...props}
  >
    {children ?? 'Submit'}
  </Button>
));
