import React, {useEffect,useRef,useState} from 'react';
import {SignupVoice} from './SignupVoice.jsx';
import {request} from './api.js';

export function OverviewVoice({date,days}) {
  const [answer,setAnswer]=useState(null);
  const [playback,setPlayback]=useState(null);
  const [audioLoading,setAudioLoading]=useState(false);
  const [error,setError]=useState('');
  const audio=useRef(null);
  const pending=useRef(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  useEffect(()=>{
    if(!answer?.voiceId) return;
    const controller=new AbortController();
    setAudioLoading(true);
    request('/overview/'+answer.voiceId+'/speech',{method:'POST',signal:controller.signal})
      .then(({audio})=>{if(!controller.signal.aborted) setPlayback(audio);})
      .catch(()=>{})
      .finally(()=>{if(!controller.signal.aborted) setAudioLoading(false);});
    return ()=>controller.abort();
  },[answer]);
  useEffect(()=>{
    if(playback) audio.current?.play().catch(()=>{ /* Tap to play on browsers that block autoplay. */ });
  },[playback]);
  return <section className="overview-voice" aria-labelledby="overview-voice-title">
    <header><div><h2 id="overview-voice-title">Ask about your business</h2>
      <p>What sold most today? How many bills are still unpaid?</p></div>
      <SignupVoice label="Ask by voice" processing="Checking the ledger…" onBusy={busy=>{
        if(busy) {audio.current?.pause();setAnswer(null);setPlayback(null);setAudioLoading(false);setError('');}
      }} onError={setError} onRecording={async recording=>{
        const body=new FormData();
        body.append('audio',recording,'question');body.append('date',date);body.append('days',days);
        const controller=new AbortController(); pending.current=controller;
        const result=await request('/overview/ask',{body,signal:controller.signal});
        if(!controller.signal.aborted) setAnswer(result);
      }}/>
    </header>
    {error && <p role="alert">{error}</p>}
    {answer && <div className="overview-answer" lang={answer.language}>
      <blockquote>{answer.transcript}</blockquote>
      <p role="status">{answer.text}</p>
      {playback ? <audio ref={audio} controls aria-label="Spoken answer" src={'data:audio/wav;base64,'+playback}/>
        : <small>{audioLoading?'Preparing spoken answer…':'Audio playback unavailable for this answer.'}</small>}
    </div>}
  </section>;
}
