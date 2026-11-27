import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, LoaderCircle } from 'lucide-react';
import './voice-control.css';

export function SignupVoice({
  disabled,
  onBusy,
  onRecording,
  onError,
  label = 'Fill by voice',
  processing = 'Filling details…',
}) {
  const [phase, setPhase] = useState('idle');
  const current = useRef(null);

  const disc = useRef(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase !== 'recording') return;
    const start = performance.now();
    const timer = setInterval(() => setElapsed(Math.floor((performance.now() - start) / 1000)), 250);
    let frame, audio;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!motion.matches && window.AudioContext) {
      try {
        audio = new AudioContext();
        const analyser = audio.createAnalyser();
        analyser.fftSize = 256;
        audio.createMediaStreamSource(current.current.stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        function draw() {
          analyser.getByteTimeDomainData(data);
          const power = data.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0);
          const level = Math.min(1, Math.sqrt(power / data.length) * 5);
          disc.current?.style.setProperty('--halo-size', (1.04 + level * 0.22).toFixed(3));
          frame = requestAnimationFrame(draw);
        }
        void audio.resume().catch(() => {});
        draw();
      } catch { /* Recording remains available without metering. */ }
    }
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(frame);
      if (audio) void audio.close().catch(() => {});
      disc.current?.style.removeProperty('--halo-size');
    };
  }, [phase]);

  useEffect(
    () => () => {
      const capture = current.current;
      current.current = null;
      if (capture) {
        clearTimeout(capture.timer);
        capture.stream?.getTracks().forEach((track) => track.stop());
      }
    },
    [],
  );

  async function start() {
    if (current.current) return;
    const capture = {};
    current.current = capture;
    onError('');
    onBusy(true);
    setPhase('opening');

    function release() {
      clearTimeout(capture.timer);
      capture.stream?.getTracks().forEach((track) => track.stop());
    }
    function finish() {
      release();
      if (current.current !== capture) return;
      current.current = null;
      onBusy(false);
      setPhase('idle');
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
        throw new Error(
          'Microphone recording is unavailable in this browser. You can still type your details.',
        );
      capture.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current.current !== capture) return release();

      const recorder = new MediaRecorder(capture.stream);
      capture.recorder = recorder;
      const chunks = [];
      recorder.ondataavailable = ({ data }) => {
        if (data.size) chunks.push(data);
      };
      recorder.onerror = () => {
        if (current.current === capture) onError('Recording stopped unexpectedly. Try again.');
        finish();
      };
      recorder.onstop = async () => {
        release();
        if (current.current !== capture) return;
        setPhase('reading');
        try {
          const type = recorder.mimeType || chunks[0]?.type || 'audio/webm';
          const audio = new Blob(chunks, { type });
          if (!audio.size) throw new Error('No audio was recorded. Try again.');
          await onRecording(audio);
        } catch (error) {
          if (current.current === capture) onError(error.message);
        } finally {
          finish();
        }
      };
      setElapsed(0);
      recorder.start();
      capture.timer = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 25000);
      setPhase('recording');
    } catch (error) {
      if (current.current === capture) {
        onError(
          error.name === 'NotAllowedError'
            ? 'Allow microphone access, then try recording again.'
            : error.message,
        );
      }
      finish();
    }
  }

  const caption = { idle: label, opening: 'Opening microphone…', recording: 'Finish recording', reading: processing }[phase];
  return (
    <button className="voice-control" data-phase={phase} type="button"
      aria-pressed={phase === 'recording'} aria-label={caption}
      disabled={(disabled && phase !== 'recording') || phase === 'opening' || phase === 'reading'}
      onClick={() => {
        if (phase !== 'recording') void start();
        else if (current.current?.recorder.state === 'recording') current.current.recorder.stop();
      }}>
      <span className="voice-disc" ref={disc} aria-hidden="true">
        {phase === 'recording' ? <Square size={14} fill="currentColor" /> :
          phase === 'reading' || phase === 'opening' ? <LoaderCircle size={19}/> : <Mic size={20} strokeWidth={1.8}/>}
      </span>
      <span className="voice-caption">
        <span aria-hidden="true" className="voice-reserve">Finish recording</span>
        <span aria-live="polite">{caption}</span>
      </span>
      {phase === 'recording' && <span className="voice-time" aria-hidden="true">0:{String(elapsed).padStart(2,'0')}</span>}
    </button>
  );
}
