import { controlStyle } from '@effectweb/base-ui/control-style';
import { domBinding, entities, list, observe, view } from 'effectweb';
import {
  ToastViewport,
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastClose,
  type ToastManager,
} from '@effectweb/base-ui/toast';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';
export {
  createToastManager,
  ToastAction,
  type ToastManager,
  type ToastData,
} from '@effectweb/base-ui/toast';
const acquireTheme = (element: HTMLElement) => {
  const root = element.ownerDocument.documentElement;
  const update = () => {
    element.dataset.theme = root.classList.contains('dark') ? 'dark' : 'light';
  };
  const observer = new MutationObserver(update);
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  update();
  return { dispose: () => observer.disconnect() };
};
/** Styled Toaster part with native attributes and theme classes. */
export const Toaster = view<Native<'div'> & Styled & { readonly manager: ToastManager }>(
  ({ manager, class: className, style, ...rest }) => (
    <div use={domBinding(null, acquireTheme)}>
      <ToastViewport
        {...rest}
        manager={manager}
        data-slot="toaster"
        class={cn(
          'toaster group fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2',
          className,
        )}
        style={controlStyle(
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)',
            '--border-radius': 'var(--radius)',
          },
          style,
        )}
      >
        {observe(manager.source, (state) =>
          list(entities(state.toasts), (toast) => (
            <ToastRoot
              manager={manager}
              toast={toast}
              class="cn-toast relative flex flex-col gap-1 rounded-(--border-radius) border border-(--normal-border) bg-(--normal-bg) p-4 pr-9 text-sm text-(--normal-text) shadow-lg"
            >
              <ToastTitle toast={toast} class="font-medium" />
              {toast.description ? (
                <ToastDescription toast={toast} class="text-muted-foreground" />
              ) : null}
              <ToastClose
                manager={manager}
                toast={toast}
                class="absolute top-2 right-2 rounded-sm p-1 hover:bg-muted"
              >
                ×
              </ToastClose>
            </ToastRoot>
          )),
        )}
      </ToastViewport>
    </div>
  ),
);
