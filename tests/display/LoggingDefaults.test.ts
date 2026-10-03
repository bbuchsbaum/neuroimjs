import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPixiMock } from '../mocks/pixi.mock';

vi.mock('pixi.js', () => createPixiMock());

import {
  Logger,
  LogLevel,
  DEFAULT_LOG_LEVEL,
  setLogLevel,
  getLogLevel,
  enableDebugLogging,
  parseLogLevel,
  getLogger,
} from '../../src/display/logging/Logger';
import { initializeLogger } from '../../src/display/logging/LoggerConfig';
import { OrthogonalImageViewer } from '../../src/display/OrthogonalImageViewer';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolStack } from '../../src/display/VolStack';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMap } from '../../src/display/ColorMap';

const g = globalThis as Record<string, unknown>;
const ENV_KEYS = ['NEUROIMJS_LOG_LEVEL', 'NEUROIMJS_DEBUG', 'LOG_LEVEL', 'NODE_ENV'] as const;

const consoleSpies: Array<{ mockRestore: () => void }> = [];

function spyConsole() {
  const spy = (method: 'debug' | 'info' | 'log' | 'warn' | 'error') => {
    const s = vi.spyOn(console, method).mockImplementation(() => undefined);
    consoleSpies.push(s);
    return s;
  };
  return { debug: spy('debug'), info: spy('info'), log: spy('log'), warn: spy('warn'), error: spy('error') };
}

describe('neuroimjs logging defaults', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    ENV_KEYS.forEach(k => {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    });
    delete g.NEUROIMJS_LOG_LEVEL;
    delete g.NEUROIMJS_DEBUG;
    Logger.destroy();
  });

  afterEach(() => {
    ENV_KEYS.forEach(k => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
    delete g.NEUROIMJS_LOG_LEVEL;
    delete g.NEUROIMJS_DEBUG;
    Logger.destroy();
    consoleSpies.splice(0).forEach(s => s.mockRestore());
  });

  test('a fresh logger writes warnings and errors only', () => {
    const c = spyConsole();
    expect(DEFAULT_LOG_LEVEL).toBe(LogLevel.WARN);
    expect(getLogLevel()).toBe(LogLevel.WARN);

    const log = getLogger('layer.image');
    log.debug('debug detail');
    log.info('routine progress');
    log.warn('something odd');
    log.error('something broke');

    expect(c.debug).not.toHaveBeenCalled();
    expect(c.info).not.toHaveBeenCalled();
    expect(c.warn).toHaveBeenCalledTimes(1);
    expect(c.error).toHaveBeenCalledTimes(1);
  });

  test('opening an orthogonal viewer is silent at the default level', async () => {
    const c = spyConsole();
    const space = new NeuroSpace(
      [16, 16, 16], [1, 1, 1], [0, 0, 0],
      new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP)
    );
    const vol = new FloatNeuroVol(space, new Float32Array(16 ** 3).map((_, i) => i % 7));
    const stack = new VolStack(new VolLayer('anat', vol, new ColorMap([[0, 0, 0], [1, 1, 1]]), [0, 6]));
    const container = document.createElement('div');
    document.body.appendChild(container);

    const viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer: new ImageLayer(stack),
      options: { showCrosshair: true, showOrientationLabels: true },
    });
    viewer.getSliceViewer('axial').model.nextSlice();
    viewer.dispose();
    container.remove();

    expect(c.debug).not.toHaveBeenCalled();
    expect(c.info).not.toHaveBeenCalled();
    expect(c.log).not.toHaveBeenCalled();
  });

  test('the same viewer logs diagnostics once debug logging is enabled', async () => {
    const c = spyConsole();
    enableDebugLogging();
    expect(getLogLevel()).toBe(LogLevel.DEBUG);
    const space = new NeuroSpace(
      [8, 8, 8], [1, 1, 1], [0, 0, 0],
      new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP)
    );
    const vol = new FloatNeuroVol(space, new Float32Array(8 ** 3).fill(1));
    const layer = new ImageLayer(new VolStack(new VolLayer('anat', vol, new ColorMap([[0, 0, 0], [1, 1, 1]]), [0, 1])));
    layer.initialize();
    expect(c.debug.mock.calls.length + c.info.mock.calls.length).toBeGreaterThan(0);

    enableDebugLogging(false);
    expect(getLogLevel()).toBe(DEFAULT_LOG_LEVEL);
  });

  test('setLogLevel accepts enum values and names, and rejects nonsense', () => {
    setLogLevel('debug');
    expect(getLogLevel()).toBe(LogLevel.DEBUG);
    setLogLevel('INFO' as 'info');
    expect(getLogLevel()).toBe(LogLevel.INFO);
    setLogLevel(LogLevel.ERROR);
    expect(getLogLevel()).toBe(LogLevel.ERROR);
    setLogLevel('none');
    expect(getLogLevel()).toBe(LogLevel.NONE);
    expect(() => setLogLevel('loud' as 'info')).toThrow(/Unknown log level/);
    expect(getLogLevel()).toBe(LogLevel.NONE);
  });

  test('parseLogLevel', () => {
    expect(parseLogLevel('warn')).toBe(LogLevel.WARN);
    expect(parseLogLevel('Warning')).toBe(LogLevel.WARN);
    expect(parseLogLevel(' silent ')).toBe(LogLevel.NONE);
    expect(parseLogLevel('0')).toBe(LogLevel.DEBUG);
    expect(parseLogLevel(3)).toBe(LogLevel.ERROR);
    expect(parseLogLevel(9)).toBeUndefined();
    expect(parseLogLevel('')).toBeUndefined();
    expect(parseLogLevel(undefined)).toBeUndefined();
    expect(parseLogLevel({})).toBeUndefined();
  });

  test('a browser page can opt in before the logger is created', () => {
    g.NEUROIMJS_DEBUG = true;
    expect(getLogLevel()).toBe(LogLevel.DEBUG);

    Logger.destroy();
    g.NEUROIMJS_DEBUG = 'false';
    expect(getLogLevel()).toBe(LogLevel.WARN);

    Logger.destroy();
    g.NEUROIMJS_LOG_LEVEL = 'info';
    g.NEUROIMJS_DEBUG = true; // an explicit level wins over the flag
    expect(getLogLevel()).toBe(LogLevel.INFO);
  });

  test('Node can opt in through the environment', () => {
    process.env.NEUROIMJS_DEBUG = '1';
    expect(getLogLevel()).toBe(LogLevel.DEBUG);
    Logger.destroy();
    delete process.env.NEUROIMJS_DEBUG;
    process.env.NEUROIMJS_LOG_LEVEL = 'error';
    expect(getLogLevel()).toBe(LogLevel.ERROR);
  });

  test('initializeLogger keeps the quiet default outside development', () => {
    initializeLogger();
    expect(getLogLevel()).toBe(LogLevel.WARN);
    process.env.LOG_LEVEL = 'debug';
    initializeLogger();
    expect(getLogLevel()).toBe(LogLevel.DEBUG);
  });

  test('the browser entry point exposes the logging controls', async () => {
    const browser = await import('../../src/browser');
    expect(typeof browser.setLogLevel).toBe('function');
    expect(typeof browser.enableDebugLogging).toBe('function');
    expect(browser.LogLevel.WARN).toBe(LogLevel.WARN);
  });
});
