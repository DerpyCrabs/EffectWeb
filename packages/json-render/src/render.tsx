import {
  evaluateVisibility,
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
import { view, type JSX, type Snapshot } from 'effectweb';

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
  readonly element: Snapshot<UIElement>;
  readonly props: P;
  readonly children: JSX.Element;
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
  readonly spec: Spec | Snapshot<Spec> | null;
  readonly registry: ComponentRegistry;
  readonly state: Readonly<Record<string, unknown>>;
  readonly dispatch: (event: ActionEvent) => void;
  readonly loading?: boolean;
  readonly fallback?: ComponentRenderer;
  readonly functions?: PropResolutionContext['functions'];
  readonly directives?: PropResolutionContext['directives'];
}

function renderElement(
  model: Snapshot<RendererProps>,
  key: string,
  ancestors: ReadonlySet<string>,
): JSX.Element {
  const element = model.spec?.elements[key];
  if (!element || ancestors.has(key)) return null;
  // Core only reads these values. Keep published EffectWeb snapshots immutable.
  const context: PropResolutionContext = {
    stateModel: model.state,
    ...(model.functions ? { functions: model.functions } : {}),
    ...(model.directives
      ? { directives: model.directives as NonNullable<PropResolutionContext['directives']> }
      : {}),
  };
  if (!evaluateVisibility(element.visible as UIElement['visible'], context)) return null;
  const component = Object.hasOwn(model.registry, element.type)
    ? model.registry[element.type]
    : model.fallback;
  if (!component) return null;
  const branch = new Set(ancestors).add(key);
  const props = resolveElementProps(element.props, context);
  return component({
    key,
    element,
    props,
    children: (element.children ?? []).map((child) => renderElement(model, child, branch)),
    bindings: resolveBindings(element.props, context),
    loading: model.loading ?? false,
    emit: (event, extra = {}) => {
      const bound = element.on?.[event];
      const bindings: readonly Snapshot<ActionBinding>[] = bound
        ? ((Array.isArray(bound) ? bound : [bound]) as readonly Snapshot<ActionBinding>[])
        : [];
      for (const binding of bindings) {
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
          binding: binding as ActionBinding,
        });
      }
    },
  });
}

/** Host programs own state and action lifetimes. Rendering adds no DOM wrappers or styling. */
export const Renderer = view<RendererProps, never>((model) =>
  model.spec ? renderElement(model, model.spec.root, new Set()) : null,
);
