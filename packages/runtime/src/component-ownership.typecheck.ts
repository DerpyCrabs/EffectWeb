import { component, controllerView } from './component.js';
import { compiled, view } from './dom.js';
import type { ControllerModel } from './controller.js';
import { modelOwner } from './owner.js';

export function componentOwnershipTypeChecks() {
  component({ init: (_props: { title: string }) => ({ count: 0 }) }, (owner) =>
    compiled((scope) => {
      const title: string = scope.value.props.title;
      owner.patch({ count: title.length });
      // @ts-expect-error A placement owner cannot replace parent props.
      owner.patch({ props: { title } });
      // @ts-expect-error Placement authority excludes disposal.
      const unavailable: unknown = owner.dispose;
      void unavailable;
    }),
  );
  const create = () => {
    const owner = modelOwner({ count: 0 });
    return {
      source: owner.source,
      lifetime: owner,
      increment: () => owner.edit('count', (count) => count + 1),
    };
  };
  controllerView(
    { controller: create },
    compiled((scope) => {
      scope.value.actions.increment();
      // @ts-expect-error Lifecycle capability is excluded from rendered actions.
      const unavailable: unknown = scope.value.actions.lifetime;
      void unavailable;
    }),
  );
  const assertModel = (model: ControllerModel<typeof create>) => {
    model.actions.increment();
    // @ts-expect-error ControllerModel excludes the lifecycle capability too.
    const unavailable: unknown = model.actions.lifetime;
    void unavailable;
  };
  void assertModel;
  // A lifetime without awaited cleanup is accepted: disposal alone is immediate.
  controllerView(
    { controller: () => ({ source: create().source, lifetime: { dispose: () => {} } }) },
    compiled(() => {}),
  );
  controllerView(
    {
      // @ts-expect-error A controller must hand its cleanup over as lifetime.
      controller: () => ({ source: create().source, dispose: () => {} }),
    },
    compiled(() => {}),
  );
  const messages = {
    init: (_props: { title: string }) => ({ count: 0 }),
    update: (model: { count: number; props: { title: string } }, _message: number) => ({ model }),
  };
  const factory = (_owner: import('./component.js').ComponentOwner<{ count: number }>) =>
    compiled<
      { count: number; props: { title: string } },
      import('./component.js').FieldsPatch<{ count: number }>
    >(() => {});
  // @ts-expect-error Named message definitions cannot select the field factory overload.
  component(messages, factory);
  component<{ title: string }, { count: number }>({ init: () => ({ count: 0 }) }, (owner) =>
    compiled((scope) => {
      owner.patch({ count: scope.value.props.title.length });
    }),
  );
  component<{ title: string }, { count: number }>({ init: () => ({ count: 0 }) }, (owner) =>
    view((model) => {
      owner.patch({ count: model.props.title.length });
      return null;
    }),
  );
}
