# Variance report

- Lines counted: 164 (28 with a variance)
- Gross accuracy: 94.32% · Net accuracy: 99.01%
- Gross variance: $11,562.25 · Net variance: −$2,006.45
- 9 lines drive 80% of gross variance
- Transaction history confirms 4 and supports 4 of 28 lines

## Likely causes

| Cause | Lines | Gross $ | Share |
| --- | ---: | ---: | ---: |
| Mislocated stock | 6 | $6,219.60 | 54% |
| Unit of measure | 2 | $505.15 | 4% |
| Transposed digits | 1 | $700.20 | 6% |
| Look-alike swap | 2 | $295.20 | 3% |
| Timing / unposted transaction | 2 | $1,247.60 | 11% |
| Empty location | 2 | $1,776.40 | 15% |
| Found stock | 1 | $487.80 | 4% |
| Counter accuracy | 10 | $306.40 | 3% |
| Unexplained | 2 | $23.90 | 0% |

## Needs a written root cause (≥ $1,000.00)

### C-15-04 · BAT-5100 · $1,704.00

**Observation.** BAT-5100 (Battery, group 24F) at C-15-04: system 0, counted 12, a variance of +12 units ($1,704.00).  
**Mechanism.** The same item is short in one location and over by about the same amount in another, which points to a put-away or replenishment move that went to the wrong slot. The offsetting variance is at C-14-02.  
**Evidence.** History shows a replenishment of 12 from C-14-02 to C-15-04 on Oct 18, which matches the offsetting pair.  
**Implication.** Move the stock back to its home location and correct both locations in one transfer, not two adjustments. Review the put-away that touched both slots.

### C-14-02 · BAT-5100 · −$1,704.00

**Observation.** BAT-5100 (Battery, group 24F) at C-14-02: system 18, counted 6, a variance of −12 units (−$1,704.00).  
**Mechanism.** The same item is short in one location and over by about the same amount in another, which points to a put-away or replenishment move that went to the wrong slot. The offsetting variance is at C-15-04.  
**Evidence.** History shows a replenishment of 12 from C-14-02 to C-15-04 on Oct 18, which matches the offsetting pair.  
**Implication.** Move the stock back to its home location and correct both locations in one transfer, not two adjustments. Review the put-away that touched both slots.

### D-03-01 · ALT-2400 · −$1,323.00

**Observation.** ALT-2400 (Alternator, reman) at D-03-01: system 9, counted 2, a variance of −7 units (−$1,323.00).  
**Mechanism.** The same item is short in one location and over by about the same amount in another, which points to a put-away or replenishment move that went to the wrong slot. The offsetting variance is at D-21-03.  
**Evidence.** History shows a putaway of 7 from DOCK-03 to D-21-03 on Oct 21, not a move from the paired slot. Check where the stock came from.  
**Implication.** Move the stock back to its home location and correct both locations in one transfer, not two adjustments. Review the put-away that touched both slots.

### D-21-03 · ALT-2400 · $1,323.00

**Observation.** ALT-2400 (Alternator, reman) at D-21-03: system 3, counted 10, a variance of +7 units ($1,323.00).  
**Mechanism.** The same item is short in one location and over by about the same amount in another, which points to a put-away or replenishment move that went to the wrong slot. The offsetting variance is at D-03-01.  
**Evidence.** History shows a putaway of 7 from DOCK-03 to D-21-03 on Oct 21, not a move from the paired slot. Check where the stock came from.  
**Implication.** Move the stock back to its home location and correct both locations in one transfer, not two adjustments. Review the put-away that touched both slots.

## Counters

Flagged for a variance rate well above the team's: C-07

