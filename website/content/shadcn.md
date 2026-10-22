`@effectweb/shadcn` is shadcn/ui for EffectWeb: the base-nova components with their Tailwind v4 classes, rendered on native elements and driven by EffectWeb state. Behavior comes from [`@effectweb/base-ui`](/docs/base-ui/); there is no React layer.

Use it two ways, as upstream shadcn/ui is used: install the package and import components, or copy the component source into your project with the shadcn CLI and edit it there.

## Install the package

```bash
npm install @effectweb/shadcn tailwindcss
```

Configure Tailwind v4 in your build, then import the theme after Tailwind and tell Tailwind where the package's classes live:

```css
@import 'tailwindcss';
@import '@effectweb/shadcn/theme.css';
@source "../node_modules/@effectweb/shadcn/dist";
```

The `@source` path is relative to this CSS file. Import from `@effectweb/shadcn`, or from one family such as `@effectweb/shadcn/button`.

## Copy source with the shadcn CLI

The upstream `shadcn` CLI installs EffectWeb components from the registry at `https://effectweb.netlify.app/r/{name}.json`. The project needs `effectweb`, `@effectweb/compiler`, Vite and Tailwind v4; no React. Add `components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "registries": { "@effectweb": "https://effectweb.netlify.app/r/{name}.json" }
}
```

Map `@/*` to `./src/*` in `tsconfig.json` (`compilerOptions.paths`; do not use `baseUrl`, TypeScript 6 removed it) and in the Vite config. TypeScript needs `jsx: "react-jsx"` and `jsxImportSource: "effectweb"`. Then add components:

```bash
npx shadcn add @effectweb/button @effectweb/theme
```

The CLI writes `src/components/ui/button.tsx`, the helpers it imports into `src/lib`, and installs the npm packages the file needs. `@effectweb/base-ui` and `@effectweb/lucide` stay npm dependencies, pinned to the versions the registry was built from. Import `Button` from `@/components/ui/button` and edit the copied file.

The `theme` item writes `styles/effectweb-shadcn-theme.css` at the project root. Import it after Tailwind:

```css
@import 'tailwindcss';
@import '../styles/effectweb-shadcn-theme.css';
```

Every family below is a registry item under its kebab-case name (`@effectweb/dropdown-menu`). The shared items are `utils`, `types`, `adapter`, `placement` and `theme`; the CLI adds them when a component needs them.

## A settings dialog

```tsx check
import { component, view } from 'effectweb';
import { Button, Checkbox, Dialog, Label, Tabs } from '@effectweb/shadcn';

export const Settings = component(
  { init: () => ({ open: false, notifications: true }) },
  view((model, patch) => (
    <>
      <Button onClick={() => patch({ open: true })}>Settings</Button>
      <Dialog
        open={model.open}
        onOpenChange={(open) => patch({ open })}
        title="Settings"
        aria-label="Settings"
        description="Choose how this app notifies you."
        footer={<Button onClick={() => patch({ open: false })}>Done</Button>}
      >
        <Tabs
          aria-label="Settings sections"
          defaultValue="general"
          items={[
            {
              value: 'general',
              label: 'General',
              content: (
                <Label>
                  <Checkbox
                    checked={model.notifications}
                    onCheckedChange={(notifications) => patch({ notifications })}
                  />
                  Notifications
                </Label>
              ),
            },
            { value: 'about', label: 'About', content: <p>Notification settings for this app.</p> },
          ]}
        />
      </Dialog>
    </>
  )),
);
```

The parent owns the dialog's open state and the checkbox value; Tabs owns its selection. Only the active tab panel is rendered, so keep state that must survive a tab change in the parent.

## Composition and state

Pass JSX through props such as `trigger`, `title`, `description`, `footer` and `children`. Tabs and Accordion take `items` keyed by `value`. DropdownMenu takes `MenuEntry[]` with `kind: 'item'`, `'checkbox'`, `'radio'`, `'submenu'`, `'label'` or `'separator'`:

```tsx check
import { view } from 'effectweb';
import { Button, DropdownMenu } from '@effectweb/shadcn';

export const Actions = view<{ readonly rename: () => void }>((props) => (
  <DropdownMenu
    aria-label="Document actions"
    trigger={<Button variant="outline">Actions</Button>}
    items={[
      { kind: 'label', label: 'Document' },
      { kind: 'separator' },
      { kind: 'item', label: 'Rename', onSelect: props.rename },
    ]}
  />
));
```

