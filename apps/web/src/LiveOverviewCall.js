import {request} from './api.js';

function wave(pcm,rate){
  const header=new DataView(new ArrayBuffer(44));
  function tag(offset,label){for(const letter of label) header.setUint8(offset++,letter.charCodeAt(0));}
  tag(0,'RIFF');header.setUint32(4,36+pcm.byteLength,true);tag(8,'WAVE');tag(12,'fmt ');
  header.setUint32(16,16,true);header.setUint16(20,1,true);header.setUint16(22,1,true);
  header.setUint32(24,rate,true);header.setUint32(28,rate*2,true);
  header.setUint16(32,2,true);header.setUint16(34,16,true);tag(36,'data');
  header.setUint32(40,pcm.byteLength,true);
  return new Blob([header.buffer,pcm],{type:'audio/wav'});
}
export class LiveOverviewCall {
  constructor({phase, message, caption, period, changed}) {
    Object.assign(this,{phase,message,caption,period,changed});
    this.abort=new AbortController();
    this.turn=0;
  }
  async start() {
    this.context=new AudioContext();
    await this.context.resume();
    if(this.abort.signal.aborted) return;
    await request('/overview/live',{body:{},signal:this.abort.signal});
    await this.context.audioWorklet.addModule('/overview-microphone.js');
    if(this.abort.signal.aborted) return;
    const mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(this.abort.signal.aborted){mic.getTracks().forEach(t=>t.stop());return;}
    this.mic=mic;
    this.input=this.context.createAnalyser();
    this.input.fftSize=256;
    this.source=this.context.createMediaStreamSource(mic);
    this.source.connect(this.input);
    this.output=this.context.createAnalyser();
    this.output.fftSize=256;
    this.output.connect(this.context.destination);
    this.samples=new Uint8Array(256);
    this.processor=new AudioWorkletNode(this.context,'overview-microphone');
    this.source.connect(this.processor);
    this.processor.connect(this.context.destination); // The processor outputs silence.
    this.processor.port.onmessage=({data})=>this.handle(data).catch(e=>this.recover(e));
    let language=navigator.language;
    try{language=localStorage.getItem('pankti.voice.language') || language;}catch{}
    const turn=this.turn;
    this.pending=new AbortController();
    this.phase('Preparing voice');
    try{
      const greeting=await request('/overview/live/greeting',{body:{language},signal:this.pending.signal});
      if(this.turn!==turn || this.abort.signal.aborted) return;
      this.caption(greeting.text,!greeting.audio,[]);
      if(greeting.audio) await this.play(greeting.audio,turn);
      else this.phase('Listening');
    }catch{
      if(this.turn===turn && !this.abort.signal.aborted) this.phase('Listening');
    }
  }
  level() {
    const analyser=this.playing?this.output:this.input;
    if(!analyser || !this.samples) return 0;
    analyser.getByteTimeDomainData(this.samples);
    let sum=0;for(const n of this.samples) sum+=((n-128)/128)**2;
    return Math.min(1,Math.sqrt(sum/this.samples.length)*4);
  }
  silence(){
    this.turn++;
    this.pending?.abort();
    if(this.playing){this.playing.onended=null;this.playing.stop();this.playing.disconnect();this.playing=null;}
  }
  async handle(event) {
    if(this.abort.signal.aborted) return;
    if(event.type==='start'){
      this.silence();this.message('');this.phase('Listening to you');
    } else if(event.type==='end'){
        const turn=this.turn;
        const controller=new AbortController();this.pending=controller;
        this.phase('Checking your shop');
        const body=new FormData();
        body.append('audio',wave(event.pcm,event.rate),'question.wav');
        for(const [key,value] of Object.entries(this.period())) if(value) body.append(key,value);
        if(this.previousId) body.append('previousId',this.previousId);
        const report=await request('/overview/live/report',{body,signal:controller.signal});
        if(turn!==this.turn || this.abort.signal.aborted) return;
        this.previousId=report.id;
        this.caption(report.text,!report.voiceId,report.sections || []);
        try{localStorage.setItem('pankti.voice.language',report.language);}catch{}
        if(report.menuChanged) this.changed();
        if(!report.voiceId){this.phase('Listening');return;}
        this.phase('Preparing voice');
        const {audio}=await request('/overview/'+report.voiceId+'/speech',{body:{},signal:controller.signal});
        if(turn!==this.turn || this.abort.signal.aborted) return;
        await this.play(audio,turn);
    }
  }
  async play(audio,turn){
    const buffer=await this.context.decodeAudioData(Uint8Array.from(atob(audio),c=>c.charCodeAt(0)).buffer);
    if(turn!==this.turn || this.abort.signal.aborted) return;
    this.playing=this.context.createBufferSource();
    this.playing.buffer=buffer;
    this.playing.connect(this.output);
    this.playing.onended=()=>{this.playing?.disconnect();this.playing=null;this.phase('Listening');};
    this.phase('Speaking');this.playing.start();
  }
  recover(e){if(!this.abort.signal.aborted && e.name!=='AbortError'){this.message(e.message);this.phase('Listening');}}
  fail(text){this.close();this.message(text);this.phase('Idle');}
  close(){
    this.abort.abort();this.silence();
    this.processor?.port.close();this.processor?.disconnect();this.source?.disconnect();this.mic?.getTracks().forEach(t=>t.stop());
    if(this.context && this.context.state!=='closed') void this.context.close();
  }
}
