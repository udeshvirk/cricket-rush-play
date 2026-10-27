// Time-aware pose curves: continuous velocity between exact authored poses.
(function(root){
  'use strict';
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const add=(a,b)=>a.map((x,i)=>x+b[i]), scale=(a,s)=>a.map(x=>x*s);
  const unit=a=>scale(a,1/Math.max(1e-12,Math.hypot(...a)));
  function log(p,q){
    const c=clamp(dot(p,q),-1,1),angle=Math.acos(c);let tangent=add(q,scale(p,-c));
    if(Math.hypot(...tangent)<1e-8){
      if(c>0)return [0,0,0];
      const axis=Math.abs(p[1])<.9?[0,1,0]:[1,0,0];tangent=add(axis,scale(p,-dot(axis,p)));
    }
    return scale(unit(tangent),angle);
  }
  function exp(p,v){
    const angle=Math.hypot(...v);
    return angle<1e-10?p.slice():unit(add(scale(p,Math.cos(angle)),scale(v,Math.sin(angle)/angle)));
  }
  const slerp=(a,b,t)=>exp(a,scale(log(a,b),t));
  function direction(values,times,i,u){
    const velocity=k=>{
      if(k===0||k===values.length-1)return [0,0,0];
      const before=times[k]-times[k-1],after=times[k+1]-times[k];
      return scale(add(scale(log(values[k],values[k-1]),-after/before),scale(log(values[k],values[k+1]),before/after)),1/(before+after));
    };
    const dt=times[i+1]-times[i],a=values[i],d=values[i+1];
    const b=exp(a,scale(velocity(i),dt/3)),c=exp(d,scale(velocity(i+1),-dt/3));
    return slerp(slerp(slerp(a,b,u),slerp(b,c,u),u),slerp(slerp(b,c,u),slerp(c,d,u),u),u);
  }
  function scalar(values,times,i,u){
    const slope=k=>{
      if(k===0||k===values.length-1)return 0;
      const a=times[k]-times[k-1],b=times[k+1]-times[k],d0=(values[k]-values[k-1])/a,d1=(values[k+1]-values[k])/b;
      return d0*d1<=0?0:3*(a+b)/((2*b+a)/d0+(b+2*a)/d1);
    };
    const dt=times[i+1]-times[i],u2=u*u,u3=u2*u;
    return (2*u3-3*u2+1)*values[i]+(u3-2*u2+u)*dt*slope(i)+(-2*u3+3*u2)*values[i+1]+(u3-u2)*dt*slope(i+1);
  }
  function prepare(keys){
    const times=keys.map(k=>k[0]),properties=new Set(keys.flatMap(k=>Object.keys(k[1]))),channels={};
    for(const key of properties){
      let last=keys.find(k=>k[1][key]!==undefined)[1][key];
      channels[key]=keys.map(k=>{if(k[1][key]!==undefined)last=k[1][key];return last;});
      if(key==='bd')channels[key]=channels[key].map(unit);
    }
    return {times,channels};
  }
  function sample(curve,t){
    const {times,channels}=curve;let i=0;
    while(i<times.length-2&&t>=times[i+1])i++;
    const u=clamp((t-times[i])/(times[i+1]-times[i]),0,1),pose={};
    for(const [key,values] of Object.entries(channels)){
      if(key==='bd')pose[key]=direction(values,times,i,u);
      else if(Array.isArray(values[0]))pose[key]=values[0].map((_,j)=>scalar(values.map(v=>v[j]),times,i,u));
      else if(typeof values[0]==='number')pose[key]=scalar(values,times,i,u);
      else pose[key]=values[i];
    }
    return pose;
  }
  const api={prepare,sample};root.CricketMotion=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
