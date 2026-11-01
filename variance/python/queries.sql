-- Variance in SQL (SQLite 3.25+ for window functions).
-- Expects one table:
--   counts(location TEXT, sku TEXT, description TEXT, system_qty REAL, counted_qty REAL,
--          unit_cost REAL, counter TEXT, count_date TEXT, last_movement TEXT)
-- Each query is separated by a "-- name:" line so it can be run on its own.

-- name: line_variance
-- One row per counted line with its variance in units and dollars.
CREATE VIEW IF NOT EXISTS line_variance AS
SELECT
  rowid AS line_no,
  location, sku, description, system_qty, counted_qty, unit_cost, counter,
  counted_qty - system_qty                          AS var_units,
  (counted_qty - system_qty) * unit_cost            AS var_dollars,
  MAX(system_qty, 0) * unit_cost                    AS book_value
FROM counts;

-- name: accuracy
-- Gross accuracy counts every variance dollar; net lets overs and shorts offset.
SELECT
  COUNT(*)                                                        AS lines,
  SUM(var_units <> 0)                                             AS variance_lines,
  ROUND(1.0 - SUM(var_units <> 0) * 1.0 / COUNT(*), 4)            AS location_accuracy,
  ROUND(SUM(ABS(var_dollars)), 2)                                 AS gross_variance,
  ROUND(SUM(var_dollars), 2)                                      AS net_variance,
  ROUND(1.0 - SUM(ABS(var_dollars)) / SUM(book_value), 4)         AS gross_accuracy,
  ROUND(1.0 - ABS(SUM(var_dollars)) / SUM(book_value), 4)         AS net_accuracy
FROM line_variance;

-- name: pareto
-- Variance lines ranked by dollar impact, with the running share of gross variance.
SELECT
  location, sku, ROUND(var_dollars, 2) AS dollars,
  ROUND(SUM(ABS(var_dollars)) OVER (ORDER BY ABS(var_dollars) DESC, line_no
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
        / SUM(ABS(var_dollars)) OVER (), 4)                       AS cumulative_share
FROM line_variance
WHERE var_units <> 0
ORDER BY ABS(var_dollars) DESC, line_no;

-- name: mislocated_pairs
-- Same SKU over in one location and short by about the same amount (within 15%) in another.
SELECT
  o.sku,
  o.location   AS over_location,  o.var_units  AS over_units,
  s.location   AS short_location, s.var_units  AS short_units,
  ROUND(o.var_dollars, 2) AS dollars_moved
FROM line_variance o
JOIN line_variance s
  ON  s.sku = o.sku
  AND s.location <> o.location
  AND o.var_units >= 3
  AND s.var_units < 0
  AND ABS(o.var_units + s.var_units) <= 0.15 * MAX(o.var_units, -s.var_units)
ORDER BY ABS(o.var_dollars) DESC;

-- name: uom_candidates
-- System and counted quantities that differ by an exact pack multiple.
WITH packs(k) AS (VALUES (6),(8),(10),(12),(16),(20),(24),(25),(36),(48),(50),(100))
SELECT v.location, v.sku, v.system_qty, v.counted_qty, p.k AS pack_size
FROM line_variance v
JOIN packs p
  ON ABS(MAX(v.system_qty, v.counted_qty) / MIN(v.system_qty, v.counted_qty) - p.k) < 0.02 * p.k
WHERE v.system_qty > 0 AND v.counted_qty > 0 AND ABS(v.var_units) >= 5;

-- name: counter_rates
-- Each counter's variance rate against the team's.
WITH team AS (SELECT AVG(var_units <> 0) AS team_rate FROM line_variance WHERE counter <> '')
SELECT
  counter,
  COUNT(*)                                  AS lines,
  SUM(var_units <> 0)                       AS variance_lines,
  ROUND(AVG(var_units <> 0), 4)             AS variance_rate,
  ROUND((SELECT team_rate FROM team), 4)    AS team_rate,
  CASE WHEN COUNT(*) >= 8
        AND AVG(var_units <> 0) >= MAX(2 * (SELECT team_rate FROM team), (SELECT team_rate FROM team) + 0.1)
       THEN 1 ELSE 0 END                    AS flagged
FROM line_variance
WHERE counter <> ''
GROUP BY counter
ORDER BY variance_rate DESC;

-- name: confirmed_mislocations
-- Needs a second table: transactions(date, sku, type, from_location, to_location, qty).
-- A mislocated pair is confirmed when the history has a move of that SKU from the short slot to the over slot.
SELECT
  o.sku,
  s.location AS short_location, o.location AS over_location, o.var_units AS units,
  t.date AS moved_on, t.type, t.qty AS qty_moved
FROM line_variance o
JOIN line_variance s
  ON  s.sku = o.sku AND s.location <> o.location
  AND o.var_units >= 3 AND s.var_units < 0
  AND ABS(o.var_units + s.var_units) <= 0.15 * MAX(o.var_units, -s.var_units)
JOIN transactions t
  ON  t.sku = o.sku AND t.from_location = s.location AND t.to_location = o.location
ORDER BY ABS(o.var_dollars) DESC;

-- name: activity_before_count
-- Variance lines with any transaction at their location in the 3 days before the count: likely timing issues.
SELECT
  v.location, v.sku, v.var_units, t.date AS activity_on, t.type, t.qty,
  CAST(julianday(c.count_date) - julianday(t.date) AS INTEGER) AS days_before_count
FROM line_variance v
JOIN counts c ON c.rowid = v.line_no
JOIN transactions t
  ON  t.sku = v.sku AND (t.to_location = v.location OR t.from_location = v.location)
  AND julianday(c.count_date) - julianday(t.date) BETWEEN 0 AND 3
WHERE v.var_units <> 0
ORDER BY v.location;

-- name: repeat_variances
-- Needs a second table, prior_counts, with the same columns: an earlier count of the same locations.
-- Lines that were off last time and are off again, largest combined dollars first.
SELECT
  c.location, c.sku, c.description,
  p.counted_qty - p.system_qty                                        AS prev_units,
  c.var_units                                                         AS units,
  ROUND((p.counted_qty - p.system_qty) * p.unit_cost, 2)              AS prev_dollars,
  ROUND(c.var_dollars, 2)                                             AS dollars,
  CASE WHEN (p.counted_qty > p.system_qty) = (c.var_units > 0)
       THEN 'same direction' ELSE 'flipped' END                       AS direction
FROM line_variance c
JOIN prior_counts p ON p.sku = c.sku AND p.location = c.location
WHERE c.var_units <> 0 AND p.counted_qty <> p.system_qty
ORDER BY ABS((p.counted_qty - p.system_qty) * p.unit_cost) + ABS(c.var_dollars) DESC, c.location;
