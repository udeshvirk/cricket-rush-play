// Explicit development opt-in only: ?player=production or ?player=mobile.
// No localStorage setting, so installed games and ordinary links stay on V2.
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const variant = q.get('player');
  const reference = q.get('presentation') === 'reference';
  const enabled = variant === 'production' || variant === 'mobile';
  const slice = enabled && reference && q.get('slice') === '1';
  const config = window.CR_PLAYER_PRODUCTION = {
    enabled, variant, reference, slice, audit: q.get('audit') === '1', ready: false, error: null, template: null,
    slots: reference ? [0,1,2] : [0,2], // reference review includes both batsmen and the bowler
    url: 'player-production/cricket_player_' + (reference ? (variant==='mobile'?'reference_mobile':'reference') : (variant==='mobile'?'mobile':'master')) + '.glb' + (reference?'?revision=3':''),
    setAppearance(parts, shirt, trousers, skinTone, teamId) {
      if (parts.KIT_Jersey) parts.KIT_Jersey.material.color.copy(shirt);
      if (parts.KIT_Trousers) parts.KIT_Trousers.material.color.copy(trousers);
      if(reference && teamId==='ind') {
        parts.KIT_Jersey?.material.color.set('#78afd0');
        parts.KIT_Trousers?.material.color.set('#76a8c8');
      }
      if (parts.SKIN_Human && skinTone) {
        // The source albedo carries pores and facial colour. Multiply it by a
        // bounded tint; use the same stable player palette as the baseline.
        const c=parts.SKIN_Human.material.color;
        c.setRGB(Math.min(1.35,skinTone.r/.64),Math.min(1.35,skinTone.g/.43),Math.min(1.35,skinTone.b/.31));
        if(reference) {
          // The photographed albedo already carries skin hue. Avoid turning
          // its shadows orange with the saturated flat-colour avatar palette.
          const luminance=.2126*c.r+.7152*c.g+.0722*c.b;
          c.setRGB(.45*c.r+.55*luminance,.45*c.g+.55*luminance,.45*c.b+.55*luminance);
        }
      }
    },
    validate(reference, candidate) {
      const collect = root => {
        const bones = []; let skeleton;
        root.traverse(o => { if (o.isBone) bones.push(o); if (o.isSkinnedMesh) skeleton = o.skeleton; });
        return { bones, skeleton };
      };
      reference.updateMatrixWorld(true); candidate.updateMatrixWorld(true);
      const a = collect(reference), b = collect(candidate);
      if (!a.skeleton || !b.skeleton || b.skeleton.bones.length !== 53) throw Error('Expected 53-joint skinned rig');
      a.skeleton.bones.forEach((bone, i) => {
        const other = b.skeleton.bones[i];
        if (!other || bone.name !== other.name || (bone.parent && bone.parent.name) !== (other.parent && other.parent.name))
          throw Error('Joint order or hierarchy mismatch at ' + i);
        for (const key of ['matrixWorld'])
          if (bone[key].elements.some((x, k) => Math.abs(x - other[key].elements[k]) > 1e-5)) throw Error('Rest pose mismatch: ' + bone.name);
        if (a.skeleton.boneInverses[i].elements.some((x, k) => Math.abs(x - b.skeleton.boneInverses[i].elements[k]) > 1e-5))
          throw Error('Bind matrix mismatch: ' + bone.name);
      });
    }
  };
  if (enabled) console.info('Experimental player enabled:', variant, '(visual acceptance pending)');
})();
