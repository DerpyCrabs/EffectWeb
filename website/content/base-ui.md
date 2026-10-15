`@effectweb/base-ui` is the headless layer under [`@effectweb/shadcn`](/docs/shadcn/): unstyled parts with the anatomy and interactions of [Base UI](https://base-ui.com), driven by explicit handles instead of React context. Use it directly when you style components yourself or need parts of one family in different views.

## Handles and parts

Create a handle once in a controller, own its `lifetime`, and pass it to every part of that family. The handle plays the role of Base UI's Root: it holds the state and the actions, and parts observe it independently, so they can live in different views. Removing a part releases that part's DOM binding and subscription, not the handle.

```tsx check
import { controllerView, modelOwner, view } from 'effectweb';
import {
  createDialog,
  DialogTrigger,
  DialogPopup,
  DialogTitle,
  DialogClose,
} from '@effectweb/base-ui';

function exampleController() {
  const owner = modelOwner({});
  const dialog = createDialog();
  owner.own(dialog.lifetime);
  return { source: owner.source, dialog, lifetime: owner };
}

export const Example = controllerView(
  { controller: exampleController },
  view((model) => (
    <>
      <DialogTrigger dialog={model.actions.dialog}>Settings</DialogTrigger>
      <DialogPopup
        dialog={model.actions.dialog}
        aria-labelledby={`${model.actions.dialog.id}-title`}
      >
        <DialogTitle dialog={model.actions.dialog}>Settings</DialogTitle>
        <DialogClose dialog={model.actions.dialog}>Done</DialogClose>
      </DialogPopup>
    </>
  )),
);
```

The handle prop is the family's lower-camel name: `dialog`, `alertDialog`, `menu`, `select`, `checkbox`, `radioGroup`, `navigationMenu`. Stateless structural parts take native props only. Native events, `class` and `use` replace React's synthetic events, `className` and refs; native attributes pass through, and `preventDefault()` in your handler cancels the part's own action.

Every handle has `source`, `lifetime`, `sync` and its family's actions: Dialog and Collapsible have `setOpen` and `toggle`, Checkbox has `setChecked`, Tabs has `setValue`, Accordion has `toggleValue`. Its snapshot holds only that family's state. Read `source.model()` in controllers; views use `observe` or the parts.

A factory given `open`, `value`, `values` or `checked` is controlled for that field: actions call the change callback and leave the state unchanged until the parent accepts it with `sync`, which publishes without calling callbacks. Otherwise the `default*` option initializes state the handle keeps itself.

## Families

Import from `@effectweb/base-ui` or a family subpath such as `@effectweb/base-ui/menu`. Part names carry the family prefix (`DialogTrigger`, `MenuItem`).

| Family           | Factory and parts                                                                                                                                                                                 | Interaction                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Dialog           | createDialog; Trigger, Backdrop, Popup, Title, Description, Close                                                                                                                                 | Modal native dialog, focus containment, Escape and backdrop dismissal      |
| AlertDialog      | createAlertDialog; Trigger, Backdrop, Popup, Title, Description, Close                                                                                                                            | Escape and backdrop do not dismiss                                         |
| Drawer           | createDrawer; Trigger, Backdrop, Popup, Title, Description, Close                                                                                                                                 | Dialog behavior; the edge is styling                                       |
| Popover          | createPopover; Trigger, Backdrop, Positioner, Popup, Arrow, Title, Description, Close                                                                                                             | Top-layer popup; outside press, Escape and focus-out dismiss               |
| Tooltip          | createTooltip; Trigger, Positioner, Popup, Arrow                                                                                                                                                  | Hover and focus with delays, description relationship, Escape              |
| Menu             | createMenu; Trigger, Positioner, Popup, Arrow, Item, CheckboxItem, RadioGroup, RadioItem, Group, GroupLabel, Separator, SubmenuTrigger                                                            | Arrows, Home/End, typeahead; submenus through `createMenu({ parent })`     |
| ContextMenu      | createContextMenu; Trigger, Positioner, Popup, SubmenuTrigger, plus the Menu items                                                                                                                | Right click, long press, Shift+F10 and the ContextMenu key; pointer anchor |
| Menubar          | createMenubar; Root, Trigger, Positioner, Popup, plus the Menu items                                                                                                                              | Left/Right switch menus, Up/Down open, pointer switches while open         |
| NavigationMenu   | createNavigationMenu; Root, List, Item, Trigger, Positioner, Popup, Viewport, Content, Link                                                                                                       | Delayed hover, keyboard routing, measured viewport                         |
| Select           | createSelect; Trigger, Value, Positioner, Popup, Arrow, List, Item, ItemText, ItemIndicator, Group, GroupLabel, Separator, ScrollUpArrow, ScrollDownArrow, HiddenInput                            | Listbox with typeahead; single or multiple, object values, forms           |
| Combobox         | createCombobox; Input, Trigger, Positioner, Popup, List, Collection, Item, ItemIndicator, Group, GroupLabel, Separator, Empty, Status, Clear, Create, Chips, Chip, ChipRemove, Value, HiddenInput | Editable filtering, async items, chips, active-descendant focus            |
| Autocomplete     | createAutocomplete; Input, Trigger, Positioner, Popup, List, Collection, Item, Group, GroupLabel, Separator, Empty, Status, Clear                                                                 | `mode`: list, inline, both or none                                         |
| Tabs             | createTabs; List, Tab, Panel                                                                                                                                                                      | Roving focus, orientation, automatic or manual activation                  |
| Collapsible      | createCollapsible; Root, Trigger, Panel                                                                                                                                                           | Expanded state and hidden panel                                            |
| Accordion        | createAccordion; Root, Item, Header, Trigger, Panel                                                                                                                                               | Exclusive or multiple panels, arrows, Home/End, disabled triggers          |
| Checkbox         | createCheckbox; Root, Indicator                                                                                                                                                                   | Native checkbox, indeterminate, form participation                         |
| Switch           | createSwitch; Root, Indicator, Thumb                                                                                                                                                              | Native checkbox with switch semantics                                      |
| RadioGroup       | createRadioGroup; Root, Item, RadioInput                                                                                                                                                          | Button radios with roving focus; RadioInput for forms                      |
| Toggle           | createToggle; Toggle, Indicator                                                                                                                                                                   | Pressed state                                                              |
| ToggleGroup      | createToggleGroup; Root, Item                                                                                                                                                                     | Exclusive or multiple pressed values, roving focus                         |
| Slider           | createSlider; Root, Control, Track, Indicator, Thumb                                                                                                                                              | Single or range values, pointer, keyboard, forms                           |
| NumberField      | createNumberField; Root, Input, Increment, Decrement, ScrubArea                                                                                                                                   | Localized formatting, press repeat, scrubbing                              |
| Toolbar          | createToolbar; Root, Button, Link, Group, Separator, Input                                                                                                                                        | Roving focus; text inputs keep their caret keys                            |
| ScrollArea       | createScrollArea; Root, Viewport, Content, Scrollbar, Thumb, Corner                                                                                                                               | Native scrolling with custom draggable bars                                |
| Toast            | createToastManager; Viewport, Root, Title, Description, Action, Close                                                                                                                             | Queue, timers, pause on hover and focus, announcements                     |
| Field            | createField; Root, Label, Control, Description, Error, Layout                                                                                                                                     | Native validity; dirty, touched and invalid attributes                     |
| Fieldset         | createFieldset; Root, Legend, Layout                                                                                                                                                              | Native grouping and disabled descendants                                   |
| Avatar           | createAvatar; Root, Image, Fallback                                                                                                                                                               | Fallback while loading or on error; retries when the source changes        |
| Progress         | Root, Track, Indicator, Label, Value                                                                                                                                                              | Stateless; clamped value, indeterminate and complete                       |
| Separator, Input | Separator; Input                                                                                                                                                                                  | Stateless native elements                                                  |

Connect overlay titles and descriptions through `aria-labelledby` and `aria-describedby` using the handle's `id`. Radio menu items use the menu handle's string `value`; checkbox items take `checked` and `onCheckedChange`.

## Select, Combobox and Autocomplete

`createSelect<Value>()` holds one nullable value; `createSelect<Value, true>({ multiple: true })` holds an array. `value`, `defaultValue` and `onValueChange` use that type. For object values supply `isItemEqualToValue`, `itemToStringLabel` for display and `itemToStringValue` for form serialization. Arrows, Home/End, PageUp/PageDown and typeahead move the highlight; Enter and Space select; a single selection closes the popup, multiple keeps it open unless `closeOnClick` says otherwise. The popup aligns the selected row over the trigger (`alignItemWithTrigger={false}` disables it) and falls back to normal placement when the row cannot fit. Scroll arrows scroll on hover and carry `data-visible` while there is more content. `SelectHiddenInput` with `name` submits one entry per selected value, `required` is enforced with a hidden validity control, and form reset restores the default selection.

`createCombobox` adds editable text: items as an array or a `Source`, `filter` (`'contains'`, `'startsWith'`, a function, or `null`), `isItemDisabled`, `loading`, `setItems`, `createItem`, and controlled `inputValue` with `onInputValueChange` or `syncInputValue`. The input keeps focus and `aria-activedescendant` names the highlighted option. Enter commits, Escape dismisses, multiple selection clears the query and stays open, Backspace in an empty input removes the last chip, and ArrowLeft moves into the chips. `ComboboxCollection` renders keyed rows and takes `renderItem`, `start` and `end` for a virtualized window; drive the window from `onActiveChange` so the active item stays mounted. `ComboboxStatus` announces loading and result counts.

`createAutocomplete` shares the input logic with `mode: 'list' | 'inline' | 'both' | 'none'`.

## Menus

A submenu is `createMenu({ parent: menu })`; its trigger receives both `menu` and `submenu`. Escape closes the current popup and restores its trigger, selection closes the whole tree, outside interaction dismisses without stealing focus, and Tab closes the tree and continues from the root trigger.

ContextMenu opens on right click, a stationary long press (`longPressDelay`, 500 ms by default), Shift+F10 and the ContextMenu key. Pointer activation anchors the popup at the pointer; the trigger stays the focus-restoration target. Menubar creates its menus with `menubar.createMenu()`; `MenubarTrigger` takes `menubar` and `menu`, `MenubarPopup` takes `menu`. NavigationMenu takes `delay` and `closeDelay` (200 ms and 150 ms); put every `NavigationMenuContent` inside one Positioner, Popup and Viewport, because content is not moved across the DOM. The positioner measures the active content and publishes `--positioner-*`, `--popup-*` and `--navigation-menu-viewport-*` variables.

## Controls and toasts

- Slider: `value`/`defaultValue` or `values`/`defaultValues`, `min`, `max`, decimal `step`, `largeStep` (Shift), orientation, `name` and `form`. Thumbs stop at their neighbours; each value is submitted under `name`.
- NumberField: `locale` and `format` use `Intl.NumberFormat`, including localized digits, currency and percent. The input commits on change and blur, and an invalid draft reverts. Buttons repeat after 400 ms and accelerate; the scrub area changes one step per four pixels.
- Toolbar: roving focus over buttons, links and inputs; disabled controls are skipped.
- ScrollArea: `visibility: 'auto' | 'always'`, `mode: 'overlay' | 'gutter'`, `hideDelay`; scrollbars expose `data-orientation`, `data-visible` and `data-scrolling`.
- Toast: `createToastManager({ limit, timeout })` with `add`, `close`, `pause` and `resume`. A timeout starts when a queued toast becomes visible; `timeout: 0` keeps it. `priority: 'high'` announces assertively. Pass `manager` to `ToastRoot` so its exit animation finishes before removal.

## Positioning and state attributes

Positioners and popups take `side`, `align`, `sideOffset` and `alignOffset`. Sides are physical or `inline-start`/`inline-end`. Placement flips to the opposite side when the preferred one does not fit, shifts along the alignment axis inside the viewport, and updates on resize and scroll. The popup receives `data-side`, `data-align`, `--anchor-width`, `--anchor-height`, `--available-width`, `--available-height`, `--positioner-width`, `--positioner-height` and `--transform-origin`; arrows sit over the anchor center within the popup.

Stateful parts expose `data-open`/`data-closed`, `data-checked`/`data-unchecked`, `data-active`, `data-disabled` and `data-orientation` as applicable, plus `data-starting-style` during the first open frame and `data-ending-style` while closing. A closing popup stays in the top layer until its CSS transitions or animations finish, or hides at once without motion. Keep parts mounted while a close is in progress; removing the part or its owner disposes it immediately.

Keyboard routing follows the inherited `dir`: horizontal arrows reverse in RTL, vertical arrows and Home/End keep their meaning, and start/end alignment follows direction. Slider pointer input also follows direction.

## Limits

- No React render props or providers; parts are placed explicitly, and content is not moved across the DOM.
- Collision bounds are the viewport; there are no custom boundaries or virtual anchors beyond the pointer anchor of ContextMenu.
- No submenu pointer-intent polygons, nested NavigationMenu roots, Drawer swipe gestures, Preview Card, or the full upstream Field validation API.
- Toast has no swipe, update or promise helpers.
- Native `<dialog>` and Popover API support is required.
