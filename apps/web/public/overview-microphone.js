// Detect turns on the audio clock so UI rendering does not clip the first word.
class OverviewMicrophone extends AudioWorkletProcessor {
  constructor(){
    super();
    this.pre=[];
    this.frames=[];
    this.quiet=0;
    this.onset=0;
    this.floor=.001;
  }
  process(inputs){
    const samples=inputs[0]?.[0];
    if(!samples?.length) return true;
    const frame=Float32Array.from(samples);
    let sum=0;
    for(const x of frame) sum+=x*x;
    const level=Math.sqrt(sum/frame.length);
    const threshold=Math.max(.006,Math.min(.065,this.floor*3.5));
    if(!this.frames.length){
      this.pre.push(frame);
      if(this.pre.length>Math.ceil(sampleRate*.32/frame.length)) this.pre.shift();
      this.onset=level>threshold?this.onset+frame.length:0;
      if(!this.onset) this.floor+=(level-this.floor)*.005;
      if(this.onset<sampleRate*.055) return true;
      this.frames=this.pre;
      this.pre=[];
      this.quiet=0;
      this.port.postMessage({type:'start'});
    }else this.frames.push(frame);
    this.quiet=level>threshold*.75?0:this.quiet+frame.length;
    if(this.quiet>=sampleRate*.72 || this.frames.length*frame.length>=sampleRate*27){
      const pcm=new Int16Array(this.frames.length*frame.length);
      let index=0;
      for(const block of this.frames) for(const x of block) pcm[index++]=Math.round(Math.max(-1,Math.min(1,x))*32767);
      this.port.postMessage({type:'end',pcm,rate:sampleRate},[pcm.buffer]);
      this.frames=[];this.onset=0;
    }
    return true;
  }
}
registerProcessor('overview-microphone',OverviewMicrophone);
