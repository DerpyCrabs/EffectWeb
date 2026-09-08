import { mountProfileForm } from './app';
const form = mountProfileForm(document.getElementById('app')!);
if (import.meta.hot) import.meta.hot.dispose(form.dispose);
