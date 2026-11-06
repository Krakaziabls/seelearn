# Design

## Context
See `proposal.md` for motivation and background.

Currently, `src/srs.ts` is an isolated pure module that calculates next review dates and intervals via standard SM-2 formulas. State is stored in `CardProgressRecord` (`interval`, `easeFactor`, `repetitions`, `dueDate`, `lastReviewed`, `lapses`).

To modernize this without breaking changes or note pollution, all mathematical enhancements and load balancing must operate within the existing data schema, taking advantage of optional runtime context (`ScheduleContext`).

## Goals / Non-Goals

**Goals:**
- Eliminate 20,000+ day runaway intervals with mathematical damping and a strict 365-day ceiling.
- Accurately scale overdue intervals using sublinear square-root growth instead of ignoring delay or linear blowout.
- Break up synchronized cohorts (100–200 cards) by spreading next due dates across a dynamic dispersion window based on calendar load.
- Keep `src/srs.ts` completely decoupled from Obsidian API (100% testable in Node.js test runner).
- Maintain 100% backwards compatibility with existing `data.json` files and zero markdown modification.

**Non-Goals:**
- Expanding `CardProgressRecord` with new persistent fields (no schema migrations or storage bloat).
- Retroactively modifying intervals of cards stored in `data.json` (cards adapt naturally during their next review).
- Modifying UI layouts or adding complex calendar visualization views.

## Decisions

### 1. Retention of CardProgressRecord Schema & Transient ScheduleContext
Instead of persisting new fields like `targetInterval`, `fuzzOffset`, or `calendarDay` in `data.json`, `calculateSRSReview` is extended with an optional fourth argument:
```typescript
export interface ScheduleContext {
  dueCountsByDay?: Record<number, number>; // day offset from today -> count of scheduled cards
  seed?: string | number; // cardId or unique salt for deterministic tie-breaking
}

export function calculateSRSReview(
  record: CardProgressRecord | undefined,
  rating: SRSRating,
  today = new Date(),
  context?: ScheduleContext
): SRSReviewResult
```
*Rationale:* Keeps `data.json` lean, prevents schema migrations, and allows callers without calendar awareness (e.g., offline scripts or previews) to still get valid, deterministic intervals.

### 2. Overdue Scaling & Elapsed Days Calculation
`elapsedDays` is computed from `record.lastReviewed`:
```typescript
let elapsedDays = currentInterval;
if (record?.lastReviewed) {
  const lastDate = new Date(record.lastReviewed);
  const diffMs = today.getTime() - lastDate.getTime();
  elapsedDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

const isOverdue = elapsedDays > currentInterval && currentInterval > 0;
const I_eff = isOverdue
  ? currentInterval + Math.sqrt(elapsedDays - currentInterval)
  : Math.max(1, currentInterval);
```
*Rationale:* If a user successfully recalls a card 60 days late on a 10-day interval, they have demonstrated retention for 60 days, but multiplying by 60 would be hazardous. Adding $\sqrt{50} \approx 7$ produces $I_{\text{eff}} = 17$, giving safe, grounded credit for the retention.

### 3. Stability Damping Factor & EF Upper Cap
```typescript
const D = 1 / (Math.pow(1 + I_eff / 90, 0.35) * (1 + 0.08 * Math.min(currentLapses, 5)));
const M_good = 1 + (currentEase - 1) * D;
```
- Ease Factor is strictly clamped: $\text{EF} \in [1.3, 2.5]$.
- On Easy rating: $\text{newEase} = \min(2.5, \text{currentEase} + 0.15)$.
- On Hard rating: $\text{newEase} = \max(1.3, \text{currentEase} - 0.15)$.
- On Again rating: $\text{newEase} = \max(1.3, \text{currentEase} - 0.2)$.
*Rationale:* Prevents Ease Factor from spiraling up to 3.0+ or down below 1.3, while $D$ smoothly slows geometric growth as intervals exceed 90 days.

### 4. Smooth Hyperbolic Compression before 365-Day Ceiling
```typescript
const MAX_INTERVAL = 365;
let I_target = I_raw;
if (I_raw > 180) {
  I_target = Math.min(MAX_INTERVAL, Math.round((MAX_INTERVAL * I_raw) / (MAX_INTERVAL + I_raw * 0.35)));
} else {
  I_target = Math.min(MAX_INTERVAL, I_raw);
}
```
*Rationale:* Rather than a hard clip that clusters all mature cards onto day 365, hyperbolic compression asymptotically compresses intervals from 180 to 365 smoothly.

### 5. Load-Aware Calendar Fuzzing & Deterministic Tie-Breaker
For $I_{\text{target}} \ge 3$:
- $\delta = \max(1, \text{round}(I_{\text{target}} \times 0.18))$
- Window: $[I_{\min}, I_{\max}] = [\max(2, I_{\text{target}} - \delta), \min(365, I_{\text{target}} + \delta)]$
- Objective function: $\text{score}(d) = (\text{dueCountsByDay}[d] \mathbin{??} 0) + 0.35 \times |d - I_{\text{target}}|$
- Tie-breaking: when multiple days yield the lowest score (e.g. all have 0 cards scheduled), tie is resolved via:
  ```typescript
  function hashSeed(seed: string | number, reps: number): number {
    const str = `${seed}:${reps}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0);
  }
  ```
  The candidate day $d$ with the smallest hash offset is selected.
*Rationale:* Guarantees consistent dispersion even when `dueCountsByDay` is empty, ensuring that batches of cards never clump together.

### 6. Live In-Session Load Tracking in `StudyView`
In `StudyView`:
- When starting or resuming a session, aggregate all existing due dates from `plugin.storage.data.progress` into a `dueCountsByDay: Record<number, number>` map (day offset from today: `Math.round((dueDate - today) / 86400000)`).
- When a user rates a card, pass `scheduleContext: { dueCountsByDay, seed: card.id }` to `recordReview`.
- Increment `dueCountsByDay[result.interval] = (dueCountsByDay[result.interval] ?? 0) + 1` immediately.
*Rationale:* Zero noticeable runtime latency ($O(N)$ once on session start, $O(1)$ per review), spreading a 200-card session across several days in real time.

## Risks / Trade-offs

- **[Risk] Existing unit test assertions fail due to updated interval constants**  
  → *Mitigation:* Review 2 in the old SM-2 was 6 days; in the modernized specification it is 4 days (Good) or 8 days (Easy), and $M_{\text{good}}$ uses damping. Existing unit tests in `tests/srs.test.ts` will be methodically updated to match the modernized specification.
- **[Risk] Clock skew or negative elapsed days if user system time changes**  
  → *Mitigation:* `Math.max(0, ...)` ensures negative elapsed days cannot occur.
- **[Risk] CPU overhead when scanning large vault progress**  
  → *Mitigation:* A vault with 10,000 cards takes $< 2\text{ms}$ to aggregate a single `Record<number, number>` map.
