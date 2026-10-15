import { modelOwner, mount, view } from 'effectweb';
// oxlint-disable-next-line no-restricted-imports -- JSX types have no custom element tags; the fixture creates one directly.
import { jsx } from 'effectweb/jsx-runtime';

// A form-associated custom element that clears its value on form reset, as native controls do.
class ResetField extends HTMLElement {
  static formAssociated = true;
  value = '';
  formResetCallback() {
    this.value = '';
  }
}
if (!customElements.get('reset-field')) customElements.define('reset-field', ResetField);
export function mountControlResetFixture(host: HTMLElement) {
  const owner = modelOwner({
    text: 'accepted',
    range: 20,
    checked: true,
    selected: 'b',
    tags: ['a', 'c'] as readonly string[],
  });
  const Page = view<{
    text: string;
    range: number;
    checked: boolean;
    selected: string;
    tags: readonly string[];
  }>((state) => (
    <div>
      <form id="owned-reset">
        <input aria-label="Reset text" value={state.text} />
        <input aria-label="Reset range" type="range" value={state.range} />
        <input aria-label="Reset check" type="checkbox" checked={state.checked} />
        <textarea aria-label="Reset textarea" value={state.text} />
        <select aria-label="Reset select" value={state.selected}>
          <option value="a">A</option>
          <option value="b">B</option>
        </select>
        <select aria-label="Reset tags" multiple>
          <option value="a" selected={state.tags.includes('a')}>
            A
          </option>
          <option value="b" selected={state.tags.includes('b')}>
            B
          </option>
          <option value="c" selected={state.tags.includes('c')}>
            C
          </option>
        </select>
        {jsx('reset-field' as 'div', { 'aria-label': 'Reset custom', value: state.text })}
        <button type="reset">Native reset</button>
      </form>
      <input form="external-reset" aria-label="External text" value={state.text} />
    </div>
  ));
  const mounted = mount(host, Page, owner.source);
  return {
    setText: (text: string) => owner.patch({ text }),
    dispose: () => {
      mounted.dispose();
      owner.dispose();
    },
  };
}
