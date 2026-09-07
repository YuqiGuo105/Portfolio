import { socialProfiles } from '../lib/socialProfiles.mjs';
import styles from './SocialLinks.module.css';

export default function SocialLinks({ onVisit, className = '' }) {
  if (!socialProfiles.length) return null;
  return (
    <div className={`${styles.links} ${className}`} aria-label="Social profiles" role="group">
      {socialProfiles.map(profile => (
        <a key={profile.id} href={profile.url} target="_blank" rel="noopener noreferrer"
          aria-label={`${profile.label} profile (opens in a new tab)`}
          onClick={() => onVisit?.(profile.url)}>
          {profile.id === 'leetcode'
            ? <span className={styles.leetcode} aria-hidden="true" />
            : <i className={`fab fa-${profile.id}`} aria-hidden="true" />}
          <span className={styles.tooltip} aria-hidden="true">{profile.label}</span>
        </a>
      ))}
    </div>
  );
}
