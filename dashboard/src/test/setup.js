import '@testing-library/jest-dom'

// jsdom has no canvas: the decorative background draws nothing in tests
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = () => null
}

// the accounts use the browser's crypto; make sure it exists under test as well
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}
