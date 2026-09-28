import { Effect } from 'effect';
import type Keycloak from 'keycloak-js';
import type { KeycloakInitOptions } from 'keycloak-js';
import { projectionSource } from 'effectweb';
import { shareValue } from 'effectweb/share';

export interface AuthSnapshot {
  readonly authenticated: boolean;
  readonly username: string;
  readonly name: string;
  readonly roles: readonly string[];
  readonly refreshError: string | undefined;
}
export type KeycloakClient = Pick<
  Keycloak,
  | 'init'
  | 'updateToken'
  | 'clearToken'
  | 'login'
  | 'logout'
  | 'authenticated'
  | 'token'
  | 'tokenParsed'
  | 'idTokenParsed'
  | 'realmAccess'
  | 'onAuthSuccess'
  | 'onAuthLogout'
  | 'onAuthRefreshSuccess'
  | 'onAuthRefreshError'
>;
const asError = (value: unknown) => (value instanceof Error ? value : new Error(String(value)));
/** Own SDK event observation and refresh work in an Effect scope. Tokens never enter snapshots. */
export const mountKeycloak = (
  client: KeycloakClient,
  init: KeycloakInitOptions,
  options: { refreshInterval?: number; minValidity?: number } = {},
) =>
  Effect.gen(function* () {
    let refreshError: string | undefined;
    const interval = options.refreshInterval ?? 10_000;
    if (!Number.isFinite(interval) || interval <= 0)
      return yield* Effect.fail(new RangeError('refreshInterval must be positive and finite'));
    const source = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const source = projectionSource<AuthSnapshot>({
          project: () => ({
            authenticated: !!client.authenticated,
            username: String(
              client.idTokenParsed?.preferred_username ??
                client.tokenParsed?.preferred_username ??
                '',
            ),
            name: String(
              client.idTokenParsed?.name ?? client.tokenParsed?.preferred_username ?? '',
            ),
            roles: [...(client.realmAccess?.roles ?? [])],
            refreshError,
          }),
          reconcile: (previous, next) => shareValue<AuthSnapshot>(previous, next),
        });
        const events = [
          'onAuthSuccess',
          'onAuthLogout',
          'onAuthRefreshSuccess',
          'onAuthRefreshError',
        ] as const;
        const restore = events.map((event) => {
          const previous = client[event];
          const handler = () => {
            try {
              previous?.();
            } finally {
              source.changed();
            }
          };
          client[event] = handler;
          return () => {
            if (client[event] === handler) {
              if (previous) client[event] = previous;
              else delete client[event];
            }
          };
        });
        return {
          source,
          dispose: () => {
            restore.forEach((stop) => stop());
            source.dispose();
          },
        };
      }),
      (owner) => Effect.sync(owner.dispose),
    );
    yield* Effect.tryPromise({ try: () => client.init(init), catch: asError });
    source.source.start();
    const token = () =>
      Effect.tryPromise({
        try: async () => {
          await client.updateToken(options.minValidity ?? 30);
          if (!client.token || !client.authenticated)
            throw new Error('Authentication session expired');
          return client.token;
        },
        catch: asError,
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            refreshError = undefined;
            source.source.changed();
          }),
        ),
        Effect.tapError((error) =>
          Effect.sync(() => {
            refreshError = error.message;
            source.source.changed();
          }),
        ),
      );
    yield* Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(interval);
        if (client.authenticated) {
          // Keycloak handles invalid sessions itself. Temporary transport failures are observable
          // and retried without discarding credentials or forcing the application's logout policy.
          yield* token().pipe(Effect.catch(() => Effect.void));
        }
      }
    }).pipe(Effect.forkScoped);
    return {
      source: source.source,
      token,
      login: () => Effect.tryPromise({ try: () => client.login(), catch: asError }),
      logout: (redirectUri?: string) =>
        Effect.tryPromise({
          try: () => client.logout(redirectUri ? { redirectUri } : undefined),
          catch: asError,
        }),
    };
  });
