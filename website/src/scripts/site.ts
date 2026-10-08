// Progressive enhancements: theme, mobile navigation, copy buttons, search and the contents
// list. The client router swaps pages in place, so page-specific handlers are bound on every
// `astro:page-load`; document-level listeners are bound once.
export {};

type SearchResult = {
  title: string;
  description: string;
  url: string;
  group: string;
  text: string;
};
const root = document.documentElement;
let index: SearchResult[] | undefined;
let loading: Promise<void> | undefined;
const query = <T extends Element>(selector: string) => document.querySelector<T>(selector);

const applyTheme = () => {
  try {
    const stored = localStorage.getItem('effectweb-theme');
    root.dataset.theme =
      stored || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch {
    /* Storage may be disabled. */
  }
};
// The web fonts have no ⌘; only Mac system fonts render it well, and only Macs use it.
const reflectShortcut = () => {
  if (!/Mac|iPhone|iPad/u.test(navigator.platform)) return;
  const key = query<HTMLElement>('.search-trigger kbd');
  if (key) key.textContent = '⌘ K';
};
const reflectTheme = () =>
  query<HTMLButtonElement>('.theme-toggle')?.setAttribute(
    'aria-label',
    `Switch to ${root.dataset.theme === 'dark' ? 'light' : 'dark'} theme`,
  );
const closeMenu = () => {
  document.body.classList.remove('menu-open');
  const menu = query<HTMLButtonElement>('.menu-toggle');
  menu?.setAttribute('aria-expanded', 'false');
  menu?.setAttribute('aria-label', 'Open navigation');
};

function renderResults() {
  const input = query<HTMLInputElement>('#search-input')!;
  const results = query<HTMLDivElement>('#search-results')!;
  const status = query<HTMLDivElement>('#search-status')!;
  const terms = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const ranked = (index ?? [])
    .map((item) => {
      const title = item.title.toLowerCase();
      const haystack = `${title} ${item.description} ${item.text}`.toLowerCase();
      return {
        item,
        score: terms.every((term) => haystack.includes(term))
          ? terms.reduce((n, term) => n + (title === term ? 100 : title.includes(term) ? 20 : 1), 0)
          : -1,
      };
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  results.replaceChildren();
  for (const { item } of ranked) {
    const link = document.createElement('a');
    link.href = item.url;
    const group = document.createElement('small');
    group.textContent = item.group;
    const title = document.createElement('strong');
    title.textContent = item.title;
    const description = document.createElement('span');
    description.textContent = item.description;
    link.append(group, title, description);
    results.append(link);
  }
  status.textContent = ranked.length
    ? `${ranked.length} results`
    : 'No results. Try “tasks”, “forms”, or an API name.';
}
function openSearch() {
  const dialog = query<HTMLDialogElement>('.search-dialog')!;
  const input = query<HTMLInputElement>('#search-input')!;
  const status = query<HTMLDivElement>('#search-status')!;
  if (!dialog.open) dialog.showModal();
  input.focus();
  if (index) {
    renderResults();
    return;
  }
  status.textContent = 'Loading documentation…';
  loading ??= fetch('/search.json')
    .then(async (response) => {
      if (!response.ok) throw new Error('Search unavailable');
      index = (await response.json()) as SearchResult[];
      renderResults();
    })
    .catch(() => {
      status.textContent = 'Search could not load. Close and reopen to retry.';
      loading = undefined;
    });
}

let headings: HTMLElement[] = [];
let tocLinks: HTMLAnchorElement[] = [];
let scheduled = false;
function updateContents() {
  scheduled = false;
  let current = headings[0];
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top > 140) break;
    current = heading;
  }
  for (const link of tocLinks) {
    const active = link.getAttribute('href') === `#${current?.id}`;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}
function scheduleContents() {
  if (!headings.length || scheduled) return;
  scheduled = true;
  requestAnimationFrame(updateContents);
}

// Bound once: these read the current page's elements when they fire.
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  if (target.closest('.theme-toggle')) {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('effectweb-theme', root.dataset.theme);
    } catch {
      /* Storage may be disabled. */
    }
    reflectTheme();
  } else if (target.closest('.menu-toggle')) {
    const menu = target.closest<HTMLButtonElement>('.menu-toggle')!;
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    document.body.classList.toggle('menu-open', open);
  } else if (target.closest('.search-trigger')) openSearch();
  else if (target.closest('.copy-code')) {
    const button = target.closest<HTMLButtonElement>('.copy-code')!;
    const text = button.closest('.code-block')?.querySelector('code')?.textContent ?? '';
    navigator.clipboard.writeText(text).then(
      () => {
        button.textContent = 'Copied!';
      },
      () => {
        button.textContent = 'Select code to copy';
      },
    );
    window.setTimeout(() => {
      button.textContent = 'Copy';
    }, 2000);
  } else if (target.closest('#search-results a'))
    query<HTMLDialogElement>('.search-dialog')?.close();
  else if (target.matches('dialog.search-dialog')) {
    const dialog = target as HTMLDialogElement;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  }
});
document.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.id === 'search-input')
    renderResults();
});
document.addEventListener('keydown', (event) => {
  const dialog = query<HTMLDialogElement>('.search-dialog');
  if (event.key === 'Escape') {
    closeMenu();
    if (dialog?.open) dialog.close();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (dialog?.open) dialog.close();
    else openSearch();
    return;
  }
  if (!dialog?.open) return;
  const input = query<HTMLInputElement>('#search-input')!;
  const links = Array.from(dialog.querySelectorAll('a'));
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const current = links.findIndex((link) => link === document.activeElement);
    const next =
      event.key === 'ArrowDown' ? current + 1 : current < 0 ? links.length - 1 : current - 1;
    if (next < 0) input.focus();
    else links[Math.min(next, links.length - 1)]?.focus();
  } else if (event.key === 'Enter' && document.activeElement === input) links[0]?.click();
});
window.addEventListener('scroll', scheduleContents, { passive: true });
window.addEventListener('resize', scheduleContents);

// The theme attribute lives on <html>, which the router replaces: restore it before paint.
document.addEventListener('astro:after-swap', applyTheme);
document.addEventListener('astro:page-load', () => {
  reflectTheme();
  reflectShortcut();
  closeMenu();
  query<HTMLDialogElement>('.search-dialog')?.close();
  headings = Array.from(document.querySelectorAll<HTMLElement>('.prose h2[id]'));
  tocLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.on-this-page nav a'));
  scheduleContents();
});
