import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BrainCircuit, FileSpreadsheet, Info, RefreshCw, TrendingUp } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DatabaseLoading } from '@/components/database-loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip as InfoTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { apiRequest, formatDate } from '@/lib/api';

type Metrics = { mae: number | null; mape: number | null; rmse: number | null; testObservations: number; mapeSamples: number; zeroActualObservations: number };
type Comparison = { modelType: string; label: string; selected: boolean; metrics: Metrics; evaluationPeriodStart: string | null; evaluationPeriodEnd: string | null; forecastHorizon: number };
type RevenueRun = {
  id: string; createdAt?: string | null; predictionTarget: string; modelType: string; modelLabel: string;
  historicalStartDate: string; historicalEndDate: string; forecastHorizon: number; minimumRequiredMonths: number;
  modelConfig: Record<string, string | number>; trainingObservationCount: number; testObservationCount: number;
  evaluationMethod: string; evaluationPeriodStart: string | null; evaluationPeriodEnd: string | null; metrics: Metrics;
  modelComparisons: Comparison[]; actualMonthlyRevenue: Array<{ period: string; actualRevenue: number }>;
  forecastMonthlyRevenue: Array<{ period: string; forecastRevenue: number }>; missingMonths: string[];
  overlapMonthsUsingImportedOnly?: string[]; overlapSystemMonthsExcluded?: number; forecastVersion: string;
};
type RevenuePreview = { valid: boolean; importId: string | null; rawRowCount: number; validRows: number; invalidRows: number; duplicateRows: number; errors: Array<{ row: number; messages: string[] }>; errorsTruncated?: boolean; columns: Record<string, string>; historicalStartDate?: string; historicalEndDate?: string; observedMonths: number; missingMonths: string[]; preview: Array<{ date: string; salesAmount: number; invoiceReference: string | null; customer: string | null; productDescription: string | null; sourceRow: number }> };
type HistoricalImport = { id: string; fileName: string; rowCount: number; validRows: number; invalidRows: number; duplicateRows: number; createdAt: string | null };
type ChartPoint = { period: string; actualRevenue: number | null; forecastRevenue: number | null };

const money = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(value);
const metricHelp = {
  MAE: 'Mean Absolute Error: the average absolute difference between actual and forecast monthly revenue. Lower is better; shown in PHP.',
  MAPE: 'Mean Absolute Percentage Error: average absolute percentage error for nonzero actual months. Zero-revenue actuals are excluded from MAPE and reported separately.',
  RMSE: 'Root Mean Squared Error: the square root of average squared revenue error. Larger misses affect it more; shown in PHP.',
};

function MetricCard({ name, value }: { name: keyof typeof metricHelp; value: number | null | undefined }) {
  return <div className="rounded-xl border border-border bg-background p-4"><p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">{name}<InfoTooltip><TooltipTrigger asChild><button type="button" aria-label={`Explain ${name}`} className="inline-flex size-5 items-center justify-center rounded-full hover:bg-secondary"><Info size={12} /></button></TooltipTrigger><TooltipContent className="max-w-64">{metricHelp[name]}</TooltipContent></InfoTooltip></p><p className="mt-2 font-serif text-2xl font-extrabold">{name === 'MAPE' ? value == null ? '—' : `${value.toFixed(2)}%` : money(value)}</p></div>;
}

