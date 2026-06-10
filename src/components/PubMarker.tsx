import React, { useCallback } from 'react';
import type { Pub } from '../types';

interface PubMarkerProps {
  pub: Pub;
  onClick: (pub: Pub) => void;
  isMini?: boolean;
}

export const PubMarker = React.memo<PubMarkerProps>(({ pub, onClick, isMini }) => {
  const handleClick = useCallback(() => {
    onClick(pub);
  }, [pub, onClick]);

  if (isMini) {
    return (
      <div 
        className={`pub-marker-mini ${pub.isSunny ? 'sunny' : 'loomy'}`} 
        title={pub.name} 
        onClick={handleClick}
      >
        <div className="mini-dot" />
        <div className="tooltip">{pub.name}</div>
      </div>
    );
  }

  return (
    <div className={`pub-marker ${pub.isSunny ? 'sunny' : 'loomy'}`} title={pub.name} onClick={handleClick}>
      <svg 
        width="32" 
        height="32" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        className="beer-icon"
      >
        {/* Beer liquid fill */}
        {pub.isSunny && (
          <path 
            d="M5 10v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10Z" 
            fill="var(--beer-gold)" 
            stroke="none"
          />
        )}
        <path d="M17 11h1a3 3 0 0 1 0 6h-1" />
        <path d="M9 12v6" />
        <path d="M13 12v6" />
        <path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 5 0c.81 0 1.5-.5 2.5-.5a2.5 2.5 0 0 1 5 0c.81 0 1.5-.5 2.5-.5 1 0 1.44.5 3 .5s2-.5 3-.5" />
        <path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
      </svg>
      {/* Tooltip hidden by default */}
      <div className="tooltip">{pub.name}</div>
    </div>
  );
});
