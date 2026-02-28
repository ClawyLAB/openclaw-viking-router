/**
 * Viking Router v2 — Core routing logic
 *
 * Uses an LLM to classify which tool packs a user message needs.
 * Inspired by OpenViking's L0/L1/L2 layered context approach:
 *   - Selected tools → full schema (L2)
 *   - Unselected tools → name-only summary (L0)
 *
 * v2 Optimizations:
 *   - Heartbeat → skip routing API, minimal tools (0 API calls)
 *   - Subagent → route by task description, only keep memory.md
 *   - Cron → skip routing, keep all tools, only keep memory.md
 *   - User messages → full LLM routing + L0 summaries
 */

// ===========================
// Tool pack definitions
// ===========================

const CORE_TOOLS = ["read", "exec", "memory_search", "memory_get", "message", "tts"];

const HEARTBEAT_TOOLS = ["exec", "session_status", "cron"];

const TOOL_PACKS = {
    "base-ext": {
        tools: ["write", "edit", "apply_patch", "grep", "find", "ls", "process"],
        desc: "File editing, search, directory ops",
    },
    web: {
        tools: ["web_search", "web_fetch"],
        desc: "Web search, fetch pages",
    },
    browser: {
        tools: ["browser"],
        desc: "Browser control",
    },
    media: {
        tools: ["canvas", "image"],
        desc: "Image generation, canvas",
    },
    infra: {
        tools: ["cron", "gateway", "session_status"],
        desc: "Cron, gateway, status, reminders",
    },
    agents: {
        tools: ["agents_list", "sessions_list", "sessions_history", "sessions_send", "sessions_spawn", "subagents"],
        desc: "Multi-agent, subagent, sessions",
    },
    nodes: {
        tools: ["nodes"],
        desc: "Device control",
    },
};

// ===========================
// Message type detection
// ===========================

/**
 * Detect the type of incoming message.
 * Returns: "heartbeat" | "subagent" | "cron" | "slash" | "user" | "empty"
 */
function detectMessageType(userMessage, params) {
    if (!userMessage || userMessage.trim().length === 0) return "empty";
    if (/^\/[a-z]/i.test(userMessage.trim())) return "slash";
    if (/HEARTBEAT|heartbeat_poll|heartbeat_check/i.test(userMessage)) return "heartbeat";
    if (params && params.spawnedBy) return "subagent";
    if (params && params.sessionKey && typeof params.sessionKey === "string" && params.sessionKey.indexOf("cron") >= 0) return "cron";
    return "user";
}

// ===========================
// Routing prompt builder
// ===========================

function buildRoutingPrompt(userMessage) {
    const packLines = Object.entries(TOOL_PACKS)
        .map(([name, pack]) => `  - ${name}: ${pack.desc}`)
        .join("\\n");

    return "You are a routing classifier. Given the user message, decide which capability packs are needed.\\n\\n"
        + "Available packs:\\n" + packLines
        + "\\n\\nRespond ONLY with JSON, no explanation: {\\\"packs\\\": [...]}\\n"
        + "If just casual chat, return {\\\"packs\\\": []}";
}

// ===========================
// Call routing model
// ===========================

async function callRoutingModel(cfg, userMessage) {
    const routePrompt = buildRoutingPrompt(userMessage);

    const res = await fetch(cfg.baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + cfg.apiKey,
        },
        body: JSON.stringify({
            model: cfg.modelId,
            messages: [
                { role: "system", content: routePrompt },
                { role: "user", content: userMessage.substring(0, 500) },
            ],
            max_tokens: cfg.maxTokens || 100,
            temperature: cfg.temp || 0,
        }),
    });

    if (!res.ok) {
        console.log("[viking] route API error: " + res.status);
        return null;
    }

    const data = await res.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    console.log("[viking] route raw: " + text.substring(0, 200));

    // Strip <think> tags and markdown code fences
    const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
    const match = clean.match(/\{[^{}]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed.packs) ? parsed.packs : [];
}

// ===========================
// Expand packs → tool names
// ===========================

function expandPacks(selectedPacks) {
    const allowed = new Set(CORE_TOOLS);
    for (const pack of selectedPacks) {
        if (TOOL_PACKS[pack]) {
            TOOL_PACKS[pack].tools.forEach((t) => allowed.add(t));
        }
    }
    return allowed;
}

module.exports = {
    CORE_TOOLS,
    HEARTBEAT_TOOLS,
    TOOL_PACKS,
    detectMessageType,
    buildRoutingPrompt,
    callRoutingModel,
    expandPacks,
};
