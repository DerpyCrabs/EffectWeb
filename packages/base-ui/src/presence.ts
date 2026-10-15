import { domBinding } from 'effectweb';

/** Element-owned presence: retain native top-layer state until finite CSS motion settles. */
export function createPresence(element: HTMLElement, subtree = false) {
  let wanted: boolean | undefined;
  let generation = 0;
  let frame = 0;
  const win = element.ownerDocument.defaultView!;
  const cancel = () => {
    generation++;
    win.cancelAnimationFrame(frame);
  };
  return {
    update(open: boolean, show: () => void, hide: () => void) {
      if (wanted === open) return;
      const initial = wanted === undefined;
      wanted = open;
      cancel();
      const token = generation;
      element.toggleAttribute('data-open', open);
      element.toggleAttribute('data-closed', !open);
      element.dataset.state = open ? 'open' : 'closed';
      element.removeAttribute('data-starting-style');
      element.removeAttribute('data-ending-style');
      if (open) {
        element.setAttribute('data-starting-style', '');
        show();
        // Commit the starting style before removing it on the following painted frame.
        element.getBoundingClientRect();
        frame = win.requestAnimationFrame(() => {
          frame = win.requestAnimationFrame(() => {
            if (token === generation) element.removeAttribute('data-starting-style');
          });
        });
      } else {
        if (initial) {
          hide();
          return;
        }
        element.setAttribute('data-ending-style', '');
        element.getBoundingClientRect();
        const animations = element.getAnimations({ subtree }).filter((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return animation.playState !== 'finished' && timing?.endTime !== Infinity;
        });
        const finish = () => {
          if (token !== generation) return;
          element.removeAttribute('data-ending-style');
          hide();
        };
        if (animations.length)
          void Promise.allSettled(animations.map((animation) => animation.finished)).then(
            finish,
            finish,
          );
        else finish();
      }
    },
    dispose: cancel,
  };
}
const acquirePanel = (element: HTMLElement, current: () => boolean) => {
  const presence = createPresence(element);
  const sync = () =>
    presence.update(
      current(),
      () => {
        element.hidden = false;
      },
      () => {
        element.hidden = true;
      },
    );
  sync();
  return { update: sync, dispose: presence.dispose };
};
/** Keep a disclosure panel mounted and visible through its CSS exit motion. */
export const panelPresence = (open: boolean) => domBinding(open, acquirePanel);
