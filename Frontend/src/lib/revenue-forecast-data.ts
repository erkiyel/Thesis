export type RevenueMetrics = {
  mae: number | null;
  mape: number | null;
  rmse: number | null;
  testObservations: number;
  mapeSamples: number;
  zeroActualObservations: number;
};

export type RevenueEvaluationPrediction = {
  originPeriod?: string;
  horizon?: number;
  period: string;
  actualRevenue: number;
  predictedRevenue: number;
  absoluteError: number;
  absolutePercentageError: number | null;
};

export type RevenueComparison = {
  modelType: string;
  label: string;
  selected: boolean;
  metrics: RevenueMetrics;
  evaluationPeriodStart: string | null;
  evaluationPeriodEnd: string | null;
  forecastHorizon: number;
  evaluationPredictions?: RevenueEvaluationPrediction[];
  evaluationExecution?: { strategy: string; evaluationFolds: number; trainingRowsByFoldAndStep: number[][]; fallbackUsed: boolean };
};

export type RevenueOneStepEvaluation = {
  strategy: string;
  horizon: 1;
  models: RevenueComparison[];
  evaluationPeriodStart: string | null;
  evaluationPeriodEnd: string | null;
};

export type RevenueRun = {
  id: string;
  createdAt?: string | null;
  predictionTarget: string;
  modelType: string;
  modelLabel: string;
  historicalStartDate: string | null;
  historicalEndDate: string | null;
  forecastHorizon: number;
  evaluationHorizon?: number;
  minimumRequiredMonths: number;
  modelConfig: Record<string, string | number>;
  trainingObservationCount: number;
  testObservationCount: number;
  evaluationMethod: string;
  evaluationPeriodStart: string | null;
  evaluationPeriodEnd: string | null;
  metrics: RevenueMetrics;
  evaluationAvailable?: boolean;
  oneStepEvaluation?: RevenueOneStepEvaluation;
  dataLimitationWarning?: string | null;
  historicalEvaluationRecomputed?: boolean;
  modelComparisons: RevenueComparison[];
  actualMonthlyRevenue: Array<{ period: string; actualRevenue: number }>;
  forecastMonthlyRevenue: Array<{ period: string; forecastRevenue: number }>;
  missingMonths: string[];
  overlapMonthsUsingImportedOnly?: string[];
  overlapSystemMonthsExcluded?: number;
  forecastVersion: string;
};

export type HistoricalImport = { id: string; fileName: string; rowCount: number; validRows: number; invalidRows: number; duplicateRows: number; createdAt: string | null };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function responseArray(value: unknown, field: string, endpoint: string): unknown[] {
  if (!isRecord(value) || !Array.isArray(value[field])) {
    throw new Error(`${endpoint} returned an invalid response: expected an array in "${field}".`);
  }
  return value[field];
}

function optionalArray<T>(value: unknown, field: string, path: string, normalize: (entry: unknown, entryPath: string) => T): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${path}.${field} must be an array when provided.`);
  return value.map((entry, index) => normalize(entry, `${path}.${field}[${index}]`));
}

function numberOr(value: unknown, fallback: number, path: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
  return value;
}

function nullableNumber(value: unknown, path: string): number | null {
  return value === undefined || value === null ? null : numberOr(value, 0, path);
}

function nullableString(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${path} must be a string or null.`);
  return value;
}

function normalizeMetrics(value: unknown, path: string): RevenueMetrics {
  if (value !== undefined && value !== null && !isRecord(value)) throw new Error(`${path} must be an object or null.`);
  const metrics = isRecord(value) ? value : {};
  return {
    mae: nullableNumber(metrics.mae, `${path}.mae`),
    mape: nullableNumber(metrics.mape, `${path}.mape`),
    rmse: nullableNumber(metrics.rmse, `${path}.rmse`),
    testObservations: numberOr(metrics.testObservations, 0, `${path}.testObservations`),
    mapeSamples: numberOr(metrics.mapeSamples, 0, `${path}.mapeSamples`),
    zeroActualObservations: numberOr(metrics.zeroActualObservations, 0, `${path}.zeroActualObservations`),
  };
}

function normalizeEvaluationPrediction(value: unknown, path: string): RevenueEvaluationPrediction {
  if (!isRecord(value) || typeof value.period !== 'string') throw new Error(`${path} is missing a valid period.`);
  for (const field of ['actualRevenue', 'predictedRevenue', 'absoluteError']) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) throw new Error(`${path}.${field} must be a finite number.`);
  }
  return {
    originPeriod: nullableString(value.originPeriod, `${path}.originPeriod`) ?? undefined,
    horizon: numberOr(value.horizon, 0, `${path}.horizon`) || undefined,
    period: value.period,
    actualRevenue: value.actualRevenue as number,
    predictedRevenue: value.predictedRevenue as number,
    absoluteError: value.absoluteError as number,
    absolutePercentageError: nullableNumber(value.absolutePercentageError, `${path}.absolutePercentageError`),
  };
}

