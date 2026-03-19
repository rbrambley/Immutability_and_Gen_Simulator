/* -------------------------------------------------------------
   parser.js
   Full calculator-compatible, debug-instrumented parser
   - Handles manual input
   - Handles full Veeam calculator output (incl. GFS-style fields)
   - Synthetic interval is OPTIONAL (index.html injects it)
   ------------------------------------------------------------- */

/* =========================
   MANUAL INPUT PARSER
   ========================= */

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

    const cfg = {
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

    debugLog("Manual Input Values:", JSON.stringify(cfg, null, 2));
    debugLog("=== parseManualInput() COMPLETE ===");
    return cfg;
}


/* =========================
   CALCULATOR OUTPUT PARSER
   ========================= */

function parseCalculatorInput(text) {
    debugLog("=== parseCalculatorInput() START ===");
    debugLog("RAW INPUT:", text);

    if (!text || text.trim().length < 5) {
        debugLog("ERROR: Calculator output empty/short");
        return { valid: false, error: "Calculator output is empty or too short." };
    }

    const lower = text.toLowerCase();

    /* ---------- helpers ---------- */

    function extractNumber(keywords, fallback = null) {
        for (const key of keywords) {
            const idx = lower.indexOf(key);
            if (idx !== -1) {
                const slice = lower.substring(idx, idx + 120);
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
                const slice = lower.substring(idx, idx + 120);
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
                const slice = lower.substring(idx, idx + 120);
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

    function extractYears(keys) {
        for (const key of keys) {
            const idx = lower.indexOf(key);
            if (idx !== -1) {
                const slice = lower.substring(idx, idx + 120);
                const match = slice.match(/(\d+)\s*year/);
                if (match) {
                    const val = parseInt(match[1]);
                    debugLog(`extractYears(${key}) →`, val);
                    return val;
                }
            }
        }
        debugLog(`extractYears MISS for:`, keys.join(", "));
        return null;
    }

    function normalizeSizeGB(val) {
        if (!val && val !== 0) return null;
        let result = val;
        if (lower.includes("tb")) result = val * 1024;
        debugLog("normalizeSizeGB:", val, "→", result);
        return result;
    }

    function extractBoolean(keys) {
        for (const key of keys) {
            const idx = lower.indexOf(key);
            if (idx !== -1) {
                const slice = lower.substring(idx, idx + 80);
                if (slice.includes("true")) {
                    debugLog(`extractBoolean(${key}) → true`);
                    return true;
                }
                if (slice.includes("false")) {
                    debugLog(`extractBoolean(${key}) → false`);
                    return false;
                }
            }
        }
        debugLog(`extractBoolean MISS for:`, keys.join(", "));
        return null;
    }

    /* ---------- core values ---------- */

    const initialSizeGB = normalizeSizeGB(
        extractNumber(["source data", "source size", "initial size", "logical size"])
    );

    const dailyChangeRate = extractPercent(["daily change", "change rate"]);

    const annualGrowthRate = extractPercent(["growth rate", "annual growth", "yearly growth"]);

    const minImmutability = extractDays(["immutability", "immutable"]);

    const blockGenWindow = extractDays(["block generation", "generation window"]);

    // syntheticInterval is OPTIONAL — index.html injects it
    const syntheticInterval = extractDays(["synthetic full interval", "synthetic full", "synthetic"]);

    /* ---------- retention / GFS ---------- */

    const baseRetention = extractNumber(["retention", "restore points"]);

    const dailies = extractNumber(["dailies", "daily backups"]);
    const weeklies = extractNumber(["weeklies", "weekly backups"]);
    const monthlies = extractNumber(["monthlies", "monthly backups"]);
    const yearlies = extractNumber(["yearlies", "yearly backups"]);

    let retention = baseRetention;
    if (!isNaN(dailies) || !isNaN(weeklies) || !isNaN(monthlies) || !isNaN(yearlies)) {
        const d = isNaN(dailies) ? 0 : dailies;
        const w = isNaN(weeklies) ? 0 : weeklies;
        const m = isNaN(monthlies) ? 0 : monthlies;
        const y = isNaN(yearlies) ? 0 : yearlies;
        retention = d + w + m + y;
        debugLog("GFS retention components:", JSON.stringify({ d, w, m, y, total: retention }, null, 2));
    }

    /* ---------- forecast / sim length ---------- */

    const forecastYears = extractYears(["forecast period", "forecast"]);
    let simDays = 365;
    if (!isNaN(forecastYears) && forecastYears > 0) {
        simDays = forecastYears * 365;
    }
    debugLog("Forecast years → simDays:", forecastYears, "→", simDays);

    /* ---------- compression ---------- */

    const compressBy = extractPercent(["compress by", "compression"]);

    /* ---------- backup window ---------- */

    const backupWindowHours = (() => {
        const idx = lower.indexOf("backup window");
        if (idx === -1) {
            debugLog("backup window MISS");
            return null;
        }
        const slice = lower.substring(idx, idx + 80);
        const match = slice.match(/(\d+)\s*hour/);
        if (match) {
            const val = parseInt(match[1]);
            debugLog("backup window hours →", val);
            return val;
        }
        debugLog("backup window parse MISS");
        return null;
    })();

    /* ---------- object / vault / copy / move / archive ---------- */

    const directToObject = extractBoolean(["direct to object storage", "direct to object"]);

    let useVaultPerformance = null;
    let useVaultCapacity = null;
    {
        const key = "use veeam data cloud vault";
        let idx = lower.indexOf(key);
        if (idx !== -1) {
            const slice1 = lower.substring(idx, idx + 80);
            if (slice1.includes("true")) useVaultPerformance = true;
            else if (slice1.includes("false")) useVaultPerformance = false;
            debugLog("useVaultPerformance →", useVaultPerformance);

            const idx2 = lower.indexOf(key, idx + key.length);
            if (idx2 !== -1) {
                const slice2 = lower.substring(idx2, idx2 + 80);
                if (slice2.includes("true")) useVaultCapacity = true;
                else if (slice2.includes("false")) useVaultCapacity = false;
                debugLog("useVaultCapacity →", useVaultCapacity);
            }
        } else {
            debugLog("Vault flags MISS");
        }
    }

    const copyPolicy = extractBoolean(["copy policy"]);
    const movePolicy = extractBoolean(["move policy"]);

    const movePeriodDays = extractNumber(["move period"]);

    const archiveTierEnabled = extractBoolean(["archive tier?"]);
    const archiveMovePeriodDays = (() => {
        const key = "archive tier";
        const idx = lower.indexOf(key);
        if (idx === -1) return null;
        const after = lower.indexOf("move period", idx);
        if (after === -1) return null;
        const slice = lower.substring(after, after + 80);
        const match = slice.match(/(\d+)/);
        if (match) {
            const val = parseInt(match[1]);
            debugLog("archiveMovePeriodDays →", val);
            return val;
        }
        return null;
    })();

    /* ---------- immutability (perf / capacity) ---------- */

    const performanceTierImmutable = extractBoolean(["performance tier immutable"]);
    const capacityTierImmutable   = extractBoolean(["capacity tier immutable"]);

    const performanceTierImmutabilityDays = (() => {
        const key = "performance tier immutable";
        const idx = lower.indexOf(key);
        if (idx === -1) return null;
        const slice = lower.substring(idx, idx + 160);
        const match = slice.match(/immutability period\s+(\d+)\s*day/);
        if (match) {
            const val = parseInt(match[1]);
            debugLog("performanceTierImmutabilityDays →", val);
            return val;
        }
        debugLog("performanceTierImmutabilityDays MISS");
        return null;
    })();

    const capacityTierImmutabilityDays = (() => {
        const key = "capacity tier immutable";
        const idx = lower.indexOf(key);
        if (idx === -1) return null;
        const slice = lower.substring(idx, idx + 160);
        const match = slice.match(/immutability period\s+(\d+)\s*day/);
        if (match) {
            const val = parseInt(match[1]);
            debugLog("capacityTierImmutabilityDays →", val);
            return val;
        }
        debugLog("capacityTierImmutabilityDays MISS");
        return null;
    })();

    /* ---------- assemble config ---------- */

    const cfg = {
        valid: true,
        initialSizeGB,
        dailyChangeRate,
        annualGrowthRate,
        syntheticInterval,   // may be null — allowed
        minImmutability,
        blockGenWindow,
        retention,
        simDays,

        gfsDailies: dailies,
        gfsWeeklies: weeklies,
        gfsMonthlies: monthlies,
        gfsYearlies: yearlies,

        compressBy,
        backupWindowHours,
        directToObject,
        useVaultPerformance,
        useVaultCapacity,
        copyPolicy,
        movePolicy,
        movePeriodDays,
        archiveTierEnabled,
        archiveMovePeriodDays,
        performanceTierImmutable,
        capacityTierImmutable,
        performanceTierImmutabilityDays,
        capacityTierImmutabilityDays
    };

    debugLog("Extracted Values:", JSON.stringify(cfg, null, 2));

    /* ---------- required fields (syntheticInterval OPTIONAL) ---------- */

    const required = {
        initialSizeGB,
        dailyChangeRate,
        annualGrowthRate,
        minImmutability,
        blockGenWindow,
        retention
    };

    for (const [name, val] of Object.entries(required)) {
        if (val === null || isNaN(val)) {
            debugLog("ERROR: Missing required calculator value:", name);
            return { valid: false, error: `Could not extract required value: ${name}` };
        }
    }

    debugLog("syntheticInterval is optional — will be injected by index.html if missing.");

    debugLog("=== parseCalculatorInput() COMPLETE ===");
    return cfg;
}
