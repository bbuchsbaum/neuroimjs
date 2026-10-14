export type SpaceMode = 'space' | 'montage' | 'facet' | 'ortho';
export type SpaceStatistic = 't' | 'beta';
export type SpaceOrientation = 'axial' | 'coronal' | 'sagittal';
export type SpaceStatus = 'loading' | 'ready' | 'fitting' | 'error';

export interface SpaceMember {
  readonly id: string;
  readonly subject: string;
  readonly model: string;
  readonly contrast: string;
  readonly t?: Float32Array;
  readonly beta?: Float32Array;
  readonly se?: Float32Array;
}

export interface SpaceDataset {
  readonly id: string;
  readonly grid: {
    readonly dimensions: readonly [number, number, number];
    readonly affine: readonly (readonly number[])[];
  };
  readonly template: Float32Array;
  readonly mask: Uint8Array;
  readonly members: readonly SpaceMember[];
  readonly atlas?: {
    readonly name: string;
    readonly labels: Int32Array;
    readonly regions: readonly { readonly id: number; readonly label: string }[];
  };
  readonly covariates?: readonly {
    readonly subject: string;
    readonly values: Readonly<Record<string, string | number | null>>;
  }[];
}

export interface SpaceState {
  readonly version: 1;
  readonly mode: SpaceMode;
  readonly model: string;
  readonly contrast: string;
  readonly statistic: SpaceStatistic;
  readonly selectedMemberId: string | null;
  readonly worldCoord: readonly [number, number, number] | null;
  readonly orientation: SpaceOrientation;
  readonly threshold: number;
  readonly range: number;
}

export type SpaceStatePatch = Partial<Omit<SpaceState, 'version'>>;

export interface SpaceStateChangeEvent {
  readonly state: SpaceState;
  readonly revision: number;
  readonly source: 'user' | 'api';
}

export interface SpaceStatusChangeEvent {
  readonly revision: number;
  readonly status: SpaceStatus;
  readonly message?: string;
}

export interface SpaceErrorEvent {
  readonly revision: number;
  readonly error: Error;
}

export interface SpaceEventMap {
  statechange: SpaceStateChangeEvent;
  statuschange: SpaceStatusChangeEvent;
  error: SpaceErrorEvent;
}

export interface SpaceHandle {
  readonly ready: Promise<void>;
  setData(data: SpaceDataset, initialState?: SpaceStatePatch): Promise<void>;
  setState(patch: SpaceStatePatch): Promise<SpaceState>;
  getState(): Promise<SpaceState>;
  on<K extends keyof SpaceEventMap>(event: K, handler: (event: SpaceEventMap[K]) => void): () => void;
  dispose(): void;
}

export interface MountSpaceOptions {
  readonly assetBaseUrl: string;
  readonly data: SpaceDataset;
  readonly initialState?: SpaceStatePatch;
  readonly timeoutMs?: number;
}
