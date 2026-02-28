#!/usr/bin/env node
/**
 * Viking Router — Uninstall
 *
 * Restores OpenClaw files from backups, removing the Viking patch.
 *
 * Usage:
 *   node uninstall.js
 *   node uninstall.js --openclaw-dir /path/to/openclaw
 */

const path = require("path");
const { removePatch, findDistDir } = require("./src/patcher");

const args = process.argv.slice(2);
const dirIdx = args.indexOf("--openclaw-dir");
const openclawDir = dirIdx >= 0 ? args[dirIdx + 1] : path.join(__dirname, "..", "..");

console.log("╔══════════════════════════════════════════╗");
console.log("║   Viking Router — Uninstall              ║");
console.log("╚══════════════════════════════════════════╝");
console.log();

const distDir = findDistDir(openclawDir);
if (!distDir) {
    console.error("❌ Could not find OpenClaw dist directory!");
    process.exit(1);
}
console.log(`OpenClaw dist: ${distDir}\n`);

const restored = removePatch(distDir);

if (restored === 0) {
    console.log("No backup files found — nothing to restore.");
} else {
    console.log(`\n✅ Restored ${restored} file(s) to original state.`);
    console.log("   Restart your OpenClaw gateway to apply.");
}
