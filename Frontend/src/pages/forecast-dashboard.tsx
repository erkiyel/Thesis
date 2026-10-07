import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, BrainCircuit, FileSpreadsheet, RefreshCw, TrendingUp } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DatabaseLoading } from '@/components/database-loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest, formatDate } from '@/lib/api';

type Metrics = { mae: number; mape: number | null; rmse: number; mapeSamples: number } | null;
type ForecastMedicine = {
  medicineId: string;
  medicineName: string;
  status: 'forecasted' | 'insufficient';
  reason?: string;
  inInventory?: boolean;
  currentStock: number | null;
  forecastDemand: number | null;
  expectedStockRequirement?: number | null;
  suggestedAdditionalStock: number | null;
  recommendation: string;
  metrics: Metrics;
};
type ChartPoint = { period: string; actual: number | null; forecast: number | null };
type ForecastRun = {
  id: string;
  createdAt: string | null;
  historicalStartDate: string | null;
  historicalEndDate: string | null;
  periodGranularity: string;
  forecastHorizon: number;
  modelType: string;
  forecastedMedicineCount: number;
  metrics: Metrics;
  medicines: ForecastMedicine[];
  chart: Record<string, ChartPoint[]>;
  chartOverall: ChartPoint[];
  results: Array<{ medicineId: string | null; medicineName: string | null; period: string; quantity: number }>;
};
type Preview = { valid: boolean; importId: string | null; rowCount: number; validRows: number; invalidRows: number; errors: Array<{ row: number; messages: string[] }>; errorsTruncated?: boolean; preview: Array<{ date: string; medicine: string; quantity: number; salesAmount?: number }>; columns: Record<string, string> };
type HistoricalImport = { id: string; fileName: string; rowCount: number; createdAt: string | null };

const metricLabel = (value: number | null | undefined, suffix = '') => value == null ? '—' : `${value.toFixed(2)}${suffix}`;
const chartColors = ['#477b62', '#c47c35', '#6382a6', '#a35d73', '#8a7cba', '#55a6a6', '#c05640', '#7b8794'];

type MedicineSalesSlice = { medicineId: string; medicineName: string; quantity: number };
type MonthlySalesPoint = { period: string; actual: number | null; forecast: number | null };

