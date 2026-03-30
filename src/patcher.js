/**
 * Viking Router — Patcher
 *
 * Injects the Viking routing code into OpenClaw's compiled JS files.
 * Injection point: BEFORE `buildEmbeddedSystemPrompt` in `runEmbeddedAttempt`.
 */

const fs = require("fs");
const path = require("path");

const ANCHOR = '\tconst appendPrompt = buildEmbeddedSystemPrompt({';
const PATCH_START = '/* VIKING_ROUTER_PATCH_START */';
const PATCH_END = '/* VIKING_ROUTER_PATCH_END */';

/**
 * Build the inline patch code to be injected.
 * This code runs inside the OpenClaw process at runtime.
 *
 * Optimizations:
 *   1. Heartbeat → skip routing API, minimal tools (0 API calls, ~4000 tok saved)
 *   2. Subagent → route by task desc, aggressive file filtering (only memory.md)
 *   3. Cron → skip routing, keep all tools (avoid breaking scheduled tasks)
 *   4. User messages → LLM routing + L0 summaries for unloaded tools
 */
function buildPatchCode(cfg) {
  const cfgStr = JSON.stringify(cfg);
  return `
${PATCH_START}
// Viking Router v2 — LLM routing + heartbeat/subagent/cron optimization
// https://github.com/your-name/openclaw-viking-router
try {
  var _vCfg = ${cfgStr};
  if (_vCfg.enabled) {
    var _userMsg = (params.prompt || "").trim();
    var _isSlashCmd = /^\\/[a-z]/i.test(_userMsg.trim());

    // --- Detect message source ---
    var _isHeartbeat = /HEARTBEAT|heartbeat_poll|heartbeat_check/i.test(_userMsg);
    var _isSubagent = !!(params.spawnedBy);
    var _isCron = !!(params.sessionKey && typeof params.sessionKey === "string" && params.sessionKey.indexOf("cron") >= 0);

    // ============================================================
    // HEARTBEAT: skip routing, strip to bare minimum
    // ============================================================
    if (_isHeartbeat) {
      console.log("[viking] heartbeat detected — minimal mode");
      var _hbOrigTools = tools.length;
      var _hbOrigFiles = contextFiles ? contextFiles.length : 0;
      // Heartbeat only needs exec (maybe) and session_status
      var _hbTools = ["exec", "session_status", "cron"];
      var _hbFiltered = tools.filter(function(t) { return _hbTools.indexOf(t.name.toLowerCase()) >= 0; });
      tools.splice(0, tools.length, ..._hbFiltered);
      // Remove all contextFiles for heartbeat
      if (contextFiles && contextFiles.length > 0) {
        contextFiles.splice(0, contextFiles.length);
      }
      console.log("[viking] heartbeat: tools " + _hbOrigTools + " -> " + tools.length + ", files " + _hbOrigFiles + " -> 0");

    // ============================================================
    // CRON: skip routing, keep all tools (scheduled tasks need them)
    // ============================================================
    } else if (_isCron) {
      console.log("[viking] cron task — skip routing, keep all tools");
      // Only filter contextFiles: cron tasks don't need SOUL/IDENTITY
      if (contextFiles && contextFiles.length > 0) {
        var _cronEssentialFiles = ["memory.md"];
        var _cronOrigFiles = contextFiles.length;
        var _cronFiltered = contextFiles.filter(function(f) {
          var _fp = typeof f === "string" ? f : (f && f.path ? f.path : "");
          var _fn = _fp.split("/").pop().split("\\\\").pop().toLowerCase();
          return _cronEssentialFiles.some(function(ef) { return _fn === ef; });
        });
        contextFiles.splice(0, contextFiles.length, ..._cronFiltered);
        console.log("[viking] cron files: " + _cronOrigFiles + " -> " + contextFiles.length);
      }

    // ============================================================
    // SUBAGENT: route tools by task, aggressive file filtering
    // ============================================================
    } else if (_isSubagent && _userMsg && !_isSlashCmd) {
      console.log("[viking] subagent (from " + params.spawnedBy + ") — routing by task");

      var _vikingPacks = {
        "base-ext": ["write","edit","apply_patch","grep","find","ls","process"],
        "web": ["web_search","web_fetch"],
        "browser": ["browser"],
        "media": ["canvas","image"],
        "infra": ["cron","gateway","session_status"],
        "agents": ["agents_list","sessions_list","sessions_history","sessions_send","sessions_spawn","subagents"],
        "nodes": ["nodes"]
      };
      var _vikingPackDescs = {
        "base-ext": "File editing, search, directory ops",
        "web": "Web search, fetch pages",
        "browser": "Browser control",
        "media": "Image generation, canvas",
        "infra": "Cron, gateway, status",
        "agents": "Multi-agent, subagent, sessions",
        "nodes": "Device control"
      };
      var _vikingCoreTools = ["read", "exec", "memory_search", "memory_get", "message", "tts"];
      var _packLines = Object.keys(_vikingPackDescs).map(function(k) {
        return "  - " + k + ": " + _vikingPackDescs[k];
      }).join("\\n");
      var _routePrompt = "You are a routing classifier. Given the task description, decide which capability packs are needed.\\n\\nAvailable packs:\\n" + _packLines + "\\n\\nRespond ONLY with JSON: {\\\"packs\\\": [...]}\\nIf simple task needing only read+exec, return {\\\"packs\\\": []}";

      try {
        var _routeRes = await fetch(_vCfg.baseUrl + "/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + _vCfg.apiKey },
          body: JSON.stringify({
            model: _vCfg.modelId,
            messages: [
              { role: "system", content: _routePrompt },
              { role: "user", content: _userMsg.substring(0, 500) }
            ],
            max_tokens: _vCfg.maxTokens || 100,
            temperature: _vCfg.temp || 0
          })
        });
        if (_routeRes.ok) {
          var _routeData = await _routeRes.json();
          var _routeText = (_routeData.choices && _routeData.choices[0] && _routeData.choices[0].message && _routeData.choices[0].message.content) || "";
          var _cleanText = _routeText.replace(/<think>[\\s\\S]*?<\\/think>/gi, "").replace(/\\\`\\\`\\\`(?:json)?/gi, "").trim();
          var _jsonMatch = _cleanText.match(/\\{[^{}]*\\}/);
          if (_jsonMatch) {
            var _route = JSON.parse(_jsonMatch[0]);
            var _selectedPacks = Array.isArray(_route.packs) ? _route.packs : [];
            var _allowedTools = new Set(_vikingCoreTools);
            _selectedPacks.forEach(function(pack) {
              if (_vikingPacks[pack]) _vikingPacks[pack].forEach(function(t) { _allowedTools.add(t); });
            });
            var _origToolCount = tools.length;
            var _filteredTools = tools.filter(function(t) { return _allowedTools.has(t.name.toLowerCase()); });
            tools.splice(0, tools.length, ..._filteredTools);
            console.log("[viking] subagent tools: " + _origToolCount + " -> " + tools.length + " packs=" + JSON.stringify(_selectedPacks));
          }
        }
      } catch(_se) {
        console.log("[viking] subagent route error: " + _se.message);
      }

      // Subagent aggressive file filter: only keep memory.md
      if (contextFiles && contextFiles.length > 0) {
        var _saOrigFiles = contextFiles.length;
        var _saFiltered = contextFiles.filter(function(f) {
          var _fp = typeof f === "string" ? f : (f && f.path ? f.path : "");
          var _fn = _fp.split("/").pop().split("\\\\").pop().toLowerCase();
          return _fn === "memory.md";
        });
        contextFiles.splice(0, contextFiles.length, ..._saFiltered);
        console.log("[viking] subagent files: " + _saOrigFiles + " -> " + contextFiles.length + " (only memory)");
      }

    // ============================================================
    // USER MESSAGE: full LLM routing + L0 summaries
    // ============================================================
    } else if (_userMsg && !_isSlashCmd) {

      var _vikingPacks = {
        "base-ext": ["write","edit","apply_patch","grep","find","ls","process"],
        "web": ["web_search","web_fetch"],
        "browser": ["browser"],
        "media": ["canvas","image"],
        "infra": ["cron","gateway","session_status"],
        "agents": ["agents_list","sessions_list","sessions_history","sessions_send","sessions_spawn","subagents"],
        "nodes": ["nodes"]
      };
      var _vikingPackDescs = {
        "base-ext": "File editing, search, directory ops",
        "web": "Web search, fetch pages",
        "browser": "Browser control",
        "media": "Image generation, canvas",
        "infra": "Cron, gateway, status",
        "agents": "Multi-agent, subagent, sessions",
        "nodes": "Device control"
      };
      var _vikingCoreTools = ["read", "exec", "memory_search", "memory_get", "message", "tts"];

      var _packLines = Object.keys(_vikingPackDescs).map(function(k) {
        return "  - " + k + ": " + _vikingPackDescs[k];
      }).join("\\n");
      var _routePrompt = "You are a routing classifier. Given the user message, decide which capability packs are needed.\\n\\nAvailable packs:\\n" + _packLines + "\\n\\nRespond ONLY with JSON, no explanation: {\\\"packs\\\": [...]}\\nIf just casual chat, return {\\\"packs\\\": []}";

      console.log("[viking] routing: model=" + _vCfg.modelId + " msg=" + _userMsg.substring(0, 50));

      try {
        var _routeRes = await fetch(_vCfg.baseUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + _vCfg.apiKey
          },
          body: JSON.stringify({
            model: _vCfg.modelId,
            messages: [
              { role: "system", content: _routePrompt },
              { role: "user", content: _userMsg }
            ],
            max_tokens: _vCfg.maxTokens || 100,
            temperature: _vCfg.temp || 0
          })
        });

        if (_routeRes.ok) {
          var _routeData = await _routeRes.json();
          var _routeText = (_routeData.choices && _routeData.choices[0] && _routeData.choices[0].message && _routeData.choices[0].message.content) || "";
          console.log("[viking] route raw: " + _routeText.substring(0, 200));

          var _cleanText = _routeText.replace(/<think>[\\s\\S]*?<\\/think>/gi, "").replace(/\\\`\\\`\\\`(?:json)?/gi, "").trim();
          var _jsonMatch = _cleanText.match(/\\{[^{}]*\\}/);
          if (_jsonMatch) {
            try {
              var _route = JSON.parse(_jsonMatch[0]);
              var _selectedPacks = Array.isArray(_route.packs) ? _route.packs : [];
              console.log("[viking] route: packs=" + JSON.stringify(_selectedPacks));

              var _allowedTools = new Set(_vikingCoreTools);
              _selectedPacks.forEach(function(pack) {
                if (_vikingPacks[pack]) {
                  _vikingPacks[pack].forEach(function(t) { _allowedTools.add(t); });
                }
              });

              // Merge preserved tools from config
              if (_vCfg.preserveTools && Array.isArray(_vCfg.preserveTools)) {
                _vCfg.preserveTools.forEach(function(name) { _allowedTools.add(name.toLowerCase()); });
              }

              var _origToolCount = tools.length;
              var _removedNames = [];
              var _filteredTools = tools.filter(function(t) {
                var keep = _allowedTools.has(t.name.toLowerCase());
                if (!keep) _removedNames.push(t.name);
                return keep;
              });
              tools.splice(0, tools.length, ..._filteredTools);

              if (_removedNames.length > 0) {
                tools.push({
                  name: "_viking_unloaded_tools",
                  description: "The following tools are available but their schemas are not loaded to save context. If you need any of them, mention it and the user can re-send: " + _removedNames.join(", "),
                  parameters: { type: "object", properties: {} }
                });
              }

              console.log("[viking] tools: " + _origToolCount + " -> " + tools.length + " (saved " + (_origToolCount - tools.length) + " schemas)");

              if (_selectedPacks.length === 0 && contextFiles && contextFiles.length > 0) {
                var _essentialFiles = ["soul.md", "identity.md", "memory.md"];
                var _origFileCount = contextFiles.length;
                var _filteredFiles = contextFiles.filter(function(f) {
                  var _fp = typeof f === "string" ? f : (f && f.path ? f.path : "");
                  var _fn = _fp.split("/").pop().split("\\\\").pop().toLowerCase();
                  return _essentialFiles.some(function(ef) { return _fn === ef; });
                });
                contextFiles.splice(0, contextFiles.length, ..._filteredFiles);
                console.log("[viking] files: " + _origFileCount + " -> " + contextFiles.length + " (saved " + (_origFileCount - contextFiles.length) + ")");
              }
            } catch(_pe) {
              console.log("[viking] JSON parse error: " + _pe.message);
            }
          }
        } else {
          console.log("[viking] route API error: " + _routeRes.status);
        }
      } catch(_fe) {
        console.log("[viking] fetch error: " + _fe.message);
      }
    }
  }
} catch(_topErr) {
  console.log("[viking] error: " + _topErr.message);
}
${PATCH_END}
`;
}

