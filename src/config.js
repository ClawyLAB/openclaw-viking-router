/**
 * Viking Router — Configuration loader & validator
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_CONFIG = {
    enabled: true,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelId: "gemini-2.5-flash-lite",
    apiKey: "",
    maxTokens: 100,
    temp: 0,
};

/**
 * Load config from viking-config.json.
 * Searches in order:
 *   1. OpenClaw root / patches / viking-config.json
 *   2. Same directory as this script
 *   3. Environment variables override
 */
function loadConfig(openclawRoot) {
    const candidates = [
        openclawRoot && path.join(openclawRoot, "patches", "viking-config.json"),
        path.join(__dirname, "..", "viking-config.json"),
        path.join(__dirname, "..", "..", "viking-config.json"),
    ].filter(Boolean);

    let cfg = { ...DEFAULT_CONFIG };

    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) {
                const loaded = JSON.parse(fs.readFileSync(p, "utf-8"));
                cfg = { ...cfg, ...loaded };
                cfg._configPath = p;
                break;
            }
        } catch (e) {
            console.log(`[viking] config parse error at ${p}: ${e.message}`);
        }
    }

    // Environment variable overrides
    if (process.env.VIKING_API_KEY) cfg.apiKey = process.env.VIKING_API_KEY;
    if (process.env.VIKING_MODEL) cfg.modelId = process.env.VIKING_MODEL;
    if (process.env.VIKING_BASE_URL) cfg.baseUrl = process.env.VIKING_BASE_URL;
    if (process.env.VIKING_ENABLED === "false") cfg.enabled = false;
    if (process.env.VIKING_ENABLED === "true") cfg.enabled = true;

    return cfg;
}

/**
 * Validate config — warn about missing required fields.
 */
function validateConfig(cfg) {
    const warnings = [];
    if (!cfg.apiKey) warnings.push("apiKey is empty — routing model calls will fail");
    if (!cfg.baseUrl) warnings.push("baseUrl is empty");
    if (!cfg.modelId) warnings.push("modelId is empty");
    return warnings;
}

module.exports = { loadConfig, validateConfig, DEFAULT_CONFIG };
