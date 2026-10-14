import { ValueError } from '../errors';
import {
  SPACE_PACKAGE_VERSION,
  SPACE_PROTOCOL_VERSION,
  type SpaceFrameMessage,
  type SpaceHelloMessage,
  type SpaceHostMessage,
} from './protocol';
import type {
  MountSpaceOptions,
  SpaceDataset,
  SpaceErrorEvent,
  SpaceEventMap,
  SpaceHandle,
  SpaceState,
  SpaceStatePatch,
  SpaceStatus,
  SpaceStatusChangeEvent,
} from './types';
import { copyState, copyStatePatch, validateAndCopySpaceDataset } from './validation';

const DEFAULT_TIMEOUT_MS = 15_000;

interface PendingRequest {
  readonly resolve: (state: SpaceState) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface FrameGeneration {
  readonly revision: number;
  readonly iframe: HTMLIFrameElement;
  readonly ready: Promise<void>;
  readonly resolveReady: () => void;
  readonly rejectReady: (error: Error) => void;
  readonly pending: Map<number, PendingRequest>;
  data?: SpaceDataset;
  initialState?: SpaceStatePatch;
  timeout?: ReturnType<typeof setTimeout>;
  port?: MessagePort;
  initialized: boolean;
  disposed: boolean;
  settled: boolean;
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function errorFromFrame(error: { name: string; message: string }): Error {
  const result = new Error(error.message);
  result.name = error.name || 'Error';
  return result;
}

function defaultState(dataset: SpaceDataset, patch?: SpaceStatePatch): SpaceState {
  const member = dataset.members[0];
  return {
    version: 1,
    mode: 'space',
    model: member.model,
    contrast: member.contrast,
    statistic: member.t ? 't' : 'beta',
    selectedMemberId: null,
    worldCoord: null,
    orientation: 'axial',
    threshold: 0,
    range: 1,
    ...copyStatePatch(patch ?? {}),
  };
}

function isState(value: unknown): value is SpaceState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  const coord = state.worldCoord;
  return state.version === 1 && ['space', 'montage', 'facet', 'ortho'].includes(state.mode as string)
    && typeof state.model === 'string' && typeof state.contrast === 'string'
    && (state.statistic === 't' || state.statistic === 'beta')
    && (state.selectedMemberId === null || typeof state.selectedMemberId === 'string')
    && (coord === null || (Array.isArray(coord) && coord.length === 3 && coord.every(Number.isFinite)))
    && ['axial', 'coronal', 'sagittal'].includes(state.orientation as string)
    && typeof state.threshold === 'number' && Number.isFinite(state.threshold)
    && typeof state.range === 'number' && Number.isFinite(state.range);
}

function isStatus(value: unknown): value is SpaceStatus {
  return value === 'loading' || value === 'ready' || value === 'fitting' || value === 'error';
}

function isFrameMessage(value: unknown): value is SpaceFrameMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'ready') return isState(message.state) && isStatus(message.status);
  if (message.type === 'result') return Number.isSafeInteger(message.requestId) && isState(message.state);
  if (message.type === 'failure') return (message.requestId === undefined || Number.isSafeInteger(message.requestId))
    && !!message.error && typeof message.error === 'object'
    && typeof (message.error as Record<string, unknown>).name === 'string'
    && typeof (message.error as Record<string, unknown>).message === 'string';
  if (message.type !== 'event') return false;
  if (message.event === 'statechange') return isState(message.state) && (message.source === 'user' || message.source === 'api');
  return message.event === 'statuschange' && isStatus(message.status) && (message.message === undefined || typeof message.message === 'string');
}

/**
 * Mount the supported, same-origin Space application. Advanced frame controls
 * are intentionally absent from SpaceState snapshots and remain frame-local.
 */
