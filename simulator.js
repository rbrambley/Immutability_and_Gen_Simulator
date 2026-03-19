/* -------------------------------------------------------------
   simulator.js — GFS-aware, diagnostic, debug-instrumented
   - Models daily backups with synthetic fulls
   - Flags GFS points (weekly/monthly/yearly) as synthetic fulls
   - Approximates GFS retention using counts
   - Provides rollover detection, GFS impact, and retention pressure views
   ------------------------------------------------------------- */

function runSimulator(cfg) {

    debugLog("=== runSimulator() START ===");
    debugLog("CONFIG:", JSON.stringify(cfg, null, 2));

    /* -----------------------------
       Cohort structure
       ----------------------------- */
    class Cohort {
        constructor(day, size, kind) {
            this.created = day;
            this.sizeGB = size;
            this.kind = kind; // "full" or "inc"
            this.reuseDays = [];
            this.expirations = [];
            this.deleteOn = null;

            this.isGfsDaily = false;
            this.isGfsWeekly = false;
            this.isGfsMonthly = false;
            this.isGfsYearly = false;

            this.baseDeleteOn = null;
            this.gfsDeleteOn = null;
            this.deleteDriver = "base"; // "base" or "gfs"
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

    /* -----------------------------
       Helpers
       ----------------------------- */
    function logicalSize(day) {
        return initialSizeGB * Math.pow(1 + annualGrowthRate / 365, day);
    }

    function deltaFor(day) {
        return logicalSize(day) * dailyChangeRate;
    }

    function computeBaseDeleteOn(c) {
        if (c.reuseDays.length === 0) {
            const rpRemove = c.created + retention;
            const exp = c.created + minImmutability + blockGenWindow;
            return Math.max(rpRemove, exp);
        }

        const lastRef = Math.max(...c.reuseDays);
        const rpRemove = lastRef + retention;
        const expLast = Math.max(...c.expirations);
        return Math.max(rpRemove, expLast);
    }

    function computeGfsExtension(c) {
        let gfsExtension = 0;

        if (c.isGfsWeekly && gfsWeeklies && gfsWeeklies > 0) {
            gfsExtension = Math.max(gfsExtension, gfsWeeklies * 7);
        }
        if (c.isGfsMonthly && gfsMonthlies && gfsMonthlies > 0) {
            gfsExtension = Math.max(gfsExtension, gfsMonthlies * 30);
        }
        if (c.isGfsYearly && gfsYearlies && gfsYearlies > 0) {
            gfsExtension = Math.max(gfsExtension, gfsYearlies * 365);
        }

        return gfsExtension;
    }

    function updateDeleteOn(c) {
        const base = computeBaseDeleteOn(c);
        c.baseDeleteOn = base;
        c.deleteOn = base;
        c.deleteDriver = "base";

        const ext = computeGfsExtension(c);
        if (ext > 0) {
            const gfsDel = c.created + ext;
            c.gfsDeleteOn = gfsDel;
            if (gfsDel > c.deleteOn) {
                c.deleteOn = gfsDel;
                c.deleteDriver = "gfs";
            }
        }
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
            const full = new Cohort(day, L, "full");

            if (gfsDailies && gfsDailies > 0) {
                full.isGfsDaily = true;
            }
            if (isWeeklyGfsDay(day)) {
                full.isGfsWeekly = true;
            }
            if (isMonthlyGfsDay(day)) {
                full.isGfsMonthly = true;
            }
            if (isYearlyGfsDay(day)) {
                full.isGfsYearly = true;
            }

            cohorts.push(full);
            dailyReason.push("Synthetic full + reuse");
            debugLog(
                `  Synthetic full created cohort: created=${day} size=${L.toFixed(2)} ` +
                `GFS[d=${full.isGfsDaily},w=${full.isGfsWeekly},m=${full.isGfsMonthly},y=${full.isGfsYearly}]`
            );

            for (const c of cohorts) {
                if (c.deleteOn === null || day < c.deleteOn) {
                    c.reuseDays.push(day);
                    c.expirations.push(day + minImmutability + blockGenWindow);
                    debugLog(`  Reuse event: cohort=${c.created} newExp=${c.expirations.at(-1)}`);
                }
            }
        } else {
            const inc = new Cohort(day, D, "inc");
            cohorts.push(inc);
            dailyReason.push("Incremental");
            debugLog(`  Incremental created cohort: created=${day} size=${D.toFixed(2)}`);
        }

        for (const c of cohorts) updateDeleteOn(c);

        let stored = 0;
        let expiredToday = 0;
        for (const c of cohorts) {
            if (day >= c.created && day < c.deleteOn) stored += c.sizeGB;
            if (c.deleteOn === day) expiredToday++;
        }
        dailyStored.push(stored);
        dailyExpiredCount.push(expiredToday);

        debugLog(`  Stored=${stored.toFixed(2)} cohorts=${cohorts.length} expiredToday=${expiredToday}`);
    }

    /* -----------------------------
       Diagnostics
       ----------------------------- */

    const totalCohorts = cohorts.length;
    const reused = cohorts.filter(c => c.reuseDays.length > 0).length;

    debugLog("Total cohorts:", totalCohorts, "Reused:", reused);

    const lifetimes = cohorts.map(c => ({
        id: c.created,
        lifetime: c.deleteOn - c.created,
        reuseCount: c.reuseDays.length,
        kind: c.kind,
        gfs: {
            daily: c.isGfsDaily,
            weekly: c.isGfsWeekly,
            monthly: c.isGfsMonthly,
            yearly: c.isGfsYearly
        },
        driver: c.deleteDriver,
        cohort: c
    }));

    lifetimes.sort((a, b) => b.lifetime - a.lifetime);

    const top10 = lifetimes.slice(0, 10);
    const worst = top10[0].cohort;

    debugLog("Top 10 longest-lived cohorts:", JSON.stringify(top10, null, 2));
    debugLog("Worst cohort:", JSON.stringify({
        created: worst.created,
        lifetime: worst.deleteOn - worst.created,
        reuseCount: worst.reuseDays.length,
        kind: worst.kind,
        gfs: {
            daily: worst.isGfsDaily,
            weekly: worst.isGfsWeekly,
            monthly: worst.isGfsMonthly,
            yearly: worst.isGfsYearly
        },
        driver: worst.deleteDriver
    }, null, 2));

    function buildTimeline(c) {
        const events = [];

        events.push({
            day: c.created,
            type: "Created",
            exp: c.created + minImmutability + blockGenWindow
        });

        for (let i = 0; i < c.reuseDays.length; i++) {
            const d = c.reuseDays[i];
            const exp = c.expirations[i];
            events.push({ day: d, type: "Reused", exp });
        }

        events.push({ day: c.deleteOn, type: "Deleted", exp: null });

        return events.map(e =>
            e.type === "Deleted"
                ? `Day ${e.day}: Deleted (driver=${c.deleteDriver})`
                : `Day ${e.day}: ${e.type} → expiration now ${e.exp}`
        ).join("\n");
    }

    const immPlusGen = minImmutability + blockGenWindow;

    const genDiagnostic =
`GEN Window: ${blockGenWindow} days
Min Immutability: ${minImmutability} days
Effective extension per reuse: ${immPlusGen} days
Synthetic interval: ${syntheticInterval} days

If synthetic interval < immutability+GEN:
→ Every synthetic full reuses all cohorts
→ Immutability is extended before expiration
→ No cohort can age out
→ Storage footprint grows without bound`;

    const rootCause =
`1. Synthetic interval (${syntheticInterval}) vs immutability+GEN (${immPlusGen})
2. If synthetic interval is too short, every synthetic full reuses all cohorts
3. Therefore immutability is extended before expiration
4. Therefore no cohort can expire
5. Therefore storage footprint grows linearly with days`;

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
            out += `GEN rollover detected: synthetic interval (${syntheticInterval} days) is shorter than immutability+GEN (${immPlusGen} days).\n`;
            out += "To prevent GEN rollover:\n";
            out += `- Increase synthetic interval to > ${immPlusGen} days\n`;
            out += `- OR reduce immutability to < ${syntheticInterval} days\n`;
            out += `- OR reduce block generation window to < ${immPlusGen - minImmutability} days\n\n`;
        } else {
            out += "No GEN rollover detected — synthetic interval is long enough relative to immutability+GEN.\n\n";
        }

        if (!anyExpired) {
            out += "Warning: No cohorts expired during the simulation.\n";
            out += "This indicates retention or immutability settings are preventing aging out of restore points.\n\n";
        } else {
            out += "Cohort expiration observed — retention and immutability allow aging out of restore points.\n\n";
        }

        if (linearGrowth) {
            out += "Storage footprint is growing linearly.\n";
            out += "This typically indicates:\n";
            out += "- Synthetic interval too short\n";
            out += "- Immutability+GEN window too long\n";
            out += "- GFS retention extending full backups\n\n";
        } else {
            out += "Storage footprint shows plateauing behavior — rollover is functioning.\n\n";
        }

        if (gfsDominant) {
            out += "GFS retention is the dominant driver of long-term storage.\n";
            out += "Weekly/Monthly/Yearly GFS points extend retention beyond base policy.\n";
            out += "To reduce long-term storage:\n";
            out += "- Reduce weekly/monthly/yearly GFS counts\n";
            out += "- OR increase synthetic interval to reduce number of fulls created\n\n";
        } else {
            out += "GFS retention is not the dominant driver — base retention or GEN behavior is primary.\n\n";
        }

        return out;
    }

    /* -----------------------------
       Rollover Event Timeline
       ----------------------------- */

    function generateRolloverTimeline() {
        let out = "==================== ROLLOVER EVENT TIMELINE ====================\n";

        let lastStored = dailyStored[0];
        let firstNoExpireDay = null;
        let lastExpireDay = null;

        for (let d = 0; d < simDays; d++) {
            if (dailyExpiredCount[d] > 0) lastExpireDay = d;
            if (dailyExpiredCount[d] === 0 && firstNoExpireDay === null && d > 0) {
                firstNoExpireDay = d;
            }
            lastStored = dailyStored[d];
        }

        if (lastExpireDay === null) {
            out += "No expiration events occurred during the simulation.\n";
            out += "Rollover never engaged — retention/immutability/GFS kept all cohorts alive.\n";
        } else {
            out += `Last expiration event occurred on day ${lastExpireDay}.\n`;
            if (firstNoExpireDay !== null && firstNoExpireDay > lastExpireDay) {
                out += `No further expirations after day ${firstNoExpireDay} — rollover effectively stopped.\n`;
            } else {
                out += "Expirations continued throughout the simulation window.\n";
            }
        }

        out += "\n";
        return out;
    }

    /* -----------------------------
       GFS Impact Breakdown
       ----------------------------- */

    function generateGfsImpact() {
        let out = "==================== GFS IMPACT BREAKDOWN ====================\n";

        const weekly = cohorts.filter(c => c.isGfsWeekly);
        const monthly = cohorts.filter(c => c.isGfsMonthly);
        const yearly = cohorts.filter(c => c.isGfsYearly);

        function summarize(list, label) {
            if (list.length === 0) {
                out += `${label}: none\n`;
                return;
            }
            const avgLifetime = list.reduce((s, c) => s + (c.deleteOn - c.created), 0) / list.length;
            const avgSize = list.reduce((s, c) => s + c.sizeGB, 0) / list.length;
            out += `${label}: count=${list.length}, avgLifetime=${avgLifetime.toFixed(1)} days, avgSize=${avgSize.toFixed(1)} GB\n`;
        }

        summarize(weekly, "Weekly GFS fulls");
        summarize(monthly, "Monthly GFS fulls");
        summarize(yearly, "Yearly GFS fulls");

        out += "\n";
        return out;
    }

    /* -----------------------------
       Retention Pressure Heatmap
       ----------------------------- */

    function generateRetentionHeatmap() {
        let out = "==================== RETENTION PRESSURE HEATMAP ====================\n";

        const baseDriven = cohorts.filter(c => c.deleteDriver === "base");
        const gfsDriven = cohorts.filter(c => c.deleteDriver === "gfs");

        out += `Base policy / GEN-driven cohorts: ${baseDriven.length}\n`;
        out += `GFS-driven cohorts: ${gfsDriven.length}\n\n`;

        out += "Sample GFS-driven cohorts (up to 10):\n";
        const sample = gfsDriven.slice(0, 10);
        if (sample.length === 0) {
            out += "  (none)\n";
        } else {
            for (const c of sample) {
                out += `  Cohort ${c.created}: lifetime=${(c.deleteOn - c.created)} days, ` +
                       `GFS[d=${c.isGfsDaily},w=${c.isGfsWeekly},m=${c.isGfsMonthly},y=${c.isGfsYearly}]\n`;
            }
        }

        out += "\n";
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
        out += `Cohort ${t.id}: lived ${t.lifetime} days (reused ${t.reuseCount} times, kind=${t.kind}, ` +
               `GFS[d=${t.gfs.daily},w=${t.gfs.weekly},m=${t.gfs.monthly},y=${t.gfs.yearly}], driver=${t.driver})\n`;
    }
    out += "\n";

    out += "==================== WORST COHORT TIMELINE ====================\n";
    out += buildTimeline(worst) + "\n";

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
