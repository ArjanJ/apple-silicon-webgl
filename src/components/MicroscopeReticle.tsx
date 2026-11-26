import React from 'react';

interface MicroscopeReticleProps {
  zoom: number; // 0..4
  magText: string;
  sizeText: string;
  dialDeg: number;
}

const DIAL_TICKS = [
  { deg: -136, label: '10×' },
  { deg: -68, label: '2.5K×' },
  { deg: 0, label: '250K×' },
  { deg: 68, label: '8M×' },
  { deg: 136, label: '100M×' },
];

export const MicroscopeReticle: React.FC<MicroscopeReticleProps> = ({ zoom, magText, sizeText, dialDeg }) => {
  const show3nmBracket = zoom >= 3.55;
  const bracketOpacity = Math.max(0, Math.min(1, (zoom - 3.55) / 0.35));

  const r = 242;
  const circ = 2 * Math.PI * r;
  const frac = Math.max(0.03, Math.min(1, (zoom / 4) * 0.78 + 0.04));

  return (
    <div className="reticle-layer" aria-hidden="true">
      <svg className="reticle-svg" viewBox="0 0 540 540">
        <circle cx="270" cy="270" r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="0.9" />

        <circle
          cx="270"
          cy="270"
          r={r}
          fill="none"
          stroke="rgba(78, 196, 255, 0.42)"
          strokeWidth="1.6"
          strokeDasharray={`${circ * frac} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-226 270 270)"
        />

        <g transform={`rotate(${-dialDeg * 0.55} 270 270)`}>
          {Array.from({ length: 72 }).map((_, i) => {
            const ang = (i / 72) * Math.PI * 2;
            const isMajor = i % 6 === 0;
            const r1 = r - (isMajor ? 8 : 4);
            const r2 = r;
            return (
              <line
                key={i}
                x1={270 + Math.cos(ang) * r1}
                y1={270 + Math.sin(ang) * r1}
                x2={270 + Math.cos(ang) * r2}
                y2={270 + Math.sin(ang) * r2}
                stroke={isMajor ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.09)'}
                strokeWidth={isMajor ? '1' : '0.6'}
              />
            );
          })}
        </g>

        <line x1="258" y1="270" x2="265" y2="270" stroke="rgba(255,255,255,0.16)" strokeWidth="0.8" />
        <line x1="275" y1="270" x2="282" y2="270" stroke="rgba(255,255,255,0.16)" strokeWidth="0.8" />
        <line x1="270" y1="258" x2="270" y2="265" stroke="rgba(255,255,255,0.16)" strokeWidth="0.8" />
        <line x1="270" y1="275" x2="270" y2="282" stroke="rgba(255,255,255,0.16)" strokeWidth="0.8" />

        {DIAL_TICKS.map((tk) => {
          const rad = ((tk.deg - 90) * Math.PI) / 180;
          const tx = 270 + Math.cos(rad) * (r + 16);
          const ty = 270 + Math.sin(rad) * (r + 16);
          return (
            <text
              key={tk.label}
              x={tx}
              y={ty}
              fill="rgba(245, 245, 247, 0.34)"
              fontSize="7.5"
              fontFamily="'JetBrains Mono', monospace"
              fontWeight="600"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {tk.label}
            </text>
          );
        })}
      </svg>

      {/* Bottom-left Precision Physical Scale Ruler */}
      <div className="scale-ruler">
        <div className="ruler-bar" />
        <div className="ruler-text">
          <span>{sizeText}</span>
          <span className="ruler-sep">·</span>
          <span className="ruler-mag">{magText}</span>
        </div>
      </div>

      {/* Peak 3nm Feature Bracket */}
      {show3nmBracket && (
        <div className="nm-bracket" style={{ opacity: bracketOpacity }}>
          <div className="nm-line" />
          <div className="nm-label">3 nm · ~11 Silicon Atoms</div>
          <div className="nm-line" />
        </div>
      )}
    </div>
  );
};
