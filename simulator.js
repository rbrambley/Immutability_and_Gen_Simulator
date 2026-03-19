/* -------------------------------------------------------------
   simulator.js — GFS-aware, debug-instrumented
   - Models daily backups with synthetic fulls
   - Flags GFS points (weekly/monthly/yearly) as synthetic fulls
   - Approximates GFS retention using counts
   - Uses parser.js config (incl. gfsDailies/Weeklies/Monthlies/Yearlies)
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

    function baseDeleteOn(c) {
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

    function applyGfsRetention(c) {
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

        if (gfsExtension > 0) {
            const gfsDelete = c.created + gfsExtension;
            c.deleteOn = Math.max(c.deleteOn, gfsDelete);
        }
    }

    function updateDeleteOn(c) {
        c.deleteOn = baseDeleteOn(c);
        applyGfsRetention(c);
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

            dailyReason.push("Synthetic full + reuse");
        } else {
            const inc = new Cohort(day, D, "inc");
            cohorts.push(inc);
            dailyReason.push("Incremental");
            debugLog(`  Incremental created cohort: created=${day} size=${D.toFixed(2)}`);
        }

        for (const c of cohorts) updateDeleteOn(c);

        let stored = 0;
        for (const c of cohorts) {
            if (day >= c.created && day < c.deleteOn) stored += c.sizeGB;
        }
        dailyStored.push(stored);

        debugLog(`  Stored=${stored.toFixed(2)} cohorts=${cohorts.length}`);
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
        }
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
                ? `Day ${e.day}: Deleted`
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

    const fixes =
`To prevent rollover:
- Increase synthetic interval to > ${immPlusGen} days
OR
- Reduce immutability to < ${syntheticInterval} days
OR
- Reduce block generation window to < ${immPlusGen - minImmutability} days

GFS considerations:
- Higher GFS counts (weekly/monthly/yearly) extend retention of flagged fulls
- This increases long-term stored capacity even if base retention is short`;

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
       Final Output Assembly
       ----------------------------- */

    debugLog("=== runSimulator() COMPLETE — assembling output ===");

    let out = "";

    out += "==================== STORAGE CURVE ====================\n";
    out += capacityTable() + "\n\n";

    out += "==================== TOP 10 LONGEST-LIVED COHORTS ====================\n";
    for (const t of top10) {
        out += `Cohort ${t.id}: lived ${t.lifetime} days (reused ${t.reuseCount} times, kind=${t.kind}, ` +
               `GFS[d=${t.gfs.daily},w=${t.gfs.weekly},m=${t.gfs.monthly},y=${t.gfs.yearly}])\n`;
    }
    out += "\n";

    out += "==================== WORST COHORT TIMELINE ====================\n";
    out += buildTimeline(worst) + "\n";

    out += "==================== GEN ROLLOVER DIAGNOSTIC ====================\n";
    out += genDiagnostic + "\n\n";

    out += "==================== ROOT CAUSE ANALYSIS ====================\n";
    out += rootCause + "\n\n";

    out += "==================== FIX RECOMMENDATIONS ====================\n";
    out += fixes + "\n";

    return out;
}
