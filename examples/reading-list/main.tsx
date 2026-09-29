import { openDB } from 'idb';
import { Effect } from 'effect';
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
  load: Effect.tryPromise({
    try: async () => {
      const db = await database();
      try {
        return ((await db.get('lists', 'entries')) as Entry[] | undefined) ?? [];
      } finally {
        db.close();
      }
    },
    catch: (error) => error,
  }),
  save: (entries) =>
    Effect.tryPromise({
      try: async (signal) => {
        const db = await database();
        try {
          if (signal.aborted) return;
          await db.put('lists', [...entries], 'entries');
        } finally {
          db.close();
        }
      },
      catch: (error) => error,
    }),
};
const stop = mountReadingList(document.getElementById('app')!, storage);
if (import.meta.hot) import.meta.hot.dispose(stop);
