import { expect, test } from 'vite-plus/test';
import { Effect, Scope, Exit } from 'effect';
import { mountKeycloak, type KeycloakClient } from './index.js';

test('observes identity, keeps tokens private, and releases event handlers and refresh work', async () => {
  let refreshes = 0;
  let unavailable = false;
  let logouts = 0;
  const original = () => {
    logouts++;
  };
  const client: KeycloakClient = {
    authenticated: false,
    token: 'secret',
    tokenParsed: { preferred_username: 'tester' },
    realmAccess: { roles: ['reader'] },
    onAuthLogout: original,
    init: async () => {
      client.authenticated = true;
      client.onAuthSuccess?.();
      return true;
    },
    updateToken: async () => {
      refreshes++;
      if (unavailable) throw new Error('Network unavailable');
      return true;
    },
    clearToken: () => {
      client.authenticated = false;
      delete client.token;
      client.onAuthLogout?.();
    },
    login: async () => {},
    logout: async () => {
      client.clearToken();
    },
  };
  const scope = Scope.makeUnsafe();
  const auth = await Effect.runPromise(
    mountKeycloak(client, {}, { refreshInterval: 5 }).pipe(Scope.provide(scope)),
  );
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(auth.source.model()).toEqual({
    authenticated: true,
    username: 'tester',
    name: 'tester',
    roles: ['reader'],
    refreshError: undefined,
  });
  expect(Object.isFrozen(client.realmAccess!.roles)).toBe(false);
  expect(await Effect.runPromise(auth.token())).toBe('secret');
  unavailable = true;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(client.token).toBe('secret');
  expect(client.authenticated).toBe(true);
  expect(auth.source.model().refreshError).toBe('Network unavailable');
  expect(logouts).toBe(0);
  unavailable = false;
  await Effect.runPromise(auth.token());
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(auth.source.model().refreshError).toBeUndefined();
  await Effect.runPromise(auth.logout());
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(auth.source.model().authenticated).toBe(false);
  expect(logouts).toBe(1);
  await Effect.runPromise(Scope.close(scope, Exit.void));
  expect(client.onAuthLogout).toBe(original);
  const count = refreshes;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(refreshes).toBe(count);
});