/**
 * Find the OpenClaw dist directory.
 * Searches upward from current directory.
 */
function findDistDir(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "node_modules", "openclaw", "dist");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Apply the Viking patch to all matching JS files.
 * Returns number of files patched.
 */
function applyPatch(cfg, distDir) {
  if (!distDir) {
    distDir = findDistDir(path.join(__dirname, ".."));
  }
  if (!distDir || !fs.existsSync(distDir)) {
    console.error("[viking-patch] OpenClaw dist directory not found!");
    return 0;
  }

  let patched = 0;
  const files = fs.readdirSync(distDir).filter((f) => f.endsWith(".js"));

  for (const file of files) {
    const filePath = path.join(distDir, file);
    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    if (!content.includes("buildEmbeddedSystemPrompt")) continue;

    console.log(`  Checking: ${file}`);

    // Create backup
    const backupPath = filePath + ".viking-backup";
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath);
    }

    // Always start from backup (clean slate)
    content = fs.readFileSync(backupPath, "utf-8");

    if (!content.includes(ANCHOR)) {
      console.log(`  ⚠ Anchor not found, skipping`);
      continue;
    }

    const occurrences = content.split(ANCHOR).length - 1;
    const patchCode = buildPatchCode(cfg);
    content = content.split(ANCHOR).join(patchCode + ANCHOR);

    fs.writeFileSync(filePath, content, "utf-8");
    console.log(`  ✅ Patched! (${occurrences} injection point(s))`);
    patched++;
  }

  return patched;
}

/**
 * Remove the Viking patch — restore from backups.
 */
function removePatch(distDir) {
  if (!distDir) {
    distDir = findDistDir(path.join(__dirname, ".."));
  }
  if (!distDir || !fs.existsSync(distDir)) {
    console.error("[viking-patch] OpenClaw dist directory not found!");
    return 0;
  }

  let restored = 0;
  const files = fs.readdirSync(distDir).filter((f) => f.endsWith(".viking-backup"));

  for (const backup of files) {
    const original = backup.replace(".viking-backup", "");
    const backupPath = path.join(distDir, backup);
    const originalPath = path.join(distDir, original);

    fs.copyFileSync(backupPath, originalPath);
    fs.unlinkSync(backupPath);
    console.log(`  ✅ Restored: ${original}`);
    restored++;
  }

  return restored;
}

module.exports = { applyPatch, removePatch, findDistDir, buildPatchCode };
