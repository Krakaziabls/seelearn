# srs-scheduling Specification

## Purpose
Provides a mathematically sound, realistic spaced repetition (SRS) scheduling engine that prevents exponential interval runaway, adapts sublinearly to overdue reviews, limits horizon to 365 days, and balances review loads across calendar days to prevent cohort clustering.

## Requirements

### Requirement: Strict Ease Factor Bounds
The SRS scheduling engine MUST enforce strict lower and upper bounds on the Ease Factor ($\text{EF} \in [1.3, 2.5]$). The Easy rating (`[4]`) MUST NOT increase $\text{EF}$ above 2.5. The Again rating (`[1]`) and Hard rating (`[2]`) MUST NOT decrease $\text{EF}$ below 1.3.

#### Scenario: Easy rating hits upper boundary
- **GIVEN** a card with an Ease Factor of 2.45
- **WHEN** the card is reviewed with the Easy rating (`[4]`)
- **THEN** the updated Ease Factor is capped at exactly 2.50 rather than exceeding it

#### Scenario: Lapse rating hits lower boundary
- **GIVEN** a card with an Ease Factor of 1.40
- **WHEN** the card is reviewed with the Again rating (`[1]`)
- **THEN** the updated Ease Factor is floored at exactly 1.30

---

### Requirement: Sublinear Overdue Scaling
When a card is reviewed after its scheduled due date ($\text{elapsedDays} > \text{interval}$ and $\text{interval} > 0$), the scheduling engine MUST compute the effective base interval $I_{\text{eff}}$ using sublinear square-root growth:
$$I_{\text{eff}} = \text{interval} + \sqrt{\text{elapsedDays} - \text{interval}}$$
When a card is reviewed on time or before its due date, $I_{\text{eff}} = \max(1, \text{interval})$.

#### Scenario: Sublinear scaling on overdue card
- **GIVEN** a mature card with interval 10 days reviewed after 59 elapsed days (49 days overdue)
- **WHEN** the review calculation is performed
- **THEN** $I_{\text{eff}}$ equals $10 + \sqrt{49} = 17$ days, avoiding linear inflation from the 49 overdue days

#### Scenario: On-time review does not inflate
- **GIVEN** a card with interval 10 days reviewed on day 10
- **WHEN** the review calculation is performed
- **THEN** $I_{\text{eff}}$ equals 10 days

---

### Requirement: Stability Damping Factor
The scheduling engine MUST compute a Stability Damping Factor $D$ and effective Good multiplier $M_{\text{good}}$ for mature cards:
$$D = \frac{1}{(1 + I_{\text{eff}} / 90)^{0.35} \times (1 + 0.08 \times \min(\text{lapses}, 5))}$$
$$M_{\text{good}} = 1 + (\text{EF} - 1) \times D$$
As interval and lapses increase, the growth rate MUST progressively dampen to prevent exponential runaway.

#### Scenario: Damping dampens growth for mature cards
- **GIVEN** a card with $I_{\text{eff}} = 90$, $\text{EF} = 2.5$, and $\text{lapses} = 0$
- **WHEN** computing $M_{\text{good}}$
- **THEN** $D \approx 1 / (2^{0.35}) \approx 0.7846$ and $M_{\text{good}} \approx 1 + 1.5 \times 0.7846 \approx 2.177$, strictly below the un-damped factor of 2.5

#### Scenario: Damping penalizes cards with past lapses
- **GIVEN** two cards with identical $I_{\text{eff}} = 30$ and $\text{EF} = 2.5$, where Card A has 0 lapses and Card B has 4 lapses
- **WHEN** computing $D$ and $M_{\text{good}}$
- **THEN** Card B receives a strictly smaller multiplier $M_{\text{good}} than Card A

---

### Requirement: Again Rating Recovery Step
When a card is rated as Again (`[1]`), repetitions MUST reset to 0, lapses MUST increment by 1, and the Ease Factor MUST decrease by 0.2 down to the 1.3 floor. For mature cards ($\text{interval} \ge 10$), the engine MUST assign a recovery interval of $\min(7, \max(1, \text{round}(\text{interval} \times 0.15)))$ rather than resetting to 1 day; for all other cards, the interval MUST reset to 1 day.

#### Scenario: Again rating on mature card provides recovery step
- **GIVEN** a mature card with interval 30 days and 0 lapses
- **WHEN** the user rates the card as Again (`[1]`)
- **THEN** $I_{\text{raw}} = \min(7, \max(1, \text{round}(30 \times 0.15))) = 5$ days, repetitions reset to 0, and lapses become 1

#### Scenario: Again rating on young card resets to 1 day
- **GIVEN** a young card with interval 6 days
- **WHEN** the user rates the card as Again (`[1]`)
- **THEN** $I_{\text{raw}} = 1$ day

---

