import { useEffect, useState } from 'react';
import { activeInstance } from '../config/active';

/**
 * Animated "thinking" status shown during the pre-text dead-air of a turn
 * (retrieval + generation, before the answer's first token lands — which with
 * Agent Studio arrives bunched at the end). Agent Studio doesn't stream tokens
 * during generation, so instead of a frozen spinner we show a forward-moving,
 * phase-labelled status with a shimmer bar + pulsing orb so the ~5s wait feels
 * alive. Purely indicative (time-cycled), not wired to real tool frames.
 *
 * Tokens only (no raw hex); animations are motion-safe (reduced-motion → calm).
 */
export function ThinkingIndicator() {
  const phases = [
    `Searching ${activeInstance.productTitle} docs`,
    'Reading the sources',
    'Writing the answer',
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    // Advance forward and hold on the last phase (progress should feel one-way).
    const id = setInterval(() => setI((p) => (p < phases.length - 1 ? p + 1 : p)), 1600);
    return () => clearInterval(id);
    // phases.length is constant for a given instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-2.5" role="status">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-4 w-4 items-center justify-center" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-ac-full bg-ac-accent opacity-40 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-ac-full bg-ac-accent" />
        </span>
        <span key={i} className="acs-think-label text-ac-sm font-ac-medium text-ac-text-secondary">
          {phases[i]}
          <span className="acs-ellipsis" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </span>
      </div>

      <div className="acs-shimmer h-1 w-full max-w-[220px] overflow-hidden rounded-ac-full bg-ac-surface-hover" aria-hidden="true" />

      <style>{`
        @keyframes acs-shimmer-move { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
        .acs-shimmer { position: relative; }
        .acs-shimmer::after {
          content: ''; position: absolute; inset: 0; width: 35%; border-radius: inherit;
          background: linear-gradient(90deg, transparent, var(--ac-accent), transparent);
        }
        @keyframes acs-label-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
        @keyframes acs-ell { 0%, 20% { opacity: 0; } 50% { opacity: 1; } 100% { opacity: 0; } }
        .acs-ellipsis span { opacity: 0; }
        @media (prefers-reduced-motion: no-preference) {
          .acs-shimmer::after { animation: acs-shimmer-move 1.25s ease-in-out infinite; }
          .acs-think-label { animation: acs-label-in var(--ac-dur-slow, 240ms) var(--ac-ease, ease); }
          .acs-ellipsis span { animation: acs-ell 1.2s infinite; }
          .acs-ellipsis span:nth-child(2) { animation-delay: .2s; }
          .acs-ellipsis span:nth-child(3) { animation-delay: .4s; }
        }
      `}</style>
    </div>
  );
}
