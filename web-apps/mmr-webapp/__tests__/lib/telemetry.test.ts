/**
 * lib/telemetry.ts — the dependency-free App Insights reporter.
 *
 * What must hold: it is a silent no-op when unconfigured, it can never throw
 * into a caller's catch block, it targets the region endpoint from the
 * connection string (not the global default), and the envelope shape is the one
 * the ingestion API accepts — that shape was verified live against
 * mmr-appinsights, so these tests are the regression guard for it.
 */

const ORIGINAL = { ...process.env }
const CS =
  'InstrumentationKey=cb1630a1-0000-0000-0000-000000000000;' +
  'IngestionEndpoint=https://swedencentral-0.in.applicationinsights.azure.com/;' +
  'LiveEndpoint=https://swedencentral.livediagnostics.monitor.azure.com/'

let fetchMock: jest.Mock

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ status: 200, text: async () => '{}' })
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  process.env = { ...ORIGINAL }
  jest.resetModules()
})

async function load(cs?: string) {
  jest.resetModules()
  if (cs === undefined) delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  else process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = cs
  const mod = await import('@/lib/telemetry')
  mod.__resetTelemetryForTests()
  return mod
}

const envelopeOf = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body)

describe('telemetryEnabled', () => {
  it('is false with no connection string', async () => {
    expect((await load()).telemetryEnabled()).toBe(false)
  })

  it('is false for a blank or key-less connection string', async () => {
    expect((await load('   ')).telemetryEnabled()).toBe(false)
    expect((await load('IngestionEndpoint=https://x/')).telemetryEnabled()).toBe(false)
  })

  it('is true for a real connection string', async () => {
    expect((await load(CS)).telemetryEnabled()).toBe(true)
  })
})

describe('when telemetry is disabled', () => {
  it('sends nothing and still resolves', async () => {
    const { trackException, trackTrace, trackDependency } = await load()
    await expect(trackException(new Error('boom'))).resolves.toBeUndefined()
    await expect(trackTrace('hi')).resolves.toBeUndefined()
    await expect(trackDependency({ name: 'q', type: 'mysql', durationMs: 5, success: true }))
      .resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('trackException', () => {
  it('posts an ExceptionData envelope to the region endpoint', async () => {
    const { trackException } = await load(CS)
    await trackException(new Error('kaboom'), { source: 'unit' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    // must use the endpoint from the connection string, not dc.services...
    expect(url).toBe('https://swedencentral-0.in.applicationinsights.azure.com/v2/track')
    expect((init as { method: string }).method).toBe('POST')

    const e = envelopeOf(fetchMock.mock.calls[0])
    expect(e.name).toBe('Microsoft.ApplicationInsights.Exception')
    expect(e.iKey).toBe('cb1630a1-0000-0000-0000-000000000000')
    expect(e.tags['ai.cloud.role']).toBe('mmr-webapp')
    expect(e.data.baseType).toBe('ExceptionData')
    expect(e.data.baseData.exceptions[0]).toMatchObject({ typeName: 'Error', message: 'kaboom' })
    expect(e.data.baseData.properties).toEqual({ source: 'unit' })
  })

  it('coerces a non-Error value rather than failing', async () => {
    const { trackException } = await load(CS)
    await trackException('just a string')
    const e = envelopeOf(fetchMock.mock.calls[0])
    expect(e.data.baseData.exceptions[0].message).toBe('just a string')
  })

  it('resolves even when the POST rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { trackException } = await load(CS)
    await expect(trackException(new Error('boom'))).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe('trackTrace', () => {
  it('posts a MessageData envelope', async () => {
    const { trackTrace } = await load(CS)
    await trackTrace('hello world', { source: 'unit' }, 2)
    const e = envelopeOf(fetchMock.mock.calls[0])
    expect(e.name).toBe('Microsoft.ApplicationInsights.Message')
    expect(e.data.baseType).toBe('MessageData')
    expect(e.data.baseData).toMatchObject({ message: 'hello world', severityLevel: 2 })
  })
})

describe('trackDependency', () => {
  it('formats duration as the documented hh:mm:ss.fff form', async () => {
    const { trackDependency } = await load(CS)
    await trackDependency({ name: 'members lookup', type: 'mysql', durationMs: 233, success: true })
    const e = envelopeOf(fetchMock.mock.calls[0])
    expect(e.data.baseType).toBe('RemoteDependencyData')
    expect(e.data.baseData.duration).toBe('00:00:00.233')
    expect(e.data.baseData.success).toBe(true)
    expect(e.data.baseData.resultCode).toBe('0')
  })

  it('carries seconds and minutes correctly', async () => {
    const { trackDependency } = await load(CS)
    await trackDependency({ name: 'slow query', type: 'mysql', durationMs: 65_432, success: false })
    const e = envelopeOf(fetchMock.mock.calls[0])
    expect(e.data.baseData.duration).toBe('00:01:05.432')
    expect(e.data.baseData.resultCode).toBe('1')
  })
})
