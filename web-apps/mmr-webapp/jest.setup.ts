import '@testing-library/jest-dom'

// jsdom doesn't provide TextEncoder/TextDecoder — pull them from Node
// (needed by middleware.ts, which encodes the JWT secret at module load)
import { TextEncoder, TextDecoder } from 'util'
global.TextEncoder ??= TextEncoder
// @ts-expect-error Node's TextDecoder type differs slightly from the DOM's
global.TextDecoder ??= TextDecoder