export function mountSpace(container: HTMLElement, options: MountSpaceOptions): SpaceHandle {
  if (typeof HTMLElement === 'undefined' || !(container instanceof HTMLElement)) throw new ValueError('container must be an HTMLElement', { code: 'INVALID_ARGUMENT' });
  if (typeof window === 'undefined' || typeof MessageChannel === 'undefined') {
    throw new ValueError('mountSpace requires a browser MessageChannel environment', { code: 'INVALID_ARGUMENT' });
  }
  const base = new URL(options.assetBaseUrl, window.location.href);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new ValueError('assetBaseUrl must use HTTP(S)', { code: 'INVALID_ARGUMENT' });
  if (base.origin !== window.location.origin) throw new ValueError('assetBaseUrl must be same-origin', { code: 'INVALID_ARGUMENT' });
  const baseUrl = base.href.endsWith('/') ? base : new URL(`${base.href}/`);
  const frameUrl = new URL('index.html?embedded=1', baseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ValueError('timeoutMs must be positive and finite', { code: 'INVALID_ARGUMENT' });

  let disposed = false;
  let active: FrameGeneration | undefined;
  let candidate: FrameGeneration | undefined;
  let nextRevision = 0;
  let nextRequestId = 1;
  let currentState: SpaceState;
  const handlers: { [K in keyof SpaceEventMap]: Set<(event: SpaceEventMap[K]) => void> } = {
    statechange: new Set(), statuschange: new Set(), error: new Set(),
  };

  const emit = <K extends keyof SpaceEventMap>(event: K, value: SpaceEventMap[K]): void => {
    for (const handler of handlers[event]) {
      const snapshot = event === 'statechange'
        ? { ...value, state: copyState((value as SpaceEventMap['statechange']).state) }
        : event === 'error'
          ? (() => {
              const source = (value as SpaceEventMap['error']).error;
              const error = new Error(source.message);
              error.name = source.name;
              return { ...value, error };
            })()
        : { ...value };
      try { (handler as (event: typeof snapshot) => void)(snapshot); } catch { /* observers cannot break lifecycle */ }
    }
  };
  const emitStatus = (generation: FrameGeneration, status: SpaceStatus, message?: string): void => {
    const event: SpaceStatusChangeEvent = { revision: generation.revision, status, ...(message && { message }) };
    emit('statuschange', event);
  };
  const emitError = (generation: FrameGeneration, error: Error): void => {
    const event: SpaceErrorEvent = { revision: generation.revision, error };
    emit('error', event);
  };
  const rejectGeneration = (generation: FrameGeneration, error: Error): void => {
    if (generation.disposed) return;
    generation.disposed = true;
    if (generation.timeout) clearTimeout(generation.timeout);
    generation.port?.close();
    generation.iframe.remove();
    if (!generation.settled) { generation.settled = true; generation.rejectReady(error); }
    for (const pending of generation.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    generation.pending.clear();
    generation.data = undefined; generation.initialState = undefined;
  };
  const post = (generation: FrameGeneration, message: SpaceHostMessage): void => {
    if (generation.disposed || !generation.port) throw abortError('Space frame is unavailable');
    generation.port.postMessage(message);
  };
  const request = (
    generation: FrameGeneration,
    message: { readonly type: 'setState'; readonly patch: SpaceStatePatch } | { readonly type: 'getState' },
  ): Promise<SpaceState> => {
    const requestId = nextRequestId++;
    return new Promise<SpaceState>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = generation.pending.get(requestId);
        if (!pending) return;
        generation.pending.delete(requestId);
        pending.reject(new Error(`Space request ${requestId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      generation.pending.set(requestId, { resolve, reject, timeout });
      try {
        post(generation, { ...message, requestId } as SpaceHostMessage);
      } catch (error) {
        generation.pending.delete(requestId);
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const start = (data: SpaceDataset, initialState?: SpaceStatePatch): FrameGeneration => {
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const iframe = document.createElement('iframe');
    iframe.src = frameUrl.href;
    iframe.setAttribute('title', 'Space');
    iframe.setAttribute('data-space-revision', String(++nextRevision));
    iframe.style.border = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    const generation: FrameGeneration = {
      revision: nextRevision, iframe, ready, resolveReady, rejectReady, pending: new Map(), data, initialState, initialized: false, disposed: false, settled: false,
    };
    generation.timeout = setTimeout(() => {
      const error = new Error(`Space frame did not become ready within ${timeoutMs}ms`);
      rejectGeneration(generation, error);
      emitStatus(generation, 'error', error.message);
      emitError(generation, error);
    }, timeoutMs);
    // A hidden candidate loads beside the active frame, so failed replacements
    // never interrupt the currently usable application.
    if (active) iframe.hidden = true;
    container.append(iframe);
    return generation;
  };

  const activate = (generation: FrameGeneration): void => {
    if (generation !== candidate && generation !== active) return;
    if (generation === active) return;
    const old = active;
    active = generation;
    candidate = undefined;
    generation.iframe.hidden = false;
    if (old && old !== generation) {
      try { post(old, { type: 'dispose' }); } catch { /* old channel is already unusable */ }
      rejectGeneration(old, abortError('Space frame was superseded'));
    }
  };

  const onWindowMessage = (event: MessageEvent<unknown>): void => {
    const generation = [active, candidate].find(value => value?.iframe.contentWindow === event.source);
    if (!generation || generation.disposed || event.origin !== base.origin) return;
    const hello = event.data as Partial<SpaceHelloMessage>;
    if (hello?.type !== 'space:hello') return;
    if (hello.protocol !== SPACE_PROTOCOL_VERSION || hello.version !== SPACE_PACKAGE_VERSION) {
      const error = new Error(`Unsupported Space frame protocol ${String(hello.protocol)} / version ${String(hello.version)}`);
      rejectGeneration(generation, error); emitStatus(generation, 'error', error.message); emitError(generation, error); return;
    }
    if (generation.port || generation.initialized) return;
    const channel = new MessageChannel();
    generation.port = channel.port1;
    channel.port1.onmessage = message => onPortMessage(generation, message.data);
    (event.source as WindowProxy).postMessage(
      { type: 'space:connect', protocol: SPACE_PROTOCOL_VERSION, version: SPACE_PACKAGE_VERSION },
      base.origin,
      [channel.port2]
    );
    generation.initialized = true;
    const data = generation.data;
    if (!data) return;
    post(generation, { type: 'initialize', data, initialState: generation.initialState });
    generation.data = undefined;
    generation.initialState = undefined;
  };

  let initialData = validateAndCopySpaceDataset(options.data);
  let initialPatch = copyStatePatch(options.initialState ?? {});
  currentState = defaultState(initialData, initialPatch);

  const onPortMessage = (generation: FrameGeneration, message: unknown): void => {
    if (generation.disposed || (generation !== active && generation !== candidate)) return;
    if (!isFrameMessage(message)) {
      const error = new Error('Malformed Space frame protocol message');
      rejectGeneration(generation, error);
      emitStatus(generation, 'error', error.message); emitError(generation, error);
      return;
    }
    if (message.type === 'failure') {
      const error = errorFromFrame(message.error);
      if (message.requestId !== undefined) {
        const pending = generation.pending.get(message.requestId);
        if (pending) { clearTimeout(pending.timeout); pending.reject(error); }
      }
      generation.pending.delete(message.requestId ?? -1);
      if (message.requestId === undefined) rejectGeneration(generation, error);
      emitStatus(generation, 'error', error.message); emitError(generation, error); return;
    }
    if (message.type === 'ready') {
      if (generation.timeout) clearTimeout(generation.timeout);
      currentState = copyState(message.state);
      activate(generation);
      if (!generation.settled) { generation.settled = true; generation.resolveReady(); }
      emitStatus(generation, message.status);
      return;
    }
    if (message.type === 'result') {
      const pending = generation.pending.get(message.requestId);
      if (!pending) return;
      generation.pending.delete(message.requestId);
      clearTimeout(pending.timeout);
      currentState = copyState(message.state);
      pending.resolve(copyState(currentState));
      return;
    }
    if (generation !== active) return;
    if (message.event === 'statechange') {
      currentState = copyState(message.state);
      emit('statechange', { revision: generation.revision, source: message.source, state: copyState(currentState) });
    } else {
      emitStatus(generation, message.status, message.message);
    }
  };

  window.addEventListener('message', onWindowMessage);
  active = start(initialData, initialPatch);
  emitStatus(active, 'loading');

  return {
    ready: active.ready,
    async setData(data, patch) {
      const copied = validateAndCopySpaceDataset(data);
      const copiedPatch = copyStatePatch(patch ?? {});
      if (disposed) throw abortError('Space handle is disposed');
      if (candidate) rejectGeneration(candidate, abortError('Space initialization was superseded'));
      const next = start(copied, copiedPatch);
      candidate = next;
      emitStatus(next, 'loading');
      await next.ready;
    },
    async setState(patch) {
      if (disposed || !active) throw abortError('Space handle is disposed');
      return request(active, { type: 'setState', patch: copyStatePatch(patch) });
    },
    async getState() {
      if (disposed || !active) throw abortError('Space handle is disposed');
      return request(active, { type: 'getState' });
    },
    on(event, handler) {
      handlers[event].add(handler as never);
      return () => handlers[event].delete(handler as never);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('message', onWindowMessage);
      for (const generation of [active, candidate]) if (generation) {
        try { post(generation, { type: 'dispose' }); } catch { /* no live port */ }
        rejectGeneration(generation, abortError('Space handle was disposed'));
      }
      active = undefined; candidate = undefined;
    },
  };
}
