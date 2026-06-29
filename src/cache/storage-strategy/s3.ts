import { S3Client, type S3Options } from 'bun';
import { CacheStorageStrategy } from './storage-strategy.interface';

type StaticCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
type ResolvedCredentials = StaticCredentials & { expiration?: Date };
type CredentialProvider = () => Promise<ResolvedCredentials>;

export interface S3StrategyOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  credentials: StaticCredentials | CredentialProvider;
}

const REFRESH_WINDOW_MS = 5 * 60 * 1000;

/** True when temporary credentials are missing or within the refresh window of expiry. */
export function shouldRefreshCredentials(expiration: number | null, now: number): boolean {
  if (expiration === null) return false;
  return now >= expiration - REFRESH_WINDOW_MS;
}

export class S3Strategy implements CacheStorageStrategy {
  readonly #bucket: string;
  readonly #region?: string;
  readonly #endpoint?: string;
  readonly #provider?: CredentialProvider;
  #client: Bun.S3Client | null = null;
  #expiration: number | null = null;

  constructor(options: S3StrategyOptions) {
    this.#bucket = options.bucket;
    this.#region = options.region;
    this.#endpoint = options.endpoint;
    if (typeof options.credentials === 'function') {
      this.#provider = options.credentials;
    } else {
      this.#client = this.#build(options.credentials);
    }
  }

  #build(creds: StaticCredentials): Bun.S3Client {
    const opts: S3Options = {
      bucket: this.#bucket,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
      ...(this.#region ? { region: this.#region } : {}),
      ...(this.#endpoint ? { endpoint: this.#endpoint } : {}),
    };
    return new S3Client(opts);
  }

  async #getClient(): Promise<Bun.S3Client> {
    if (!this.#provider) return this.#client as Bun.S3Client;
    if (!this.#client || shouldRefreshCredentials(this.#expiration, Date.now())) {
      const creds = await this.#provider();
      this.#client = this.#build(creds);
      this.#expiration = creds.expiration ? creds.expiration.getTime() : null;
    }
    return this.#client;
  }

  async exists(hash: string): Promise<boolean> {
    return (await this.#getClient()).exists(hash);
  }

  async getStream(hash: string): Promise<ReadableStream> {
    return (await this.#getClient()).file(hash).stream();
  }

  async getSize(hash: string): Promise<number> {
    return (await this.#getClient()).size(hash);
  }

  async writeStream(hash: string, stream: ReadableStream<Uint8Array>): Promise<void> {
    const client = await this.#getClient();
    const file = client.file(hash);
    const writer = file.writer({ retry: 3, queueSize: 10, partSize: 5 * 1024 * 1024 });

    try {
      for await (const chunk of stream) {
        writer.write(chunk);
        await writer.flush();
      }
      await writer.end();
    } catch (error) {
      try {
        await writer.end();
      } catch {}
      throw error;
    }
  }
}
