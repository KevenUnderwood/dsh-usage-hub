# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