export default function ForecastDashboard() {
  const [runs, setRuns] = useState<ForecastRun[]>([]);
  const [imports, setImports] = useState<HistoricalImport[]>([]);
  const [importId, setImportId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  async function refresh(preferId?: string) {
    setLoading(true);
    try {
      const [response, importResponse] = await Promise.all([
        apiRequest<{ runs: ForecastRun[] }>('/admin/forecasts'),
        apiRequest<{ imports: HistoricalImport[] }>('/admin/forecasts/imports'),
      ]);
      setRuns(response.runs); setImports(importResponse.imports);
      setSelectedRunId((current) => preferId && response.runs.some((run) => run.id === preferId) ? preferId : current && response.runs.some((run) => run.id === current) ? current : response.runs[0]?.id ?? '');
      setImportId((current) => current && importResponse.imports.some((item) => item.id === current) ? current : importResponse.imports[0]?.id ?? '');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load forecast history.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const salesByMedicine = useMemo<MedicineSalesSlice[]>(() => {
    if (!selectedRun) return [];
    return selectedRun.medicines
      .map((medicine) => ({
        medicineId: medicine.medicineId,
        medicineName: medicine.medicineName,
        quantity: (selectedRun.chart?.[medicine.medicineId] ?? []).reduce(
          (total, point) => total + (point.actual ?? 0),
          0,
        ),
      }))
      .filter((medicine) => medicine.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity);
  }, [selectedRun]);
  const totalActualSales = useMemo(
    () => salesByMedicine.reduce((total, medicine) => total + medicine.quantity, 0),
    [salesByMedicine],
  );
  const monthlySales = useMemo<MonthlySalesPoint[]>(() => {
    const months = new Map<string, MonthlySalesPoint>();
    for (const point of selectedRun?.chartOverall ?? []) {
      if (!point.period) continue;
      const month = months.get(point.period) ?? { period: point.period, actual: null, forecast: null };
      if (point.actual != null) month.actual = (month.actual ?? 0) + point.actual;
      if (point.forecast != null) month.forecast = (month.forecast ?? 0) + point.forecast;
      months.set(point.period, month);
    }
    return [...months.values()].sort((a, b) => a.period.localeCompare(b.period));
  }, [selectedRun]);
  const latestRun = runs[0] ?? null;

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setFile(next); setPreview(null); setError(''); setImportId('');
    if (!next) return;
    const data = new FormData(); data.append('file', next);
    setPreviewing(true);
    try {
      const result = await apiRequest<Preview>('/admin/forecasts/preview', { method: 'POST', body: data });
      setPreview(result);
      if (result.valid && result.importId) {
        setError('');
        setImportId(result.importId);
        const list = await apiRequest<{ imports: HistoricalImport[] }>('/admin/forecasts/imports');
        setImports(list.imports);
      }
      if (!result.valid) setError('Fix the invalid rows shown below, then upload the corrected workbook.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to preview this workbook.');
    } finally { setPreviewing(false); }
  }

  async function runForecast() {
    if (file && !preview?.valid) {
      setError(previewing
        ? 'Please wait for workbook validation to finish before running the forecast.'
        : 'This workbook has not passed validation. Correct the listed rows or select a validated historical import.');
      return;
    }
    setRunning(true); setError('');
    try {
      const result = await apiRequest<ForecastRun>('/admin/forecasts/run', {
        method: 'POST', body: JSON.stringify({ horizon: 3, importId: importId || null }),
      });
      setRuns((current) => [result, ...current.filter((run) => run.id !== result.id)]);
      setSelectedRunId(result.id);
      await refresh(result.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to generate the forecast.');
    } finally { setRunning(false); }
  }

  return <AppShell role="admin" title="Admin home" eyebrow="Operations workspace">
    <div className="page-enter space-y-8">
      <div>
        <h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.045em]">Sales forecasting</h2>
      </div>
      {error && <div role="alert" aria-live="assertive" className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}

      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex items-start gap-4"><span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary"><FileSpreadsheet size={18} /></span><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Historical sales import</p><h3 className="mt-2 font-serif text-2xl font-extrabold">Add pre-system sales</h3></div></div>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">Upload .xlsx or .xls with Date, Medicine/Product, and Quantity Sold columns. Sales Amount is optional. Product names must match current inventory names. A validated upload is kept privately by the backend for later forecasts.</p>
        <div className="mt-5 flex flex-wrap items-end gap-4"><label className="grid gap-2 text-xs font-semibold text-muted-foreground">Excel workbook<Input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(event) => void chooseFile(event)} /></label><label className="grid gap-2 text-xs font-semibold text-muted-foreground">Historical sales to include<select className="h-10 min-w-64 rounded-md border border-input bg-background px-3 text-sm text-foreground" value={importId} onChange={(event) => { setImportId(event.target.value); setFile(null); setPreview(null); }}><option value="">Delivered system orders only</option>{imports.map((item) => <option key={item.id} value={item.id}>{item.fileName} · {item.rowCount.toLocaleString()} rows</option>)}</select></label>{previewing && <span className="text-sm text-muted-foreground">Validating workbook…</span>}{file && preview?.valid && <span className="text-sm text-emerald-700">{preview.validRows.toLocaleString()} rows validated · ready for forecast</span>}{!file && importId && <span className="text-sm text-emerald-700">Saved historical workbook selected</span>}</div>
        {preview && <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-3 text-xs"><span className="rounded-md bg-secondary px-3 py-2">Rows: {preview.rowCount}</span><span className="rounded-md bg-secondary px-3 py-2">Valid: {preview.validRows}</span><span className={`rounded-md px-3 py-2 ${preview.invalidRows ? 'bg-destructive/10 text-destructive' : 'bg-emerald-600/10 text-emerald-700'}`}>Invalid: {preview.invalidRows}</span></div>
          {Object.keys(preview.columns).length > 0 && <p className="text-xs text-muted-foreground">Detected: {Object.entries(preview.columns).map(([key, value]) => `${key} → ${value}`).join(' · ')}</p>}
          {!!preview.preview.length && <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border bg-secondary/40"><th className="p-3">Date</th><th className="p-3">Medicine/Product</th><th className="p-3">Quantity sold</th><th className="p-3">Sales amount</th></tr></thead><tbody>{preview.preview.slice(0, 8).map((row, index) => <tr key={`${row.date}-${index}`} className="border-b border-border/60"><td className="p-3">{row.date}</td><td className="p-3">{row.medicine}</td><td className="p-3">{row.quantity}</td><td className="p-3">{row.salesAmount == null ? '—' : row.salesAmount.toFixed(2)}</td></tr>)}</tbody></table></div>}
          {preview.errors.length > 0 && <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4"><p className="text-sm font-semibold text-destructive">Correct these rows before forecasting:</p><ul className="mt-2 space-y-1 text-xs text-destructive">{preview.errors.slice(0, 12).map((issue) => <li key={issue.row}>Row {issue.row}: {issue.messages.join(' ')}</li>)}</ul>{preview.errorsTruncated && <p className="mt-2 text-xs text-destructive">More invalid rows are present.</p>}</div>}
        </div>}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-4"><span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary"><BrainCircuit size={18} /></span><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Linear Regression</p><h3 className="mt-2 font-serif text-2xl font-extrabold">Generate a monthly forecast</h3></div></div><Button type="button" aria-busy={running} disabled={running} onClick={() => void runForecast()}>{running ? 'Calculating…' : 'Run forecast'} <TrendingUp size={16} /></Button></div>
        {(running || previewing) && <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">{running ? 'Forecast request sent. Calculating and saving results…' : 'Validating the selected workbook…'}</p>}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Historical sales</p>
        <h3 className="mt-2 font-serif text-2xl font-extrabold">Most sales per medicine</h3>
        <p className="mt-2 text-sm text-muted-foreground">Share of actual quantity sold across medicines. Forecast quantities are excluded.</p>
        {loading ? <DatabaseLoading className="mt-5" label="Loading historical sales" /> : error ? null : salesByMedicine.length ? <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)] lg:items-center">
          <div className="h-[320px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={salesByMedicine} dataKey="quantity" nameKey="medicineName" cx="50%" cy="50%" outerRadius="78%" paddingAngle={1}>
                  {salesByMedicine.map((medicine, index) => <Cell key={medicine.medicineId} fill={chartColors[index % chartColors.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => `${Number(value).toLocaleString()} units`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {salesByMedicine.map((medicine, index) => {
              const share = totalActualSales ? (medicine.quantity / totalActualSales) * 100 : 0;
              return <li key={medicine.medicineId} className="flex items-center justify-between gap-3 rounded-lg bg-secondary/40 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2"><span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: chartColors[index % chartColors.length] }} /><span className="truncate">{medicine.medicineName}</span></span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">{share.toFixed(1)}% · {medicine.quantity.toLocaleString()}</span>
              </li>;
            })}
          </ul>
        </div> : <div className="mt-5 flex h-64 items-center justify-center rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground">Sales per medicine will appear after a forecast is run with historical or completed-order data.</div>}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Monthly totals</p>
        <h3 className="mt-2 font-serif text-2xl font-extrabold">Overall monthly sales</h3>
        <p className="mt-2 text-sm text-muted-foreground">Total quantity sold each month, with the Linear Regression forecast shown after the historical period.</p>
        <div className="mt-5 h-[340px] w-full">
          {loading ? <DatabaseLoading label="Loading monthly sales" /> : error ? null : monthlySales.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={monthlySales} margin={{ top: 8, right: 18, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} label={{ value: 'Month', position: 'insideBottom', offset: -4, fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} label={{ value: 'Total sales quantity', angle: -90, position: 'insideLeft', fontSize: 12 }} />
            <Tooltip formatter={(value) => `${Number(value).toLocaleString()} units`} />
            <Legend />
            <Line type="monotone" dataKey="actual" name="Actual Sales" stroke="#477b62" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
            <Line type="monotone" dataKey="forecast" name="Forecasted Sales" stroke="#c47c35" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls />
          </LineChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground">Monthly actual and forecasted sales will appear after a forecast is run.</div>}
        </div>
      </section>

      {selectedRun && <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary"><AlertTriangle size={18} /></span><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Inventory planning</p><h3 className="mt-2 font-serif text-2xl font-extrabold">Restock recommendations</h3></div></div>
          <p className="mt-3 text-xs text-muted-foreground">Expected requirement is the sum of the forecast across the selected horizon, rounded up to whole units. Suggested additional stock is max(0, requirement − current stock); no safety buffer is added.</p>
          <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><th className="pb-3 pr-4">Medicine</th><th className="pb-3 pr-4">Current stock</th><th className="pb-3 pr-4">Forecast demand</th><th className="pb-3 pr-4">Expected requirement</th><th className="pb-3 pr-4">Suggested additional</th><th className="pb-3">Recommendation</th></tr></thead><tbody>{selectedRun.medicines.map((medicine) => <tr key={medicine.medicineId} className="border-b border-border/60"><td className="py-3 pr-4 font-semibold">{medicine.medicineName}{medicine.inInventory === false && <span className="mt-1 block text-xs font-normal text-muted-foreground">Not currently in inventory</span>}</td><td className="py-3 pr-4">{medicine.inInventory === false ? 'Not currently in inventory' : medicine.currentStock ?? '—'}</td><td className="py-3 pr-4">{medicine.forecastDemand == null ? '—' : medicine.forecastDemand}</td><td className="py-3 pr-4">{medicine.expectedStockRequirement == null ? '—' : medicine.expectedStockRequirement}</td><td className="py-3 pr-4">{medicine.suggestedAdditionalStock == null ? '—' : medicine.suggestedAdditionalStock}</td><td className="py-3"><span className="font-medium">{medicine.recommendation}</span>{medicine.reason && <span className="mt-1 block max-w-64 text-xs text-muted-foreground">{medicine.reason}</span>}</td></tr>)}</tbody></table></div>
        </section>}

      {!selectedRun && <section className="rounded-2xl border border-dashed border-border p-10 text-center">{loading ? <DatabaseLoading label="Loading forecast history" /> : error ? null : <><p className="font-serif text-xl font-bold">No forecast run yet.</p><p className="mt-2 text-sm text-muted-foreground">Forecasts require at least four monthly observations for one medicine, using delivered system orders, an uploaded workbook, or both.</p></>}</section>}

      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8"><div className="flex items-center justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Forecast history</p><h3 className="mt-2 font-serif text-2xl font-extrabold">Previous runs</h3></div><Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</Button></div>{loading ? <DatabaseLoading className="mt-5" label="Loading saved forecasts" /> : error ? null : runs.length === 0 ? <p className="mt-5 text-center text-sm text-muted-foreground">No saved forecast executions.</p> : <div className="mt-5 space-y-2">{runs.map((run) => <button key={run.id} onClick={() => setSelectedRunId(run.id)} className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-left ${run.id === selectedRunId ? 'border-primary bg-secondary/50' : 'border-border hover:bg-secondary/30'}`}><span><span className="block text-sm font-semibold">{formatDate(run.createdAt)}</span><span className="mt-1 block text-xs text-muted-foreground">{run.historicalStartDate ?? '—'} to {run.historicalEndDate ?? '—'} · {run.forecastHorizon} month horizon · {run.forecastedMedicineCount} medicines</span></span><span className="text-xs text-muted-foreground">MAE {metricLabel(run.metrics?.mae)} · MAPE {metricLabel(run.metrics?.mape, '%')} · RMSE {metricLabel(run.metrics?.rmse)}</span></button>)}</div>}{!loading && !error && runs.some((run) => !run.metrics) && <p className="mt-3 text-xs text-muted-foreground">Metrics are available for runs created by this implementation. Earlier database runs have no stored evaluation metrics.</p>}</section>
      {latestRun && <p className="text-xs text-muted-foreground">The current dashboard is showing {selectedRunId === latestRun.id ? 'the latest saved run' : 'a previous saved run'}.</p>}
    </div>
  </AppShell>;
}
