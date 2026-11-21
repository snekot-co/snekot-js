// Runs every server SDK method against the API: `SNEKOT_TOKEN=sk_… SNEKOT_PROJECT=slug pnpm smoke`.
import { Client, HTTPResponseError } from '../src/index.js';

const token = process.env.SNEKOT_TOKEN;
const project = process.env.SNEKOT_PROJECT;
if (!token || !project) throw new Error('Set SNEKOT_TOKEN and SNEKOT_PROJECT.');

const events = new Client({ token, project, endpoint: process.env.SNEKOT_ENDPOINT });
const results: Record<string, unknown> = {};
results.track = await events.track({ channel: 'sdk', event: 'SDK smoke test', icon: ':test_tube:', user_id: 'sdk-user', tags: { runtime: 'node' }, timestamp: new Date() });
results.identify = await events.identify({ user_id: 'sdk-user', properties: { name: 'SDK User', plan: 'free' } });
results.group = await events.group({ user_id: 'sdk-user', group_id: 'sdk-team', properties: { name: 'SDK Team' } });
results.subscribe = await events.subscribe({ email: 'sdk-user@example.com', name: 'SDK User', properties: { runtime: 'node' }, source: '/sdk' });
results.insightTrack = await events.insight.track({ title: 'SDK runs', value: 0 });
results.insightIncrement = await events.insight.increment({ title: 'SDK runs', value: 1 });
results.refused = await events.track({ channel: 'Not Valid', event: 'x' }).catch((error) => error instanceof HTTPResponseError && `${error.status}: ${error.message}`);
events.disableTracking();
results.disabled = (await events.track({ channel: 'sdk', event: 'never sent' })) && events.isTrackingDisabled();
console.log(results);
