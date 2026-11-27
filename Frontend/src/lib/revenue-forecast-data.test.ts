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

test('one-step evaluations are parsed separately from fixed-origin comparisons', () => {
  const run = normalizeRevenueRun({
    id: 'temporal-run',
    modelComparisons: [{
      modelType: 'xgboost', label: 'XGBoost', forecastHorizon: 3,
      metrics: { mae: 10, mape: 5, rmse: 12, testObservations: 3 },
      evaluationPredictions: [],
    }],
    oneStepEvaluation: {
      strategy: 'expanding_one_step_actual_observation_refit', horizon: 1,
      evaluationPeriodStart: '2026-05', evaluationPeriodEnd: '2026-07',
      models: [{
        modelType: 'xgboost', label: 'XGBoost', forecastHorizon: 1,
        metrics: { mae: 10, mape: 5, rmse: 12, testObservations: 3 },
        evaluationPredictions: [{ originPeriod: '2026-04', horizon: 1, period: '2026-05', actualRevenue: 100, predictedRevenue: 90, absoluteError: 10, absolutePercentageError: 10 }],
      }],
    },
  }, 0);

  assert.equal(run.modelComparisons[0].forecastHorizon, 3);
  assert.equal(run.oneStepEvaluation?.horizon, 1);
  assert.equal(run.oneStepEvaluation?.models[0].evaluationPredictions?.[0].period, '2026-05');
  assert.equal(run.oneStepEvaluation?.models[0].evaluationPredictions?.[0].originPeriod, '2026-04');
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
