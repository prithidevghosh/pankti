import React, { useEffect, useState } from 'react';

import { scripts } from './wordmarkStrokes.js';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)');

export function Wordmark() {
  const [reduced, setReduced] = useState(() => reducedMotion().matches);
  const [script, setScript] = useState(0);
  const [phase, setPhase] = useState('write');
  const [pinned, setPinned] = useState(false);
  const [advance, setAdvance] = useState(false);
  const { lang, name, box, weight, strokes, duration: writingTime } = scripts[script];
  const speed = phase === 'erase' ? 0.56 : 1;

  useEffect(() => {
    const query = reducedMotion();
    const sync = () => setReduced(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const durations = {
    write: writingTime * speed,
    hold: advance ? 260 : pinned ? null : 2400,
    erase: writingTime * speed,
    rest: 150,
  };
  const duration = durations[phase];
  useEffect(() => {
    if (reduced || duration === null) return;
    const timer = window.setTimeout(() => {
      if (phase === 'write') setPhase('hold');
      else if (phase === 'hold') setPhase('erase');
      else if (phase === 'erase') setPhase('rest');
      else {
        setScript(index => (index + 1) % scripts.length);
        setAdvance(false);
        setPhase('write');
      }
    }, duration);
    return () => window.clearTimeout(timer);
  }, [reduced, phase, duration]);

  function nextScript() {
    setPinned(true);
    if (reducedMotion().matches) {
      setScript(index => (index + 1) % scripts.length);
      setPhase('hold');
      setAdvance(false);
    } else {
      setAdvance(true);
    }
  }

  return (
    <button type="button" className="wordmark" onClick={nextScript}
      aria-label={`Pankti in ${name}. Show next script`}
      title="Change script and keep it here">
      <svg key={lang} viewBox={box} preserveAspectRatio="xMinYMid meet" aria-hidden="true"
        className="wordmark-ink" lang={lang} data-phase={reduced ? 'hold' : phase}
        fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round">
        {strokes.map(({ d, start, duration: travel }, index) => (
          <path key={index} d={d} pathLength="1" style={{
            '--travel': travel * speed + 'ms',
            '--lift': (phase === 'erase' ? writingTime - start - travel : start) * speed + 'ms',
          }} />
        ))}
      </svg>
    </button>
  );
}
