# JACDASH Revenue Forecasting Audit and Retest

Audit date: 2026-11-27 (Asia/Manila)  
Scope: cleaned historical revenue workbook, revenue aggregation, temporal validation, forecast methods, and dashboard interpretation. This report does not edit the thesis manuscript or any saved Supabase rows.

## Dataset audit

The workbook inspected was `JACDASH_Cleaned_Actual_Sales_2024_2026.xlsx`, SHA-256 `b6999879c2afac6e43d19ed68e2cf59baaba2ff22269c12df34a59161745876d`.

| Worksheet | Use / finding |
| --- | --- |
| Overview | Workbook notes and summary; not used as transaction input. |
| Clean Sales Records | Primary transaction source. It contains 226 data rows: 222 Included, 2 Possible duplicate-excluded, and 2 Review-excluded. The parser reports zero invalid rows and imports only Included transaction rows. |
| Monthly Revenue | Forecast source after reconciliation. Its 19 observed month totals and record counts match Included transactions exactly. |
| Reference Documents | 83 rows; excluded from transactions to avoid double-counting source documents. |
| Review Flags | Review metadata; not a sales source. Two rows remain unresolved/excluded. |
| Excluded Cancellations | Six cancellation records; excluded from Included revenue. |

Included transaction revenue and Monthly Revenue both total **₱12,425,321.50**. Reconciliation errors: **0**. The data spans observed months **February 2024–August 2026**. The 19 observations form three contiguous sequences: February–July 2024 (6 months), July–November 2025 (5 months), and January–August 2026 (8 months). The 12 unreported months inside the first-to-last observed range are not represented as zero: August–December 2024, January–June 2025, and December 2025. The Monthly Revenue sheet also has no-source schedule entries before the first observed month (January 2024) and after the last (September–December 2026); these are not historical zeros.

The two review-excluded rows lack valid dates, and one also lacks quantity while the other lacks Government/Private classification. They remain unresolved and were not imported. There are two rows explicitly excluded as possible duplicates. Repeated PO/SI/DR references may represent several legitimate line items, so references were not deduplicated or rewritten absent source-document adjudication. The workbook is internally reconciled; this does not independently establish whether the source report itself omitted transactions or whether a source month is complete. Workbook notes explicitly flag possible partial-month coverage.

Among the Included records, repeated-reference screening found 1 repeated PO group (2 rows; same amount), 10 repeated SI groups (25 rows: 3 groups have one repeated amount and 7 contain multiple amounts), and 1 repeated DR group (3 rows with multiple amounts). These groups overlap across reference types and are not proof of duplicate sales; no such rows were changed. The workbook's 2 explicit Possible duplicate-excluded rows remain excluded pending source adjudication.

The historical sales **amount/revenue**, not quantity or unit price, is the target. `sales_report.py` validates the Clean Sales Records Included transaction totals against Monthly Revenue, then makes observed Monthly Revenue months the forecasting input. Missing months are absent; lag rows are built only within contiguous sequences.

Observed month-level revenue (PHP), used without inserting gap-month zeros:

| Month | Revenue | Month | Revenue | Month | Revenue |
| --- | ---: | --- | ---: | --- | ---: |
| 2024-02 | 84,000.00 | 2024-03 | 58,000.00 | 2024-04 | 410,000.00 |
| 2024-05 | 253,100.00 | 2024-06 | 1,058,700.00 | 2024-07 | 83,100.00 |
| 2025-07 | 432,891.00 | 2025-08 | 1,647,619.00 | 2025-09 | 490,753.00 |
| 2025-10 | 2,419,454.00 | 2025-11 | 73,550.00 | 2026-01 | 685,355.00 |
| 2026-02 | 118,160.00 | 2026-03 | 144,552.50 | 2026-04 | 708,755.00 |
| 2026-05 | 2,094,455.00 | 2026-06 | 680,000.00 | 2026-07 | 945,625.00 |
| 2026-08 | 37,252.00 |  |  |  |  |

