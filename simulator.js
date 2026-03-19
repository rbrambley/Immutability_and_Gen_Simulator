/* -------------------------------------------------------------
   simulator.js
   Full cohort-based immutability + GEN rollover simulator
   ASCII-only minimalist output for GitHub Pages
   ------------------------------------------------------------- */

function runSimulator(cfg) {

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

    /* -----------------------------
       Helper: compute logical size
       ----------------------------- */
    function logicalSize(day) {
        return initialSizeGB * Math.pow(1 + annualGrowthRate / 365, day);
    }

    /* -----------------------------
       Helper: compute delta
       ----------------------------- */
    function deltaFor(day) {
        return logicalSize(day) * dailyChangeRate;
    }

    /* -----------------------------
       Helper: update delete-on
       ----------------------------- */
    function updateDeleteOn(c) {
        if (c.reuseDays.length === 0) {
            // Never reused: delete after retention from creation
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

        if (isSynthetic) {
            // Synthetic full: new full cohort
            const full = new Cohort(day, L);
            cohorts.push(full);

            // Reuse all active cohorts
            for (const c of cohorts) {
                if (c.deleteOn === null || day < c.deleteOn) {
                    c.reuseDays.push(day);
                    c.expirations.push(day + minImmutability + blockGenWindow);
                }
            }
        } else {
            // Incremental: new delta cohort
            const inc = new Cohort(day, D);
            cohorts.push(inc);
        }

        // Update delete-on for all cohorts
        for (const c of cohorts) {
            updateDeleteOn(c);
        }

        // Compute stored GB for the day
        let stored = 0;
        for (const c of cohorts) {
            if (day >= c.created && day < c.deleteOn) {
                stored += c.sizeGB;
            }
        }
        dailyStored.push(stored);
    }

    /* -----------------------------
       SECTION A: ASCII line chart
       ----------------------------- */
    function asciiChart(values, width = 60, height = 12) {
        const max = Math.max(...values);
        const min = 0;
        const scale = (max - min) || 1;

        const rows = [];
        for (let h = 0; h < height; h++) {
            const threshold = max - (h / (height - 1)) * scale;
            let row = "";
            for (let i = 0; i < values.length; i += Math.ceil(values.length / width)) {
                row += (values[i] >= threshold ? "#" : " ");
            }
            rows.push(row);
        }
        return rows.join("\n");
    }

    const chart = asciiChart(dailyStored);

    /* -----------------------------
       SECTION B: Lifecycle summary
       ----------------------------- */
    const totalCohorts = cohorts.length;
    const reused = cohorts.filter(c => c.reuseDays.length > 0).length;
    const longest = Math.max(...cohorts.map(c => c.deleteOn - c.created));
    const avgImmutExt = average(
        cohorts.flatMap(c => c.expirations.map(e => e - c.created))
    );
    const maxGen = Math.max(
        ...cohorts.flatMap(c => c.expirations.map(e => e - c.created))
    );

    function average(arr) {
        if (arr.length === 0) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    /* -----------------------------
       SECTION C: ASCII timeline
       ----------------------------- */
    function timelineExample() {
        return "[Created]---M---G---(Reuse)---M---G---(Reuse)---M---G---[DeleteOn]";
    }

    /* -----------------------------
       SECTION D: Effective retention
       ----------------------------- */
    const lastReuse = Math.max(
        0,
        ...cohorts.flatMap(c => c.reuseDays.length ? [Math.max(...c.reuseDays)] : [])
    );

    const effectiveRetention = lastReuse + minImmutability + blockGenWindow;

    /* -----------------------------
       SECTION E: Capacity table
       ----------------------------- */
    function capacityTable() {
        let out = "Day | Logical(GB) | NewData(GB) | Stored(GB)\n";
        out += "--------------------------------------------------\n";
        for (let d = 0; d < simDays; d += Math.ceil(simDays / 30)) {
            out += `${d.toString().padStart(3)} | ` +
                   `${dailyLogical[d].toFixed(1).padStart(11)} | ` +
                   `${dailyDelta[d].toFixed(1).padStart(11)} | ` +
                   `${dailyStored[d].toFixed(1).padStart(10)}\n`;
        }
        return out;
    }

    /* -----------------------------
       SECTION F: Key insights
       ----------------------------- */
    const insights = [
        `Reused blocks extend immutability by an average of ${avgImmutExt.toFixed(1)} days`,
        `Synthetic fulls contribute ${((reused / totalCohorts) * 100).toFixed(1)}% of long-tail retention`,
        `Actual storage footprint peaks at ${(Math.max(...dailyStored) / initialSizeGB).toFixed(2)}x logical size`
    ];

    /* -----------------------------
       Assemble final ASCII dashboard
       ----------------------------- */
    let out = "";
    out += "============================================================\n";
    out += "SECTION A: STORAGE OVER TIME (ASCII CHART)\n";
    out += "============================================================\n";
    out += chart + "\n\n";

    out += "============================================================\n";
    out += "SECTION B: BLOCK LIFECYCLE SUMMARY\n";
    out += "============================================================\n";
    out += `Total cohorts created: ${totalCohorts}\n`;
    out += `Cohorts reused:        ${reused}\n`;
    out += `Longest-lived cohort:  ${longest} days\n`;
    out += `Avg immutability ext:  ${avgImmutExt.toFixed(1)} days\n`;
    out += `Max GEN rollover:      ${maxGen} days\n\n`;

    out += "============================================================\n";
    out += "SECTION C: IMMUTABILITY + RETENTION TIMELINE\n";
    out += "============================================================\n";
    out += timelineExample() + "\n\n";

    out += "============================================================\n";
    out += "SECTION D: EFFECTIVE RETENTION\n";
    out += "============================================================\n";
    out += `Last reuse day:       ${lastReuse}\n`;
    out += `Effective retention:  ${effectiveRetention} days\n\n`;

    out += "============================================================\n";
    out += "SECTION E: CAPACITY FORECAST TABLE\n";
    out += "============================================================\n";
    out += capacityTable() + "\n";

    out += "============================================================\n";
    out += "SECTION F: KEY INSIGHTS\n";
    out += "============================================================\n";
    insights.forEach(i => out += "- " + i + "\n");

    return out;
}