function mergeChart(run: RevenueRun | null): ChartPoint[] {
  if (!run) return [];
  const points = new Map<string, ChartPoint>();
  for (const item of run.actualMonthlyRevenue ?? []) points.set(item.period, { period: item.period, actualRevenue: item.actualRevenue, forecastRevenue: null });
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

  async function refresh() {
    setLoading(true);
    try {
      setError('');
      const [runResponse, importResponse] = await Promise.all([
        apiRequest<{ runs: RevenueRun[] }>('/admin/forecasts', { cache: 'no-store' }),
        apiRequest<{ imports: HistoricalImport[] }>('/admin/forecasts/imports', { cache: 'no-store' }),
      ]);
      setRuns(runResponse.runs);
      setImports(importResponse.imports);
      setSelectedRunId((current) => runResponse.runs.some((run) => run.id === current) ? current : runResponse.runs.find((run) => run.predictionTarget === 'monthly_sales_revenue_php')?.id ?? '');
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
      const result = await apiRequest<RevenuePreview>('/admin/forecasts/preview', { method: 'POST', body });
      setPreview(result);
      if (result.importId && result.valid) {
        setImportId(result.importId);
        const saved = await apiRequest<{ imports: HistoricalImport[] }>('/admin/forecasts/imports', { cache: 'no-store' });
        setImports(saved.imports);
      } else if (!result.valid) setError('Correct the invalid records before forecasting. No import was saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to validate the workbook.');
    } finally { setPreviewing(false); }
  }

  async function runForecast() {
    if (file && !preview?.valid) { setError('Validate the selected workbook before forecasting.'); return; }
    setRunning(true); setError('');
    try {
      const result = await apiRequest<RevenueRun>('/admin/forecasts/run', { method: 'POST', body: JSON.stringify({ horizon, importId: importId || null }) });
      setRuns((current) => [result, ...current.filter((run) => run.id !== result.id)]);
      setSelectedRunId(result.id);
      await refreshImportsOnly();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to generate the revenue forecast.');
    } finally { setRunning(false); }
  }

  async function refreshImportsOnly() {
    try { setImports((await apiRequest<{ imports: HistoricalImport[] }>('/admin/forecasts/imports', { cache: 'no-store' })).imports); } catch {}
  }

  return <AppShell role={role} title={role === 'admin' ? 'Admin home' : 'Manager home'} eyebrow="Operations workspace">
    <div className="page-enter space-y-6">
      <header><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Revenue forecasting</p><h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.045em]">Monthly sales revenue</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">XGBoost forecasts recorded revenue in Philippine pesos. This estimates company-wide revenue; it is not a medicine-demand or restocking forecast.</p></header>
      {error && <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}

      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex items-start gap-4"><span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary"><FileSpreadsheet size={18} /></span><div><h3 className="font-serif text-2xl font-extrabold">Historical revenue import</h3><p className="mt-2 text-sm text-muted-foreground">Use real transaction rows with Date and Sales Amount (PHP). Quantity Sold is not required or used.</p></div></div>
        <div className="mt-5 flex flex-wrap items-end gap-4"><label className="grid gap-2 text-xs font-semibold text-muted-foreground">Revenue workbook (.xlsx)<Input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void chooseFile(event)} /></label><label className="grid gap-2 text-xs font-semibold text-muted-foreground">Historical source<select className="h-10 min-w-64 rounded-md border border-input bg-background px-3 text-sm" value={importId} onChange={(event) => { setImportId(event.target.value); setFile(null); setPreview(null); }}><option value="">Completed system sales only</option>{imports.map((item) => <option key={item.id} value={item.id}>{item.fileName} · {item.rowCount.toLocaleString()} rows</option>)}</select></label>{previewing && <span role="status" className="text-sm text-muted-foreground">Validating source rows…</span>}{preview?.valid && <span role="status" className="text-sm text-emerald-700">{preview.validRows.toLocaleString()} validated records · saved as source import</span>}</div>
        {preview && <div className="mt-5 space-y-4 rounded-xl border border-border p-4"><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-md bg-secondary px-3 py-2">Rows: {preview.rawRowCount}</span><span className="rounded-md bg-emerald-600/10 px-3 py-2 text-emerald-800">Valid: {preview.validRows}</span><span className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">Invalid: {preview.invalidRows}</span><span className="rounded-md bg-orange-500/10 px-3 py-2 text-orange-800">Duplicate invoice rows skipped: {preview.duplicateRows}</span><span className="rounded-md bg-secondary px-3 py-2">Observed months: {preview.observedMonths}</span></div><p className="text-xs text-muted-foreground">Missing months remain unknown and are not filled with zero. {preview.historicalStartDate} to {preview.historicalEndDate}</p>{preview.missingMonths.length > 0 && <p className="text-xs text-orange-800">Reporting gaps: {preview.missingMonths.join(', ')}</p>}{preview.errors.length > 0 && <ul className="space-y-1 text-xs text-destructive">{preview.errors.slice(0, 10).map((row) => <li key={row.row}>Row {row.row}: {row.messages.join(' ')}</li>)}</ul>}<div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead><tr className="border-b border-border"><th className="p-2">Date</th><th className="p-2">Customer / Institution</th><th className="p-2">Invoice</th><th className="p-2">Product description</th><th className="p-2">Sales amount</th></tr></thead><tbody>{preview.preview.slice(0, 8).map((row, index) => <tr key={`${row.sourceRow}-${index}`} className="border-b border-border/50"><td className="p-2">{row.date}</td><td className="p-2">{row.customer ?? '—'}</td><td className="p-2">{row.invoiceReference ?? '—'}</td><td className="p-2">{row.productDescription ?? '—'}</td><td className="p-2">{money(row.salesAmount)}</td></tr>)}</tbody></table></div></div>}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4"><div className="flex items-start gap-4"><span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary"><BrainCircuit size={18} /></span><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">XGBoost Regressor</p><h3 className="mt-2 font-serif text-2xl font-extrabold">Generate a revenue forecast</h3></div></div><div className="flex items-end gap-3"><label className="grid gap-1 text-xs font-medium">Horizon<select value={horizon} onChange={(event) => setHorizon(Number(event.target.value))} className="h-10 rounded-md border border-input bg-background px-3 text-sm">{[1, 3, 6, 12].map((months) => <option key={months} value={months}>{months} months</option>)}</select></label><Button type="button" disabled={running || previewing} onClick={() => void runForecast()}>{running ? 'Evaluating…' : 'Run forecast'} <TrendingUp size={16} /></Button></div></div>
        <p className="mt-3 text-xs text-muted-foreground">Requires at least 12 consecutive observed monthly revenue totals. Walk-forward comparisons use the same horizon and test months for every baseline. Missing months are not assumed to be zero.</p>
        {(running || previewing) && <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">{running ? 'Running chronological evaluation and saving the forecast…' : 'Validating the revenue workbook…'}</p>}
      </section>

      {selectedRun ? <>
        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Selected run</p><h3 className="mt-2 font-serif text-2xl font-extrabold">Forecast summary</h3><p className="mt-1 text-sm text-muted-foreground">{selectedRun.historicalStartDate} through {selectedRun.historicalEndDate} · {selectedRun.forecastHorizon}-month horizon · {selectedRun.evaluationMethod.replaceAll('_', ' ')}</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">{selectedRun.modelLabel}</span></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3"><MetricCard name="MAE" value={selectedRun.metrics.mae} /><MetricCard name="MAPE" value={selectedRun.metrics.mape} /><MetricCard name="RMSE" value={selectedRun.metrics.rmse} /></div>
          <p className="mt-4 text-xs text-muted-foreground">Training observations: {selectedRun.trainingObservationCount} · Test observations: {selectedRun.testObservationCount} · Test period: {selectedRun.evaluationPeriodStart ?? '—'} to {selectedRun.evaluationPeriodEnd ?? '—'} · Zero actual months excluded from MAPE: {selectedRun.metrics.zeroActualObservations}</p>
          {selectedRun.missingMonths.length > 0 && <p className="mt-2 text-xs text-orange-800">Data quality: missing reported months were not filled with zero: {selectedRun.missingMonths.join(', ')}</p>}
          {(selectedRun.overlapSystemMonthsExcluded ?? 0) > 0 && <p className="mt-2 text-xs text-orange-800">For overlapping imported/system months, imported revenue was used to avoid double-counting ({selectedRun.overlapMonthsUsingImportedOnly?.join(', ')}).</p>}
          <p className="mt-2 break-words text-xs text-muted-foreground">Model settings: {Object.entries(selectedRun.modelConfig).map(([key, value]) => `${key}=${value}`).join(' · ')}</p>
          <div className="mt-6 h-[340px] w-full">{chartData.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 8, right: 18, left: 10, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="period" tick={{ fontSize: 11 }} label={{ value: 'Month', position: 'insideBottom', offset: -4, fontSize: 12 }} /><YAxis tickFormatter={(value) => `₱${Number(value).toLocaleString()}`} tick={{ fontSize: 11 }} width={84} label={{ value: 'Monthly revenue (PHP)', angle: -90, position: 'insideLeft', fontSize: 12 }} /><Tooltip formatter={(value) => money(value == null ? null : Number(value))} /><Legend /><Line type="monotone" dataKey="actualRevenue" name="Actual Revenue" stroke="#477b62" strokeWidth={2.5} dot={{ r: 3 }} connectNulls /><Line type="monotone" dataKey="forecastRevenue" name="Forecast Revenue · XGBoost" stroke="#c47c35" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls /></LineChart></ResponsiveContainer> : <DatabaseLoading label="Loading revenue chart" />}</div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8"><h3 className="font-serif text-2xl font-extrabold">Forecasting baseline comparison</h3><p className="mt-2 text-sm text-muted-foreground">Every method is evaluated on the same chronological test folds and {selectedRun.forecastHorizon}-month horizon. XGBoost is the selected implementation; metrics are reported without model-based favoritism.</p><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b border-border font-mono text-[10px] uppercase text-muted-foreground"><th className="p-3">Algorithm</th><th className="p-3">MAE (PHP)</th><th className="p-3">MAPE</th><th className="p-3">RMSE (PHP)</th><th className="p-3">Test observations</th><th className="p-3">Evaluation period</th></tr></thead><tbody>{selectedRun.modelComparisons.map((model) => <tr key={model.modelType} className="border-b border-border/60"><td className="p-3 font-semibold">{model.label}{model.selected && <span className="ml-2 rounded-full bg-secondary px-2 py-1 text-[10px]">Selected</span>}</td><td className="p-3">{money(model.metrics.mae)}</td><td className="p-3">{model.metrics.mape == null ? '—' : `${model.metrics.mape.toFixed(2)}%`}</td><td className="p-3">{money(model.metrics.rmse)}</td><td className="p-3">{model.metrics.testObservations}</td><td className="p-3">{model.evaluationPeriodStart ?? '—'} to {model.evaluationPeriodEnd ?? '—'}</td></tr>)}</tbody></table></div></section>
      </> : <section className="rounded-2xl border border-dashed border-border p-8 text-center"><p className="font-serif text-xl font-bold">{loading ? 'Loading revenue forecast history…' : 'No revenue forecast is available yet.'}</p><p className="mt-2 text-sm text-muted-foreground">{loading ? ' ' : 'With fewer than 12 consecutive observed months, the system will not fit or report an accuracy score. No sales records or zero months are invented.'}</p></section>}

      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8"><div className="flex items-center justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Saved runs</p><h3 className="mt-2 font-serif text-2xl font-extrabold">Revenue forecast history</h3></div><Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</Button></div>{loading ? <DatabaseLoading className="mt-5" label="Loading saved forecasts" /> : revenueRuns.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No saved revenue runs. Older quantity forecasts remain preserved in the database and are not presented as revenue.</p> : <div className="mt-4 space-y-2">{revenueRuns.map((run) => <button key={run.id} type="button" onClick={() => setSelectedRunId(run.id)} aria-pressed={run.id === selectedRun.id} className={`w-full rounded-lg border p-3 text-left ${run.id === selectedRun.id ? 'border-primary bg-secondary/40' : 'border-border'}`}><span className="font-semibold">{formatDate(run.createdAt)} · {run.forecastHorizon} months</span><span className="mt-1 block text-xs text-muted-foreground">{run.historicalStartDate} to {run.historicalEndDate} · {money(run.metrics.mae)} MAE · {run.testObservationCount} test observations</span></button>)}</div>}</section>
    </div>
  </AppShell>;
}
