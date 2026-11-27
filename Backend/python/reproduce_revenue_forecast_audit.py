"""Reproduce a sanitized dataset and revenue-forecast audit from a cleaned workbook."""

from __future__ import annotations

import argparse
import base64
from collections import defaultdict
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import revenue_forecast
from sales_report import preview_cleaned_workbook


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path, help="Path to the cleaned historical sales workbook")
    parser.add_argument("--horizon", type=int, default=3, choices=[1, 3, 6, 12])
    parser.add_argument("--output", type=Path, help="Optional path for sanitized JSON output")
    args = parser.parse_args()

    workbook_bytes = args.workbook.read_bytes()
    parsed = preview_cleaned_workbook(base64.b64encode(workbook_bytes).decode("ascii"))
    if not parsed.get("valid"):
        raise SystemExit("Workbook validation failed; no forecast was run.")

    actual_months = [row for row in parsed["monthlyRevenue"] if row["revenue"] is not None]
    if not actual_months:
        raise SystemExit("Workbook contains no observed monthly revenue values.")
    totals = [float(row["revenue"]) for row in actual_months]
    transaction_total = round(sum(float(row["salesAmount"]) for row in parsed["transactions"]), 2)
    monthly_sheet_total = round(sum(totals), 2)
    forecast = revenue_forecast.forecast(parsed["forecastRecords"], args.horizon, detailed_diagnostics=True)
    horizon_runs = {
        h: forecast if h == args.horizon else revenue_forecast.forecast(parsed["forecastRecords"], args.horizon, evaluation_horizon=h)
        for h in (1, 2, 3)
    }
    cli = subprocess.run(
        [sys.executable, str(HERE / "forecast.py")],
        input=json.dumps({"action": "revenue_forecast", "records": parsed["forecastRecords"], "systemRevenue": [], "horizon": args.horizon}),
        text=True,
        capture_output=True,
        check=False,
    )
    if cli.returncode != 0:
        raise SystemExit(f"forecast.py exited with status {cli.returncode}.")
    try:
        cli_wrapper = json.loads(cli.stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit("forecast.py did not return valid JSON.") from exc
    if not cli_wrapper.get("ok") or not isinstance(cli_wrapper.get("data"), dict):
        raise SystemExit("forecast.py returned an unsuccessful response.")
    cli_result = cli_wrapper["data"]
    if cli_result.get("forecastMonthlyRevenue") != forecast.get("forecastMonthlyRevenue"):
        raise SystemExit("forecast.py CLI output does not match the direct forecast result.")
    jan_to_apr = [float(row["revenue"]) for row in actual_months if row["month"] in {"2026-01", "2026-02", "2026-03", "2026-04"}]
    legacy_x = [revenue_forecast.feature_row(3, jan_to_apr, revenue_forecast.month_number("2026-04"))]
    legacy_model = revenue_forecast.make_model("xgboost")
    legacy_model.fit(revenue_forecast.np.asarray(legacy_x, dtype=float), revenue_forecast.np.asarray([708755.0], dtype=float))
    legacy_prediction = float(legacy_model.predict(revenue_forecast.np.asarray([legacy_x[0]], dtype=float))[0])
    legacy_fit = revenue_forecast.fitted_model_details("xgboost", legacy_model, "2026-05", 1, [{
        "targetPeriod": "2026-04",
        "inputPeriods": ["2026-01", "2026-02", "2026-03"],
        "features": {name: float(value) for name, value in zip(revenue_forecast.FEATURE_NAMES, legacy_x[0])},
        "targetRevenue": 708755.0,
    }], detailed_diagnostics=True)
    legacy_recursive = {name: [] for name in ("xgboost", "random_forest", "naive")}
    recursive_context = list(jan_to_apr)
    jan_ordinal = revenue_forecast.month_number("2026-01")
    for step in range(3):
        target_index = len(recursive_context)
        next_x = revenue_forecast.np.asarray([revenue_forecast.feature_row(target_index, recursive_context, jan_ordinal + target_index)], dtype=float)
        x = revenue_forecast.np.asarray([
            revenue_forecast.feature_row(index, recursive_context, jan_ordinal + index)
            for index in range(3, len(recursive_context))
        ], dtype=float)
        y = revenue_forecast.np.asarray(recursive_context[3:], dtype=float)
        period = revenue_forecast.month_label(jan_ordinal + target_index)
        xgb_model = revenue_forecast.make_model("xgboost")
        xgb_model.fit(x, y)
        xgb_prediction = float(xgb_model.predict(next_x)[0])
        legacy_recursive["xgboost"].append({
            "period": period,
            "trainingRowCount": len(y),
            "trainingTargets": [float(value) for value in y],
            "prediction": round(xgb_prediction, 2),
            "fit": revenue_forecast.fitted_model_details("xgboost", xgb_model, period, len(y), detailed_diagnostics=True),
        })
        rf_prediction = revenue_forecast.random_forest_predict(x, y, next_x)
        legacy_recursive["random_forest"].append({"period": period, "trainingRowCount": len(y), "trainingTargets": [float(value) for value in y], "treeCount": 100, "prediction": round(rf_prediction, 2), "fallbackUsed": False})
        naive_prediction = recursive_context[-1]
        legacy_recursive["naive"].append({"period": period, "trainingRowCount": 0, "prediction": round(naive_prediction, 2), "fallbackUsed": False})
        recursive_context.append(max(0.0, xgb_prediction))
    observed_labels = {row["month"] for row in actual_months}
    interior_span = range(revenue_forecast.month_number(actual_months[0]["month"]), revenue_forecast.month_number(actual_months[-1]["month"]) + 1)
    interior_missing = [revenue_forecast.month_label(value) for value in interior_span if revenue_forecast.month_label(value) not in observed_labels]

    def model_map(rows: list[dict], include_predictions: bool = True) -> dict:
        result = {}
        for row in rows:
            result[row["modelType"]] = {
                "metrics": row["metrics"],
                "predictions": row.get("evaluationPredictions", []) if include_predictions else [],
                "execution": row.get("evaluationExecution", {}),
            }
        return result

    may_to_july = {
        key: {
            "predictions": [row for row in value["predictions"] if row["period"] in {"2026-05", "2026-06", "2026-07"}],
            "metrics": revenue_forecast.regression_metrics(
                [row["actualRevenue"] for row in value["predictions"] if row["period"] in {"2026-05", "2026-06", "2026-07"}],
                [row["predictedRevenue"] for row in value["predictions"] if row["period"] in {"2026-05", "2026-06", "2026-07"}],
            ),
        }
        for key, value in model_map(forecast["oneStepEvaluation"]["models"]).items()
    }
    clean_rows = [row["values"] for row in parsed["sourceRecords"] if row.get("sheet") == "Clean Sales Records" and int(row.get("row", 0)) > 1]
    repeat_audit = {}
    for reference_index, label in ((6, "PO"), (7, "SI"), (8, "DR")):
        groups: dict[str, list[list[object]]] = defaultdict(list)
        for row in clean_rows:
            if len(row) > 19 and str(row[19] or "").strip().lower() == "included":
                reference = str(row[reference_index] or "").strip()
                if reference:
                    groups[reference].append(row)
        repeated = [rows for rows in groups.values() if len(rows) > 1]
        repeat_audit[label] = {
            "repeatedReferenceGroups": len(repeated),
            "rowsInRepeatedGroups": sum(len(rows) for rows in repeated),
            "groupsWithSameAmountOnEveryRow": sum(len({str(row[11]) for row in rows}) == 1 for rows in repeated),
            "groupsWithMultipleAmounts": sum(len({str(row[11]) for row in rows}) > 1 for rows in repeated),
        }
    output = {
        "dataset": {
            "inputFile": args.workbook.name,
            "sha256": hashlib.sha256(workbook_bytes).hexdigest(),
            "worksheets": parsed["sourceSheets"],
            "cleanSalesRows": parsed["rawRowCount"],
            "includedTransactions": parsed["validRows"],
            "excludedPossibleDuplicates": parsed["excludedDuplicateRows"],
            "excludedReviewRows": parsed["reviewRows"],
            "invalidRows": parsed["invalidRows"],
            "unresolvedReviewRows": len(parsed["unresolvedReviewRows"]),
            "referenceDocumentRowsNotImported": parsed["referenceDocumentRows"],
            "excludedCancellationRows": parsed["excludedCancellationRows"],
            "statusCounts": parsed["statusCounts"],
            "includedReferenceRepeatAudit": repeat_audit,
            "observedMonths": len(actual_months),
            "observedPeriodStart": actual_months[0]["month"],
            "observedPeriodEnd": actual_months[-1]["month"],
            "transactionRevenueTotal": transaction_total,
            "monthlyRevenueTotal": monthly_sheet_total,
            "reconciliationErrors": parsed["reconciliationErrors"],
            "monthlyRevenue": actual_months,
            "interiorUnreportedMonths": interior_missing,
            "otherUnreportedScheduleMonths": [row["month"] for row in parsed["monthlyRevenue"] if row["revenue"] is None and row["month"] not in interior_missing],
        },
        "forecast": {
            "pythonCliSmoke": {
                "command": "Backend\\.venv\\Scripts\\python.exe Backend\\python\\forecast.py (JSON stdin: revenue_forecast, horizon=3)",
                "exitCode": cli.returncode,
                "ok": cli_wrapper.get("ok") is True,
                "forecastVersion": cli_result.get("forecastVersion"),
                "futureForecast": cli_result.get("forecastMonthlyRevenue"),
            },
            "legacyOneRowXgboostDiagnostic": {
                "procedure": "Reproduction of the prior April-origin fit: contiguous-tail-only data and the single available lag target.",
                "predictionForMay": round(legacy_prediction, 2),
                **legacy_fit,
            },
            "legacyRecursiveReproduction": legacy_recursive,
            "version": forecast["forecastVersion"],
            "horizon": forecast["forecastHorizon"],
            "xgboostConfig": forecast["modelConfig"],
            "runtimeVersions": forecast["runtimeVersions"],
            "featureNames": revenue_forecast.FEATURE_NAMES,
            "validLagTrainingRows": forecast["trainingObservationCount"],
            "dataLimitationWarning": forecast["dataLimitationWarning"],
            "oneStepEvaluation": {
                "strategy": forecast["oneStepEvaluation"]["strategy"],
                "periodStart": forecast["oneStepEvaluation"]["evaluationPeriodStart"],
                "periodEnd": forecast["oneStepEvaluation"]["evaluationPeriodEnd"],
                "models": model_map(forecast["oneStepEvaluation"]["models"]),
            },
            "oneStepMayToJuly": may_to_july,
            "fixedOrigin": {
                "strategy": forecast["evaluationMethod"],
                "periodStart": forecast["evaluationPeriodStart"],
                "periodEnd": forecast["evaluationPeriodEnd"],
                "models": model_map(forecast["modelComparisons"]),
            },
            "horizonEvaluationCoverage": {
                str(h): {
                    "evaluationMethod": result["evaluationMethod"],
                    "models": {
                        row["modelType"]: {
                            "metrics": row["metrics"],
                            "foldCount": row["evaluationExecution"]["evaluationFolds"],
                            "testPeriods": [prediction["period"] for prediction in row["evaluationPredictions"]],
                        }
                        for row in result["modelComparisons"]
                    },
                }
                for h, result in horizon_runs.items()
            },
            "futureForecast": forecast["forecastMonthlyRevenue"],
        },
    }
    rendered = json.dumps(output, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
