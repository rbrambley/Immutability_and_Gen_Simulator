/* -------------------------------------------------------------
   parser.js
   Minimalist input acquisition + normalization module
   ------------------------------------------------------------- */

function parseManualInput() {
    const get = id => document.getElementById(id).value.trim();

    const initialSizeGB      = parseFloat(get("initialSize"));
    const dailyChangeRate    = parseFloat(get("dailyChange")) / 100;
    const annualGrowthRate   = parseFloat(get("annualGrowth")) / 100;
    const syntheticInterval  = parseInt(get("syntheticInterval"));
    const minImmutability    = parseInt(get("immutability"));
    const blockGenWindow     = parseInt(get("blockGen"));
    const retention          = parseInt(get("retention"));
    const simDays            = parseInt(get("simDays"));

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
            return { valid: false, error: `Missing or invalid value: ${name}` };
        }
    }

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
   ------------------------------------------------------------- */

function parseCalculatorInput(text) {
    if (!text || text.trim().length < 5) {
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
                    return parseFloat(match[1].replace(/,/g, ""));
                }
            }
        }
        return fallback;
    }

    function extractPercent(keys) {
        for (const key of keys) {
            const idx = lower.indexOf(key);
            if (idx !== -1) {
                const slice = lower.substring(idx, idx + 80);
                const match = slice.match(/([\d,.]+)\s*%/);
                if (match) return parseFloat(match[1]) / 100;
            }
        }
        return null;
    }

    function extractDays(keys) {
        for (const key of keys) {
            const idx = lower.indexOf(key);
            if (idx !== -1) {
                const slice = lower.substring(idx, idx + 80);
                const match = slice.match(/(\d+)\s*day/);
                if (match) return parseInt(match[1]);
            }
        }
        return null;
    }

    function normalizeSize(val) {
        if (!val) return null;
        if (lower.includes("tb")) return val * 1024;
        return val;
    }

    const initialSizeGB     = normalizeSize(extractNumber(["source size", "initial size", "logical size"]));
    const dailyChangeRate   = extractPercent(["daily change", "change rate"]);
    const annualGrowthRate  = extractPercent(["annual growth", "yearly growth"]);
    const retention         = extractNumber(["retention", "restore points"]);
    const minImmutability   = extractDays(["immutability", "immutable"]);
    const blockGenWindow    = extractDays(["block generation", "generation window"]);
    const syntheticInterval = extractDays(["synthetic", "synthetic full"]);
    const simDays           = 365;

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
            return { valid: false, error: `Could not extract required value: ${name}` };
        }
    }

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
