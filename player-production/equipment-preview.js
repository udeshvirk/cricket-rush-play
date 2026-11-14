// Original procedural batting-pad preview. Local geometry only; no acquired assets.
(function () {
  'use strict';
  let cached = null;

  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const catmull = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2*a - 5*b + 4*c - d) * t*t + (-a + 3*b - 3*c + d) * t*t*t);
  const signPow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

  function geometry(T, positions, indices) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  function build(T) {
    const profile = [
      [.105,.001,.001,.006],[.098,.018,.014,.006],[.080,.044,.025,.006],
      [.052,.065,.034,.006],[.020,.076,.038,.006],[-.015,.079,.039,.006],
      [-.050,.074,.037,.006],[-.105,.068,.034,.006],[-.180,.064,.032,.006],
      [-.260,.060,.030,.006],[-.340,.055,.028,.006],[-.400,.049,.026,.006],
      [-.435,.034,.021,.006],[-.450,.001,.001,.006]
    ];
    const dims = y => {
      let i = 0;
      while (i < profile.length - 2 && y < profile[i + 1][0]) i++;
      const p1 = profile[i], p2 = profile[i + 1], t = (y - p1[0]) / (p2[0] - p1[0]);
      const p0 = profile[Math.max(0, i - 1)], p3 = profile[Math.min(profile.length - 1, i + 2)];
      return [1,2,3].map(k => Math.max(.0005, catmull(p0[k],p1[k],p2[k],p3[k],t)));
    };

    // One closed, softly rounded shell. Its broad face carries five shallow vertical flutes;
    // a low horizontal swell is integrated into the shell beneath the single knee roll.
    const rows=50, around=48, shellPos=[], shellIdx=[];
    for(let iy=0;iy<rows;iy++) {
      const y=.105+(-.555)*iy/(rows-1), [w,d,z0]=dims(y);
      const shin=smooth(.07,.18,-y)*(1-smooth(.36,.44,-y));
      for(let j=0;j<around;j++) {
        const a=j/around*Math.PI*2, sn=Math.sin(a), cs=Math.cos(a), front=Math.max(0,cs);
        const x=w*signPow(sn,.72), zShape=signPow(cs,.72);
        const flute=.0045*Math.cos(5*Math.PI*sn)*shin*Math.pow(front,.7);
        const kneeSwell=.003*Math.exp(-Math.pow((y+.018)/.035,2))*Math.pow(front,.7);
        shellPos.push(x,y,z0+d*zShape+flute+kneeSwell);
      }
    }
    for(let iy=0;iy<rows-1;iy++) for(let j=0;j<around;j++) {
      const a=iy*around+j,b=iy*around+(j+1)%around,c=(iy+1)*around+j,d=(iy+1)*around+(j+1)%around;
      shellIdx.push(a,c,b,b,c,d);
    }
    const top=shellPos.length/3; shellPos.push(0,.105,.006);
    const bottom=shellPos.length/3; shellPos.push(0,-.450,.006);
    for(let j=0;j<around;j++) {
      shellIdx.push(top,j,(j+1)%around);
      const r=(rows-1)*around;
      shellIdx.push(bottom,r+(j+1)%around,r+j);
    }
    const shell=geometry(T,shellPos,shellIdx);

    // One compact rounded roll following the front contour, with softly tapered ends.
    const rollPos=[],rollIdx=[],pathN=30,sectionN=12,theta0=-1.24,thetaSpan=2.48;
    const path=t=>{
      const a=theta0+thetaSpan*t,[w,d,z0]=dims(-.018);
      return [w*Math.sin(a),z0+d*Math.pow(Math.max(0,Math.cos(a)),.72)];
    };
    for(let i=0;i<=pathN;i++) {
      const t=i/pathN,a=theta0+thetaSpan*t,[x,z]=path(t),before=path(Math.max(0,t-.001)),after=path(Math.min(1,t+.001));
      let tx=after[0]-before[0],tz=after[1]-before[1],len=Math.hypot(tx,tz)||1;tx/=len;tz/=len;
      const nx=-tz,nz=tx,taper=.001+Math.pow(Math.sin(Math.PI*t),.62),ry=.0145*taper,rz=.010*taper;
      for(let j=0;j<sectionN;j++) {
        const ph=j/sectionN*Math.PI*2,co=Math.cos(ph),si=Math.sin(ph);
        rollPos.push(x+nx*rz*co,-.018+ry*si,z+nz*rz*co+.0015);
      }
    }
    for(let i=0;i<pathN;i++)for(let j=0;j<sectionN;j++){
      const a=i*sectionN+j,b=i*sectionN+(j+1)%sectionN,c=(i+1)*sectionN+j,d=(i+1)*sectionN+(j+1)%sectionN;
      rollIdx.push(a,c,b,b,c,d);
    }
    const rollTop=rollPos.length/3;rollPos.push(path(0)[0],-.018,path(0)[1]);
    const rollBottom=rollPos.length/3;rollPos.push(path(1)[0],-.018,path(1)[1]);
    for(let j=0;j<sectionN;j++){
      rollIdx.push(rollTop,j,(j+1)%sectionN);
      const r=pathN*sectionN;rollIdx.push(rollBottom,r+(j+1)%sectionN,r+j);
    }
    const roll=geometry(T,rollPos,rollIdx);

    // Three rear webbing straps, merged into one draw part and kept off the padded front.
    const strapPos=[],strapIdx=[],strapCount=3,strapSegments=24,thetaStart=1.12,thetaEnd=Math.PI*2-1.12,strapWidth=.012;
    for(let k=0;k<strapCount;k++) {
      const y=[-.13,-.275,-.405][k],[w,d,z0]=dims(y),base=strapPos.length/3;
      for(let i=0;i<=strapSegments;i++) {
        const a=thetaStart+(thetaEnd-thetaStart)*i/strapSegments,sn=Math.sin(a),cs=Math.cos(a);
        const x=w*signPow(sn,.72),z=z0+d*signPow(cs,.72)+Math.sign(cs)*.0015;
        strapPos.push(x,y-strapWidth/2,z,x,y+strapWidth/2,z);
      }
      for(let i=0;i<strapSegments;i++) {
        const a=base+i*2,b=a+2,c=a+1,d=a+3;strapIdx.push(a,b,c,b,d,c);
      }
    }
    const straps=geometry(T,strapPos,strapIdx);
    // The attachment origin is the knee centre, not the surface of the leg.
    // Place padded panels over the trouser front; keep straps around the calf.
    for(const g of [shell,roll]) {
      const p=g.attributes.position;
      for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)*1.25,p.getY(i)>0?p.getY(i)*1.7:p.getY(i),p.getZ(i)+.085);
      p.needsUpdate=true;g.computeVertexNormals();
    }
    straps.scale(1.4,1,2.5);
    const materials={
      shell:new T.MeshStandardMaterial({color:0xe2dfd6,roughness:.82,side:T.DoubleSide}),
      roll:new T.MeshStandardMaterial({color:0xd8d4ca,roughness:.86,side:T.DoubleSide}),
      straps:new T.MeshStandardMaterial({color:0x625f58,roughness:.9,side:T.DoubleSide})
    };
    const triangles=(shellIdx.length+rollIdx.length+strapIdx.length)/3;
    if(triangles>6000)throw new Error('Preview pad exceeds the 6,000-triangle budget');
    return {T,geometries:[shell,roll,straps],materials,triangles};
  }

  const roundedHips=new WeakMap();
  function smoothHips(source) {
    if(roundedHips.has(source))return roundedHips.get(source);
    const g=source.clone(),p=g.attributes.position,groups=[],lookup=new Map(),ids=[];
    // Weld only for smoothing calculations; retain every original UV/weight vertex.
    for(let i=0;i<p.count;i++) {
      const v=[p.getX(i),p.getY(i),p.getZ(i)],key=v.map(x=>Math.round(x*1e5)).join(':');
      if(!lookup.has(key)){lookup.set(key,groups.length);groups.push({v,adj:new Set()});}
      ids[i]=lookup.get(key);
    }
    const idx=g.index;
    for(let i=0;i<(idx?idx.count:p.count);i+=3) {
      const tri=[0,1,2].map(k=>ids[idx?idx.getX(i+k):i+k]);
      for(let k=0;k<3;k++)for(let j=0;j<3;j++)if(tri[k]!==tri[j])groups[tri[k]].adj.add(tri[j]);
    }
    // Include the centre-back seat: the previous side-only mask left its
    // rectangular shelf untouched in the ordinary batting camera.
    const masks=groups.map(({v:[x,y,z]})=>smooth(.74,.84,y)*(1-smooth(1.02,1.10,y))*Math.max(smooth(.055,.115,Math.abs(x)),1-smooth(-.065,-.015,z)));
    for(let pass=0;pass<10;pass++) {
      const next=groups.map(({v,adj},i)=>{
        if(!adj.size||!masks[i])return v.slice();
        const mean=[0,0,0];for(const j of adj)for(let k=0;k<3;k++)mean[k]+=groups[j].v[k]/adj.size;
        return v.map((x,k)=>x+(mean[k]-x)*.45*masks[i]);
      });
      groups.forEach((group,i)=>{group.v=next[i];});
    }
    for(let i=0;i<p.count;i++)p.setXYZ(i,...groups[ids[i]].v);
    p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
    roundedHips.set(source,g);return g;
  }
  const fittedBodies=new WeakMap();
  // Rest-space tailoring shared by skin and clothing keeps their layers aligned.
  // Skeletons, UVs, skin weights and the untouched source geometry are retained.
  function fitBody(source) {
    if(fittedBodies.has(source))return fittedBodies.get(source);
    const g=source.clone(),p=g.attributes.position;
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      const centre=1-smooth(.17,.26,Math.abs(x));
      const chest=smooth(1.08,1.22,y)*(1-smooth(1.40,1.53,y))*centre;
      const seat=smooth(.76,.88,y)*(1-smooth(1.00,1.12,y))*centre;
      const front=smooth(.015,.09,z),back=1-smooth(-.10,-.025,z);
      p.setXYZ(i,x*(1-.055*seat),y,z-.028*chest*front+.012*chest*back+.030*seat*back);
    }
    p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
    fittedBodies.set(source,g);return g;
  }
  const looseClothes=new WeakMap();
  // Garment ease belongs to the clothing mesh, never to the underlying skin.
  // Fade at collars, waistband and ankles to preserve the existing openings.
  function fitClothes(source,kind) {
    if(looseClothes.has(source))return looseClothes.get(source);
    const g=source.clone(),p=g.attributes.position;
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),ax=Math.abs(x);
      let ease=0;
      if(kind==='KIT_Jersey') {
        const torso=1-smooth(.19,.28,ax);
        const waist=smooth(.98,1.06,y)*(1-smooth(1.22,1.37,y));
        const sleeve=smooth(.20,.30,ax)*smooth(1.12,1.25,y);
        // A relaxed waist and sleeves, with shallow vertical cloth folds.
        const folds=.003*(.5+.5*Math.cos(x*95+z*28));
        ease=torso*waist*(.022+folds)+sleeve*.014;
      } else if(kind==='KIT_Trousers') {
        const leg=smooth(.19,.30,y)*(1-smooth(.72,.87,y));
        const outer=smooth(.035,.085,ax); // no added bulk in the crotch
        ease=leg*outer*(.015+.002*Math.cos(y*46+ax*32));
      }
      // Position-based offsets keep coincident seam vertices together even
      // where the source has split normals or an inward-facing lining.
      const axisX=kind==='KIT_Trousers' ? x-Math.sign(x)*.095 : x;
      const dx=Math.tanh(axisX*28)*ease;
      const dz=Math.tanh((z-.015)*32)*ease;
      p.setXYZ(i,x+dx,y,z+dz);
    }
    p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
    looseClothes.set(source,g);return g;
  }
  window.CricketEquipmentPreview={
    fitBody,fitClothes,smoothHips,

    pad:function(THREE){
      if(!THREE)throw new Error('pad(THREE) requires the game Three.js namespace');
      if(!cached||cached.T!==THREE)cached=build(THREE);
      const group=new THREE.Group();group.name='Original batting pad preview';
      const names=['Padded shin shell','Single knee roll','Rear webbing straps'];
      cached.geometries.forEach((g,i)=>{const mesh=new THREE.Mesh(g,cached.materials[['shell','roll','straps'][i]]);mesh.name=names[i];mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;group.add(mesh);});
      group.userData.previewTriangles=cached.triangles;
      const bounds=new THREE.Box3().makeEmpty();
      cached.geometries.forEach(g=>{g.computeBoundingBox();bounds.union(g.boundingBox);});
      group.userData.previewBoundsMetres={min:bounds.min.toArray(),max:bounds.max.toArray()};
      return group;
    }
  };
})();
