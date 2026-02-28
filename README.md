# Viking Router

**Token-saving router for OpenClaw** — Uses a lightweight LLM to classify each message and dynamically filter tool schemas & context files, reducing token consumption by ~30-40%.

Inspired by [OpenViking](https://github.com/volcengine/OpenViking)'s L0/L1/L2 layered context approach.

## How It Works

```
User message → Viking Router → detect message type
                                  ├─ Heartbeat → skip API, minimal tools (3), no files
                                  ├─ Cron      → skip API, keep all tools, only memory.md
                                  ├─ Subagent  → route by task, only memory.md
                                  └─ User msg  → LLM routing, L0 summaries for unloaded tools
```

### v2 Smart Routing Table

| Message Type | Detection | Tools | Files | API Calls |
|-------------|-----------|-------|-------|-----------|
| **Heartbeat** | prompt contains "HEARTBEAT" | exec, session_status, cron (3) | none | **0** |
| **Cron** | sessionKey contains "cron" | all (avoid breaking tasks) | memory.md only | **0** |
| **Subagent** | params.spawnedBy exists | LLM routes by task desc | memory.md only | 1 |
| **User message** | default | LLM routes by content | filtered by packs | 1 |
| **Slash command** | starts with `/` | all (bypass routing) | all | **0** |

### Token Savings Breakdown

| Scenario | Before | After | Saved |
|----------|--------|-------|-------|
| Casual chat | ~15k input | ~4-5k input | **~65%** |
| Heartbeat | ~15k input | ~1k input | **~93%** |
| Subagent | ~7k input | ~2k input | **~70%** |
| Coding task | ~15k input | ~8k input | **~45%** |

## Installation

### 1. Clone into your OpenClaw directory

```bash
cd /path/to/openclaw
git clone https://github.com/your-name/openclaw-viking-router.git patches/viking-router
```

### 2. Create config file

```bash
cp patches/viking-router/config/viking-config.example.json patches/viking-config.json
```

Edit `patches/viking-config.json`:

```json
{
    "enabled": true,
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
    "modelId": "gemini-2.5-flash-lite",
    "apiKey": "YOUR_API_KEY_HERE",
    "maxTokens": 100,
    "temp": 0
}
```

#### Supported routing models

| Model | Provider | Free | Speed |
|-------|----------|------|-------|
| `gemini-2.5-flash-lite` | Google AI Studio | ✅ | ~3s |
| `gemini-2.0-flash-lite` | Google AI Studio | ✅ | ~2s |
| `gpt-4o-mini` | OpenAI | ❌ | ~2s |
| Any OpenAI-compatible | Any provider | varies | varies |

### 3. Install (apply patch)

```bash
node patches/viking-router/install.js
```

### 4. Auto-patch after OpenClaw updates

Add to your root `package.json`:

```json
{
  "scripts": {
    "postinstall": "node patches/viking-router/install.js"
  }
}
```

### 5. Restart gateway

```bash
openclaw gateway restart
```

## Verification

After restarting, send messages and check the logs:

```
# User message
[viking] routing: model=gemini-2.5-flash-lite msg=你好
[viking] route raw: {"packs": []}
[viking] tools: 21 -> 7 (saved 14 schemas)
[viking] files: 8 -> 3 (saved 5)

# Heartbeat
[viking] heartbeat detected — minimal mode
[viking] heartbeat: tools 21 -> 3, files 8 -> 0

# Subagent
[viking] subagent (from main) — routing by task
[viking] subagent tools: 21 -> 6 packs=["base-ext"]
[viking] subagent files: 8 -> 1 (only memory)

# Cron
[viking] cron task — skip routing, keep all tools
[viking] cron files: 8 -> 1
```

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Enable/disable routing |
| `baseUrl` | Google AI Studio | OpenAI-compatible API endpoint |
| `modelId` | `gemini-2.5-flash-lite` | Routing model ID |
| `apiKey` | - | API key for routing model |
| `maxTokens` | `100` | Max tokens for routing response |
| `temp` | `0` | Temperature for routing model |

### Environment variable overrides

```bash
export VIKING_API_KEY=your_key
export VIKING_MODEL=gemini-2.5-flash-lite
export VIKING_BASE_URL=https://...
export VIKING_ENABLED=true
```

## Tool Packs

| Pack | Tools | Description |
|------|-------|-------------|
| *(core, always loaded)* | `read`, `exec`, `memory_search`, `memory_get`, `message`, `tts` | Basic operations |
| `base-ext` | `write`, `edit`, `grep`, `find`, `ls`, `process` | File editing & search |
| `web` | `web_search`, `web_fetch` | Web search & fetch |
| `browser` | `browser` | Browser control |
| `media` | `canvas`, `image` | Image generation |
| `infra` | `cron`, `gateway`, `session_status` | System management |
| `agents` | `agents_list`, `sessions_*`, `subagents` | Multi-agent |
| `nodes` | `nodes` | Device control |

## Uninstall

```bash
node patches/viking-router/uninstall.js
```

## License

MIT
