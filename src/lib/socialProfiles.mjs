export function publicProfileUrl(value) {
  try {
    const url = new URL(value?.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

// Same profile the site's Person JSON-LD (`sameAs`) already publishes; override with NEXT_PUBLIC_LINKEDIN_URL.
export const DEFAULT_LINKEDIN_URL = 'https://www.linkedin.com/in/y-guo-6080733a5/';

// Explicit property access is required for Next.js build-time substitution.
export const socialProfiles = [
  { id: 'github', label: 'GitHub', url: publicProfileUrl(process.env.NEXT_PUBLIC_GITHUB_URL) },
  { id: 'leetcode', label: 'LeetCode', url: publicProfileUrl(process.env.NEXT_PUBLIC_LEETCODE_URL) },
  { id: 'instagram', label: 'Instagram', url: publicProfileUrl(process.env.NEXT_PUBLIC_INSTAGRAM_URL) },
  { id: 'linkedin', label: 'LinkedIn', url: publicProfileUrl(process.env.NEXT_PUBLIC_LINKEDIN_URL || DEFAULT_LINKEDIN_URL) },
].filter(profile => profile.url);
