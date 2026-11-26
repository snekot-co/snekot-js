/**
 * The same client for Effect programs: a service, layers to provide it, and failures as typed values.
 *
 *   const program = Effect.gen(function* () {
 *     const events = yield* Events;
 *     yield* events.track({ channel: 'payments', event: 'New subscription', notify: true });
 *   });
 *   program.pipe(Effect.provide(Events.layerConfig), Effect.runPromise);
 *
 * It needs only `effect`. Requests go through `fetch`, so it runs wherever Effect does.
 */
import { Config, Context, Data, Duration, Effect, Layer, Redacted, Schedule } from 'effect';

import { DEFAULT_ENDPOINT, toUnixTimestamp, type ExperimentOptions, type FlagOptions, type GroupOptions, type IdentifyOptions, type InsightIncrementOptions, type InsightTrackOptions, type SubscribeOptions, type TrackOptions } from './index.js';

/** The server understood the request and said no: a bad channel name, a spent allowance, a key without the right scope. Never retried. */
export class PublishRefused extends Data.TaggedError('PublishRefused')<{
  readonly status: number;
  /** The server's own sentence for what to fix. */
  readonly message: string;
  readonly body: unknown;
}> {}

/** The request never got an answer worth acting on: the network failed, it timed out, or the server errored. Retried once before it surfaces. */
export class PublishFailed extends Data.TaggedError('PublishFailed')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type PublishError = PublishRefused | PublishFailed;

export interface EventsOptions {
  /** Redacted, so it never prints in logs or traces. */
  readonly token: Redacted.Redacted<string>;
  readonly project: string;
  readonly endpoint?: string;
  /** How long one attempt may take; 10 seconds by default. */
  readonly timeout?: Duration.DurationInput;
  /** Makes every call succeed without sending anything. */
  readonly disabled?: boolean;
  readonly fetch?: typeof fetch;
}

export interface EventsService {
  /** Posts an event to a channel. */
  readonly track: (options: TrackOptions) => Effect.Effect<void, PublishError>;
  /** Sets properties on a user; keys sent again replace their old values. */
  readonly identify: (options: IdentifyOptions) => Effect.Effect<void, PublishError>;
  /** Describes a group such as a company, and puts `user_id` in it when given. */
  readonly group: (options: GroupOptions) => Effect.Effect<void, PublishError>;
  /** Puts an address on the project's newsletter list; signing it up again changes nothing. */
  readonly subscribe: (options: SubscribeOptions) => Effect.Effect<void, PublishError>;
  /**
   * Which variant of an A/B test a person gets. The same person always gets the same one. With the service
   * disabled it is the first variant and nothing is sent.
   */
  readonly experiment: (options: ExperimentOptions) => Effect.Effect<string, PublishError>;
  /**
   * Whether a feature flag is on for a person. A key with no flag is off. With the service disabled it is off
   * and nothing is sent.
   */
  readonly flag: (options: FlagOptions) => Effect.Effect<boolean, PublishError>;
  readonly insight: {
    /** Sets an insight to a value. */
    readonly track: (options: InsightTrackOptions) => Effect.Effect<void, PublishError>;
    /** Adds to an insight's number, starting from 0 if it has none. */
    readonly increment: (options: InsightIncrementOptions) => Effect.Effect<void, PublishError>;
  };
}

/** Builds the service from plain options, for a program that already has its configuration in hand. */
export function make({ token, project, endpoint = DEFAULT_ENDPOINT, timeout = Duration.seconds(10), disabled = false, fetch: fetcher = globalThis.fetch }: EventsOptions): EventsService {
  const base = endpoint.replace(/\/$/, '');

  /** Sends one request, with one retry, and gives back what the server answered with. */
  const request = (method: 'POST' | 'PATCH', path: string, body: object): Effect.Effect<unknown, PublishError> => {
    const attempt = Effect.tryPromise({
      // The signal is Effect's own: interrupting the fibre, or the timeout below, aborts the request.
      try: (signal) =>
        fetcher(`${base}${path}`, {
          method,
          signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Redacted.value(token)}` },
          body: JSON.stringify({ ...body, project }),
        }),
      catch: (cause) => new PublishFailed({ message: `The server at ${base} could not be reached.`, cause }),
    }).pipe(
      Effect.timeoutFail({ duration: timeout, onTimeout: () => new PublishFailed({ message: `No answer from ${base} within ${Duration.format(Duration.decode(timeout))}.` }) }),
      Effect.flatMap((response): Effect.Effect<unknown, PublishError> => {
        if (response.ok) return Effect.promise(() => response.json().catch(() => null));
        if (response.status >= 500) return Effect.fail(new PublishFailed({ message: `The server answered ${response.status}.`, cause: response.status }));
        return Effect.promise(() => response.json().catch(() => null) as Promise<{ error?: string } | null>).pipe(
          Effect.flatMap((data) => Effect.fail(new PublishRefused({ status: response.status, message: data?.error ?? `The server answered ${response.status}.`, body: data }))),
        );
      }),
    );
    // One retry, and only for failures that trying again can fix. A refusal is final.
    return attempt.pipe(Effect.retry({ times: 1, schedule: Schedule.spaced(Duration.millis(250)), while: (error) => error._tag === 'PublishFailed' }));
  };
  const send = (method: 'POST' | 'PATCH', path: string, body: object): Effect.Effect<void, PublishError> => (disabled ? Effect.void : Effect.asVoid(request(method, path, body)));

  return {
    track: (options) => send('POST', '/v1/log', { ...options, timestamp: toUnixTimestamp(options.timestamp) }),
    identify: (options) => send('POST', '/v1/identify', options),
    group: (options) => send('POST', '/v1/group', options),
    subscribe: (options) => send('POST', '/v1/subscribe', options),
    experiment: (options) =>
      disabled
        ? Effect.succeed(options.variants[0])
        : request('POST', '/v1/experiment', options).pipe(Effect.map((answer) => (answer as { variant?: string } | null)?.variant ?? options.variants[0])),
    flag: (options) => (disabled ? Effect.succeed(false) : request('POST', '/v1/flag', options).pipe(Effect.map((answer) => (answer as { on?: boolean } | null)?.on === true))),
    insight: {
      track: (options) => send('POST', '/v1/insight', options),
      increment: ({ title, value, icon }) => send('PATCH', '/v1/insight', { title, icon, value: { $inc: value } }),
    },
  };
}

/** The service tag. `Events.layer(options)` provides it from values; `Events.layerConfig` reads them from configuration. */
export class Events extends Context.Tag('@snekot/sdk/Events')<Events, EventsService>() {
  static readonly layer = (options: EventsOptions): Layer.Layer<Events> => Layer.succeed(Events, make(options));

  /**
   * Reads `SNEKOT_TOKEN`, `SNEKOT_PROJECT` and, optionally, `SNEKOT_ENDPOINT` from the program's configuration,
   * which is the environment unless another provider is set. A missing value fails the layer with a `ConfigError`.
   */
  static readonly layerConfig = Layer.effect(
    Events,
    Effect.gen(function* () {
      const token = yield* Config.redacted('SNEKOT_TOKEN');
      const project = yield* Config.string('SNEKOT_PROJECT');
      const endpoint = yield* Config.string('SNEKOT_ENDPOINT').pipe(Config.withDefault(DEFAULT_ENDPOINT));
      return make({ token, project, endpoint });
    }),
  );

  /** A service that sends nothing, for tests. */
  static readonly layerDisabled: Layer.Layer<Events> = Layer.succeed(Events, make({ token: Redacted.make(''), project: '', disabled: true }));
}
