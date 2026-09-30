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
  mountView,
  attribute,
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

export { domBinding, entities, list, sequence } from 'effectweb';
