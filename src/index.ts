/**
 * The server SDK, for Node, Deno, Bun and edge runtimes.
 *
 *   import { Client } from '@snekot/sdk';
 *   const events = new Client({ token, project });
 *   await events.track({ channel: 'payments', event: 'New subscription', notify: true });
 */

export type Properties = Record<string, string | number | boolean>;

export interface ClientOptions {
  token: string;
  project: string;
  /** Where the API lives, without a trailing slash. */
  endpoint?: string;
  /** Makes every call succeed without sending anything, for tests and local development. */
  disableTracking?: boolean;
  /** Milliseconds before a request is abandoned; 10 seconds by default. */
  timeout?: number;
  /** The `fetch` to use, for runtimes without a global one and for tests. */
  fetch?: typeof fetch;
}

export interface TrackOptions {
  channel: string;
  event: string;
  description?: string;
  user_id?: string;
  /** One emoji, or a shortcode such as `:moneybag:`. */
  icon?: string;
  tags?: Properties;
  notify?: boolean;
  parser?: 'markdown' | 'text';
  /** A past moment makes this a backfill: stored at that time, never pushed to a phone. */
  timestamp?: number | Date;
}

export interface IdentifyOptions {
  user_id: string;
  properties: Properties;
}

export interface GroupOptions {
  user_id?: string;
  group_id: string;
  properties?: Properties;
}

export interface SubscribeOptions {
  /** The address to put on the project's newsletter list. Capitals and spaces around it do not matter. */
  email: string;
  name?: string;
  properties?: Properties;
  /** The page the signup came from, such as `/blog/launch`. */
  source?: string;
  /** Push the signup to the phones of everyone on the project. */
  notify?: boolean;
  /** The person's language, as a tag such as `sv` or `sv-SE`. */
  language?: string;
  /** The person's time zone, as its IANA name, such as `Europe/Stockholm`. */
  timezone?: string;
}

export interface InsightTrackOptions {
  title: string;
  value: string | number;
  icon?: string;
}

export interface InsightIncrementOptions {
  title: string;
  /** Added to the insight's number; negative to subtract. */
  value: number;
  icon?: string;
}

export interface ExperimentOptions {
  /** The experiment's name. */
  experiment: string;
  /** Two to eight variants. The first is the one the others are measured against; keep the order the same everywhere. */
  variants: readonly [string, string, ...string[]];
  /** The person, when they are known. */
  user_id?: string;
  /** For someone with no id: their address and user agent, which tie them to their page views and are not stored. */
  ip?: string;
  user_agent?: string;
}

/** A request the server refused, with the sentence it gave for why. */
export class HTTPResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'HTTPResponseError';
  }
}

/** Unix seconds from a Date, from milliseconds, or from seconds as they are. */
export function toUnixTimestamp(value: number | Date | undefined): number | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  return value > 1e11 ? Math.floor(value / 1000) : value;
}

export const DEFAULT_ENDPOINT = 'https://api.snekot.co';

export class Client {
  private readonly token: string;
  private readonly project: string;
  private readonly endpoint: string;
  private disabled: boolean;
  private readonly timeout: number;
  private readonly fetcher: typeof fetch;

  /** `events.insight.track(…)` and `events.insight.increment(…)`. */
  readonly insight = {
    track: (options: InsightTrackOptions) => this.insightTrack(options),
    increment: (options: InsightIncrementOptions) => this.insightIncrement(options),
  };

  constructor({ token, project, endpoint = DEFAULT_ENDPOINT, disableTracking = false, timeout = 10_000, fetch: fetcher = globalThis.fetch }: ClientOptions) {
    this.token = token;
    this.project = project;
    this.endpoint = endpoint.replace(/\/$/, '');
    this.disabled = disableTracking;
    this.timeout = timeout;
    this.fetcher = fetcher;
  }

  disableTracking(): void {
    this.disabled = true;
  }

  enableTracking(): void {
    this.disabled = false;
  }

  isTrackingDisabled(): boolean {
    return this.disabled;
  }

  getProject(): string {
    return this.project;
  }

  /** Posts an event to a channel. */
  track(options: TrackOptions): Promise<boolean> {
    return this.send('POST', '/v1/log', { ...options, timestamp: toUnixTimestamp(options.timestamp) });
  }

  /** Sets properties on a user; keys sent again replace their old values. */
  identify(options: IdentifyOptions): Promise<boolean> {
    return this.send('POST', '/v1/identify', options);
  }

  /** Describes a group such as a company, and puts `user_id` in it when given. */
  group(options: GroupOptions): Promise<boolean> {
    return this.send('POST', '/v1/group', options);
  }

  /**
   * Puts an address on the project's newsletter list. Signing the same address up again changes nothing, except
   * that a private key may add a name and properties to it.
   */
  subscribe(options: SubscribeOptions): Promise<boolean> {
    return this.send('POST', '/v1/subscribe', options);
  }

  /**
   * Which variant of an A/B test a person gets. The same person always gets the same one, and being shown it is
   * recorded once a visit. With tracking disabled it is the first variant and nothing is sent.
   */
  async experiment(options: ExperimentOptions): Promise<string> {
    if (this.disabled) return options.variants[0];
    const answer = (await this.request('POST', '/v1/experiment', options)) as { variant?: string } | null;
    return answer?.variant ?? options.variants[0];
  }

  /** Sets an insight to a value. */
  insightTrack(options: InsightTrackOptions): Promise<boolean> {
    return this.send('POST', '/v1/insight', options);
  }

  /** Adds to an insight's number, starting from 0 if it has none. */
  insightIncrement({ title, value, icon }: InsightIncrementOptions): Promise<boolean> {
    return this.send('PATCH', '/v1/insight', { title, icon, value: { $inc: value } });
  }

  private async send(method: 'POST' | 'PATCH', path: string, body: object): Promise<boolean> {
    if (this.disabled) return true;
    await this.request(method, path, body);
    return true;
  }

  /** Sends one request and gives back what the server answered with. */
  private async request(method: 'POST' | 'PATCH', path: string, body: object): Promise<unknown> {
    const init = {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ ...body, project: this.project }),
    };
    // One retry, and only where trying again can help: the network failed or the server did. A refusal is final.
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(`${this.endpoint}${path}`, { ...init, signal: AbortSignal.timeout(this.timeout) });
      } catch (error) {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        throw new HTTPResponseError(`Failed to publish: the server at ${this.endpoint} could not be reached.`, 0, error);
      }
      if (response.ok) return response.json().catch(() => null);
      if (response.status >= 500 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new HTTPResponseError(`Failed to publish: ${data?.error ?? `the server answered ${response.status}`}`, response.status, data);
    }
  }
}

