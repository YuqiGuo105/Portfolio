import { Children, useEffect } from 'react';
import { getAnalyticsConsent, trackBehavior } from '../../lib/behaviorAnalytics';
import { SECTION_ORDER } from '../../lib/discovery/core.mjs';

export default function HomeSections({ variant = 'original', children }) {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DISCOVERY_ENABLED !== '1' || getAnalyticsConsent() !== 'granted') return undefined;
    const cookie = document.cookie.split('; ').find(value => value.startsWith('yuqi_home='))?.split('=')[1];
    const campaign = cookie?.split('.')[0];
    if (!['linkedin', 'github', 'direct'].includes(campaign)) return undefined;
    const properties = { component: 'home', experimentId: 'home-v1', campaign, variant };
    trackBehavior('content_impression', { properties });
    const click = event => {
      const link = event.target.closest?.('a[href]');
      if (!link || !link.closest('#works-section, #Blog-section, #resume-section')) return;
      trackBehavior('content_open', { target: link.getAttribute('href'), properties });
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, [variant]);
  const sections = Children.toArray(children);
  const order = SECTION_ORDER[variant] || SECTION_ORDER.original;
  return <>{sections.sort((a, b) => order.indexOf(a.props.id) - order.indexOf(b.props.id))}</>;
}
