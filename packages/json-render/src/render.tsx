import {
  evaluateVisibility,
  getByPath,
  resolveRepeatStatePath,
  resolveRepeatItemStatePath,
  splitRepeatVisibility,
  resolveBindings,
  resolveElementProps,
  resolveActionParam,
  type ActionBinding,
  type Catalog,
  type InferCatalogComponents,
  type InferComponentProps,
  type PropResolutionContext,
  type Spec,
  type UIElement,
} from '@json-render/core';
import { controllerView, modelOwner, list, view, type JSX } from 'effectweb';

export interface ActionEvent {
  readonly type: 'action';
  readonly elementId: string;
  readonly event: string;
  readonly action: string;
  readonly params: Record<string, unknown>;
  /** Preserve confirmation/chaining metadata for the application's action executor. */
  readonly binding: ActionBinding;
}
export interface ComponentRenderProps<P = Record<string, unknown>> {
  readonly key: string;
  readonly element: UIElement;
  readonly props: P;
  readonly children: JSX.Element;
  readonly slots?: Readonly<Record<string, JSX.Element>> | undefined;
  readonly bindings: Readonly<Record<string, string>> | undefined;
  readonly loading: boolean;
  readonly emit: (event: string, extra?: Record<string, unknown>) => void;
}
export type ComponentRenderer<P = Record<string, unknown>> = (
  context: ComponentRenderProps<P>,
) => JSX.Element;
export type ComponentRegistry = Readonly<Record<string, ComponentRenderer>>;

/** Infer component props from an upstream catalog; no application components are bundled. */
export function defineRegistry<C extends Catalog>(
  _catalog: C,
  options: {
    readonly components: {
      readonly [K in keyof InferCatalogComponents<C>]: ComponentRenderer<InferComponentProps<C, K>>;
    };
  },
): { readonly registry: ComponentRegistry } {
  // The catalog associates each name with its props; expressions are resolved by core at render time.
  return { registry: options.components as unknown as ComponentRegistry };
}

export interface RendererProps {
  readonly spec: Spec | null;
  readonly registry: ComponentRegistry;
  readonly state: Readonly<Record<string, unknown>>;
  readonly dispatch: (event: ActionEvent) => void;
  readonly loading?: boolean;
  readonly fallback?: ComponentRenderer;
  readonly functions?: PropResolutionContext['functions'];
  readonly directives?: PropResolutionContext['directives'];
}

type Bindings = ActionBinding | readonly ActionBinding[] | undefined;
function dispatchBindings(
  model: RendererProps,
  key: string,
  event: string,
  bound: Bindings,
  context: PropResolutionContext,
  extra = {},
) {
  for (const binding of (Array.isArray(bound)
    ? bound
    : bound
      ? [bound]
      : []) as readonly ActionBinding[]) {
    const params = Object.fromEntries(
      Object.entries(binding.params ?? {}).map(([name, value]) => [
        name,
        resolveActionParam(value, context),
      ]),
    );
    model.dispatch({
      type: 'action',
      elementId: key,
      event,
      action: binding.action,
      params: { ...params, ...extra },
      binding,
    });
  }
}
interface WatchProps {
  children: JSX.Element;
  state: RendererProps['state'];
  watch: NonNullable<UIElement['watch']>;
  changed: (path: string) => void;
}
const Watched = controllerView(
  {
    controller(initial: WatchProps) {
      const owner = modelOwner({ children: initial.children });
      let previous = initial;
      return {
        source: owner.source,
        lifetime: owner,
        receive(next: WatchProps) {
          const old = previous;
          previous = next;
          owner.patch({ children: next.children });
          for (const path of Object.keys(next.watch)) {
            if (
              Object.hasOwn(old.watch, path) &&
              !Object.is(getByPath(old.state, path), getByPath(next.state, path))
            ) {
              queueMicrotask(() => {
                if (!owner.disposed) next.changed(path);
              });
            }
          }
        },
      };
    },
  },
  view((model) => model.children),
);

function renderElement(
  model: RendererProps,
  key: string,
  ancestors: ReadonlySet<string>,
  context: PropResolutionContext,
): JSX.Element {
  const element = model.spec?.elements[key];
  if (!element || ancestors.has(key)) return null;
  const visibility =
    element.repeat && context.repeatBasePath === undefined
      ? splitRepeatVisibility(element.visible)
      : { container: element.visible, itemFilter: undefined };
  if (!evaluateVisibility(visibility.container, context)) return null;
  const component = Object.hasOwn(model.registry, element.type)
    ? model.registry[element.type]
    : model.fallback;
  if (!component) return null;
  const branch = new Set(ancestors).add(key);
  const renderChildren = (keys: readonly string[], scope: PropResolutionContext) =>
    list(keys, (child) => renderElement(model, child, branch, scope));
  const repeat = element.repeat;
  let children: JSX.Element;
  if (repeat) {
    const path = resolveRepeatStatePath(repeat.statePath, context.repeatBasePath);
    const rows = path === undefined ? undefined : getByPath(model.state, path);
    children =
      Array.isArray(rows) && path !== undefined
        ? list(
            rows as readonly unknown[],
            // oxlint-disable-next-line effectweb/identity -- json-render defines ordinal identity for items without a key.
            (item, index) => {
              const id =
                repeat.key && item && typeof item === 'object'
                  ? (item as Record<string, unknown>)[repeat.key]
                  : undefined;
              return typeof id === 'number' || typeof id === 'string'
                ? 'key:' + id
                : 'index:' + index;
            },
            (item, index) => {
              const scope = {
                ...context,
                repeatItem: item,
                repeatIndex: index,
                repeatBasePath: resolveRepeatItemStatePath(path, index),
              };
              return evaluateVisibility(visibility.itemFilter, scope)
                ? renderChildren(element.children ?? [], scope)
                : null;
            },
          )
        : null;
  } else children = renderChildren(element.children ?? [], context);
  const rendered = component({
    key,
    element,
    props: resolveElementProps(element.props, context),
    children,
    slots:
      element.slots &&
      Object.fromEntries(
        Object.entries(element.slots).map(([name, keys]) => [name, renderChildren(keys, context)]),
      ),
    bindings: resolveBindings(element.props, context),
    loading: model.loading ?? false,
    emit: (event, extra) =>
      dispatchBindings(model, key, event, element.on?.[event], context, extra),
  });
  return element.watch ? (
    <Watched
      state={model.state}
      watch={element.watch}
      changed={(path) => dispatchBindings(model, key, path, element.watch?.[path], context)}
    >
      {rendered}
    </Watched>
  ) : (
    rendered
  );
}

/** Host programs own state and action lifetimes. Rendering adds no DOM wrappers or styling. */
export const Renderer = view<RendererProps, never>((model) =>
  model.spec
    ? list([model.spec.root], (root) =>
        renderElement(model, root, new Set(), {
          stateModel: model.state,
          ...(model.functions ? { functions: model.functions } : {}),
          ...(model.directives ? { directives: model.directives } : {}),
        }),
      )
    : null,
);
