/**
 * Vue: `app.use(Events, { token, project, endpoint })`, then the named functions anywhere.
 * It needs nothing from Vue but the `install` convention.
 */
import { DEFAULT_ENDPOINT, type GroupOptions, type IdentifyOptions, type Properties, type TrackOptions } from './index.js';

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
export const group = (options: GroupOptions) => send('group', options);
/** Keeps a visitor id on the device from now on, for a site that asks its visitors first; `false` stops and removes it. */
export const remember = (flag = true) => send('remember', flag);
/** Counts the current page. The script does this by itself; call it only if your router hides navigation from it. */
export const trackPageView = () => send('trackPageView');
/** Which variant of an A/B test this visitor gets. The answer waits for the script, so it also works before it has loaded. */
export const experiment = (name: string, variants: readonly string[]) => new Promise<string>((resolve) => send('experiment', name, variants, resolve));
/** Puts an address on the project's newsletter list. It answers true once the server has it, false when it was refused or could not be reached. */
export const subscribe = (email: string, properties?: Properties, options?: { name?: string }) => new Promise<boolean>((resolve) => send('subscribe', email, properties, options, resolve));

export interface EventsPluginOptions {
  /** A public key (`pk_…`). */
  token: string;
  project: string;
  endpoint?: string;
  /** Keep a random visitor id on the device. Off by default. */
  remember?: boolean;
  /** Record clicks on links to other sites. */
  outbound?: boolean;
  /** Record clicks on links to files. */
  downloads?: boolean;
  /** The channel outbound links and downloads are posted to; `web` by default. */
  channel?: string;
}

export default {
  install(_app: unknown, { token, project, endpoint = DEFAULT_ENDPOINT, remember, outbound, downloads, channel }: EventsPluginOptions) {
    if (typeof document === 'undefined') return;
    // The script is told where it was loaded from, so a site that passes it through its own domain sends there too.
    send('setConfig', token, project, { endpoint, remember, outbound, downloads, channel });
    if (document.getElementById('events-script')) return;
    const script = document.createElement('script');
    script.id = 'events-script';
    script.async = true;
    script.src = `${endpoint.replace(/\/$/, '')}/snekot.js`;
    document.head.appendChild(script);
  },
};