Dialog, AlertDialog, Sheet, Drawer, Popover, DropdownMenu and Collapsible accept `open` with `onOpenChange`; without `open` they keep their own state, initialized by `defaultOpen`. Tabs accepts `value`/`onValueChange` or `defaultValue`. In controlled mode, write the reported value back to your model; Escape, light dismiss and close buttons all report through `onOpenChange`.

Accordion, RadioGroup, Slider and ToggleGroup require `value`; Checkbox and Switch require `checked`; Toggle requires `pressed`. Update them through their change callbacks. Input, Textarea and NativeSelect use the native `value` and input/change events.

Structural pieces compose as children: Card has CardHeader, CardTitle, CardDescription, CardAction, CardContent and CardFooter; Dialog has DialogHeader, DialogFooter, DialogTitle and DialogDescription. `Card` and `CardTitle` accept `as` to choose the element. Button renders a button, ButtonLink an anchor with the same variants, and `buttonVariants` returns the classes.

## Families

| Families                                                               | Elements and behavior                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dialog, AlertDialog, Sheet, Drawer                                     | Modal `<dialog>` via `showModal()`: focus containment, inert background, focus restoration. Dialog, Sheet and Drawer close on Escape and backdrop click; AlertDialog needs its action or cancel button; `dismissible={false}` blocks both for Dialog.                                               |
| Popover, DropdownMenu, ContextMenu, Menubar, NavigationMenu, HoverCard | `popover="manual"` in the top layer; Escape, light dismiss and exit animations are handled by the component. Menus add arrow, Home, End and typeahead navigation, submenus, checkbox and radio items.                                                                                               |
| Tooltip                                                                | Top-layer popover shown on hover and focus, hidden on leave and Escape. Use a button or link as its child.                                                                                                                                                                                          |
| Accordion, Collapsible                                                 | Button and panel parts with expanded state and hidden panels. Accordion adds disabled triggers, arrow navigation and exclusive or multiple selection.                                                                                                                                               |
| Checkbox, Switch, RadioGroup, Slider, NumberField                      | Native checkbox and switch inputs; RadioGroup renders button radios with roving focus and hidden inputs for forms; Slider uses pointer and keyboard thumbs with hidden form inputs; NumberField formats with `Intl.NumberFormat`, steps with the keyboard and buttons, and scrubs with the pointer. |
| Input, Textarea, NativeSelect, Label, Field                            | `<input>`, `<textarea>`, `<select>` with options and groups, `<label>`, and fieldset, legend, description and error layout.                                                                                                                                                                         |
| Select, Combobox                                                       | Custom listbox with typeahead, disabled options and focus restoration; Combobox adds an editable input, filtering, async sources, multiple values with chips, and creation.                                                                                                                         |
| Button, Toggle, ToggleGroup, Tabs, Toolbar                             | Buttons; ButtonLink is an anchor. Toggles add pressed state. Tabs adds tab roles, selection and arrow navigation. Toolbar adds roving focus.                                                                                                                                                        |
| Breadcrumb, Pagination, Sidebar                                        | Navigation landmarks, lists and anchors. Sidebar collapses to an icon rail or off-canvas, opens as a modal dialog on narrow screens, and toggles with Ctrl+B or Cmd+B.                                                                                                                              |
| Table, ScrollArea                                                      | Native table parts inside a horizontal overflow container; ScrollArea keeps native scrolling and draws its own scrollbars.                                                                                                                                                                          |
| Alert, Progress, Separator, Toaster                                    | Alert, progressbar and separator semantics on styled divs. Toaster renders a toast manager with the Sonner palette.                                                                                                                                                                                 |
| Avatar, Badge, Card, Empty, Item, Kbd, Skeleton, Spinner, AspectRatio  | Presentation only: image with fallback, spans, layout divs, `<kbd>`, an SVG status icon and intrinsic `aspect-ratio`.                                                                                                                                                                               |
| ButtonGroup, InputOTP                                                  | Joined buttons with optional separators and text; a one-time code as one input per character with paste, Backspace and arrow handling and a hidden form input.                                                                                                                                      |
| Command                                                                | A command palette: the input filters items by a prefix, word and fuzzy score, groups hide when empty, arrows and Home/End move the highlight, Enter or click runs the item's `select`; CommandDialog places it in a modal.                                                                          |
| Calendar                                                               | A month grid without a date library: single, multiple and range selection, disabled matchers, outside days, week numbers, label or dropdown captions, several months, and arrow, Page and Home/End keys. Days are plain `{ year, month, day }` values.                                              |
| Carousel, Resizable                                                    | Carousel scrolls native slides with scroll snapping and tracks the current slide; Resizable splits panels with a draggable, keyboard-operable separator within each panel's bounds.                                                                                                                 |
| Form                                                                   | A native form whose external errors focus the first named control and clear as the user edits, with FormMessage for the field's message; link controls with base-ui's `formFieldBinding`.                                                                                                           |

