import { Logger } from '@nestjs/common';

const log = new Logger('Tracing');

let started = false;
let _trace: any = null;

export async function bootstrapTracing(): Promise<void> {
  if (started) return;
  started = true;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && !process.env.OTEL_ENABLED) {
    log.log('OpenTelemetry disabled (set OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_ENABLED=true)');
    return;
  }
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME || 'progsoft-server',
      traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      }),
      instrumentations: [getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      })],
    });
    sdk.start();
    log.log(`OpenTelemetry started → ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'console'}`);
    process.on('SIGTERM', () => sdk.shutdown().catch(() => {}));
  } catch (e: any) {
    log.warn(`OTEL bootstrap failed: ${e?.message ?? e}`);
  }
}

export function getTracer() {
  if (_trace) return _trace;
  try {
    const api = require('@opentelemetry/api');
    _trace = api.trace.getTracer('progsoft-server', '1.0.0');
  } catch {
    _trace = null;
  }
  return _trace;
}

export async function withSpan<T>(name: string, attrs: Record<string, any>, fn: () => Promise<T>): Promise<T> {
  const tracer = getTracer();
  if (!tracer) return fn();
  return await tracer.startActiveSpan(name, { attributes: attrs }, async (span: any) => {
    try {
      const r = await fn();
      span.setStatus({ code: 1 });
      return r;
    } catch (e: any) {
      span.recordException?.(e);
      span.setStatus({ code: 2, message: e?.message ?? String(e) });
      throw e;
    } finally {
      span.end();
    }
  });
}
