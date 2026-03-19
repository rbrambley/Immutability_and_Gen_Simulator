/* -------------------------------------------------------------
   simulator.js — Diagnostic Mode
   Rich Brambley Edition (Debug‑Instrumented)
   -------------------------------------------------------------
   Produces:
   - Storage curve with reasons
   - Top 10 longest-lived cohorts
   - Detailed timeline for worst cohort
   - GEN rollover diagnostic
   - Root cause analysis
   - Fix recommendations
   - Improved capacity table
   - All ASCII-safe, single <pre> block

   Debug additions:
   - parser.js–style debugLog() calls
   - No functional changes
   ------------------------------------------------------------- */

function runSimulator(cfg) {

    debugLog("=== runSimulator() START ===");
    debugLog("CONFIG:", JSON.stringify(cfg, null, 2));

    /* -----------------------------
       Cohort structure
       ----------------------------- */
    class Cohort {
        constructor(day, size) {
            this.created = day;
            this.sizeGB = size;
            this.reuseDays = [];
            this.expirations = [];
            this.deleteOn = null;
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
        simDays
    } = cfg;

    debugLog("Simulation parameters:", JSON.stringify({
        initialSizeGB,
        dailyChangeRate,
        annualGrowthRate,
        syntheticInterval,
        minImmutability,
        blockGenWindow,
        retention,
        simDays
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

    function updateDeleteOn(c) {
        if (c.reuseDays.length === 0) {
            const rpRemove = c.created + retention;
            const exp = c.created + minImmutability + blockGenWindow;
            c.deleteOn = Math.max(rpRemove, exp);
            return;
        }

        const lastRef = Math.max(...c.reuseDays);
        const rpRemove = lastRef + retention;
        const expLast = Math.max(...c.expirations);
        c.deleteOn = Math.max(rpRemove, expLast);
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

        // parser.js–style daily summary
        debugLog(`DAY ${day}: synthetic=${isSynthetic} L=${L.toFixed(2)} D=${D.toFixed(2)}`);

        if (isSynthetic) {
            const full = new Cohort(day, L);
            cohorts.push(full);
            debugLog(`  Synthetic full created cohort: created=${day} size=${L.toFixed(2)}`);

            for (const c of cohorts) {
                if (c.deleteOn === null || day < c.deleteOn) {
                    c.reuseDays.push(day);
                    c.expirations.push(day + minImmutability + blockGenWindow);
                    debugLog(`  Reuse event: cohort=${c.created} newExp=${c.expirations.at(-1)}`);
                }
            }

            dailyReason.push("Synthetic full + reuse");
        } else {
            const inc = new Cohort(day, D);
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
        cohort: c
    }));

    lifetimes.sort((a, b) => b.lifetime - a.lifetime);

    const top10 = lifetimes.slice(0, 10);
    const worst = top10[0].cohort;

    debugLog("Top 10 longest-lived cohorts:", JSON.stringify(top10, null, 2));
    debugLog("Worst cohort:", JSON.stringify({
        created: worst.created,
        lifetime: worst.deleteOn - worst.created,
        reuseCount: worst.reuseDays.length
    }, null, 2));

    function buildTimeline(c) {
        let out = "";
        const events = [];

        events.push({ day: c.created, type: "Created", exp: c.created + minImmutability + blockGenWindow });

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

Because synthetic interval < immutability+GEN:
→ Every synthetic full reuses all cohorts
→ Immutability is extended before expiration
→ No cohort can age out
→ Storage footprint grows without bound`;

    const rootCause =
`1. Synthetic interval (${syntheticInterval}) is shorter than immutability+GEN (${immPlusGen})
2. Therefore every synthetic full reuses all cohorts
3. Therefore immutability is extended before expiration
4. Therefore no cohort can expire
5. Therefore storage footprint grows linearly with days`;

    const fixes =
`To prevent rollover:
- Increase synthetic interval to > ${immPlusGen} days
OR
- Reduce immutability to < ${syntheticInterval} days
OR
- Reduce block generation window to < ${immPlusGen - minImmutability} days`;

    function capacityTable() {
        let out = "Day | Stored(GB) | Δ vs prior | Reason\n";
        out += "--------------------------------------------------\n";

        let last = 0;
        for (let d = 0; d < simDays; d += Math.ceil(simDays / 30)) {
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
        out += `Cohort ${t.id}: lived ${t.lifetime} days (reused ${t.reuseCount} times)\n`;
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
