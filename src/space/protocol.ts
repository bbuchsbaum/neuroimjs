import type { SpaceDataset, SpaceState, SpaceStatePatch, SpaceStatus } from './types';

export const SPACE_PROTOCOL_VERSION = 1 as const;
export const SPACE_PACKAGE_VERSION = '0.6.0' as const;

export interface SpaceHelloMessage {
  readonly type: 'space:hello';
  readonly protocol: typeof SPACE_PROTOCOL_VERSION;
  readonly version: typeof SPACE_PACKAGE_VERSION;
}

export interface SpaceConnectMessage {
  readonly type: 'space:connect';
  readonly protocol: typeof SPACE_PROTOCOL_VERSION;
  readonly version: typeof SPACE_PACKAGE_VERSION;
}

export type SpaceHostMessage =
  | { readonly type: 'initialize'; readonly data: SpaceDataset; readonly initialState?: SpaceStatePatch }
  | { readonly type: 'setState'; readonly requestId: number; readonly patch: SpaceStatePatch }
  | { readonly type: 'getState'; readonly requestId: number }
  | { readonly type: 'dispose' };

export type SpaceFrameMessage =
  | { readonly type: 'ready'; readonly state: SpaceState; readonly status: SpaceStatus }
  | { readonly type: 'result'; readonly requestId: number; readonly state: SpaceState }
  | { readonly type: 'failure'; readonly requestId?: number; readonly error: { readonly name: string; readonly message: string } }
  | { readonly type: 'event'; readonly event: 'statechange'; readonly state: SpaceState; readonly source: 'user' | 'api' }
  | { readonly type: 'event'; readonly event: 'statuschange'; readonly status: SpaceStatus; readonly message?: string };
