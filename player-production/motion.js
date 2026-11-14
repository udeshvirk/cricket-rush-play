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
  // Map the drive's authored impact to the already-scheduled gameplay event.
  // This changes presentation time, not input timing or scoring. Match speed
  // at impact so the follow-through does not acquire a new velocity kink.
  function contactTime(t, actual, nominal=.15) {
    if(!Number.isFinite(actual)||actual<nominal/4||actual>nominal*3||t<=0)return t;
    if(t>=actual)return nominal+t-actual;
    const u=t/actual;
    return nominal*u+(nominal-actual)*u*u*(1-u);
  }
  function stepFoot(from,to,u,height) {
    u=clamp(u,0,1);const w=u*u*(3-2*u);
    const foot=from.map((v,i)=>v+(to[i]-v)*w);
    foot[1]+=height*Math.sin(Math.PI*u)**2;
    return foot;
  }
  function sampleDrive(curve,t,actual,nominal=.15) {
    const time=contactTime(t,actual,nominal),pose=sample(curve,time);
    const {times,channels}=curve,feet=channels.fr;
    const impact=times.findIndex(v=>Math.abs(v-nominal)<1e-8);
    if(!feet||impact<0)return {pose,time};
    const start=feet[0],plant=feet[impact],end=feet[feet.length-1];
    const recovery=times[times.length-2],done=times[times.length-1];
    const distance=Math.hypot(plant[0]-start[0],plant[2]-start[2]);
    // Don't invent another stride when the waiting footwork already planted.
    const lift=distance>.015?Math.min(.045,distance*.2):0;
    if(time<nominal*.65)pose.fr=stepFoot(start,plant,time/(nominal*.65),lift);
    else if(time<=recovery)pose.fr=plant.slice();
    else pose.fr=stepFoot(plant,end,(time-recovery)/(done-recovery),.045);
    // This channel is also the front shoe's facing axis in buildBody().
    // Lock it with the planted foot instead of twisting the shoe afterward.
    if(channels.kpL) {
      const axes=channels.kpL;
      const blend=(a,b,u)=>{u=clamp(u,0,1);const w=u*u*(3-2*u);return a.map((v,i)=>v+(b[i]-v)*w);};
      pose.kpL=time<nominal*.65?blend(axes[0],axes[impact],time/(nominal*.65))
        :time<=recovery?axes[impact].slice():blend(axes[impact],axes[axes.length-1],(time-recovery)/(done-recovery));
    }
    return {pose,time};
  }
  // A staged drive, rather than a hand orbit plus an unwrapped blade angle.
  // The authored controls separate loading, slot, impact, extension and finish.
  // They remain kinematic authoring controls, not a mocap or collision system.
  function driveKeys({start,target,aim=0,loft=false,stance,impact=.15}) {
    const mix=(a,b,u)=>a+(b-a)*u;
    const blend=(a,b,u)=>Object.fromEntries(Object.keys(a).map(k=>[k,
      Array.isArray(a[k])?a[k].map((v,i)=>mix(v,(b[k]||a[k])[i],u))
        :typeof a[k]==='number'?mix(a[k],b[k]??a[k],u):a[k]]));
    const angle=clamp(aim,-100,35)*Math.PI/180,dx=Math.sin(angle),dz=Math.max(.12,Math.cos(angle));
    // One drive per direction: c is 0 straight, 1 through cover, about 1.4 square;
    // on is 0..1 for the on drive. The stride, the hips and shoulders, the angle of
    // the bat and the finish all follow it, not just the direction of the hands.
    const c=clamp(-aim,0,100)/70,on=clamp(aim,0,35)/35,sq=Math.max(0,c-.9);
    const fr=[clamp(target[0]+.32-.06*c+.05*on,.02,.78),0,1.4-.16*sq];
    const bd=unit([-.06+dx*.22-.25*sq,-1,-.08]);
    const h=add(target,scale(bd,-.48));
    const pelvis=[mix(start.pel[0],fr[0],.7),clamp(.78+(target[1]-.5)*.1,.72,.84)-.03*c,1.01-.1*sq];
    const contact={...start,fr,pel:pelvis,hy:-60-8*c+10*on,sy:-76-10*c+14*on,lean:24+4*c,side:7+3*c,h,bd,
      kpL:[-.25-.35*c+.15*on,0,1],rearFootPitch:.18};
    const load={...start,pel:add(start.pel,[0,-.015,.025]),hy:start.hy+8,sy:start.sy-4,
      h:add(start.h,[.015,.025,-.035]),bd:slerp(unit(start.bd),unit([-.4,.76,-.51]),.3)};
    const slot={...blend(start,contact,.65),hy:mix(start.hy,contact.hy,.85),sy:mix(start.sy,contact.sy,.45),
      h:[mix(start.h[0],h[0],.7),h[1]+.1,h[2]-.12],bd:unit([-.22,-.32,-.92])};
    const through={...contact,pel:add(pelvis,[0,.025,.025]),hy:-45,sy:-60,lean:20,side:5,
      h:add(h,[dx*.22,.07,dz*.2]),bd:unit([dx*.45-.07,-.65,.76*dz]),rearFootPitch:.26};
    const extension={...contact,pel:add(pelvis,[0,.06,.06]),hy:-35,sy:-40,lean:14,side:3,
      h:add(h,[.04+dx*.34,.23+(loft?.08:0),.38*dz]),bd:unit([dx*.85-.12,loft?.28:.08,.99*dz]),rearFootPitch:.32};
    const finish={...contact,pel:[pelvis[0]+.025,.89-.03*c,1.07-.1*sq],hy:-28-10*c+12*on,sy:-12+clamp(aim,-100,35)*.25,lean:9+3*c,side:0,
      h:[pelvis[0]-.22+dx*.14,loft?1.72:1.55,1.25-.15*c],bd:unit([-.58+dx*.25,.79,.18-.2*c]),rearFootPitch:.34};
    const settle={...finish,h:add(finish.h,[0,-.05,0]),lean:7};
    return [[0,start],[impact*.26,load],[impact*.63,slot],[impact,contact],
      [impact+.075,through],[impact+.18,extension],[impact+.42,finish],
      [impact+.95,settle],[impact+1.6,stance]];
  }
  // Square cut: sit into a wider base, strike across the ball, then roll
  // through at chest height. Keep this finish distinct from an upper cut.
  function cutKeys({start,target,stance,impact=.15}) {
    const bd=unit([-.94,-.15,-.3]),h=add(target,scale(bd,-.48));
    const shift=clamp(target[0],-.35,.25),dip=clamp((1-target[1])*.35,0,.22);
    const contact={...start,fr:[.88+shift,0,1.12],bk:[.54+shift,0,.4],pel:[.68+shift,.79-dip,.85],
      hy:-80,sy:-92,lean:20+dip*40,side:8,h,bd,kpL:[-.65,0,.65],kpR:[-1,0,.05],rearFootPitch:0};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.4,sy:start.sy+(contact.sy-start.sy)*.25,
      lean:start.lean+(contact.lean-start.lean)*.4,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3+(i===1?.03:0)),
      bd:slerp(unit(start.bd),unit([-.4,.75,-.5]),.3)};
    const slot={...contact,sy:-105,h:add(h,[.025,.09,-.12]),bd:unit([-.7,.32,-.64])};
    const through={...contact,hy:-72,sy:-72,h:add(h,[-.08,-.07,.13]),bd:unit([-.96,-.2,.2])};
    const extension={...contact,hy:-64,sy:-52,lean:16,
      h:[.52+shift,h[1]-.1,1.3],bd:unit([-.7,-.15,.7])};
    const finish={...contact,pel:[.68+shift,.83,.84],hy:-60,sy:-40,lean:12,side:3,
      h:[.58+shift,1.16,1.23],bd:unit([-.86,.3,.4])};
    const settle={...finish,sy:-46,h:add(finish.h,[0,-.07,-.02])};
    return [[0,start],[impact*.33,load],[impact*.68,slot],[impact,contact],
      [impact+.075,through],[impact+.17,extension],[impact+.38,finish],[impact+.85,settle],[impact+1.5,stance]];
  }
  // Back and across, the front leg opening to the leg side: the hips turn
  // first, the shoulders follow right round, and the batter finishes facing
  // square leg up on the back toe, the bat high over the leading shoulder.
  function pullKeys({start,target,stance,loft=false,impact=.15}) {
    const shift=clamp(target[0]*.6,-.18,.18),bd=unit([-.96,-.04,.28]);
    const h=add(target,scale(bd,-.48));
    const contact={...start,fr:[.98+shift,0,.9],bk:[.46+shift,0,.3],pel:[.68+shift,.83,.56],
      hy:-40,sy:-30,lean:6,side:0,h,bd,kpL:[.6,0,.8],kpR:[-.5,0,.85],rearFootPitch:0};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.5,sy:start.sy+(contact.sy-start.sy)*.1,
      h:start.h.map((v,i)=>v+(h[i]-v)*.25+(i===1?.025:0)),
      bd:slerp(unit(start.bd),unit([-.9,.25,-.25]),.25)};
    const slot={...contact,hy:-52,sy:-74,h:add(h,[-.025,.055,-.035]),bd:unit([-.94,.26,-.22])};
    const through={...contact,pel:[.71+shift,.84,.6],hy:-18,sy:4,
      h:add(h,[.15,.025,.24]),bd:unit([-.3,-.06,.95])};
    const extension={...through,pel:[.73+shift,.86,.62],hy:0,sy:32,h:[.87+shift,h[1]+.13,1.12],bd:unit([.6,.22,.77]),rearFootPitch:.18};
    const finish={...contact,pel:[.75+shift,.87,.63],hy:15,sy:62,lean:5,rearFootPitch:.3,
      h:[.95+shift,loft?1.64:1.52,.88],bd:unit([.72,loft?.76:.62,.12])};
    const settle={...finish,hy:8,sy:50,lean:7,h:add(finish.h,[-.04,-.09,0]),bd:unit([.8,.42,.3])};
    return [[0,start],[impact*.33,load],[impact*.68,slot],[impact,contact],
      [impact+.075,through],[impact+.18,extension],[impact+.34,finish],[impact+.85,settle],[impact+1.5,stance]];
  }
  // Head-high on the leg side: swivel on the back foot with the front foot off
  // the ground, the bat rising across the line and finishing over the shoulder.
  function hookKeys({start,target,stance,loft=false,impact=.15}) {
    const shift=clamp(target[0]*.6,-.18,.18),bd=unit([-.93,.2,.3]);
    const h=add(target,scale(bd,-.48));
    const contact={...start,fr:[.92+shift,.07,.9],bk:[.5+shift,0,.3],pel:[.64+shift,.9,.52],
      hy:-48,sy:-28,lean:4,side:0,h,bd,kpL:[.3,0,1],kpR:[-.6,0,.7],rearFootPitch:.12};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.4,sy:start.sy+(contact.sy-start.sy)*.15,
      h:start.h.map((v,i)=>v+(h[i]-v)*.25+(i===1?.025:0)),
      bd:slerp(unit(start.bd),unit([-.88,.4,-.25]),.25)};
    const slot={...contact,hy:-58,sy:-62,h:add(h,[-.03,.05,-.05]),bd:unit([-.92,.34,-.2])};
    const through={...contact,pel:[.68+shift,.9,.56],hy:-22,sy:8,
      h:add(h,[.16,.05,.2]),bd:unit([-.25,.14,.96])};
    const top=Math.min(1.82,h[1]+.14);
    const extension={...through,hy:-8,sy:34,h:[.9+shift,top-.04,1.04],bd:unit([.65,.4,.65])};
    const finish={...contact,pel:[.72+shift,.9,.6],hy:4,sy:58,lean:3,
      h:[.99+shift,loft?top+.04:top,.9],bd:unit([.72,loft?.72:.62,.2])};
    const settle={...finish,hy:-4,sy:46,lean:5,h:add(finish.h,[-.04,-.1,0]),bd:unit([.8,.45,.32])};
    return [[0,start],[impact*.33,load],[impact*.68,slot],[impact,contact],
      [impact+.075,through],[impact+.18,extension],[impact+.34,finish],[impact+.85,settle],[impact+1.5,stance]];
  }
  // Upper cut: make room with the front leg, stay tall, lift the blade
  // through the high ball and extend above the off shoulder.
  function ucutKeys({start,target,stance,impact=.15}) {
    const shift=clamp(target[0],-.35,.25),low=clamp((1.35-target[1])/.65,0,1);
    const bd=unit([-.93,.30-.4*low,.2]),h=add(target,scale(bd,-.48));
    const contact={...start,fr:[.88+shift,0,.95],bk:[.58+shift,0,.35],pel:[.64+shift,.94-.29*low,.73],
      hy:-85,sy:-94,lean:-7+35*low,side:5,h,bd,kpL:[-.7,0,.7],kpR:[-1,0,0],rearFootPitch:0};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.4,sy:start.sy+(contact.sy-start.sy)*.2,
      lean:start.lean+(contact.lean-start.lean)*.4,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3),bd:slerp(unit(start.bd),unit([-.8,.3,.5]),.25)};
    const slot={...contact,h:add(h,[.02,-.07,.03]),bd:unit([-.95,.08,.3])};
    const through={...contact,pel:[.64+shift,.94-.12*low,.73],sy:-108,lean:-9+18*low,h:add(h,[-.04,.13,.01]),bd:unit([-.8,.54,-.23])};
    const finish={...contact,pel:[.64+shift,.94,.73],hy:-94,sy:-118,lean:-5,
      h:[.35+shift,Math.min(1.88,Math.max(1.72,h[1]+.3)),.90],bd:unit([-.66,.74,-.12])};
    const settle={...finish,sy:-112,lean:0,h:add(finish.h,[.02,-.09,0])};
    return [[0,start],[impact*.33,load],[impact*.68,slot],[impact,contact],
      [impact+.1,through],[impact+.38,finish],[impact+.85,settle],[impact+1.5,stance]];
  }
  // Two low strokes, authored around their support leg and direction of travel.
  // The reverse is not a mirrored standing drive: hands cross to the off side,
  // the blade extends back toward the ball and the shoulders unwind oppositely.
  function sweepKeys(args) { return lowSweepKeys(args,false); }
  function rsweepKeys(args) { return lowSweepKeys(args,true); }
  function lowSweepKeys({start,target,stance,impact=.15},reverse) {
    const shift=clamp(target[0],-.3,.25), height=clamp(target[1],.16,1.05);
    const bd=unit(reverse?[.55,-.30,.78]:[-.94,-.22,.25]);
    const h=add(target,scale(bd,-.46));
    const contact={...start,
      fr:[.48+shift,0,1.3],bk:[(reverse?.65:.8)+shift,0,.19],
      pel:[(reverse?.35:.57)+shift,(reverse?.49:.46)+(height-.3)*.16+Math.max(0,height-.65)*.5,.70],
      hy:reverse?-92:-58,sy:reverse?-110:-48,lean:reverse?42:30,side:0,
      h,bd,kpL:reverse?[.15,0,1]:[-.25,0,1],kpR:[0,-1,1],rearFootPitch:.65,
      epL:[-.6,-.3,.7],epR:[.3,-.7,-.4]};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.45),
      hy:start.hy+(contact.hy-start.hy)*.35,sy:start.sy+(contact.sy-start.sy)*.25,
      lean:start.lean+(contact.lean-start.lean)*.4,
      h:reverse?[-.10+shift,.90,1.05]:[.22+shift,.88,.83],
      bd:unit(reverse?[.2,.7,.68]:[-.65,.55,-.52]),rearFootPitch:.35};
    const slot={...contact,pel:[contact.pel[0],contact.pel[1]+.045,.70],
      h:reverse?[-.32+shift,.55,.95]:add(h,[-.06,.05,-.04]),
      bd:unit(reverse?[.3,.1,.95]:[-.85,-.08,-.52])};
    const through={...contact,sy:reverse?-130:-20,
      h:reverse?[-.40+shift,.48,1.10]:[.78+shift,.55,1.38],
      bd:unit(reverse?[-.70,-.10,.70]:[.35,-.1,.93])};
    const finish={...contact,hy:reverse?-105:-35,sy:reverse?-142:18,lean:reverse?30:22,
      h:reverse?[-.10+shift,.67,1.03]:[.83+shift,.72,1.38],
      bd:unit(reverse?[-.86,.25,-.44]:[.91,.25,-.32])};
    const settle={...finish,h:add(finish.h,[0,-.035,0])};
    // Hold the low silhouette, then rise before stepping back into guard.
    const rise={...finish,pel:[contact.pel[0],.73,.78],lean:15,
      h:reverse?[.08+shift,.86,.83]:[.53+shift,.85,1.05],
      bd:unit(reverse?[-.65,-.55,-.3]:[.3,-.9,.2]),rearFootPitch:.25};
    return [[0,start],[impact*.34,load],[impact*.72,slot],[impact,contact],
      [impact+.10,through],[impact+.34,finish],[impact+.64,settle],
      [impact+.98,rise],[impact+1.45,stance]];
  }
  // Late cut: compact upright blade and a small open-face deflection.
  // Do not turn this into another full cross-bat swing or overhead finish.
  function lcutKeys({start,target,stance,impact=.15}) {
    const bd=unit([-.35,-.92,.17]),h=add(target,scale(bd,-.48));
    const shift=clamp(target[0],-.35,.25);
    const contact={...start,fr:[.66+shift,0,1.08],bk:[.51+shift,0,.45],pel:[.56+shift,.85,.86],
      hy:-92,sy:-98,lean:18,side:4,h,bd,kpL:[-1,0,.3],kpR:[-1,0,0],rearFootPitch:0,batRoll:.35};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.35),
      hy:start.hy+(contact.hy-start.hy)*.3,sy:start.sy+(contact.sy-start.sy)*.2,
      h:start.h.map((v,i)=>v+(h[i]-v)*.25),bd:slerp(unit(start.bd),unit([-.5,.6,.5]),.22),batRoll:.08};
    const slot={...contact,sy:-96,h:add(h,[.015,.07,.01]),bd:unit([-.5,-.8,.32]),batRoll:.25};
    const through={...contact,sy:-104,h:add(h,[-.025,-.025,-.07]),bd:unit([-.46,-.87,-.16]),batRoll:.42};
    const finish={...contact,sy:-110,lean:17,
      h:[h[0]-.055,Math.max(.78,h[1]-.08),h[2]-.12],bd:unit([-.5,-.8,-.32]),batRoll:.4};
    const settle={...finish,sy:-106,h:add(finish.h,[.01,.025,.02]),batRoll:.25};
    return [[0,{...start,batRoll:0}],[impact*.33,load],[impact*.68,slot],[impact,contact],
      [impact+.095,through],[impact+.3,finish],[impact+.75,settle],[impact+1.4,{...stance,batRoll:0}]];
  }
  // A straight bat beside the front pad, the wrists turning the face at the
  // last moment so the ball runs fine on the leg side.
  function glanceKeys({start,target,stance,impact=.15}) {
    const bd=unit([.08,-.98,.12]),h=add(target,scale(bd,-clamp((1.32-target[1])/.98,.2,.48)));
    const fr=[clamp(target[0]+.38,.05,.72),0,1.15];
    const pel=[.63+(fr[0]-.63)*.45,.86,.88];
    const contact={...start,fr,pel,hy:-62,sy:-62,lean:16,side:8,h,bd,kpL:[-.4,0,1]};
    const load={...contact,pel:start.pel.map((v,i)=>v+(pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.4,sy:start.sy+(contact.sy-start.sy)*.3,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3),bd:slerp(unit(start.bd),bd,.2)};
    const slot={...contact,sy:-68,h:add(h,[-.02,.07,-.08]),bd:unit([-.1,-.8,-.55])};
    const through={...contact,sy:-52,lean:14,h:add(h,[.05,.04,.1]),bd:unit([.35,-.85,.38])};
    const finish={...contact,pel:add(pel,[.02,.02,.02]),hy:-55,sy:-40,lean:12,side:4,
      h:[h[0]+.1,h[1]+.12,1.2],bd:unit([.7,-.35,.6])};
    const settle={...finish,lean:10,h:add(finish.h,[0,-.03,0])};
    return [[0,start],[impact*.3,load],[impact*.65,slot],[impact,contact],
      [impact+.075,through],[impact+.24,finish],[impact+.8,settle],[impact+1.45,stance]];
  }
  function bdriveKeys({start,target,stance,aim=0,loft=false,impact=.15}) {
    const shift=clamp(target[0],-.3,.3),dy=-clamp((1.72-target[1])/.48,.4,.97),dz=.12;
    const bd=unit([-Math.sqrt(Math.max(.01,1-dy*dy-dz*dz)),dy,dz]);
    const h=add(target,scale(bd,-.48));
    const contact={...start,fr:[.58+shift,0,.91],bk:[.5+shift,0,.24],pel:[.55+shift,.91,.48],
      hy:-78,sy:-76,lean:8,side:0,h,bd,kpL:[-.85,0,.5],kpR:[-1,0,.05],rearFootPitch:0};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.3,sy:start.sy+(contact.sy-start.sy)*.2,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3),bd:slerp(unit(start.bd),bd,.3)};
    const slot={...contact,hy:-80,sy:-82,h:add(h,[0,.035,-.055]),bd:slerp(unit(start.bd),bd,.65)};
    const dx=Math.sin(clamp(aim,-45,25)*Math.PI/180);
    const through={...contact,pel:[.55+shift,.91,.53],hy:-67,sy:-66,lean:12,
      h:add(h,[dx*.05,.015,.12]),bd:unit([-.18+dx*.1,-.65,.74])};
    const extension={...through,hy:-59,sy:-53,lean:14,
      h:add(h,[dx*.09,.055,.18]),bd:unit([-.2+dx*.25,.05,.98])};
    const finish={...contact,pel:[.55+shift,.93,.55],hy:-57,sy:-42,lean:8,
      h:[.32+shift,loft?1.72:1.6,.92],bd:unit([-.65,.75,.12])};
    const settle={...finish,sy:-48,h:add(finish.h,[0,-.08,-.025])};
    return [[0,start],[impact*.3,load],[impact*.65,slot],[impact,contact],
      [impact+.075,through],[impact+.18,extension],[impact+.4,finish],[impact+.85,settle],[impact+1.5,stance]];
  }
  // Transport the impact bat-face frame without projecting one fixed width
  // onto a nearly parallel backlift. That projection can roll the wrists fast.
  function cutWidth(direction,contactDirection) {
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const a=unit(contactDirection),b=unit(direction);
    let width=cross(scale(a,-1),[0,0,1]);
    if(Math.hypot(...width)<1e-6)width=cross(a,[0,1,0]);
    width=unit(width);
    const v=cross(a,b),c=clamp(dot(a,b),-1,1);
    if(c<-.999999)return unit(add(width,scale(b,-dot(width,b)))); // half-turn about width
    return unit(add(add(width,cross(v,width)),scale(cross(v,cross(v,width)),1/(1+c))));
  }
  function sampleBlade(curve,t) {
    const times=curve.times;let i=0;
    while(i<times.length-2&&t>=times[i+1])i++;
    return direction(curve.channels.bd,times,i,clamp((t-times[i])/(times[i+1]-times[i]),0,1));
  }
  // Transport along the whole path, rather than directly from impact to an
  // almost-opposite finish (which has no unique shortest rotation).
  function pathWidth(curve,time,direction,roll=0) {
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const transport=(a,b,w)=>{
      const v=cross(a,b),c=clamp(dot(a,b),-1,1);
      const next=c<-.999999?w:add(add(w,cross(v,w)),scale(cross(v,cross(v,w)),1/(1+c)));
      return unit(add(next,scale(b,-dot(next,b))));
    };
    if(!curve.sweepFrames){
      const dt=.005,end=curve.times.at(-1),count=Math.ceil(end/dt),frames=[];
      const impact=curve.times.findIndex(t=>Math.abs(t-.15)<1e-8);
      const at=impact<0?Math.round(.15/dt):Math.round(curve.times[impact]/dt);
      const b=sampleBlade(curve,at*dt);
      frames[at]={bd:b,width:cutWidth(b,b)};
      for(const sign of [-1,1])for(let i=at+sign;i>=0&&i<=count;i+=sign){
        const prev=frames[i-sign],bd=sampleBlade(curve,Math.min(i*dt,end));
        frames[i]={bd,width:transport(prev.bd,bd,prev.width)};
      }
      curve.sweepFrames=frames;
    }
    const frames=curve.sweepFrames,index=clamp(time/.005,0,frames.length-1),i=Math.floor(index),a=frames[i],b=frames[Math.min(i+1,frames.length-1)];
    const width=unit(add(scale(a.width,1-(index-i)),scale(b.width,index-i)));
    const authored=sampleBlade(curve,time);
    let result=transport(authored,direction,width);
    const end=curve.times.at(-1),recovery=curve.times.at(-2);
    const u=clamp(time<.15?1-time/.15:(time-recovery)/(end-recovery),0,1),weight=u*u*(3-2*u);
    if(weight>0){
      // Compute the signed roll at the endpoint once. Recomputing atan2
      // against the moving blade can cross +/-pi and snap midway through recovery.
      const endpoint=time<.15?frames[0]:frames.at(-1),axis=endpoint.bd;
      const normal=unit(add([1,0,0],scale(axis,-axis[0])));
      const angle=Math.atan2(dot(axis,cross(endpoint.width,normal)),dot(endpoint.width,normal))*weight;
      result=add(scale(result,Math.cos(angle)),scale(cross(direction,result),Math.sin(angle)));
    }
    if(roll)result=add(scale(result,Math.cos(roll)),scale(cross(direction,result),Math.sin(roll)));
    return unit(result);
  }
  const sweepWidth=(curve,time,direction)=>pathWidth(curve,time,direction);
  function sampleCut(curve,t,actual,nominal=.15) {
    const result=sampleDrive(curve,t,actual,nominal),{time,pose}=result;
    const {times,channels}=curve,impact=times.findIndex(v=>Math.abs(v-nominal)<1e-8);
    if(impact<0)return result;
    const recovery=times[times.length-2],done=times[times.length-1];
    const u=time<nominal*.65?time/(nominal*.65):time<=recovery?1:1-(time-recovery)/(done-recovery);
    const from=time<=recovery?0:times.length-1;
    if(channels.bk){
      const a=channels.bk[from],b=channels.bk[impact],distance=Math.hypot(a[0]-b[0],a[2]-b[2]);
      pose.bk=stepFoot(a,b,u,distance>.015?Math.min(.035,distance*.25):0);
    }
    if(channels.kpR){const w=clamp(u,0,1)**2*(3-2*clamp(u,0,1));pose.kpR=channels.kpR[from].map((v,i)=>v+(channels.kpR[impact][i]-v)*w);}
    return result;
  }
  const api={prepare,sample,contactTime,sampleDrive,driveKeys,cutKeys,pullKeys,hookKeys,ucutKeys,sweepKeys,rsweepKeys,lcutKeys,glanceKeys,bdriveKeys,sampleCut,cutWidth,pathWidth,sweepWidth,blendDirection:slerp};root.CricketMotion=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
