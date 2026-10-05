export {};

const root = document.documentElement;
const themeButton = document.querySelector<HTMLButtonElement>('.theme-toggle');
const reflectTheme = () =>
  themeButton?.setAttribute(
    'aria-label',
    `Switch to ${root.dataset.theme === 'dark' ? 'light' : 'dark'} theme`,
  );
reflectTheme();
themeButton?.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('effectweb-theme', root.dataset.theme);
  } catch {
    /* Storage may be disabled. */
  }
  reflectTheme();
});
const menu = document.querySelector<HTMLButtonElement>('.menu-toggle');
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  document.body.classList.toggle('menu-open', open);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    document.body.classList.remove('menu-open');
    menu?.setAttribute('aria-expanded', 'false');
    menu?.setAttribute('aria-label', 'Open navigation');
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('.copy-code')) {
  button.addEventListener('click', () => {
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
  });
}
type SearchResult = {
  title: string;
  description: string;
  url: string;
  group: string;
  text: string;
};
const dialog = document.querySelector<HTMLDialogElement>('.search-dialog')!;
const input = document.querySelector<HTMLInputElement>('#search-input')!;
const results = document.querySelector<HTMLDivElement>('#search-results')!;
const status = document.querySelector<HTMLDivElement>('#search-status')!;
let index: SearchResult[] | undefined;
let loading: Promise<void> | undefined;
function renderResults() {
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
document.querySelector('.search-trigger')?.addEventListener('click', openSearch);
input.addEventListener('input', renderResults);
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
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
dialog.addEventListener('keydown', (event) => {
  const links = Array.from(results.querySelectorAll('a'));
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const current = links.findIndex((link) => link === document.activeElement);
    const next =
      event.key === 'ArrowDown' ? current + 1 : current < 0 ? links.length - 1 : current - 1;
    if (next < 0) input.focus();
    else links[Math.min(next, links.length - 1)]?.focus();
  } else if (event.key === 'Enter' && document.activeElement === input) links[0]?.click();
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (dialog.open) dialog.close();
    else openSearch();
  }
});
const headings = Array.from(document.querySelectorAll<HTMLElement>('.prose h2[id]'));
const tocLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.on-this-page nav a'));
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
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(updateContents);
  }
}
if (headings.length) {
  window.addEventListener('scroll', scheduleContents, { passive: true });
  window.addEventListener('resize', scheduleContents);
  window.addEventListener('load', scheduleContents);
  scheduleContents();
}
