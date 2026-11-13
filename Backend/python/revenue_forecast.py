"""Revenue-only monthly forecasting with chronological walk-forward evaluation."""

from __future__ import annotations

import base64
import hashlib
import io
import math
import random
import unicodedata
from collections import defaultdict
from datetime import date, datetime

import numpy as np
import openpyxl

MAX_ROWS = 50_000
MIN_MONTHS = 4
HORIZONS = {1, 3, 6, 12}
SEED = 42
ALIASES = {
    "date": {"date", "sale date", "sales date", "transaction date", "invoice date"},
    "amount": {"sales amount", "amount", "revenue", "total sales", "invoice amount", "net sales"},
    "invoice": {"invoice", "invoice number", "invoice no", "reference", "delivery reference", "transaction id"},
    "customer": {"customer", "client", "institution", "customer name", "institution name"},
    "product": {"medicine", "medicine/product", "product", "description", "item", "medicine description"},
}
MODEL_NAMES = {
    "xgboost": "XGBoost",
    "random_forest": "Random Forest Regression",
    "linear_regression": "Linear Regression",
    "naive": "Naive Forecast",
    "moving_average_3": "Three-Month Moving Average",
}


def normalize_header(value: object) -> str:
    value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    return " ".join(value.strip().lower().replace("_", " ").replace("-", " ").split())


def parse_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        raw = value.strip()
        for fmt in ("%Y-%m-%d", "%Y-%m", "%m/%d/%Y", "%d/%m/%Y", "%b %d, %Y", "%B %d, %Y"):
            try:
                return datetime.strptime(raw, fmt).date()
            except ValueError:
                continue
    return None


def parse_amount(value: object) -> float | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    raw = str(value).strip().replace(",", "").replace("₱", "").replace("PHP", "").strip()
    try:
        amount = float(raw)
    except (TypeError, ValueError, OverflowError):
        return None
    return amount if math.isfinite(amount) and amount >= 0 else None


def json_safe_excel_value(value: object) -> object:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def preview_excel(excel_base64: str) -> dict:
    try:
        content = base64.b64decode(excel_base64, validate=True)
    except Exception as exc:
        raise ValueError("The workbook could not be decoded.") from exc
    try:
        workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise ValueError("Choose a valid .xlsx workbook.") from exc
    sheet = workbook.active
    rows = sheet.iter_rows(values_only=True)
    headers = next(rows, None)
    if not headers:
        raise ValueError("The workbook is empty.")
    source_headers = [json_safe_excel_value(value) for value in headers]
    found: dict[str, int] = {}
    columns: dict[str, str] = {}
    for index, header in enumerate(headers):
        normalized = normalize_header(header)
        for field, aliases in ALIASES.items():
            if normalized in aliases and field not in found:
                found[field] = index
                columns[field] = str(header)
    if "date" not in found or "amount" not in found:
        raise ValueError("Revenue forecasting requires Date and Sales Amount columns. Quantity Sold is not used.")

    records: list[dict] = []
    errors: list[dict] = []
    duplicates = 0
    invalid_rows = 0
    seen_fingerprints: set[str] = set()
    nonempty_rows = 0
    source_rows: list[dict] = []
    for row_number, row in enumerate(rows, start=2):
        if all(value is None or value == "" for value in row):
            continue
        nonempty_rows += 1
        if nonempty_rows > MAX_ROWS:
            raise ValueError(f"The workbook exceeds the {MAX_ROWS:,} row limit.")
        source_rows.append({"row": row_number, "values": [json_safe_excel_value(value) for value in row]})
        get = lambda key: row[found[key]] if key in found and found[key] < len(row) else None
        date_value = parse_date(get("date"))
        amount = parse_amount(get("amount"))
        invoice = str(get("invoice") or "").strip()
        customer = str(get("customer") or "").strip()
        product = str(get("product") or "").strip()
        messages: list[str] = []
        if date_value is None:
            messages.append("Date is missing or invalid.")
        if amount is None:
            messages.append("Sales Amount must be a valid nonnegative PHP amount.")
        if messages:
            invalid_rows += 1
            if len(errors) < 100:
                errors.append({"row": row_number, "messages": messages})
            continue
        record = {
            "date": date_value.isoformat(),
            "salesAmount": round(amount, 2),
            "invoiceReference": invoice or None,
            "customer": customer or None,
            "productDescription": product or None,
            "sourceRow": row_number,
        }
        # Only deduplicate where an invoice/reference exists. Identical rows
        # without a reference may be legitimate separate transactions.
        if invoice:
            fingerprint = hashlib.sha256("|".join((invoice.casefold(), record["date"], f"{amount:.2f}", customer.casefold(), product.casefold())).encode()).hexdigest()
            if fingerprint in seen_fingerprints:
                duplicates += 1
                continue
            seen_fingerprints.add(fingerprint)
        records.append(record)
    workbook.close()
    if not records and not errors:
        raise ValueError("The workbook contains no transaction rows.")
    months = sorted({record["date"][:7] for record in records})
    missing_months: list[str] = []
    if months:
        start = datetime.strptime(months[0], "%Y-%m").date()
        end = datetime.strptime(months[-1], "%Y-%m").date()
        cursor = start.year * 12 + start.month - 1
        final = end.year * 12 + end.month - 1
        present = set(months)
        while cursor <= final:
            year, month0 = divmod(cursor, 12)
            label = f"{year:04d}-{month0 + 1:02d}"
            if label not in present:
                missing_months.append(label)
            cursor += 1
    return {
        "records": records,
        "rawRowCount": nonempty_rows,
        "validRows": len(records),
        "invalidRows": invalid_rows,
        "duplicateRows": duplicates,
        "errors": errors,
        "columns": columns,
        "sourceHeaders": source_headers,
        "sourceRecords": source_rows,
        "errorsTruncated": invalid_rows > len(errors),
        "historicalStartDate": min(record["date"] for record in records),
        "historicalEndDate": max(record["date"] for record in records),
        "observedMonths": len(months),
        "missingMonths": missing_months,
        "preview": records[:10],
    }


