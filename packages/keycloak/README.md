# @effectweb/keycloak

EffectWeb adapter for the `keycloak-js` SDK. In an Effect scope, call `mountKeycloak(client, initOptions, options?)` with an SDK instance. It initializes the client, exposes an immutable EffectWeb source of authentication/identity/realm roles, and runs scoped token refresh work.

`token()`, `login()` and `logout(redirectUri?)` return Effects. The default refresh interval is 10 seconds, with 30 seconds minimum token validity. Failed background refresh clears authentication. Closing the scope interrupts refresh work, releases the source and restores the SDK event handlers it wrapped.

Tokens stay in the SDK and are obtained only through `token()`; they are never published in snapshots. Realm/client configuration, authorization policy, selected roles, user settings and auth screens belong to the application.

Refresh failures appear as `source.model().refreshError` and fail explicit `token()` requests. Background refresh retries without clearing credentials. Keycloak handles invalid sessions; application logout policy belongs to the consumer.
