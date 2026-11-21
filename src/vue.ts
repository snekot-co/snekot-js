/**
 * Vue: `app.use(Events, { token, project, endpoint })`, then the named functions anywhere.
 * It needs nothing from Vue but the `install` convention.
 */
import { DEFAULT_ENDPOINT, type IdentifyOptions, type Properties, type TrackOptions } from './index.js';

type Queue = unknown[][] | { push: (args: unknown[]) => void };
type Browser = { snekot?: (...args: unknown[]) => void; snekotq?: Queue };

function send(...args: unknown[]) {
  if (typeof window === 'undefined') return;
  const browser = window as unknown as Browser;
  browser.snekotq = browser.snekotq || [];
  browser.snekot = browser.snekot || ((...queued: unknown[]) => (browser.snekotq as unknown[][]).push(queued));
  browser.snekot(...args);
}

export const setUserId = (userId: string | null) => send('setUserId', userId);
export const clearUserId = () => send('clearUserId');
export const setDebug = (flag = true) => send('setDebug', flag);
export const track = (options: TrackOptions) => send('track', options);
export const identify = (options: IdentifyOptions) => send('identify', options);
/** Which variant of an A/B test this visitor gets. The answer waits for the script, so it also works before it has loaded. */
export const experiment = (name: string, variants: readonly string[]) => new Promise<string>((resolve) => send('experiment', name, variants, resolve));
/** Puts an address on the project's newsletter list. It answers true once the server has it, false when it was refused or could not be reached. */
export const subscribe = (email: string, properties?: Properties, options?: { name?: string }) => new Promise<boolean>((resolve) => send('subscribe', email, properties, options, resolve));

export default {
  install(_app: unknown, { token, project, endpoint = DEFAULT_ENDPOINT }: { token: string; project: string; endpoint?: string }) {
    if (typeof document === 'undefined') return;
    // The script is told where it was loaded from, so a site that passes it through its own domain sends there too.
    send('setConfig', token, project, { endpoint });
    if (document.getElementById('events-script')) return;
    const script = document.createElement('script');
    script.id = 'events-script';
    script.async = true;
    script.src = `${endpoint.replace(/\/$/, '')}/snekot.js`;
    document.head.appendChild(script);
  },
};
