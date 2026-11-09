import base64
import io
import unittest

import numpy as np
from openpyxl import Workbook

import forecast


def workbook_bytes(headers, rows):
    output = io.BytesIO()
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    workbook.save(output)
    return base64.b64encode(output.getvalue()).decode("ascii")


class ForecastTests(unittest.TestCase):
    def test_excel_preview_normalizes_required_columns_and_rejects_bad_rows(self):
        encoded = workbook_bytes(
            ["Sale Date", "Product Name", "Qty Sold", "Sales Amount"],
            [["2024-01-02", "Example", 3, 90], ["not-a-date", "Example", "bad", 30]],
        )
        result = forecast.parse_excel(encoded)
        self.assertEqual(result["validRows"], 1)
        self.assertEqual(result["invalidRows"], 1)
        self.assertEqual(result["preview"][0]["quantity"], 3.0)
        self.assertEqual(result["preview"][0]["salesAmount"], 90.0)
        self.assertEqual(result["errors"][0]["row"], 3)

    def test_forecast_returns_holdout_metrics_future_points_and_stock_need(self):
        sales = [
            {"medicineId": "m1", "medicine": "Example", "date": f"2024-{month:02d}-15", "quantity": month}
            for month in range(1, 7)
        ]
        result = forecast.forecast({
            "horizon": 2,
            "medicines": [{"id": "m1", "name": "Example", "stock_quantity": 1}],
            "systemSales": sales,
            "excelSales": [],
        })
        self.assertEqual(result["forecastedMedicineCount"], 1)
        self.assertEqual(result["periodGranularity"], "monthly")
        self.assertEqual(len(result["results"]), 2)
        self.assertIsNotNone(result["metrics"]["mae"])
        self.assertIsNotNone(result["metrics"]["rmse"])
        self.assertEqual(result["medicines"][0]["recommendation"], "Consider restocking")
        self.assertEqual(result["medicines"][0]["suggestedAdditionalStock"], result["medicines"][0]["expectedStockRequirement"] - 1)
        self.assertEqual(result["forecastVersion"], "aligned_calendar_v3")
        historical_last = next(point for point in reversed(result["chartOverall"]) if point["actual"] is not None)
        self.assertEqual(historical_last["period"], "2024-06")
        self.assertEqual(historical_last["forecast"], historical_last["actual"])
        self.assertEqual(len({point["period"] for point in result["chartOverall"]}), len(result["chartOverall"]))
        self.assertIsNone(result["chartOverall"][-1]["actual"])

    def test_historical_only_medicine_is_forecast_without_inventory_record(self):
        result = forecast.forecast({
            "horizon": 3,
            "medicines": [],
            "systemSales": [],
            "excelSales": [
                {"date": f"2026-{month:02d}-10", "medicine": "  Amoxicillin 500mg ", "quantity": 4 + month}
                for month in range(1, 6)
            ],
        })
        medicine = result["medicines"][0]
        self.assertEqual(result["forecastedMedicineCount"], 1)
        self.assertEqual(len(result["results"]), 3)
        self.assertIsNone(result["results"][0]["medicine_id"])
        self.assertEqual(result["results"][0]["medicine_name"], "Amoxicillin 500mg")
        self.assertFalse(medicine["inInventory"])
        self.assertIsNone(medicine["currentStock"])
        self.assertEqual(medicine["recommendation"], "Consider adding to inventory")
        self.assertIn(medicine["medicineId"], result["chart"])

    def test_historical_name_normalization_associates_current_inventory_medicine(self):
        result = forecast.forecast({
            "horizon": 1,
            "medicines": [{"id": "m1", "name": "Paracetamol 500mg", "stock_quantity": 8}],
            "systemSales": [],
            "excelSales": [
                {"date": f"2026-{month:02d}-10", "medicine": "  PARACETAMOL   500MG ", "quantity": month}
                for month in range(1, 6)
            ],
        })
        self.assertEqual(result["forecastedMedicineCount"], 1)
        self.assertEqual(result["results"][0]["medicine_id"], "m1")
        self.assertEqual(result["results"][0]["medicine_name"], "Paracetamol 500mg")
        self.assertTrue(result["medicines"][0]["inInventory"])
        self.assertEqual(result["medicines"][0]["currentStock"], 8)

    def test_matching_ignores_case_spacing_and_punctuation(self):
        result = forecast.forecast({
            "horizon": 1,
            "medicines": [{"id": "m1", "name": "Paracetamol 500mg", "stock_quantity": 8}],
            "systemSales": [],
            "excelSales": [
                {"date": f"2026-{month:02d}-10", "medicine": " PARACETAMOL  500 mg ", "quantity": month}
                for month in range(1, 5)
            ],
        })
        self.assertEqual(result["forecastedMedicineCount"], 1)
        self.assertEqual(result["medicines"][0]["medicineId"], "m1")

    def test_distinct_month_minimum_and_monthly_quantity_aggregation(self):
        sales = [
            {"medicineId": "m1", "medicine": "Example", "date": "2024-01-05", "quantity": 2},
            {"medicineId": "m1", "medicine": "Example", "date": "2024-01-25", "quantity": 3},
            {"medicineId": "m1", "medicine": "Example", "date": "2024-02-12", "quantity": 4},
            {"medicineId": "m1", "medicine": "Example", "date": "2024-04-12", "quantity": 5},
            {"medicineId": "m1", "medicine": "Example", "date": "2024-05-12", "quantity": 6},
        ]
        result = forecast.forecast({
            "horizon": 1,
            "medicines": [{"id": "m1", "name": "Example", "stock_quantity": 10}],
            "systemSales": sales,
            "excelSales": [],
        })
        medicine = result["medicines"][0]
        self.assertEqual(medicine["observationCount"], 4)
        self.assertEqual(medicine["modelObservationCount"], 4)
        self.assertEqual(result["chart"]["m1"][0]["actual"], 5)
        self.assertEqual(result["chart"]["m1"][2]["period"], "2024-04")
        self.assertNotIn("2024-03", [point["period"] for point in result["chart"]["m1"]])
        self.assertEqual(result["evaluationMethod"], "nested_chronological_holdout")

    def test_gaps_do_not_inflate_distinct_month_observation_count(self):
        sales = [
            {"medicineId": "m1", "medicine": "Example", "date": f"2024-{month:02d}-15", "quantity": month}
            for month in (1, 3, 5)
        ]
        sales.extend(
            {"medicineId": "m2", "medicine": "Another", "date": f"2024-{month:02d}-15", "quantity": month}
            for month in (1, 2, 3, 4)
        )
        result = forecast.forecast({
            "horizon": 1,
            "medicines": [
                {"id": "m1", "name": "Example", "stock_quantity": 10},
                {"id": "m2", "name": "Another", "stock_quantity": 10},
            ],
            "systemSales": sales,
            "excelSales": [],
        })
        medicine = next(row for row in result["medicines"] if row["medicineId"] == "m1")
        self.assertEqual(medicine["status"], "insufficient")
        self.assertEqual(medicine["observationCount"], 3)
        self.assertEqual(medicine["modelObservationCount"], 3)
        self.assertIn("found 3", medicine["reason"])

    def test_error_lists_actual_distinct_month_counts_when_none_are_forecastable(self):
        with self.assertRaisesRegex(ValueError, "Example: 3 distinct months"):
            forecast.forecast({
                "horizon": 1,
                "medicines": [{"id": "m1", "name": "Example", "stock_quantity": 10}],
                "systemSales": [
                    {"medicineId": "m1", "medicine": "Example", "date": f"2024-{month:02d}-15", "quantity": month}
                    for month in (1, 3, 5)
                ],
                "excelSales": [],
            })

    def test_ambiguous_normalized_inventory_names_are_rejected_when_import_match_is_needed(self):
        with self.assertRaisesRegex(ValueError, "matches multiple current inventory names"):
            forecast.forecast({
                "horizon": 1,
                "medicines": [
                    {"id": "m1", "name": "Paracetamol 500mg", "stock_quantity": 10},
                    {"id": "m2", "name": "PARACETAMOL 500 mg", "stock_quantity": 10},
                ],
                "systemSales": [],
                "excelSales": [
                    {"date": f"2024-{month:02d}-15", "medicine": "Paracetamol 500 mg", "quantity": month}
                    for month in range(1, 5)
                ],
            })

    def test_five_historical_medicines_and_100_sales_rows_forecast_three_months(self):
        names = [
            "Amoxicillin 500mg", "Cetirizine 10mg", "Metformin 500mg",
            "Omeprazole 20mg", "Paracetamol 500mg",
        ]
        records = [
            {"date": f"2026-{month:02d}-{10 + sale:02d}", "medicine": name, "quantity": 3 + medicine_index + month + sale}
            for medicine_index, name in enumerate(names)
            for month in range(1, 6)
            for sale in range(4)
        ]
        result = forecast.forecast({"horizon": 3, "medicines": [], "systemSales": [], "excelSales": records})
        self.assertEqual(len(records), 100)
        self.assertEqual(result["historicalStartDate"], "2026-01-01")
        self.assertEqual(result["historicalEndDate"], "2026-05-01")
        self.assertEqual(result["forecastedMedicineCount"], 5)
        self.assertEqual(len(result["results"]), 15)
        self.assertEqual({item["medicine_name"] for item in result["results"]}, set(names))
        self.assertTrue(all(item["medicine_id"] is None for item in result["results"]))
        self.assertEqual({item["recommendation"] for item in result["medicines"]}, {"Consider adding to inventory"})

    def test_zero_sales_mape_is_unavailable_instead_of_dividing_by_zero(self):
        result = forecast.safe_metric(np.array([0.0, 0.0]), np.array([1.0, 2.0]))
        self.assertIsNone(result["mape"])
        self.assertEqual(result["mapeSamples"], 0)

    def test_metric_values_are_calculated_correctly_and_mape_skips_zero_actual(self):
        result = forecast.safe_metric(np.array([10.0, 20.0, 0.0]), np.array([8.0, 22.0, 5.0]))
        self.assertEqual(result["mae"], 3.0)
        self.assertEqual(result["rmse"], 3.3166)
        self.assertEqual(result["mape"], 15.0)
        self.assertEqual(result["mapeSamples"], 2)

    def test_all_medicines_forecast_after_global_latest_actual_and_overall_sum_matches(self):
        sales = []
        for medicine_id, medicine, months in (
            ("m1", "First", (1, 3, 5, 7)),
            ("m2", "Second", (1, 2, 6, 8)),
        ):
            sales.extend({
                "medicineId": medicine_id,
                "medicine": medicine,
                "date": f"2024-{month:02d}-10",
                "quantity": month * (1 if medicine_id == "m1" else 2),
            } for month in months)
        result = forecast.forecast({
            "horizon": 3,
            "medicines": [
                {"id": "m1", "name": "First", "stock_quantity": 20},
                {"id": "m2", "name": "Second", "stock_quantity": 20},
            ],
            "systemSales": sales,
            "excelSales": [],
        })
        expected_periods = ["2024-09-01", "2024-10-01", "2024-11-01"]
        self.assertEqual([row["forecast_period"] for row in result["results"][:3]], expected_periods)
        self.assertEqual({row["forecast_period"] for row in result["results"]}, set(expected_periods))
        self.assertEqual([point["period"] for point in result["chartOverall"][-3:]], [value[:7] for value in expected_periods])
        for point in result["chartOverall"][-3:]:
            expected_total = sum(row["predicted_quantity"] for row in result["results"] if row["forecast_period"].startswith(point["period"]))
            self.assertEqual(point["forecast"], round(expected_total, 2))
            self.assertIsNone(point["actual"])
        self.assertTrue(all(row["predicted_quantity"] >= 0 for row in result["results"]))
        self.assertEqual(result["modelType"], "linear_regression")

    def test_candidate_models_are_compared_chronologically_and_final_metrics_use_test_holdout(self):
        sales = []
        for month_ordinal in range(48):
            year = 2020 + month_ordinal // 12
            month = month_ordinal % 12 + 1
            seasonal = 8 * np.sin(2 * np.pi * month_ordinal / 12)
            quantity = max(1, round(70 + month_ordinal * 0.5 + seasonal))
            sales.append({
                "medicineId": "m1",
                "medicine": "Seasonal",
                "date": f"{year}-{month:02d}-15",
                "quantity": quantity,
            })
        result = forecast.forecast({
            "horizon": 3,
            "medicines": [{"id": "m1", "name": "Seasonal", "stock_quantity": 100}],
            "systemSales": sales,
            "excelSales": [],
        })
        medicine = result["medicines"][0]
        comparison = result["modelComparisons"][0]
        models = {candidate["modelType"]: candidate for candidate in comparison["candidates"]}
        self.assertEqual(medicine["modelType"], "linear_regression")
        self.assertEqual(comparison["selectedModel"], "linear_regression")
        self.assertEqual(result["evaluationMethod"], "nested_chronological_holdout")
        self.assertEqual(medicine["trainingObservationCount"] + medicine["testObservationCount"], 48)
        self.assertEqual(medicine["testObservationCount"], 10)
        for model in ("linear_regression", "seasonal_linear_regression", "random_forest_regression", "holt_winters"):
            self.assertTrue(models[model]["available"], model)
            self.assertIsNotNone(models[model]["selectionMetrics"], model)
            self.assertIsNotNone(models[model]["testMetrics"], model)
        self.assertEqual(models["linear_regression"]["testMetrics"], medicine["metrics"])

    def test_holt_winters_is_not_evaluated_for_unobserved_calendar_gaps(self):
        periods = [forecast.month_ordinal(forecast.parse_date(f"2020-{month:02d}-01")) for month in range(1, 13)]
        periods += [forecast.month_ordinal(forecast.parse_date(f"2022-{month:02d}-01")) for month in range(1, 13)]
        candidates = {row["modelType"]: row for row in forecast.model_candidates(periods, np.arange(24, dtype=float))}
        self.assertTrue(candidates["seasonal_linear_regression"]["available"])
        self.assertFalse(candidates["holt_winters"]["available"])


if __name__ == "__main__":
    unittest.main()
