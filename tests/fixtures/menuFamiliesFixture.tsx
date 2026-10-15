import { mount, modelOwner, view } from 'effectweb';
import './shadcn.css';
import * as Context from '../../packages/shadcn/src/context-menu';
import * as Bar from '../../packages/shadcn/src/menubar';
import * as Navigation from '../../packages/shadcn/src/navigation-menu';
export function mountMenuFamiliesFixture(host: HTMLElement) {
  const owner = modelOwner({});
  const context = Context.createContextMenu();
  const nested = Context.createContextMenu({ parent: context });
  const deep = Context.createContextMenu({ parent: nested });
  const bar = Bar.createMenubar();
  const file = bar.createMenu();
  const edit = bar.createMenu();
  const disabled = bar.createMenu({ disabled: true });
  const recent = Bar.createMenubarSubmenu({ parent: file });
  const navigation = Navigation.createNavigationMenu();
  for (const handle of [context, nested, deep, bar, recent, navigation]) owner.own(handle.lifetime);
  const Page = view(() => (
    <section aria-label="Menu families">
      <Context.ContextMenuTrigger
        menu={context}
        style={{ width: '200px', height: '80px', border: '1px solid' }}
      >
        Context target
      </Context.ContextMenuTrigger>
      <Context.ContextMenuPositioner menu={context} side="bottom" align="start" sideOffset={0}>
        <Context.ContextMenuContent menu={context} aria-label="Context actions">
          <Context.ContextMenuItem menu={context}>Context first</Context.ContextMenuItem>
          <Context.ContextMenuItem menu={context} disabled>
            Context disabled
          </Context.ContextMenuItem>
          <Context.ContextMenuSubTrigger menu={context} submenu={nested}>
            Context more
          </Context.ContextMenuSubTrigger>
        </Context.ContextMenuContent>
      </Context.ContextMenuPositioner>
      <Context.ContextMenuSubContent menu={nested} aria-label="Context nested">
        <Context.ContextMenuSubTrigger menu={nested} submenu={deep}>
          Context deeper
        </Context.ContextMenuSubTrigger>
      </Context.ContextMenuSubContent>
      <Context.ContextMenuSubContent menu={deep} aria-label="Context deepest">
        <Context.ContextMenuItem menu={deep}>Context leaf</Context.ContextMenuItem>
      </Context.ContextMenuSubContent>
      <Bar.Menubar menubar={bar} aria-label="Application">
        <Bar.MenubarTrigger menubar={bar} menu={file}>
          File
        </Bar.MenubarTrigger>
        <Bar.MenubarTrigger menubar={bar} menu={disabled}>
          Unavailable
        </Bar.MenubarTrigger>
        <Bar.MenubarTrigger menubar={bar} menu={edit}>
          Edit
        </Bar.MenubarTrigger>
      </Bar.Menubar>
      <Bar.MenubarContent menu={file} aria-label="File actions">
        <Bar.MenubarItem menu={file}>New file</Bar.MenubarItem>
        <Bar.MenubarSubTrigger menu={file} submenu={recent}>
          Recent files
        </Bar.MenubarSubTrigger>
      </Bar.MenubarContent>
      <Bar.MenubarSubContent menu={recent} aria-label="Recent actions">
        <Bar.MenubarItem menu={recent}>Recent document</Bar.MenubarItem>
      </Bar.MenubarSubContent>
      <Bar.MenubarContent menu={edit} aria-label="Edit actions">
        <Bar.MenubarItem menu={edit}>Undo edit</Bar.MenubarItem>
      </Bar.MenubarContent>
      <button id="after-menubar">After menubar</button>
      <Navigation.NavigationMenu navigationMenu={navigation} aria-label="Site">
        <Navigation.NavigationMenuList>
          <Navigation.NavigationMenuItem>
            <Navigation.NavigationMenuTrigger navigationMenu={navigation} value="learn">
              Learn
            </Navigation.NavigationMenuTrigger>
          </Navigation.NavigationMenuItem>
          <Navigation.NavigationMenuItem>
            <Navigation.NavigationMenuTrigger navigationMenu={navigation} value="tools">
              Tools
            </Navigation.NavigationMenuTrigger>
          </Navigation.NavigationMenuItem>
          <Navigation.NavigationMenuItem>
            <Navigation.NavigationMenuLink navigationMenu={navigation} href="#home" active>
              Home link
            </Navigation.NavigationMenuLink>
          </Navigation.NavigationMenuItem>
        </Navigation.NavigationMenuList>
        <Navigation.NavigationMenuPositioner
          navigationMenu={navigation}
          data-testid="navigation-positioner"
        >
          <Navigation.NavigationMenuPopup>
            <Navigation.NavigationMenuViewport data-testid="navigation-viewport">
              <Navigation.NavigationMenuContent
                navigationMenu={navigation}
                value="learn"
                style={{ width: '240px', height: '120px' }}
              >
                <Navigation.NavigationMenuLink navigationMenu={navigation} href="#guide">
                  Read guide
                </Navigation.NavigationMenuLink>
                <Navigation.NavigationMenuLink navigationMenu={navigation} href="#tutorial">
                  Read tutorial
                </Navigation.NavigationMenuLink>
              </Navigation.NavigationMenuContent>
              <Navigation.NavigationMenuContent
                navigationMenu={navigation}
                value="tools"
                style={{ width: '360px', height: '180px' }}
              >
                <Navigation.NavigationMenuLink navigationMenu={navigation} href="#tools">
                  Browse tools
                </Navigation.NavigationMenuLink>
              </Navigation.NavigationMenuContent>
            </Navigation.NavigationMenuViewport>
          </Navigation.NavigationMenuPopup>
        </Navigation.NavigationMenuPositioner>
      </Navigation.NavigationMenu>
      <button id="menus-outside" style={{ marginTop: '240px' }}>
        Menus outside
      </button>
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
