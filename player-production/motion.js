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
    // dZ7iRdqfW1A, 12.9–13.6 s: the front leg accepts the weight before
    // impact. The gloves pass the front thigh, rise across the chest, then
    // fold beside the temple. The rear heel follows the turn of the hips.
    const angle=clamp(aim,-100,35)*Math.PI/180;
    const across=Math.sin(angle), forward=Math.cos(angle);
    const square=Math.max(0,-across)**2;
    const front=[clamp(target[0]+.32+.20*across,-.22,.92),0,1.37-.29*square];
    const frontPole=[across*.58-.12,0,1];
    const dip=clamp((.55-target[1])*.13,0,.075);
    const hip=[front[0]+.15,.735-dip,.99-.10*square];
    const blade=unit([-.085+.25*across,-1,.06+.08*forward]);
    const lever=clamp(.72-(target[1]-.045)/-blade[1],.48,.70);
    const hands=add(target,scale(blade,-lever));
    const contact={...start,h:hands,bd:blade,fr:front,pel:hip,kpL:frontPole,
      ...(start.kpR?{kpR:[-.72,-.05,.62]}:{}),hy:-60+across*17,sy:-77+across*19,
      lean:27+dip*55,side:6,rearFootPitch:.38};
    // The handle leads first. Keep the blade trailing in depth until just
    // before impact so the downswing reads round the back shoulder.
    const coil={...start,pel:add(start.pel,[0,-.012,.016]),sy:start.sy-4,
      h:add(start.h,[-.025,.035,-.024]),bd:unit([-.24,.89,-.39])};
    const highBall=clamp((target[1]-.6)/.3,0,1);
    const drop={...between(coil,contact,.52),h:add(hands,[.02-.11*highBall,.16,-.20+.10*highBall]),
      bd:unit([-.36,.09,-.93])};
    const delivery={...between(drop,contact,.55),h:add(hands,[.012-.075*highBall,.065,-.09+.065*highBall]),
      bd:unit([-.32+.1*across,-.73,-.61])};
    const through={...contact,hy:contact.hy+7,sy:contact.sy+10,lean:25+dip*35,
      pel:add(hip,[.015,0,.025]),h:add(hands,[across*.12,.03,.14*forward]),
      bd:unit([.10+.54*across,-.61,.77*forward+.11]),rearFootPitch:.48};
    const extend={...through,hy:contact.hy+15,sy:contact.sy+22,lean:loft?16:21,
      h:add(hands,[across*.24+.035,loft?.32:.18,.25*forward+.04]),
      bd:unit([across*.83+.12,loft?.53:.18,.90*forward+.13]),rearFootPitch:.56};
    const high=loft?1.58+.07*forward:1.48-.47*square;
    const finish={...extend,pel:add(hip,[.03,loft?.07:.035,.05]),
      sy:-23+across*43,hy:-36+across*25,lean:loft?9:17,side:loft?-3:5,
      h:[hip[0]-.13+across*.25+(loft?.11:0),high,1.09+.12*forward],
      bd:loft?unit([-.53+.31*across,.69,-.46]):unit([across*.62-.17,.74-.38*square,.42*forward+.12]),
      rearFootPitch:.49};
    // In GZawiOz2GpM (3.4–3.9 s, then the slow replay), the cover drive
    // finishes with high gloves and the toe still below them, out towards
    // cover. The head stays down underneath the lead elbow through extension.
    if (!loft) {
      const cover=clamp((-aim-8)/34,0,1)*clamp((88+aim)/30,0,1);
      extend.bd=slerp(extend.bd,unit([-.60,-.48,.64]),cover);
      finish.bd=slerp(finish.bd,unit([-.54,-.44,.72]),cover);
      finish.h=add(finish.h,[-.02*cover,.19*cover,.08*cover]);
      finish.lean+=8*cover;
    }
    const release={...finish,h:add(finish.h,[.015,-.045,.055]),rearFootPitch:.33,
      bd:slerp(finish.bd,unit([across*.55,.81,.35]),.28)};
    return [[0,start],[impact*.23,coil],[impact*.57,drop],[impact*.80,delivery],
      [impact,contact],[impact+.05,through],[impact+.12,extend],
      [impact+(loft?.27:.24),finish],[impact+.78,release],[impact+1.45,stance]];
  }
  // Square cut: sit into a wider base, strike across the ball, then roll
  // through at chest height. Keep this finish distinct from an upper cut.
  function cutKeys({start,target,stance,loft=false,impact=.15}) {
    // Bring the upper-cut gather down to a square contact. The shoulders
    // release across the planted base and the wrists turn the face over.
    const across=clamp(target[0]*.8,-.31,.21);
    const low=clamp((1.20-target[1])/.65,0,1);
    const bd=unit([-.95,-.14-.29*low,-.23]);
    const h=add(target,scale(bd,-.48));
    const pel=[.55+across,.84-.11*low,.67];
    const contact={...start,fr:[.65+across*.65,0,1.08],bk:[.45+across,0,.41],pel,
      hy:-88,sy:-88,lean:15+10*low,side:4,h,bd,
      kpL:[-.57,0,.82],kpR:[-.93,0,.37],rearFootPitch:0};
    const gather={...contact,pel:add(pel,[.045,.025,-.015]),hy:-94,sy:-102,lean:11+8*low,
      h:[.22+across,1.33-.12*low,.83],bd:unit([-.32,.84,-.43])};
    const swing={...contact,sy:-101,h:add(h,[-.12,.095,-.025]),bd:unit([-.78,.13,-.61])};
    const cross={...contact,pel:add(pel,[0,.012,.025]),hy:-79,sy:-72,
      h:add(h,[-.055,loft?.07:-.045,.15]),bd:unit([-.94,loft?.12:-.24,.23])};
    const finish={...cross,pel:add(pel,[.015,.04,.065]),hy:-72,sy:-59,lean:13+6*low,
      h:[.28+across,(loft?1.42:1.22)-.18*low,1.18],bd:unit([-.77,loft?.50:.14,.62])};
    const settle={...finish,sy:-66,h:add(finish.h,[.045,-.065,-.025]),bd:unit([-.96,loft?.26:-.09,.25])};
    return [[0,start],[impact*.28,gather],[impact*.69,swing],[impact,contact],
      [impact+.065,cross],[impact+.22,finish],[impact+.74,settle],[impact+1.40,stance]];
  }
  // Pull: a grounded back-foot base, hips leading the shoulders and a level
  // wrap across the chest. Height adaptation keeps low contacts within reach.
  function pullKeys({start,target,stance,loft=false,impact=.15,fineLeg=false}) {
    const shift=clamp(target[0]*.8,-.28,.25),low=clamp((1.15-target[1])*.4,0,.18);
    // The fine-leg loft shares the pull's swivel and wrap. Lower deliveries tilt the blade down,
    // rather than dragging a horizontal bat (and the batter's torso) down to ankle height.
    const dy=fineLeg?-clamp((1.05-target[1])/.8,.09,.92):-.09;
    const bd=fineLeg?unit([-Math.sqrt(1-dy*dy-.22*.22),dy,.22]):unit([-.97,-.09,.22]);
    const contactAlong=fineLeg?.58+.08*clamp((.5-target[1])/.2,0,1):.48;
    const h=add(target,scale(bd,-contactAlong));
    // back and across deep in the crease (owner: the legs hardly moved), front foot opened toward the leg side
    // to a lower ball (a short spinner) he rocks back and stays fairly tall, bending a little more at the knees and reaching
    // with the arms (it used to splay into a deep crouch)
    const contact={...start,fr:[(fineLeg?.84:1.0)+shift-low*.3,0,1.0],bk:[.40+shift,0,.24],pel:[.63+shift,fineLeg?.80:.77-low*.4,fineLeg?.73:.64],
      hy:-38,sy:-52,lean:fineLeg?14:14+low*18,side:-3,h,bd,kpL:[.6,0,.8],kpR:[-.65,0,.75],rearFootPitch:0};   // down on the back leg
    const load={...contact,pel:start.pel.map((v,i)=>v+(contact.pel[i]-v)*.45),
      hy:start.hy+(contact.hy-start.hy)*.65,sy:start.sy+(contact.sy-start.sy)*.18,
      h:start.h.map((v,i)=>v+(h[i]-v)*.3+(i===1?.06:0)),bd:slerp(unit(start.bd),unit([-.7,.5,-.5]),.3)};
    const slot={...contact,hy:-48,sy:-76,h:add(h,[-.035,.10,-.12]),bd:unit([-.78,.25,-.57])};
    const through={...contact,hy:-24,sy:-22,lean:10+low*12,
      h:add(h,[.13,loft?.06:-.04,fineLeg?-.04:.17]),bd:unit([-.48,fineLeg?.18:-.12,.87])};
    const extension={...contact,pel:[.70+shift,.84,.68],hy:10,sy:30,lean:7,
      h:[.95+shift,loft?1.38:1.2,1.0],bd:unit([.5,loft?.45:.3,.8]),rearFootPitch:.2};
    // the body turns right round to the leg side and the bat wraps over the shoulder, hands up by the shoulder (the owner's
    // Rohit frames): it used to stop flat at the waist
    const finish={...contact,pel:[.72+shift,.85,.66],hy:32,sy:75,lean:6,rearFootPitch:.45,
      h:[(fineLeg?.92:.98)+shift,loft?1.38:1.26,fineLeg?.64:.82],
      // Reference pull frames: the blade rises beside the shoulder instead of
      // pointing almost straight behind the torso and disappearing from the match camera.
      bd:fineLeg?unit([.2,loft?.55:.45,-.85]):unit([.65,loft?.75:.65,-.35])};
    const settle={...finish,hy:24,sy:62,h:add(finish.h,[-.03,-.08,.04]),
      bd:fineLeg?unit([.3,.5,-.8]):unit([.65,.65,-.3]),rearFootPitch:.25};
    return [[0,start],[impact*.3,load],[impact*.66,slot],[impact,contact],
      [impact+.08,through],[impact+.20,extension],[impact+.42,finish],[impact+.85,settle],[impact+1.5,stance]];
  }
  // Hook: stay tall behind the high ball, open the front foot, swivel through
  // at shoulder height and carry the blade above the leg-side shoulder. Both
  // shoes have support; the old fixed airborne front foot hovered until recovery.
  function hookKeys({start,target,stance,loft=false,impact=.15}) {
    // The video shows a low gather, an extended lead arm, then both elbows
    // folding as the blade climbs across the face. The crop hides the pivot.
    const across=clamp(target[0]*.68,-.26,.23);
    const low=clamp((1.55-target[1])*.32,0,.18);
    const bd=unit([-.98,loft?.13:-.06,.18]);
    const h=add(target,scale(bd,-.48));
    const contact={...start,fr:[.81+across,0,1.04],bk:[.54+across,0,.39],
      pel:[.64+across,.83-low,.68],hy:-49,sy:-40,lean:9,side:-4,
      kpL:[.55,0,.84],kpR:[-.73,0,.68],h,bd,rearFootPitch:.04};
    const gather={...contact,pel:[.64+across*.65,.81-low,.65],hy:-75,sy:-81,lean:16,
      h:[.33+across,1.26-low,.72],bd:unit([-.34,.91,-.29]),rearFootPitch:0};
    const swing={...contact,hy:-65,sy:-68,lean:13,
      h:add(h,[-.08,.02,-.065]),bd:unit([-.73,.31,-.59])};
    const cross={...contact,pel:add(contact.pel,[.02,.02,.035]),hy:-29,sy:-5,lean:5,
      h:add(h,[.12,.02,.13]),bd:unit([-.32,.18,.93]),rearFootPitch:.17};
    const rise={...cross,hy:-10,sy:22,lean:2,
      h:[.89+across,1.59-low+(loft?.08:0),1.15],bd:unit([.67,.58,.46]),rearFootPitch:.33};
    const fold={...rise,hy:10,sy:47,side:1,pel:[.70+across,.89-low,.74],
      h:[.88+across,1.73-low+(loft?.06:0),.96],bd:unit([.78,.42,-.46]),rearFootPitch:.42};
    const settle={...fold,sy:40,h:add(fold.h,[.02,-.12,-.025]),rearFootPitch:.26};
    return [[0,start],[impact*.26,gather],[impact*.68,swing],[impact,contact],
      [impact+.048,cross],[impact+.115,rise],[impact+.23,fold],[impact+.78,settle],[impact+1.45,stance]];
  }
  // Upper cut: make room with the front leg, stay tall, lift the blade
  // through the high ball and extend above the off shoulder.
  function ucutKeys({start,target,stance,short=false,impact=.15}) {
    // The sheet shows an upright blade by the gloves, followed by a shallow
    // ramp and a nearly level blade as the gloves fold back to the forehead.
    const across=clamp(target[0]*.82,-.32,.24);
    const low=clamp((1.34-target[1])/.62,0,1);
    const lift=short?clamp((target[1]-1.05)/.55,0,1):0;
    const bd=unit([-.94,.24-.37*low,-.25]);
    const h=add(target,scale(bd,-.48));
    const front=[.67+across*.7,0,1.06];
    const pel=[.57+across,.86-.21*low+.035*lift,.67];
    const contact={...start,fr:add(front,[0,.055*lift,-.025*lift]),bk:[.49+across,0,.42],pel,
      hy:-93,sy:-99,lean:6+18*low,side:3,h,bd,
      kpL:[-.54,0,.84],kpR:[-.95,0,.30],frontFootPitch:.12*lift,rearFootPitch:.08*lift};
    const gather={...contact,fr:front,pel:add(pel,[.045,-.045,0]),hy:-88,sy:-87,lean:14+10*low,
      h:[.31+across,1.32-.17*low,.80],bd:unit([-.24,.94,-.24]),frontFootPitch:0,rearFootPitch:0};
    const open={...contact,fr:front,pel:add(pel,[.015,-.03*lift,0]),sy:-93,
      h:add(h,[.065,-.025,-.08]),bd:unit([-.67,.58,-.46]),frontFootPitch:0};
    // Reconstruct the obscured legs with one rear support and a small front
    // knee fold on short balls. Bring the free foot down before recovery.
    const guide={...contact,fr:add(front,[.025*lift,.16*lift,-.09*lift]),
      pel:add(pel,[0,.033+.022*lift,0]),sy:-104,lean:3+11*low,
      h:add(h,[-.07,.115,.04]),bd:unit([-.99,.10,-.10]),rearFootPitch:.14*lift};
    const finish={...guide,fr:add(front,[.03*lift,.19*lift,-.105*lift]),
      pel:add(pel,[.015,.055+.027*lift,.025]),hy:-94,sy:-107,lean:4+8*low,
      h:[Math.min(.36+across,h[0]-.03),clamp(h[1]+.23,1.76,1.88),1.00],
      bd:unit([-.99,-.03,-.13])};
    const land={...finish,fr:front,frontFootPitch:0,rearFootPitch:0,
      pel:add(finish.pel,[.015,-.05,0]),h:add(finish.h,[.018,-.07,0])};
    const settle={...land,sy:-99,h:add(land.h,[.04,-.13,-.03]),bd:unit([-.93,-.34,-.14])};
    return [[0,start],[impact*.30,gather],[impact*.72,open],[impact,contact],
      [impact+.065,guide],[impact+.19,finish],[impact+.48,land],[impact+.80,settle],[impact+1.45,stance]];
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
      h:reverse?[.20+shift,1.0,1.0]:[.24+shift,1.02,1.04],
      bd:unit(reverse?[.18,.97,.12]:[-.39,.89,-.24]),rearFootPitch:.35};
    const slot={...contact,pel:[contact.pel[0],contact.pel[1]+.045,contact.pel[2]],
      h:reverse?[-.08+shift,.64,.98]:add(h,[-.025,.15,-.035]),
      bd:unit(reverse?[.74,.60,.28]:[-.95,.25,-.17])};
    const through={...contact,sy:reverse?-130:-20,
      h:reverse?[-.40+shift,rlift?.62:.42,1.10]:[.71+shift,Math.max(.64,h[1]+.075)+(lift?.12:0),1.37],
      bd:unit(reverse?[-.70,rlift?.30:-.32,.64]:[.38,lift?.34:.02,.92]),...(reverse?{}:{batRoll:lift?.08:.24})};
    const finish={...contact,hy:reverse?-105:-36,sy:reverse?-142:24,lean:reverse?30:22,
      h:reverse?[(rlift?-.10:-.19)+shift,rlift?1.02:.77,rlift?.95:1.12]:[.76+shift,lift?1.12:.72,1.22],
      bd:unit(reverse?(rlift?[-.62,.72,-.32]:[-.36,.32,.88]):[.71,lift?.82:.56,-.58]),...(reverse?{}:{batRoll:lift?.14:.35})};
    const settle={...finish,h:add(finish.h,reverse?[0,-.035,0]:[-.025,-.035,-.04])};
    // Hold the low silhouette, then rise before stepping back into guard.
    const rise={...finish,pel:[contact.pel[0],.73,.78],lean:15,
      h:reverse?[.08+shift,.86,.83]:[.67+shift,.97,1.10],
      bd:unit(reverse?[-.65,-.55,-.3]:[.48,-.74,.47]),rearFootPitch:.25};
    // the reverse turns the bat right over: spread across the downswing (it all happened in the first 0.05 s)
    // The conventional sweep keeps the backlift up as the front foot reaches.
    const keys=reverse?[[0,start],[impact*.25,{...load,bd:slerp(unit(start.bd),unit(load.bd),.5)}],[impact*.5,between(load,slot,.35)],[impact*.75,slot]]
      :[[0,start],[impact*.32,load],[impact*.69,slot]];
    return [...keys,[impact,contact],
      [impact+(reverse?.07:.10),through],[impact+.34,finish],[impact+.64,settle],
      [impact+.98,rise],[impact+1.45,stance]];
  }
  // Late cut: compact upright blade and a small open-face deflection.
  // Do not turn this into another full cross-bat swing or overhead finish.
  function lcutKeys({start,target,stance,impact=.15}) {
    // Wait over the rear pad and open the face into the ball. The hands
    // travel only a short distance as the blade drops toward the slips.
    const across=clamp(target[0]*.8,-.31,.20);
    const low=clamp((.95-target[1])/.65,0,1);
    const bd=unit([-.61+.24*low,-.65-.26*low,-.34]);
    const h=add(target,scale(bd,-.48));
    const pel=[.55+across,.86-.16*low,.64];
    const contact={...start,fr:[.64+across*.55,0,1.04],bk:[.46+across,0,.35],pel,
      hy:-97,sy:-106,lean:16+12*low,side:4,h,bd,
      kpL:[-.80,0,.60],kpR:[-.98,0,.20],rearFootPitch:0,batRoll:.37};
    const gather={...contact,pel:add(pel,[.037,.028,.04]),hy:-93,sy:-94,lean:13+9*low,
      h:[.30+across,1.23-.13*low,.73],bd:unit([-.43,.75,-.50]),batRoll:.10};
    const drop={...contact,sy:-101,h:add(h,[.035,.13,-.1]),bd:unit([-.70,-.15,-.70]),batRoll:.26};
    const guide={...contact,pel:add(pel,[0,-.012,-.018]),sy:-111,lean:contact.lean+2,
      h:add(h,[-.026,-.04,-.055]),bd:unit([-.53+.17*low,-.76-.13*low,-.38]),batRoll:.46};
    const finish={...guide,pel:add(pel,[-.015,-.017,-.037]),sy:-115,
      h:add(h,[-.056,-.075,-.11]),bd:unit([-.48+.12*low,-.68-.12*low,-.55]),batRoll:.42};
    const settle={...finish,sy:-108,h:add(finish.h,[.03,.045,.024]),batRoll:.24};
    return [[0,{...start,batRoll:0}],[impact*.26,gather],[impact*.73,drop],[impact,contact],
      [impact+.053,guide],[impact+.18,finish],[impact+.71,settle],[impact+1.37,{...stance,batRoll:0}]];
  }
  // A glance uses late contact beside the pad and a short wrist release.
  function glanceKeys({start,target,stance,aim=130,loft=false,impact=.15}) {
    const fine=clamp((aim-115)/55,0,1), low=clamp((.85-target[1])/.55,0,1);
    const line=clamp(target[0],-.32,.32), lift=loft?1:0;
    const fr=[.55+line*.6,0,1.07], kpL=[-.65+fine*.18,0,.75];
    const bd=unit([-.69+low*.32+fine*.05,-.77-low*.24,.11-fine*.18]);
    const h=add(target,scale(bd,-(.47+.13*low)));
    const contact={...start,fr,kpL,pel:[.55+line*.85-.045*low,.86-(loft?.055:.13)*low,.83+.052*low],
      hy:-76+8*lift,sy:-79+7*lift,lean:loft?12:17+10*low,side:6,h,bd,batRoll:.12+fine*.15,rearFootPitch:.12};
    const gather={...between(start,contact,.42),h:add(start.h,[.025,-.06,.015]),
      bd:slerp(unit(start.bd),unit([-.66,.14,-.74]),.45),batRoll:.04};
    const slot={...between(gather,contact,.75),fr,kpL,h:add(h,[-.065,.095,-.075]),
      bd:unit([-.48,-.66,-.57]),batRoll:.08};
    const release={...contact,hy:-50,sy:-40,lean:loft?10:17,
      h:add(h,[.13,.055+lift*.13,.20]),bd:unit([.47,-.28+lift*.34,.83]),batRoll:loft?.16:.35};
    const finish={...release,pel:add(contact.pel,[.025,.025+lift*.045,.025]),
      hy:loft?44:16,sy:loft?78:38,lean:loft?8:13,side:3,
      h:[contact.pel[0]+.33,loft?1.55+.09*(1-low):1.03+.16*(1-low),1.21-fine*.07],
      bd:unit([.79,loft?1.21:-.22,-.31-fine*.34]),batRoll:loft?.22:.5};
    const hold={...finish,h:add(finish.h,[0,loft?0:-.02,-.015])};
    return [[0,{...start,batRoll:0}],[impact*.33,gather],[impact*.74,slot],[impact,contact],
      [impact+.067,release],[impact+.22,finish],[impact+.66,hold],[impact+1.5,{...stance,batRoll:0}]];
  }

  // A flick transfers forward into the pad, then turns the wrists across it.
  function flickKeys({start,target,stance,aim=45,loft=false,impact=.15}) {
    const square=clamp((aim-20)/100,0,1), low=clamp((.8-target[1])/.55,0,1);
    const line=clamp(target[0],-.32,.32), lift=loft?1:0;
    const fr=[.55+line*.75,0,1.16-low*.09], kpL=[-.36+square*.32,0,1];
    const bd=unit([-.42+square*.25-low*.08,-1,.12-square*.18]);
    const h=add(target,scale(bd,-(.445+.105*low)));
    const contact={...start,fr,kpL,pel:[.55+line*.63,.84-.11*low,1.01],
      hy:-70+square*12,sy:-78+square*11,lean:19+low*10,side:5,
      h,bd,batRoll:.04,rearFootPitch:.34};
    const gather={...between(start,contact,.38),h:add(start.h,[-.035,.035,.02]),
      bd:slerp(unit(start.bd),unit([-.62,.51,-.60]),.42),batRoll:0};
    const slot={...between(gather,contact,.64),fr,kpL,
      h:add(h,[-.115,.14,-.10]),bd:unit([-.68,-.33,-.66]),batRoll:0};
    const release={...contact,pel:add(contact.pel,[.025,.012,.045]),
      hy:contact.hy+13,sy:contact.sy+24,lean:contact.lean-4,
      h:add(h,[.12+square*.06,.045+lift*.07,.245-square*.04]),
      bd:unit([.34+square*.14,-.45+lift*.20,.87-square*.18]),
      batRoll:loft?.12:.31,rearFootPitch:.44};
    const wrap={...release,hy:-19,sy:14,lean:13+low*5-lift*5,
      h:[contact.pel[0]+.20,1.18+lift*.22,1.43-square*.075],
      bd:unit([.92,.27+lift*.51,.29-square*.69]),batRoll:loft?.19:.53};
    const finish={...wrap,pel:add(release.pel,[.02,.035+lift*.04,.015]),hy:-2,sy:40,
      h:add(wrap.h,[.13,.10+lift*.055,-.035]),bd:unit([.61,.55+lift*.25,-.56-square*.12]),
      batRoll:loft?.24:.57};
    const hold={...finish,h:add(finish.h,[0,-.025,-.02])};
    return [[0,{...start,batRoll:0}],[impact*.27,gather],[impact*.71,slot],[impact,contact],
      [impact+.062,release],[impact+.145,wrap],[impact+.30,finish],[impact+.73,hold],
      [impact+1.6,{...stance,batRoll:0}]];
  }

  // The back foot takes the load early. The blade punches forward from
  // that base, with a longer upward release when lofted.
  function bdriveKeys({start,target,stance,aim=0,loft=false,impact=.15}) {
    const angle=clamp(aim,-55,30)*Math.PI/180, across=Math.sin(angle);
    const high=clamp((target[1]-.8)/.8,0,1), line=clamp(target[0],-.35,.35), lift=loft?1:0;
    const bk=[.53+line*.83+across*.05,0,.29], fr=[.62+line*.74+across*.07,0,.98];
    const kpL=[-.81+across*.18,0,.59], kpR=[-.97,0,.18];
    const bd=unit([-.40-high*.56+across*.14,-1+high*.81,.18]);
    const h=add(target,scale(bd,-.48));
    const contact={...start,bk,fr,kpL,kpR,
      pel:[bk[0]-.035,.77+high*.14,.63+high*.035],hy:-85+across*8,sy:-76+across*10,
      lean:20-high*12,side:8,h,bd,rearFootPitch:0};
    const gather={...between(start,contact,.44),bk,
      h:add(start.h,[-.12+across*.025,.025,.04]),
      bd:slerp(unit(start.bd),unit([-.67,.46,-.58]),.47),rearFootPitch:0};
    const slot={...between(gather,contact,.72),fr,bk,kpL,kpR,
      h:add(h,[-.10,.09,-.045]),bd:slerp(unit([-.72,-.13,-.68]),bd,.54)};
    const extension=unit([-.53+across*.34,.18+lift*.51,.83]);
    const punch={...contact,pel:add(contact.pel,[across*.025,.025,.045]),
      hy:contact.hy+8,sy:contact.sy+13,
      h:add(h,[across*.075-.016,.022+lift*.045,.09]),bd:slerp(bd,extension,.47)};
    const follow={...punch,hy:contact.hy+16,sy:contact.sy+25,lean:contact.lean-3,
      h:add(h,[across*.16-.035,.075+lift*.175,.165]),bd:extension};
    const finish={...follow,pel:add(punch.pel,[0,.028+lift*.018,.035]),sy:follow.sy+8,
      h:add(follow.h,[across*.055,.045+lift*.075,-.035]),
      bd:unit([-.64+across*.24,.49+lift*.34,.47])};
    const hold={...finish,h:add(finish.h,[0,-.025,-.018])};
    return [[0,start],[impact*.34,gather],[impact*.65,slot],[impact,contact],
      [impact+.065,punch],[impact+.15,follow],[impact+.29,finish],[impact+.72,hold],[impact+1.5,stance]];
  }
  // Three defensive responses with one straight, compact downswing: the front
  // foot meets the ball, the back-foot block rocks onto the crease, and a push
  // carries the hands forward after contact instead of holding the block pose.
  function defenceKeys({start,target,stance,aim=0,impact=.15},back=false,push=false) {
    const shift=clamp(target[0],-.3,.3),low=clamp((.55-target[1])/.35,0,1);
    const high=clamp((target[1]-.8)/.7,0,1),backTall=clamp((target[1]-.8)/.35,0,1),mix=(a,b,t)=>a+(b-a)*t;
    const dx=Math.sin(clamp(aim,-60,55)*Math.PI/180);
    const dy=-clamp((1.52-target[1])/.45,.12,.98);
    const baseReach=back?.45+.20*low:push?.52+.06*low
      :Math.min(.52+.12*low,Math.max(.2,(1.45-target[1])/Math.max(.1,-dy)));
    const reach=push?baseReach:Math.max(baseReach,Math.min(.82,.86-target[1]/Math.max(.1,-dy)));
    const bd=back
      ?unit([-Math.sqrt(Math.max(.01,1-dy*dy-.12*.12)),dy,.12])
      :unit([-.025-dx*.035,-mix(.99,.94,high),-.12]);
    const h=add(target,scale(bd,-reach));

    // Keep the head over a quiet base. A forward block commits the front knee;
    // the back-foot block draws that foot in and sits the hips slightly back.
    const contact={...start,
      fr:back?[clamp(.50+shift*.35,.34,.68),0,.91]:push?[clamp(.48+shift*.45,.30,.72),0,1.34]:[clamp(.50+shift*.4,.30,.70),0,1.23],
      bk:back?[.59+shift*.25,0,.38]:start.bk.slice(),
      pel:back?[mix(.34,.54,backTall)+shift*.6,mix(.85,.90,backTall)-.04*low+.035*high,mix(.85,.55+.18*high,backTall)]:push?[.43+shift*.5,.79-.065*low,1.01]:[.35+shift*.7,.83-.045*low,1.0],
      hy:back?-80:-77,sy:back?-84:-80,lean:back?12+low*4:push?19+low*4:18+low*4,side:2,h,bd,
      kpL:back?[-.72,0,.58]:[-.38,0,.92],kpR:[-1,0,.08],rearFootPitch:back?0:.08,batRoll:0};
    const slot={...contact,hy:contact.hy-2,sy:contact.sy-3,
      h:add(h,[-.012,.055,-.035]),bd:slerp(unit([-.12,-.7,-.7]),bd,.62)};
    const start0={...start,batRoll:0},load=between(start0,slot,.14),mid=between(start0,slot,.53);

    // A block gives a little with the hands and keeps the blade beside the pad.
    const soft={...contact,h:add(h,[0,-.012,-.035]),lean:contact.lean+1,sy:contact.sy+1};
    // The push stays along the ground: the front knee remains planted while
    // the shoulders and hands carry a short, aimed press through the line.
    const finish=push
      ?{...contact,hy:-70,sy:-66,lean:17,side:2,
        pel:add(contact.pel,[dx*.035,0,.025]),h:add(h,[dx*.24,.025,.29]),
        bd:unit([dx*.32-.02,-.82,.57]),rearFootPitch:.16}
      :{...soft,h:add(h,[0,-.012,-.02]),sy:contact.sy+2};
    const settle=push?{...finish,sy:-64,h:add(finish.h,[dx*.025,-.01,.025])}:soft;
    return [[0,start0],[impact*.25,load],[impact*.5,mid],[impact*.75,slot],[impact,contact],
      [impact+.065,soft],[impact+(push?.24:.16),finish],[impact+.62,settle],[impact+1.3,{...stance,batRoll:0}]];
  }
  const fdefKeys=args=>defenceKeys(args),bdefKeys=args=>defenceKeys(args,true),pushKeys=args=>defenceKeys(args,false,true);
  // Gayle six, behind-bowler replay in mc/v4/fBIqzpkaIy8.mp4 (25 fps).
  // 110.00 stride/lift, 110.32 plant, 110.60 drop, ~111.00 strike,
  // 111.28 release, 111.88 high hold. Replay timing compressed to the game clock.
  // Mirrored into the right-handed rig. Knee and elbow poles reconstruct the
  // far joints from the adjacent frames where the pads and gloves separate.
  function slogKeys({start,target,stance,aim=70,impact=.15,ground=false}) {
    const line=clamp(target[0],-.3,.3);
    const height=clamp((target[1]-.45)/.6,0,1);
    const fr=[.59+line*.48,0,1.24];
    const bk=[.68+line*.32,0,.53];
    const plant={...start,fr,bk,pel:[.69+line*.45,.79,.79],hy:-85,sy:-101,
      lean:22,side:4,h:[.36+line*.35,1.21,.70],bd:unit([-.14,.96,-.24]),
      kpL:[-.32,0,1],kpR:[-1,0,-.15],epL:[.3,-1,.55],epR:[.65,-.45,-.6],
      frontFootPitch:0,rearFootPitch:.06,batRoll:0};
    const bd=unit([-.34-.28*height,-.92+.37*height,-.09-.22*height]);
    const h=add(target,scale(bd,-.58));
    const contact={...plant,pel:[.59+line*.61,.78,.87],hy:-57,sy:-65,lean:23,side:5,h,bd,
      kpL:[.08,0,1],kpR:[-.82,0,.57],epL:[.35,-.9,.45],epR:[.55,-.85,-.15],
      rearFootPitch:.43};
    const drop={...plant,pel:[.64+line*.53,.78,.83],hy:-72,sy:-88,lean:23,
      h:add(h,[.015-.22*height,.15-.08*height,-.13+.08*height]),bd:unit([-.38-.21*height,-.10-.27*height,-.92]),rearFootPitch:.22};
    const release={...contact,pel:add(contact.pel,[.025,.025,.035]),hy:-32,sy:-19,lean:16,side:9,
      h:add(h,[.18,.14,.14]),bd:unit([.22,-.33,.92]),epL:[.55,-.85,.2],epR:[.28,-1,-.35],
      rearFootPitch:.57,batRoll:ground?.28:.12};
    const across={...release,pel:[.65+line*.48,.82,.93],hy:-16,sy:14,lean:9,side:13,
      h:[.79+line*.45,ground?1.28:1.45,1.19-.12*clamp((aim-45)/70,0,1)],
      bd:unit([.91,ground?.12:.37,.26]),rearFootPitch:.64,batRoll:ground?.46:.19};
    const hold={...across,pel:[.67+line*.46,.84,.93],hy:-9,sy:38,lean:3,side:12,
      h:[.94+line*.4,ground?1.53:1.79,1.09],bd:unit([.47,ground?.66:.87,-.16]),
      epL:[.48,-.9,.06],epR:[.16,-1,-.45],batRoll:ground?.48:.24};
    const settle={...hold,sy:32,h:add(hold.h,[-.045,-.08,0]),rearFootPitch:.39};
    return [[0,{...start,batRoll:0}],[impact*.32,plant],[impact*.65,drop],[impact,contact],
      [impact+.044,release],[impact+.105,across],[impact+.235,hold],
      [impact+.67,settle],[impact+1.7,{...stance,batRoll:0}]];
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
  // Upper cut loads the back leg; the front leg is free to fold through the shot.
  function sampleUpperCut(curve,t,actual,nominal=.15) {
    const result=sampleCut(curve,t,actual,nominal),authored=sample(curve,result.time);
    result.pose.fr=authored.fr;result.pose.kpL=authored.kpL;
    return result;
  }
  const api={sampleUpperCut,prepare,sample,contactTime,sampleDrive,driveKeys,cutKeys,pullKeys,hookKeys,ucutKeys,sweepKeys,rsweepKeys,lcutKeys,glanceKeys,flickKeys,bdriveKeys,fdefKeys,bdefKeys,pushKeys,slogKeys,sampleCut,cutWidth,pathWidth,sweepWidth,blendDirection:slerp};root.CricketMotion=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
