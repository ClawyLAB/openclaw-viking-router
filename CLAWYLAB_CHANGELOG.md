# Changelog — ClawyLAB / OpenClaw Viking Router

All notable changes to this fork are documented here.

## [Unreleased]

### Added
- **`preserveTools` config option** — Protect specified tools from Viking's LLM-based routing filter. Tools in this list will always be available to the agent regardless of routing classification.

  **Why:** Viking filters tools BEFORE the agent sees context. Trigger-word systems (e.g. "IF coding, check these tools") depend on certain tools being present for conditions to evaluate. When Viking strips those tools, triggers can't fire. `preserveTools` ensures critical infrastructure tools survive filtering.

  ```json
  {
    "preserveTools": ["sessions_spawn", "sessions_send", "agents_list"]
  }
  ```

  - Added to `DEFAULT_CONFIG` in `src/config.js`
  - Example added to `config/viking-config.example.json`
  - Merge logic added to `src/patcher.js` (USER MESSAGE block) — preserved tools are added to `_allowedTools` after routing decision, before filtering

### Notes
- This fork is maintained by ClawyLAB for internal OpenClaw infrastructure use
- Upstream: https://github.com/13579x/openclaw-viking-router
