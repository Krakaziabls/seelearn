# Tasks

## 1. Type Definitions & Contracts

- [x] 1.1 Define `ScheduleContext` in `src/types.ts` without modifying `CardProgressRecord` and verify TypeScript compiles via `npx tsc --noEmit`
- [x] 1.2 Export `ScheduleContext` and updated signature types in `src/srs.ts` and verify no `obsidian` imports are added to `src/srs.ts`

## 2. Core Mathematical SRS Engine Modernization

- [x] 2.1 Implement strict Ease Factor clamping within $[1.3, 2.5]$ in `calculateSRSReview` and verify EF boundaries in unit tests
- [x] 2.2 Implement sublinear overdue scaling ($I_{\text{eff}} = \text{interval} + \sqrt{\text{elapsedDays} - \text{interval}}$) based on `record.lastReviewed` and verify with overdue edge cases
- [x] 2.3 Implement Stability Damping Factor $D$ and effective Good multiplier $M_{\text{good}} = 1 + (\text{EF} - 1) \times D$
- [x] 2.4 Update raw rating interval formulas: Again recovery step ($\min(7, \max(1, \text{round}(I \times 0.15)))$ for $I \ge 10$), Hard ($\max(I+1, \text{round}(I_{\text{eff}} \times 1.2 \times (1 - 0.04 \times \min(L, 5))))$, Good (1d -> 4d -> $\text{round}(I_{\text{eff}} \times M_{\text{good}})$), and Easy (4d -> 8d -> $\text{round}(I_{\text{eff}} \times M_{\text{good}} \times 1.25)$)
- [x] 2.5 Implement smooth hyperbolic compression for $I_{\text{raw}} > 180$ and enforce the 365-day ceiling ($\text{MAX\_INTERVAL} = 365$)
- [x] 2.6 Implement load-aware fuzzing window $[I_{\min}, I_{\max}]$, penalty scoring function $\text{score}(d) = (\text{dueCountsByDay}[d] \mathbin{??} 0) + 0.35 \times |d - I_{\text{target}}|$, and deterministic seed/hash tie-breaker

## 3. Storage & StudyView Real-Time Calendar Load Balancing

- [x] 3.1 Update `StorageManager.recordReview` in `src/storage.ts` to accept optional `scheduleContext` and pass `cardId` as seed to `calculateSRSReview`
- [x] 3.2 Add calendar load aggregation (`dueCountsByDay`) in `StudyView` (`src/view.ts`), passing live context to `recordReview` and incrementing the count for the assigned day in real time
- [x] 3.3 Pass `scheduleContext` to `getSRSIntervalPreviews` in `StudyView` so predicted interval badges reflect load-aware balancing

## 4. Automated Testing & Behavioral Verification

- [x] 4.1 Update existing tests in `tests/srs.test.ts` to reflect the updated Good/Easy step 2 intervals and bounded EF
- [x] 4.2 Add **Horizon Test** (anti-runaway): verify that 20 consecutive Good or Easy ratings never exceed 365 days and exhibit sublinear growth past 90 days
- [x] 4.3 Add **Cohort De-clustering Test** (anti-avalanche): simulate a batch of 200 new cards rated Good in a single day and verify cycle 2 spreads across $\ge 3$ days (peak day $\le 70$ cards) and cycle 3 spreads across $\ge 7$ days (peak load reduced by $> 4\times$)
- [x] 4.4 Add **Overdue Scaling Test**: verify a card with interval 10 days reviewed after 59 days receives a bounded, realistic interval increase
- [x] 4.5 Add **Deterministic Tie-Breaker Test**: verify reproducible interval dispersion in the absence of `dueCountsByDay`

## 5. System Verification

- [x] 5.1 Run full typecheck and build via `npm run verify` (`tsc --noEmit`, Node.js test suite, esbuild production bundle) and verify all tests pass with zero errors
- [x] 5.2 Validate OpenSpec change integrity via `openspec validate srs-realistic-intervals-and-load-balancing`
