// oxlint-disable-next-line no-restricted-imports -- Renderer fixture deliberately exercises compiler implementation primitives.
export {
  Scope,
  each,
  element,
  event,
  compiled,
  attach,
  renderComponent,
  view,
  markup,
  text,
  branch,
  mountView,
  template,
  attribute,
  literal,
} from 'effectweb/dom';
export {
  program,
  makeProgram,
  actionCommand,
  effectCommand,
  commandSlot,
  commandSlots,
  type Command,
  type Program,
  type Send,
  type Transition,
} from 'effectweb';
export { mapCommand, mapTransition } from 'effectweb/advanced';

export { domBinding, entities, list, sequence } from 'effectweb';
