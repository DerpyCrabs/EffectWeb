import { Effect } from 'effect';
import { domMount, modelOwner, mountView, Portal, view } from 'effectweb';

export async function lifecycleFixture() {
  const host = document.createElement('div');
  document.body.append(host);
  const portal = document.createElement('div');
  document.body.append(portal);
  const owner = modelOwner({ version: 0 });
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const binding = (label: string) =>
    domMount(() => {
      events.push(`start:${label}`);
      return Effect.never.pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            events.push(`closing:${label}`);
            await gate;
            events.push(`closed:${label}`);
          }),
        ),
      );
    });
  const portalBinding = binding('portal');
  const Root = view((model: { version: number }) => (
    <section>
      {model.version >= 0 ? <div use={binding(`nested:${model.version}`)} /> : null}
      <Portal mount={portal}>
        <div use={portalBinding} />
      </Portal>
    </section>
  ));
  const unmount = mountView(host, Root, owner.source);
  await Promise.resolve();
  owner.patch({ version: 1 });
  await Promise.resolve();
  let closed = false;
  const closing = Effect.runPromise(unmount.close()).then(() => {
    closed = true;
  });
  await Promise.resolve();
  const detached = host.childNodes.length === 0 && portal.childNodes.length === 0;
  const waiting = !closed;
  release();
  await closing;
  owner.dispose();
  host.remove();
  portal.remove();
  return { detached, waiting, events };
}
