/**
 * React and Next.js: `<EventsProvider token project endpoint>` once, then `useEvents()` anywhere under it.
 * In Next's App Router, import this from a client component.
 */
import { useEffect, useState, type ReactNode } from 'react';

import { DEFAULT_ENDPOINT, type IdentifyOptions, type Properties, type TrackOptions } from './index.js';

type Command = 'setConfig' | 'setDebug' | 'setUserId' | 'clearUserId' | 'track' | 'identify' | 'group' | 'experiment' | 'subscribe';

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
  token: string;
  project: string;
  endpoint?: string;
  children?: ReactNode;
}

/** Loads the browser script once and configures it. Use a key made for the browser, not a server's. */
export function EventsProvider({ token, project, endpoint = DEFAULT_ENDPOINT, children }: EventsProviderProps) {
  useEffect(() => {
    // The script is told where it was loaded from, so a site that passes it through its own domain sends there too.
    send('setConfig', token, project, { endpoint });
    if (document.getElementById(SCRIPT_ID)) return;
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `${endpoint.replace(/\/$/, '')}/snekot.js`;
    document.head.appendChild(script);
    return () => script.remove();
  }, [token, project, endpoint]);
  return <>{children}</>;
}

/** Sets the signed-in user from a server-rendered layout; `null` clears it on sign-out. */
export function SetUserIdServerComponent({ userId }: { userId: string | null }) {
  useEffect(() => send('setUserId', userId || null), [userId]);
  return null;
}

/** Asks which variant of an A/B test this visitor gets. The answer waits for the script, so it also works before it has loaded. */
const experiment = (name: string, variants: readonly string[]) => new Promise<string>((resolve) => send('experiment', name, variants, resolve));

/**
 * Puts an address on the project's newsletter list, from a signup field of your own. It answers true once the
 * server has it and false when it was refused or could not be reached. The answer waits for the script.
 */
const subscribe = (email: string, properties?: Properties, options?: { name?: string }) => new Promise<boolean>((resolve) => send('subscribe', email, properties, options, resolve));

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

const api = {
  setDebug: (flag = true) => send('setDebug', flag),
  /** Page views and events are tied to this user from now on; pass `null` when they sign out. */
  setUserId: (userId: string | null) => send('setUserId', userId),
  clearUserId: () => send('clearUserId'),
  track: (options: TrackOptions) => send('track', options),
  identify: (options: IdentifyOptions) => send('identify', options),
  experiment,
  subscribe,
};

export const useEvents = () => api;

