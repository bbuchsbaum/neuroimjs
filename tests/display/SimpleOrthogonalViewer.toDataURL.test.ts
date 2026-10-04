import { describe, expect, it, vi } from 'vitest';
import { SimpleOrthogonalViewer } from '../../src/display/SimpleOrthogonalViewer';

describe('SimpleOrthogonalViewer.toDataURL', () => {
  it('renders the view before reading the canvas back', () => {
    // WebGL clears the drawing buffer after each frame (no preserveDrawingBuffer),
    // so reading the canvas without a fresh render returns a blank image.
    const calls: string[] = [];
    const canvas = { toDataURL: vi.fn(() => (calls.push('read'), 'data:image/png;base64,AAAA')) };
    const view = { redraw: vi.fn(() => calls.push('redraw')), getCanvas: () => canvas };
    const viewer = Object.assign(Object.create(SimpleOrthogonalViewer.prototype), {
      viewer: { getSliceViewer: () => ({ view }) },
    }) as SimpleOrthogonalViewer;

    expect(viewer.toDataURL('axial')).toBe('data:image/png;base64,AAAA');
    expect(calls).toEqual(['redraw', 'read']);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png', undefined);
  });
});
