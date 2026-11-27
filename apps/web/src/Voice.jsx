import React from 'react';
import { SignupVoice } from './SignupVoice.jsx';
import { request } from './api.js';
export function Voice({ task, label, context, disabled, onResult, onBusy, onError }) {
  return (
    <SignupVoice
      label={label}
      processing="Reading your note…"
      disabled={disabled}
      onBusy={onBusy}
      onError={onError}
      onRecording={async (audio) => {
        const form = new FormData();
        form.append(
          'audio',
          audio,
          'note.' + (audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm'),
        );
        form.append('context', JSON.stringify(context || {}));
        onResult(await request('/voice/' + task, { body: form }));
      }}
    />
  );
}
