# @snekot/sdk

The [Snekot](https://snekot.co) SDK for TypeScript and JavaScript. Post product events, get them as push notifications, identify users and set insights.

Runs on Node 18+, Deno, Bun and edge runtimes. No dependencies. ES modules only.

```bash
npm install https://github.com/snekot-co/snekot-js/releases/download/0.1.0/snekot-sdk-0.1.0.tgz
```

That installs the built package from this repository's release, under the name `@snekot/sdk`. It works the same with pnpm, yarn and bun. The package is not on the npm registry yet.

## Use

```ts
import { Client } from '@snekot/sdk';

const events = new Client({ token: process.env.SNEKOT_TOKEN, project: 'acme-store' });

await events.track({ channel: 'payments', event: 'New subscription', icon: '💰', notify: true, tags: { plan: 'pro' } });
await events.identify({ user_id: 'user-123', properties: { plan: 'pro' } });
await events.group({ group_id: 'acme', user_id: 'user-123', properties: { name: 'Acme' } });
await events.subscribe({ email: 'jane@example.com', name: 'Jane Park' });
await events.insight.track({ title: 'MRR', value: '$1,289' });
await events.insight.increment({ title: 'Orders', value: 1 });
```

Use a private key (`sk_…`) on a server. Keys are made in the app under Setup; see [Keys](https://snekot.co/docs/keys).

`experiment` asks which variant of an A/B test a person gets:

```ts
const variant = await events.experiment({ experiment: 'pricing-page', variants: ['control', 'annual-first'], user_id: 'user-123' });
```

### Behaviour

- One attempt may take 10 seconds (`timeout`, in milliseconds).
- A network failure or a server error is retried once, after a quarter of a second.
- A refusal (a 4xx, such as a bad channel name) is never retried. It throws `HTTPResponseError` with the status and the server's own sentence for what to fix.
- `disableTracking: true`, or `events.disableTracking()`, makes every call succeed without sending anything, for tests and local runs.
- `endpoint` defaults to `https://api.snekot.co`. Pass another only if you [proxy the API through your own domain](https://snekot.co/docs/proxy).

## Effect

`@snekot/sdk/effect` is the same client as an [Effect](https://effect.website) service, with layers and typed failures. It needs `effect` 3.19 or newer.

```ts
import { Effect } from 'effect';
import { Events } from '@snekot/sdk/effect';

const program = Effect.gen(function* () {
  const events = yield* Events;
  yield* events.track({ channel: 'payments', event: 'New subscription', notify: true });
}).pipe(Effect.catchTag('PublishRefused', (refusal) => Effect.logWarning(refusal.message)));

program.pipe(Effect.provide(Events.layerConfig), Effect.runPromise);
```

`Events.layerConfig` reads `EVENTS_TOKEN`, `EVENTS_PROJECT` and, optionally, `EVENTS_ENDPOINT`. The token is redacted, so it never prints in a log or a trace. `Events.layer(options)` takes the values directly and `Events.layerDisabled` sends nothing.

A call fails with `PublishRefused`, when the server said no, or `PublishFailed`, when there was no usable answer after one retry.

## React, Next.js and Vue

These load the [browser script](https://github.com/snekot-co/snekot-browser) and wrap it. Use a **public** key (`pk_…`) with them: anything in a web page can be read by the people who open it.

```tsx
import { EventsProvider, useEvents } from '@snekot/sdk/react';

<EventsProvider token="pk_…" project="acme-store">{children}</EventsProvider>;

const { track, identify, subscribe, setUserId } = useEvents();
const ok = await subscribe(email);
```

`useExperiment(name, variants)` gives the visitor's variant, or `null` until it is known. In Next's App Router, import from a client component.

```ts
import Events, { track, subscribe } from '@snekot/sdk/vue';

app.use(Events, { token: 'pk_…', project: 'acme-store' });
```

## Develop

```bash
pnpm install
pnpm test     # type-check, then the conformance cases with a recording fetch
pnpm build    # ES modules and types to dist/
```

`test/conformance.json` is the wire contract every Snekot SDK is tested against. `pnpm smoke` runs every method against the real API; it needs `SNEKOT_TOKEN` and `SNEKOT_PROJECT`.

## Licence

MIT
