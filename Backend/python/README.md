# Forecast service

The PHP API starts `forecast.py` for workbook validation and monthly Linear Regression. Install its dependencies in the backend-local virtual environment:

```powershell
python -m venv Backend/.venv
Backend/.venv/Scripts/python.exe -m pip install -r Backend/python/requirements.txt
```

PHP uses `Backend/.venv/Scripts/python.exe` automatically on Windows. Set the server-side `ONCOPHIL_PYTHON` environment variable when the virtual environment is elsewhere. The uploaded, validated historical workbook rows and non-schema forecast metadata are stored under `Backend/runtime/`, outside the PHP document root and ignored by Git. Back up that directory if these local imports and evaluation metrics must survive moving the backend host.

System sales include delivered orders only. The forecast uses monthly quantity totals by medicine, requires at least four monthly observations per medicine, holds out the most recent 20% (at least one month) for MAE/RMSE/MAPE, and refits on all observations before predicting. Restock need equals the forecast-horizon total rounded up minus current stock, floored at zero; no safety stock is assumed.

Run the forecast unit checks from `Backend/python` with `..\.venv\Scripts\python.exe -m unittest -v`.
