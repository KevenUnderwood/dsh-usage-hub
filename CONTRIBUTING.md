# Contributing

Thanks for considering a contribution. This plugin is small on purpose: a host half that
resolves the provider and a client half that draws it.

## Before you open a pull request

```sh
npm test
```

That runs two suites, both of which work without a harness:

- `tools/smoke-test.mjs` — every response parser, the provider registry and the session-log
  aggregation.
- `tools/client-check.mjs` — mounts the client bundle in a minimal DOM/React stand-in and
  renders the page: locale keys, the two tabs, the scroll container.

Please add a case to the suite with every behaviour change. The parsers are the part most
likely to break silently when a vendor tweaks a response, so they are the part most worth
testing.

## Adding a provider

All of it lives in `lib/providers.js`:

1. Write a parser that folds the upstream response into `tiers` (percentage windows) or
   `balances` (money). Both shapes are plain objects — see `parseCodingPlanTiers` and
   `parseDeepSeekBalance` for the two idioms.
2. Add an adapter to `PROVIDER_ADAPTERS`. The `bearerAdapter` / `rawKeyAdapter` /
   `tokenAdapter` helpers cover the three common auth-header styles; use `customAdapter`
   when the request needs more than a URL and a header.
3. Declare the credential references the provider accepts. `resolve()` falls back to the
   environment variable of the same name.
4. Add the route to `aliases` if the harness knows the provider under a second name.
5. Add a row to the provider table in both READMEs, and a case to `tools/smoke-test.mjs`.

A provider with **no public usage endpoint** should still be listed as unsupported rather
than silently dropped: return an error message the panel can show.

## Adding a relay (self-hosted gateway)

`RELAY_ADAPTER` already tries the common shapes (`/api/user/self`, `/v1/usage`,
`/api/usage`, `/user/balance`). Extend `RELAY_ENDPOINTS` with a new entry rather than
hard-coding a provider.

## Style

- The code and the comments are in Chinese; the UI strings live in both Chinese and English
  in `lib/client.js`. Keep them in sync.
- The plugin has **no build step**. `lib/client.js` is the bundle format DSH expects, so
  whatever you write there is what ships. Do not add a bundler.
- Keep the host half free of runtime dependencies. `schemastery` is an optional peer used
  only for the config schema, and the plugin must still load without it.
- Credential **values** must never reach the browser. Responses carry normalized numbers
  and the credential *reference name* only.

## Reporting a provider that does not work

Open an issue with the provider route, the DSH version and the exact error the panel shows.
If the endpoint is undocumented, a raw response sample (with your key removed) is worth far
more than a description of the symptom.
