# Forecasting and inventory alert implementation

## Forecasting architecture

Admin Home calls the existing PHP forecast API. PHP validates the workbook, invokes `Backend/python/forecast.py` through the configured Python executable, stores source/import metadata in Supabase, and persists each run and its monthly results. The React revenue dashboard reads the same API and displays historical revenue, future revenue, evaluation metrics, model comparisons, and saved runs.

New revenue forecasts use `XGBRegressor` as the selected model. Existing medicine-quantity forecast runs and their results remain preserved and are identified separately. Company revenue predictions are not medicine demand estimates and are not used for medicine-specific restock recommendations.

### Data rules and preprocessing

- Excel import requires a valid transaction `Date` and nonnegative `Sales Amount` (PHP). Quantity is not used for revenue forecasting.
- The import keeps the original nonempty worksheet row values and separately stores validated, normalized transaction records. It reports invalid rows and duplicate invoice-reference rows.
- Rows with the same invoice/reference, date, amount, customer, and product are treated as duplicate records. Rows without an invoice/reference are not deduplicated because they may be distinct sales.
- Revenue is summed by observed calendar month. Missing months remain gaps; the model does not invent transactions or fill absent months with zero.
- Training uses the trailing consecutive block of observed months. At least 12 such months are required. The earliest/latest source transaction dates are retained for report context; partial reporting periods should be checked against the source report before interpreting results.
- Completed system sales are orders marked delivered whose latest payment is paid. If imported and system records overlap by month, the imported monthly total is preferred for the overlapping month to avoid double-counting.

### Model and evaluation

The selected XGBoost configuration is deterministic (`seed=42`, 60 estimators, max depth 2, learning rate 0.04, minimum child weight 2, L2 regularization 3, one CPU worker, histogram tree method). Features include time index, calendar month sine/cosine, lagged observed revenue (1, 2, and 3 months), and the trailing three-month mean. Future values are generated recursively using only prior observations/predictions and clipped at zero.

XGBoost is compared with Random Forest, ordinary Linear Regression, a naive last-value forecast, and a three-month moving average. Each method uses the same non-overlapping chronological walk-forward folds and requested 1, 3, 6, or 12-month horizon. No random split is used. Evaluation is unavailable when the available consecutive history cannot provide both model training and a full requested test horizon. MAE and RMSE are in PHP; MAPE is calculated only for nonzero actual revenue months, with zero-month counts shown separately.

No actual company workbook was supplied for this implementation check, so no model accuracy result is claimed here. Unit fixtures validate parsing and metric mechanics only; they are not model-performance evidence. Model-comparison values shown after a run must be generated from the user's real/imported records.

## Inventory alerts

After each successful admin login and each navigation into `/admin/inventory`, the alert host fetches the current medicine list from PHP and reevaluates it. A warning dialog appears only when at least one warning exists. Dismissal is temporary: a later login, a later Inventory entry, or an inventory mutation triggers a fresh check. Alert badges and filters remain on the admin inventory table.

- Out of stock: quantity is exactly zero.
- Low stock: quantity is greater than zero and less than or equal to the configured threshold; default is 10 units.
- Expired: expiry date is before today's Asia/Manila date.
- Expiring soon: expiry date is today through the configured warning window; default is 90 days.

The current schema stores expiration at medicine level, not per lot/batch. Therefore these alerts cannot distinguish multiple batches of the same medicine. Threshold preferences currently live in the administrator's browser (`localStorage`) and are not shared across devices. Expired medicines are rejected by server-side order creation; they are not deleted automatically.

## Database, deployment, and security

Migration `Backend/supabase/migrations/20261113000100_revenue_forecasting_and_imports.sql` is required before deploying revenue forecasting. It adds an RLS-enabled, service-role-only `forecast_imports` table to preserve uploaded source/normalized rows across Render restarts, adds a target discriminator and evaluation JSON to forecast runs, and adds nullable revenue results while retaining the old quantity result field. It does not drop or rewrite existing forecast rows. Apply this migration in the intended Supabase project, then verify its PostgREST schema cache refresh; this implementation has not applied it to production.

The new Python requirements are `scikit-learn` (for the comparison baseline) and `xgboost`; `libgomp1` is installed in the existing Linux Docker image for XGBoost. PHP continues to use the existing server-side Supabase service-role key and invokes the configured `ONCOPHIL_PYTHON`; no credentials are added to frontend code or image layers. Deploy the migration and backend image together before using the new dashboard. Forecast history remains in Supabase; the existing local `Backend/runtime` directory is not used to persist new imports.

## Verification status and limitations

Run the frontend production build, PHP syntax check, and Python unit suite listed in the delivery summary. The local Windows `.venv` is intentionally not changed; Windows Code Integrity previously blocked scientific native extensions. The supported XGBoost runtime is the Linux Docker/Render environment. A real authenticated API forecast and Supabase persistence test requires the migration plus authorized project credentials and real sales data, so it is not claimed by local static/unit checks.
