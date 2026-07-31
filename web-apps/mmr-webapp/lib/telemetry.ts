// ============================================================
// lib/telemetry.ts — Application Insights reporting, dependency-free
//
// Until 07-31 the SWA had APPLICATIONINSIGHTS_CONNECTION_STRING set and an
// `mmr-appinsights` resource, but nothing ever called it — `requests`,
// `exceptions` and `traces` were all empty, so there were NO server-side logs
// for the webapp. The 07-30 login investigation had to be done entirely by
// black-box probing because of that.
//
// WHY NOT THE `applicationinsights` SDK: it was tried first and rejected.
// v3 pulls @azure/monitor-opentelemetry → @opentelemetry/sdk-node →
// @grpc/grpc-js, which needs the Node builtins net/tls/fs/stream/zlib. Next
// compiles instrumentation.ts for the EDGE runtime as well, where those do not
// exist, so `npm run build` failed with "Can't resolve 'net'". Externalising
// the whole transitive tree is brittle, and the SDK is a heavy import for an
// app whose cold start on Azure SWA is already ~19s.
//
// So this posts envelopes straight to the ingestion REST API instead:
//   - zero dependencies, just fetch
//   - works in the Node AND edge runtimes
//   - nothing for webpack to bundle, no cold-start cost
//
// TRADE-OFF, worth knowing: we lose the SDK's automatic instrumentation, so
// there is no free `requests`/`dependencies` telemetry — notably no MySQL
// timings. What we gain is that server-side exceptions become visible at all.
// Call trackDependency() explicitly if a specific query needs timing.
// ============================================================

interface Parsed {
  iKey: string
  endpoint: string
}

let parsed: Parsed | null | undefined

/** Parse the connection string once. Returns null when telemetry is off. */
function config(): Parsed | null {
  if (parsed !== undefined) return parsed

  const cs = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim()
  if (!cs) return (parsed = null)

  const parts = new Map(
    cs.split(';').filter(Boolean).map(p => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()] as const
    })
  )
  const iKey = parts.get('instrumentationkey')
  if (!iKey) return (parsed = null)

  // IngestionEndpoint is region-specific and always present on modern strings;
  // the global default is only a fallback for very old ones.
  const raw = parts.get('ingestionendpoint') ?? 'https://dc.services.visualstudio.com/'
  const endpoint = raw.endsWith('/') ? raw : `${raw}/`
  return (parsed = { iKey, endpoint: `${endpoint}v2/track` })
}

/** True when telemetry is configured. Safe in every runtime. */
export function telemetryEnabled(): boolean {
  return config() !== null
}

/** Reset the cached parse. Test-only. */
export function __resetTelemetryForTests(): void {
  parsed = undefined
}

const ROLE = 'mmr-webapp'

function tags() {
  return {
    'ai.cloud.role': ROLE,
    'ai.application.ver': process.env.NEXT_PUBLIC_BUILD_SHA ?? 'local',
    'ai.internal.sdkVersion': 'mmr-fetch:1',
  }
}

/**
 * POST one envelope. Never throws and never rejects — observability must not be
 * able to break a request path. Failures log once to the console and stop there.
 */
async function send(name: string, baseType: string, baseData: unknown): Promise<void> {
  const cfg = config()
  if (!cfg) return
  try {
    await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-json-stream' },
      body: JSON.stringify({
        name: `Microsoft.ApplicationInsights.${name}`,
        time: new Date().toISOString(),
        iKey: cfg.iKey,
        tags: tags(),
        data: { baseType, baseData },
      }),
      // Never let telemetry hold a response open. Feature-detected because
      // AbortSignal.timeout is absent in some runtimes (notably jsdom under
      // jest) and referencing it unguarded threw before fetch was even called,
      // silently dropping every item.
      ...(typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? { signal: AbortSignal.timeout(3000) }
        : {}),
    })
  } catch (err) {
    console.error('[telemetry] send failed:', err instanceof Error ? err.message : err)
  }
}

/** Stack frames in the shape App Insights expects. */
function parsedStack(err: Error) {
  const lines = (err.stack ?? '').split('\n').slice(1, 26)
  return lines.map((line, i) => ({
    level: i,
    method: line.trim().replace(/^at\s+/, '').slice(0, 300) || 'unknown',
    assembly: '',
    fileName: '',
    line: 0,
  }))
}

/**
 * Report a server-side error.
 *
 * Deliberately fire-and-forget friendly: it resolves rather than rejects, so a
 * caller in a catch block needs no second try/catch.
 */
export async function trackException(
  err: unknown,
  properties: Record<string, string> = {}
): Promise<void> {
  const error = err instanceof Error ? err : new Error(String(err))
  await send('Exception', 'ExceptionData', {
    ver: 2,
    exceptions: [{
      id: 1,
      outerId: 0,
      typeName: error.name || 'Error',
      message: (error.message || 'unknown error').slice(0, 32768),
      hasFullStack: Boolean(error.stack),
      parsedStack: parsedStack(error),
    }],
    severityLevel: 3, // Error
    properties,
  })
}

/** Report a diagnostic message. Same no-throw guarantee as trackException. */
export async function trackTrace(
  message: string,
  properties: Record<string, string> = {},
  severityLevel = 1 // Information
): Promise<void> {
  await send('Message', 'MessageData', {
    ver: 2,
    message: message.slice(0, 32768),
    severityLevel,
    properties,
  })
}

/**
 * Report an outbound call (a MySQL query, an HTTP request) with its duration.
 * The SDK would collect these automatically; without it they are opt-in, so use
 * this on paths where latency has actually bitten us.
 */
export async function trackDependency(opts: {
  name: string
  type: string
  durationMs: number
  success: boolean
  data?: string
  properties?: Record<string, string>
}): Promise<void> {
  // "hh:mm:ss.fff" — the documented canonical form. (A leading days group,
  // "00:00:00:00.233", also parses correctly; it was verified against
  // mmr-appinsights. We use the three-group form because it is unambiguous.)
  //
  // ⚠️ Ingestion latency is ~2-4 minutes. During development that repeatedly
  // looked like items being dropped when they were merely in flight — do not
  // conclude telemetry is broken until you have waited several minutes.
  const ms = Math.max(0, Math.round(opts.durationMs))
  const hh = String(Math.floor(ms / 3_600_000)).padStart(2, '0')
  const mm = String(Math.floor(ms / 60_000) % 60).padStart(2, '0')
  const ss = String(Math.floor(ms / 1000) % 60).padStart(2, '0')
  const ff = String(ms % 1000).padStart(3, '0')
  await send('RemoteDependency', 'RemoteDependencyData', {
    ver: 2,
    name: opts.name.slice(0, 1024),
    id: `${Date.now()}-${opts.name.slice(0, 32)}`,
    resultCode: opts.success ? '0' : '1',
    duration: `${hh}:${mm}:${ss}.${ff}`,
    success: opts.success,
    type: opts.type,
    data: (opts.data ?? '').slice(0, 8192),
    properties: opts.properties ?? {},
  })
}
