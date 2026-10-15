import { mount, modelOwner, list, view } from 'effectweb';
import {
  createSelect,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
  SelectHiddenInput,
  SelectScrollUpArrow,
  SelectScrollDownArrow,
  SelectPositioner,
} from '../../packages/base-ui/src/select';
export function mountSelectScrollingValidationFixture(host: HTMLElement) {
  const owner = modelOwner({});
  const select = createSelect({ defaultValue: 'Item 10', required: true, name: 'long' });
  owner.own(select.lifetime);
  const empty = createSelect({ required: true, name: 'empty' });
  owner.own(empty.lifetime);
  const Page = view(() => (
    <section style={{ paddingTop: '150px' }}>
      <SelectTrigger select={select} aria-label="Long select">
        <SelectValue select={select} />
      </SelectTrigger>
      <SelectPositioner select={select} alignItemWithTrigger={false}>
        <SelectPopup
          select={select}
          aria-label="Long list"
          style={{ maxHeight: '140px', overflowY: 'auto' }}
        >
          <SelectScrollUpArrow select={select} data-testid="scroll-up">
            Up
          </SelectScrollUpArrow>
          {list(
            Array.from({ length: 30 }, (_, i) => `Item ${i}`),
            (value) => value,
            (value) => (
              <SelectItem
                select={select}
                value={value}
                style={{ display: 'block', height: '25px' }}
              >
                {value}
              </SelectItem>
            ),
          )}
          <SelectScrollDownArrow
            select={select}
            data-testid="scroll-down"
            style={{ position: 'sticky', bottom: '0px' }}
          >
            Down
          </SelectScrollDownArrow>
        </SelectPopup>
      </SelectPositioner>
      <form aria-label="Required form">
        <SelectTrigger select={empty} aria-label="Required choice">
          <SelectValue select={empty} placeholder="Required" />
        </SelectTrigger>
        <SelectHiddenInput select={empty} />
        <button type="submit">Submit required</button>
      </form>
    </section>
  ));
  const mounted = mount(host, Page, owner.source);
  return {
    dispose: () => {
      mounted.dispose();
      owner.dispose();
    },
  };
}
