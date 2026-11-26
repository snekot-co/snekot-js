'use client';

/**
 * React and Next.js: `<EventsProvider token project endpoint>` once, then `useEvents()` anywhere under it.
 * The module is marked as a client module, so in Next's App Router it can be used straight from a server layout.
 */
import { useEffect, useState, type ReactNode } from 'react';

import { DEFAULT_ENDPOINT, type GroupOptions, type IdentifyOptions, type Properties, type TrackOptions } from './index.js';

type Command = 'setConfig' | 'setDebug' | 'setUserId' | 'clearUserId' | 'track' | 'identify' | 'group' | 'experiment' | 'flag' | 'subscribe' | 'remember' | 'trackPageView';

declare global {
  interface Window {
    snekot?: (command: Command, ...args: unknown[]) => void;
    snekotq?: { push: (args: unknown[]) => void } | unknown[][];
  }
}

const SCRIPT_ID = 'events-script';

/** Calls made before the script has loaded wait in `window.snekotq` and run in order when it arrives. */
function send(command: Command, ...args: unknown[]) {
  if (typeof window === 'undefined') return;
  window.snekotq = window.snekotq || [];
  window.snekot = window.snekot || ((...queued: unknown[]) => (window.snekotq as unknown[][]).push(queued));
  window.snekot(command, ...args);
}

export interface EventsProviderProps {
  /** A public key (`pk_…`). Anything in a web page can be read by the people who open it. */
  token: string;
  project: string;
  /** Where the script and the API are; another only when you pass them through your own domain. */
  endpoint?: string;
  /** Keep a random visitor id on the device, so the same visitor is the same person tomorrow. Off by default. */
  remember?: boolean;
  /** Record clicks on links to other sites. */
  outbound?: boolean;
  /** Record clicks on links to files. */
  downloads?: boolean;
  /** The channel outbound links and downloads are posted to; `web` by default. */
  channel?: string;
  children?: ReactNode;
}

/** Loads the browser script once and configures it. Use a key made for the browser, not a server's. */
export function EventsProvider({ token, project, endpoint = DEFAULT_ENDPOINT, remember, outbound, downloads, channel, children }: EventsProviderProps) {
  useEffect(() => {
    // The script is told where it was loaded from, so a site that passes it through its own domain sends there too.
    send('setConfig', token, project, { endpoint, remember, outbound, downloads, channel });
    // The script stays once it is in the page. Taking it out would not undo it, and putting it back would run it
    // a second time, which counts every page view and click twice. React's strict mode does exactly that in development.
    if (document.getElementById(SCRIPT_ID)) return;
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `${endpoint.replace(/\/$/, '')}/snekot.js`;
    document.head.appendChild(script);
  }, [token, project, endpoint, remember, outbound, downloads, channel]);
  return <>{children}</>;
}

/** Sets the signed-in user from a server-rendered layout; `null` clears it on sign-out. */
export function SetUserIdServerComponent({ userId }: { userId: string | null }) {
  useEffect(() => send('setUserId', userId || null), [userId]);
  return null;
}

/** Asks which variant of an A/B test this visitor gets. The answer waits for the script, so it also works before it has loaded. */
const experiment = (name: string, variants: readonly string[]) => new Promise<string>((resolve) => send('experiment', name, variants, resolve));

/** Asks whether a feature flag is on for this visitor. It is off when the answer cannot be had. The answer waits for the script. */
const flag = (key: string) => new Promise<boolean>((resolve) => send('flag', key, resolve));

/**
 * Puts an address on the project's newsletter list, from a signup field of your own. It answers true once the
 * server has it and false when it was refused or could not be reached. The answer waits for the script.
 */
const subscribe = (email: string, properties?: Properties, options?: { name?: string; language?: string; timezone?: string }) => new Promise<boolean>((resolve) => send('subscribe', email, properties, options, resolve));

/**
 * The visitor's variant of an A/B test, or null until it is known. Render the first variant, or nothing, while
 * it is null, so the page does not flip from one variant to another.
 */
export function useExperiment(name: string, variants: readonly string[]): string | null {
  const [variant, setVariant] = useState<string | null>(null);
  const list = variants.join('\n');
  useEffect(() => {
    let current = true;
    void experiment(name, list.split('\n')).then((answer) => current && setVariant(answer));
    return () => {
      current = false;
    };
  }, [name, list]);
  return variant;
}

/** Whether a feature flag is on for the visitor, or null until it is known. Render the flag as off while it is null. */
export function useFlag(key: string): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    void flag(key).then((answer) => current && setOn(answer));
    return () => {
      current = false;
    };
  }, [key]);
  return on;
}

const api = {
  setDebug: (flag = true) => send('setDebug', flag),
  /** Page views and events are tied to this user from now on; pass `null` when they sign out. */
  setUserId: (userId: string | null) => send('setUserId', userId),
  clearUserId: () => send('clearUserId'),
  track: (options: TrackOptions) => send('track', options),
  identify: (options: IdentifyOptions) => send('identify', options),
  group: (options: GroupOptions) => send('group', options),
  /** Keeps a visitor id on the device from now on, for a site that asks its visitors first; `false` stops and removes it. */
  remember: (flag = true) => send('remember', flag),
  /** Counts the current page. The script does this by itself; call it only if your router hides navigation from it. */
  trackPageView: () => send('trackPageView'),
  experiment,
  flag,
  subscribe,
};

export const useEvents = () => api;

