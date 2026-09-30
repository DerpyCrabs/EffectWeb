// @vitest-environment happy-dom
import { expect, it } from 'vitest';

it('router links render real anchors and navigate in place on plain clicks', async () => {
  const result = await (async () => {
    const { mountLinks } = await import('../fixtures/routerLinkFixture');
    const parent = document.createElement('main');
    document.body.append(parent);
    const links = await mountLinks(parent);
    const [notes, home] = [...parent.querySelectorAll('a')];
    const initial = {
      href: notes!.getAttribute('href'),
      className: notes!.className,
      current: notes!.getAttribute('aria-current'),
      disabledHref: home!.hasAttribute('href'),
      disabledAria: home!.getAttribute('aria-disabled'),
    };
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    notes!.dispatchEvent(modified);
    const afterModified = { prevented: modified.defaultPrevented, path: links.pathname() };
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    notes!.dispatchEvent(plain);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterPlain = { prevented: plain.defaultPrevented, path: links.pathname() };
    links.rendered.update({ current: 'notes' });
    const active = notes!.getAttribute('aria-current');
    await links.close();
    return { initial, afterModified, afterPlain, active };
  })();
  expect(result).toEqual({
    initial: {
      href: '/files/notes',
      className: 'file',
      current: null,
      disabledHref: false,
      disabledAria: 'true',
    },
    afterModified: { prevented: false, path: '/' },
    afterPlain: { prevented: true, path: '/files/notes' },
    active: 'page',
  });
});

it('external and download anchors retain native destinations and click behavior', async () => {
  const result = await (async () => {
    const { mountLinks } = await import('../fixtures/routerLinkFixture');
    const parent = document.createElement('main');
    document.body.append(parent);
    const links = await mountLinks(parent);
    const external = parent.querySelector<HTMLAnchorElement>('a.external')!;
    const download = parent.querySelector<HTMLAnchorElement>('a.download')!;
    const prevented: boolean[] = [];
    parent.addEventListener('click', (event) => {
      prevented.push(event.defaultPrevented);
      // Observe the component's behavior without leaving the test page.
      event.preventDefault();
    });
    for (const anchor of [external, download]) {
      anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    const value = {
      external: external.href,
      download: download.getAttribute('download'),
      href: download.getAttribute('href'),
      prevented,
      pathname: links.pathname(),
    };
    await links.close();
    return value;
  })();
  expect(result).toEqual({
    external: 'https://example.com/report?x=1#part',
    download: '',
    href: '/files/report',
    prevented: [false, false],
    pathname: '/',
  });
});
