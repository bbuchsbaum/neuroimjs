import { SPACE_PACKAGE_VERSION, SPACE_PROTOCOL_VERSION, type SpaceConnectMessage, type SpaceFrameMessage, type SpaceHostMessage } from '../../src/space/protocol';
import type { SpaceState } from '../../src/space/types';
import { installEmbeddedBridge } from './embedded-bridge';
import { installEmbeddedDataset } from './embedded-data';

let port: MessagePort | null = null;
let runtime: typeof import('./main') | null = null;
let disposed = false;
let initializing = false;
let initialized = false;
let command = Promise.resolve();
let parentOrigin: string | null = null;

function send(message: SpaceFrameMessage): void { port?.postMessage(message); }
function fail(error: unknown, requestId?: number): void {
  const e = error instanceof Error ? error : new Error(String(error));
  send({ type: 'failure', ...(requestId === undefined ? {} : { requestId }), error: { name: e.name, message: e.message } });
}

async function receive(message: SpaceHostMessage): Promise<void> {
  if (disposed && message.type !== 'dispose') return;
  try {
    if (message.type === 'initialize') {
      if (initialized || initializing || runtime) throw new Error('Embedded Space is already initialized.');
      initializing = true;
      initialized = true;
      installEmbeddedDataset(message.data, message.initialState);
      runtime = await import('./main');
      if (disposed) return;
      installEmbeddedBridge({
        state: (state, source) => send({ type: 'event', event: 'statechange', state, source }),
        status: (status, text) => send({ type: 'event', event: 'statuschange', status, ...(text ? { message: text } : {}) }),
      });
      await runtime.embeddedReady;
      if (disposed) return;
      if (message.initialState) await runtime.applyEmbeddedState(message.initialState, 'api');
      if (disposed) return;
      send({ type: 'ready', state: runtime.embeddedState(), status: runtime.embeddedStatus() });
    } else if (message.type === 'setState') {
      if (!runtime) throw new Error('Initialize the embedded Space before setting state.');
      await runtime.applyEmbeddedState(message.patch, 'api');
      send({ type: 'result', requestId: message.requestId, state: runtime.embeddedState() });
    } else if (message.type === 'getState') {
      if (!runtime) throw new Error('Initialize the embedded Space before reading state.');
      send({ type: 'result', requestId: message.requestId, state: runtime.embeddedState() });
    } else {
      disposed = true;
      runtime?.disposeVolumeSet();
      port?.close();
      port = null;
    }
  } catch (error) { fail(error, message.type === 'setState' || message.type === 'getState' ? message.requestId : undefined); }
  finally { if (message.type === 'initialize') initializing = false; }
}

function isHostMessage(value: unknown): value is SpaceHostMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'initialize' || type === 'setState' || type === 'getState' || type === 'dispose';
}

window.parent.postMessage({ type: 'space:hello', protocol: SPACE_PROTOCOL_VERSION, version: SPACE_PACKAGE_VERSION }, '*');
window.addEventListener('message', (event) => {
  const message = event.data as SpaceConnectMessage | undefined;
  if (port || event.source !== window.parent || !message || message.type !== 'space:connect' || message.protocol !== SPACE_PROTOCOL_VERSION || message.version !== SPACE_PACKAGE_VERSION || event.ports.length !== 1) return;
  parentOrigin = event.origin;
  port = event.ports[0];
  port.onmessage = (e: MessageEvent<unknown>) => {
    if (!isHostMessage(e.data)) { fail(new Error('Malformed embedded Space command.')); return; }
    if (e.data.type === 'dispose') disposed = true;
    command = command.then(() => receive(e.data)).catch((error) => fail(error));
  };
  port.start();
}, { once: false });
