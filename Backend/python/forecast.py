#!/usr/bin/env python3
"""Excel validation and monthly Linear Regression forecasting for Oncophil."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import math
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
    return normalized_header(value)


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
    design = np.column_stack((x_values, np.ones_like(x_values)))
    coefficients, _, _, _ = np.linalg.lstsq(design, y_values, rcond=None)
    target = np.asarray(predict_x, dtype=float).reshape(-1)
    return target * coefficients[0] + coefficients[1]


def forecast(payload: dict) -> dict:
    horizon = int(payload.get("horizon", 3))
    if horizon < 1 or horizon > 12:
        raise ValueError("Forecast horizon must be between 1 and 12 months.")

    medicines = list(payload.get("medicines", []))
    sales = list(payload.get("systemSales", []))
    excel_sales = list(payload.get("excelSales", []))
    medicine_by_name = {product_key(m.get("name", "")): m for m in medicines if product_key(m.get("name", ""))}
    historical_by_id: dict[str, dict] = {}
    for row in excel_sales:
        historical_name = str(row.get("medicine", "")).strip()
        normalized_name = product_key(historical_name)
        if not normalized_name:
            raise ValueError("A historical sales row has no medicine name.")
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
    forecastable = 0
    for medicine in medicines:
        medicine_id = str(medicine["id"])
        med = {period: quantity for (group_medicine_id, period), quantity in grouped.items() if group_medicine_id == medicine_id}
        if not med:
            per_medicine.append({"medicineId": medicine["id"], "medicineName": medicine["name"], "status": "insufficient", "reason": "No sales recorded in the supplied history.", "inInventory": medicine["in_inventory"], "currentStock": int(medicine.get("stock_quantity", 0)) if medicine["in_inventory"] else None, "forecastDemand": None, "suggestedAdditionalStock": None, "recommendation": "Insufficient sales data", "metrics": None})
            chart[str(medicine["id"])] = []
            continue
        periods = list(range(min(med), max(med) + 1))
        series = np.asarray([med.get(period, 0.0) for period in periods], dtype=float)
        actual_points = [{"period": month_start(period).strftime("%Y-%m"), "actual": round(float(value), 4), "forecast": None} for period, value in zip(periods, series)]
        item_chart = actual_points.copy()
        if len(periods) < 4:
            per_medicine.append({"medicineId": medicine["id"], "medicineName": medicine["name"], "status": "insufficient", "reason": f"At least 4 monthly observations are required; found {len(periods)}.", "inInventory": medicine["in_inventory"], "currentStock": int(medicine.get("stock_quantity", 0)) if medicine["in_inventory"] else None, "forecastDemand": None, "suggestedAdditionalStock": None, "recommendation": "Insufficient sales data", "metrics": None})
            chart[str(medicine["id"])] = item_chart
            continue

        y = series
        x = np.arange(len(y), dtype=float)
        holdout = max(1, int(math.ceil(len(y) * 0.2)))
        train_end = len(y) - holdout
        validation_pred = np.maximum(0, linear_regression_predict(x[:train_end], y[:train_end], x[train_end:]))
        metrics = safe_metric(y[train_end:], validation_pred)
        validation_actual.extend(y[train_end:].tolist())
        validation_predictions.extend(validation_pred.tolist())

        future_x = np.arange(len(y), len(y) + horizon, dtype=float)
        future = np.maximum(0, linear_regression_predict(x, y, future_x))
        future = np.round(future, 2)
        for offset, quantity in enumerate(future, start=1):
            period = month_start(periods[-1] + offset)
            period_text = period.strftime("%Y-%m-%d")
            result_rows.append({"medicine_id": medicine["database_medicine_id"], "medicine_name": medicine["name"], "forecast_period": period_text, "predicted_quantity": float(quantity)})
            item_chart.append({"period": period.strftime("%Y-%m"), "actual": None, "forecast": float(quantity)})
        forecastable += 1
        demand = float(np.sum(future))
        in_inventory = medicine["in_inventory"]
        stock = int(medicine.get("stock_quantity", 0)) if in_inventory else None
        add = max(0, int(math.ceil(demand - stock))) if stock is not None else None
        recommendation = ("Consider restocking" if add else "Stock level appears sufficient") if in_inventory else "Consider adding to inventory"
        per_medicine.append({"medicineId": medicine["id"], "medicineName": medicine["name"], "status": "forecasted", "inInventory": in_inventory, "currentStock": stock, "forecastDemand": round(demand, 2), "expectedStockRequirement": int(math.ceil(demand)), "suggestedAdditionalStock": add, "recommendation": recommendation, "metrics": metrics})
        chart[str(medicine["id"])] = item_chart

    if forecastable == 0:
        raise ValueError("No medicine has at least 4 monthly observations. Add more actual history before forecasting.")
    actual_array = np.asarray(validation_actual, dtype=float)
    prediction_array = np.asarray(validation_predictions, dtype=float)
    metrics = safe_metric(actual_array, prediction_array)
    overall_forecast: dict[int, float] = defaultdict(float)
    for row in result_rows:
        forecast_date = parse_date(row["forecast_period"])
        if forecast_date is not None:
            overall_forecast[month_ordinal(forecast_date)] += float(row["predicted_quantity"])
    chart_overall = [
        {"period": month_start(period).strftime("%Y-%m"), "actual": round(float(quantity), 4), "forecast": None}
        for period, quantity in sorted(overall_actual.items())
    ]
    chart_overall.extend(
        {"period": month_start(period).strftime("%Y-%m"), "actual": None, "forecast": round(quantity, 2)}
        for period, quantity in sorted(overall_forecast.items())
    )
    return {
        "historicalStartDate": global_start.strftime("%Y-%m-%d"),
        "historicalEndDate": global_end.strftime("%Y-%m-%d"),
        "forecastHorizon": horizon,
        "periodGranularity": "monthly",
        "forecastedMedicineCount": forecastable,
        "medicineCount": len(medicines),
        "metrics": metrics,
        "medicines": per_medicine,
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
