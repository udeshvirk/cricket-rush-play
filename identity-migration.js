// Player and club names in saved games, and the optional names file (Settings → Player names).
// The game's own names live in index.html (players) and franchise-teams.js (clubs). This file only renames what is already
// saved on the device, so records, stats, series, tournaments and an unfinished match keep up with a name change.
(function(root){
  'use strict';
  // 18-19 November 2026 the national players had made-up names for a day; saves made then go back to the game's spellings.
  const BACK={"A. Mehra":"S. Gilmann","D. Bhasin":"Y. Jaiswar","N. Talwar":"V. Kohlee","K. Vaid":"S. Yadhav","T. Bendre":"R. Pantt","E. Saran":"H. Pandiya","B. Kamat":"R. Jadeyja","I. Sarin":"A. Patell","U. Dugal":"K. Yadev","O. Raval":"J. Bumrar","Z. Nanda":"M. Siraaj","K. Whitcombe":"T. Hedd","T. Bellamy":"M. Marsch","E. Fenwick":"S. Smithe","B. Hensley":"M. Labuchane","I. Alderton":"J. Inglish","U. Mercer":"G. Maxwel","O. Ransome":"C. Greene","Z. Ellery":"P. Cummings","A. Tarrant":"M. Starke","D. Keppel":"A. Zamper","N. Denholm":"J. Hazelwod","B. Fairburn":"P. Salte","I. Hollis":"B. Duckitt","U. Cartwright":"J. Roote","O. Penrose":"H. Brooke","Z. Bramwell":"J. Butlar","A. Redfern":"B. Stoaks","D. Ashby":"W. Jacques","N. Langford":"B. Carsey","K. Wetherby":"A. Rashed","T. Huxley":"J. Archar","E. Selwyn":"M. Wode","O. Qadri":"S. Ayube","Z. Nizami":"F. Zammaan","A. Raufani":"B. Azaam","D. Kazmi":"M. Rizwaan","N. Faruqi":"S. Aghaa","K. Hamdani":"F. Ashraff","T. Darani":"S. Khaan","E. Safiuddin":"S. Afridee","B. Tanviri":"N. Shahh","I. Mahdavi":"H. Rauff","U. Qureshi":"A. Ahmedd","D. Mokoena":"Q. de Cok","N. Duvenage":"A. Markrum","K. Venter":"R. Rickleton","T. Ndlovu":"T. Stubbes","E. Engelbrecht":"H. Klaasan","B. Bothma":"D. Millar","I. Mahlangu":"M. Jansan","U. Radebe":"K. Maharajh","O. Viljoen":"K. Rabadaa","Z. Maseko":"L. Ngidee","A. Dlamini":"T. Shamsee","T. Kershaw":"D. Conwey","E. Harcourt":"R. Ravindr","B. Taiton":"K. Williamsen","I. Fairlie":"D. Mitchel","U. Lennox":"T. Lathem","O. Hadley":"G. Philipps","Z. Calder":"M. Santnar","A. Riddell":"K. Jamiesen","D. Armitage":"M. Henri","N. Seddon":"L. Fergusen","K. Whitmore":"W. Rourke","I. Jayakody":"P. Nisanka","U. Ranatunga":"K. Mendiss","O. Hewage":"K. Pereira","Z. Kuruppu":"C. Asalanke","A. Galappatti":"S. Samarawick","D. Senanayake":"D. de Silvaa","N. Wijesiri":"W. Hasarenga","K. Abeykoon":"D. Wellalagey","T. Bandara":"M. Theekshane","E. Kalubowila":"M. Pathirena","B. Dissanayake":"D. Madushanke","Z. Brathwaite":"B. Kingg","A. Hinds":"S. Hoape","D. Walcott":"N. Pooraan","N. Beckford":"S. Hetmyre","K. Sealy":"R. Powel","T. Gittens":"S. Rutherfrd","E. Drayton":"R. Chace","B. Cumberbatch":"J. Holdar","I. Parris":"A. Hossein","U. Roachford":"A. Josef","O. Browne":"G. Motee","N. Karim":"T. Hassan","K. Mazumder":"L. Daas","T. Sikder":"N. Shantoo","E. Talukder":"T. Hridoye","B. Munshi":"M. Raheem","I. Barua":"M. Mirazz","U. Sarker":"R. Hossein","O. Haldar":"T. Islaam","Z. Mollah":"T. Ahmmed","A. Chowdhury":"M. Rahmann","D. Kabir":"N. Raana","E. Waziri":"R. Gurbaaz","B. Rahimi":"I. Zadraan","I. Zaryab":"S. Attal","U. Mehran":"H. Shahidee","O. Kohistani":"A. Omarzay","Z. Safdar":"M. Nabbi","A. Baraki":"G. Naeb","D. Sarwari":"R. Khaan","N. Zamani":"N. Ahmadd","K. Noorzai":"F. Farooqee","T. Payenda":"N. Ulhaq"};
  // The clubs used to carry the real franchise names; they now have their own (IDs and league values are unchanged).
  const CLUBS={"Chennai Super Kings":"Chennai Lanterns","Delhi Capitals":"Delhi Kites","Gujarat Titans":"Gujarat Saltwinds","Kolkata Knight Riders":"Kolkata Fireflies","Lucknow Super Giants":"Lucknow Moonstones","Mumbai Indians":"Mumbai Breakwater","Punjab Kings":"Punjab Copperfields","Rajasthan Royals":"Rajasthan Sandgliders","Royal Challengers Bengaluru":"Bengaluru Rainbirds","Sunrisers Hyderabad":"Hyderabad Nightjars"}, CLUB_SHORTS={"CSK":"CLN","DC":"DKT","GT":"GSW","KKR":"KFF","LSG":"LMS","MI":"MBW","PBKS":"PCF","RR":"RSG","RCB":"BRB","SRH":"HNJ"};
  const SAVES=['cricket-rush-match','cricket-rush-stats','cricket-rush-tournament','cricket-rush-series'];
  const ROSTER_KEY='cricket-rush-roster';

  const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  // One pass over the text, longest names first and whole names only, so "S. Smith" never turns "S. Smithe" into "S. Smithee"
  // and a name just put in is never renamed again.
  function renamer(map){
    const keys=Object.keys(map).filter(k=>k&&map[k]!==k).sort((a,b)=>b.length-a.length);
    if(!keys.length)return s=>s;
    const re=new RegExp('(?<![A-Za-z])(?:'+keys.map(esc).join('|')+')(?![A-Za-z])','g');
    return s=>s.replace(re,m=>map[m]);
  }
  // map: names anywhere in text and object keys; codes: short team codes, only as a whole value.
  function migrateWith(map,codes={}){
    const rename=renamer(map);
    const go=v=>{
      if(typeof v==='string')return Object.prototype.hasOwnProperty.call(codes,v)?codes[v]:rename(v);
      if(Array.isArray(v))return v.map(go);
      if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[rename(k),go(x)]));
      return v;
    };
    return go;
  }

  function validRoster(r){
    if(!r||typeof r!=='object'||r.format!=='stumpflare-names'||!r.players||typeof r.players!=='object')return false;
    const ok=s=>typeof s==='string'&&s.trim().length>0&&s.length<=40;
    if(!Object.entries(r.players).every(([k,v])=>ok(k)&&ok(v)))return false;
    if(r.teams!==undefined&&(typeof r.teams!=='object'||!Object.values(r.teams).every(t=>t&&typeof t==='object'&&(t.name===undefined||ok(t.name))&&(t.short===undefined||ok(t.short)))))return false;
    // two players with one name would share their records
    const shown=Object.values(r.players);return new Set(shown).size===shown.length;
  }
  function readRoster(storage){try{const r=JSON.parse(storage.getItem(ROSTER_KEY));return validRoster(r)?r:null;}catch(e){return null;}}

  // The old-name fix-ups, minus any name the loaded names file uses (it may bring back a real club name on purpose).
  function legacy(roster){
    const used=new Set(roster?[...Object.values(roster.players),...Object.values(roster.teams||{}).flatMap(t=>[t.name,t.short])]:[]);
    const keep=o=>Object.fromEntries(Object.entries(o).filter(([k])=>!used.has(k)));
    // a made-up name goes straight to the name shown now: the names file's, else the game's own
    const back=Object.fromEntries(Object.entries(BACK).map(([k,v])=>[k,(roster&&roster.players[v])||v]));
    return migrateWith(keep({...back,...CLUBS}),keep(CLUB_SHORTS));
  }
  function migrate(value){return legacy(null)(value);}

  function migrateStorage(storage,fn){
    let f=fn;
    if(!f){let roster=null;try{roster=readRoster(storage);}catch(e){}f=legacy(roster);}
    for(const key of SAVES){
      try{const raw=storage.getItem(key);if(!raw)continue;const next=JSON.stringify(f(JSON.parse(raw)));if(next!==raw)storage.setItem(key,next);}catch(e){} // Keep unreadable saves; never delete progress.
    }
  }

  const api={migrate,migrateWith,migrateStorage,validRoster,readRoster,ROSTER_KEY};
  root.StumpflareNames=api;
  if(typeof module!=='undefined')module.exports=api;
  if(root.document){try{migrateStorage(root.localStorage);}catch(e){}}
})(typeof window==='undefined'?globalThis:window);
