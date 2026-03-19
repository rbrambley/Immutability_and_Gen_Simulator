/* -------------------------------------------------------------
   parser.js
   Minimalist input acquisition + normalization module
   Debug‑instrumented version (no functional changes)
   ------------------------------------------------------------- */

function parseManualInput() {
    debugLog("=== parseManualInput() START ===");

    const get = id => document.getElementById(id).value.trim();

    const initialSizeGB      = parseFloat(get("initialSize"));
    const dailyChangeRate    = parseFloat(get("dailyChange")) / 100;
    const annualGrowthRate   = parseFloat(get("annualGrowth")) / 100;
    const syntheticInterval  = parseInt(get("syntheticInterval"));
    const minImmutability    = parseInt(get("immutability"));
    const blockGenWindow     = parseInt(get("blockGen"));
    const retention          = parseInt(get("retention"));
    const simDays            = parseInt(get("simDays"));

    debugLog("Manual Input Values:", JSON.stringify({
        initialSizeGB,
        dailyChangeRate,
        annualGrowthRate,
        syntheticInterval,
        minImmutability,
        blockGenWindow,
        retention,
        simDays
    }, null, 2));

    const required = [
        ["Initial Logical Size", initialSizeGB],
        ["Daily Change Rate", dailyChangeRate],
        ["Annual Growth Rate", annualGrowthRate],
        ["Synthetic Full Interval", syntheticInterval],
        ["Minimum Immutability", minImmutability],
        ["Block Generation Window", blockGenWindow],
        ["Job Retention", retention],
        ["Simulation Days", simDays]
    ];

    for (const [name, val] of required) {
        if (isNaN(val) || val < 0) {
            debugLog("ERROR: Missing or invalid manual value:", name);
            return { valid: false, error: `Missing or invalid value: ${name}` };
        }
    }

    debugLog("=== parseManualInput() COMPLETE ===");

    return {
        valid: true,
        initialSizeGB,
        dailyChangeRate,
        annualGrowthRate,
        syntheticInterval,
        minImmutability,
        blockGenWindow,
        retention,
        simDays
    };
}


/* -------------------------------------------------------------
   Calculator Output Parser
   - Accepts messy, multi-line text
   - Extracts values using keyword proximity
   - Normalizes units (GB/TB, %, days)
   Debug‑instrumented version (no functional changes)
   ------------------------------------------------------------- */

function parseCalculatorInput(text) {
    debugLog("=== parseCalculatorInput() START ===");
    debugLog("RAW INPUT:", text);

    if (!text || text.trim().length < 5) {
        debugLog("ERROR: Calculator output empty/short");
        return { valid: false, error: "Calculator output is empty or too short." };
    }

    const lower = text.toLowerCase();

    function extractNumber(keywords, fallback = null) {
        for (const key of keywords) {
            const idx = lower.indexOf(key);
            if (idx !== -1) {
                const slice = lower.substring(idx, idx + 80);
                const match = slice.match(/([\d,.]+)/);
                if (match) {
                    const val = parseFloat(match[1].replace(/,/g, ""));
                    debugLog(`extractNumber(${key}) →`, val);
                    return val;
                }
            }
        }
        debugLog(`extractNumber MISS for:`, keywords.join(", "));
        return fallback;
    }

    function extractPercent(keys) {
        for (const key of keys) {
            const idx = lower.indexOf(key);
            if (idx !== -1) {
                const slice = lower.substring(idx, idx + 80);
                const match = slice.match(/([\d,.]+)\s*%/);
                if (match) {
                    const val = parseFloat(match[1]) / 100;
                    debugLog(`extractPercent(${key}) →`, val);
                    return val;
                }
            }
        }
        debugLog(`extractPercent MISS for:`, keys.join(", "));
        return null;
    }

    function extractDays(keys) {
        for (const key of keys) {
            const idx = lower.indexOf(key);
            if (idx !== -1) {
                const slice = lower.substring(idx, idx + 80);
                const match = slice.match(/(\d+)\s*day/);
                if (match) {
                    const val = parseInt(match[1]);
                    debugLog(`extractDays(${key}) →`, val);
                    return val;
                }
            }
        }
        debugLog(`extractDays MISS for:`, keys.join(", "));
        return null;
    }

    function normalizeSize(val) {
        if (!val) return null;
        const result = lower.includes("tb") ? val * 1024 : val;
        debugLog("normalizeSize:", val, "→", result);
        return result;
    }

    const initialSizeGB     = normalizeSize(extractNumber(["source size", "initial size", "logical size"]));
    const dailyChangeRate   = extractPercent(["daily change", "change rate"]);
    const annualGrowthRate  = extractPercent(["annual growth", "yearly growth"]);
    const retention         = extractNumber(["retention", "restore points"]);
    const minImmutability   = extractDays(["immutability", "immutable"]);
    const blockGenWindow    = extractDays(["block generation", "generation window"]);
    const syntheticInterval = extractDays(["synthetic", "synthetic full"]);
    const simDays           = 365;

    debugLog("Extracted Values:", JSON.stringify({
        initialSizeGB,
        dailyChangeRate,
        annualGrowthRate,
        retention,
        minImmutability,
        blockGenWindow,
        syntheticInterval,
        simDays
    }, null, 2));

    const required = {
        initialSizeGB,
        dailyChangeRate,
        annualGrowthRate,
        retention,
        minImmutability,
        blockGenWindow,
        syntheticInterval
    };

    for (const [name, val] of Object.entries(required)) {
        if (val === null || isNaN(val)) {
            debugLog("ERROR: Missing required calculator value:", name);
            return { valid: false, error: `Could not extract required value: ${name}` };
        }
    }

    debugLog("=== parseCalculatorInput() COMPLETE ===");

    return {
        valid: true,
        initialSizeGB,
        dailyChangeRate,
        annualGrowthRate,
        retention,
        minImmutability,
        blockGenWindow,
        syntheticInterval,
        simDays
    };
}
