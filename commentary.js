// Spoken commentary: short original calls built from what happened on the ball (who, which shot, where, the match
// situation). Lines rotate so the same words don't come back soon. The voice is the device's own speech (an optional
// preview, off until the player turns it on); the event/queue layer could take recorded clips instead.
(function(root){
  'use strict';
  function create(options={}) {
    const synth=options.synth||root.speechSynthesis;
    const Utterance=options.Utterance||root.SpeechSynthesisUtterance;
    const now=options.now||(()=>Date.now()),onSpeaking=options.onSpeaking||(()=>{});
    const rnd=options.random||Math.random;
    let enabled=false,muted=false,suspended=false,unlocked=false,current=null,pending=null,serial=0,lastLow=-Infinity;
    const seen=new Set(),history=[],recent=[];
    // what has happened lately (for streaks: boundaries in a row, wickets in a row for a bowler, a collapse)
    let track=freshTrack();
    function freshTrack(){return {boundaries:0,lastBoundaryBatter:'',bowlerSeq:{},wicketBalls:[],ball:0,dots:0};}
    const supported=!!(synth&&Utterance);

    // pick one of several lines, avoiding the last 30 lines spoken
    // (lines count as the same when they start alike once names and numbers are taken out)
    const shape=t=>t.replace(/\b[A-Z][a-z]+\b/g,'X').replace(/\d+/g,'N').slice(0,18);
    function pick(list){
      const all=list.filter(Boolean),fresh=all.filter(t=>!recent.includes(shape(t)));
      const pool=fresh.length?fresh:all;
      const t=pool[Math.floor(rnd()*pool.length)];
      recent.push(shape(t));if(recent.length>30)recent.shift();
      return t;
    }
    const chance=p=>rnd()<p;

    function cancel(){serial++;current=null;pending=null;if(supported)synth.cancel();onSpeaking(false);}
    function speak(call){
      if(!enabled||muted||suspended||!unlocked||!supported||now()>call.expires)return;
      const id=++serial,utterance=new Utterance(call.text);
      let voices=[];try{voices=synth.getVoices()||[];}catch(e){}
      // prefer a natural-sounding English voice: Indian or British English, then any local English voice
      const voice=voices.find(v=>/^en-(IN|GB)$/i.test(v.lang)&&v.localService)||voices.find(v=>/^en-(IN|GB|AU)$/i.test(v.lang))||voices.find(v=>/^en/i.test(v.lang));
      if(voice)utterance.voice=voice;
      utterance.lang=voice?.lang||'en-GB';utterance.rate=call.priority>=85?1.04:.98;utterance.pitch=call.priority>=85?1.08:1;utterance.volume=.82;
      current={...call,id};history.push({event:call.event,text:call.text});if(history.length>30)history.shift();onSpeaking(true);
      const done=()=>{if(current?.id!==id)return;current=null;onSpeaking(false);const next=pending;pending=null;if(next)speak(next);};
      utterance.onend=done;utterance.onerror=done;
      try{synth.speak(utterance);}catch(e){done();}
    }

    // ------------------------------------------------------------------ phrases
    const STRAIGHT="the bowler's head";
    const through=r=>!r?'':r===STRAIGHT?'straight down the ground':'through '+r;
    const over=r=>!r?'':r===STRAIGHT?"straight over the bowler's head":'over '+r;
    const to=r=>!r?'':r===STRAIGHT?'back past the bowler':'to '+r;
    const lc=s=>s?s.charAt(0).toLowerCase()+s.slice(1):'';
    const cap=s=>s?s.charAt(0).toUpperCase()+s.slice(1):'';
    const a=s=>/^[aeiou]/i.test(s)?'an '+s:'a '+s;
    const plural=(n,w)=>n+' '+w+(n===1?'':'s');

    function wicketLine(d){
      const b=d.batter||'The batter',w=d.bowler||'the bowler',f=d.fielder,how=d.out.how;
      let t;
      if(how==='bowled'){
        if(d.playedOn)t=pick([`Played on! ${b} drags it back onto the stumps.`,`Off the inside edge and onto the stumps! ${b} is bowled.`,`Chopped on! That's a horrible way to go for ${b}.`]);
        else if(d.length==='Yorker')t=pick([`Yorker! Right in the blockhole, and ${b} is bowled.`,`What a yorker from ${w}! The stumps are flattened.`,`Too good! ${w} spears in the yorker and ${b} is gone.`]);
        else t=pick([`Bowled him! ${w} knocks back the stumps.`,`Timber! ${b} has to go.`,`Through the gate! ${b} is bowled.`,`${b} missed it, ${w} didn't. Bowled.`,`The stumps are rattled! ${w} gets ${b}.`,d.spin?`That's turned past the bat and hit the stumps! Bowled.`:`Too quick for ${b}! Bowled.`]);
      } else if(how==='caught'){
        if(d.keeper)t=pick([`Edged, and taken behind! ${b} is out.`,`A thin edge, and the keeper does the rest.`,`Nicked it! ${w} has ${b} caught behind.`,`Feather of an edge, safely held by the keeper. Gone.`]);
        else if(d.cAndB)t=pick([`Caught and bowled! ${w} takes it off the bowling.`,`Straight back to ${w}, who holds on. Out!`,`${w} sticks out a hand and takes the return catch!`]);
        else if(d.loft)t=pick([`Up in the air... and taken at ${f}! ${b} has to go.`,`${b} went for the big one, but ${f} takes it.`,`Holed out at ${f}! ${w} gets the wicket.`,`Not enough on it! Caught at ${f}.`,`Skied it, and ${f} is under it. Out!`]);
        else t=pick([`${b} hits it straight to ${f}. Caught!`,`Caught at ${f}! ${b} picked out the fielder.`,`Taken at ${f}. That's the end of ${b}.`,`Straight into the hands of ${f}. Out!`]);
      } else if(how==='stumped'){
        t=pick([`Down the pitch, missed it, and stumped! ${b} is out.`,`Lightning work from the keeper. Stumped!`,`${b} came down the track and was done in the flight. Stumped.`]);
      } else t=`That's out! ${b} has to go.`;
      // how the batter's innings ended
      if(d.batRuns===0&&d.batBalls<=1)t+=' '+pick(['First ball, gone for a golden duck.','Out first ball!']);
      else if(d.batRuns===0)t+=' '+pick(['Out for a duck.','Gone without scoring.']);
      else if(d.batRuns>=25)t+=' '+pick([`${b} goes for ${d.batRuns}.`,`A fine knock of ${d.batRuns} comes to an end.`,`${d.batRuns} off ${d.batBalls} for ${b}.`]);
      return t;
    }

    function boundaryLine(d){
      const b=d.batter||'The batter',w=d.bowler||'the bowler',r=d.region,s=d.shot?lc(d.shot):'',edge=d.contact==='edge';
      if(d.runs===6){
        if(edge)return pick([`Off the edge, and it carries all the way! Six for ${b}.`,`That's flown off the edge for six! Lucky ${b}.`]);
        return pick([
          r?`${b} launches that ${over(r)}. Six!`:'',
          `Huge hit from ${b}! Six, into the crowd.`,
          s?`${cap(a(s))} from ${b}, and that's out of here. Six!`:'',
          r?`Up, up, and ${over(r)}. Six runs!`:'',
          d.carry>=85?`That's gone ${d.carry} metres! A massive six.`:'',
          `Off the middle and into the stands. Six for ${b}.`,
          `That's a monster! Six more for ${b}.`,
          `Clean as you like. Six!`,
          `${b} stands tall and clears the rope. Six.`,
          r?`Six! That's landed deep in the crowd ${r===STRAIGHT?'straight down the ground':'at '+r}.`:'',
          `Get that ball back! ${b} has hit it for six.`,
          `${w} goes for six. ${b} picked the length early.`,
          d.length==='Short'&&r?`Short from ${w}, and ${b} sends it ${over(r)} for six.`:'',
          d.length==='Full toss'?`Full toss, and ${b} has dispatched it for six.`:'',
        ]);
      }
      if(edge)return pick([`Off the edge and away for four! Lucky ${b}.`,`Edged, and it races past the slips for four.`,`Thick edge, and it runs away for four.`]);
      return pick([
        s&&r?`${cap(s)}, and that races away ${to(r)}. Four.`:'',
        `Beautifully timed by ${b}. Four runs.`,
        r?`Pierces the gap ${through(r)}. Four!`:'',
        `No need to run for that one. Four to ${b}.`,
        `Cracking shot! Four more for ${b}.`,
        `The fielder had no chance. Four.`,
        `Too good to stop. Four runs.`,
        r?`Four! Placed perfectly ${through(r)}.`:'',
        `${b} picks the gap and gets four.`,
        r?`${b} finds the boundary ${through(r)}.`:'',
        d.length==='Short'?`Short from ${w}, and punished. Four.`:'',
        d.length==='Full'||d.length==='Full toss'?`Too full from ${w}, and ${b} drives it for four.`:'',
        s?`Lovely ${s} from ${b}. That's four.`:'',
        r?`Just a touch, and it's away ${to(r)} for four.`:'',
      ]);
    }

    function quietLine(d){
      const b=d.batter||'The batter',w=d.bowler||'the bowler',r=d.region,f=d.fielder;
      if(d.dropped&&!f)return {priority:80,text:pick([`Dropped! ${b} survives.`,`A let-off for ${b}! That was a chance.`,`Oh, that's gone down! ${w} can't believe it.`])};
      if(d.dropped)return {priority:80,text:pick([`Dropped! ${cap(f)} puts it down. ${b} survives.`,`Oh, that's a chance gone at ${f}!`,`A let-off for ${b}! ${cap(f)} couldn't hold it.`,`Put down at ${f}! ${w} can't believe it.`])};
      if(d.missedStumping)return {priority:70,text:pick([`The keeper missed the stumping! ${b} gets away with it.`,`${b} was miles out, but the keeper fumbled it!`])};
      if(d.notOut){
        const how=d.notOut==='caught'?'Caught':d.notOut==='stumped'?'Stumped':'Bowled him';
        return {priority:80,text:d.noBall?pick([`${how}! But it's a no-ball. ${b} survives.`,`${how}, but ${w} has overstepped! Not out.`,`${how}! No, the umpire has called a no-ball.`])
          :pick([`${how}, but it's a free hit. Not out.`,`${how}! It doesn't count, that was the free hit.`,`${how} off the free hit. ${b} stays.`])};
      }
      if(d.noBall){
        const fh=d.freeHitNext?' '+pick([`Free hit coming up.`,`The next ball is a free hit.`,`${b} gets a free hit.`]):'';
        return {priority:45,text:pick([`No-ball from ${w}.`,`${w} has overstepped. No-ball.`,`No-ball called.`])+(d.runs?` And ${plural(d.runs,'run')} off the bat as well.`:'')+fh};
      }
      if(d.wide)return {priority:35,text:pick([`Wide. One added to the score.`,`Too wide from ${w}. That's a wide.`,`Wide called. An extra run.`,`${w} strays too wide.`])};
      if(d.runs===0){
        if(d.ducked)return {priority:30,text:pick([`Bouncer, and ${b} ducks under it.`,`Short one, and ${b} sways out of the way.`,`${b} gets well underneath that bouncer.`])};
        if(d.left)return {priority:20,text:pick([`Left alone.`,`${b} leaves it outside off.`,`No shot offered.`,`Well left by ${b}.`])};
        if(d.contact==='miss')return {priority:30,text:pick([`Beaten! Lovely ball from ${w}.`,`Past the outside edge!`,`${b} played and missed.`,`Beauty from ${w}. Just past the bat.`,`Swing and a miss from ${b}.`])};
        if(d.contact==='edge')return {priority:30,text:pick([`Off the edge, but safe. No run.`,`Inside edge, and no damage done.`])};
        if(d.defend)return {priority:20,text:pick([`Solid defence from ${b}.`,`Blocked.`,`${b} gets right behind that one.`,`Defended back to ${w}.`])};
        return {priority:20,text:pick([f?`Straight to ${f}. No run.`:'',f?`Good stop at ${f}. No run.`:'',`Good fielding. No run.`,`${w} keeps it tight. Dot ball.`,`No run there.`,`Well bowled. No run.`,`Nothing doing. Dot ball.`,`${b} can't get that one away.`])};
      }
      if(d.runs===1)return {priority:20,text:pick([r?`Pushed ${to(r)} for a single.`:'',`Quick single taken.`,`${b} rotates the strike.`,r?`Worked ${to(r)}. One run.`:'',`Just the one.`,`Nudged away for a single.`])};
      if(d.runs===2)return {priority:25,text:pick([r?`Into the gap ${to(r)}, and they come back for two.`:'',`Good running. Two.`,`They hurry back for the second.`,`Two more to ${b}.`])};
      return {priority:30,text:pick([`They run hard. Three!`,`Three runs. Excellent running between the wickets.`,r?`Chased down just short of the rope ${to(r)}. Three.`:''])};
    }

    // a short word on the state of the match, said after some balls
    function situation(d,important){
      if(d.chase===undefined)return '';
      const need=d.need,left=d.ballsLeft;
      if(d.target&&need>0&&left>0){
        if(left===1)return pick([`${plural(need,'run')} needed off the last ball!`,`It all comes down to the last ball. ${plural(need,'run')} needed.`]);
        if(need<=left&&left<=12)return pick([`${plural(need,'run')} needed from ${plural(left,'ball')}.`,`${need} to win, ${left} balls left.`]);
        if(left<=18)return pick([`${need} needed off ${left}.`,`They need ${need} from ${left} balls.`]);
        if(important&&chance(.5))return `${need} still needed from ${left}.`;
      }
      return '';
    }

    function overLine(d){
      const lo=d.lastOver||{},w=d.bowler||'the bowler';
      let t=pick([`End of the over. ${d.totalRuns} for ${d.wickets}.`,`That's the over. The score, ${d.totalRuns} for ${d.wickets}.`,`${d.team?d.team+' are ':''}${d.totalRuns} for ${d.wickets} at the end of the over.`]);
      if(lo.runs===0)t=pick([`A maiden over from ${w}!`,`Six balls, no runs. A maiden for ${w}.`])+' '+t;
      else if(lo.wkts>=2)t=pick([`What an over from ${w}! ${lo.wkts} wickets in it.`,`${w} has turned the game with ${lo.wkts} wickets in the over.`])+' '+t;
      else if(lo.runs>=18)t=pick([`Expensive over. ${lo.runs} off it.`,`${lo.runs} runs from that over! ${w} will want to forget it.`])+' '+t;
      else if(lo.runs<=3&&!lo.wkts)t=pick([`A tight over from ${w}.`,`Only ${plural(lo.runs,'run')} off that over.`])+' '+t;
      return t;
    }

    function resultCall(d){
      track.ball++;
      const bw=d.bowler||'?';
      const seq=track.bowlerSeq[bw]||(track.bowlerSeq[bw]=[]);
      if(!d.wide&&!d.noBall)seq.push(d.out?'W':'.');if(seq.length>3)seq.shift();
      if(d.out)track.wicketBalls.push(track.ball);
      track.wicketBalls=track.wicketBalls.filter(n=>track.ball-n<12);
      const boundary=!d.out&&(d.runs===4||d.runs===6);
      if(boundary&&track.lastBoundaryBatter===d.batter)track.boundaries++;else track.boundaries=boundary?1:0;
      track.lastBoundaryBatter=boundary?d.batter:'';
      if(d.out){
        let t=wicketLine(d);
        if(seq.length>=3&&seq.every(x=>x==='W'))t=pick([`A hat-trick for ${bw}! Unbelievable!`,`Three in three! ${bw} has a hat-trick!`])+' '+t;
        else if(seq.slice(-2).join('')==='WW')t+=' '+pick([`Two in two! ${bw} is on a hat-trick.`,`${bw} is on a hat-trick!`]);
        else if(track.wicketBalls.length>=3)t+=' '+pick(['Wickets are tumbling here!','This is a collapse!']);
        return {priority:100,text:t};
      }
      if(d.milestone){
        const b=d.batter||'the batter';
        return {priority:95,text:d.milestone>=100?pick([`A hundred for ${b}! What an innings.`,`Raise the bat, ${b}! A century off ${d.batBalls} balls.`]):pick([`Fifty for ${b}! Well played.`,`That brings up fifty for ${b}, off ${d.batBalls} balls.`,`A half-century for ${b}.`])};
      }
      if(boundary){
        let t=boundaryLine(d);
        if(d.noBall)t+=' '+pick([`And it's a no-ball too.`,`A no-ball as well!`])+(d.freeHitNext?' Free hit next.':'');
        if(track.boundaries===3)t+=' '+pick([`That's three in a row!`,`Three boundaries on the trot for ${d.batter}!`]);
        else if(track.boundaries>=4)t+=' '+pick([`Another one! ${d.batter} is on fire.`,`${d.batter} is taking ${d.bowler||'the bowler'} apart!`]);
        const s=situation(d,true);
        return {priority:d.runs===6?90:85,text:s?t+' '+s:t};
      }
      if(d.overDone){
        const s=situation(d,false);
        return {priority:55,text:overLine(d)+(s?' '+s:'')};
      }
      const q=quietLine(d);
      if(q.priority<50){
        // quiet balls: say most of them, but a dot now and then is left to the crowd
        if(d.runs===0&&!d.wide&&!d.noBall&&!d.notOut&&!d.ducked&&q.priority<30&&(track.dots=(track.dots+1)%3)===2)return null;
        const s=situation(d,false);
        if(s){q.text+=' '+s;q.priority=50;}
      }
      return q;
    }

    function emit(event,data={}) {
      if(!enabled||muted||suspended||!unlocked||!supported||data.skip)return false;
      if(data.id&&seen.has(data.id))return false;
      let call=null;
      if(event==='result')call=resultCall(data);
      else if(event==='innings'){
        const team=data.team?data.team+' ':'';
        call={priority:60,text:data.target?pick([`The chase is on. ${team}need ${data.target} to win.`,`${data.target} to win. Here we go.`,`${team}need ${data.target}${data.overs?' from '+plural(data.overs,'over'):''}. Can they do it?`]):pick(['A new innings. The openers are ready.',`${team}are ready to bat. Here we go.`,'Welcome to the match. The openers walk out under the lights.'])};
      }
      else if(event==='match')call={priority:120,text:data.text};
      else return false;
      if(!call||!call.text)return false;
      const {text,priority}=call;
      if(priority<50&&now()-lastLow<6500)return false;
      if(data.id){seen.add(data.id);if(seen.size>200)seen.delete(seen.values().next().value);}
      if(priority<50)lastLow=now();
      const c={event,text,priority,expires:now()+4500};
      if(current){
        if(priority>=85&&priority>current.priority){cancel();speak(c);}
        else if(priority>=55&&(!pending||priority>pending.priority))pending=c;
        else return false;
      } else speak(c);
      return true;
    }
    return {
      supported,emit,history,unlock(){unlocked=true;},
      setEnabled(value){enabled=!!value;if(!enabled)cancel();return enabled;},
      setMuted(value){muted=!!value;if(muted)cancel();},
      setSuspended(value){const changed=suspended!==!!value;suspended=!!value;if(changed&&suspended)cancel();},
      reset(){cancel();seen.clear();lastLow=-Infinity;track=freshTrack();recent.length=0;},
      get enabled(){return enabled;},get speaking(){return !!current;}
    };
  }
  root.CricketCommentary={create};
  if(typeof module!=='undefined')module.exports={create};
})(typeof window==='undefined'?globalThis:window);
