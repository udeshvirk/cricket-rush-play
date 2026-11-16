// Franchise names verified against https://www.iplt20.com/teams (2026-11-14).
// Original kit palettes and fictional squads; no official logos or player likenesses.
(function(root){
 const clubs=[
 ['csk','Chennai Super Kings','CSK','#ebcb3a','#215177'],
 ['dc','Delhi Capitals','DC','#d0313f','#1d3f8f'],
 ['gt','Gujarat Titans','GT','#0f5f6e','#d0ac68'],
 ['kkr','Kolkata Knight Riders','KKR','#5a2d91','#d7b566'],
 ['lsg','Lucknow Super Giants','LSG','#55a0c1','#d75a32'],
 ['mi','Mumbai Indians','MI','#3975bd','#d2a54b'],
 ['pbks','Punjab Kings','PBKS','#c9ccd3','#c8202f'],
 ['rr','Rajasthan Royals','RR','#e36aa6','#443e9b'],
 ['rcb','Royal Challengers Bengaluru','RCB','#24242c','#d1323e'],
 ['srh','Sunrisers Hyderabad','SRH','#e9843d','#383c4d']];
 const names=['Varan','Darev','Keshan','Mirov','Talven','Nayak','Ravell','Joren','Sahvin','Deyran','Kovell'];
 const initials=['A','B','C','D','E','F','G','H','J','K'];
 const roles=[['',0],['',0],['',0],['O',54],['',0],['F',72],['L',76],['O',79],['F',82],['F',85],['L',80]];
 // each side's own strength (batting, bowling), so the season has favourites and outsiders; plus a little variety per player
 const edge={csk:[0,3],dc:[-1,-1],gt:[-1,4],kkr:[1,2],lsg:[-2,0],mi:[3,2],pbks:[-3,-2],rr:[1,-1],rcb:[4,-3],srh:[5,-2]};
 const teams=clubs.map(([id,name,short,col,dark],k)=>({id:'ipl-'+id,name,short,col,dark,wk:4,league:'ipl',
  players:roles.map(([type,bowl],i)=>{const jit=(i*7+k*3)%5-2,[eb,ew]=edge[id];
   return [initials[k]+'. '+names[(i+k)%names.length],Math.max(12,Math.min(95,[83,80,86,78,77,70,62,35,24,18,14][i]+eb+jit)),type,bowl?Math.min(95,bowl+ew+jit):bowl];})}));
 root.CricketFranchises=teams;if(typeof module!=='undefined')module.exports=teams;
})(typeof globalThis!=='undefined'?globalThis:this);