The browser must support `<dialog>` and the Popover API. Give controls and overlays accessible names through labels or their `aria-label` props.

## Explicit handles

Families that upstream drives through React context take a handle from `@effectweb/base-ui` instead. Create it once in a controller, own its `lifetime`, and pass it to each styled part as the family's lower-camel prop: `select={select}`, `combobox={combobox}`, `menu={menu}`, `menubar={menubar}`, `navigationMenu={navigation}`, `scrollArea={scrollArea}`, `numberField={numberField}`, `sidebar={sidebar}`, and a toast `manager` for Toaster. Every composed family exports the upstream part names: `AccordionItem`, `AccordionTrigger`, `AccordionContent`; `TabsList`, `TabsTrigger`, `TabsContent`; `CollapsibleTrigger`, `CollapsibleContent`; `RadioGroupItem`; `ToggleGroupItem`; `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuSub` and the rest; `SelectTrigger`, `SelectContent`, `SelectItem`; the ContextMenu, Menubar and NavigationMenu parts; `AvatarImage`, `AvatarFallback`, `AvatarBadge`, `AvatarGroup`. The convenience forms (`Accordion items`, `Tabs items`, `DropdownMenu items`, `RadioGroup options`, `ToggleGroup items`, `Select options`) are built from these parts and need no handle.

Dialog, AlertDialog, Popover, Sheet and Drawer also export their parts (Trigger, Backdrop or Overlay, Popup or Content, Header, Footer, Title, Description, Close) for layouts where the trigger and the popup live in different views. The prop-based components are compositions of these parts, so both forms can be mixed. See [the headless guide](/docs/base-ui/) for the handle contract and the anatomy of each family.

## Theme

`theme.css` defines the neutral oklch tokens, the Tailwind `@theme inline` mapping, the `data-*` custom variants and the `tw-animate-css` animations. Add `.dark` to an ancestor, usually `<html>`, for the dark tokens.

Override tokens after the imports, keeping foreground and background pairs together:

```css
:root {
  --primary: oklch(0.45 0.12 260);
  --primary-foreground: oklch(0.99 0 0);
  --radius: 0.75rem;
}

.dark {
  --primary: oklch(0.78 0.1 260);
  --primary-foreground: oklch(0.2 0.04 260);
}
```

The other tokens are `--background`, `--foreground`, `--card`, `--popover`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring` and `--chart-1` through `--chart-5`. A component's `class` prop merges through `cn`; variants come from `cva`.

## Differences from upstream

- No React: state lives in your model or in a base-ui handle, not in context. Props such as `trigger`, `items` and `footer` replace children-only composition where that is simpler; the parts are exported where upstream composes parts.
- Checkbox and Switch are native inputs. Select is a custom listbox; NativeSelect keeps the native element.
- Overlays use `<dialog>` and the Popover API. Placement is a flip-and-clamp helper against the viewport, not Floating UI, so custom collision boundaries are not available.
- Drawer has `direction` and the handle bar but no swipe gestures or snap points; its `data-direction` attribute replaces vaul's `data-vaul-drawer-direction` in the animation classes. Accordion panels animate with CSS transitions on `data-open`/`data-closed`, without measured heights. Toast has no swipe, update or promise helpers.
- Command, Calendar, Carousel, Resizable and InputOTP are native ports of the React-only libraries upstream wraps (cmdk, react-day-picker, embla-carousel, react-resizable-panels, input-otp). Command does not reorder items by score; Calendar has no time zone or formatting library; Carousel has no plugins or drag inertia beyond native scrolling.
- Chart is not ported: upstream renders through Recharts, a React rendering library. Draw charts with your own SVG views or a framework-free chart library.
- The upstream React examples need their composition and event props translated; the [package reference](/docs/api-shadcn/) lists every export and its props.
