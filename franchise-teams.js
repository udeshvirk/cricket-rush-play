// Original fictional clubs for Stumpflare. Legacy IDs/league values retain saved-game compatibility.
// Original palettes and fictional squads; no affiliation with real clubs or leagues.
(function(root){
 const clubs=[
 ['csk','Chennai Lanterns','CLN','#cf6849','#263b53'],
 ['dc','Delhi Kites','DKT','#3aa79c','#26324b'],
 ['gt','Gujarat Saltwinds','GSW','#b5c9ce','#473e67'],
 ['kkr','Kolkata Fireflies','KFF','#b6cb55','#263d4b'],
 ['lsg','Lucknow Moonstones','LMS','#a18ccc','#24394e'],
 ['mi','Mumbai Breakwater','MBW','#66b6c8','#33395b'],
 ['pbks','Punjab Copperfields','PCF','#bd8948','#344d47'],
 ['rr','Rajasthan Sandgliders','RSG','#c6ab8c','#514b78'],
 ['rcb','Bengaluru Rainbirds','BRB','#688ed0','#263e48'],
 ['srh','Hyderabad Nightjars','HNJ','#b96f9b','#30364e']];
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
