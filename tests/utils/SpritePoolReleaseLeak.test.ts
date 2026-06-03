import { describe, it, expect, vi } from 'vitest';
import { SpritePool } from '../../src/utils/SpritePool';

// Mock PIXI with a Container whose removeChild() SPLICES its children array
// in place. This faithfully mirrors real PIXI v8 behavior (and the production
// bug condition): SpritePool.release() calls sprite.parent.removeChild(sprite),
// which mutates the SAME children array a caller may be iterating.
vi.mock('pixi.js', () => {
  class Sprite {
    visible = true;
    alpha = 1;
    scale = { set: vi.fn() };
    anchor = { set: vi.fn() };
    rotation = 0;
    tint = 0xffffff;
    texture: any = null;
    parent: any = null;
    destroy = vi.fn();
  }

  class Container {
    children: any[] = [];
    parent: any = null;
    addChild(child: any) {
      child.parent = this;
      this.children.push(child);
      return child;
    }
    // IMPORTANT: splice in place (do NOT reassign), so iterating the live
    // array while releasing exposes the index-skipping leak.
    removeChild(child: any) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      child.parent = null;
    }
    removeChildren() {
      this.children.forEach((c) => (c.parent = null));
      this.children = [];
    }
    destroy = vi.fn();
  }

  const Texture = { EMPTY: 'EMPTY_TEXTURE' };

  return { Sprite, Container, Texture };
});

// Imported AFTER the mock so `instanceof PIXI.Sprite` resolves to the mock class.
import * as PIXI from 'pixi.js';

/**
 * Faithful minimal reproduction of ImageLayer.releaseActiveContainers().
 *
 * The OLD (buggy) implementation iterated container.children directly:
 *   container.children.forEach(child => spritePool.release(child));
 * Because release() removes the child from its parent (splicing the live
 * array), forEach skips every other element and ~half the sprites are never
 * returned to the pool.
 *
 * `useSnapshot` toggles between the buggy and fixed iteration so the test can
 * prove the fix is what closes the leak.
 */
function releaseContainerChildren(
  spritePool: SpritePool,
  container: PIXI.Container,
  useSnapshot: boolean
): void {
  if (useSnapshot) {
    // Fixed: iterate a copy so live mutation during iteration is safe.
    const childrenToRelease = [...container.children];
    childrenToRelease.forEach((child) => {
      if (child instanceof PIXI.Sprite) {
        spritePool.release(child);
      }
    });
  } else {
    // Buggy: iterate the live array that release() mutates.
    container.children.forEach((child) => {
      if (child instanceof PIXI.Sprite) {
        spritePool.release(child);
      }
    });
  }
}

function buildContainerWithSprites(
  spritePool: SpritePool,
  n: number
): PIXI.Container {
  const container = new PIXI.Container();
  for (let i = 0; i < n; i++) {
    const sprite = spritePool.acquire();
    container.addChild(sprite);
  }
  return container;
}

describe('SpritePool release during container iteration (leak regression)', () => {
  const N = 6; // even, >= 4

  it('reproduces the leak with the OLD live-array iteration', () => {
    const spritePool = new SpritePool(100);
    const container = buildContainerWithSprites(spritePool, N);
    expect(spritePool.getStats().activeCount).toBe(N);

    // Buggy path: iterate live children array.
    releaseContainerChildren(spritePool, container, /* useSnapshot */ false);

    const stats = spritePool.getStats();
    // The bug: ~half the sprites are skipped and never released.
    expect(stats.activeCount).toBeGreaterThan(0);
    expect(stats.activeCount).toBe(N / 2);
    expect(stats.poolSize).toBe(N / 2);
    expect(container.children.length).toBe(N / 2);
  });

  it('releases ALL sprites with the snapshot fix', () => {
    const spritePool = new SpritePool(100);
    const container = buildContainerWithSprites(spritePool, N);
    expect(spritePool.getStats().activeCount).toBe(N);

    // Fixed path: iterate a copy of the children array.
    releaseContainerChildren(spritePool, container, /* useSnapshot */ true);

    const stats = spritePool.getStats();
    // No leak: every sprite returned to the pool.
    expect(stats.activeCount).toBe(0);
    expect(stats.poolSize).toBe(N);
    expect(container.children.length).toBe(0);
  });
});
