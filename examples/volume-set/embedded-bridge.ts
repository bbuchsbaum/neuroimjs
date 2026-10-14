import type { SpaceState, SpaceStatus } from '../../src/space/types';

let onState: ((state: SpaceState, source: 'user' | 'api') => void) | null = null;
let onStatus: ((status: SpaceStatus, message?: string) => void) | null = null;

export function installEmbeddedBridge(handlers: { state(state: SpaceState, source: 'user' | 'api'): void; status(status: SpaceStatus, message?: string): void }): void {
  onState = handlers.state;
  onStatus = handlers.status;
}

export function emitEmbeddedState(state: SpaceState, source: 'user' | 'api'): void {
  onState?.(state, source);
}

export function emitEmbeddedStatus(status: SpaceStatus, message?: string): void {
  onStatus?.(status, message);
}
