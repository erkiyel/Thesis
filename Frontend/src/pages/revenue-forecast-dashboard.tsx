import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BrainCircuit, FileSpreadsheet, Info, RefreshCw, TrendingUp } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DatabaseLoading } from '@/components/database-loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip as InfoTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { apiRequest, formatDate } from '@/lib/api';
import { normalizeRevenueRun, parseRevenueImportsResponse, parseRevenueRunsResponse, type HistoricalImport, type RevenueMetrics, type RevenueRun } from '@/lib/revenue-forecast-data';

type Metrics = RevenueMetrics;
type RevenuePreview = { valid: boolean; importId: string | null; duplicateUpload?: boolean; rawRowCount: number; validRows: number; reviewRows?: number; invalidRows: number; duplicateRows: number; errors: Array<{ row: number; messages: string[] }>; errorsTruncated?: boolean; columns?: Record<string, string>; historicalStartDate?: string; historicalEndDate?: string; observedMonths: number; missingMonths: string[]; reconciliationErrors?: Array<{ month: string; transactionRevenue: number | null; monthlySheetRevenue: number | null; transactionRecordCount: number | null; monthlySheetRecordCount: number | null }>; monthlyRevenue?: Array<{ month: string; revenue: number | null; records: number | null; coverage: string; notes: string }>; unresolvedReviewRows?: Array<{ sourceRow: number; transactionDate: string | null; clientName: string | null; productDescription: string | null; customerType: string | null; siNumber: string | null; qualityNotes: string | null }>; preview: Array<{ date?: string; transactionDate?: string | null; salesAmount: number; invoiceReference?: string | null; siNumber?: string | null; customer?: string | null; clientName?: string | null; productDescription: string | null; sourceRow: number }> };
type ChartPoint = { period: string; actualRevenue: number | null; forecastRevenue: number | null };

function parseRevenuePreviewResponse(value: unknown): RevenuePreview {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Forecast preview API returned an invalid response object.');
  const response = value as Record<string, unknown>;
  if (typeof response.valid !== 'boolean' || (response.importId !== null && response.importId !== undefined && typeof response.importId !== 'string')) {
    throw new Error('Forecast preview API returned an invalid response: import validity or ID is missing.');
  }
  for (const field of ['rawRowCount', 'validRows', 'invalidRows', 'duplicateRows', 'observedMonths']) {
    if (typeof response[field] !== 'number' || !Number.isFinite(response[field])) throw new Error(`Forecast preview API returned an invalid response: "${field}" must be a number.`);
  }
  const arrayFields = ['errors', 'missingMonths', 'preview', 'reconciliationErrors', 'monthlyRevenue', 'unresolvedReviewRows'] as const;
  for (const field of arrayFields) {
    const fieldValue = response[field];
    if (fieldValue !== undefined && fieldValue !== null && !Array.isArray(fieldValue)) throw new Error(`Forecast preview API returned an invalid response: "${field}" must be an array.`);
  }
  const arrays = Object.fromEntries(arrayFields.map((field) => [field, response[field] ?? []]));
  return { ...response, ...arrays, importId: response.importId ?? null } as RevenuePreview;
}

const money = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(value);
const metricHelp = {
  MAE: 'Mean Absolute Error: the average absolute difference between actual and forecast monthly revenue. Lower is better; shown in PHP.',
  MAPE: 'Mean Absolute Percentage Error: average absolute percentage error for nonzero actual months. Zero-revenue actuals are excluded from MAPE and reported separately.',
  RMSE: 'Root Mean Squared Error: the square root of average squared revenue error. Larger misses affect it more; shown in PHP.',
};
const TEMPORAL_EVALUATION_VERSION = 'revenue_xgboost_temporal_eval_v2';

