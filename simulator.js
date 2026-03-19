/* -------------------------------------------------------------
   simulator.js — corrected, expiration-realistic, GFS-aware
   - Models daily backups with synthetic fulls
   - Cohorts expire based on retention, immutability+GEN, and GFS
   - GFS fulls are modeled as separate copy cohorts
   - No infinite extension from synthetic full reuse
   ------------------------------------------------------------- */

function runSimulator(cfg) {

    debugLog("=== runSimulator() START ===");
    debugLog("CONFIG:", JSON.stringify(cfg, null, 2));

    /* -----------------------------
       Cohort structure
       ----------------------------- */
    class Cohort {
        constructor(day, size, kind) {
            this.created = day;          // day index
            this.sizeGB = size;          // size at creation
            this.kind = kind;            // "full", "inc", "gfsFull"
            this.isGfsWeekly = false;
            this.isGfsMonthly = false;
            this.isGfsYearly = false;

            this.baseDeleteOn = null;    // from retention
            this.immuDeleteOn = null;    // from immutability+GEN
            this.gfsDeleteOn = null;     // from GFS retention
            this.deleteOn = null;        // final
            this.deleteDriver = "base";  // "base", "immu", "gfs"
        }
    }

    /* -----------------------------
       Simulation state
       ----------------------------- */
    const cohorts = [];
    const dailyStored = [];
    const dailyLogical = [];
    const dailyDelta = [];
    const dailyReason = [];
    const dailyExpiredCount = [];

    const {
        initialSizeGB,
        dailyChangeRate,
        annualGrowthRate,
        syntheticInterval,
        minImmutability,
        blockGenWindow,
        retention,
        simDays,
        gfsDailies,
        gfsWeeklies,
        gfsMonthlies,
        gfsYearlies
    } = cfg;

    debugLog("Simulation parameters:", JSON.stringify({
        initialSizeGB,
        dailyChangeRate,
        annualGrowthRate,
        syntheticInterval,
        minImmutability,
        blockGenWindow,
        retention,
        simDays,
        gfsDailies,
        gfsWeeklies,
        gfsMonthlies,
        gfsYearlies
    }, null, 2));

    const immPlusGen = minImmutability + blockGenWindow;

    /* -----------------------------
       Helpers
       ----------------------------- */
    function logicalSize(day) {
        return initialSizeGB * Math.pow(1 + annualGrowthRate / 365, day);
    }

    function deltaFor(day) {
        return logicalSize(day) * dailyChangeRate;
    }

    function isWeeklyGfsDay(day) {
        return gfsWeeklies && gfsWeeklies > 0 && day % 7 === 0;
    }

    function isMonthlyGfsDay(day) {
        return gfsMonthlies && gfsMonthlies > 0 && day % 30 === 0;
    }

    function isYearlyGfsDay(day) {
        return gfsYearlies && gfsYearlies > 0 && day % 365 === 0;
    }

    function computeDeleteOn(c) {
        // Base retention: created + retention days
        const baseDel = c.created + retention;
        c.baseDeleteOn = baseDel;

        // Immutability + GEN: created + immutability + blockGenWindow
        const immuDel = c.created + immPlusGen;
        c.immuDeleteOn = immuDel;

        let del = Math.max(baseDel, immuDel);
        let driver = (del === baseDel) ? "base" : "immu";

        // GFS retention for GFS full copies
        if (c.kind === "gfsFull") {
            let gfsExt = 0;
            if (c.isGfsWeekly && gfsWeeklies && gfsWeeklies > 0) {
                gfsExt = Math.max(gfsExt, gfsWeeklies * 7);
            }
            if (c.isGfsMonthly && gfsMonthlies && gfsMonthlies > 0) {
                gfsExt = Math.max(gfsExt, gfsMonthlies * 30);
            }
            if (c.isGfsYearly && gfsYearlies && gfsYearlies > 0) {
                gfsExt = Math.max(gfsExt, gfsYearlies * 365);
            }
            if (gfsExt > 0) {
                const gfsDel = c.created + gfsExt;
                c.gfsDeleteOn = gfsDel;
                if (gfsDel > del) {
                    del = gfsDel;
                    driver = "gfs";
                }
            }
        }

        c.deleteOn = del;
        c.deleteDriver = driver;
    }

    /* -----------------------------
       Main daily loop
       ----------------------------- */
    for (let day = 0; day < simDays; day++) {

        const L = logicalSize(day);
        const D = deltaFor(day);

        dailyLogical.push(L);
        dailyDelta.push(D);

        const isSynthetic = (day % syntheticInterval === 0);

        debugLog(`DAY ${day}: synthetic=${isSynthetic} L=${L.toFixed(2)} D=${D.toFixed(2)}`);

        if (isSynthetic) {
            // Active chain full
            const full = new Cohort(day, L, "full");
            cohorts.push(full);
            dailyReason.push("Synthetic full");

            // GFS copy fulls (separate cohorts)
            if (isWeeklyGfsDay(day)) {
                const gfsFull = new Cohort(day, L, "gfsFull");
                gfsFull.isGfsWeekly = true;
                cohorts.push(gfsFull);
                debugLog(`  GFS weekly full copy created at day ${day}, size=${L.toFixed(2)}`);
            }
            if (isMonthlyGfsDay(day)) {
                const gfsFull = new Cohort(day, L, "gfsFull");
                gfsFull.isGfsMonthly = true;
                cohorts.push(gfsFull);
                debugLog(`  GFS monthly full copy created at day ${day}, size=${L.toFixed(2)}`);
            }
            if (isYearlyGfsDay(day)) {
                const gfsFull = new Cohort(day, L, "gfsFull");
                gfsFull.isGfsYearly = true;
                cohorts.push(gfsFull);
                debugLog(`  GFS yearly full copy created at day ${day}, size=${L.toFixed(2)}`);
            }

        } else {
            const inc = new Cohort(day, D, "inc");
            cohorts.push(inc);
            dailyReason.push("Incremental");
        }

        // Compute deleteOn for all cohorts (no reuse extension)
        for (const c of cohorts) {
            computeDeleteOn(c);
        }

        // Capacity + expirations for this day
        let stored = 0;
        let expiredToday = 0;
        for (const c of cohorts) {
            if (day >= c.created && day < c.deleteOn) {
                stored += c.sizeGB;
            }
            if (c.deleteOn === day) {
                expiredToday++;
            }
        }
        dailyStored.push(stored);
        dailyExpiredCount.push(expiredToday);

        debugLog(`  Stored=${stored.toFixed(2)} cohorts=${cohorts.length} expiredToday=${expiredToday}`);
    }

    /* -----------------------------
       Diagnostics
       ----------------------------- */

    const totalCohorts = cohorts.length;
    debugLog("Total cohorts:", totalCohorts);

    const lifetimes = cohorts.map(c => ({
        id: c.created,
        lifetime: c.deleteOn - c.created,
        kind: c.kind,
        driver: c.deleteDriver,
        gfs: {
            weekly: c.isGfsWeekly,
            monthly: c.isGfsMonthly,
            yearly: c.isGfsYearly
        },
        cohort: c
    }));

    lifetimes.sort((a, b) => b.lifetime - a.lifetime);

    const top10 = lifetimes.slice(0, 10);
    const worst = top10[0].cohort;

    debugLog("Top 10 longest-lived cohorts:", JSON.stringify(top10, null, 2));
    debugLog("Worst cohort:", JSON.stringify({
        created: worst.created,
        lifetime: worst.deleteOn - worst.created,
        kind: worst.kind,
        driver: worst.deleteDriver,
        gfs: {
            weekly: worst.isGfsWeekly,
            monthly: worst.isGfsMonthly,
            yearly: worst.isGfsYearly
        }
    }, null, 2));

    function buildTimeline(c) {
        const lines = [];
        lines.push(`Day ${c.created}: Created (kind=${c.kind})`);
        lines.push(`Base deleteOn: day ${c.baseDeleteOn}`);
        lines.push(`Immutability+GEN deleteOn: day ${c.immuDeleteOn}`);
        if (c.gfsDeleteOn !== null) {
            lines.push(`GFS deleteOn: day ${c.gfsDeleteOn}`);
        }
        lines.push(`Final deleteOn: day ${c.deleteOn} (driver=${c.deleteDriver})`);
        return lines.join("\n");
    }

    const genDiagnostic =
`GEN Window: ${blockGenWindow} days
Min Immutability: ${minImmutability} days
Effective immutability+GEN: ${immPlusGen} days
Synthetic interval: ${syntheticInterval} days

If synthetic interval < immutability+GEN:
→ Risk of GEN rollover (new fulls created before old ones can expire)
→ More overlapping fulls and increments
→ Higher storage footprint`;

    const rootCause =
`1. Synthetic interval (${syntheticInterval}) vs immutability+GEN (${immPlusGen})
2. If synthetic interval is too short, multiple fulls overlap in time
3. Immutability+GEN keeps each full alive for at least ${immPlusGen} days
4. GFS full copies extend some fulls even further
5. Net effect: more concurrent cohorts → higher storage usage`;

    function capacityTable() {
        let out = "Day | Stored(GB) | Δ vs prior | Reason\n";
        out += "--------------------------------------------------\n";

        let last = 0;
        const step = Math.max(1, Math.ceil(simDays / 30));

        for (let d = 0; d < simDays; d += step) {
            const s = dailyStored[d];
            const delta = s - last;
            last = s;

            out += `${d.toString().padStart(3)} | ` +
                   `${s.toFixed(1).padStart(10)} | ` +
                   `${delta.toFixed(1).padStart(10)} | ` +
                   `${dailyReason[d]}\n`;
        }
        return out;
    }

    /* -----------------------------
       Intelligent FIX RECOMMENDATIONS
       ----------------------------- */

    function generateFixRecommendations() {
        let out = "";

        const genRolloverLikely = syntheticInterval < immPlusGen;
        const anyExpired = cohorts.some(c => c.deleteOn <= simDays);
        const finalStored = dailyStored[dailyStored.length - 1];
        const midStored = dailyStored[Math.floor(dailyStored.length / 2)];
        const linearGrowth = finalStored > midStored * 1.5;
        const gfsCounts = (gfsWeeklies || 0) + (gfsMonthlies || 0) + (gfsYearlies || 0);
        const gfsDominant = gfsCounts > retention;

        out += "==================== FIX RECOMMENDATIONS ====================\n";

        if (genRolloverLikely) {
            out += `GEN rollover risk: synthetic interval (${syntheticInterval} days) is shorter than immutability+GEN (${immPlusGen} days).\n`;
            out += "To reduce GEN rollover risk:\n";
            out += `- Increase synthetic interval to > ${immPlusGen} days\n`;
            out += `- OR reduce immutability to < ${syntheticInterval} days\n`;
            out += `- OR reduce block generation window to < ${immPlusGen - minImmutability} days\n\n`;
        } else {
            out += "No GEN rollover risk from parameters — synthetic interval is long enough relative to immutability+GEN.\n\n";
        }

        if (!anyExpired) {
            out += "Warning: No cohorts expired during the simulation window.\n";
            out += "This indicates retention/immutability/GFS settings keep all restore points alive for the entire period.\n\n";
        } else {
            out += "Cohort expiration observed — retention and immutability allow aging out of restore points.\n\n";
        }

        if (linearGrowth) {
            out += "Storage footprint is growing roughly linearly over the simulation.\n";
            out += "This typically indicates overlapping fulls and/or long GFS retention.\n\n";
        } else {
            out += "Storage footprint shows plateauing behavior — rollover is functioning within the simulated window.\n\n";
        }

        if (gfsDominant) {
            out += "GFS retention is likely the dominant driver of long-term storage.\n";
            out += "Weekly/Monthly/Yearly GFS full copies extend retention beyond base policy.\n";
            out += "To reduce long-term storage:\n";
            out += "- Reduce weekly/monthly/yearly GFS counts\n";
            out += "- OR increase synthetic interval to reduce number of fulls created\n\n";
        } else {
            out += "GFS retention is not the dominant driver — base retention or immutability+GEN is primary.\n\n";
        }

        return out;
    }

    /* -----------------------------
       Rollover Event Timeline
       ----------------------------- */

    function generateRolloverTimeline() {
        let out = "==================== ROLLOVER EVENT TIMELINE ====================\n";

        let lastExpireDay = null;
        for (let d = 0; d < simDays; d++) {
            if (dailyExpiredCount[d] > 0) lastExpireDay = d;
        }

        if (lastExpireDay === null) {
            out += "No expiration events occurred during the simulation.\n";
            out += "Rollover did not engage within the simulated period.\n\n";
        } else {
            out += `Last expiration event occurred on day ${lastExpireDay}.\n`;
            out += "Rollover is active, but long-lived cohorts may still overlap significantly.\n\n";
        }

        return out;
    }

    /* -----------------------------
       GFS Impact Breakdown
       ----------------------------- */

    function generateGfsImpact() {
        let out = "==================== GFS IMPACT BREAKDOWN ====================\n";

        const weekly = cohorts.filter(c => c.kind === "gfsFull" && c.isGfsWeekly);
        const monthly = cohorts.filter(c => c.kind === "gfsFull" && c.isGfsMonthly);
        const yearly = cohorts.filter(c => c.kind === "gfsFull" && c.isGfsYearly);

        function summarize(list, label) {
            if (list.length === 0) {
                out += `${label}: none\n`;
                return;
            }
            const avgLifetime = list.reduce((s, c) => s + (c.deleteOn - c.created), 0) / list.length;
            const avgSize = list.reduce((s, c) => s + c.sizeGB, 0) / list.length;
            out += `${label}: count=${list.length}, avgLifetime=${avgLifetime.toFixed(1)} days, avgSize=${avgSize.toFixed(1)} GB\n`;
        }

        summarize(weekly, "Weekly GFS full copies");
        summarize(monthly, "Monthly GFS full copies");
        summarize(yearly, "Yearly GFS full copies");

        out += "\n";
        return out;
    }

    /* -----------------------------
       Retention Pressure Heatmap
       ----------------------------- */

    function generateRetentionHeatmap() {
        let out = "==================== RETENTION PRESSURE HEATMAP ====================\n";

        const baseDriven = cohorts.filter(c => c.deleteDriver === "base");
        const immuDriven = cohorts.filter(c => c.deleteDriver === "immu");
        const gfsDriven = cohorts.filter(c => c.deleteDriver === "gfs");

        out += `Base policy-driven cohorts: ${baseDriven.length}\n`;
        out += `Immutability+GEN-driven cohorts: ${immuDriven.length}\n`;
        out += `GFS-driven cohorts: ${gfsDriven.length}\n\n`;

        out += "Sample GFS-driven cohorts (up to 10):\n";
        const sample = gfsDriven.slice(0, 10);
        if (sample.length === 0) {
            out += "  (none)\n\n";
        } else {
            for (const c of sample) {
                out += `  Cohort ${c.created}: lifetime=${(c.deleteOn - c.created)} days, size=${c.sizeGB.toFixed(1)} GB, ` +
                       `GFS[w=${c.isGfsWeekly},m=${c.isGfsMonthly},y=${c.isGfsYearly}]\n`;
            }
            out += "\n";
        }

        return out;
    }

    /* -----------------------------
       Final Output Assembly
       ----------------------------- */

    debugLog("=== runSimulator() COMPLETE — assembling output ===");

    let out = "";

    out += "==================== STORAGE CURVE ====================\n";
    out += capacityTable() + "\n\n";

    out += "==================== TOP 10 LONGEST-LIVED COHORTS ====================\n";
    for (const t of top10) {
        out += `Cohort ${t.id}: lived ${t.lifetime} days (kind=${t.kind}, driver=${t.driver}, ` +
               `GFS[w=${t.gfs.weekly},m=${t.gfs.monthly},y=${t.gfs.yearly}])\n`;
    }
    out += "\n";

    out += "==================== WORST COHORT TIMELINE ====================\n";
    out += buildTimeline(worst) + "\n\n";

    out += "==================== GEN ROLLOVER DIAGNOSTIC ====================\n";
    out += genDiagnostic + "\n\n";

    out += "==================== ROOT CAUSE ANALYSIS ====================\n";
    out += rootCause + "\n\n";

    out += generateFixRecommendations();
    out += generateRolloverTimeline();
    out += generateGfsImpact();
    out += generateRetentionHeatmap();

    return out;
}
