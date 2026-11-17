import { controllerView, list, modelOwner, sequence, view } from 'effectweb';
import type { Native, Styled } from './types.js';
import { cn, cva, type VariantProps } from './cn.js';
import { Button } from './button.js';
import { controlStyle } from '@effectweb/base-ui/control-style';

const codeBlockVariants = cva(
  'group/code-block relative flex w-full min-w-0 flex-col overflow-hidden rounded-lg text-sm has-[>[data-slot=code-block-content]:focus-visible]:ring-3 has-[>[data-slot=code-block-content]:focus-visible]:ring-ring/50 data-[size=sm]:text-xs',
  {
    variants: {
      variant: {
        default:
          'border border-input text-foreground has-[>[data-slot=code-block-content]:focus-visible]:border-ring dark:bg-input/30',
        destructive: 'border border-destructive/30 text-destructive dark:border-destructive/40',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** Code block part of the code-block component. */
export const CodeBlock = view<
  (Native<'div'> & Styled) & VariantProps<typeof codeBlockVariants> & { size?: 'default' | 'sm' }
>(({ class: className, variant = 'default', size = 'default', ...props }) => {
  return (
    <div
      data-slot="code-block"
      data-variant={variant}
      data-size={size}
      class={cn(codeBlockVariants({ variant }), className)}
      {...props}
    />
  );
});

/** Code block header part of the code-block component. */
export const CodeBlockHeader = view<Native<'div'> & Styled>(({ class: className, ...props }) => {
  return (
    <div
      data-slot="code-block-header"
      class={cn(
        'flex min-w-0 shrink-0 items-center gap-2 px-3 pt-3 text-muted-foreground group-data-[size=sm]/code-block:px-2.5 group-data-[size=sm]/code-block:pt-2.5 group-data-[variant=destructive]/code-block:text-destructive *:has-[>[data-slot=code-block-title]]:min-w-0',
        className,
      )}
      {...props}
    />
  );
});

/** Code block title part of the code-block component. */
export const CodeBlockTitle = view<Native<'div'> & Styled>(({ class: className, ...props }) => {
  return (
    <div
      data-slot="code-block-title"
      class={cn(
        "min-w-0 truncate font-sans text-sm font-medium text-foreground group-data-[size=sm]/code-block:text-xs group-data-[variant=destructive]/code-block:text-destructive [&_svg]:pointer-events-none [&_svg]:inline-block [&_svg]:align-middle [&_svg:not([class*='size-'])]:size-3.5 *:[svg]:me-1.5",
        className,
      )}
      {...props}
    />
  );
});

/** Code block actions part of the code-block component. */
export const CodeBlockActions = view<Native<'div'> & Styled>(({ class: className, ...props }) => {
  return (
    <div
      data-slot="code-block-actions"
      class={cn(
        '-my-1 ms-auto -me-1.5 flex shrink-0 items-center gap-1 [[data-slot=code-block]>&]:absolute [[data-slot=code-block]>&]:end-2 [[data-slot=code-block]>&]:top-2 [[data-slot=code-block]>&]:z-10 [[data-slot=code-block]>&]:m-0 [[data-slot=code-block]>&]:opacity-0 [[data-slot=code-block]>&]:transition-opacity [[data-slot=code-block]>&]:group-focus-within/code-block:opacity-100 [[data-slot=code-block]>&]:group-hover/code-block:opacity-100 group-data-[size=sm]/code-block:[[data-slot=code-block]>&]:end-1.5 group-data-[size=sm]/code-block:[[data-slot=code-block]>&]:top-1.5 [[data-slot=code-block]>&]:pointer-coarse:opacity-100 [[data-slot=code-block]>&]:*:[button]:bg-background [[data-slot=code-block]>&]:*:[button]:ring-1 [[data-slot=code-block]>&]:*:[button]:ring-foreground/10',
        className,
      )}
      {...props}
    />
  );
});

/** Copies the supplied code and announces success until the feedback expires. */
export const CodeBlockCopyButton = controllerView(
  {
    controller(props: Parameters<typeof Button>[0] & { value: string }) {
      const owner = modelOwner({ props, copied: false });
      let timer: ReturnType<typeof setTimeout> | undefined;
      owner.own(() => clearTimeout(timer));
      return {
        source: owner.source,
        lifetime: owner,
        receive: (props: Parameters<typeof Button>[0] & { value: string }) =>
          owner.patch({ props }),
        copy: async (button: HTMLButtonElement) => {
          const clipboard = button.ownerDocument.defaultView?.navigator.clipboard;
          if (!clipboard) return;
          try {
            await clipboard.writeText(owner.read().props.value);
          } catch {
            return;
          }
          if (owner.disposed) return;
          owner.patch({ copied: true });
          clearTimeout(timer);
          timer = setTimeout(() => owner.patch({ copied: false }), 2000);
        },
      };
    },
  },
  view((m) => {
    const { value: _value, onClick, children, ...rest } = m.props;
    return (
      <>
        <Button
          size="icon-xs"
          variant="ghost"
          {...rest}
          data-slot="code-block-copy-button"
          aria-label={m.copied ? 'Copied' : 'Copy'}
          data-copied={m.copied || undefined}
          onClick={(e) => {
            onClick?.(e);
            if (!e.defaultPrevented) m.actions.copy(e.currentTarget).catch(console.error);
          }}
        >
          {children ?? (m.copied ? '✓' : '⧉')}
        </Button>
        <span class="sr-only" aria-live="polite">
          {m.copied ? 'Copied' : ''}
        </span>
      </>
    );
  }),
);

/** Code block content part of the code-block component. */
export const CodeBlockContent = view<
  (Native<'pre'> & Styled) & { wrap?: boolean; lineNumbers?: boolean; startLine?: number }
>(
  ({
    class: className,
    children,
    style,
    wrap = false,
    lineNumbers = false,
    startLine = 1,
    ...props
  }) => {
    return (
      <pre
        data-slot="code-block-content"
        data-wrap={wrap || undefined}
        data-numbered={lineNumbers || undefined}
        dir="ltr"
        tabIndex={0}
        style={controlStyle({ counterReset: `line ${startLine - 1}` }, style)}
        class={cn(
          'min-h-0 min-w-0 scroll-fade-x scrollbar-thin overflow-auto px-3 py-3 text-start font-mono leading-relaxed outline-none group-has-data-[slot=code-block-footer]/code-block:pb-2 group-has-data-[slot=code-block-header]/code-block:pt-2 group-data-[size=sm]/code-block:px-2.5 group-data-[size=sm]/code-block:py-2.5 group-data-[size=sm]/code-block:group-has-data-[slot=code-block-header]/code-block:pt-1.5 data-wrap:scroll-fade-y data-wrap:wrap-break-word data-wrap:whitespace-pre-wrap',
          className,
        )}
        {...props}
      >
        <code
          data-slot="code-block-code"
          class="grid min-h-lh min-w-max content-start in-data-numbered:grid-cols-[auto_1fr] in-data-wrap:min-w-0"
        >
          {lineNumbers && typeof children === 'string'
            ? list(sequence(children.replace(/\n$/, '').split('\n')), (line) => (
                <CodeBlockLine>{line}</CodeBlockLine>
              ))
            : children}
        </code>
      </pre>
    );
  },
);

const codeBlockLineVariants = cva(
  "relative -mx-3 block min-h-lh px-3 group-data-[size=sm]/code-block:-mx-2.5 group-data-[size=sm]/code-block:px-2.5 before:min-w-6 before:text-end before:text-muted-foreground after:absolute after:start-1 after:top-0 after:text-muted-foreground after:select-none in-data-numbered:col-span-2 in-data-numbered:grid in-data-numbered:grid-cols-subgrid in-data-numbered:gap-x-3 in-data-numbered:[counter-increment:line] in-data-numbered:before:content-[counter(line)] in-data-numbered:before:select-none in-data-numbered:supports-[content:counter(line)_/_'']:before:content-[counter(line)_/_'']",
  {
    variants: {
      variant: {
        default: '',
        added: "bg-muted after:content-['+']",
        removed: "bg-destructive/10 after:text-destructive after:content-['−']",
        highlighted: 'bg-muted',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** Code block line part of the code-block component. */
export const CodeBlockLine = view<
  (Native<'span'> & Styled) & VariantProps<typeof codeBlockLineVariants>
>(({ class: className, variant = 'default', children, ...props }) => {
  // An empty line holds a newline so copying a selection keeps blank lines.
  const empty =
    children === undefined ||
    children === null ||
    children === '' ||
    (Array.isArray(children) && children.length === 0);

  return (
    <span
      data-slot="code-block-line"
      data-variant={variant}
      class={cn(codeBlockLineVariants({ variant }), className)}
      {...props}
    >
      <span data-slot="code-block-line-content" class="min-w-0">
        {empty ? '\n' : children}
      </span>
    </span>
  );
});

/** Code block footer part of the code-block component. */
export const CodeBlockFooter = view<Native<'div'> & Styled>(({ class: className, ...props }) => {
  return (
    <div
      data-slot="code-block-footer"
      class={cn(
        'flex min-w-0 shrink-0 items-center gap-2 px-3 pb-3 text-muted-foreground group-data-[size=sm]/code-block:px-2.5 group-data-[size=sm]/code-block:pb-2.5',
        className,
      )}
      {...props}
    />
  );
});
