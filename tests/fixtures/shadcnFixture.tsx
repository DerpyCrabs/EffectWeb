import { mount, program, view } from 'effectweb';
import './shadcn.css';
import {
  Accordion,
  AlertDialog,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Collapsible,
  Dialog,
  DropdownMenu,
  NativeSelect,
  NativeSelectOption,
  Popover,
  Sheet,
  Select,
  HoverCard,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  Tooltip,
} from '../../packages/shadcn/src/index';

// Every interactive family on one page, driven by one program, so the browser test can open, close and
// keyboard through them and read the log of what each reported.

interface Model {
  readonly dialog: boolean;
  readonly sheet: boolean;
  readonly alert: boolean;
  readonly popover: boolean;
  readonly menu: boolean;
  readonly tab: string;
  readonly checked: boolean;
  readonly on: boolean;
  readonly select: string;
  readonly open: readonly string[];
  readonly collapsed: boolean;
  readonly log: readonly string[];
}

type Message =
  | { readonly type: 'Set'; readonly patch: Partial<Model> }
  | { readonly type: 'Log'; readonly text: string };

const initial: Model = {
  dialog: false,
  sheet: false,
  alert: false,
  popover: false,
  menu: false,
  tab: 'one',
  checked: false,
  on: false,
  select: 'a',
  open: [],
  collapsed: false,
  log: [],
};

const Page = view<Model, Message>((model, send) => {
  const set = (patch: Partial<Model>) => send({ type: 'Set', patch });
  const log = (text: string) => send({ type: 'Log', text });
  return (
    <main class="p-4">
      <Card>
        <CardHeader>
          <CardTitle>Fixture</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-wrap gap-2">
          <Button id="open-dialog" onClick={() => set({ dialog: true })}>
            Dialog
          </Button>
          <Button id="open-sheet" variant="outline" onClick={() => set({ sheet: true })}>
            Sheet
          </Button>
          <Button id="open-alert" variant="destructive" onClick={() => set({ alert: true })}>
            Alert
          </Button>
          <Badge id="badge">Badge</Badge>
          <Tooltip content="Help text">
            <Button id="tip-trigger" variant="ghost">
              Hover me
            </Button>
          </Tooltip>
          <Popover
            open={model.popover}
            onOpenChange={(open) => set({ popover: open })}
            trigger={<Button id="pop-trigger">Popover</Button>}
          >
            <p id="pop-content">Popover content</p>
          </Popover>
          <DropdownMenu
            open={model.menu}
            onOpenChange={(open) => set({ menu: open })}
            trigger={<Button id="menu-trigger">Menu</Button>}
            items={[
              { kind: 'label', label: 'Actions' },
              { kind: 'item', label: 'First', onSelect: () => log('first') },
              { kind: 'item', label: 'Disabled', disabled: true, onSelect: () => log('disabled') },
              { kind: 'separator' },
              {
                kind: 'checkbox',
                label: 'Checked',
                checked: model.checked,
                onCheckedChange: (checked) => set({ checked }),
              },
              {
                kind: 'item',
                label: 'Delete',
                variant: 'destructive',
                onSelect: () => log('delete'),
              },
            ]}
          />
        </CardContent>
      </Card>
      <Dialog
        open={model.dialog}
        onOpenChange={(open) => set({ dialog: open })}
        title="A dialog"
        description="Describes it"
        footer={
          <Button id="dialog-ok" onClick={() => set({ dialog: false })}>
            OK
          </Button>
        }
      >
        <input id="dialog-input" />
      </Dialog>
      <Sheet
        open={model.sheet}
        onOpenChange={(open) => set({ sheet: open })}
        title="A sheet"
        side="right"
      >
        <p id="sheet-body">Sheet body</p>
      </Sheet>
      <AlertDialog
        open={model.alert}
        onOpenChange={(open) => set({ alert: open })}
        title="Sure?"
        description="No way back"
        action="Confirm"
        onAction={() => log('confirmed')}
      />
      <Tabs
        value={model.tab}
        onValueChange={(tab) => set({ tab })}
        items={[
          { value: 'one', label: 'One', content: <p id="panel-one">Panel one</p> },
          { value: 'two', label: 'Two', content: <p id="panel-two">Panel two</p> },
          { value: 'three', label: 'Three', content: <p>Panel three</p>, disabled: true },
          { value: 'four', label: 'Four', content: <p id="panel-four">Panel four</p> },
        ]}
      />
      <div class="flex items-center gap-2">
        <Checkbox
          id="check"
          checked={model.checked}
          onCheckedChange={(checked) => set({ checked })}
        />
        <Switch id="switch" checked={model.on} onCheckedChange={(on) => set({ on })} />
        <NativeSelect
          id="select"
          value={model.select}
          onChange={(event) => set({ select: event.currentTarget.value })}
        >
          <NativeSelectOption value="a">A</NativeSelectOption>
          <NativeSelectOption value="b">B</NativeSelectOption>
        </NativeSelect>
      </div>
      <Accordion
        value={model.open}
        onValueChange={(open) => set({ open })}
        items={[
          { value: 'x', title: 'Section X', content: <p id="acc-x">X content</p> },
          { value: 'y', title: 'Section Y', content: <p id="acc-y">Y content</p> },
        ]}
      />
      <Collapsible
        open={model.collapsed}
        onOpenChange={(collapsed) => set({ collapsed })}
        trigger={<span id="coll-trigger">Toggle</span>}
      >
        <p id="coll-content">Hidden until opened</p>
      </Collapsible>
      <Select
        aria-label="Custom choice"
        value={model.select}
        onValueChange={(select) => set({ select })}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />
      <HoverCard
        trigger={<Button id="hover-trigger">Preview</Button>}
        openDelay={0}
        closeDelay={100}
      >
        <button id="hover-action">Preview action</button>
      </HoverCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell id="cell">Row</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <output id="state">
        {JSON.stringify({
          dialog: model.dialog,
          sheet: model.sheet,
          alert: model.alert,
          popover: model.popover,
          menu: model.menu,
          tab: model.tab,
          checked: model.checked,
          on: model.on,
          select: model.select,
          open: model.open,
          collapsed: model.collapsed,
          log: model.log,
        })}
      </output>
    </main>
  );
});

export function mountShadcnFixture(host: HTMLElement) {
  const app = program<Model, Message>({
    initial,
    update: (model, message) => ({
      model:
        message.type === 'Set'
          ? { ...model, ...message.patch }
          : { ...model, log: [...model.log, message.text] },
    }),
  });
  const mounted = mount(host, Page, app);
  return { dispose: () => mounted.dispose(), state: () => app.model() };
}
