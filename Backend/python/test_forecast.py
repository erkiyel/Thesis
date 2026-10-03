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


if __name__ == "__main__":
    unittest.main()
