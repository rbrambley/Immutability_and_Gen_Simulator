/* -------------------------------------------------------------
   parser.js — Debug‑Instrumented Version
   ------------------------------------------------------------- */

function parseCalculatorInput(rawText) {
    debugLog("PARSER START");

    try {
        if (!rawText || typeof rawText !== "string") {
            debugLog("ERROR: No input text");
            return { ok: false, error: "No input text provided." };
        }

        const lines = rawText
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l.length > 0);

        debugLog("TOTAL LINES:", lines.length);

        function findNextValue(startIndex, maxLookahead = 6) {
            for (let i = 1; i <= maxLookahead; i++) {
                const idx = startIndex + i;
                if (idx >= lines.length) break;
                const v = lines[idx];
                if (v && v.length > 0) {
                    debugLog("LOOKAHEAD VALUE:", v);
                    return v;
                }
            }
            return null;
        }

        const raw = {
            initialSize: null,
            dailyChangeRate: null,
            backupWindow: null,
            directToObject: null,
            useVaultPerformance: null,
            useVaultCapacity: null,
            copyPolicy: null,
            movePolicy: null,
            movePeriodDays: null,
            archiveEnabled: null,
            archiveMovePeriodDays: null,
            performanceTierImmutable: null,
            performanceTierImmutabilityPeriod: null,
            capacityTierImmutable: null,
            capacityTierImmutabilityPeriod: null,
            dailies: null,
            weeklies: null,
            monthlies: null,
            yearlies: null,
            compressBy: null,
            blockGenerationPeriod: null,
            growthRate: null,
            forecastPeriod: null
        };

        let currentImmutabilityScope = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].toLowerCase();
            debugLog("LINE:", line);

            if (line === "source data") {
                raw.initialSize = findNextValue(i);
                debugLog("initialSize:", raw.initialSize);
                continue;
            }

            if (line === "daily change rate") {
                raw.dailyChangeRate = findNextValue(i);
                debugLog("dailyChangeRate:", raw.dailyChangeRate);
                continue;
            }

            if (line === "backup window") {
                raw.backupWindow = findNextValue(i);
                continue;
            }

            if (line === "direct to object storage?") {
                raw.directToObject = findNextValue(i);
                continue;
            }

            if (line === "use veeam data cloud vault?") {
                const v = findNextValue(i);
                const window = lines.slice(Math.max(0, i - 5), i + 6).join(" ").toLowerCase();
                if (window.includes("capacity tier")) raw.useVaultCapacity = v;
                else raw.useVaultPerformance = v;
                continue;
            }

            if (line === "copy policy?") {
                raw.copyPolicy = findNextValue(i);
                continue;
            }

            if (line === "move policy?") {
                raw.movePolicy = findNextValue(i);
                continue;
            }

            if (line === "move period") {
                const v = findNextValue(i);
                const window = lines.slice(Math.max(0, i - 5), i + 6).join(" ").toLowerCase();
                if (window.includes("archive tier")) raw.archiveMovePeriodDays = v;
                else raw.movePeriodDays = v;
                continue;
            }

            if (line === "archive tier?") {
                raw.archiveEnabled = findNextValue(i);
                continue;
            }

            if (line === "performance tier immutable?") {
                raw.performanceTierImmutable = findNextValue(i);
                currentImmutabilityScope = "performance";
                continue;
            }

            if (line === "capacity tier immutable?") {
                raw.capacityTierImmutable = findNextValue(i);
                currentImmutabilityScope = "capacity";
                continue;
            }

            if (line === "immutability period") {
                const v = findNextValue(i);
                if (currentImmutabilityScope === "performance")
                    raw.performanceTierImmutabilityPeriod = v;
                else
                    raw.capacityTierImmutabilityPeriod = v;
                continue;
            }

            if (line.endsWith("dailies")) raw.dailies = lines[i];
            if (line.endsWith("weeklies")) raw.weeklies = lines[i];
            if (line.endsWith("monthlies")) raw.monthlies = lines[i];
            if (line.endsWith("yearlies")) raw.yearlies = lines[i];

            if (line === "compress by") raw.compressBy = findNextValue(i);
            if (line === "block generation period") raw.blockGenerationPeriod = findNextValue(i);
            if (line === "growth rate") raw.growthRate = findNextValue(i);
            if (line === "forecast period") raw.forecastPeriod = findNextValue(i);
        }

        function parseSizeToGB(t) {
            if (!t) return null;
            const num = parseFloat(t);
            if (t.toLowerCase().includes("tb")) return num * 1024;
            return num;
        }

        function parsePercent(t) {
            if (!t) return null;
            const num = parseFloat(t);
            return t.includes("%") ? num / 100 : num;
        }

        function parseDays(t) {
            if (!t) return null;
            return parseFloat(t);
        }

        function parseYearsToDays(t) {
            if (!t) return null;
            return Math.round(parseFloat(t) * 365);
        }

        const initialSizeGB = parseSizeToGB(raw.initialSize);
        const dailyChangeRate = parsePercent(raw.dailyChangeRate);
        const annualGrowthRate = parsePercent(raw.growthRate);

        const d = parseFloat(raw.dailies);
        const w = parseFloat(raw.weeklies);
        const m = parseFloat(raw.monthlies);
        const y = parseFloat(raw.yearlies);

        let retention = null;
        if (d != null) {
            if ((w || 0) === 0 && (m || 0) === 0 && (y || 0) === 0)
                retention = d;
            else
                retention = (d || 0) + (w || 0) + (m || 0) + (y || 0);
        }

        const blockGenWindow = parseDays(raw.blockGenerationPeriod);
        const minImmutability = parseDays(raw.performanceTierImmutabilityPeriod);
        const syntheticInterval = 7;

        let simDays = 365;
        const forecastDays = parseYearsToDays(raw.forecastPeriod);
        if (forecastDays != null) simDays = forecastDays;

        const config = {
            initialSizeGB,
            dailyChangeRate,
            annualGrowthRate,
            retention,
            blockGenWindow,
            minImmutability,
            syntheticInterval,
            simDays,
            backupWindow: raw.backupWindow,
            directToObject: raw.directToObject,
            useVaultPerformance: raw.useVaultPerformance,
            useVaultCapacity: raw.useVaultCapacity,
            copyPolicy: raw.copyPolicy,
            movePolicy: raw.movePolicy,
            movePeriodDays: raw.movePeriodDays,
            archiveEnabled: raw.archiveEnabled,
            archiveMovePeriodDays: raw.archiveMovePeriodDays
        };

        if (initialSizeGB == null || dailyChangeRate == null) {
            debugLog("MISSING REQUIRED FIELDS");
            return { ok: false, error: "Missing required fields (initial size or daily change rate)." };
        }

        debugLog("CONFIG COMPLETE");
        return { ok: true, config, raw };

    } catch (e) {
        debugLog("EXCEPTION:", e.toString());
        return { ok: false, error: e.toString() };
    }
}
