import React from 'react';

interface MicroscopeReticleProps {
  zoom: number; // 0..4
  dialDeg: number;
}

const DIAL_TICKS = [
  { deg: -136, label: '10×' },
  { deg: -68, label: '2.5K×' },
  { deg: 0, label: '250K×' },
  { deg: 68, label: '8M×' },
  { deg: 136, label: '100M×' },
];

export const MicroscopeReticle: React.FC<MicroscopeReticleProps> = ({ zoom, dialDeg }) => {
  const show3nmBracket = zoom >= 3.55;
  const bracketOpacity = Math.max(0, Math.min(1, (zoom - 3.55) / 0.35));

  const r = 242;
  const circ = 2 * Math.PI * r;
  const frac = Math.max(0.03, Math.min(1, (zoom / 4) * 0.78 + 0.04));

  return (
    <div className="reticle-layer" aria-hidden="true">
      <svg className="reticle-svg" viewBox="0 0 540 540">
        <circle cx="270" cy="270" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.75" />

        {/* Frosted platinum magnification progress arc */}
        <circle
          cx="270"
          cy="270"
          r={r}
          fill="none"
          stroke="rgba(245, 245, 247, 0.34)"
          strokeWidth="1.25"
          strokeDasharray={`${circ * frac} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-226 270 270)"
        />

        <g transform={`rotate(${-dialDeg * 0.55} 270 270)`}>
          {Array.from({ length: 72 }).map((_, i) => {
            const ang = (i / 72) * Math.PI * 2;
            const isMajor = i % 6 === 0;
            const r1 = r - (isMajor ? 7 : 3.5);
            const r2 = r;
            return (
              <line
                key={i}
                x1={270 + Math.cos(ang) * r1}
                y1={270 + Math.sin(ang) * r1}
                x2={270 + Math.cos(ang) * r2}
                y2={270 + Math.sin(ang) * r2}
                stroke={isMajor ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)'}
                strokeWidth={isMajor ? '0.9' : '0.5'}
              />
            );
          })}
        </g>

        <line x1="259" y1="270" x2="265" y2="270" stroke="rgba(255,255,255,0.16)" strokeWidth="0.7" />
        <line x1="275" y1="270" x2="281" y2="270" stroke="rgba(255,255,255,0.16)" strokeWidth="0.7" />
        <line x1="270" y1="259" x2="270" y2="265" stroke="rgba(255,255,255,0.16)" strokeWidth="0.7" />
        <line x1="270" y1="275" x2="270" y2="281" stroke="rgba(255,255,255,0.16)" strokeWidth="0.7" />

        {DIAL_TICKS.map((tk) => {
          const rad = ((tk.deg - 90) * Math.PI) / 180;
          const tx = 270 + Math.cos(rad) * (r + 16);
          const ty = 270 + Math.sin(rad) * (r + 16);
          return (
            <text
              key={tk.label}
              x={tx}
              y={ty}
              fill="rgba(245, 245, 247, 0.28)"
              fontSize="7"
              fontFamily="'JetBrains Mono', monospace"
              fontWeight="500"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {tk.label}
            </text>
          );
        })}
      </svg>

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
