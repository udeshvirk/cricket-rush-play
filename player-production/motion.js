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
  // a key pose part way from a to b: numbers and points mixed, the bat's direction turned on the sphere (an in-between key,
  // so a big turn of the bat is spread over the time instead of happening between two keys)
  function between(a,b,u){
    const out={...a};
    for(const k of Object.keys(b)){const x=a[k],y=b[k];
      if(x===undefined)out[k]=y;
      else if(k==='bd')out[k]=slerp(unit(x),unit(y),u);
      else if(Array.isArray(x))out[k]=x.map((v,i)=>v+(y[i]-v)*u);
      else if(typeof x==='number')out[k]=x+(y-x)*u;}
    return out;
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
  // Drive direction changes the stride, body alignment and finish plane,
  // not just the exit angle. Profiles blend continuously between named shots.
  function driveKeys({start,target,aim=0,loft=false,stance,impact=.15}) {
    const mix=(a,b,u)=>a+(b-a)*u;
    const blend=(a,b,u)=>Object.fromEntries(Object.keys(a).map(k=>[k,
      Array.isArray(a[k])?a[k].map((v,i)=>mix(v,(b[k]||a[k])[i],u))
        :typeof a[k]==='number'?mix(a[k],b[k]??a[k],u):a[k]]));
    const angle=clamp(aim,-100,35),rad=angle*Math.PI/180,dx=Math.sin(rad),dz=Math.max(.12,Math.cos(rad));
    // angle, stride x, stride z, hip/shoulder contact, finish height, finish shoulder
    // (strides shortened November 2026: from the side it was nearly the splits, hips low between the feet, back leg locked)
    const profiles=[[-100,.12,1.02,-88,-108,1.08,-80],[-45,.20,1.18,-76,-94,1.36,-56],
      [0,.34,1.29,-62,-78,1.62,-18],[35,.50,1.21,-44,-60,1.53,20]];
    let i=0;while(i<profiles.length-2&&angle>profiles[i+1][0])i++;
    const a=profiles[i],b=profiles[i+1],u=clamp((angle-a[0])/(b[0]-a[0]),0,1),p=a.map((v,k)=>mix(v,b[k],u));
    const low=clamp((.5-target[1])*.35,0,.10),fr=[clamp(target[0]+p[1],-.18,.9),0,p[2]+.12];   // a long stride that reads from the bowler's end
    const bd=unit([-.04+dx*.30,-1,-.08]),h=add(target,scale(bd,-.48));
    const pelvis=[mix(start.pel[0],fr[0],.7),.71-low*.5,1.0-.12*Math.max(0,(-angle-45)/55)];   // into the front knee
    const contact={...start,fr,pel:pelvis,hy:p[3],sy:p[4],lean:29+low*50,side:4,h,bd,...(start.bk?{bk:add(start.bk,[0,0,.06])}:{}),
      kpL:[dx*.65-.10,0,1],...(start.kpR?{kpR:[-.85,-.12,.5]}:{}),rearFootPitch:.5};   // the back knee softens toward the pitch, up on the back toe
    const load={...start,pel:add(start.pel,[0,-.015,.025]),hy:start.hy+6,sy:start.sy-5,
      h:add(start.h,[.01,.025,-.025]),bd:slerp(unit(start.bd),unit([-.4,.76,-.51]),.3)};
    const slot={...blend(start,contact,.65),hy:mix(start.hy,contact.hy,.85),sy:mix(start.sy,contact.sy,.45),
      h:[mix(start.h[0],h[0],.7),h[1]+.1,h[2]-.12],bd:unit([-.18+dx*.12,-.32,-.92])};
    const through={...contact,pel:add(pelvis,[0,.005,.05]),hy:p[3]+12,sy:p[4]+12,lean:22+low*30,side:5,
      h:add(h,[dx*.16,.035,dz*.20]),bd:unit([dx*.55-.04,-.65,.75*dz]),rearFootPitch:.23};
    const extension={...contact,pel:add(pelvis,[0,loft?.04:.015,.08]),hy:p[3]+22,sy:p[4]+28,lean:loft?14:19,side:loft?2:5,
      h:add(h,[dx*.24,.18+(loft?.15:0),.30*dz]),bd:unit([dx*.9-.04,loft?.4:.12,.96*dz]),rearFootPitch:.3};
    // along the ground the drive is checked: the bat stops pointing up in front, at the shoulders; lofted, it goes right through
    const height=loft?Math.max(1.60,p[5]+.15):p[5]-.1;
    // weight stays on the bent front knee, head and front shoulder over it (a lofted drive comes up taller)
    const finish={...contact,pel:[pelvis[0]+.015,loft?.83:.75,1.04-.12*Math.max(0,(-angle-45)/55)],
      hy:p[3]+30,sy:p[6],lean:loft?10:16,side:loft?2:5,rearFootPitch:.38,
      // hands up beside the head on its off side, not in front of the face (it hid the face from the bowler's end)
      h:[pelvis[0]-.24+dx*.18,height,1.08-.1*Math.abs(dx)],
      bd:loft?unit([dx*.9-.12,.86,.30]):unit([dx*.45-.2,mix(.55,.95,Math.max(0,1-Math.abs(angle)/100)),.3])};
    const settle={...finish,pel:add(finish.pel,[0,.03,-.02]),h:add(finish.h,[0,-.06,loft?0:.06]),lean:loft?8:12,side:loft?1:3,rearFootPitch:.25};
    return [[0,start],[impact*.26,load],[impact*.63,slot],[impact,contact],
      [impact+.075,through],[impact+.18,extension],[impact+.42,finish],
      [impact+.95,settle],[impact+1.6,stance]];
  }
  // Square cut: sit into a wider base, strike across the ball, then roll
  // through at chest height. Keep this finish distinct from an upper cut.
  function cutKeys({start,target,stance,impact=.15}) {
    const bd=unit([-.94,-.15,-.3]),h=add(target,scale(bd,-.48));
    const shift=clamp(target[0],-.35,.25),dip=clamp((1-target[1])*.35,0,.22);
    // the back foot goes back and across toward off stump and takes the weight (knee bent over it), the front foot stays
    // near its guard and the front leg straightens a little; he leans out over the ball toward point (November 2026: the
    // front foot used to step 30 cm to the leg side and both knees bowed out toward point)
    const contact={...start,fr:[.58+shift*.5,0,1.02],bk:[.34+shift*.8,0,.44],pel:[.48+shift*.75,.79-dip,.72],
      hy:-84,sy:-94,lean:22+dip*40,side:6,h,bd,kpL:[-.35,0,.95],kpR:[-.9,0,.45],rearFootPitch:0};   // low, leaning out over the ball
    const upPel=[.58+shift*.5,.80-dip,.74],upLean=11+dip*40;   // the body stays up until the bat comes through
    const load={...contact,pel:start.pel.map((v,i)=>v+(upPel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.4,sy:start.sy+(contact.sy-start.sy)*.25,
      lean:start.lean+(upLean-start.lean)*.4,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3+(i===1?.03:0)),
      bd:slerp(unit(start.bd),unit([-.7,.32,-.64]),.2)};   // already on its way down (it used to lift first and wait)
    const slot={...contact,pel:upPel,lean:upLean,sy:-105,h:add(h,[.06,.09,-.02]),bd:unit([-.7,.32,-.64])};   // drops into the shot only as the bat comes through
    const through={...contact,hy:-72,sy:-72,h:add(h,[-.08,-.07,.13]),bd:unit([-.96,-.2,.2])};
    const extension={...contact,hy:-64,sy:-52,lean:16,
      h:[.38+shift,h[1]-.1,1.26],bd:unit([-.7,-.15,.7])};
    // held out toward point, arms long, the face rolled over (reads from the bowler's end)
    const finish={...contact,pel:[.50+shift,.80,.74],hy:-62,sy:-46,lean:18,side:4,
      h:[.24+shift,1.17,1.12],bd:unit([-.9,.22,.36])};
    const settle={...finish,sy:-50,lean:14,h:add(finish.h,[.04,-.08,-.02])};
    return [[0,start],[impact*.33,load],[impact*.68,slot],[impact,contact],
      [impact+.075,through],[impact+.17,extension],[impact+.38,finish],[impact+.85,settle],[impact+1.5,stance]];
  }
  // Pull: a grounded back-foot base, hips leading the shoulders and a level
  // wrap across the chest. Height adaptation keeps low contacts within reach.
  function pullKeys({start,target,stance,loft=false,impact=.15}) {
    const shift=clamp(target[0]*.8,-.28,.25),low=clamp((1.15-target[1])*.4,0,.18);
    const bd=unit([-.97,-.09,.22]),h=add(target,scale(bd,-.48));
    // back and across deep in the crease (owner: the legs hardly moved), front foot opened toward the leg side
    // to a lower ball (a short spinner) he rocks back and stays fairly tall, bending a little more at the knees and reaching
    // with the arms (it used to splay into a deep crouch)
    const contact={...start,fr:[1.0+shift-low*.3,0,1.0],bk:[.40+shift,0,.24],pel:[.63+shift,.77-low*.4,.64],
      hy:-38,sy:-52,lean:14+low*18,side:-3,h,bd,kpL:[.6,0,.8],kpR:[-.65,0,.75],rearFootPitch:0};   // down on the back leg
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.45),
      hy:start.hy+(contact.hy-start.hy)*.65,sy:start.sy+(contact.sy-start.sy)*.18,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3+(i===1?.06:0)),bd:slerp(unit(start.bd),unit([-.7,.5,-.5]),.3)};
    const slot={...contact,hy:-48,sy:-76,h:add(h,[-.035,.10,-.12]),bd:unit([-.78,.25,-.57])};
    const through={...contact,hy:-24,sy:-22,lean:10+low*12,
      h:add(h,[.13,loft?.06:-.04,.17]),bd:unit([-.48,-.12,.87])};
    const extension={...contact,pel:[.70+shift,.84,.68],hy:10,sy:30,lean:7,
      h:[.95+shift,loft?1.38:1.2,1.0],bd:unit([.5,loft?.45:.3,.8]),rearFootPitch:.2};
    // the body turns right round to the leg side and the bat wraps over the shoulder, hands up by the shoulder (the owner's
    // Rohit frames): it used to stop flat at the waist
    const finish={...contact,pel:[.72+shift,.85,.66],hy:32,sy:75,lean:6,rearFootPitch:.45,
      h:[.92+shift,loft?1.38:1.26,.64],bd:unit([.2,loft?.55:.45,-.85])};
    const settle={...finish,hy:24,sy:62,h:add(finish.h,[-.03,-.08,.04]),bd:unit([.3,.5,-.8]),rearFootPitch:.25};
    return [[0,start],[impact*.3,load],[impact*.66,slot],[impact,contact],
      [impact+.08,through],[impact+.20,extension],[impact+.42,finish],[impact+.85,settle],[impact+1.5,stance]];
  }
  // Hook: stay tall behind the high ball, open the front foot, swivel through
  // at shoulder height and carry the blade above the leg-side shoulder. Both
  // shoes have support; the old fixed airborne front foot hovered until recovery.
  function hookKeys({start,target,stance,loft=false,impact=.15}) {
    const shift=clamp(target[0]*.8,-.28,.25),bd=unit([-.96,.06,.27]);
    const h=add(target,scale(bd,-.48));
    const contact={...start,fr:[.98+shift,0,.94],bk:[.5+shift,0,.38],pel:[.68+shift,.93,.74],
      hy:-40,sy:-48,lean:-7,side:0,h,bd,kpL:[.65,0,.76],kpR:[-.6,0,.8],rearFootPitch:0};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.45),
      hy:start.hy+(contact.hy-start.hy)*.6,sy:start.sy+(contact.sy-start.sy)*.15,
      h:start.h.map((v,i)=>v+(h[i]-v)*.35),bd:slerp(unit(start.bd),unit([-.75,.55,-.35]),.35)};
    const slot={...contact,hy:-49,sy:-72,h:add(h,[-.035,.06,-.10]),bd:unit([-.86,.3,-.4])};
    const through={...contact,hy:-18,sy:-10,lean:-5,
      h:add(h,[.13,.04,.13]),bd:unit([-.45,.16,.88]),rearFootPitch:.08};
    const top=clamp(h[1]+.12,1.58,1.85);
    const extension={...contact,pel:[.71+shift,.93,.75],hy:0,sy:20,lean:-3,
      h:[.94+shift,top,1.06],bd:unit([.52,.38,.76]),rearFootPitch:.18};
    const finish={...contact,pel:[.73+shift,.92,.75],hy:8,sy:45,lean:0,
      h:[1.02+shift,top+(loft?.04:0),.88],bd:unit([.7,.68,-.22]),rearFootPitch:.26};
    const settle={...finish,hy:0,sy:34,h:add(finish.h,[-.04,-.08,.02]),rearFootPitch:.14};
    return [[0,start],[impact*.3,load],[impact*.66,slot],[impact,contact],
      [impact+.08,through],[impact+.20,extension],[impact+.42,finish],[impact+.85,settle],[impact+1.5,stance]];
  }
  // Upper cut: make room with the front leg, stay tall, lift the blade
  // through the high ball and extend above the off shoulder.
  function ucutKeys({start,target,stance,short=false,impact=.15}) {
    // to a short ball (as in the owner's reference photo): a wide base, the back foot flat and the weight going back onto it,
    // the front foot light on its toe with the knee soft, the body tall and leaning back a little, hands up by the head;
    // off a fuller length he can bend into it
    const shift=clamp(target[0],-.35,.25),low=clamp((1.35-target[1])/.65,0,1)*(short?.25:1),w=short?1:0;
    const bd=unit([-.93,.30-.4*low,.2]),h=add(target,scale(bd,-.48));
    const fr=[.88+.10*w+shift,0,.95+.18*w],bk=[.58-.03*w+shift,0,.35-.06*w];
    const pel=[.64+.02*w+shift,.94-.29*low-.035*w,.73-.04*w];
    const contact={...start,fr,bk,pel,
      hy:-85+6*w,sy:-94+6*w,lean:-3+30*low-6*w,side:5,h,bd,kpL:[-.7+.25*w,0,.7+.2*w],kpR:[-1,0,0],rearFootPitch:0,frontFootPitch:.42*w};
    const load={...contact,pel:start.pel.map((v,i)=>v+(pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.4,sy:start.sy+(contact.sy-start.sy)*.2,
      lean:start.lean+(contact.lean-start.lean)*.4,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3),bd:slerp(unit(start.bd),unit([-.8,.3,.5]),.25),frontFootPitch:.1*w};
    const slot={...contact,h:add(h,[.02,-.07,.03]),bd:unit([-.95,.08,.3]),frontFootPitch:.3*w};
    const through={...contact,pel:[pel[0],.94-.12*low-.03*w,pel[2]-.01*w],hy:-91+4*w,sy:-106+4*w,lean:-4+18*low-6*w,h:add(h,[-.04,.13+.05*w,.01]),bd:unit(w?[-.9,.32,-.2]:[-.8,.54,-.23]),
      frontFootPitch:.5*w};
    const extension={...through,hy:-96+3*w,sy:-116+3*w,h:add(h,[-.14,.22+.08*w,-.04]),bd:unit(w?[-.9,.24,-.32]:[-.83,.52,-.18]),frontFootPitch:.5*w};
    const finish={...contact,pel:[pel[0],.94-.02*w,pel[2]],hy:-100,sy:-126,lean:-2-3*w,
      // to a short ball (Sehwag's upper cut): hands up above the forehead, the bat held flat out toward the off side
      h:[.35+.05*w+shift,Math.min(1.88+.07*w,Math.max(1.72+.1*w,h[1]+.3)),.90+.05*w],bd:unit(w?[-.9,.16,-.40]:[-.66,.74,-.12]),frontFootPitch:.35*w};
    const settle={...finish,sy:-112,lean:0,h:add(finish.h,[.02,-.09,0]),frontFootPitch:0};
    start={...start,frontFootPitch:0};stance={...stance,frontFootPitch:0};
    return [[0,start],[impact*.33,load],[impact*.68,slot],[impact,contact],
      [impact+.075,through],[impact+.20,extension],[impact+.40,finish],[impact+.85,settle],[impact+1.5,stance]];
  }
  // Two low strokes, authored around their support leg and direction of travel.
  // The reverse is not a mirrored standing drive: hands cross to the off side,
  // the blade extends back toward the ball and the shoulders unwind oppositely.
  function sweepKeys(args) { return lowSweepKeys(args,false); }
  function rsweepKeys(args) { return lowSweepKeys(args,true); }
  function lowSweepKeys({start,target,stance,loft=false,impact=.15},reverse) {
    const shift=clamp(target[0],-.3,.25), height=clamp(target[1],.16,1.05),lift=loft&&!reverse,rlift=loft&&reverse;
    const bd=unit(reverse?[.84,-.12,.52]:[-.94,-.22,.25]);
    const h=add(target,scale(bd,-.46));
    const contact={...start,
      fr:[.48+shift,0,reverse?1.0:1.3],bk:[(reverse?.65:.8)+shift,0,reverse?.05:.19],
      pel:[(reverse?.35:.57)+shift,(reverse?.49:.46)+(height-.3)*.16+Math.max(0,height-.65)*.5,reverse?.58:.70],
      hy:reverse?-92:-58,sy:reverse?-110:-48,lean:reverse?42:30,side:0,
      h,bd,kpL:reverse?[.15,0,1]:[-.25,0,1],kpR:[0,-1,1],rearFootPitch:.65,
      epL:[-.6,-.3,.7],epR:[.3,-.7,-.4]};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.45),
      hy:start.hy+(contact.hy-start.hy)*.35,sy:start.sy+(contact.sy-start.sy)*.25,
      lean:start.lean+(contact.lean-start.lean)*.4,
      h:reverse?[.20+shift,1.0,1.0]:[.22+shift,.88,.83],
      bd:unit(reverse?[.18,.97,.12]:[-.65,.55,-.52]),rearFootPitch:.35};
    const slot={...contact,pel:[contact.pel[0],contact.pel[1]+.045,contact.pel[2]],
      h:reverse?[-.08+shift,.64,.98]:add(h,[-.06,.05,-.04]),
      bd:unit(reverse?[.74,.60,.28]:[-.85,-.08,-.52])};
    const through={...contact,sy:reverse?-130:-20,
      h:reverse?[-.40+shift,rlift?.62:.42,1.10]:[.78+shift,lift?.72:.55,1.38],
      bd:unit(reverse?[-.70,rlift?.30:-.32,.64]:[.35,lift?.3:-.1,.93])};
    const finish={...contact,hy:reverse?-105:-35,sy:reverse?-142:18,lean:reverse?30:22,
      h:reverse?[(rlift?-.10:-.24)+shift,rlift?1.02:.86,rlift?.95:1.05]:[.83+shift,lift?1.08:.72,1.38],
      bd:unit(reverse?(rlift?[-.62,.72,-.32]:[-.22,.95,.20]):[.91,lift?.72:.25,-.32])};
    const settle={...finish,h:add(finish.h,[0,-.035,0])};
    // Hold the low silhouette, then rise before stepping back into guard.
    const rise={...finish,pel:[contact.pel[0],.73,.78],lean:15,
      h:reverse?[.08+shift,.86,.83]:[.53+shift,.85,1.05],
      bd:unit(reverse?[-.65,-.55,-.3]:[.3,-.9,.2]),rearFootPitch:.25};
    // the reverse turns the bat right over: spread across the downswing (it all happened in the first 0.05 s)
    const keys=reverse?[[0,start],[impact*.25,{...load,bd:slerp(unit(start.bd),unit(load.bd),.5)}],[impact*.5,between(load,slot,.35)],[impact*.75,slot]]
      :[[0,start],[impact*.34,load],[impact*.72,slot]];
    return [...keys,[impact,contact],
      [impact+(reverse?.07:.10),through],[impact+.34,finish],[impact+.64,settle],
      [impact+.98,rise],[impact+1.45,stance]];
  }
  // Late cut: compact upright blade and a small open-face deflection.
  // Do not turn this into another full cross-bat swing or overhead finish.
  function lcutKeys({start,target,stance,impact=.15}) {
    const bd=unit([-.35,-.92,.17]),h=add(target,scale(bd,-.48));
    const shift=clamp(target[0],-.35,.25),low=clamp((.65-target[1])/.4,0,1);
    const contact={...start,fr:[.70+shift,0,1.0],bk:[.51+shift,0,.31],pel:[.56+shift,.87-.11*low,.73],
      hy:-94,sy:-100,lean:15+12*low,side:3,h,bd,kpL:[-1,0,.3],kpR:[-1,0,0],rearFootPitch:0,batRoll:.35};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.35),
      hy:start.hy+(contact.hy-start.hy)*.3,sy:start.sy+(contact.sy-start.sy)*.2,
      h:start.h.map((v,i)=>v+(h[i]-v)*.25),bd:slerp(unit(start.bd),unit([-.5,-.6,.45]),.15),batRoll:.08};
    const slot={...contact,sy:-96,h:add(h,[.015,.07,.01]),bd:unit([-.5,-.6,.45]),batRoll:.25};
    const mid=between(load,slot,.5);   // the bat starts down at once and turns evenly (no lift, then snap)
    const through={...contact,sy:-106,h:add(h,[-.035,-.015,-.05]),bd:unit([-.44,-.88,-.12]),batRoll:.42};
    const finish={...contact,sy:-112,lean:14+8*low,
      h:[h[0]-.055,h[1]-.045,h[2]-.10],bd:unit([-.48,-.86,-.16]),batRoll:.4};
    const settle={...finish,sy:-106,h:add(finish.h,[.01,.025,.02]),batRoll:.25};
    return [[0,{...start,batRoll:0}],[impact*.25,load],[impact*.5,mid],[impact*.75,slot],[impact,contact],
      [impact+.095,through],[impact+.3,finish],[impact+.75,settle],[impact+1.4,{...stance,batRoll:0}]];
  }
  // Leg glance: meet the ball beside the pad and absorb its pace. Keep the
  // shoulders quiet and the finish below the hands of a full wristy flick.
  function glanceKeys({start,target,stance,loft=false,impact=.15}) {
    const low=clamp((.6-target[1])/.3,0,1);
    const bd=unit([.08,-.98,.12]),h=add(target,scale(bd,-clamp((1.32-target[1])/.98,.2,.48+.1*low)));
    const fr=[clamp(target[0]+.43,.12,.76),0,1.12];
    const pel=[.63+(fr[0]-.63)*.4,.86-.065*low,.86];
    const contact={...start,fr,pel,hy:-75,sy:-78,lean:18+8*low,side:6,h,bd,
      kpL:[-.45,0,1],rearFootPitch:0,batRoll:-.12};
    const load={...contact,pel:start.pel.map((v,i)=>v+(pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.3,sy:start.sy+(contact.sy-start.sy)*.2,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3),bd:slerp(unit(start.bd),unit([-.06,-.93,-.36]),.15),batRoll:0};
    const slot={...contact,sy:-80,h:add(h,[-.015,.055,-.045]),bd:unit([-.06,-.93,-.36]),batRoll:-.04};
    const mid=between(load,slot,.5);   // the bat starts down at once and turns evenly (no lift, then snap)
    const through={...contact,sy:-73,lean:17,h:add(h,[.025,-.015,-.025]),bd:unit([.27,-.95,-.06]),batRoll:-.25};
    const finish={...contact,pel:add(pel,[.01,.01,0]),hy:-71,sy:-66,lean:15,side:4,
      h:add(h,[.07,.025,-.055]),bd:unit([.36,-.93,.06]),batRoll:-.32};
    const settle={...finish,h:add(finish.h,[0,-.025,.015]),batRoll:-.2};
    if(loft){   // lifted over fine leg (Shift + up + leg side to pace): a stride forward and across onto a bent front knee, then
      // he rises and opens up as the wrists flick it over fine leg, finishing high beside the leg-side shoulder (owner: the
      // legs didn't move and he stood stiff while only the arms swung)
      const lfr=[clamp(target[0]+.22,.02,.6),0,1.34],lpel=[.58+(lfr[0]-.58)*.4,.78-.06*low,.94];
      const lContact={...contact,fr:lfr,pel:lpel,hy:-72,sy:-74,lean:14,side:12,kpL:[-.3,0,1],rearFootPitch:.3};
      const lLoad={...load,pel:start.pel.map((v,i)=>v+(lpel[i]-v)*.45),side:(start.side||0)+4};
      const lSlot={...slot,fr:lfr,pel:lpel,lean:14,side:12};
      const lThrough={...lContact,hy:-58,sy:-50,lean:12,side:8,h:add(h,[.15,.18,-.05]),bd:unit([.62,-.3,-.72]),batRoll:-.15,rearFootPitch:.4};
      const lFinish={...lContact,pel:add(lpel,[.04,.08,-.03]),hy:-42,sy:-18,lean:6,side:4,
        h:[lpel[0]+.32,1.5,lpel[2]-.10],bd:unit([.45,.78,-.43]),batRoll:-.1,rearFootPitch:.5};
      const lSettle={...lFinish,sy:-26,h:add(lFinish.h,[-.02,-.08,.02]),bd:unit([.40,.70,-.6]),batRoll:-.05,rearFootPitch:.3};
      return [[0,{...start,batRoll:0}],[impact*.25,lLoad],[impact*.5,between(lLoad,lSlot,.5)],[impact*.75,lSlot],[impact,lContact],
        [impact+.07,lThrough],[impact+.3,lFinish],[impact+.8,lSettle],[impact+1.5,{...stance,batRoll:0}]];
    }
    return [[0,{...start,batRoll:0}],[impact*.25,load],[impact*.5,mid],[impact*.75,slot],[impact,contact],
      [impact+.075,through],[impact+.24,finish],[impact+.8,settle],[impact+1.45,{...stance,batRoll:0}]];
  }
  // Flick: plant toward the line, bring a straight blade through the ball,
  // then release the wrists into a leg-side extension before wrapping up.
  function flickKeys({start,target,stance,aim=45,loft=false,impact=.15}) {
    const shift=clamp(target[0],-.3,.3),low=clamp((.6-target[1])/.4,0,1);
    const fr=[clamp(.53+shift*1.1,.12,.86),0,1.3];
    const bd=unit([.12,-1,-.06]),h=add(target,scale(bd,-clamp((1.4-target[1])/-bd[1],.2,.52+.06*low)));
    const contact={...start,fr,pel:[.51+shift*.45,.85-low*.055,1.0],hy:-69,sy:-75,
      lean:23+low*5,side:8,h,bd,kpL:[-.25,0,1],rearFootPitch:0,batRoll:0};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.35),
      hy:-82,sy:-88,h:add(start.h,[-.025,.035,0]),bd:slerp(unit(start.bd),unit([-.16,-.7,-.69]),.15),batRoll:0};
    const slot={...contact,hy:-74,sy:-82,h:add(h,[-.025,.12,-.085]),bd:unit([-.16,-.7,-.69])};
    const mid=between(load,slot,.5);   // the bat starts down at once and turns evenly (no lift, then snap)
    const through={...contact,hy:-54,sy:-42,lean:20,side:5,
      h:add(h,[.14,.055,.14]),bd:unit([.62,-.66,.43]),batRoll:.12,rearFootPitch:.1};
    const square=clamp((aim-45)/80,0,1);
    const extension={...contact,hy:-43,sy:-16,lean:16,side:3,
      h:[.55+shift*.4,loft?1.36:1.15,1.4-square*.08],
      bd:unit([.87,loft?.25:-.3,.46-square*.2]),batRoll:loft?.16:.35,rearFootPitch:.2};
    const finish={...extension,pel:[.53+shift*.4,loft?.89:.84,1.08],hy:-38,sy:-12,lean:loft?11:16,side:loft?1:4,
      h:[.66+shift*.35,loft?1.67:1.36,1.15],bd:unit([.75,loft?.62:.35,-.48]),batRoll:loft?.22:.55};
    const settle={...finish,sy:-18,h:add(finish.h,[0,-.055,0]),batRoll:.25};
    return [[0,{...start,batRoll:0}],[impact*.25,load],[impact*.5,mid],[impact*.75,slot],[impact,contact],
      [impact+.075,through],[impact+.2,extension],[impact+.42,finish],[impact+.9,settle],
      [impact+1.6,{...stance,batRoll:0}]];
  }
  function bdriveKeys({start,target,stance,aim=0,loft=false,impact=.15}) {
    const shift=clamp(target[0],-.3,.3),high=clamp((target[1]-1.15)/.45,0,1),dy=-clamp((1.48-target[1])/.48,.12,.97),dz=.12;
    const bd=unit([-Math.sqrt(Math.max(.01,1-dy*dy-dz*dz)),dy,dz]);
    const h=add(target,scale(bd,-.48));
    const contact={...start,fr:[.58+shift,0,.94],bk:[.5+shift,0,.25],pel:[.55+shift,.90+.035*high,.54+.18*high],
      hy:-82,sy:-87,lean:10,side:0,h,bd,kpL:[-.85,0,.5],kpR:[-1,0,.05],rearFootPitch:0};
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.4),
      hy:start.hy+(contact.hy-start.hy)*.3,sy:start.sy+(contact.sy-start.sy)*.2,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3),bd:slerp(unit(start.bd),bd,.3)};
    const slot={...contact,hy:-80,sy:-82,h:add(h,[0,.035,-.055]),bd:slerp(unit(start.bd),bd,.65)};
    const dx=Math.sin(clamp(aim,-45,25)*Math.PI/180);
    const through={...contact,pel:[.55+shift,.91+.025*high,.57+.14*high],hy:-67,sy:-66,lean:12,
      h:add(h,[dx*.12,.025,.20]),bd:unit([-.18+dx*.1,-.65,.74])};
    const extension={...through,hy:-59,sy:-53,lean:14,
      h:add(h,[dx*.20,.065,.30]),bd:unit([-.12+dx*.4,loft?.32:-.12,.98])};
    const finish={...contact,pel:[.55+shift,.93,.55],hy:-58,sy:-40,lean:9,
      h:[.35+shift+dx*.15,loft?1.72:1.36,1.12],bd:unit([-.44+dx*.25,loft?.78:.42,.65])};
    const settle={...finish,sy:-48,h:add(finish.h,[0,-.08,-.025])};
    return [[0,start],[impact*.3,load],[impact*.65,slot],[impact,contact],
      [impact+.075,through],[impact+.18,extension],[impact+.4,finish],[impact+.85,settle],[impact+1.5,stance]];
  }
  // Defensive strokes share a quiet blade, but not the same weight transfer.
  // Push releases the arms after contact; a block absorbs the ball instead.
  function defenceKeys({start,target,stance,aim=0,impact=.15},back=false,push=false) {
    const shift=clamp(target[0],-.3,.3),low=clamp((.55-target[1])/.35,0,1),high=clamp((target[1]-1.15)/.45,0,1);
    const dy=-clamp((1.52-target[1])/.45,.12,.98);
    const bd=back?unit([-Math.sqrt(Math.max(.01,1-dy*dy-.12*.12)),dy,.12]):unit([-.035,-1,-.18]);
    const reach=back?.45:.52+.06*low,h=add(target,scale(bd,-reach));
    const contact={...start,
      fr:back?[.57+shift*.6,0,.92]:[clamp(.34+shift,.05,.72),0,1.39],
      bk:back?[.54+shift*.6,0,.25]:start.bk.slice(),
      pel:back?[.54+shift*.6,.90-.07*low+.035*high,.55+.18*high]:[.43+shift*.5,.79-.065*low,1.01],
      hy:back?-83:-76,sy:back?-88:-82,lean:back?12+low*8:28+low*6,side:3,h,bd,
      kpL:back?[-.8,0,.5]:[-.2,0,1],kpR:[-1,0,.05],rearFootPitch:back?0:.1,batRoll:0};
    const slot={...contact,lean:contact.lean-2,h:add(h,[-.015,.075,-.055]),
      bd:slerp(unit([-.25,-.4,-.88]),bd,.55)};
    // the bat starts down at once and turns at an even pace (it used to lift first, then swing 120° in 0.06 s and stop dead)
    const start0={...start,batRoll:0},load=between(start0,slot,.18),mid=between(start0,slot,.6);
    const highBlock=back?high:0;
    const soft={...contact,h:add(h,[0,-.012*(1-highBlock),-.025+.06*highBlock]),lean:contact.lean+1};
    const dx=Math.sin(clamp(aim,-60,55)*Math.PI/180);
    const finish=push?{...contact,hy:-67,sy:-62,lean:24,side:2,pel:add(contact.pel,[0,.025,.035]),
      h:add(h,[dx*.17,.035,.24]),bd:unit([dx*.3-.035,-.88,.47]),rearFootPitch:.18}
      :{...soft,h:add(h,[0,-.018*(1-highBlock),-.035+.09*highBlock]),sy:contact.sy+2};
    const settle={...finish,h:add(finish.h,[0,.015,-.01])};
    return [[0,start0],[impact*.25,load],[impact*.5,mid],[impact*.75,slot],[impact,contact],
      [impact+.07,soft],[impact+(push?.28:.20),finish],[impact+.78,settle],[impact+1.4,{...stance,batRoll:0}]];
  }
  const fdefKeys=args=>defenceKeys(args),bdefKeys=args=>defenceKeys(args,true),pushKeys=args=>defenceKeys(args,false,true);
  // Slog loads into a wide base and drives the hips through the ball before
  // the arms wrap high. It must not look like a wristy flick or a short-ball pull.
  function slogKeys({start,target,stance,aim=70,impact=.15}) {
    const shift=clamp(target[0],-.3,.3),low=clamp((.7-target[1])/.4,0,1);
    const bd=unit([-.76+.25*low,-.58-.24*low,.24]),h=add(target,scale(bd,-.58));
    const contact={...start,fr:[.88+shift*.5,0,1.27],bk:[.49+shift*.5,0,.38],
      pel:[.64+shift*.5,.79-.10*low,.88],hy:-44,sy:-59,lean:23+low*8,side:3,h,bd,
      kpL:[.25,0,1],kpR:[-1,0,.1],rearFootPitch:.1,batRoll:0};
    const load={...contact,pel:[.61+shift*.4,.82-.05*low,.69],hy:-73,sy:-94,lean:18,
      h:[.31+shift*.25,1.39,.72],bd:unit([-.5,.75,-.42]),batRoll:0};
    const slot={...contact,hy:-57,sy:-77,h:add(h,[-.04,.17,-.10]),bd:unit([-.87,-.28,-.4])};
    const through={...contact,pel:add(contact.pel,[.025,.025,.025]),hy:-25,sy:-20,lean:20,
      h:add(h,[.15,.10,.14]),bd:unit([.5,-.45,.74]),rearFootPitch:.22,batRoll:.10};
    const fine=clamp((aim-45)/70,0,1);
    const extension={...through,hy:-5,sy:12,lean:12,side:0,
      h:[.79+shift*.35,1.43,1.37-.1*fine],bd:unit([.82,.28,.5]),batRoll:.18};
    const finish={...extension,pel:[.69+shift*.4,.90,.96],hy:5,sy:38,lean:7,
      h:[.91+shift*.25,1.79,1.05],bd:unit([.53,.72,-.45]),rearFootPitch:.3,batRoll:.28};
    const settle={...finish,sy:30,h:add(finish.h,[-.025,-.09,0]),rearFootPitch:.18,batRoll:.15};
    return [[0,{...start,batRoll:0}],[impact*.3,load],[impact*.7,slot],[impact,contact],
      [impact+.08,through],[impact+.23,extension],[impact+.46,finish],[impact+.95,settle],[impact+1.7,{...stance,batRoll:0}]];
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
  const api={prepare,sample,contactTime,sampleDrive,driveKeys,cutKeys,pullKeys,hookKeys,ucutKeys,sweepKeys,rsweepKeys,lcutKeys,glanceKeys,flickKeys,bdriveKeys,fdefKeys,bdefKeys,pushKeys,slogKeys,sampleCut,cutWidth,pathWidth,sweepWidth,blendDirection:slerp};root.CricketMotion=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
