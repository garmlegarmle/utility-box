import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = '(max-width: 760px)';

export function useIsMobileTableLayout() {
  const getMatches = () => (typeof window === 'undefined' ? false : window.matchMedia(MOBILE_BREAKPOINT).matches);
  const [isMobileLayout, setIsMobileLayout] = useState(getMatches);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT);
    const update = () => setIsMobileLayout(mediaQuery.matches);
    update();

    // Safari < 14 uses addListener/removeListener instead of addEventListener/removeEventListener.
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);

      return () => mediaQuery.removeEventListener('change', update);
    }

    mediaQuery.addListener(update);

    return () => mediaQuery.removeListener(update);
  }, []);

  return isMobileLayout;
}
