// Franchise names verified against https://www.iplt20.com/teams (2026-11-14).
// Original kit palettes and fictional squads; no official logos or player likenesses.
(function(root){
 const clubs=[
 ['csk','Chennai Super Kings','CSK','#ebcb3a','#215177'],
 ['dc','Delhi Capitals','DC','#3d77d6','#a92c49'],
 ['gt','Gujarat Titans','GT','#294c70','#d0ac68'],
 ['kkr','Kolkata Knight Riders','KKR','#7754a5','#d7b566'],
 ['lsg','Lucknow Super Giants','LSG','#55a0c1','#d75a32'],
 ['mi','Mumbai Indians','MI','#3975bd','#d2a54b'],
 ['pbks','Punjab Kings','PBKS','#d44e5e','#b8b4ac'],
 ['rr','Rajasthan Royals','RR','#e36aa6','#443e9b'],
 ['rcb','Royal Challengers Bengaluru','RCB','#c64351','#252f48'],
 ['srh','Sunrisers Hyderabad','SRH','#e9843d','#383c4d']];
 const names=['Varan','Darev','Keshan','Mirov','Talven','Nayak','Ravell','Joren','Sahvin','Deyran','Kovell'];
 const initials=['A','B','C','D','E','F','G','H','J','K'];
 const roles=[['',0],['',0],['',0],['O',54],['',0],['F',72],['L',76],['O',79],['F',82],['F',85],['L',80]];
 const teams=clubs.map(([id,name,short,col,dark],k)=>({id:'ipl-'+id,name,short,col,dark,wk:4,league:'ipl',
  players:roles.map(([type,bowl],i)=>[initials[k]+'. '+names[(i+k)%names.length],Math.max(12,[83,80,86,78,77,70,62,35,24,18,14][i]+(k%3-1)*2),type,bowl])}));
 root.CricketFranchises=teams;if(typeof module!=='undefined')module.exports=teams;
})(typeof globalThis!=='undefined'?globalThis:this);
