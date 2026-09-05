import { openDB } from 'idb';
import { fromPromise } from 'effectweb';
import { mountReadingList, type Entry, type Storage } from './app';
import './style.css';

// Only this storage adapter knows that IndexedDB's library interface returns Promises.
const database = () =>
  openDB('effect-reading-list', 1, {
    upgrade: (db) => {
      db.createObjectStore('lists');
    },
  });
const storage: Storage = {
  load: fromPromise(async () => {
    const db = await database();
    try {
      return ((await db.get('lists', 'entries')) as Entry[] | undefined) ?? [];
    } finally {
      db.close();
    }
  }),
  save: (entries) =>
    fromPromise(async (signal) => {
      const db = await database();
      try {
        if (signal.aborted) return;
        await db.put('lists', [...entries], 'entries');
      } finally {
        db.close();
      }
    }),
};
const stop = mountReadingList(document.getElementById('app')!, storage);
if (import.meta.hot) import.meta.hot.dispose(stop);
