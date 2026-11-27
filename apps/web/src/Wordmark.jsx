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
  const [manual, setManual] = useState(false);
  const [frame, setFrame] = useState({ script: 0, count: 1 });
  const { lang, name, units } = scripts[frame.script];
  const complete = frame.count >= units.length;

  useEffect(() => {
    const query = reducedMotion();
    const sync = () => setReduced(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (reduced || (manual && complete)) return;
    const timer = window.setTimeout(() => {
      setFrame(complete
        ? { script: (frame.script + 1) % scripts.length, count: 1 }
        : { ...frame, count: frame.count + 1 });
    }, complete ? 3500 : 175);
    return () => window.clearTimeout(timer);
  }, [frame, complete, manual, reduced]);

  function nextScript() {
    setManual(true);
    setFrame(current => ({ script: (current.script + 1) % scripts.length, count: 1 }));
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
      <span lang={lang} aria-hidden="true">{(reduced ? units : units.slice(0, frame.count)).join('')}</span>
    </button>
  );
}
