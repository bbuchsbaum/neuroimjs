import { TypedArray } from '../types';

export class Downloader {
  /**
   * Downloads binary data from a URL and returns it as an ArrayBuffer.
   * @param url The URL to download from.
   */
  public static async downloadBuffer(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    return await response.arrayBuffer();
  }

  /**
   * Downloads text data from a URL.
   * @param url The URL to download from.
   */
  public static async downloadText(url: string): Promise<string> {
    const response = await fetch(url);
    return await response.text();
  }

  /**
   * Downloads binary data from a URL and returns it as a TypedArray.
   * @param url The URL to download from.
   */
  public static async downloadArray(url: string): Promise<TypedArray> {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    return new Int16Array(buffer);
  }

  /**
   * Downloads JSON data from a URL.
   * @param url The URL to download from.
   */
  public static async downloadJSON<T>(url: string): Promise<T> {
    const response = await fetch(url);
    return (await response.json()) as T;
  }
}