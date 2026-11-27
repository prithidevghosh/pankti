import React,{useEffect,useRef,useState} from 'react';
import {Mic,PhoneOff} from 'lucide-react';
import {ConversationOrb} from './ConversationOrb.jsx';
import {LiveOverviewCall} from './LiveOverviewCall.js';

export function OverviewVoice({date,days,visible}) {
  const [phase,setPhase]=useState('Idle'),[error,setError]=useState(''),[reply,setReply]=useState('');
  const call=useRef(null), period=useRef(null);
  period.current={date,days};
  useEffect(()=>()=>{call.current?.close();call.current=null;},[]);
  const active=phase!=='Idle';
  function end(){
    call.current?.close();call.current=null;
    setPhase('Idle');setError('');setReply('');
  }
  async function start(){
    if(call.current && !call.current.abort.signal.aborted) return;
    setError('');setReply('');setPhase('Connecting');
    const session=new LiveOverviewCall({phase:setPhase,message:setError,caption:setReply,period:()=>period.current});
    call.current=session;
    try{await session.start();}
    catch(e){if(call.current===session&&!session.abort.signal.aborted)session.fail(e.name==='NotAllowedError'?'Allow microphone access to start a conversation.':e.message);}
  }
  if(!visible&&!active) return null;
  return <section data-active={active} className={'conversation-panel'+(!visible?' conversation-compact':'')} aria-label="Business conversation">
    <div className="conversation-visual"><ConversationOrb phase={phase} call={call}/></div>
    <div className="conversation-copy">
      <h2>{active?'In conversation':'Talk to Pankti'}</h2>
      {active ? <p className="conversation-state" role="status"><i/>{phase}</p>
        : <p>Ask about your sales, bills or supplier payments.</p>}
      {reply && <p className="conversation-reply" aria-live="polite">{reply}</p>}
      {error && <p role="alert" className="conversation-error">{error}</p>}
      <button type="button" className={'conversation-control'+(active?'':' conversation-start')} onClick={active?end:start}>
        {active?<PhoneOff size={16}/>:<span className="conversation-start-seal"><Mic size={18} strokeWidth={1.6}/></span>}
        {active?'End conversation':'Start conversation'}
      </button>
    </div>
  </section>;
}
