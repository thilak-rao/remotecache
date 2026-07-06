import { S3Client, type S3Options } from 'bun';
import { CacheEntryExistsError, CacheStorageStrategy } from './storage-strategy.interface';

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
  #refreshPromise: Promise<void> | null = null;

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
      // Coalesce concurrent refreshes so a credential-expiry window triggers a
      // single provider (e.g. STS AssumeRole) call instead of one per in-flight
      // request. The promise is cleared once settled so the next cycle refreshes.
      this.#refreshPromise ??= this.#provider()
        .then((creds) => {
          this.#client = this.#build(creds);
          this.#expiration = creds.expiration ? creds.expiration.getTime() : null;
        })
        .finally(() => {
          this.#refreshPromise = null;
        });
      await this.#refreshPromise;
    }
    return this.#client as Bun.S3Client;
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

  async writeStream(
    hash: string,
    stream: ReadableStream<Uint8Array>,
    contentLength: number,
  ): Promise<void> {
    const client = await this.#getClient();
    const response = await fetch(client.presign(hash, { method: 'PUT' }), {
      method: 'PUT',
      headers: {
        'Content-Length': String(contentLength),
        'If-None-Match': '*',
      },
      body: stream,
    });

    await response.body?.cancel();
    if (response.ok) return;
    if (response.status === 409 || response.status === 412) {
      throw new CacheEntryExistsError(hash);
    }
    throw new Error(`S3 write failed with HTTP ${response.status}`);
  }
}
