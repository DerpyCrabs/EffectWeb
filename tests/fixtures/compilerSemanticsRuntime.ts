export { Effect } from 'effect';
// oxlint-disable-next-line no-restricted-imports -- Browser regressions execute both development and production compiler output against the DOM primitives.
export {
  compiled,
  markup,
  renderComponent,
  view,
  slot,
  list,
  ViewBinding,
  template,
  element,
  branch,
  each,
  text,
  literal,
  attribute,
  child,
  unboundSend,
  bindAttribute,
  bindControl,
  bindEvent,
  bindAttributes,
  mountView,
} from 'effectweb/dom';
export { modelOwner } from 'effectweb';