def month_number(period: str) -> int:
    year, month = (int(part) for part in period.split("-"))
    return year * 12 + month - 1


def month_label(ordinal: int) -> str:
    year, month0 = divmod(ordinal, 12)
    return f"{year:04d}-{month0 + 1:02d}"


def aggregate_monthly(records: list[dict]) -> tuple[list[str], list[float]]:
    totals: dict[str, float] = defaultdict(float)
    for row in records:
        parsed = parse_date(row.get("date"))
        amount = parse_amount(row.get("salesAmount"))
        if parsed is None or amount is None:
            continue
        totals[parsed.strftime("%Y-%m")] += amount
    months = sorted(totals)
    return months, [round(totals[month], 2) for month in months]


def feature_row(index: int, values: list[float], calendar_ordinal: int) -> list[float]:
    month = calendar_ordinal % 12
    return [
        float(index), math.sin(2 * math.pi * month / 12), math.cos(2 * math.pi * month / 12),
        float(values[index - 1]), float(values[index - 2]), float(values[index - 3]),
        float(sum(values[index - 3:index]) / 3),
    ]


def make_model(name: str):
    if name == "xgboost":
        try:
            from xgboost import XGBRegressor
        except ImportError as exc:
            raise RuntimeError("XGBoost is not installed in the PHP forecast Python environment. Install Backend/python/requirements.txt.") from exc
        return XGBRegressor(
            # A small, regularized tree ensemble is intentional: at the
            # four-month minimum the lag features produce only one training
            # sample. No rows are duplicated to make the estimator appear
            # better supported.
            objective="reg:squarederror", n_estimators=30, max_depth=1,
            learning_rate=0.03, min_child_weight=1, subsample=1.0,
            colsample_bytree=1.0, reg_lambda=10.0, reg_alpha=0.0,
            random_state=SEED, n_jobs=1, tree_method="hist", verbosity=0,
        )
    if name == "linear_regression":
        return "linear_regression"
    return name