function normalizeComparison(value: unknown, path: string): RevenueComparison {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  const modelType = typeof value.modelType === 'string' ? value.modelType : 'unknown';
  const execution = value.evaluationExecution;
  if (execution !== undefined && execution !== null && !isRecord(execution)) throw new Error(`${path}.evaluationExecution must be an object or null.`);
  const safeExecution = isRecord(execution) ? execution : null;
  let trainingRowsByFoldAndStep: number[][] = [];
  if (safeExecution?.trainingRowsByFoldAndStep !== undefined && safeExecution.trainingRowsByFoldAndStep !== null) {
    if (!Array.isArray(safeExecution.trainingRowsByFoldAndStep) || !safeExecution.trainingRowsByFoldAndStep.every((fold) => Array.isArray(fold) && fold.every((count) => typeof count === 'number' && Number.isFinite(count)))) {
      throw new Error(`${path}.evaluationExecution.trainingRowsByFoldAndStep must be an array of numeric arrays.`);
    }
    trainingRowsByFoldAndStep = safeExecution.trainingRowsByFoldAndStep as number[][];
  }
  return {
    modelType,
    label: typeof value.label === 'string' ? value.label : modelType.replaceAll('_', ' '),
    selected: value.selected === true,
    metrics: normalizeMetrics(value.metrics, `${path}.metrics`),
    evaluationPeriodStart: nullableString(value.evaluationPeriodStart, `${path}.evaluationPeriodStart`),
    evaluationPeriodEnd: nullableString(value.evaluationPeriodEnd, `${path}.evaluationPeriodEnd`),
    forecastHorizon: numberOr(value.forecastHorizon, 0, `${path}.forecastHorizon`),
    evaluationPredictions: optionalArray(value.evaluationPredictions, 'evaluationPredictions', path, normalizeEvaluationPrediction),
    evaluationExecution: safeExecution ? {
      strategy: typeof safeExecution.strategy === 'string' ? safeExecution.strategy : 'unknown',
      evaluationFolds: numberOr(safeExecution.evaluationFolds, 0, `${path}.evaluationExecution.evaluationFolds`),
      trainingRowsByFoldAndStep,
      fallbackUsed: safeExecution.fallbackUsed === true,
    } : undefined,
  };
}

function normalizeMonthlyActual(value: unknown, path: string) {
  if (!isRecord(value) || typeof value.period !== 'string' || typeof value.actualRevenue !== 'number' || !Number.isFinite(value.actualRevenue)) throw new Error(`${path} must contain a valid period and actual revenue.`);
  return { period: value.period, actualRevenue: value.actualRevenue };
}

function normalizeMonthlyForecast(value: unknown, path: string) {
  if (!isRecord(value) || typeof value.period !== 'string' || typeof value.forecastRevenue !== 'number' || !Number.isFinite(value.forecastRevenue)) throw new Error(`${path} must contain a valid period and forecast revenue.`);
  return { period: value.period, forecastRevenue: value.forecastRevenue };
}

