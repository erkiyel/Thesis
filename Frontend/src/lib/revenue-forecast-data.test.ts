import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRevenueRun, parseRevenueImportsResponse, parseRevenueRunsResponse } from './revenue-forecast-data.ts';

test('an absent runs envelope is reported as a malformed API response', () => {
  assert.throws(
    () => parseRevenueRunsResponse({}),
    /Forecasts API returned an invalid response: expected an array in "runs"/,
  );
});

test('empty forecast and import arrays are valid empty states', () => {
  assert.deepEqual(parseRevenueRunsResponse({ runs: [] }), []);
  assert.deepEqual(parseRevenueImportsResponse({ imports: [] }), []);
});

test('legacy revenue records without newer optional fields remain renderable', () => {
  const run = normalizeRevenueRun({
    id: 'legacy-run',
    predictionTarget: 'monthly_sales_revenue_php',
    modelType: 'linear_regression',
    metrics: null,
  }, 0);

  assert.equal(run.modelLabel, 'linear regression');
  assert.equal(run.historicalStartDate, null);
  assert.deepEqual(run.modelConfig, {});
  assert.deepEqual(run.modelComparisons, []);
  assert.deepEqual(run.actualMonthlyRevenue, []);
  assert.deepEqual(run.forecastMonthlyRevenue, []);
  assert.deepEqual(run.missingMonths, []);
  assert.deepEqual(run.metrics, {
    mae: null, mape: null, rmse: null,
    testObservations: 0, mapeSamples: 0, zeroActualObservations: 0,
  });
});

test('malformed optional arrays produce a controlled validation error', () => {
  assert.throws(
    () => normalizeRevenueRun({ id: 'bad-run', modelComparisons: {} }, 0),
    /forecasts\.runs\[0\]\.modelComparisons must be an array/,
  );
});

test('incomplete monthly data is rejected instead of inventing zero revenue', () => {
  assert.throws(
    () => normalizeRevenueRun({ id: 'bad-month', actualMonthlyRevenue: [{ period: '2026-05' }] }, 0),
    /actualMonthlyRevenue\[0\] must contain a valid period and actual revenue/,
  );
});

test('malformed import envelopes do not become silent empty states', () => {
  assert.throws(
    () => parseRevenueImportsResponse({ imports: null }),
    /Forecast imports API returned an invalid response: expected an array in "imports"/,
  );
});