def random_forest_predict(x: np.ndarray, y: np.ndarray, next_x: np.ndarray) -> float:
    """Small deterministic CART forest for the Random Forest baseline.

    This avoids scikit-learn's blocked native extensions in the Windows runtime
    while retaining bootstrap aggregation, random feature subsets, squared
    error splits, and mean regression leaves. At tiny sample sizes trees remain
    shallow rather than creating artificial observations.
    """
    rng = random.Random(SEED)
    feature_count = x.shape[1]
    feature_subset_size = max(1, int(math.sqrt(feature_count)))

    def grow(indices: list[int], depth: int, tree_rng: random.Random):
        leaf_value = float(np.mean(y[indices])) if indices else 0.0
        if depth >= 3 or len(indices) < 4:
            return (leaf_value,)
        features = tree_rng.sample(range(feature_count), feature_subset_size)
        best: tuple[float, int, float, list[int], list[int]] | None = None
        for feature in features:
            ordered = sorted({float(x[index, feature]) for index in indices})
            for lower, upper in zip(ordered, ordered[1:]):
                threshold = (lower + upper) / 2
                left = [index for index in indices if x[index, feature] <= threshold]
                right = [index for index in indices if x[index, feature] > threshold]
                if len(left) < 2 or len(right) < 2:
                    continue
                left_mean = float(np.mean(y[left]))
                right_mean = float(np.mean(y[right]))
                error = float(np.sum((y[left] - left_mean) ** 2) + np.sum((y[right] - right_mean) ** 2))
                if best is None or error < best[0]:
                    best = (error, feature, threshold, left, right)
        if best is None:
            return (leaf_value,)
        _, feature, threshold, left, right = best
        return (feature, threshold, grow(left, depth + 1, tree_rng), grow(right, depth + 1, tree_rng))

    def predict_tree(node, row) -> float:
        if len(node) == 1:
            return node[0]
        feature, threshold, left, right = node
        return predict_tree(left if row[feature] <= threshold else right, row)

    sample_count = len(y)
    if sample_count == 0:
        raise ValueError("Random Forest needs at least one lagged training row.")
    predictions: list[float] = []
    for _ in range(100):
        bootstrap = [rng.randrange(sample_count) for _ in range(sample_count)]
        tree = grow(bootstrap, 0, rng)
        predictions.append(predict_tree(tree, next_x[0]))
    return float(np.mean(predictions))


def predict_recursive(name: str, observed: list[float], horizon: int, start_ordinal: int) -> list[float]:
    values = list(observed)
    if len(values) < MIN_MONTHS:
        raise ValueError(f"At least {MIN_MONTHS} consecutive monthly revenues are required for training.")
    for target_index in range(len(values), len(values) + horizon):
        if name in {"naive", "moving_average_3"}:
            prediction = values[-1] if name == "naive" else sum(values[-3:]) / 3
        else:
            x = np.asarray([feature_row(index, values, start_ordinal + index) for index in range(3, len(values))], dtype=float)
            y = np.asarray(values[3:], dtype=float)
            next_x = np.asarray([feature_row(target_index, values, start_ordinal + target_index)], dtype=float)
            if len(y) < 1:
                raise ValueError("At least one valid three-month-lag training row is required for forecasting.")
            if name == "linear_regression":
                design = np.column_stack([np.ones(len(x)), x])
                coefficients, *_ = np.linalg.lstsq(design, y, rcond=None)
                prediction = float((np.column_stack([np.ones(1), next_x]) @ coefficients)[0])
            elif name == "random_forest":
                prediction = random_forest_predict(x, y, next_x)
            else:
                model = make_model(name)
                model.fit(x, y)
                prediction = float(model.predict(next_x)[0])
        values.append(max(0.0, prediction))
    return [round(value, 2) for value in values[-horizon:]]


def regression_metrics(actual: list[float], predicted: list[float]) -> dict:
    if not actual:
        return {"mae": None, "mape": None, "rmse": None, "testObservations": 0, "mapeSamples": 0, "zeroActualObservations": 0}
    a = np.asarray(actual, dtype=float)
    p = np.asarray(predicted, dtype=float)
    errors = p - a
    positive = a != 0
    return {
        "mae": round(float(np.mean(np.abs(errors))), 2),
        "mape": round(float(np.mean(np.abs(errors[positive] / a[positive])) * 100), 2) if np.any(positive) else None,
        "rmse": round(float(np.sqrt(np.mean(errors ** 2))), 2),
        "testObservations": len(actual),
        "mapeSamples": int(np.count_nonzero(positive)),
        "zeroActualObservations": int(len(actual) - np.count_nonzero(positive)),
    }


