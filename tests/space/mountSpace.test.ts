import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountSpace } from '../../src/space/mountSpace';
import { SPACE_PACKAGE_VERSION, SPACE_PROTOCOL_VERSION } from '../../src/space/protocol';
import type { SpaceDataset } from '../../src/space/types';

function dataset(id = 'dataset.1'): SpaceDataset {
  return {
    id,
    grid: { dimensions: [1, 1, 1], affine: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] },
    template: new Float32Array([1]), mask: new Uint8Array([1]),
    members: [{ id: 'm.1', subject: 's.1', model: 'model.1', contrast: 'contrast.1', t: new Float32Array([1]) }],
  };
}

const state = {
  version: 1 as const, mode: 'space' as const, model: 'model.1', contrast: 'contrast.1', statistic: 't' as const,
  selectedMemberId: null, worldCoord: null, orientation: 'axial' as const, threshold: 0, range: 1,
};

function connect(iframe: HTMLIFrameElement): MessagePort {
  const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
  window.dispatchEvent(new MessageEvent('message', {
    source: iframe.contentWindow, origin: window.location.origin,
    data: { type: 'space:hello', protocol: SPACE_PROTOCOL_VERSION, version: SPACE_PACKAGE_VERSION },
  }));
  const transfer = post.mock.calls[0][2] as Transferable[];
  return transfer[0] as MessagePort;
}

afterEach(() => document.body.replaceChildren());

describe('mountSpace', () => {
  it('requires same-origin assets and initializes over a private channel', async () => {
    const container = document.body.appendChild(document.createElement('div'));
    expect(() => mountSpace(container, { assetBaseUrl: 'https://other.example/space/', data: dataset() })).toThrow(/same-origin/);
    expect(() => mountSpace(container, { assetBaseUrl: 'ftp://localhost/space/', data: dataset() })).toThrow(/HTTP\(S\)/);
    const handle = mountSpace(container, { assetBaseUrl: '/space/', data: dataset() });
    const iframe = container.querySelector('iframe')!;
    const port = connect(iframe);
    port.postMessage({ type: 'ready', state, status: 'ready' });
    await expect(handle.ready).resolves.toBeUndefined();
    expect(iframe.src).toContain('/space/index.html?embedded=1');
    handle.dispose();
  });

  it('keeps the old frame alive while a replacement is pending and rejects it on dispose', async () => {
    const container = document.body.appendChild(document.createElement('div'));
    const handle = mountSpace(container, { assetBaseUrl: '/space/', data: dataset() });
    const old = container.querySelector('iframe')!;
    connect(old).postMessage({ type: 'ready', state, status: 'ready' });
    await handle.ready;
    const replacement = handle.setData(dataset('dataset.2'));
    const frames = container.querySelectorAll('iframe');
    expect(frames).toHaveLength(2);
    expect(old.isConnected).toBe(true);
    handle.dispose();
    await expect(replacement).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps a replacement registered when the initial frame becomes ready later', async () => {
    const container = document.body.appendChild(document.createElement('div'));
    const handle = mountSpace(container, { assetBaseUrl: '/space/', data: dataset() });
    const replacement = handle.setData(dataset('dataset.2'));
    const [initial, next] = Array.from(container.querySelectorAll('iframe'));
    connect(initial).postMessage({ type: 'ready', state, status: 'ready' });
    await handle.ready;
    connect(next).postMessage({ type: 'ready', state, status: 'ready' });
    await expect(replacement).resolves.toBeUndefined();
    expect(initial.isConnected).toBe(false);
    expect(next.isConnected).toBe(true);
    handle.dispose();
  });

  it('settles readiness despite a throwing observer and removes a loading candidate disposed by an observer', async () => {
    const container = document.body.appendChild(document.createElement('div'));
    const handle = mountSpace(container, { assetBaseUrl: '/space/', data: dataset() });
    handle.on('statuschange', () => { throw new Error('observer failure'); });
    const initial = container.querySelector('iframe')!;
    connect(initial).postMessage({ type: 'ready', state, status: 'ready' });
    await expect(handle.ready).resolves.toBeUndefined();

    let disposeOnLoading = false;
    handle.on('statuschange', event => { if (disposeOnLoading && event.status === 'loading') handle.dispose(); });
    disposeOnLoading = true;
    await expect(handle.setData(dataset('dataset.2'))).rejects.toMatchObject({ name: 'AbortError' });
    expect(container.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('times out unanswered active requests and gives each state observer an isolated snapshot', async () => {
    const container = document.body.appendChild(document.createElement('div'));
    const handle = mountSpace(container, { assetBaseUrl: '/space/', data: dataset(), timeoutMs: 100 });
    const port = connect(container.querySelector('iframe')!);
    port.postMessage({ type: 'ready', state, status: 'ready' });
    await handle.ready;
    let secondModel = '';
    handle.on('statechange', event => { (event.state as { model: string }).model = 'mutated'; });
    handle.on('statechange', event => { secondModel = event.state.model; });
    port.postMessage({ type: 'event', event: 'statechange', state, source: 'user' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(secondModel).toBe('model.1');
    await expect(handle.getState()).rejects.toThrow(/timed out/);
    handle.dispose();
  });

  it('rejects readiness when a malformed ready envelope arrives before lifecycle state is consumed', async () => {
    const container = document.body.appendChild(document.createElement('div'));
    const handle = mountSpace(container, { assetBaseUrl: '/space/', data: dataset() });
    connect(container.querySelector('iframe')!).postMessage({ type: 'ready', state: null, status: 'ready' });
    await expect(handle.ready).rejects.toThrow(/Malformed Space frame protocol message/);
  });

  it('rejects pending requests when a malformed result or unknown frame message arrives', async () => {
    const container = document.body.appendChild(document.createElement('div'));
    const handle = mountSpace(container, { assetBaseUrl: '/space/', data: dataset() });
    const port = connect(container.querySelector('iframe')!);
    port.postMessage({ type: 'ready', state, status: 'ready' });
    await handle.ready;
    const pending = handle.getState();
    port.postMessage({ type: 'result', requestId: 1, state: null });
    await expect(pending).rejects.toThrow(/Malformed Space frame protocol message/);
    handle.dispose();

    const second = mountSpace(container, { assetBaseUrl: '/space/', data: dataset() });
    const secondPort = connect(container.querySelector('iframe')!);
    secondPort.postMessage({ type: 'wat' });
    await expect(second.ready).rejects.toThrow(/Malformed Space frame protocol message/);
  });
});
