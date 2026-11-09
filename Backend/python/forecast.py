#!/usr/bin/env python3
"""Excel validation, monthly model comparison, and Linear Regression forecasts."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import random
import sys
import unicodedata
from collections import defaultdict
from datetime import date, datetime

import numpy as np
import openpyxl
import xlrd


MAX_ROWS = 50_000


def normalized_header(value: object) -> str:
    value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    return " ".join(value.strip().lower().replace("_", " ").replace("-", " ").split())


ALIASES = {
    "date": {"date", "sale date", "sales date", "transaction date", "order date"},
    "medicine": {"medicine", "medicine name", "medicine/product", "product", "product name", "item", "item name"},
    "quantity": {"quantity sold", "quantity", "qty sold", "qty", "units sold"},
    "salesAmount": {"sales amount", "amount", "revenue", "total sales"},
}


def parse_date(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        pass
    for fmt in (
        "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%d/%m/%Y",
        "%m-%d-%Y", "%Y-%m-%d", "%Y-%m", "%b %d, %Y",
        "%B %d, %Y", "%d-%b-%Y", "%Y-%m-%d %H:%M:%S",
    ):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def parse_number(value: object) -> float | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        return float(value)
    except (TypeError, ValueError, OverflowError):
        return None


def workbook_rows(raw: bytes) -> list[tuple[int, list[object]]]:
    """Read the first worksheet from xlsx or legacy xls workbooks."""
    if raw.startswith(b"PK"):
        workbook = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        try:
            sheet = workbook.worksheets[0]
            return [(row_number, list(values)) for row_number, values in enumerate(sheet.iter_rows(values_only=True), start=1)]
        finally:
            workbook.close()

    workbook = xlrd.open_workbook(file_contents=raw, on_demand=True)
    try:
        sheet = workbook.sheet_by_index(0)
        rows: list[tuple[int, list[object]]] = []
        for row_index in range(sheet.nrows):
            values: list[object] = []
            for cell in sheet.row(row_index):
                if cell.ctype == xlrd.XL_CELL_DATE:
                    values.append(xlrd.xldate_as_datetime(cell.value, workbook.datemode))
                elif cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                    values.append(None)
                else:
                    values.append(cell.value)
            rows.append((row_index + 1, values))
        return rows
    finally:
        workbook.release_resources()


def parse_excel(encoded: str) -> dict:
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValueError("The uploaded workbook could not be decoded.") from exc
    if len(raw) > 10 * 1024 * 1024:
        raise ValueError("Excel files must be 10 MB or smaller.")
    try:
        rows = workbook_rows(raw)
    except Exception as exc:
        raise ValueError(f"Unable to read the first worksheet: {exc}") from exc
    if not rows or not any(value is not None and value != "" for value in rows[0][1]):
        raise ValueError("The first worksheet is empty.")

    headers: dict[str, object] = {}
    header_values = rows[0][1]
    for column_index, column in enumerate(header_values):
        if column is None or str(column).strip() == "":
            continue
        name = normalized_header(column)
        for target, names in ALIASES.items():
            if name in names and target not in headers:
                headers[target] = (column_index, column)
    missing = [label for label, key in (("Date", "date"), ("Medicine/Product", "medicine"), ("Quantity Sold", "quantity")) if key not in headers]
    if missing:
        raise ValueError("Missing required column(s): " + ", ".join(missing) + ". Accepted headers include Date, Medicine/Product, and Quantity Sold.")

    records: list[dict] = []
    errors: list[dict] = []
    row_count = 0
    for excel_row, row in rows[1:]:
        if all(value is None or value == "" for value in row):
            continue
        row_count += 1
        if row_count > MAX_ROWS:
            raise ValueError(f"The worksheet exceeds the {MAX_ROWS:,} row limit.")
        date_value = parse_date(row[headers["date"][0]] if headers["date"][0] < len(row) else None)
        medicine = row[headers["medicine"][0]] if headers["medicine"][0] < len(row) else None
        quantity = parse_number(row[headers["quantity"][0]] if headers["quantity"][0] < len(row) else None)
        amount = None
        row_errors: list[str] = []
        if date_value is None:
            row_errors.append("Date is missing or invalid.")
        if medicine is None or not str(medicine).strip():
            row_errors.append("Medicine/Product is missing.")
        if quantity is None or not math.isfinite(quantity) or quantity < 0:
            row_errors.append("Quantity Sold must be a finite, non-negative number.")
        if "salesAmount" in headers:
            amount_index = headers["salesAmount"][0]
            raw_amount = row[amount_index] if amount_index < len(row) else None
            if raw_amount is not None and raw_amount != "":
                parsed_amount = parse_number(raw_amount)
                if parsed_amount is None or not math.isfinite(parsed_amount) or parsed_amount < 0:
                    row_errors.append("Sales Amount must be blank or a finite, non-negative number.")
                else:
                    amount = parsed_amount
        if row_errors:
            if len(errors) < 100:
                errors.append({"row": excel_row, "messages": row_errors})
            continue
        record = {
            "date": date_value.strftime("%Y-%m-%d"),
            "medicine": str(medicine).strip(),
            "quantity": quantity,
        }
        if amount is not None:
            record["salesAmount"] = amount
        records.append(record)

    if len(records) == 0 and not errors:
        raise ValueError("The worksheet contains no sales rows.")
    return {
        "records": records,
        "rowCount": row_count,
        "validRows": len(records),
        "invalidRows": row_count - len(records),
        "errors": errors,
        "errorsTruncated": row_count - len(records) > len(errors),
        "preview": records[:12],
        "columns": {key: str(value[1]) for key, value in headers.items()},
    }


def product_key(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().casefold()
    return "".join(character for character in text if character.isalnum())


def safe_metric(values: np.ndarray, predictions: np.ndarray) -> dict:
    errors = predictions - values
    nonzero = values != 0
    return {
        "mae": round(float(np.mean(np.abs(errors))), 4),
        "rmse": round(float(np.sqrt(np.mean(errors ** 2))), 4),
        "mape": round(float(np.mean(np.abs(errors[nonzero] / values[nonzero])) * 100), 4) if np.any(nonzero) else None,
        "mapeSamples": int(np.count_nonzero(nonzero)),
    }


def month_ordinal(value: datetime) -> int:
    return value.year * 12 + value.month - 1


def month_start(ordinal: int) -> datetime:
    year, month_index = divmod(ordinal, 12)
    return datetime(year, month_index + 1, 1)


def linear_regression_predict(x: np.ndarray, y: np.ndarray, predict_x: np.ndarray) -> np.ndarray:
    """Fit y = slope*x + intercept by ordinary least squares."""
    x_values = np.asarray(x, dtype=float).reshape(-1)
    y_values = np.asarray(y, dtype=float).reshape(-1)
    centered_x = x_values - x_values[0]
    design = np.column_stack((centered_x, np.ones_like(centered_x)))
    coefficients, _, _, _ = np.linalg.lstsq(design, y_values, rcond=None)
    target = np.asarray(predict_x, dtype=float).reshape(-1)
    return (target - x_values[0]) * coefficients[0] + coefficients[1]


def seasonal_linear_regression_predict(x: np.ndarray, y: np.ndarray, predict_x: np.ndarray) -> np.ndarray:
    """OLS trend plus annual sine/cosine terms on calendar-month ordinals."""
    x_values = np.asarray(x, dtype=float).reshape(-1)
    y_values = np.asarray(y, dtype=float).reshape(-1)
    target = np.asarray(predict_x, dtype=float).reshape(-1)
    origin = x_values[0]
    train_time = x_values - origin
    target_time = target - origin
    train_phase = 2 * np.pi * np.mod(x_values, 12) / 12
    target_phase = 2 * np.pi * np.mod(target, 12) / 12
    design = np.column_stack((np.ones_like(train_time), train_time, np.sin(train_phase), np.cos(train_phase)))
    target_design = np.column_stack((np.ones_like(target_time), target_time, np.sin(target_phase), np.cos(target_phase)))
    coefficients, _, _, _ = np.linalg.lstsq(design, y_values, rcond=None)
    return target_design @ coefficients


def random_forest_predict(x: np.ndarray, y: np.ndarray, predict_x: np.ndarray, seed: int) -> np.ndarray:
    """Small deterministic random-forest regressor using only NumPy/Python."""
    x_values = np.asarray(x, dtype=float).reshape(-1)
    y_values = np.asarray(y, dtype=float).reshape(-1)
    target = np.asarray(predict_x, dtype=float).reshape(-1)
    origin = x_values[0]

    def make_features(values: np.ndarray) -> np.ndarray:
        phase = 2 * np.pi * np.mod(values, 12) / 12
        return np.column_stack((values - origin, np.sin(phase), np.cos(phase)))

    features = make_features(x_values)
    target_features = make_features(target)
    generator = random.Random(seed)
    trees: list[object] = []
    min_leaf = max(2, int(math.sqrt(len(y_values)) / 3))

    def grow(indices: list[int], depth: int, rng: random.Random) -> object:
        values = y_values[indices]
        mean = float(np.mean(values))
        if depth <= 0 or len(indices) < min_leaf * 2 or np.all(values == values[0]):
            return mean
        best: tuple[float, int, float, list[int], list[int]] | None = None
        columns = rng.sample(range(features.shape[1]), 2)
        for column in columns:
            unique = sorted(set(float(features[index, column]) for index in indices))
            thresholds = [(left + right) / 2 for left, right in zip(unique, unique[1:])]
            if len(thresholds) > 12:
                thresholds = sorted(rng.sample(thresholds, 12))
            for threshold in thresholds:
                left = [index for index in indices if features[index, column] <= threshold]
                right = [index for index in indices if features[index, column] > threshold]
                if len(left) < min_leaf or len(right) < min_leaf:
                    continue
                left_mean = float(np.mean(y_values[left]))
                right_mean = float(np.mean(y_values[right]))
                loss = float(np.sum((y_values[left] - left_mean) ** 2) + np.sum((y_values[right] - right_mean) ** 2))
                if best is None or loss < best[0]:
                    best = (loss, column, threshold, left, right)
        if best is None:
            return mean
        _, column, threshold, left, right = best
        return (column, threshold, grow(left, depth - 1, rng), grow(right, depth - 1, rng))

    def predict_tree(tree: object, row: np.ndarray) -> float:
        node = tree
        while isinstance(node, tuple):
            column, threshold, left, right = node
            node = left if row[int(column)] <= threshold else right
        return float(node)

    sample_count = len(y_values)
    for _ in range(32):
        rng = random.Random(generator.randrange(2**32))
        bootstrap = [rng.randrange(sample_count) for _ in range(sample_count)]
        trees.append(grow(bootstrap, 5, rng))
    predictions = np.asarray([
        np.mean([predict_tree(tree, row) for tree in trees])
        for row in target_features
    ])
    return predictions


def holt_winters_predict(periods: list[int], values: np.ndarray, target_periods: list[int]) -> np.ndarray:
    """Additive monthly Holt-Winters; requires two complete observed seasons."""
    y = np.asarray(values, dtype=float).reshape(-1)
    if len(y) < 24 or any(right - left != 1 for left, right in zip(periods, periods[1:])):
        raise ValueError("Holt-Winters requires at least 24 consecutive observed months.")
    first_season = float(np.mean(y[:12]))
    second_season = float(np.mean(y[12:24]))
    level = first_season
    trend = (second_season - first_season) / 12
    seasonal = [float(value - first_season) for value in y[:12]]
    alpha, beta, gamma = 0.5, 0.2, 0.3
    for index in range(12, len(y)):
        previous_level = level
        season = seasonal[index % 12]
        level = alpha * (y[index] - season) + (1 - alpha) * (level + trend)
        trend = beta * (level - previous_level) + (1 - beta) * trend
        seasonal[index % 12] = gamma * (y[index] - level) + (1 - gamma) * season
    output = []
    last_period = periods[-1]
    for period in target_periods:
        steps = period - last_period
        output.append(level + steps * trend + seasonal[period % 12])
    return np.asarray(output, dtype=float)


MODEL_LABELS = {
    "linear_regression": "Linear Regression",
    "seasonal_linear_regression": "Seasonal Linear Regression",
    "random_forest_regression": "Random Forest Regression",
    "holt_winters": "Holt-Winters Exponential Smoothing",
}


def predict_with_model(model_type: str, periods: list[int], values: np.ndarray, target_periods: list[int], seed: int) -> np.ndarray:
    if model_type == "linear_regression":
        return linear_regression_predict(np.asarray(periods), values, np.asarray(target_periods))
    if model_type == "seasonal_linear_regression":
        return seasonal_linear_regression_predict(np.asarray(periods), values, np.asarray(target_periods))
    if model_type == "random_forest_regression":
        return random_forest_predict(np.asarray(periods), values, np.asarray(target_periods), seed)
    if model_type == "holt_winters":
        return holt_winters_predict(periods, values, target_periods)
    raise ValueError(f"Unknown forecasting model: {model_type}")


def model_candidates(periods: list[int], values: np.ndarray) -> list[dict]:
    count = len(values)
    candidates = [{"modelType": "linear_regression", "available": count >= 2, "reason": None if count >= 2 else "At least two training observations are required."}]
    seasonal_ok = count >= 24 and periods[-1] - periods[0] >= 24
    candidates.append({"modelType": "seasonal_linear_regression", "available": seasonal_ok, "reason": None if seasonal_ok else "Requires at least 24 training observations spanning two or more years."})
    forest_ok = count >= 12
    candidates.append({"modelType": "random_forest_regression", "available": forest_ok, "reason": None if forest_ok else "Requires at least 12 training observations for comparison."})
    winters_ok = count >= 24 and all(right - left == 1 for left, right in zip(periods, periods[1:]))
    candidates.append({"modelType": "holt_winters", "available": winters_ok, "reason": None if winters_ok else "Requires at least 24 consecutive observed months; gaps are not filled with invented zeros."})
    return candidates


def comparison_seed(medicine_id: str) -> int:
    return int(hashlib.sha256(medicine_id.encode("utf-8")).hexdigest()[:8], 16)


def forecast(payload: dict) -> dict:
    horizon = int(payload.get("horizon", 3))
    if horizon < 1 or horizon > 12:
        raise ValueError("Forecast horizon must be between 1 and 12 months.")

    medicines = list(payload.get("medicines", []))
    sales = list(payload.get("systemSales", []))
    excel_sales = list(payload.get("excelSales", []))
    medicine_by_name: dict[str, dict] = {}
    ambiguous_medicine_names: set[str] = set()
    for medicine in medicines:
        key = product_key(medicine.get("name", ""))
        if not key:
            continue
        existing = medicine_by_name.get(key)
        if existing is not None and str(existing.get("id")) != str(medicine.get("id")):
            ambiguous_medicine_names.add(key)
        medicine_by_name[key] = medicine
    historical_by_id: dict[str, dict] = {}
    for row in excel_sales:
        historical_name = str(row.get("medicine", "")).strip()
        normalized_name = product_key(historical_name)
        if not normalized_name:
            raise ValueError("A historical sales row has no medicine name.")
        if normalized_name in ambiguous_medicine_names:
            raise ValueError(f"Historical medicine name '{historical_name}' matches multiple current inventory names after normalization.")
        match = medicine_by_name.get(normalized_name)
        if match:
            medicine_id = str(match["id"])
            medicine_name = str(match["name"]).strip()
        else:
            medicine_id = "historical:" + hashlib.sha256(normalized_name.encode("utf-8")).hexdigest()[:24]
            medicine_name = historical_name
            historical_by_id.setdefault(medicine_id, {
                "id": medicine_id,
                "name": medicine_name,
                "stock_quantity": 0,
                "in_inventory": False,
                "database_medicine_id": None,
            })
        sales.append({"medicineId": medicine_id, "medicine": medicine_name, "date": row["date"], "quantity": row["quantity"]})
    medicines.extend(historical_by_id.values())
    for medicine in medicines:
        medicine.setdefault("in_inventory", True)
        medicine.setdefault("database_medicine_id", medicine.get("id"))
    if not medicines:
        raise ValueError("No current inventory or historical medicine sales are available for forecasting.")
    if not sales:
        raise ValueError("There is no completed system sales or validated Excel sales data to forecast.")

    grouped: dict[tuple[str, int], float] = defaultdict(float)
    overall_actual: dict[int, float] = defaultdict(float)
    for row in sales:
        date_value = parse_date(row.get("date"))
        quantity = parse_number(row.get("quantity"))
        medicine_id = row.get("medicineId")
        if date_value is None or quantity is None or medicine_id is None:
            continue
        period = month_ordinal(date_value)
        grouped[(str(medicine_id), period)] += quantity
        overall_actual[period] += quantity
    if not grouped:
        raise ValueError("There is no valid dated sales data to forecast.")
    all_periods = [period for _, period in grouped]
    global_start = month_start(min(all_periods))
    global_end = month_start(max(all_periods))

    result_rows: list[dict] = []
    chart: dict[str, list[dict]] = {}
    per_medicine: list[dict] = []
    validation_actual: list[float] = []
    validation_predictions: list[float] = []
    model_comparisons: list[dict] = []
    forecastable = 0
    future_periods = list(range(max(all_periods) + 1, max(all_periods) + horizon + 1))
    for medicine in medicines:
        medicine_id = str(medicine["id"])
        med = {period: quantity for (group_medicine_id, period), quantity in grouped.items() if group_medicine_id == medicine_id}
        if not med:
            per_medicine.append({"medicineId": medicine["id"], "medicineName": medicine["name"], "status": "insufficient", "reason": "No sales recorded in the supplied history.", "observationCount": 0, "modelObservationCount": 0, "inInventory": medicine["in_inventory"], "currentStock": int(medicine.get("stock_quantity", 0)) if medicine["in_inventory"] else None, "forecastDemand": None, "suggestedAdditionalStock": None, "recommendation": "Insufficient sales data", "metrics": None})
            chart[str(medicine["id"])] = []
            continue
        # Only recorded calendar-month totals are observations. Do not invent
        # zero-sale observations for calendar months absent from the source.
        periods = sorted(med)
        series = np.asarray([med[period] for period in periods], dtype=float)
        actual_points = [{"period": month_start(period).strftime("%Y-%m"), "actual": round(float(value), 4), "forecast": None} for period, value in zip(periods, series)]
        item_chart = actual_points.copy()
        observed_month_count = len(med)
        if observed_month_count < 4:
            per_medicine.append({"medicineId": medicine["id"], "medicineName": medicine["name"], "status": "insufficient", "reason": f"At least 4 distinct months with recorded sales are required; found {observed_month_count}.", "observationCount": observed_month_count, "modelObservationCount": len(periods), "inInventory": medicine["in_inventory"], "currentStock": int(medicine.get("stock_quantity", 0)) if medicine["in_inventory"] else None, "forecastDemand": None, "suggestedAdditionalStock": None, "recommendation": "Insufficient sales data", "metrics": None})
            chart[str(medicine["id"])] = item_chart
            continue

        y = series
        holdout = max(1, int(math.ceil(len(y) * 0.2)))
        test_start = len(y) - holdout
        training_periods = periods[:test_start]
        training_values = y[:test_start]
        test_periods = periods[test_start:]
        test_values = y[test_start:]
        months_since_last_sale = max(all_periods) - periods[-1]
        seed = comparison_seed(medicine_id)

        # The baseline remains in production unless a challenger demonstrates
        # a repeatable gain on validation data; the outer test set is never used
        # to select which model is reported as the winner.
        chosen_model = "linear_regression"
        comparison_rows: list[dict] = []
        if len(training_values) >= 12:
            selection_count = max(1, int(math.ceil(len(training_values) * 0.2)))
            selection_start = len(training_values) - selection_count
            selection_train_periods = training_periods[:selection_start]
            selection_train_values = training_values[:selection_start]
            selection_periods = training_periods[selection_start:]
            selection_values = training_values[selection_start:]
            if len(selection_train_values) >= 2 and len(selection_values) > 0:
                for candidate in model_candidates(selection_train_periods, selection_train_values):
                    if candidate["modelType"] == "holt_winters" and any(right - left != 1 for left, right in zip(periods, periods[1:])):
                        candidate["available"] = False
                        candidate["reason"] = "Requires 24 consecutive observed months across the full series; gaps are not filled with invented zeros."
                    row = {**candidate, "label": MODEL_LABELS[candidate["modelType"]], "trainingObservations": len(selection_train_values), "testObservations": len(selection_values), "selectionMetrics": None, "testTrainingObservations": len(training_values), "testObservationsFinal": len(test_values), "testMetrics": None}
                    if candidate["available"]:
                        try:
                            prediction = np.maximum(0, predict_with_model(candidate["modelType"], selection_train_periods, selection_train_values, selection_periods, seed))
                            row["selectionMetrics"] = safe_metric(selection_values, prediction)
                            test_prediction_for_candidate = np.maximum(0, predict_with_model(candidate["modelType"], training_periods, training_values, test_periods, seed))
                            row["testMetrics"] = safe_metric(test_values, test_prediction_for_candidate)
                        except (ValueError, np.linalg.LinAlgError) as exc:
                            row["available"] = False
                            row["reason"] = str(exc)
                    comparison_rows.append(row)
        if not comparison_rows:
            comparison_rows = [
                {"modelType": "linear_regression", "label": MODEL_LABELS["linear_regression"], "available": True, "reason": "Baseline retained because there are too few pre-test observations for separate model selection.", "trainingObservations": len(training_values), "testObservations": 0, "selectionMetrics": None},
                {"modelType": "seasonal_linear_regression", "label": MODEL_LABELS["seasonal_linear_regression"], "available": False, "reason": "Requires at least 24 training observations spanning two or more years.", "trainingObservations": len(training_values), "testObservations": 0, "selectionMetrics": None},
                {"modelType": "random_forest_regression", "label": MODEL_LABELS["random_forest_regression"], "available": False, "reason": "Requires at least 12 training observations for comparison.", "trainingObservations": len(training_values), "testObservations": 0, "selectionMetrics": None},
                {"modelType": "holt_winters", "label": MODEL_LABELS["holt_winters"], "available": False, "reason": "Requires at least 24 consecutive observed months; gaps are not filled with invented zeros.", "trainingObservations": len(training_values), "testObservations": 0, "selectionMetrics": None},
            ]
        try:
            test_prediction = np.maximum(0, predict_with_model(chosen_model, training_periods, training_values, test_periods, seed))
        except (ValueError, np.linalg.LinAlgError):
            chosen_model = "linear_regression"
            test_prediction = np.maximum(0, predict_with_model(chosen_model, training_periods, training_values, test_periods, seed))
        metrics = safe_metric(test_values, test_prediction)
        validation_actual.extend(test_values.tolist())
        validation_predictions.extend(test_prediction.tolist())
        for comparison in comparison_rows:
            if comparison["modelType"] == chosen_model and comparison.get("testMetrics") is None:
                comparison["testMetrics"] = metrics
                comparison["testTrainingObservations"] = len(training_values)
                comparison["testObservationsFinal"] = len(test_values)
            comparison["selected"] = comparison["modelType"] == chosen_model
        model_comparisons.append({"medicineId": medicine["id"], "medicineName": medicine["name"], "selectedModel": chosen_model, "candidates": comparison_rows})

        try:
            future = np.maximum(0, predict_with_model(chosen_model, periods, y, future_periods, seed))
        except (ValueError, np.linalg.LinAlgError):
            chosen_model = "linear_regression"
            future = np.maximum(0, predict_with_model(chosen_model, periods, y, future_periods, seed))
            for comparison in comparison_rows:
                comparison["selected"] = comparison["modelType"] == chosen_model
            model_comparisons[-1]["selectedModel"] = chosen_model
        future = np.round(future, 2)
        for period_ordinal, quantity in zip(future_periods, future):
            period = month_start(period_ordinal)
            period_text = period.strftime("%Y-%m-%d")
            result_rows.append({"medicine_id": medicine["database_medicine_id"], "medicine_name": medicine["name"], "forecast_period": period_text, "predicted_quantity": float(quantity)})
            item_chart.append({"period": period.strftime("%Y-%m"), "actual": None, "forecast": float(quantity)})
        forecastable += 1
        demand = float(np.sum(future))
        in_inventory = medicine["in_inventory"]
        stock = int(medicine.get("stock_quantity", 0)) if in_inventory else None
        add = max(0, int(math.ceil(demand - stock))) if stock is not None else None
        recommendation = ("Consider restocking" if add else "Stock level appears sufficient") if in_inventory else "Consider adding to inventory"
        per_medicine.append({"medicineId": medicine["id"], "medicineName": medicine["name"], "status": "forecasted", "modelType": chosen_model, "modelLabel": MODEL_LABELS[chosen_model], "observationCount": observed_month_count, "modelObservationCount": len(periods), "trainingObservationCount": len(training_values), "testObservationCount": len(test_values), "lastObservedPeriod": month_start(periods[-1]).strftime("%Y-%m"), "monthsSinceLastObservedSales": months_since_last_sale, "inInventory": in_inventory, "currentStock": stock, "forecastDemand": round(demand, 2), "expectedStockRequirement": int(math.ceil(demand)), "suggestedAdditionalStock": add, "recommendation": recommendation, "metrics": metrics})
        chart[str(medicine["id"])] = item_chart

    if forecastable == 0:
        insufficient_summary = "; ".join(
            f"{medicine['medicineName']}: {medicine.get('observationCount', 0)} distinct months"
            for medicine in per_medicine
        )
        raise ValueError(
            "No medicine has at least 4 distinct months with recorded sales. "
            "Add more actual history before forecasting. Current observations: "
            + insufficient_summary
        )
    actual_array = np.asarray(validation_actual, dtype=float)
    prediction_array = np.asarray(validation_predictions, dtype=float)
    metrics = safe_metric(actual_array, prediction_array)
    overall_forecast: dict[int, float] = defaultdict(float)
    for row in result_rows:
        forecast_date = parse_date(row["forecast_period"])
        if forecast_date is not None:
            overall_forecast[month_ordinal(forecast_date)] += float(row["predicted_quantity"])
    chart_overall = [
        {
            "period": month_start(period).strftime("%Y-%m"),
            "actual": round(float(overall_actual[period]), 4) if period in overall_actual else None,
            # This is a shared visual endpoint only. The forecast results and
            # forecast horizon still begin in the following calendar month.
            "forecast": round(float(overall_actual[period]), 4) if period == max(all_periods) else None,
        }
        for period in range(min(all_periods), max(all_periods) + 1)
    ]
    chart_overall.extend(
        {"period": month_start(period).strftime("%Y-%m"), "actual": None, "forecast": round(overall_forecast.get(period, 0.0), 2)}
        for period in future_periods
    )
    return {
        "historicalStartDate": global_start.strftime("%Y-%m-%d"),
        "historicalEndDate": global_end.strftime("%Y-%m-%d"),
        "forecastHorizon": horizon,
        "forecastVersion": "aligned_calendar_v3",
        "periodGranularity": "monthly",
        "forecastedMedicineCount": forecastable,
        "medicineCount": len(medicines),
        "modelType": "linear_regression",
        "metrics": metrics,
        "trainingObservationCount": sum(medicine.get("trainingObservationCount", 0) for medicine in per_medicine),
        "testObservationCount": sum(medicine.get("testObservationCount", 0) for medicine in per_medicine),
        "evaluationMethod": "nested_chronological_holdout",
        "evaluationDetails": "Challenger comparisons use a chronological validation slice from each medicine's pre-test history. Linear Regression remains selected unless a challenger shows a repeatable validation gain. Reported MAE, MAPE, and RMSE use a separate trailing 20% chronological holdout (rounded up, at least one observed month) after fitting on all earlier observations. Counts are pooled across forecasted medicines. Missing calendar months are not fabricated as zero-sales observations; all medicines share a forecast horizon immediately after the latest actual month.",
        "medicines": per_medicine,
        "modelComparisons": model_comparisons,
        "results": result_rows,
        "chart": chart,
        "chartOverall": chart_overall,
    }


def main() -> None:
    try:
        payload = json.load(sys.stdin)
        action = payload.get("action")
        if action == "preview":
            output = parse_excel(payload.get("excelBase64", ""))
        elif action == "forecast":
            output = forecast(payload)
        else:
            raise ValueError("Unknown forecasting action.")
        print(json.dumps({"ok": True, "data": output}, allow_nan=False))
    except Exception as exc:  # Return a structured, user-readable validation/error response.
        print(json.dumps({"ok": False, "error": str(exc)}))


if __name__ == "__main__":
    main()
