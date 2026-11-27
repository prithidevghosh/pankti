import React, { useEffect, useState } from 'react';

// Reveal whole writing units so the vowel signs and conjuncts stay attached.
const scripts = [
  { lang: 'en', name: 'English', units: [...'Pankti'] },
  { lang: 'hi', name: 'Hindi', units: ['पं', 'क्ति'] },
  { lang: 'bn', name: 'Bengali', units: ['পং', 'ক্তি'] },
  { lang: 'gu', name: 'Gujarati', units: ['પં', 'ક્તિ'] },
];
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)');

export function Wordmark() {
  const [reduced, setReduced] = useState(() => reducedMotion().matches);
  const [script, setScript] = useState(0);
  const [phase, setPhase] = useState('write');
  const [pinned, setPinned] = useState(false);
  const [advance, setAdvance] = useState(false);
  const { lang, name, units } = scripts[script];
  const step = lang === 'en' ? 215 : 510;
  const beat = phase === 'erase' ? step * 0.6 : step;

  useEffect(() => {
    const query = reducedMotion();
    const sync = () => setReduced(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const durations = {
    write: units.length * beat,
    hold: advance ? 260 : pinned ? null : 2400,
    erase: units.length * beat,
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
      {scripts.map(script => (
        <span key={script.lang} className="wordmark-measure" lang={script.lang} aria-hidden="true">
          {script.units.join('')}
        </span>
      ))}
      <span key={lang} lang={lang} className="wordmark-ink" data-phase={reduced ? 'hold' : phase} aria-hidden="true">
        {units.map((unit, i) => (
          <span className="ink-unit" key={i} style={{
            '--beat': beat + 'ms',
            '--delay': (phase === 'erase' ? units.length - 1 - i : i) * beat + 'ms',
          }}>
            <span className="ink-guide">{unit}</span>
            <span className="ink-stem">{unit}</span>
            <span className="ink-turn">{unit}</span>
          </span>
        ))}
      </span>
    </button>
  );
}
