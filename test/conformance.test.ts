// Runs the shared cases in conformance.json against the client with a recording `fetch`:
// `pnpm conformance`.
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { Client, HTTPResponseError } from '../src/index.js';

interface Case {
  call: 'track' | 'identify' | 'group' | 'subscribe' | 'insight.track' | 'insight.increment';
  args: Record<string, unknown>;
  expect: { method: string; path: string; body: unknown };
}
const suite = JSON.parse(readFileSync(new URL('./conformance.json', import.meta.url), 'utf8')) as { project: string; cases: Case[] };

const seen: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];
let answers: (() => Response)[] = [];
const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
  seen.push({ method: init?.method ?? 'GET', path: new URL(String(url)).pathname, body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
  const answer = answers.shift();
  return answer ? answer() : new Response('{}', { status: 200 });
}) as typeof fetch;

const client = new Client({ token: 'sk_test', project: suite.project, endpoint: 'http://sdk.test', fetch: fetcher });
const run = (entry: Case): Promise<boolean> => {
  const args = entry.args as never;
  if (entry.call === 'insight.track') return client.insight.track(args);
  if (entry.call === 'insight.increment') return client.insight.increment(args);
  return client[entry.call](args);
};

let failed = 0;
const check = (name: string, pass: boolean, detail?: unknown) => {
  if (!pass) failed += 1;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass || detail === undefined ? '' : `\n     ${JSON.stringify(detail)}`}`);
};

for (const entry of suite.cases) {
  seen.length = 0;
  await run(entry);
  const { headers, ...request } = seen[0];
  check(`${entry.call} ${JSON.stringify(entry.args).slice(0, 48)}`, isDeepStrictEqual(request, entry.expect), request);
  check('  sends the key as a bearer token', headers.Authorization === 'Bearer sk_test' && headers['Content-Type'] === 'application/json');
}

seen.length = 0;
answers = [() => new Response('{"error":"bad channel"}', { status: 400 })];
const refusal = await client.track({ channel: 'x', event: 'y' }).catch((error: unknown) => error);
check('a 4xx is not retried and carries the server\'s sentence', seen.length === 1 && refusal instanceof HTTPResponseError && refusal.status === 400 && refusal.message.includes('bad channel'));

seen.length = 0;
answers = [() => new Response('{}', { status: 503 })];
check('a 5xx is retried once', (await client.track({ channel: 'x', event: 'y' })) === true && seen.length === 2);

seen.length = 0;
answers = [() => { throw new TypeError('fetch failed'); }];
check('a network failure is retried once', (await client.track({ channel: 'x', event: 'y' })) === true && seen.length === 2);

seen.length = 0;
client.disableTracking();
check('disabled tracking sends nothing', (await client.track({ channel: 'x', event: 'y' })) === true && seen.length === 0);

// An experiment is the one call that reads its answer. It is in this SDK only, so it is checked here and not in conformance.json.
const asking = new Client({ token: 'sk_test', project: suite.project, endpoint: 'http://sdk.test', fetch: fetcher });
seen.length = 0;
answers = [() => new Response('{"experiment":"pricing","variant":"new"}', { status: 200 })];
const variant = await asking.experiment({ experiment: 'pricing', variants: ['control', 'new'], user_id: 'user-1' });
check('experiment posts the name, the variants and the person', isDeepStrictEqual({ method: seen[0].method, path: seen[0].path, body: seen[0].body }, { method: 'POST', path: '/v1/experiment', body: { project: suite.project, experiment: 'pricing', variants: ['control', 'new'], user_id: 'user-1' } }), seen[0]);
check('  and answers with the variant the server chose', variant === 'new');
seen.length = 0;
asking.disableTracking();
check('with tracking disabled an experiment is its first variant and sends nothing', (await asking.experiment({ experiment: 'pricing', variants: ['control', 'new'] })) === 'control' && seen.length === 0);

// A flag reads its answer too: on or off.
const flagging = new Client({ token: 'sk_test', project: suite.project, endpoint: 'http://sdk.test', fetch: fetcher });
seen.length = 0;
answers = [() => new Response('{"flag":"new-checkout","on":true}', { status: 200 })];
const on = await flagging.flag({ flag: 'new-checkout', user_id: 'user-1' });
check('flag posts the key and the person', isDeepStrictEqual({ method: seen[0].method, path: seen[0].path, body: seen[0].body }, { method: 'POST', path: '/v1/flag', body: { project: suite.project, flag: 'new-checkout', user_id: 'user-1' } }), seen[0]);
check('  and is true when the server says on', on === true);
answers = [() => new Response('{"flag":"new-checkout","on":false}', { status: 200 })];
check('  and false when the server says off', (await flagging.flag({ flag: 'new-checkout', user_id: 'user-2' })) === false);
seen.length = 0;
answers = [() => new Response('{"error":"flag is required"}', { status: 400 })];
const unasked = await flagging.flag({ flag: '' }).catch((error: unknown) => error);
check('a refused flag throws, once, with the server\'s sentence', seen.length === 1 && unasked instanceof HTTPResponseError && unasked.status === 400 && unasked.message.includes('flag is required'));
seen.length = 0;
answers = [() => new Response('{}', { status: 503 }), () => new Response('{"flag":"new-checkout","on":true}', { status: 200 })];
check('a 5xx on a flag is retried once', (await flagging.flag({ flag: 'new-checkout' })) === true && seen.length === 2);
seen.length = 0;
answers = [() => new Response('{}', { status: 503 }), () => new Response('{}', { status: 503 })];
const unanswered = await flagging.flag({ flag: 'new-checkout' }).catch((error: unknown) => error);
check('two 5xx in a row on a flag throw', seen.length === 2 && unanswered instanceof HTTPResponseError && unanswered.status === 503);
seen.length = 0;
flagging.disableTracking();
check('with tracking disabled a flag is off and sends nothing', (await flagging.flag({ flag: 'new-checkout', user_id: 'user-1' })) === false && seen.length === 0);

if (failed > 0) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