def forecast(records: list[dict], horizon: int, system_records: list[dict] | None = None) -> dict:
    if horizon not in HORIZONS:
        raise ValueError("Forecast horizon must be 1, 3, 6, or 12 months.")
    imported_months, imported_values = aggregate_monthly(records)
    system_months, system_values = aggregate_monthly(system_records or [])
    overlaps = set(imported_months) & set(system_months)
    # If the source periods overlap but transaction references cannot be joined,
    # prefer the uploaded report for those months to avoid double-counting.
    system_by_month = {month: value for month, value in zip(system_months, system_values) if month not in overlaps}
    combined = {month: value for month, value in zip(imported_months, imported_values)}
    combined.update({month: value for month, value in system_by_month.items() if month not in combined})
    months = sorted(combined)
    if not months:
        raise ValueError("No valid dated revenue records were provided.")
    # Missing months remain unknown. Train only on the contiguous observed tail;
    # they are never converted to zero-valued revenue.
    tail_start = len(months) - 1
    while tail_start > 0 and month_number(months[tail_start]) - month_number(months[tail_start - 1]) == 1:
        tail_start -= 1
    training_months = months[tail_start:]
    values = [combined[month] for month in training_months]
    training_start_ordinal = month_number(training_months[0])
    if len(values) < MIN_MONTHS:
        raise ValueError(f"Insufficient consecutive monthly revenue history: {len(values)} observed months; at least {MIN_MONTHS} are required. Missing months are not treated as zero.")

    # A final model can train from four consecutive actuals (one three-lag
    # sample). Evaluation has a separate data requirement: reserve only folds
    # with at least four earlier observations and a full requested horizon.
    # If none fit, keep the real forecast and report null metrics.
    origins = list(range(MIN_MONTHS - 1, len(values) - horizon, horizon))
    comparisons = []
    for model_name in MODEL_NAMES:
        actual_all: list[float] = []
        predicted_all: list[float] = []
        periods: list[str] = []
        for origin in origins:
            observed = values[:origin + 1]
            predicted = predict_recursive(model_name, observed, horizon, training_start_ordinal)
            fold_actual = values[origin + 1:origin + 1 + horizon]
            actual_all.extend(fold_actual)
            predicted_all.extend(predicted)
            periods.extend(training_months[origin + 1:origin + 1 + horizon])
        comparisons.append({
            "modelType": model_name,
            "label": MODEL_NAMES[model_name],
            "selected": model_name == "xgboost",
            "metrics": regression_metrics(actual_all, predicted_all),
            "evaluationPeriodStart": periods[0] if periods else None,
            "evaluationPeriodEnd": periods[-1] if periods else None,
            "forecastHorizon": horizon,
        })

    predicted_future = predict_recursive("xgboost", values, horizon, training_start_ordinal)
    latest_ordinal = month_number(training_months[-1])
    actual_chart = [{"period": month, "actualRevenue": combined[month]} for month in months]
    forecast_chart = [{"period": month_label(latest_ordinal + offset), "forecastRevenue": amount} for offset, amount in enumerate(predicted_future, 1)]
    xgb_comparison = next(item for item in comparisons if item["modelType"] == "xgboost")
    complete_span = list(range(month_number(months[0]), month_number(months[-1]) + 1))
    missing = [month_label(period) for period in complete_span if month_label(period) not in combined]
    return {
        "predictionTarget": "monthly_sales_revenue_php",
        "modelType": "xgboost",
        "modelLabel": MODEL_NAMES["xgboost"],
        "modelConfig": {"objective": "reg:squarederror", "nEstimators": 30, "maxDepth": 1, "learningRate": 0.03, "minChildWeight": 1, "regLambda": 10.0, "seed": SEED, "treeMethod": "hist"},
        "historicalStartDate": training_months[0] + "-01",
        "historicalEndDate": training_months[-1] + "-01",
        "forecastHorizon": horizon,
        "minimumRequiredMonths": MIN_MONTHS,
        "trainingObservationCount": max(0, len(values) - 3),
        "testObservationCount": xgb_comparison["metrics"]["testObservations"],
        "evaluationMethod": "chronological_walk_forward",
        "evaluationAvailable": bool(origins),
        "evaluationPeriodStart": xgb_comparison["evaluationPeriodStart"],
        "evaluationPeriodEnd": xgb_comparison["evaluationPeriodEnd"],
        "metrics": xgb_comparison["metrics"],
        "modelComparisons": comparisons,
        "actualMonthlyRevenue": actual_chart,
        "forecastMonthlyRevenue": forecast_chart,
        "dataLimitationWarning": (
            f"Limited history: this forecast uses {len(values)} consecutive monthly observations and "
            f"{max(0, len(values) - 3)} lagged training row(s). Forecast reliability may be reduced."
            + (" No separate chronological test is available for this horizon, so MAE, MAPE, and RMSE are not reported." if not origins else "")
        ) if len(values) < 12 or not origins else None,
        "missingMonths": missing,
        "overlapMonthsUsingImportedOnly": sorted(overlaps),
        "overlapSystemMonthsExcluded": len(overlaps),
        "forecastVersion": "revenue_xgboost_walkforward_v1",
    }
