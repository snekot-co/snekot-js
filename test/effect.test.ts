// The shared conformance cases, through the Effect service: `pnpm conformance`.
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { ConfigProvider, Effect, Either, Layer, Redacted } from 'effect';

import { Events, type EventsService } from '../src/effect.js';

interface Case {
  call: 'track' | 'identify' | 'group' | 'subscribe' | 'insight.track' | 'insight.increment';
  args: Record<string, unknown>;
  expect: { method: string; path: string; body: unknown };
}
const suite = JSON.parse(readFileSync(new URL('./conformance.json', import.meta.url), 'utf8')) as { project: string; cases: Case[] };

const seen: { method: string; path: string; body: unknown; auth: string }[] = [];
let answers: (() => Response)[] = [];
const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
  seen.push({ method: init?.method ?? 'GET', path: new URL(String(url)).pathname, body: JSON.parse(String(init?.body)), auth: (init?.headers as Record<string, string>).Authorization });
  const answer = answers.shift();
  return answer ? answer() : new Response('{}', { status: 200 });
}) as typeof fetch;

const live = Events.layer({ token: Redacted.make('sk_test'), project: suite.project, endpoint: 'http://sdk.test', fetch: fetcher });
const call = (events: EventsService, entry: Case) => {
  const args = entry.args as never;
  if (entry.call === 'insight.track') return events.insight.track(args);
  if (entry.call === 'insight.increment') return events.insight.increment(args);
  return events[entry.call](args);
};
const run = <A, E>(program: Effect.Effect<A, E, Events>, layer: Layer.Layer<Events, unknown> = live) => Effect.runPromise(Effect.either(program).pipe(Effect.provide(layer)) as Effect.Effect<Either.Either<A, E>>);
const track = Effect.flatMap(Events, (events) => events.track({ channel: 'x', event: 'y' }));

let failed = 0;
const check = (name: string, pass: boolean, detail?: unknown) => {
  if (!pass) failed += 1;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass || detail === undefined ? '' : `\n     ${JSON.stringify(detail)}`}`);
};

for (const entry of suite.cases) {
  seen.length = 0;
  await run(Effect.flatMap(Events, (events) => call(events, entry)));
  const { auth, ...request } = seen[0];
  check(`${entry.call} ${JSON.stringify(entry.args).slice(0, 48)}`, isDeepStrictEqual(request, entry.expect) && auth === 'Bearer sk_test', request);
}

seen.length = 0;
answers = [() => new Response('{"error":"bad channel"}', { status: 400 })];
const refused = await run(track);
check('a 4xx fails as PublishRefused, once, with the server\'s sentence', seen.length === 1 && Either.isLeft(refused) && refused.left._tag === 'PublishRefused' && refused.left.status === 400 && refused.left.message === 'bad channel');

seen.length = 0;
answers = [() => new Response('{}', { status: 503 })];
check('a 5xx is retried once', Either.isRight(await run(track)) && seen.length === 2);

seen.length = 0;
answers = [() => new Response('{}', { status: 503 }), () => new Response('{}', { status: 503 })];
const gaveUp = await run(track);
check('two 5xx in a row fail as PublishFailed', Either.isLeft(gaveUp) && gaveUp.left._tag === 'PublishFailed' && seen.length === 2);

seen.length = 0;
answers = [() => { throw new TypeError('fetch failed'); }];
check('a network failure is retried once', Either.isRight(await run(track)) && seen.length === 2);

seen.length = 0;
check('the disabled layer sends nothing', Either.isRight(await run(track, Events.layerDisabled)) && seen.length === 0);

const fromConfig = Events.layerConfig.pipe(Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map([['SNEKOT_TOKEN', 'sk_env'], ['SNEKOT_PROJECT', 'from-env']])))));
check('layerConfig builds from configuration', Either.isRight(await Effect.runPromise(Effect.either(Effect.provide(Events, fromConfig)))));
check('layerConfig fails without a token', Either.isLeft(await Effect.runPromise(Effect.either(Effect.provide(Events, Events.layerConfig.pipe(Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map())))))))));
seen.length = 0;
answers = [() => new Response('{"experiment":"pricing","variant":"new"}', { status: 200 })];
const variant = await run(Effect.flatMap(Events, (events) => events.experiment({ experiment: 'pricing', variants: ['control', 'new'], user_id: 'user-1' })));
check('experiment answers with the variant the server chose', Either.isRight(variant) && variant.right === 'new' && seen[0].path === '/v1/experiment');
seen.length = 0;
const quiet = await run(Effect.flatMap(Events, (events) => events.experiment({ experiment: 'pricing', variants: ['control', 'new'] })), Events.layerDisabled);
check('disabled, an experiment is its first variant and sends nothing', Either.isRight(quiet) && quiet.right === 'control' && seen.length === 0);
seen.length = 0;
answers = [() => new Response('{"flag":"new-checkout","on":true}', { status: 200 })];
const on = await run(Effect.flatMap(Events, (events) => events.flag({ flag: 'new-checkout', user_id: 'user-1' })));
check('flag posts the key and the person, and is true when the server says on', Either.isRight(on) && on.right === true && isDeepStrictEqual({ method: seen[0].method, path: seen[0].path, body: seen[0].body }, { method: 'POST', path: '/v1/flag', body: { project: suite.project, flag: 'new-checkout', user_id: 'user-1' } }), seen[0]);
answers = [() => new Response('{"flag":"new-checkout","on":false}', { status: 200 })];
const off = await run(Effect.flatMap(Events, (events) => events.flag({ flag: 'new-checkout', user_id: 'user-2' })));
check('flag is false when the server says off', Either.isRight(off) && off.right === false);
seen.length = 0;
answers = [() => new Response('{"error":"flag is required"}', { status: 400 })];
const unasked = await run(Effect.flatMap(Events, (events) => events.flag({ flag: '' })));
check('a refused flag fails as PublishRefused, once', seen.length === 1 && Either.isLeft(unasked) && unasked.left._tag === 'PublishRefused' && unasked.left.status === 400);
seen.length = 0;
const dark = await run(Effect.flatMap(Events, (events) => events.flag({ flag: 'new-checkout', user_id: 'user-1' })), Events.layerDisabled);
check('disabled, a flag is off and sends nothing', Either.isRight(dark) && dark.right === false && seen.length === 0);

check('the token does not print', !String(Redacted.make('sk_secret')).includes('sk_secret'));

if (failed > 0) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