The PHP run endpoint also adds system revenue from orders that are both paid and delivered. When any imported month overlaps a system-sales month, current Python aggregation prefers the imported month total wholesale to avoid double-counting. This avoids adding overlapping values but cannot reconcile transaction-level identities between sources. No Supabase query succeeded during this local audit, and the local runtime import cache contains synthetic workbook names rather than this cleaned JACDASH file. Consequently, the live database's imported workbook ID, saved row counts, and system-order additions could not be verified. No Supabase records were read, changed, or deleted in this audit.

## Defect found and correction

The previous evaluator selected a fixed-origin three-month block, but exposed it as `chronological_walk_forward`. It also trained only from the contiguous tail, which discarded valid lag examples in earlier contiguous segments. For a four-month tail, that left a single supervised training row. XGBoost and Random Forest fitted to that row predict its sole target (April 2026's ₱708,755); the Naive method also repeats its last observed value. On subsequent recursive steps, the old code refitted using its own predictions as pseudo-observed labels. This explains the repeated ₱708,755 and why the reported XGBoost/Random Forest/Naive values could coincide. It is not evidence that the methods had independently learned equivalent behavior from an adequate sample. The old fixed-origin Naive sequence also repeats April for all three months by definition.

The implementation now keeps **two explicitly separate evaluations**:

1. **Expanding one-step evaluation:** for each eligible observed target, fit on real lagged examples strictly before the target; predict one month; then reveal that month's actual before the next fold. The same eligible months are used by all five methods. Lag construction never crosses gaps. The model fit count and training row count are recorded per XGBoost fold.
2. **Fixed-origin horizon evaluation:** fit once at each chronological origin, then recursively forecast the full requested block using predictions only as future lag inputs. The estimator is not refitted on its own outputs. All five methods share the same origins and test months. The dashboard's main summary and baseline comparison continue to describe this requested-horizon evaluation; the separate one-step details are clearly labeled.

The current revenue target requires at least four consecutive observed months for a forecast context. That produces one lagged example from that four-month segment; earlier valid examples from other observed contiguous segments can also train the final model, but never bridge missing months. The 3-month production horizon remains unchanged. All forecasts are clipped at zero. XGBoost configuration remains small and regularized: 30 estimators, depth 1, learning rate 0.03, minimum child weight 1, lambda 10, seed 42, one worker, histogram tree method. Features are time index, month sine/cosine, three real revenue lags, and their three-month mean.

## Reproduced evaluation results

The following is a local, workbook-only replay using the attached clean source; it does not include live paid-and-delivered system orders. Values below are generated by the current implementation and recorded in the JSON evidence file. They are **not** a claim that a new run has been saved in Supabase.

On the requested May–July one-step subset, XGBoost has the lowest MAE, MAPE, and RMSE among these five runs. Across all seven one-step observations, it has the lowest MAE but not the lowest MAPE or RMSE. Under the fixed-origin three-month evaluation, Random Forest has the lowest MAE and RMSE while Naive has the lowest MAPE. Thus the evidence does not support a general claim that XGBoost is the most accurate method; any claim must be scoped to the specific three-month subset and clearly described as exploratory.

### One-step expanding XGBoost for May–July 2026

| Test month | Actual revenue (PHP) | XGBoost prediction (PHP) | Absolute error (PHP) | Absolute percentage error |
| --- | ---: | ---: | ---: | ---: |
| 2026-05 | ₱2,094,455.00 | ₱680,036.75 | ₱1,414,418.25 | 67.531565% |
| 2026-06 | ₱680,000.00 | ₱836,113.81 | ₱156,113.81 | 22.957913% |
| 2026-07 | ₱945,625.00 | ₱1,021,735.75 | ₱76,110.75 | 8.048724% |

Independently recalculated from those three rows: **MAE ₱548,880.94; MAPE 32.85%; RMSE ₱822,748.11** (rounded to two decimals). These three-month one-step metrics are not the same measure as the fixed-origin recursive horizon metrics below.

All five one-step methods for those months, with the origin used for each prediction:

| Method | Origin | Target | Horizon | Actual (PHP) | Predicted (PHP) | Absolute error (PHP) | Absolute percentage error |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| XGBoost | 2026-04 | 2026-05 | 1 | 2,094,455.00 | 680,036.75 | 1,414,418.25 | 67.531565% |
| XGBoost | 2026-05 | 2026-06 | 1 | 680,000.00 | 836,113.81 | 156,113.81 | 22.957913% |
| XGBoost | 2026-06 | 2026-07 | 1 | 945,625.00 | 1,021,735.75 | 76,110.75 | 8.048724% |
| Random Forest | 2026-04 | 2026-05 | 1 | 2,094,455.00 | 695,068.99 | 1,399,386.01 | 66.813849% |
| Random Forest | 2026-05 | 2026-06 | 1 | 680,000.00 | 1,177,360.40 | 497,360.40 | 73.141235% |
| Random Forest | 2026-06 | 2026-07 | 1 | 945,625.00 | 1,174,506.54 | 228,881.54 | 24.204261% |
| Linear Regression | 2026-04 | 2026-05 | 1 | 2,094,455.00 | 0.00 | 2,094,455.00 | 100.000000% |
| Linear Regression | 2026-05 | 2026-06 | 1 | 680,000.00 | 8,435,731.99 | 7,755,731.99 | 1,140.548822% |
| Linear Regression | 2026-06 | 2026-07 | 1 | 945,625.00 | 0.00 | 945,625.00 | 100.000000% |
| Naive Forecast | 2026-04 | 2026-05 | 1 | 2,094,455.00 | 708,755.00 | 1,385,700.00 | 66.160409% |
| Naive Forecast | 2026-05 | 2026-06 | 1 | 680,000.00 | 2,094,455.00 | 1,414,455.00 | 208.008088% |
| Naive Forecast | 2026-06 | 2026-07 | 1 | 945,625.00 | 680,000.00 | 265,625.00 | 28.089888% |
| Three-Month Moving Average | 2026-04 | 2026-05 | 1 | 2,094,455.00 | 323,822.50 | 1,770,632.50 | 84.539057% |
| Three-Month Moving Average | 2026-05 | 2026-06 | 1 | 680,000.00 | 982,587.50 | 302,587.50 | 44.498162% |
| Three-Month Moving Average | 2026-06 | 2026-07 | 1 | 945,625.00 | 1,161,070.00 | 215,445.00 | 22.783344% |

May–July one-step metrics independently recalculated for the same three test targets:

| Method | MAE (PHP) | MAPE | RMSE (PHP) | n |
| --- | ---: | ---: | ---: | ---: |
| XGBoost | ₱548,880.94 | 32.85% | ₱822,748.11 | 3 |
| Random Forest | ₱708,542.65 | 54.72% | ₱867,570.43 | 3 |
| Linear Regression | ₱3,598,604.00 | 446.85% | ₱4,670,200.82 | 3 |
| Naive Forecast | ₱1,021,926.67 | 100.75% | ₱1,153,459.16 | 3 |
| Three-Month Moving Average | ₱762,888.33 | 50.61% | ₱1,044,527.83 | 3 |

### Five-method one-step expanding evaluation

There are 7 eligible test observations across the observed contiguous segments: June and July 2024, November 2025, and May–August 2026. All methods use those same seven test months.

| Method | MAE (PHP) | MAPE | RMSE (PHP) | Observations |
| --- | ---: | ---: | ---: | ---: |
| XGBoost | ₱717,311.84 | 694.84% | ₱843,021.75 | 7 |
| Random Forest | ₱740,349.58 | 581.25% | ₱826,050.06 | 7 |
| Linear Regression | ₱1,803,817.44 | 381.42% | ₱3,091,897.07 | 7 |
| Naive Forecast | ₱1,157,322.43 | 1,025.76% | ₱1,304,968.41 | 7 |
| Three-Month Moving Average | ₱892,333.09 | 859.17% | ₱1,050,203.42 | 7 |

The large percentage errors are real for this sparse, volatile history, including test months with relatively small actual revenue. They are not adjusted or hidden. The table does not establish that XGBoost is best on every metric: Random Forest has lower one-step RMSE, while XGBoost has lower one-step MAE; MAPE is lower for Linear Regression in this particular sample. With only seven test months, comparisons are exploratory.

### Fixed-origin three-month evaluation (origin: April 2026)

| Method | May prediction | June prediction | July prediction | MAE | MAPE | RMSE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| XGBoost | ₱680,036.75 | ₱680,036.75 | ₱680,036.75 | ₱560,014.42 | 31.87% | ₱830,886.30 |
| Random Forest | ₱695,068.99 | ₱769,728.19 | ₱760,751.94 | ₱557,995.75 | 33.19% | ₱816,600.76 |
| Linear Regression | ₱0.00 | ₱349,923.23 | ₱0.00 | ₱1,123,385.59 | 82.85% | ₱1,340,385.40 |
| Naive Forecast | ₱708,755.00 | ₱708,755.00 | ₱708,755.00 | ₱550,441.67 | 31.81% | ₱811,808.42 |
| Three-Month Moving Average | ₱323,822.50 | ₱392,376.67 | ₱474,984.72 | ₱842,965.37 | 58.87% | ₱1,070,727.00 |

Per-target fixed-origin errors (origin April 2026; horizon is counted from that fixed origin):

| Method | Origin | Target | Horizon | Actual (PHP) | Predicted (PHP) | Absolute error (PHP) | Absolute percentage error |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| XGBoost | 2026-04 | 2026-05 | 1 | 2,094,455.00 | 680,036.75 | 1,414,418.25 | 67.531565% |
| XGBoost | 2026-04 | 2026-06 | 2 | 680,000.00 | 680,036.75 | 36.75 | 0.005404% |
| XGBoost | 2026-04 | 2026-07 | 3 | 945,625.00 | 680,036.75 | 265,588.25 | 28.086001% |
| Random Forest | 2026-04 | 2026-05 | 1 | 2,094,455.00 | 695,068.99 | 1,399,386.01 | 66.813849% |
| Random Forest | 2026-04 | 2026-06 | 2 | 680,000.00 | 769,728.19 | 89,728.19 | 13.195322% |
| Random Forest | 2026-04 | 2026-07 | 3 | 945,625.00 | 760,751.94 | 184,873.06 | 19.550357% |
| Linear Regression | 2026-04 | 2026-05 | 1 | 2,094,455.00 | 0.00 | 2,094,455.00 | 100.000000% |
| Linear Regression | 2026-04 | 2026-06 | 2 | 680,000.00 | 349,923.23 | 330,076.77 | 48.540701% |
| Linear Regression | 2026-04 | 2026-07 | 3 | 945,625.00 | 0.00 | 945,625.00 | 100.000000% |
| Naive Forecast | 2026-04 | 2026-05 | 1 | 2,094,455.00 | 708,755.00 | 1,385,700.00 | 66.160409% |
| Naive Forecast | 2026-04 | 2026-06 | 2 | 680,000.00 | 708,755.00 | 28,755.00 | 4.228676% |
| Naive Forecast | 2026-04 | 2026-07 | 3 | 945,625.00 | 708,755.00 | 236,870.00 | 25.049042% |
| Three-Month Moving Average | 2026-04 | 2026-05 | 1 | 2,094,455.00 | 323,822.50 | 1,770,632.50 | 84.539057% |
| Three-Month Moving Average | 2026-04 | 2026-06 | 2 | 680,000.00 | 392,376.67 | 287,623.33 | 42.297549% |
| Three-Month Moving Average | 2026-04 | 2026-07 | 3 | 945,625.00 | 474,984.72 | 470,640.28 | 49.770287% |

Each fitted fixed-origin method used six real lagged training rows and one fit for this block. For XGBoost, the one-step May–July rows train with 6, 7, and 8 examples respectively, refitting once per month; its full one-step evaluation has seven fits, with training counts 1, 2, 4, 6, 7, 8, and 9. The current interpreter is Python 3.14.0, NumPy 2.5.3, and XGBoost 3.4.1. The actual XGBoost model produced 30 trees and 60 leaves for the May–July fixed-origin fold; each one-step fold also fitted 30 trees (leaf counts are included per fold in the evidence JSON). No fallback was used.

Horizon-specific fixed-origin validation was also checked against the eight-month January–August 2026 tail. A one-month holdout has 4 sequential folds / 4 test observations (May–August); a two-month holdout has 2 non-overlapping folds / 4 observations (May–June and July–August); a three-month holdout has 1 fold / 3 observations (May–July). Each method receives the same folds within each horizon; per-method metrics and periods for all three horizons are recorded in the evidence JSON. These are computable but too few and too unstable to establish reliable horizon-specific accuracy. No six- or twelve-month historical holdout is available while retaining the four-month minimum context in this data. The one-step seven-observation comparison is not substituted for three-month accuracy.

For the fixed-origin May forecast, the six XGBoost training feature rows (ordered as time index, month sine, month cosine, lag 1, lag 2, lag 3, 3-month lag mean) and targets were:

| Training target month | Input months | Feature values | Target revenue (PHP) |
| --- | --- | --- | ---: |
| 2024-05 | 2024-02, 2024-03, 2024-04 | (3, 0.866025, -0.500000, 410000, 58000, 84000, 184000) | 253,100 |
| 2024-06 | 2024-03, 2024-04, 2024-05 | (4, 0.500000, -0.866025, 253100, 410000, 58000, 240366.67) | 1,058,700 |
| 2024-07 | 2024-04, 2024-05, 2024-06 | (5, 0, -1, 1058700, 253100, 410000, 573933.33) | 83,100 |
| 2025-10 | 2025-07, 2025-08, 2025-09 | (20, -1, 0, 490753, 1647619, 432891, 857087.67) | 2,419,454 |
| 2025-11 | 2025-08, 2025-09, 2025-10 | (21, -0.866025, 0.500000, 2419454, 490753, 1647619, 1519275.33) | 73,550 |
| 2026-04 | 2026-01, 2026-02, 2026-03 | (26, 1, 0, 144552.50, 118160, 685355, 316022.50) | 708,755 |

The old one-row April-origin fit was reproduced separately in the evidence JSON: its only target is ₱708,755 and its input features are `(3, 1, 0, 144552.50, 118160, 685355, 316022.50)`. XGBoost 3.4.1 sets `base_score` to `[7.08755E5]`; all 30 trees contain one zero-valued leaf (30 leaves total, zero split nodes), so its prediction is exactly the sole training target. This is direct execution evidence for the repeated XGBoost output, not a guess. With only one row, every Random Forest bootstrap sample also contains that target; the old Naive method likewise repeats April. No cache or fallback caused those values. The old recursive code also refit after appending a predicted value to training as though it were observed; the corrected fixed-origin evaluator fits once.

In the corrected six-row fixed-origin fold, XGBoost's base score is `[7.661098E5]`, with 30 trees, 60 leaves, and 30 split nodes. All 30 shallow trees split on `month_sin <= -0.866025388`; the first tree's leaves are `4509.12061` and `-3306.68799`. The May, June, and July prediction months all traverse the same right branch in each tree, which explains the equal ₱680,036.75 recursive block predictions for this particular fold. The full split/leaf values are retained in the JSON evidence. This is distinct from the old one-row zero-split explanation and remains a weak forecast due to the tiny training set.

### Future forecast, separate from the evaluation

Using all 10 valid historical lag rows across the observed segments and the latest contiguous context of January–August 2026, the local workbook-only three-month XGBoost future output is:

| Forecast month | Revenue prediction (PHP) |
| --- | ---: |
| 2026-09 | ₱953,770.94 |
| 2026-10 | ₱694,988.06 |
| 2026-11 | ₱953,770.94 |

This is a three-month projection, not an evaluation result. Its reliability is limited by the short eight-month latest context, sparse prior observations, and the single business-specific series; the dashboard warns users accordingly.

## Files and verification

Changed locally:

- `Backend/python/revenue_forecast.py` — leak-free one-step and fixed-origin evaluators, full valid-lag use, explicit execution diagnostics, full historical date range, and correct forecast/evaluation labels.
- `Backend/python/test_revenue_forecast.py` — temporal leakage, actual-reveal, equal-month comparison, gap-boundary, and fixed-origin tests.
- `Backend/python/reproduce_revenue_forecast_audit.py` — reproducible sanitized workbook audit runner.
- `Frontend/src/lib/revenue-forecast-data.ts` and `.test.ts` — parse the distinct one-step evaluation object while remaining compatible with older saved runs.
- `Frontend/src/pages/revenue-forecast-dashboard.tsx` — separate labels and tables for one-step and fixed-origin scores; future forecast remains distinct; monthly chart gaps stay visibly blank rather than connecting across unreported months.
- `docs/testing-evidence/2026-11-27/revenue-forecast-audit.json` — sanitized run output with monthly totals, per-fold predictions, model settings, library versions, and metrics.

Reproduce (from the repository root):

```powershell
Backend\.venv\Scripts\python.exe Backend\python\reproduce_revenue_forecast_audit.py "C:\Users\Erkiyel\Downloads\JACDASH_Cleaned_Actual_Sales_2024_2026.xlsx" --horizon 3 --output docs\testing-evidence\2026-11-27\revenue-forecast-audit.json
```

No manuscript content was edited. No Supabase migration, production query/write, database record, PHP endpoint, or deployment was changed. Live database imports and system-order inclusion remain unverified because the local Supabase read attempt failed before a response; use the recorded workbook-only replay for reproducible method evidence and do not replace the historical saved runs with it.

## Recommended thesis corrections (do not apply until the thesis is provided)

- **Chapter 2:** describe XGBoost, Random Forest, Linear Regression, Naive Forecast, and Three-Month Moving Average as comparison candidates. Remove any unsupported assertion that XGBoost is inherently or consistently superior. Define MAE, MAPE, and RMSE and explain that all are on monthly PHP revenue, not medicine quantities.
- **Chapter 3:** identify the cleaned workbook and its worksheet roles; state 222 Included transactions, 19 observed months, and ₱12,425,321.50 reconciled revenue. Disclose review/duplicate exclusions, reference-doc exclusion, missing months, and unknown coverage. Define one-step expanding and fixed-origin recursive evaluation separately, list the seven features and three-month lag construction, the four-consecutive-month forecast-context minimum, no gap filling, model settings, seed, versions, clipping, and metric formulas. Explain that training rows can span separate contiguous segments without constructing lags across gaps.
- **Chapter 4:** report the May–July one-step values, the three-month subset metrics, the seven-observation one-step comparison, and the separate fixed-origin comparison with its one-fold limitation. Show the September–November future outputs separately and label them predictions rather than evaluated outcomes. State that evidence is exploratory and does not establish broad model superiority or reliable long-horizon accuracy.
- **Appendices:** retain the original testing and evaluation records as historical evidence. Add the sanitized audit JSON, exact workbook hash, reproducibility command, fold counts/features/model diagnostics, and actual test command outcomes as a separate dated retest artifact. Do not replace old result tables until the adviser approves and the live data source is confirmed.

## Verification status and limits

The Python regression suite, workbook audit/reproduction runner, `forecast.py` JSON-stdin smoke test, frontend unit suite, TypeScript check, Vite production build, and PHP syntax checks were run locally. The machine-readable workbook and forecast output is `docs/testing-evidence/2026-11-27/revenue-forecast-audit.json`; it includes the exact per-method/per-month predictions and error metrics, one-step and fixed-origin folds, XGBoost training feature values, base scores, split/leaf structures, and old recursive-path reproduction. The PHP runner selects `Backend/.venv/Scripts/python.exe` when that environment exists; the CLI smoke test used that same interpreter and `Backend/python/forecast.py`.

Not verified: authenticated `POST /api/admin/forecasts/run`, PHP-to-Supabase writes/reads, live saved-run retrieval, or browser rendering against a newly persisted run. The local Supabase cURL read attempt failed before receiving an HTTP response; no credentials were displayed and no production data was changed. The code path preserves run metadata in the existing forecast-run row and future forecasts in existing forecast result rows, but this local audit cannot prove a new database run was saved. No browser login session was used. The Vite build passes with the existing large-chunk-size warning; there are no TypeScript or build errors.