export function normalizeRevenueRun(value: unknown, index: number): RevenueRun {
  const path = `forecasts.runs[${index}]`;
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) throw new Error(`${path} is missing a valid run ID.`);
  const predictionTarget = typeof value.predictionTarget === 'string' ? value.predictionTarget : 'medicine_quantity';
  const modelType = typeof value.modelType === 'string' ? value.modelType : 'xgboost';
  if (value.modelConfig !== undefined && value.modelConfig !== null && !isRecord(value.modelConfig)) throw new Error(`${path}.modelConfig must be an object or null.`);
  const rawConfig = isRecord(value.modelConfig) ? value.modelConfig : {};
  const modelConfig: Record<string, string | number> = {};
  for (const [key, item] of Object.entries(rawConfig)) {
    if (typeof item !== 'string' && (typeof item !== 'number' || !Number.isFinite(item))) throw new Error(`${path}.modelConfig.${key} must be a string or finite number.`);
    modelConfig[key] = item;
  }
  if (value.missingMonths !== undefined && value.missingMonths !== null && (!Array.isArray(value.missingMonths) || !value.missingMonths.every((month) => typeof month === 'string'))) {
    throw new Error(`${path}.missingMonths must be an array of month labels.`);
  }
  if (value.overlapMonthsUsingImportedOnly !== undefined && value.overlapMonthsUsingImportedOnly !== null && (!Array.isArray(value.overlapMonthsUsingImportedOnly) || !value.overlapMonthsUsingImportedOnly.every((month) => typeof month === 'string'))) {
    throw new Error(`${path}.overlapMonthsUsingImportedOnly must be an array of month labels.`);
  }
  let oneStepEvaluation: RevenueOneStepEvaluation | undefined;
  if (value.oneStepEvaluation !== undefined && value.oneStepEvaluation !== null) {
    if (!isRecord(value.oneStepEvaluation)) throw new Error(`${path}.oneStepEvaluation must be an object or null.`);
    const oneStep = value.oneStepEvaluation;
    if (oneStep.strategy !== 'expanding_one_step_actual_observation_refit' || oneStep.horizon !== 1) throw new Error(`${path}.oneStepEvaluation has an unsupported strategy or horizon.`);
    oneStepEvaluation = {
      strategy: oneStep.strategy,
      horizon: 1,
      models: optionalArray(oneStep.models, 'models', `${path}.oneStepEvaluation`, normalizeComparison),
      evaluationPeriodStart: nullableString(oneStep.evaluationPeriodStart, `${path}.oneStepEvaluation.evaluationPeriodStart`),
      evaluationPeriodEnd: nullableString(oneStep.evaluationPeriodEnd, `${path}.oneStepEvaluation.evaluationPeriodEnd`),
    };
  }
  return {
    id: value.id,
    createdAt: nullableString(value.createdAt, `${path}.createdAt`),
    predictionTarget,
    modelType,
    modelLabel: typeof value.modelLabel === 'string' ? value.modelLabel : modelType.replaceAll('_', ' '),
    historicalStartDate: nullableString(value.historicalStartDate, `${path}.historicalStartDate`),
    historicalEndDate: nullableString(value.historicalEndDate, `${path}.historicalEndDate`),
    forecastHorizon: numberOr(value.forecastHorizon, 0, `${path}.forecastHorizon`),
    evaluationHorizon: numberOr(value.evaluationHorizon, 0, `${path}.evaluationHorizon`) || undefined,
    minimumRequiredMonths: numberOr(value.minimumRequiredMonths, 4, `${path}.minimumRequiredMonths`),
    modelConfig,
    trainingObservationCount: numberOr(value.trainingObservationCount, 0, `${path}.trainingObservationCount`),
    testObservationCount: numberOr(value.testObservationCount, 0, `${path}.testObservationCount`),
    evaluationMethod: typeof value.evaluationMethod === 'string' ? value.evaluationMethod : 'unavailable',
    evaluationPeriodStart: nullableString(value.evaluationPeriodStart, `${path}.evaluationPeriodStart`),
    evaluationPeriodEnd: nullableString(value.evaluationPeriodEnd, `${path}.evaluationPeriodEnd`),
    metrics: normalizeMetrics(value.metrics, `${path}.metrics`),
    evaluationAvailable: value.evaluationAvailable === true,
    oneStepEvaluation,
    dataLimitationWarning: nullableString(value.dataLimitationWarning, `${path}.dataLimitationWarning`),
    historicalEvaluationRecomputed: value.historicalEvaluationRecomputed === true,
    modelComparisons: optionalArray(value.modelComparisons, 'modelComparisons', path, normalizeComparison),
    actualMonthlyRevenue: optionalArray(value.actualMonthlyRevenue, 'actualMonthlyRevenue', path, normalizeMonthlyActual),
    forecastMonthlyRevenue: optionalArray(value.forecastMonthlyRevenue, 'forecastMonthlyRevenue', path, normalizeMonthlyForecast),
    missingMonths: Array.isArray(value.missingMonths) ? value.missingMonths as string[] : [],
    overlapMonthsUsingImportedOnly: Array.isArray(value.overlapMonthsUsingImportedOnly) ? value.overlapMonthsUsingImportedOnly as string[] : undefined,
    overlapSystemMonthsExcluded: numberOr(value.overlapSystemMonthsExcluded, 0, `${path}.overlapSystemMonthsExcluded`),
    forecastVersion: typeof value.forecastVersion === 'string' ? value.forecastVersion : 'legacy',
  };
}

export function parseRevenueRunsResponse(value: unknown): RevenueRun[] {
  return responseArray(value, 'runs', 'Forecasts API').map(normalizeRevenueRun);
}

export function parseRevenueImportsResponse(value: unknown): HistoricalImport[] {
  return responseArray(value, 'imports', 'Forecast imports API').map((entry, index) => {
    const path = `imports[${index}]`;
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id || typeof entry.fileName !== 'string') {
      throw new Error(`Forecast imports API returned an invalid ${path}: an import ID and file name are required.`);
    }
    return {
      id: entry.id,
      fileName: entry.fileName,
      rowCount: numberOr(entry.rowCount, 0, `${path}.rowCount`),
      validRows: numberOr(entry.validRows, 0, `${path}.validRows`),
      invalidRows: numberOr(entry.invalidRows, 0, `${path}.invalidRows`),
      duplicateRows: numberOr(entry.duplicateRows, 0, `${path}.duplicateRows`),
      createdAt: nullableString(entry.createdAt, `${path}.createdAt`),
    };
  });
}
