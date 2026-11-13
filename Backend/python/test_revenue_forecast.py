import base64
import io
import unittest
from unittest.mock import patch

import numpy as np
from openpyxl import Workbook

import revenue_forecast as revenue


def workbook_base64(headers, rows):
    output = io.BytesIO()
    book = Workbook()
    sheet = book.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    book.save(output)
    return base64.b64encode(output.getvalue()).decode("ascii")


class RevenueForecastTests(unittest.TestCase):
    def test_import_preserves_source_rows_and_normalizes_valid_transactions(self):
        source = workbook_base64(
            ["Date", "Sales Amount", "Invoice", "Customer", "Product"],
            [
                ["2026-03-10", "1,200.50", "INV-3", "Clinic", "Product C"],
                ["2026-01-02", 500, "INV-1", "Clinic", "Product A"],
                ["2026-01-02", 500, "INV-1", "Clinic", "Product A"],
                ["not-a-date", -4, "INV-X", "Clinic", "Bad row"],
            ],
        )
        result = revenue.preview_excel(source)
        self.assertEqual(result["rawRowCount"], 4)
        self.assertEqual(result["validRows"], 2)
        self.assertEqual(result["invalidRows"], 1)
        self.assertEqual(result["duplicateRows"], 1)
        self.assertEqual(result["historicalStartDate"], "2026-01-02")
        self.assertEqual(result["historicalEndDate"], "2026-03-10")
        self.assertEqual(result["sourceRecords"][0]["values"][1], "1,200.50")
        self.assertEqual(result["records"][0]["salesAmount"], 1200.5)

    def test_monthly_aggregation_does_not_create_missing_zero_months(self):
        months, totals = revenue.aggregate_monthly([
            {"date": "2026-01-05", "salesAmount": 10},
            {"date": "2026-01-23", "salesAmount": 15},
            {"date": "2026-03-01", "salesAmount": 7},
        ])
        self.assertEqual(months, ["2026-01", "2026-03"])
        self.assertEqual(totals, [25.0, 7.0])

    def test_metrics_report_zero_actuals_separately(self):
        result = revenue.regression_metrics([0, 10], [4, 8])
        self.assertEqual(result["mae"], 3.0)
        self.assertEqual(result["mape"], 20.0)
        self.assertEqual(result["rmse"], 3.16)
        self.assertEqual(result["zeroActualObservations"], 1)
        self.assertEqual(result["mapeSamples"], 1)

    def test_seasonal_feature_uses_calendar_month_not_tail_start(self):
        values = [float(index) for index in range(12)]
        january = revenue.feature_row(3, values, 2026 * 12)
        february = revenue.feature_row(3, values, 2026 * 12 + 1)
        self.assertAlmostEqual(january[1], 0.0, places=10)
        self.assertAlmostEqual(february[1], np.sin(2 * np.pi / 12), places=10)

    def test_missing_months_are_not_filled_and_only_the_consecutive_tail_trains(self):
        records = []
        for index in range(12):
            if index == 7:
                continue
            ordinal = revenue.month_number("2025-01") + index
            records.append({"date": revenue.month_label(ordinal) + "-01", "salesAmount": 100 + index})
        class TestRegressor:
            def fit(self, _x, y):
                self.mean_ = float(np.mean(y))
                return self

            def predict(self, x):
                return np.full(len(x), self.mean_)

        with patch.object(revenue, "make_model", return_value=TestRegressor()):
            result = revenue.forecast(records, 3)
        self.assertEqual(result["historicalStartDate"], "2025-09-01")
        self.assertEqual(result["historicalEndDate"], "2025-12-01")
        self.assertEqual(result["trainingObservationCount"], 1)
        self.assertEqual(result["testObservationCount"], 0)
        self.assertIsNone(result["metrics"]["mae"])
        self.assertIsNone(result["metrics"]["mape"])
        self.assertIsNone(result["metrics"]["rmse"])
        self.assertEqual(len(result["forecastMonthlyRevenue"]), 3)
        self.assertTrue(result["dataLimitationWarning"])

    def test_four_consecutive_months_train_without_fabricating_a_test_fold(self):
        class TestRegressor:
            def fit(self, _x, y):
                self.mean_ = float(np.mean(y))
                return self

            def predict(self, x):
                return np.full(len(x), self.mean_)

        start = revenue.month_number("2026-01")
        records = [
            {"date": revenue.month_label(start + index) + "-01", "salesAmount": 1000 + 50 * index}
            for index in range(4)
        ]
        with patch.object(revenue, "make_model", return_value=TestRegressor()):
            result = revenue.forecast(records, 3)
        self.assertEqual(result["minimumRequiredMonths"], 4)
        self.assertEqual(result["trainingObservationCount"], 1)
        self.assertEqual(result["testObservationCount"], 0)
        self.assertTrue(all(item["forecastRevenue"] >= 0 for item in result["forecastMonthlyRevenue"]))
        self.assertTrue(all(model["metrics"]["mae"] is None for model in result["modelComparisons"]))

    def test_walk_forward_evaluates_all_models_on_same_three_month_period(self):
        class TestRegressor:
            def fit(self, _x, y):
                self.mean_ = float(np.mean(y))
                return self

            def predict(self, x):
                return np.full(len(x), self.mean_)

        original_make_model = revenue.make_model

        def test_model(name):
            if name in {"xgboost", "random_forest"}:
                return TestRegressor()
            return original_make_model(name)

        records = []
        start = revenue.month_number("2023-01")
        for index in range(18):
            records.append({"date": revenue.month_label(start + index) + "-01", "salesAmount": 1000 + index * 10})
        with patch.object(revenue, "make_model", side_effect=test_model):
            result = revenue.forecast(records, 3)
        self.assertEqual(result["modelType"], "xgboost")
        self.assertEqual(result["evaluationMethod"], "chronological_walk_forward")
        self.assertEqual(result["metrics"]["testObservations"], 12)
        self.assertEqual({row["metrics"]["testObservations"] for row in result["modelComparisons"]}, {12})
        self.assertEqual({(row["evaluationPeriodStart"], row["evaluationPeriodEnd"]) for row in result["modelComparisons"]}, {(result["evaluationPeriodStart"], result["evaluationPeriodEnd"])})
        self.assertEqual(len(result["forecastMonthlyRevenue"]), 3)


if __name__ == "__main__":
    unittest.main()
