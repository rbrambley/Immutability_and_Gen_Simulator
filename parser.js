/* -------------------------------------------------------------
   parser.js — Veeam Calculator Paste Parser (Rich Edition)
   -------------------------------------------------------------
   - Accepts raw pasted text from Veeam sizing calculator
   - Handles partial / scenario-specific sections
   - Extracts ALL possible fields
   - Normalizes ONLY fields required by simulator:
       * initialSizeGB
       * dailyChangeRate
       * annualGrowthRate
       * retention
       * blockGenWindow
       * performanceTierImmutabilityDays (as minImmutability)
       * syntheticInterval (default 7 if missing)
       * simDays
   - Everything else is passed through as raw strings/values
   ------------------------------------------------------------- */

function parseCalculatorInput(rawText) {
    if (!rawText || typeof rawText !== "string") {
        return { ok: false, error: "No input text provided." };
    }

    // -----------------------------
    // Normalize and split lines
    // -----------------------------
    const lines = rawText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0);

    // -----------------------------
    // Helper: find first numeric in a window
    // -----------------------------
    function findNextValue(startIndex, maxLookahead = 4) {
        for (let i = 1; i <= maxLookahead; i++) {
            const idx = startIndex + i;
            if (idx >= lines.length) break;
            const v = lines[idx];
            if (v && v.length > 0) return v;
        }
        return null;
    }

    // -----------------------------
    // Raw extracted fields (may be strings)
    // -----------------------------
    const raw = {
        // Source data
        initialSize: null,          // e.g. "1.0 TB"
        dailyChangeRate: null,      // e.g. "5.0 %"

        // Protection policy
        backupWindow: null,         // e.g. "8 hours"
        directToObject: null,       // "True"/"False"
        useVaultPerformance: null,  // "True"/"False"

        // Capacity tier
        useVaultCapacity: null,     // "True"/"False"
        copyPolicy: null,           // "True"/"False"
        movePolicy: null,           // "True"/"False"
        movePeriodDays: null,       // e.g. "14"

        // Archive tier
        archiveEnabled: null,       // "True"/"False"
        archiveMovePeriodDays: null,// e.g. "90"

        // Immutability
        performanceTierImmutable: null,          // "True"/"False"
        performanceTierImmutabilityPeriod: null, // e.g. "14 days"
        capacityTierImmutable: null,            // "True"/"False"
        capacityTierImmutabilityPeriod: null,   // e.g. "14 days"

        // Retention
        dailies: null,   // "14 dailies"
        weeklies: null,  // "6 weeklies"
        monthlies: null, // "12 monthlies"
        yearlies: null,  // "3 yearlies"

        // Advanced
        compressBy: null,          // "50.0 %"
        blockGenerationPeriod: null, // "10 days"

        // Estimation
        growthRate: null,          // "5.0 %"
        forecastPeriod: null       // "3 years"
    };

    // Track which immutability block we're in
    let currentImmutabilityScope = null; // "performance" | "capacity" | null

    // -----------------------------
    // Main scan loop
    // -----------------------------
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();

        // SOURCE DATA
        if (line === "source data") {
            const v = findNextValue(i);
            if (v) raw.initialSize = v;
            continue;
        }

        if (line === "daily change rate") {
            const v = findNextValue(i);
            if (v) raw.dailyChangeRate = v;
            continue;
        }

        // PROTECTION POLICY
        if (line === "backup window") {
            const v = findNextValue(i);
            if (v) raw.backupWindow = v;
            continue;
        }

        if (line === "direct to object storage?") {
            const v = findNextValue(i);
            if (v) raw.directToObject = v;
            continue;
        }

        if (line === "use veeam data cloud vault?") {
            // Could be performance or capacity context; we infer by previous section
            // If we haven't seen capacity tier yet, treat first occurrence as performance
            // Later occurrences can be capacity.
            const v = findNextValue(i);
            if (v) {
                // Heuristic: if capacity tier keywords appear nearby, treat as capacity
                const window = lines.slice(Math.max(0, i - 3), i + 4).join(" ").toLowerCase();
                if (window.includes("capacity tier")) {
                    raw.useVaultCapacity = v;
                } else if (raw.useVaultPerformance === null) {
                    raw.useVaultPerformance = v;
                } else {
                    raw.useVaultCapacity = v;
                }
            }
            continue;
        }

        // CAPACITY TIER
        if (line === "copy policy?") {
            const v = findNextValue(i);
            if (v) raw.copyPolicy = v;
            continue;
        }

        if (line === "move policy?") {
            const v = findNextValue(i);
            if (v) raw.movePolicy = v;
            continue;
        }

        if (line === "move period") {
            const v = findNextValue(i);
            if (v) {
                // Could be capacity move or archive move; we infer by context
                const window = lines.slice(Math.max(0, i - 3), i + 4).join(" ").toLowerCase();
                if (window.includes("archive tier")) {
                    raw.archiveMovePeriodDays = v;
                } else {
                    raw.movePeriodDays = v;
                }
            }
            continue;
        }

        // ARCHIVE TIER
        if (line === "archive tier?") {
            const v = findNextValue(i);
            if (v) raw.archiveEnabled = v;
            continue;
        }

        // IMMUTABILITY
        if (line === "performance tier immutable?") {
            const v = findNextValue(i);
            if (v) {
                raw.performanceTierImmutable = v;
                currentImmutabilityScope = "performance";
            }
            continue;
        }

        if (line === "capacity tier immutable?") {
            const v = findNextValue(i);
            if (v) {
                raw.capacityTierImmutable = v;
                currentImmutabilityScope = "capacity";
            }
            continue;
        }

        if (line === "immutability period") {
            const v = findNextValue(i);
            if (v) {
                if (currentImmutabilityScope === "performance") {
                    raw.performanceTierImmutabilityPeriod = v;
                } else if (currentImmutabilityScope === "capacity") {
                    raw.capacityTierImmutabilityPeriod = v;
                } else {
                    // If no scope, prefer performance if not set
                    if (!raw.performanceTierImmutabilityPeriod) {
                        raw.performanceTierImmutabilityPeriod = v;
                    } else if (!raw.capacityTierImmutabilityPeriod) {
                        raw.capacityTierImmutabilityPeriod = v;
                    }
                }
            }
            continue;
        }

        // RETENTION
        if (line.endsWith("dailies")) {
            raw.dailies = lines[i];
            continue;
        }
        if (line.endsWith("weeklies")) {
            raw.weeklies = lines[i];
            continue;
        }
        if (line.endsWith("monthlies")) {
            raw.monthlies = lines[i];
            continue;
        }
        if (line.endsWith("yearlies")) {
            raw.yearlies = lines[i];
            continue;
        }

        // ADVANCED
        if (line === "compress by") {
            const v = findNextValue(i);
            if (v) raw.compressBy = v;
            continue;
        }

        if (line === "block generation period") {
            const v = findNextValue(i);
            if (v) raw.blockGenerationPeriod = v;
            continue;
        }

        // ESTIMATION
        if (line === "growth rate") {
            const v = findNextValue(i);
            if (v) raw.growthRate = v;
            continue;
        }

        if (line === "forecast period") {
            const v = findNextValue(i);
            if (v) raw.forecastPeriod = v;
            continue;
        }
    }

    // -----------------------------
    // Normalization helpers
    // -----------------------------
    function parseSizeToGB(text) {
        if (!text) return null;
        const t = text.toLowerCase();
        const num = parseFloat(t);
        if (isNaN(num)) return null;
        if (t.includes("tb")) return num * 1024;
        if (t.includes("gb")) return num;
        return num; // assume GB if no unit
    }

    function parsePercentToDecimal(text) {
        if (!text) return null;
        const t = text.toLowerCase();
        const num = parseFloat(t);
        if (isNaN(num)) return null;
        if (t.includes("%")) return num / 100;
        return num; // assume already decimal
    }

    function parseDays(text) {
        if (!text) return null;
        const t = text.toLowerCase();
        const num = parseFloat(t);
        if (isNaN(num)) return null;
        return num;
    }

    function parseYearsToDays(text) {
        if (!text) return null;
        const t = text.toLowerCase();
        const num = parseFloat(t);
        if (isNaN(num)) return null;
        if (t.includes("year")) return Math.round(num * 365);
        return Math.round(num * 365);
    }

    function parseBoolean(text) {
        if (!text) return null;
        const t = text.toLowerCase();
        if (t === "true") return true;
        if (t === "false") return false;
        return null;
    }

    function parseRetentionLine(text) {
        if (!text) return null;
        const num = parseFloat(text);
        if (isNaN(num)) return null;
        return num;
    }

    // -----------------------------
    // Normalize simulator-required fields
    // -----------------------------
    const initialSizeGB = parseSizeToGB(raw.initialSize);
    const dailyChangeRate = parsePercentToDecimal(raw.dailyChangeRate);
    const annualGrowthRate = parsePercentToDecimal(raw.growthRate);

    // Retention (Option C)
    const d = parseRetentionLine(raw.dailies);
    const w = parseRetentionLine(raw.weeklies);
    const m = parseRetentionLine(raw.monthlies);
    const y = parseRetentionLine(raw.yearlies);

    let retention = null;
    if (d != null) {
        if ((w || 0) === 0 && (m || 0) === 0 && (y || 0) === 0) {
            retention = d;
        } else {
            retention = (d || 0) + (w || 0) + (m || 0) + (y || 0);
        }
    }

    const blockGenWindow = parseDays(raw.blockGenerationPeriod);

    // Min immutability: use performance tier immutability if present
    const performanceTierImmutabilityDays = parseDays(raw.performanceTierImmutabilityPeriod);

    // Synthetic interval: default 7 days (per your choice)
    const syntheticInterval = 7;

    // simDays: from forecast period if present, else 365
    let simDays = 365;
    const forecastDays = parseYearsToDays(raw.forecastPeriod);
    if (forecastDays != null) simDays = forecastDays;

    // -----------------------------
    // Build final config object
    // -----------------------------
    const config = {
        // Normalized fields used by simulator
        initialSizeGB: initialSizeGB,
        dailyChangeRate: dailyChangeRate,
        annualGrowthRate: annualGrowthRate,
        retention: retention,
        blockGenWindow: blockGenWindow,
        minImmutability: performanceTierImmutabilityDays,
        syntheticInterval: syntheticInterval,
        simDays: simDays,

        // Raw / passthrough fields (for future use)
        backupWindow: raw.backupWindow,
        directToObject: raw.directToObject,
        useVaultPerformance: raw.useVaultPerformance,
        useVaultCapacity: raw.useVaultCapacity,
        copyPolicy: raw.copyPolicy,
        movePolicy: raw.movePolicy,
        movePeriodDays: raw.movePeriodDays,
        archiveEnabled: raw.archiveEnabled,
        archiveMovePeriodDays: raw.archiveMovePeriodDays,
        performanceTierImmutable: raw.performanceTierImmutable,
        performanceTierImmutabilityPeriod: raw.performanceTierImmutabilityPeriod,
        capacityTierImmutable: raw.capacityTierImmutable,
        capacityTierImmutabilityPeriod: raw.capacityTierImmutabilityPeriod,
        dailiesRaw: raw.dailies,
        weekliesRaw: raw.weeklies,
        monthliesRaw: raw.monthlies,
        yearliesRaw: raw.yearlies,
        compressByRaw: raw.compressBy,
        blockGenerationPeriodRaw: raw.blockGenerationPeriod,
        growthRateRaw: raw.growthRate,
        forecastPeriodRaw: raw.forecastPeriod
    };

    // Basic sanity check: must at least have initial size and daily change
    if (config.initialSizeGB == null || config.dailyChangeRate == null) {
        return {
            ok: false,
            error: "Unable to parse required fields (initial size and daily change rate).",
            raw,
            config
        };
    }

    return { ok: true, config, raw };
}
