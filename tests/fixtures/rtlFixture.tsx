import { mount, view, modelOwner, list } from 'effectweb';
import {
  createTabs,
  TabsList,
  TabsTab,
  createRadioGroup,
  RadioGroupRoot,
  RadioGroupItem,
  createToggleGroup,
  ToggleGroupRoot,
  ToggleGroupItem,
  createSlider,
  SliderRoot,
  SliderControl,
  SliderThumb,
  createPopover,
  PopoverTrigger,
  PopoverPopup,
} from '../../packages/base-ui/src/index';
export function mountRtlFixture(host: HTMLElement) {
  const owner = modelOwner({});
  const tabs = createTabs({ defaultValue: 'a' });
  const radio = createRadioGroup({ defaultValue: 'a' });
  const toggles = createToggleGroup();
  const slider = createSlider({ defaultValue: 50 });
  const popover = createPopover();
  for (const handle of [tabs, radio, toggles, slider, popover]) owner.own(handle.lifetime);
  const values = ['a', 'b', 'c'];
  const Page = view(() => (
    <>
      <TabsList tabs={tabs}>
        {list(values, (value) => (
          <TabsTab tabs={tabs} value={value}>
            {value}
          </TabsTab>
        ))}
      </TabsList>
      <RadioGroupRoot radioGroup={radio}>
        {list(values, (value) => (
          <RadioGroupItem radioGroup={radio} value={value}>
            {value}
          </RadioGroupItem>
        ))}
      </RadioGroupRoot>
      <ToggleGroupRoot toggleGroup={toggles}>
        {list(values, (value) => (
          <ToggleGroupItem toggleGroup={toggles} value={value}>
            {value}
          </ToggleGroupItem>
        ))}
      </ToggleGroupRoot>
      <SliderRoot slider={slider}>
        <SliderControl slider={slider} style={{ width: '200px', height: '30px' }}>
          <SliderThumb slider={slider} aria-label="Volume" />
        </SliderControl>
      </SliderRoot>
      <PopoverTrigger
        popover={popover}
        style={{ position: 'fixed', left: '500px', top: '250px', width: '100px' }}
      >
        Anchor
      </PopoverTrigger>
      <PopoverPopup
        popover={popover}
        side="inline-start"
        align="start"
        style={{ width: '80px', height: '40px' }}
      >
        Popup
      </PopoverPopup>
    </>
  ));
  const mounted = mount(host, Page, owner.source);
  return () => {
    mounted.dispose();
    owner.dispose();
  };
}