### Requirement: Rating Progressions for Hard, Good, and Easy
The scheduling engine MUST calculate $I_{\text{raw}}$ and repetition increments per rating:
- Hard (`[2]`): $\max(\text{interval} + 1, \text{round}(I_{\text{eff}} \times 1.2 \times (1 - 0.04 \times \min(\text{lapses}, 5))))$.
- Good (`[3]`): 1 day for rep 1, 4 days for rep 2, and $\text{round}(I_{\text{eff}} \times M_{\text{good}})$ for rep 3+.
- Easy (`[4]`): 4 days for rep 1, 8 days for rep 2, and $\text{round}(I_{\text{eff}} \times M_{\text{good}} \times 1.25)$ for rep 3+.

#### Scenario: Good progression across first three reviews
- **GIVEN** a new card reviewed 3 consecutive times with Good (`[3]`)
- **WHEN** each review is calculated
- **THEN** the first review yields 1 day, the second yields 4 days, and the third yields $\text{round}(4 \times M_{\text{good}})$ days

#### Scenario: Easy progression across first three reviews
- **GIVEN** a new card reviewed 3 consecutive times with Easy (`[4]`)
- **WHEN** each review is calculated
- **THEN** the first review yields 4 days, the second yields 8 days, and the third yields $\text{round}(8 \times M_{\text{good}} \times 1.25)$ days

---

### Requirement: Compression and 365-Day Horizon Ceiling
The scheduling engine MUST clamp all calculated intervals to a maximum horizon of $\text{MAX\_INTERVAL} = 365$ days. To avoid hard clustering at the 365-day boundary for large intervals, when $I_{\text{raw}} > 180$, the engine MUST apply smooth hyperbolic compression:
$$I_{\text{target}} = \min\left(365, \text{round}\left(\frac{365 \times I_{\text{raw}}}{365 + I_{\text{raw}} \times 0.35}\right)\right)$$
For $I_{\text{raw}} \le 180$, $I_{\text{target}} = \min(365, I_{\text{raw}})$.

#### Scenario: Raw interval exceeding 180 days is smoothly compressed
- **GIVEN** a hypothetical raw interval $I_{\text{raw}} = 300$
- **WHEN** calculating $I_{\text{target}}$
- **THEN** $I_{\text{target}} = \text{round}(365 \times 300 / (365 + 300 \times 0.35)) = \text{round}(109500 / 470) = 233$ days, remaining comfortably below 365

#### Scenario: Infinite reviews never exceed 365 days
- **GIVEN** a card repeatedly evaluated with Good (`[3]`) or Easy (`[4]`) over 50 consecutive reviews
- **WHEN** each interval is computed
- **THEN** no interval ever exceeds 365 days

---

### Requirement: Dispersion Window Calculation
For any target interval $I_{\text{target}} \ge 3$, the scheduling engine MUST compute a dispersion window $[I_{\min}, I_{\max}]$ with radius $\delta = \max(1, \text{round}(I_{\text{target}} \times 0.18))$, $I_{\min} = \max(2, I_{\text{target}} - \delta)$, and $I_{\max} = \min(365, I_{\text{target}} + \delta)$. For $I_{\text{target}} < 3$, the engine MUST set $I_{\min} = I_{\max} = I_{\text{target}}$.

#### Scenario: Dispersion window for short learning steps
- **GIVEN** a target interval of 1 or 2 days
- **WHEN** computing the dispersion window
- **THEN** $I_{\min}$ and $I_{\max}$ equal $I_{\text{target}}$, preserving initial learning steps without premature fuzzing

#### Scenario: Dispersion window for mature target interval
- **GIVEN** a target interval of 10 days
- **WHEN** computing the dispersion window
- **THEN** $\delta = \text{round}(1.8) = 2$, yielding $I_{\min} = 8$ and $I_{\max} = 12$

---

### Requirement: Calendar Load Balancing and Tie-Breaking
When provided with an optional `scheduleContext` containing `dueCountsByDay`, the engine MUST pick day $d \in [I_{\min}, I_{\max}]$ minimizing $\text{score}(d) = (\text{dueCountsByDay}[d] \mathbin{??} 0) + 0.35 \times |d - I_{\text{target}}|$. When multiple days tie on minimal score, the engine MUST break ties deterministically using a hash of `seed` (or `cardId`) and repetitions. During active sessions, `StudyView` MUST update `dueCountsByDay` in real time.

#### Scenario: Cohort of 200 cards spreads across multiple days
- **GIVEN** 200 new cards evaluated as Good (`[3]`) during a single study session with live `scheduleContext`
- **WHEN** the cards transition to their second and third review cycles
- **THEN** by cycle 2 the cohort is spread across at least 3 distinct days with peak day $\le 70$ cards, and by cycle 3 across at least 7 distinct days with peak day reduced by more than $4\times$ compared to the initial batch

#### Scenario: Deterministic tie-breaking without scheduleContext
- **GIVEN** review calculation called without `dueCountsByDay` but with a `seed` or `cardId`
- **WHEN** calculating the final interval within $[I_{\min}, I_{\max}]$
- **THEN** the chosen interval is deterministically reproducible and distributed across the window
