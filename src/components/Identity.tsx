import { useState } from 'react';
import { publicSourceDomain } from '../lib/source-intelligence';

export interface DomainIdentityProps {
  url: string;
  name?: string;
  size?: number;
  className?: string;
}

/** A real website icon, with a deterministic letter mark when unavailable. */
export function DomainIdentity({ url, name, size = 36, className = '' }: DomainIdentityProps) {
  const domain = publicSourceDomain(url);
  const [failedDomain, setFailedDomain] = useState<string | null>(null);
  const label = name || domain || 'Source';
  const initials =
    label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || '?';
  const hue =
    [...(domain || label)].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
  return (
    <span
      className={`domain-identity ${className}`.trim()}
      role="img"
      aria-label={`${label}${domain ? ` · ${domain}` : ''}`}
      title={domain || label}
      style={{
        display: 'inline-flex',
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        overflow: 'hidden',
        background: `hsl(${hue} 32% 88%)`,
        color: `hsl(${hue} 40% 24%)`,
        fontSize: size * 0.34,
        fontWeight: 800,
        letterSpacing: '-.04em',
      }}
    >
      {domain && failedDomain !== domain ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`}
          alt=""
          aria-hidden="true"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedDomain(domain)}
          style={{ width: '68%', height: '68%', objectFit: 'contain' }}
        />
      ) : (
        initials
      )}
    </span>
  );
}
