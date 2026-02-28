#!/usr/bin/env node
/**
 * Viking Router — Install
 *
 * Applies the Viking routing patch to your OpenClaw installation.
 * Run this after installing OpenClaw or updating it.
 *
 * Usage:
 *   node install.js
 *   node install.js --openclaw-dir /path/to/openclaw
 */

const path = require("path");
const { loadConfig, validateConfig } = require("./src/config");
const { applyPatch, findDistDir } = require("./src/patcher");

// Parse --openclaw-dir argument
const args = process.argv.slice(2);
const dirIdx = args.indexOf("--openclaw-dir");
const openclawDir = dirIdx >= 0 ? args[dirIdx + 1] : path.join(__dirname, "..", "..");

console.log("╔══════════════════════════════════════════╗");
console.log("║   Viking Router — Install                ║");
console.log("║   Token-saving router for OpenClaw       ║");
console.log("╚══════════════════════════════════════════╝");
console.log();

// Load config
const cfg = loadConfig(openclawDir);
console.log(`Config: enabled=${cfg.enabled} model=${cfg.modelId}`);
if (cfg._configPath) {
    console.log(`Config loaded from: ${cfg._configPath}`);
}

// Validate
const warnings = validateConfig(cfg);
if (warnings.length > 0) {
    console.log("\n⚠ Configuration warnings:");
    warnings.forEach((w) => console.log(`  - ${w}`));
    console.log();
}

// Find dist dir
const distDir = findDistDir(openclawDir);
if (!distDir) {
    console.error("❌ Could not find OpenClaw dist directory!");
    console.error("   Make sure you are running this from inside your OpenClaw directory,");
    console.error("   or use: node install.js --openclaw-dir /path/to/openclaw");
    process.exit(1);
}
console.log(`OpenClaw dist: ${distDir}\n`);

// Apply patch
const patched = applyPatch(cfg, distDir);

if (patched === 0) {
    console.log("\n⚠ No files patched! Check if OpenClaw is installed correctly.");
} else {
    console.log(`\n✅ Done! Patched ${patched} file(s).`);
    console.log("   Restart your OpenClaw gateway to apply.\n");
    console.log("   To uninstall: node uninstall.js");
}
