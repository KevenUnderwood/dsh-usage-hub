# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Configurable auto refresh.** The hard-coded 10-minute poll is now the
  `refreshIntervalMs` setting. The settings page offers five steps — 5 s, 60 s,
  10 min, 30 min, 1 h — and the timer switches over immediately, without a page
  reload. Other values fall back to the 10-minute default.
- **A settings page of its own.** The Usage page now carries a gear button in its header;
  it opens this plugin's own settings page (a separate main panel, reachable from the gear
  only — the sidebar still shows a single entry). The page edits the plugin's own profile
  row through DSH's configuration form service, so the configuration value no longer
  has to be written into `cordis.patch.yml` by hand.
- **The configuration field is now volatile.** `refreshIntervalMs` is marked
  `.volatile()` on the host side, which is what makes it editable in the Web UI. It
  reaches the plugin as a live reference, so a change takes effect immediately — no
  restart.
- **The quick refresh button is now a setting.** `showQuickRefresh` (off by default)
  decides whether the status bar at the bottom of the window carries a refresh button.
  Like the interval, it is marked `.volatile()` and takes effect immediately.
- **The token count in the status bar can be spelled out.** The new `tokenDisplay`
  setting (`compact` by default) picks between the abbreviated `120.0K token` and the
  full `120,000 token` for the current session's count in the status bar.

### Changed

- **The status bar no longer carries a refresh button.** The button that used to sit
  next to the quota summary is gone; the `showQuickRefresh` setting brings it back for
  anyone who wants it.
- **A failed save says why.** The settings page used to swallow the host's error and
  show a bare "Save failed"; it now shows the host's own message underneath, and adds a
  "restart DSH" hint when the field is not one the running host knows about yet.
- **Three settings are left.** The auto refresh interval, the quick refresh button and the
  status bar's token spelling are the plugin's only configuration options. `keyRefs`,
  `maxSessions`, `usageCacheMs`,
  `requestTimeoutMs`, `diagnostics` and `diagnosticsPath` are gone; their behaviour is
  now a fixed constant (50 sessions replayed, 30 s aggregation cache, 15 s query
  timeout). The diagnostic log stays in the code but is off — flip `DIAGNOSTICS` in
  `lib/index.js` to use it.
- **Silent refresh.** A refresh no longer shows "Loading…": the previous numbers stay on
  screen until the new ones arrive, the refresh button does not spin, and the status bar
  keeps the last known summary. The same holds for the provider list and the
  cross-session table.
- **The settings page follows the Usage page's look.** Settings are laid out as
  label-and-hint on the left, control on the right, with hairline separators between
  rows and the same card, header, button and colour tokens the Usage page already uses.
- The plugin no longer takes part in DSH's automatic settings page (`settings.configure({
  auto: false })`), so its configuration lives in one place: the gear.
- **The settings page has a single Save button.** "Reset to defaults" is gone, and the
  Save button uses the requested dark-grey look (`#43454a` fill, `#555658` border, white
  text).

## [0.1.0] — 2026-11-01

First release.

### Added

- **Multi-provider usage query.** The host half resolves the provider route of the
  current model, picks the matching adapter and queries that provider's own
  usage endpoint with the credential the harness already holds.
- **Provider adapters** for DeepSeek (API key and signed-in account), Claude,
  ChatGPT (Codex), Kimi For Coding, Zhipu GLM, MiniMax, OpenCode Go,
  GitHub Copilot, OpenRouter, Moonshot, SiliconFlow, Novita AI and StepFun.
- **Generic relay adapter** for self-hosted OpenAI-compatible gateways: tries
  the common New API / one-api, sub2api and plain-balance endpoints in turn.
- **Follows the session model.** The browser half reads the session's
  `modelSelection` projection; switching the model in DSH switches the query
  target without any manual action.
- **Two-panel UI.** The main panel has a *Usage* tab (quota windows with
  progress bars, current-session tokens, cross-session totals by model) and a
  *Providers* tab (the provider directory with credential state). The status bar
  keeps the current provider's summary visible at all times.
- **Cross-session token aggregation** by model, replayed from the session log.

### Notes

- Credential values are resolved inside the host process and never sent to the
  browser; responses carry normalized values plus the credential *reference
  name* only.
- The plugin uses no runtime dependencies. `schemastery` is an optional peer
  used only for the config schema, and the plugin still loads without it.
