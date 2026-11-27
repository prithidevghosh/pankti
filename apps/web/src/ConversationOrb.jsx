import React,{useEffect,useRef} from 'react';

// Latitude ribbons on a tilted, undulating sphere. Depth controls ink density.
export function ConversationOrb({phase,call}) {
  const canvas=useRef(null), pointer=useRef({x:0,y:0}), state=useRef(phase);
  state.current=phase;
  useEffect(()=>{
    const el=canvas.current, ctx=el.getContext('2d');
    if(!ctx) return;
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    let frame, last=-100, level=0, tilt=0;
    function paint(now){
      frame=requestAnimationFrame(paint);
      if(now-last<(motion.matches?250:32) || document.hidden) return;
      last=now;
      const width=el.clientWidth;
      if(!width) return;
      const pixels=Math.round(width*Math.min(devicePixelRatio||1,2));
      if(el.width!==pixels || el.height!==pixels){el.width=pixels;el.height=pixels;}
      ctx.setTransform(pixels/220,0,0,pixels/220,0,0);ctx.clearRect(0,0,220,220);
      const t=motion.matches?0:now/2100;
      level+=(Math.min(1,call.current?.level()||0)-level)*.28;
      tilt+=((motion.matches?0:pointer.current.x)*.28-tilt)*.1;
      const speaking=state.current==='Speaking', idle=state.current==='Idle';
      const R=84+(motion.matches?0:level*5), cy=105;
      const shadow=ctx.createRadialGradient(112,199,1,112,199,72);
      shadow.addColorStop(0,'#32445c36');shadow.addColorStop(1,'#32445c00');
      ctx.save();ctx.translate(0,152);ctx.scale(1,.24);ctx.fillStyle=shadow;ctx.fillRect(20,100,180,190);ctx.restore();
      const body=ctx.createRadialGradient(78,62,6,113,109,R+4);
      body.addColorStop(0,'#f7eaca');body.addColorStop(.33,'#d4dedb');
      body.addColorStop(.69,speaking?'#abb5cb':'#9fb7c6');body.addColorStop(1,'#475d7c');
      ctx.fillStyle=body;ctx.beginPath();ctx.arc(110,cy,R,0,Math.PI*2);ctx.fill();
      const angle=-.40+tilt+(motion.matches?0:pointer.current.y*.05);
      const amp=.12+(idle?.025:.065)+(motion.matches?0:level*.17);
      for(let k=1;k<55;k++){
        const lat=-Math.PI/2+k*Math.PI/55;
        ctx.beginPath();let started=false;
        for(let i=0;i<=128;i++){
          const u=i*Math.PI/64;
          const phi=lat+amp*Math.cos(lat)*Math.sin(2*u+2.6*lat+t*.55);
          const x=Math.cos(phi)*Math.cos(u),y=Math.sin(phi),z=Math.cos(phi)*Math.sin(u);
          const yy=y*.93-z*.367, depth=y*.367+z*.93;
          if(depth<0){started=false;continue;}
          const X=110+R*(x*Math.cos(angle)-yy*Math.sin(angle)),Y=cy+R*(x*Math.sin(angle)+yy*Math.cos(angle));
          if(started)ctx.lineTo(X,Y);else ctx.moveTo(X,Y);
          started=true;
        }
        ctx.lineWidth=.8+1.65*(.5+.5*Math.sin(k*.187+t*.38));
        ctx.strokeStyle=k>17&&k<23?'rgba(163,93,55,.60)':k%7===0?'rgba(249,239,210,.88)':'rgba(37,60,98,.68)';
        ctx.stroke();
      }
    }
    frame=requestAnimationFrame(paint);return ()=>cancelAnimationFrame(frame);
  },[call]);
  return <canvas className="conversation-orb" ref={canvas} aria-hidden="true"
    onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect();pointer.current={x:(e.clientX-r.left)/r.width-.5,y:(e.clientY-r.top)/r.height-.5};}}
    onPointerLeave={()=>{pointer.current={x:0,y:0};}}/>;
}
