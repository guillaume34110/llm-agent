import React from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import MermaidDiagram from './MermaidDiagram';

// Strict allow-list — no HTML, no arbitrary props, no styles.
type RichSpec =
  | { type: 'chart'; kind?: 'line' | 'bar' | 'area'; title?: string; description?: string;
      data: Array<Record<string, unknown>>; xKey: string;
      series: Array<{ key: string; label?: string; color?: string }>; yUnit?: string }
  | { type: 'card'; title?: string; description?: string; children?: RichSpec[] }
  | { type: 'alert'; variant?: 'default' | 'destructive'; title?: string; description?: string }
  | { type: 'table'; columns: Array<{ key: string; label?: string }>;
      rows: Array<Record<string, unknown>>; caption?: string }
  | { type: 'diagram'; engine?: 'mermaid'; source: string; title?: string; description?: string }
  | { type: 'ascii'; content: string; title?: string; description?: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validate(spec: unknown): RichSpec | null {
  if (!isObj(spec)) return null;
  let t = spec.type;
  // Accept common aliases the model occasionally emits.
  if (t === 'graph' || t === 'linechart' || t === 'barchart' || t === 'areachart') {
    if (t !== 'graph') {
      const k = String(t).replace('chart', '');
      if (!spec.kind) (spec as any).kind = k;
    }
    (spec as any).type = 'chart';
    t = 'chart';
  }
  if (t === 'chart') {
    if (!Array.isArray(spec.data) || typeof spec.xKey !== 'string') return null;
    if (!Array.isArray(spec.series) || spec.series.length === 0) return null;
    for (const s of spec.series) {
      if (!isObj(s) || typeof s.key !== 'string') return null;
    }
    return spec as RichSpec;
  }
  if (t === 'card') {
    if (spec.children && !Array.isArray(spec.children)) return null;
    return spec as RichSpec;
  }
  if (t === 'alert') return spec as RichSpec;
  if (t === 'table') {
    if (!Array.isArray(spec.columns) || !Array.isArray(spec.rows)) return null;
    return spec as RichSpec;
  }
  if (t === 'diagram') {
    if (typeof spec.source !== 'string' || !spec.source.trim()) return null;
    if (spec.engine && spec.engine !== 'mermaid') return null;
    return spec as RichSpec;
  }
  if (t === 'ascii') {
    if (typeof spec.content !== 'string' || !spec.content.trim()) return null;
    return spec as RichSpec;
  }
  return null;
}

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

function RichChart({ spec }: { spec: Extract<RichSpec, { type: 'chart' }> }) {
  const kind = spec.kind || 'line';
  const config: ChartConfig = {};
  spec.series.forEach((s, i) => {
    config[s.key] = { label: s.label || s.key, color: s.color || PALETTE[i % PALETTE.length] };
  });
  const ChartTag = kind === 'bar' ? BarChart : kind === 'area' ? AreaChart : LineChart;
  return (
    <div className="w-full my-[8px]">
      {(spec.title || spec.description) && (
        <div className="mb-[8px]">
          {spec.title && <div className="text-[13px] font-bold text-[var(--text)]">{spec.title}</div>}
          {spec.description && <div className="text-[11.5px] text-[var(--text-muted)]">{spec.description}</div>}
        </div>
      )}
      <ChartContainer config={config} className="!aspect-auto w-full !justify-stretch" style={{ height: 260 }}>
        <ChartTag data={spec.data} margin={{ top: 8, right: 20, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey={spec.xKey} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} padding={{ left: 8, right: 8 }} />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={40}
                 tickFormatter={v => spec.yUnit ? `${v}${spec.yUnit}` : String(v)} domain={['auto', 'auto']} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {spec.series.map((s, i) => {
            const color = s.color || PALETTE[i % PALETTE.length];
            if (kind === 'bar') return <Bar key={s.key} dataKey={s.key} fill={color} radius={4} />;
            if (kind === 'area') return <Area key={s.key} dataKey={s.key} type="monotone" stroke={color} fill={color} fillOpacity={0.25} strokeWidth={2} />;
            return <Line key={s.key} dataKey={s.key} type="monotone" stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} />;
          })}
        </ChartTag>
      </ChartContainer>
    </div>
  );
}

function RichTable({ spec }: { spec: Extract<RichSpec, { type: 'table' }> }) {
  return (
    <div className="my-[8px] overflow-x-auto">
      <Table>
        {spec.caption && <caption className="caption-top text-[12px] text-[var(--text-muted)] py-[4px]">{spec.caption}</caption>}
        <TableHeader>
          <TableRow>
            {spec.columns.map(c => <TableHead key={c.key}>{c.label || c.key}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {spec.rows.map((row, i) => (
            <TableRow key={i}>
              {spec.columns.map(c => <TableCell key={c.key}>{String(row[c.key] ?? '')}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RichAlert({ spec }: { spec: Extract<RichSpec, { type: 'alert' }> }) {
  return (
    <Alert variant={spec.variant === 'destructive' ? 'destructive' : 'default'} className="my-[8px]">
      {spec.title && <AlertTitle>{spec.title}</AlertTitle>}
      {spec.description && <AlertDescription>{spec.description}</AlertDescription>}
    </Alert>
  );
}

function RichCard({ spec }: { spec: Extract<RichSpec, { type: 'card' }> }) {
  return (
    <Card className="my-[8px]">
      {(spec.title || spec.description) && (
        <CardHeader>
          {spec.title && <CardTitle>{spec.title}</CardTitle>}
          {spec.description && <CardDescription>{spec.description}</CardDescription>}
        </CardHeader>
      )}
      {spec.children && spec.children.length > 0 && (
        <CardContent>
          {spec.children.map((c, i) => <RichBlock key={i} spec={c} />)}
        </CardContent>
      )}
    </Card>
  );
}

function RichDiagram({ spec }: { spec: Extract<RichSpec, { type: 'diagram' }> }) {
  return (
    <div className="my-[8px]">
      {(spec.title || spec.description) && (
        <div className="mb-[6px]">
          {spec.title && <div className="text-[13px] font-bold text-[var(--text)]">{spec.title}</div>}
          {spec.description && <div className="text-[11.5px] text-[var(--text-muted)]">{spec.description}</div>}
        </div>
      )}
      <MermaidDiagram source={spec.source} />
    </div>
  );
}

function RichAscii({ spec }: { spec: Extract<RichSpec, { type: 'ascii' }> }) {
  return (
    <div className="my-[8px]">
      {(spec.title || spec.description) && (
        <div className="mb-[6px]">
          {spec.title && <div className="text-[13px] font-bold text-[var(--text)]">{spec.title}</div>}
          {spec.description && <div className="text-[11.5px] text-[var(--text-muted)]">{spec.description}</div>}
        </div>
      )}
      <pre className="bg-[var(--bg2)] border border-[var(--border)] rounded-[10px] p-[14px] m-0 overflow-x-auto font-[JetBrains_Mono,Fira_Code,SF_Mono,Menlo,Consolas,monospace] text-[12.5px] leading-[1.35] text-[var(--text)] whitespace-pre" style={{ tabSize: 2 }}>{spec.content}</pre>
    </div>
  );
}

function RichBlock({ spec }: { spec: RichSpec }) {
  switch (spec.type) {
    case 'chart':     return <RichChart spec={spec} />;
    case 'card':      return <RichCard spec={spec} />;
    case 'alert':     return <RichAlert spec={spec} />;
    case 'table':     return <RichTable spec={spec} />;
    case 'diagram':   return <RichDiagram spec={spec} />;
    case 'ascii':     return <RichAscii spec={spec} />;
  }
}

export function RichBlockFromCode({ raw }: { raw: string }) {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    return <pre className="bg-[var(--bg2)] p-[8px] rounded-[6px] text-[11px] text-[var(--red)]">rich/invalid: JSON parse error</pre>;
  }
  const spec = validate(parsed);
  if (!spec) {
    return <pre className="bg-[var(--bg2)] p-[8px] rounded-[6px] text-[11px] text-[var(--red)]">rich/invalid: schema mismatch</pre>;
  }
  return <RichBlock spec={spec} />;
}

export default RichBlockFromCode;
