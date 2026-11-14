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
    const angle=clamp(aim,-70,35)*Math.PI/180,dx=Math.sin(angle),dz=Math.cos(angle);
    const fr=[clamp(target[0]+.32,.02,.78),0,1.4];
    const bd=unit([-.06+dx*.1,-1,-.08]);
    const h=add(target,scale(bd,-.48));
    const pelvis=[mix(start.pel[0],fr[0],.7),clamp(.78+(target[1]-.5)*.1,.72,.84),1.01];
    const contact={...start,fr,pel:pelvis,hy:-60,sy:-76,lean:24,side:7,h,bd,
      kpL:[-.25,0,1],rearFootPitch:.18};
    const load={...start,pel:add(start.pel,[0,-.015,.025]),hy:start.hy+8,sy:start.sy-4,
      h:add(start.h,[.015,.025,-.035]),bd:slerp(unit(start.bd),unit([-.4,.76,-.51]),.3)};
    const slot={...blend(start,contact,.65),hy:mix(start.hy,contact.hy,.85),sy:mix(start.sy,contact.sy,.45),
      h:[mix(start.h[0],h[0],.7),h[1]+.1,h[2]-.12],bd:unit([-.22,-.32,-.92])};
    const through={...contact,pel:add(pelvis,[0,.025,.025]),hy:-45,sy:-60,lean:20,side:5,
      h:add(h,[dx*.15,.07,dz*.2]),bd:unit([dx*.25-.07,-.65,.76]),rearFootPitch:.26};
    const extension={...contact,pel:add(pelvis,[0,.06,.06]),hy:-35,sy:-40,lean:14,side:3,
      h:add(h,[.04+dx*.2,.23+(loft?.08:0),.38*dz]),bd:unit([dx*.6-.12,loft?.28:.08,.99]),rearFootPitch:.32};
    const finish={...contact,pel:[pelvis[0]+.025,.89,1.07],hy:-28,sy:-12+aim*.12,lean:9,side:0,
      h:[pelvis[0]-.22+dx*.06,loft?1.72:1.55,1.25],bd:unit([-.58+dx*.15,.79,.18]),rearFootPitch:.34};
    const settle={...finish,h:add(finish.h,[0,-.05,0]),lean:7};
    return [[0,start],[impact*.26,load],[impact*.63,slot],[impact,contact],
      [impact+.075,through],[impact+.18,extension],[impact+.42,finish],
      [impact+.95,settle],[impact+1.6,stance]];
  }
  function cutKeys({start,target,stance,impact=.15}) {
    const bd=unit([-.98,-.13,.15]),h=add(target,scale(bd,-.48));
    const shift=clamp(target[0],-.35,.25);
    const contact={...start,fr:[.78+shift,0,1.02],bk:[.62+shift,0,.38],pel:[.72+shift,.86,.62],
      hy:-92,sy:-98,lean:12,side:-3,h,bd,kpL:[-1,0,.25],kpR:[-1,0,-.15],rearFootPitch:0};
    // Load from the actual waiting pose. The previous fixed load reversed the
    // blade from behind the batter to forward in 50ms before the real stroke.
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.4,sy:start.sy+(contact.sy-start.sy)*.2,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3+(i===1?.025:0)),
      bd:slerp(unit(start.bd),unit([-.85,.35,.4]),.22)};
    const slot={...contact,hy:-89,sy:-87,h:add(h,[.01,.055,.025]),bd:unit([-.88,.24,.4])};
    const through={...contact,hy:-104,sy:-119,h:add(h,[-.12,-.07,-.16]),bd:unit([-.88,-.16,-.45])};
    const finish={...contact,hy:-108,sy:-128,lean:10,
      h:[clamp(h[0]-.24,-.1,.5),clamp(h[1]-.1,.95,1.4),.63],bd:unit([-.7,.12,-.7])};
    const settle={...finish,hy:-103,sy:-118,lean:12,
      h:add(finish.h,[.025,-.09,.045]),bd:unit([-.78,-.18,-.6])};
    return [[0,start],[impact*.33,load],[impact*.68,slot],[impact,contact],
      [impact+.075,through],[impact+.27,finish],[impact+.8,settle],[impact+1.45,stance]];
  }
  function pullKeys({start,target,stance,loft=false,impact=.15}) {
    const shift=clamp(target[0]*.6,-.18,.18),bd=unit([-.96,-.04,.28]);
    const h=add(target,scale(bd,-.48));
    const contact={...start,fr:[.9+shift,0,.97],bk:[.5+shift,0,.34],pel:[.67+shift,.85,.6],
      hy:-55,sy:-35,lean:8,side:0,h,bd,kpL:[.15,0,1],kpR:[-.7,0,.6],rearFootPitch:0};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.4,sy:start.sy+(contact.sy-start.sy)*.15,
      h:start.h.map((v,i)=>v+(h[i]-v)*.25+(i===1?.025:0)),
      bd:slerp(unit(start.bd),unit([-.9,.25,-.25]),.25)};
    const slot={...contact,hy:-63,sy:-68,h:add(h,[-.025,.055,-.035]),bd:unit([-.94,.26,-.22])};
    const through={...contact,pel:[.71+shift,.86,.65],hy:-32,sy:-5,
      h:add(h,[.15,.025,.24]),bd:unit([-.3,-.06,.95])};
    const extension={...through,hy:-20,sy:18,h:[.87+shift,h[1]+.13,1.15],bd:unit([.6,.22,.77])};
    const finish={...contact,pel:[.76+shift,.88,.7],hy:-12,sy:35,lean:6,
      h:[.97+shift,loft?1.62:1.48,1.03],bd:unit([.76,loft?.72:.52,.35])};
    const settle={...finish,hy:-18,sy:25,lean:8,h:add(finish.h,[-.04,-.09,0]),bd:unit([.82,.35,.45])};
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
  // Shoulder-high outside off: stay tall and lean back, the open face riding
  // up through the ball and on over the off shoulder.
  function ucutKeys({start,target,stance,impact=.15}) {
    const bd=unit([-.95,.22,.2]),h=add(target,scale(bd,-.48));
    const shift=clamp(target[0],-.35,.25);
    const contact={...start,fr:[.8+shift,0,1.0],bk:[.64+shift,0,.36],pel:[.74+shift,.9,.58],
      hy:-90,sy:-96,lean:3,side:-3,h,bd,kpL:[-1,0,.25],kpR:[-1,0,-.15],rearFootPitch:.12};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.4,sy:start.sy+(contact.sy-start.sy)*.2,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3+(i===1?.025:0)),
      bd:slerp(unit(start.bd),unit([-.85,.3,.4]),.22)};
    const slot={...contact,hy:-88,sy:-86,h:add(h,[.01,-.02,.03]),bd:unit([-.9,.12,.42])};
    const through={...contact,hy:-99,sy:-111,lean:1,h:add(h,[-.08,.08,-.12]),bd:unit([-.85,.36,-.38])};
    const finish={...contact,hy:-102,sy:-118,lean:0,
      h:[clamp(h[0]-.18,-.1,.55),clamp(h[1]+.22,1.4,1.85),.6],bd:unit([-.55,.76,-.35])};
    const settle={...finish,hy:-98,sy:-110,lean:3,
      h:add(finish.h,[.02,-.1,.04]),bd:unit([-.62,.64,-.45])};
    return [[0,start],[impact*.33,load],[impact*.68,slot],[impact,contact],
      [impact+.075,through],[impact+.27,finish],[impact+.8,settle],[impact+1.45,stance]];
  }
  // Down on the back knee like the sweep, but the bat comes round from the
  // leg side and carries the ball away behind square on the off side.
  function rsweepKeys({start,target,stance,impact=.15}) {
    const bd=unit([-.9,-.33,.28]),h=add(target,scale(bd,-.48));
    const contact={...start,fr:[.42,0,1.22],bk:[.78,0,.22],pel:[.62,.6,.82],
      hy:-72,sy:-84,lean:30,side:6,h,bd,kpL:[-.3,.6,1],kpR:[-.2,-1,.3]};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.4,sy:start.sy+(contact.sy-start.sy)*.3,lean:start.lean+(30-start.lean)*.4,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3),bd:slerp(unit(start.bd),unit([-.4,.5,.75]),.3)};
    const slot={...contact,pel:[.62,.66,.82],sy:-74,h:add(h,[-.06,.06,-.04]),bd:unit([-.6,-.15,.78])};
    const through={...contact,pel:[.62,.56,.82],sy:-100,h:add(h,[-.1,.02,-.12]),bd:unit([-.97,-.2,-.1])};
    const finish={...contact,pel:[.62,.54,.82],hy:-78,sy:-112,lean:26,
      h:[h[0]-.18,.8,.6],bd:unit([-.75,.45,-.5])};
    const settle={...finish,sy:-106,h:add(finish.h,[.02,-.06,.03]),bd:unit([-.8,.3,-.5])};
    return [[0,start],[impact*.33,load],[impact*.68,slot],[impact,contact],
      [impact+.075,through],[impact+.27,finish],[impact+.8,settle],[impact+1.5,stance]];
  }
  // Played late and close to the body: the bat chops down on the ball with an
  // open face and stays low, pointing where the ball went.
  function lcutKeys({start,target,stance,impact=.15}) {
    const bd=unit([-.72,-.66,.2]),h=add(target,scale(bd,-.48));
    const shift=clamp(target[0],-.35,.25);
    const contact={...start,fr:[.76+shift,0,1.0],bk:[.62+shift,0,.36],pel:[.7+shift,.82,.6],
      hy:-95,sy:-105,lean:20,side:-3,h,bd,kpL:[-1,0,.25],kpR:[-1,0,-.15],rearFootPitch:0};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.4,sy:start.sy+(contact.sy-start.sy)*.2,lean:start.lean+(20-start.lean)*.4,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3+(i===1?.03:0)),
      bd:slerp(unit(start.bd),unit([-.8,.45,.35]),.25)};
    const slot={...contact,hy:-92,sy:-96,h:add(h,[.02,.12,.03]),bd:unit([-.86,.1,.35])};
    const through={...contact,hy:-100,sy:-116,h:add(h,[-.05,-.08,-.14]),bd:unit([-.6,-.72,-.35])};
    const finish={...contact,hy:-104,sy:-125,lean:22,
      h:[h[0]-.12,Math.max(.75,h[1]-.15),.66],bd:unit([-.55,-.6,-.58])};
    const settle={...finish,sy:-118,lean:18,h:add(finish.h,[.02,.04,.03])};
    return [[0,start],[impact*.33,load],[impact*.68,slot],[impact,contact],
      [impact+.075,through],[impact+.27,finish],[impact+.8,settle],[impact+1.45,stance]];
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
  const api={prepare,sample,contactTime,sampleDrive,driveKeys,cutKeys,pullKeys,hookKeys,ucutKeys,rsweepKeys,lcutKeys,glanceKeys,bdriveKeys,sampleCut,cutWidth,blendDirection:slerp};root.CricketMotion=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
