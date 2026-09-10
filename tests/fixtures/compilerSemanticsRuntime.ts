// oxlint-disable-next-line no-restricted-imports -- Browser regressions execute both development and production compiler output against the DOM primitives.
export {
  compiled,
  intrinsic,
  template,
  element,
  branch,
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

export function view(): never {
  throw new Error('The test view must be compiled before importing this module.');
}
