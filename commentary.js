// Short original calls. The event/queue layer can take a recorded-clip backend;
// the included device-voice backend is an explicitly optional preview.
(function(root){
  'use strict';
  function create(options={}) {
    const synth=options.synth||root.speechSynthesis;
    const Utterance=options.Utterance||root.SpeechSynthesisUtterance;
    const now=options.now||(()=>Date.now()),onSpeaking=options.onSpeaking||(()=>{});
    let enabled=false,muted=false,suspended=false,unlocked=false,current=null,pending=null,serial=0,lastLow=-Infinity;
    const counts={},seen=new Set(),history=[];
    const supported=!!(synth&&Utterance);
    const pick=(key,list)=>list[((counts[key]=(counts[key]||0)+1)-1)%list.length];
    function cancel(){serial++;current=null;pending=null;if(supported)synth.cancel();onSpeaking(false);}
    function speak(call){
      if(!enabled||muted||suspended||!unlocked||!supported||now()>call.expires)return;
      const id=++serial,utterance=new Utterance(call.text);
      let voices=[];try{voices=synth.getVoices()||[];}catch(e){}
      const voice=voices.find(v=>/^en-(IN|GB)$/i.test(v.lang)&&v.localService)||voices.find(v=>/^en/i.test(v.lang));
      if(voice)utterance.voice=voice;
      utterance.lang=voice?.lang||'en-GB';utterance.rate=.98;utterance.pitch=1;utterance.volume=.82;
      current={...call,id};history.push({event:call.event,text:call.text});if(history.length>30)history.shift();onSpeaking(true);
      const done=()=>{if(current?.id!==id)return;current=null;onSpeaking(false);const next=pending;pending=null;if(next)speak(next);};
      utterance.onend=done;utterance.onerror=done;
      try{synth.speak(utterance);}catch(e){done();}
    }
    function emit(event,data={}) {
      if(!enabled||muted||suspended||!unlocked||!supported||data.skip)return false;
      if(data.id&&seen.has(data.id))return false;
      let text,priority=20;
      if(event==='result') {
        if(data.out){
          priority=100;
          text=data.out.how==='bowled'?pick('bowled',["The stumps are down!","Bowled him!"]):data.out.how==='caught'?pick('caught',["Taken! That's a wicket.","He's held on to that one. Out!"]):"That's a wicket!";
        } else if(data.milestone){priority=95;text=data.milestone>=100?"A hundred! A superb innings.":"Fifty for the batter. Well played.";}
        else if(data.runs===6){priority=90;text=pick('six',["That's gone all the way. Six runs!","Clears the rope! That's six."]);}
        else if(data.runs===4){priority=85;text=pick('four',["Timed well. That's four.","Through the gap and away for four."]);}
        else if(data.wide){priority=35;text='Wide ball. One added to the score.';}
        else if(data.overDone){priority=55;text='End of the over. '+data.totalRuns+' for '+data.wickets+'.';}
        else if(data.runs===0){if((counts.dot=(counts.dot||0)+1)%3!==1)return false;text=pick('dot',["No run there.","A dot ball. Good pressure from the bowler."]);}
        else text=data.runs===1?'They take a single.':data.runs===2?'Good running. They come back for two.':'Three runs. Well run.';
      } else if(event==='innings'){priority=60;text=data.target?'The chase is on. '+data.target+' needed to win.':'A new innings. The opening pair are ready.';}
      else if(event==='match'){priority=120;text=data.text;}
      else return false;
      if(!text||priority<50&&now()-lastLow<6500)return false;
      if(data.id){seen.add(data.id);if(seen.size>200)seen.delete(seen.values().next().value);}
      if(priority<50)lastLow=now();
      const call={event,text,priority,expires:now()+4500};
      if(current){
        if(priority>=85&&priority>current.priority){cancel();speak(call);}
        else if(priority>=55&&(!pending||priority>pending.priority))pending=call;
        else return false;
      } else speak(call);
      return true;
    }
    return {
      supported,emit,history,unlock(){unlocked=true;},
      setEnabled(value){enabled=!!value;if(!enabled)cancel();return enabled;},
      setMuted(value){muted=!!value;if(muted)cancel();},
      setSuspended(value){const changed=suspended!==!!value;suspended=!!value;if(changed&&suspended)cancel();},
      reset(){cancel();seen.clear();lastLow=-Infinity;},
      get enabled(){return enabled;},get speaking(){return !!current;}
    };
  }
  root.CricketCommentary={create};
  if(typeof module!=='undefined')module.exports={create};
})(typeof window==='undefined'?globalThis:window);
