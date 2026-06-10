import React from 'react';

interface PubMarkerProps {
  isSunny: boolean;
  name: string;
  onClick?: () => void;
}

export const PubMarker: React.FC<PubMarkerProps> = ({ isSunny, name, onClick }) => {
  return (
    <div className={`pub-marker ${isSunny ? 'sunny' : 'loomy'}`} title={name} onClick={onClick}>
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
        <path d="M17 11h1a3 3 0 0 1 0 6h-1" />
        <path d="M9 12v6" />
        <path d="M13 12v6" />
        <path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 5 0c.81 0 1.5-.5 2.5-.5a2.5 2.5 0 0 1 5 0c.81 0 1.5-.5 2.5-.5 1 0 1.44.5 3 .5s2-.5 3-.5" />
        <path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
        {/* Beer liquid fill */}
        {isSunny && (
          <path 
            d="M5 10v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10Z" 
            fill="var(--beer-gold)" 
            stroke="none"
          />
        )}
      </svg>
      {/* Tooltip hidden by default */}
      <div className="tooltip">{name}</div>
    </div>
  );
};
