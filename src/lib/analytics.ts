export const GA_MEASUREMENT_ID = 'G-MMR6EX7NN5';

type GtagCommand = 'js' | 'config' | 'event';

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (command: GtagCommand, target: string | Date, params?: Record<string, unknown>) => void;
  }
}

function analyticsEnabled(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function installGoogleAnalytics() {
  if (!analyticsEnabled()) return;

  const scriptSrc = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  if (!document.querySelector(`script[src="${scriptSrc}"]`)) {
    const script = document.createElement('script');
    script.async = true;
    script.src = scriptSrc;
    document.head.appendChild(script);
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag(command: GtagCommand, target: string | Date, params?: Record<string, unknown>) {
      window.dataLayer.push([command, target, params]);
    };

  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false });
}

export function trackPageView(pagePath: string) {
  if (!analyticsEnabled() || typeof window.gtag !== 'function') return;

  window.gtag('event', 'page_view', {
    page_path: pagePath,
    page_location: window.location.href
  });
}