function evaluationLabel(run: RevenueRun) {
  if (run.evaluationMethod === 'chronological_walk_forward' && run.forecastVersion !== TEMPORAL_EVALUATION_VERSION) {
    return 'legacy fixed-origin recursive evaluation';
  }
  return run.evaluationMethod.replaceAll('_', ' ');
}

function MetricCard({ name, value }: { name: keyof typeof metricHelp; value: number | null | undefined }) {
  return <div className="rounded-xl border border-border bg-background p-4"><p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">{name}<InfoTooltip><TooltipTrigger asChild><button type="button" aria-label={`Explain ${name}`} className="inline-flex size-5 items-center justify-center rounded-full hover:bg-secondary"><Info size={12} /></button></TooltipTrigger><TooltipContent className="max-w-64">{metricHelp[name]}</TooltipContent></InfoTooltip></p><p className="mt-2 font-serif text-2xl font-extrabold">{name === 'MAPE' ? value == null ? '—' : `${value.toFixed(2)}%` : money(value)}</p></div>;
}

function mergeChart(run: RevenueRun | null): ChartPoint[] {
  if (!run) return [];
  const points = new Map<string, ChartPoint>();
  for (const item of run.actualMonthlyRevenue ?? []) points.set(item.period, { period: item.period, actualRevenue: item.actualRevenue, forecastRevenue: null });
  for (const period of run.missingMonths ?? []) {
    if (!points.has(period)) points.set(period, { period, actualRevenue: null, forecastRevenue: null });
  }
  for (const item of run.forecastMonthlyRevenue ?? []) {
    const point = points.get(item.period) ?? { period: item.period, actualRevenue: null, forecastRevenue: null };
    point.forecastRevenue = item.forecastRevenue;
    points.set(item.period, point);
  }
  return [...points.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export default function RevenueForecastDashboard({ role = 'admin' }: { role?: 'admin' | 'manager' }) {
  const [runs, setRuns] = useState<RevenueRun[]>([]);
  const [imports, setImports] = useState<HistoricalImport[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [importId, setImportId] = useState('');
  const [horizon, setHorizon] = useState(3);
  const [preview, setPreview] = useState<RevenuePreview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const revenueRuns = useMemo(() => runs.filter((run) => run.predictionTarget === 'monthly_sales_revenue_php'), [runs]);
  const selectedRun = revenueRuns.find((run) => run.id === selectedRunId) ?? revenueRuns[0] ?? null;
  const chartData = useMemo(() => mergeChart(selectedRun), [selectedRun]);
  const xgboostEvaluation = selectedRun?.oneStepEvaluation?.models.find((comparison) => comparison.modelType === 'xgboost');
  const fixedOriginXgboostEvaluation = selectedRun?.modelComparisons?.find((comparison) => comparison.modelType === 'xgboost');

  async function refresh() {
    setLoading(true);
    try {
      setError('');
      const [runResponse, importResponse] = await Promise.all([
        apiRequest<unknown>('/admin/forecasts', { cache: 'no-store' }),
        apiRequest<unknown>('/admin/forecasts/imports', { cache: 'no-store' }),
      ]);
      const availableRuns = parseRevenueRunsResponse(runResponse);
      const availableImports = parseRevenueImportsResponse(importResponse);
      setRuns(availableRuns);
      setImports(availableImports);
      setSelectedRunId((current) => availableRuns.some((run) => run.id === current) ? current : availableRuns.find((run) => run.predictionTarget === 'monthly_sales_revenue_php')?.id ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load revenue forecast data.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    setFile(next); setPreview(null); setImportId(''); setError('');
    if (!next) return;
    if (!next.name.toLowerCase().endsWith('.xlsx') || next.size < 1 || next.size > 10 * 1024 * 1024) {
      setFile(null); setError('Choose a non-empty .xlsx workbook up to 10 MB.'); return;
    }
    const body = new FormData(); body.append('file', next);
    setPreviewing(true);
    try {
      const result = parseRevenuePreviewResponse(await apiRequest<unknown>('/admin/forecasts/preview', { method: 'POST', body }));
      setPreview(result);
      if (result.importId && result.valid) {
        setImportId(result.importId);
        const saved = await apiRequest<unknown>('/admin/forecasts/imports', { cache: 'no-store' });
        setImports(parseRevenueImportsResponse(saved));
      } else if (!result.valid) setError('Correct the invalid records before forecasting. No import was saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to validate the workbook.');
    } finally { setPreviewing(false); }
  }

  async function runForecast() {
    if (file && !preview?.valid) { setError('Validate the selected workbook before forecasting.'); return; }
    setRunning(true); setError('');
    try {
      const response = await apiRequest<unknown>('/admin/forecasts/run', { method: 'POST', body: JSON.stringify({ horizon, importId: importId || null }) });
      const result = normalizeRevenueRun(response, 0);
      if (result.predictionTarget !== 'monthly_sales_revenue_php') throw new Error('Forecast run API returned a record for an unexpected prediction target.');
      setRuns((current) => [result, ...current.filter((run) => run.id !== result.id)]);
      setSelectedRunId(result.id);
      await refreshImportsOnly();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to generate the revenue forecast.');
    } finally { setRunning(false); }
  }

  async function refreshImportsOnly() {
    try {
      setImports(parseRevenueImportsResponse(await apiRequest<unknown>('/admin/forecasts/imports', { cache: 'no-store' })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to refresh historical imports.');
    }
  }

  return <AppShell role={role} title={role === 'admin' ? 'Admin home' : 'Manager home'} eyebrow="Operations workspace">
    <div className="page-enter space-y-6">
      <header><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Revenue forecasting</p><h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.045em]">Monthly sales revenue</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">XGBoost forecasts recorded revenue in Philippine pesos. This estimates company-wide revenue; it is not a medicine-demand or restocking forecast.</p></header>
      {error && <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}

      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex items-start gap-4"><span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary"><FileSpreadsheet size={18} /></span><div><h3 className="font-serif text-2xl font-extrabold">Historical revenue import</h3><p className="mt-2 text-sm text-muted-foreground">Use real transaction rows with Date and Sales Amount (PHP). Quantity Sold is not required or used.</p></div></div>
        <div className="mt-5 flex flex-wrap items-end gap-4"><label className="grid gap-2 text-xs font-semibold text-muted-foreground">Revenue workbook (.xlsx)<Input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void chooseFile(event)} /></label><label className="grid gap-2 text-xs font-semibold text-muted-foreground">Historical source<select className="h-10 min-w-64 rounded-md border border-input bg-background px-3 text-sm" value={importId} onChange={(event) => { setImportId(event.target.value); setFile(null); setPreview(null); }}><option value="">Completed system sales only</option>{imports.map((item) => <option key={item.id} value={item.id}>{item.fileName} · {item.validRows.toLocaleString()} included rows</option>)}</select></label>{previewing && <span role="status" className="text-sm text-muted-foreground">Validating source rows…</span>}{preview?.valid && <span role="status" className="text-sm text-emerald-700">{preview.validRows.toLocaleString()} included rows{preview.duplicateUpload ? ' · this workbook was already imported' : ' · saved as source import'}</span>}</div>
        {preview && <div className="mt-5 space-y-4 rounded-xl border border-border p-4"><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-md bg-secondary px-3 py-2">Clean sales rows: {preview.rawRowCount}</span><span className="rounded-md bg-emerald-600/10 px-3 py-2 text-emerald-800">Included: {preview.validRows}</span><span className="rounded-md bg-orange-500/10 px-3 py-2 text-orange-800">Duplicate rows excluded: {preview.duplicateRows}</span><span className="rounded-md bg-orange-500/10 px-3 py-2 text-orange-800">Needs review: {preview.reviewRows ?? 0}</span><span className="rounded-md bg-secondary px-3 py-2">Observed revenue months: {preview.observedMonths}</span></div><p className="text-xs text-muted-foreground">Monthly Revenue totals reconcile against Included transactions. Missing months remain unknown and are never filled with zero. {preview.historicalStartDate} to {preview.historicalEndDate}</p>{preview.missingMonths.length > 0 && <p className="text-xs text-orange-800">Reporting gaps: {preview.missingMonths.join(', ')}</p>}{preview.reconciliationErrors?.length ? <ul className="space-y-1 text-xs text-destructive">{preview.reconciliationErrors.map((row) => <li key={row.month}>{row.month}: transaction total {money(row.transactionRevenue)} / {row.transactionRecordCount ?? 0} rows; monthly sheet {money(row.monthlySheetRevenue)} / {row.monthlySheetRecordCount ?? 0} rows.</li>)}</ul> : <p className="text-xs text-emerald-700">Transaction amounts and record counts match the Monthly Revenue sheet.</p>}{preview.errors.length > 0 && <ul className="space-y-1 text-xs text-destructive">{preview.errors.slice(0, 10).map((row) => <li key={row.row}>Row {row.row}: {row.messages.join(' ')}</li>)}</ul>}{preview.unresolvedReviewRows?.length ? <div className="rounded-lg bg-orange-500/5 p-3 text-xs"><p className="font-semibold text-orange-900">Excluded review rows</p>{preview.unresolvedReviewRows.map((row) => <p key={row.sourceRow} className="mt-1 text-orange-900">Row {row.sourceRow}: {row.clientName ?? 'Client not recorded'} · {row.productDescription ?? 'Product not recorded'} · {row.qualityNotes ?? 'Needs review'}</p>)}</div> : null}{preview.monthlyRevenue?.length ? <div className="max-h-52 overflow-auto rounded-lg border border-border"><table className="w-full min-w-[450px] text-left text-xs"><thead className="sticky top-0 bg-background"><tr className="border-b border-border"><th className="p-2">Month</th><th className="p-2">Included sales</th><th className="p-2">Transactions</th><th className="p-2">Coverage</th></tr></thead><tbody>{preview.monthlyRevenue.map((row) => <tr key={row.month} className="border-b border-border/50"><td className="p-2">{row.month}</td><td className="p-2">{money(row.revenue)}</td><td className="p-2">{row.records ?? '—'}</td><td className="p-2">{row.coverage}</td></tr>)}</tbody></table></div> : <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead><tr className="border-b border-border"><th className="p-2">Date</th><th className="p-2">Customer / Institution</th><th className="p-2">Invoice</th><th className="p-2">Product description</th><th className="p-2">Sales amount</th></tr></thead><tbody>{preview.preview.slice(0, 8).map((row, index) => <tr key={`${row.sourceRow}-${index}`} className="border-b border-border/50"><td className="p-2">{row.date ?? row.transactionDate ?? '—'}</td><td className="p-2">{row.customer ?? row.clientName ?? '—'}</td><td className="p-2">{row.invoiceReference ?? row.siNumber ?? '—'}</td><td className="p-2">{row.productDescription ?? '—'}</td><td className="p-2">{money(row.salesAmount)}</td></tr>)}</tbody></table></div>}</div>}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4"><div className="flex items-start gap-4"><span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary"><BrainCircuit size={18} /></span><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">XGBoost Regressor</p><h3 className="mt-2 font-serif text-2xl font-extrabold">Generate a revenue forecast</h3></div></div><div className="flex items-end gap-3"><label className="grid gap-1 text-xs font-medium">Horizon<select value={horizon} onChange={(event) => setHorizon(Number(event.target.value))} className="h-10 rounded-md border border-input bg-background px-3 text-sm">{[1, 3, 6, 12].map((months) => <option key={months} value={months}>{months} months</option>)}</select></label><Button type="button" disabled={running || previewing} onClick={() => void runForecast()}>{running ? 'Evaluating…' : 'Run forecast'} <TrendingUp size={16} /></Button></div></div>
         <p className="mt-3 text-xs text-muted-foreground">Requires at least 4 consecutive observed monthly revenue totals to train. Four months is a minimum, not a reliability guarantee. Walk-forward comparisons use only valid chronological test folds; metrics are omitted when a separate test is unavailable. Missing months are not assumed to be zero.</p>
        {(running || previewing) && <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">{running ? 'Running chronological evaluation and saving the forecast…' : 'Validating the revenue workbook…'}</p>}
      </section>

      {selectedRun ? <>
        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Selected run</p><h3 className="mt-2 font-serif text-2xl font-extrabold">Forecast summary</h3><p className="mt-1 text-sm text-muted-foreground">{selectedRun.historicalStartDate ?? '—'} through {selectedRun.historicalEndDate ?? '—'} · {selectedRun.forecastHorizon}-month horizon · {evaluationLabel(selectedRun)}</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">{selectedRun.modelLabel}</span></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3"><MetricCard name="MAE" value={selectedRun.metrics.mae} /><MetricCard name="MAPE" value={selectedRun.metrics.mape} /><MetricCard name="RMSE" value={selectedRun.metrics.rmse} /></div>
          <aside role="note" aria-label="Forecast limitations" className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-6 text-amber-950"><Info aria-hidden="true" className="mt-1 size-4 shrink-0 text-amber-700" /><p>AI can make mistakes. Revenue forecasts are estimates based on limited historical sales data and may differ significantly from actual results. These predictions should be used as supplementary planning information, not as the sole basis for business decisions. Historical evaluation results do not guarantee the accuracy of future forecasts.</p></aside>
          <p className="mt-4 text-xs text-muted-foreground">Valid lagged training rows: {selectedRun.trainingObservationCount} · Fixed-origin test observations: {selectedRun.testObservationCount} · Test period: {selectedRun.evaluationPeriodStart ?? '—'} to {selectedRun.evaluationPeriodEnd ?? '—'} · Zero actual months excluded from MAPE: {selectedRun.metrics.zeroActualObservations}</p>
          {selectedRun.testObservationCount === 0 && <p role="status" className="mt-2 text-xs text-muted-foreground">No valid chronological test fold was available for this saved run. Evaluation metrics are unavailable.</p>}
          {selectedRun.dataLimitationWarning && <p role="status" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-900">{selectedRun.dataLimitationWarning}</p>}
          {selectedRun.forecastVersion !== TEMPORAL_EVALUATION_VERSION && <p role="status" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-900">This is a preserved historical run from the earlier evaluation implementation. Its stored scores and predictions have not been overwritten and should not be interpreted as results from the current evaluation procedure.</p>}
          {selectedRun.missingMonths.length > 0 && <p className="mt-2 text-xs text-orange-800">Data quality: missing reported months were not filled with zero: {selectedRun.missingMonths.join(', ')}</p>}
          {(selectedRun.overlapSystemMonthsExcluded ?? 0) > 0 && <p className="mt-2 text-xs text-orange-800">For overlapping imported/system months, imported revenue was used to avoid double-counting ({selectedRun.overlapMonthsUsingImportedOnly?.join(', ')}).</p>}
          <p className="mt-2 break-words text-xs text-muted-foreground">Model settings: {Object.entries(selectedRun.modelConfig).map(([key, value]) => `${key}=${value}`).join(' · ')}</p>
          <div className="mt-6 h-[340px] w-full">{chartData.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 8, right: 18, left: 10, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="period" tick={{ fontSize: 11 }} label={{ value: 'Month', position: 'insideBottom', offset: -4, fontSize: 12 }} /><YAxis tickFormatter={(value) => `₱${Number(value).toLocaleString()}`} tick={{ fontSize: 11 }} width={84} label={{ value: 'Monthly revenue (PHP)', angle: -90, position: 'insideLeft', fontSize: 12 }} /><Tooltip formatter={(value) => money(value == null ? null : Number(value))} /><Legend /><Line type="monotone" dataKey="actualRevenue" name="Actual Revenue" stroke="#477b62" strokeWidth={2.5} dot={{ r: 3 }} /><Line type="monotone" dataKey="forecastRevenue" name="Forecast Revenue · XGBoost" stroke="#c47c35" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} /></LineChart></ResponsiveContainer> : <p className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">No monthly chart data is available for this saved run.</p>}</div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8"><h3 className="font-serif text-2xl font-extrabold">Historical Evaluation Details</h3><p className="mt-2 text-sm text-muted-foreground">One-step expanding evaluation. Each prediction is made from earlier observed months only; after each test month, its actual value becomes available to the next fold. These predictions are separate from both the fixed-origin {selectedRun.evaluationHorizon ?? selectedRun.forecastHorizon}-month evaluation and the future forecast.</p>{xgboostEvaluation?.evaluationPredictions?.length ? <><p className="mt-3 text-xs text-muted-foreground">XGBoost was refitted for each of {xgboostEvaluation.evaluationExecution?.evaluationFolds ?? 0} one-step folds using the listed valid lag-row counts. Fallback used: {xgboostEvaluation.evaluationExecution?.fallbackUsed ? 'yes' : 'no'}{selectedRun.historicalEvaluationRecomputed ? ' · Details reproduced from saved monthly actuals.' : ''}</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[950px] text-left text-sm"><thead><tr className="border-b border-border font-mono text-[10px] uppercase text-muted-foreground"><th className="p-3">Forecast Origin</th><th className="p-3">Horizon</th><th className="p-3">Test Month</th><th className="p-3">Actual Revenue (PHP)</th><th className="p-3">XGBoost Predicted Revenue (PHP)</th><th className="p-3">Absolute Error (PHP)</th><th className="p-3">Absolute Percentage Error (%)</th></tr></thead><tbody>{xgboostEvaluation.evaluationPredictions.map((row) => <tr key={row.period} className="border-b border-border/60"><td className="p-3">{row.originPeriod ?? '—'}</td><td className="p-3">{row.horizon ?? 1} month</td><td className="p-3">{row.period}</td><td className="p-3">{money(row.actualRevenue)}</td><td className="p-3">{money(row.predictedRevenue)}</td><td className="p-3">{money(row.absoluteError)}</td><td className="p-3">{row.absolutePercentageError == null ? '—' : `${row.absolutePercentageError.toFixed(6)}%`}</td></tr>)}</tbody></table></div><h4 className="mt-6 font-semibold">One-step baseline comparison</h4><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-border font-mono text-[10px] uppercase text-muted-foreground"><th className="p-3">Algorithm</th><th className="p-3">MAE (PHP)</th><th className="p-3">MAPE</th><th className="p-3">RMSE (PHP)</th><th className="p-3">Test months</th><th className="p-3">Evaluation period</th></tr></thead><tbody>{selectedRun.oneStepEvaluation?.models.map((model) => <tr key={model.modelType} className="border-b border-border/60"><td className="p-3">{model.label}</td><td className="p-3">{money(model.metrics.mae)}</td><td className="p-3">{model.metrics.mape == null ? '—' : `${model.metrics.mape.toFixed(2)}%`}</td><td className="p-3">{money(model.metrics.rmse)}</td><td className="p-3">{model.metrics.testObservations}</td><td className="p-3">{model.evaluationPeriodStart ?? '—'} to {model.evaluationPeriodEnd ?? '—'}</td></tr>)}</tbody></table></div></> : <p className="mt-4 rounded-lg bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">This saved run does not include one-step fold predictions. Create a new forecast run to record both evaluation methods. Fixed-origin predictions for the existing run remain available below.</p>}</section>
        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8"><h3 className="font-serif text-2xl font-extrabold">{selectedRun.forecastVersion === TEMPORAL_EVALUATION_VERSION ? 'Fixed-origin' : 'Historical'} {selectedRun.evaluationHorizon ?? selectedRun.forecastHorizon}-month comparison</h3><p className="mt-2 text-sm text-muted-foreground">{selectedRun.forecastVersion === TEMPORAL_EVALUATION_VERSION ? 'All methods use the same origin and forecast horizon. Each fitted method is fitted once at the origin and recursively predicts the entire block. These scores do not represent one-step expanding accuracy or future forecast certainty.' : 'This preserved comparison was created before the current evaluation protocol. Its original results remain unchanged; create a new run to view current one-step and fixed-origin evaluation details.'}</p><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b border-border font-mono text-[10px] uppercase text-muted-foreground"><th className="p-3">Algorithm</th><th className="p-3">MAE (PHP)</th><th className="p-3">MAPE</th><th className="p-3">RMSE (PHP)</th><th className="p-3">Test observations</th><th className="p-3">Evaluation period</th></tr></thead><tbody>{selectedRun.modelComparisons.map((model) => <tr key={model.modelType} className="border-b border-border/60"><td className="p-3 font-semibold">{model.label}{model.selected && <span className="ml-2 rounded-full bg-secondary px-2 py-1 text-[10px]">Selected</span>}</td><td className="p-3">{money(model.metrics.mae)}</td><td className="p-3">{model.metrics.mape == null ? '—' : `${model.metrics.mape.toFixed(2)}%`}</td><td className="p-3">{money(model.metrics.rmse)}</td><td className="p-3">{model.metrics.testObservations}</td><td className="p-3">{model.evaluationPeriodStart ?? '—'} to {model.evaluationPeriodEnd ?? '—'}</td></tr>)}</tbody></table>{fixedOriginXgboostEvaluation?.evaluationPredictions?.length ? <p className="mt-3 text-xs text-muted-foreground">XGBoost fixed-origin test months: {fixedOriginXgboostEvaluation.evaluationPredictions.map((row) => `${row.period}: ${money(row.predictedRevenue)} predicted vs ${money(row.actualRevenue)} actual`).join(' · ')}</p> : null}</div></section>
      </> : loading ? <section className="rounded-2xl border border-dashed border-border p-8 text-center"><DatabaseLoading label="Loading revenue forecast history" /></section> : error ? null : <section className="rounded-2xl border border-dashed border-border p-8 text-center"><p className="font-serif text-xl font-bold">No forecasting records are available yet.</p><p className="mt-2 text-sm text-muted-foreground">At least 4 consecutive observed months are required to fit a forecast. No sales records or zero months are invented.</p></section>}

      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8"><div className="flex items-center justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Saved runs</p><h3 className="mt-2 font-serif text-2xl font-extrabold">Revenue forecast history</h3></div><Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</Button></div>{loading ? <DatabaseLoading className="mt-5" label="Loading saved forecasts" /> : error && revenueRuns.length === 0 ? null : revenueRuns.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No saved revenue runs. Older quantity forecasts remain preserved in the database and are not presented as revenue.</p> : <div className="mt-4 space-y-2">{revenueRuns.map((run) => <button key={run.id} type="button" onClick={() => setSelectedRunId(run.id)} aria-pressed={run.id === selectedRun.id} className={`w-full rounded-lg border p-3 text-left ${run.id === selectedRun.id ? 'border-primary bg-secondary/40' : 'border-border'}`}><span className="font-semibold">{formatDate(run.createdAt)} · {run.forecastHorizon} months</span><span className="mt-1 block text-xs text-muted-foreground">{run.historicalStartDate ?? '—'} to {run.historicalEndDate ?? '—'} · {money(run.metrics.mae)} MAE · {run.testObservationCount} test observations</span></button>)}</div>}</section>
    </div>
  </AppShell>;
}
