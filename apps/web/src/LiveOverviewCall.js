import {request} from './api.js';

// WebRTC supplies continuous microphone audio and server-side turn detection.
// Web Audio keeps Sarvam playback interruptible and exposes levels to the orb.
export class LiveOverviewCall {
  constructor({phase, message, caption, period}) {
    Object.assign(this,{phase,message,caption,period});
    this.abort=new AbortController();
    this.turn=0;
  }
  async start() {
    this.context=new AudioContext();
    await this.context.resume();
    if(this.abort.signal.aborted) return;
    this.peer=new RTCPeerConnection();
    const mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(this.abort.signal.aborted){mic.getTracks().forEach(t=>t.stop());return;}
    this.mic=mic;
    this.input=this.context.createAnalyser();
    this.input.fftSize=256;
    this.context.createMediaStreamSource(mic).connect(this.input);
    this.output=this.context.createAnalyser();
    this.output.fftSize=256;
    this.output.connect(this.context.destination);
    this.samples=new Uint8Array(256);
    mic.getTracks().forEach(track=>this.peer.addTrack(track,mic));
    this.channel=this.peer.createDataChannel('oai-events');
    this.channel.onopen=()=>this.phase('Listening');
    this.channel.onmessage=event=>this.handle(JSON.parse(event.data)).catch(e=>this.recover(e));
    this.peer.onconnectionstatechange=()=>{
      if(this.peer.connectionState==='failed' && !this.abort.signal.aborted) this.fail('Connection lost. Start a new conversation to reconnect.');
    };
    this.channel.onclose=()=>{if(!this.abort.signal.aborted)this.fail('The voice connection closed. You can reconnect.');};
    const offer=await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    const answer=await request('/overview/live',{body:{sdp:offer.sdp},signal:this.abort.signal});
    if(!this.abort.signal.aborted) await this.peer.setRemoteDescription({type:'answer',sdp:answer.sdp});
  }
  level() {
    const analyser=this.playing?this.output:this.input;
    if(!analyser || !this.samples) return 0;
    analyser.getByteTimeDomainData(this.samples);
    let sum=0;for(const n of this.samples) sum+=((n-128)/128)**2;
    return Math.min(1,Math.sqrt(sum/this.samples.length)*4);
  }
  send(event){if(this.channel?.readyState==='open') this.channel.send(JSON.stringify(event));}
  toolResult(id,data){this.send({type:'conversation.item.create',item:{type:'function_call_output',call_id:id,output:JSON.stringify(data)}});}
  silence(){
    this.turn++;
    this.pending?.abort();
    if(this.playing){this.playing.onended=null;this.playing.stop();this.playing.disconnect();this.playing=null;}
  }
  async handle(event) {
    if(this.abort.signal.aborted) return;
    if(event.type==='input_audio_buffer.speech_started') {
      this.silence();this.message('');this.phase('Listening to you');
    } else if(event.type==='input_audio_buffer.speech_stopped') this.phase('Thinking');
    else if(event.type==='error') this.recover(new Error(event.error?.message || 'Please say that again.'));
    else if(event.type==='response.function_call_arguments.done') {
      const args=JSON.parse(event.arguments);
      const turn=this.turn;
      const controller=new AbortController();this.pending=controller;
      if(event.name==='lookup_ledger'){
        this.phase('Checking the ledger');
        let result;
        try {
          result=await request('/overview/live/report',{body:{question:args.question,...this.period()},signal:controller.signal});
        } catch(e){result={error:controller.signal.aborted?'Interrupted':'The lookup failed. Ask the owner to try again.'};}
        this.toolResult(event.call_id,result);
        if(turn===this.turn&&!this.abort.signal.aborted) this.send({type:'response.create'});
      } else if(event.name==='say_to_owner'){
        this.toolResult(event.call_id,{status:'reply submitted'});
        this.caption(args.text);
        this.phase('Preparing voice');
        const {audio}=await request('/overview/live/say',{body:args,signal:controller.signal});
        if(turn!==this.turn || this.abort.signal.aborted) return;
        const buffer=await this.context.decodeAudioData(Uint8Array.from(atob(audio),c=>c.charCodeAt(0)).buffer);
        if(turn!==this.turn || this.abort.signal.aborted) return;
        this.playing=this.context.createBufferSource();
        this.playing.buffer=buffer;
        this.playing.connect(this.output);
        this.playing.onended=()=>{this.playing?.disconnect();this.playing=null;this.phase('Listening');};
        this.phase('Speaking');this.playing.start();
      }
    } else if(event.type==='response.done' && event.response?.status==='failed'){
      this.recover(new Error('The reply was interrupted. Please ask again.'));
    }
  }
  recover(e){if(!this.abort.signal.aborted && e.name!=='AbortError'){this.message(e.message);this.phase('Listening');}}
  fail(text){this.close();this.message(text);this.phase('Idle');}
  close(){
    this.abort.abort();this.silence();
    this.channel?.close();this.peer?.close();this.mic?.getTracks().forEach(t=>t.stop());
    if(this.context && this.context.state!=='closed') void this.context.close();
  }
}
