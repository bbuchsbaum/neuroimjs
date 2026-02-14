export class Cache {
  private static instance: Cache;
  private cache: Map<string, any>;

  private constructor() {
    this.cache = new Map<string, any>();
  }

  public static getInstance(): Cache {
    if (!Cache.instance) {
      Cache.instance = new Cache();
    }
    return Cache.instance;
  }

  public get<T>(key: string): T | null {
    return this.cache.has(key) ? (this.cache.get(key) as T) : null;
  }

  public set(key: string, value: any): void {
    this.cache.set(key, value);
  }

  public clear(): void {
    this.cache.clear();
  }
}