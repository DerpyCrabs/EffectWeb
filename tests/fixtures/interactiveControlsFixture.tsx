import { mount, modelOwner, view, observe, list, entities } from 'effectweb';
import {
  createSlider,
  SliderRoot,
  SliderControl,
  SliderTrack,
  SliderIndicator,
  SliderThumb,
} from '../../packages/base-ui/src/slider';
import {
  createNumberField,
  NumberFieldRoot,
  NumberFieldInput,
  NumberFieldIncrement,
  NumberFieldDecrement,
  NumberFieldScrubArea,
} from '../../packages/base-ui/src/number-field';
import {
  createScrollArea,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaCorner,
} from '../../packages/base-ui/src/scroll-area';
import {
  createToolbar,
  ToolbarRoot,
  ToolbarButton,
  ToolbarLink,
  ToolbarInput,
  ToolbarSeparator,
} from '../../packages/base-ui/src/toolbar';
import {
  createToastManager,
  ToastViewport,
  ToastRoot,
  ToastTitle,
  ToastClose,
} from '../../packages/base-ui/src/toast';
import {
  createSidebar,
  SidebarProvider,
  Sidebar,
  SidebarTrigger,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
} from '../../packages/shadcn/src/sidebar';
import { Card, CardTitle } from '../../packages/shadcn/src/card';
import { Slider } from '../../packages/shadcn/src/slider';
import { NumberField } from '../../packages/shadcn/src/number-field';
import { Toaster } from '../../packages/shadcn/src/sonner';
import { AspectRatio } from '../../packages/shadcn/src/aspect-ratio';
import { Item, ItemGroup, ItemTitle } from '../../packages/shadcn/src/item';
import './shadcn.css';
export function mountInteractiveControlsFixture(host: HTMLElement) {
  const owner = modelOwner({ controlled: 30 });
  const slider = createSlider({
    defaultValues: [20, 70],
    min: 0,
    max: 100,
    step: 0.5,
    largeStep: 10,
    name: 'range',
  });
  const rtl = createSlider({ defaultValue: 40, dir: 'rtl' });
  const vertical = createSlider({ defaultValue: 30, orientation: 'vertical' });
  const numberField = createNumberField({
    defaultValue: 5,
    min: 0,
    max: 100,
    step: 0.5,
    name: 'quantity',
    locale: 'de-DE',
  });
  const scrollArea = createScrollArea({ visibility: 'always' });
  const autoScroll = createScrollArea({ hideDelay: 100, mode: 'gutter' });
  const toolbar = createToolbar();
  const manager = createToastManager({ limit: 1, timeout: 1200 });
  const styledManager = createToastManager();
  const sidebar = createSidebar();
  for (const handle of [
    slider,
    rtl,
    vertical,
    numberField,
    scrollArea,
    autoScroll,
    toolbar,
    manager,
    styledManager,
    sidebar,
  ])
    owner.own(handle.lifetime);
  const Page = view(() => (
    <main style={{ padding: '30px', marginLeft: '280px' }}>
      <form id="controls-form">
        <SliderRoot slider={slider}>
          <SliderControl
            slider={slider}
            aria-label="Range control"
            onPointerDown={(event) => {
              if (event.altKey) event.preventDefault();
            }}
            style={{ width: '300px', height: '30px' }}
          >
            <SliderTrack
              slider={slider}
              style={{
                height: '6px',
                background: '#ddd',
                position: 'absolute',
                top: '12px',
                width: '100%',
              }}
            >
              <SliderIndicator slider={slider} style={{ background: 'blue', height: '100%' }} />
            </SliderTrack>
            <SliderThumb
              slider={slider}
              index={0}
              aria-label="Minimum"
              style={{ top: '7px', width: '18px' }}
            />
            <SliderThumb
              slider={slider}
              index={1}
              aria-label="Maximum"
              style={{ top: '7px', width: '18px' }}
            />
          </SliderControl>
        </SliderRoot>
        <SliderRoot slider={rtl}>
          <SliderControl slider={rtl} style={{ width: '300px', height: '30px' }}>
            <SliderThumb slider={rtl} aria-label="RTL" />
          </SliderControl>
        </SliderRoot>
        <SliderRoot slider={vertical}>
          <SliderControl slider={vertical} style={{ width: '30px', height: '100px' }}>
            <SliderThumb slider={vertical} aria-label="Vertical" />
          </SliderControl>
        </SliderRoot>
        <NumberFieldRoot numberField={numberField}>
          <NumberFieldScrubArea
            numberField={numberField}
            onPointerDown={(event) => {
              if (event.altKey) event.preventDefault();
            }}
          >
            Scrub quantity
          </NumberFieldScrubArea>
          <NumberFieldDecrement numberField={numberField}>Less</NumberFieldDecrement>
          <NumberFieldInput numberField={numberField} aria-label="Quantity" />
          <NumberFieldIncrement numberField={numberField}>More</NumberFieldIncrement>
        </NumberFieldRoot>
        <button type="reset">Reset controls</button>
      </form>
      <ScrollAreaRoot
        scrollArea={scrollArea}
        style={{ width: '220px', height: '140px', border: '1px solid' }}
      >
        <ScrollAreaViewport scrollArea={scrollArea} aria-label="Scrollable content">
          <ScrollAreaContent scrollArea={scrollArea} style={{ height: '900px', width: '600px' }}>
            Scrollable text
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar
          scrollArea={scrollArea}
          aria-label="Vertical scrollbar"
          style={{ background: '#eee' }}
        >
          <ScrollAreaThumb scrollArea={scrollArea} style={{ background: '#555' }} />
        </ScrollAreaScrollbar>
        <ScrollAreaScrollbar scrollArea={scrollArea} orientation="horizontal">
          <ScrollAreaThumb
            scrollArea={scrollArea}
            orientation="horizontal"
            style={{ background: '#555' }}
          />
        </ScrollAreaScrollbar>
        <ScrollAreaCorner scrollArea={scrollArea} />
      </ScrollAreaRoot>
      <ScrollAreaRoot
        scrollArea={autoScroll}
        aria-label="Auto scroll area"
        style={{ width: '200px', height: '100px' }}
      >
        <ScrollAreaViewport scrollArea={autoScroll} aria-label="Auto viewport">
          <ScrollAreaContent scrollArea={autoScroll} style={{ height: '500px' }}>
            Auto content
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar scrollArea={autoScroll} data-testid="auto-bar">
          <ScrollAreaThumb scrollArea={autoScroll} />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
      <ToolbarRoot toolbar={toolbar} aria-label="Editor">
        <ToolbarButton>Undo</ToolbarButton>
        <ToolbarButton disabled>Unavailable</ToolbarButton>
        <ToolbarLink href="#tool">Tools</ToolbarLink>
        <ToolbarSeparator toolbar={toolbar} />
        <ToolbarInput aria-label="Tool filter" />
      </ToolbarRoot>
      <button
        onClick={() => {
          manager.add({ title: 'First notification' });
          manager.add({ title: 'Second notification' });
        }}
      >
        Notify
      </button>
      <ToastViewport manager={manager}>
        {observe(manager.source, (state) =>
          list(entities(state.toasts), (toast) => (
            <ToastRoot toast={toast}>
              <ToastTitle toast={toast} />
              <ToastClose manager={manager} toast={toast}>
                Dismiss
              </ToastClose>
            </ToastRoot>
          )),
        )}
      </ToastViewport>
      <SidebarProvider sidebar={sidebar} style={{ minHeight: '100px' }}>
        <Sidebar sidebar={sidebar} collapsible="icon">
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Dashboard</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
          <SidebarRail sidebar={sidebar} />
        </Sidebar>
        <SidebarTrigger sidebar={sidebar} />
      </SidebarProvider>
      <Card as="article">
        <CardTitle as="h2">Semantic card</CardTitle>
      </Card>
      {observe(owner.source, (state) => (
        <Slider
          value={state.controlled}
          onValueChange={(controlled) => owner.patch({ controlled })}
          aria-label="Styled volume"
        />
      ))}
      <NumberField numberField={numberField} aria-label="Styled quantity" />
      <button
        onClick={() => {
          styledManager.add({ title: 'Styled notification', type: 'success', timeout: 0 });
        }}
      >
        Styled notify
      </button>
      <Toaster manager={styledManager} />
      <AspectRatio ratio={2}>
        <div>Aspect content</div>
      </AspectRatio>
      <ItemGroup>
        <Item>
          <ItemTitle>Item title</ItemTitle>
        </Item>
      </ItemGroup>
    </main>
  ));
  const mounted = mount(host, Page, owner.source);
  return {
    dispose: () => {
      mounted.dispose();
      owner.dispose();
    },
  };
}
