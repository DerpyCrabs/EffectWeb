export { Effect } from 'effect';
// oxlint-disable-next-line no-restricted-imports -- Browser regressions execute both development and production compiler output against the DOM primitives.
export {
  compiled,
  markup,
  still,
  block,
  captured,
  view,
  list,
  text,
  attribute,
  child,
  unboundSend,
  bindControl,
  mount,
} from 'effectweb/dom';
export { modelOwner } from 'effectweb';
