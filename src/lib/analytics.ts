export const GA_MEASUREMENT_ID = 'G-MMR6EX7NN5';

type GtagCommand = 'js' | 'config' | 'event';
type GtagParams = Record<string, unknown>;
type GtagFunction = {
  (command: 'js', date: Date): void;
  (command: 'config', target: string, params?: GtagParams): void;
  (command: 'event', eventName: string, params?: GtagParams): void;
};

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: GtagFunction;
  }
}

function analyticsEnabled(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function trackPageView(pagePath: string) {
  if (!analyticsEnabled() || typeof window.gtag !== 'function') return;

  window.gtag('event', 'page_view', {
    page_path: pagePath,
    page_location: window.location.href
  });
}
