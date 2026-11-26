import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

export function SignupVoice({ disabled, onBusy, onRecording, onError, label = 'Fill by voice', processing = 'Filling details…' }) {
  const [phase, setPhase] = useState('idle');
  const current = useRef(null);

  useEffect(() => () => {
    const capture = current.current;
    current.current = null;
    if (capture) {
      clearTimeout(capture.timer);
      capture.stream?.getTracks().forEach((track) => track.stop());
    }
  }, []);

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
        throw new Error('Microphone recording is unavailable in this browser. You can still type your details.');
      capture.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current.current !== capture) return release();

      const recorder = new MediaRecorder(capture.stream);
      capture.recorder = recorder;
      const chunks = [];
      recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
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
      recorder.start();
      capture.timer = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 25000);
      setPhase('recording');
    } catch (error) {
      if (current.current === capture) {
        onError(error.name === 'NotAllowedError' ? 'Allow microphone access, then try recording again.' : error.message);
      }
      finish();
    }
  }

  return (
    <button
      className="signup-voice" data-phase={phase}
      type="button"
      disabled={disabled || phase === 'opening' || phase === 'reading'}
      onClick={() => {
        if (phase !== 'recording') void start();
        else if (current.current?.recorder.state === 'recording') current.current.recorder.stop();
      }}
    >
      <span className="mic-disc" aria-hidden="true">{phase === 'recording' ? <Square size={16} /> : <Mic size={17} />}</span>
      <span aria-live="polite">{{ idle: label, opening: 'Opening microphone…', recording: 'Finish recording', reading: processing }[phase]}</span>
    </button>
  );
}
