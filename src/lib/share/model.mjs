import { DEFAULT_LINKEDIN_URL } from '../socialProfiles.mjs';
import { GITHUB_PROFILE_URL } from '../githubProfileBadge.mjs';
import { SITE_ORIGIN } from './link.mjs';

// Explicit public fields only; never spread a work-history row or private contact settings.
export function publicProfile(role) {
  return {
    given: 'Yuqi', family: 'Guo', name: 'Yuqi Guo', nickname: '郭育奇',
    title: role?.title || 'Software Engineer', company: role?.company || '',
    site: SITE_ORIGIN, photo: '/assets/images/yuqi-guo-card-320.jpg',
    links: [{ label: 'LinkedIn', url: DEFAULT_LINKEDIN_URL }, { label: 'GitHub', url: GITHUB_PROFILE_URL }],
  };
}
