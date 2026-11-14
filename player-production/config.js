// Experimental character replacement retired by the owner on 2026-11-14.
// Keep the validation utilities for research; every game URL uses Rocketbox.
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const variant = 'legacy';
  const reference = false;
  const referenceAsset = reference || q.get('asset') === 'reference';
  const enabled = false;
  const slice = enabled && reference && q.get('slice') === '1';
  const config = window.CR_PLAYER_PRODUCTION = {
    enabled, variant, reference, slice, audit: q.get('audit') === '1', ready: false, error: null, template: null,
    slots: [], // No replacements, including previously shared preview links.
    url: 'player-production/cricket_player_' + (referenceAsset ? (variant==='mobile'?'reference_mobile':'reference') : (variant==='mobile'?'mobile':'master')) + '.glb' + (reference?'?revision=3':''),
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
        if(referenceAsset) {
          // The photographed albedo already carries skin hue. Avoid turning
          // its shadows orange with the saturated flat-colour avatar palette.
          const luminance=.2126*c.r+.7152*c.g+.0722*c.b;
          c.setRGB(.45*c.r+.55*luminance,.45*c.g+.55*luminance,.45*c.b+.55*luminance);
        }
      }
    },
    validate(reference, candidate) {
      const tolerance = 1e-4;
      const gather = root => {
        if (!root || typeof root.traverse !== 'function' || typeof root.updateMatrixWorld !== 'function')
          throw Error('Expected a Three.js rig root');
        const skins = [];
        root.traverse(object => {
          if (object.isSkinnedMesh && object.skeleton) skins.push(object.skeleton);
        });
        if (!skins.length) throw Error('Rig has no skinned mesh');
        root.updateMatrixWorld(true);
        return skins;
      };
      const fail = message => { throw Error('Rig validation: ' + message); };
      const elements = matrix => matrix && matrix.elements;
      const finiteVector = v => v && [v.x, v.y, v.z].every(Number.isFinite);
      const localTranslationOnly = object => {
        const e = elements(object.matrix);
        if (!e || e.length !== 16 || !e.every(Number.isFinite)) return false;
        return Math.abs(e[0] - 1) <= tolerance && Math.abs(e[1]) <= tolerance && Math.abs(e[2]) <= tolerance &&
          Math.abs(e[4]) <= tolerance && Math.abs(e[5] - 1) <= tolerance && Math.abs(e[6]) <= tolerance &&
          Math.abs(e[8]) <= tolerance && Math.abs(e[9]) <= tolerance && Math.abs(e[10] - 1) <= tolerance &&
          Math.abs(e[3]) <= tolerance && Math.abs(e[7]) <= tolerance && Math.abs(e[11]) <= tolerance &&
          Math.abs(e[15] - 1) <= tolerance && finiteVector(object.position);
      };
      const worldTranslationOnly = bone => {
        const e = elements(bone.matrixWorld);
        return !!e && e.length === 16 && e.every(Number.isFinite) &&
          Math.abs(e[0] - 1) <= tolerance && Math.abs(e[1]) <= tolerance && Math.abs(e[2]) <= tolerance &&
          Math.abs(e[4]) <= tolerance && Math.abs(e[5] - 1) <= tolerance && Math.abs(e[6]) <= tolerance &&
          Math.abs(e[8]) <= tolerance && Math.abs(e[9]) <= tolerance && Math.abs(e[10] - 1) <= tolerance &&
          Math.abs(e[3]) <= tolerance && Math.abs(e[7]) <= tolerance && Math.abs(e[11]) <= tolerance &&
          Math.abs(e[15] - 1) <= tolerance;
      };
      const inverseMatchesWorld = (inverse, world) => {
        const a = elements(inverse), b = elements(world);
        if (!a || !b || a.length !== 16 || b.length !== 16 || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return false;
        for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
          let value = 0;
          for (let k = 0; k < 4; k++) value += a[k * 4 + row] * b[column * 4 + k];
          if (Math.abs(value - (row === column ? 1 : 0)) > tolerance) return false;
        }
        return true;
      };
      const nearestParentName = (bone, participatingNames) => {
        for (let parent = bone.parent; parent; parent = parent.parent)
          if (parent.isBone && participatingNames.has(parent.name)) return parent.name;
        return null;
      };
      const byName = (skeleton, label) => {
        if (!skeleton || !Array.isArray(skeleton.bones) || !skeleton.bones.length) fail(label + ' skin has no bones');
        if (!Array.isArray(skeleton.boneInverses) || skeleton.boneInverses.length !== skeleton.bones.length)
          fail(label + ' skin bone/inverse count mismatch');
        const map = new Map();
        skeleton.bones.forEach((bone, i) => {
          if (!bone || !bone.isBone || typeof bone.name !== 'string' || !bone.name) fail(label + ' has an unnamed or invalid bone at ' + i);
          if (map.has(bone.name)) fail(label + ' has duplicate bone name ' + bone.name);
          map.set(bone.name, { bone, inverse: skeleton.boneInverses[i] });
        });
        return map;
      };

      const referenceSkins = gather(reference), candidateSkins = gather(candidate);
      const referenceBones = byName(referenceSkins[0], 'baseline');
      const requiredNames = new Set(referenceBones.keys());
      const links = [
        ['upperarm_l', 'lowerarm_l'], ['lowerarm_l', 'hand_l'],
        ['upperarm_r', 'lowerarm_r'], ['lowerarm_r', 'hand_r'],
        ['thigh_l', 'calf_l'], ['calf_l', 'foot_l'],
        ['thigh_r', 'calf_r'], ['calf_r', 'foot_r'],
      ];
      for (const [a, b] of links) if (!requiredNames.has(a) || !requiredNames.has(b))
        fail('baseline is missing required limb-chain bone ' + (!requiredNames.has(a) ? a : b));

      const validateSkin = (skeleton, skinIndex, expectedNames) => {
        const map = byName(skeleton, 'candidate skin ' + skinIndex);
        for (const name of requiredNames) if (!map.has(name)) fail('candidate is missing required bone ' + name);
        if (expectedNames && (map.size !== expectedNames.size || [...expectedNames].some(name => !map.has(name))))
          fail('candidate skins have inconsistent bone names');

        const extraNames = [...map.keys()].filter(name => !requiredNames.has(name));
        for (const name of extraNames) {
          if (name === 'Root' && !localTranslationOnly(map.get(name).bone))
            fail('optional Root must have identity rotation and unit scale');
        }
        if (extraNames.includes('Root')) {
          const rootBone = map.get('Root').bone;
          for (const name of requiredNames) {
            let belowRoot = false;
            for (let parent = map.get(name).bone.parent; parent; parent = parent.parent) {
              if (parent === rootBone) { belowRoot = true; break; }
            }
            if (!belowRoot) fail('optional Root must be the translation-only ancestor of mapped bones');
          }
          for (let parent = rootBone.parent; parent; parent = parent.parent)
            if (parent.isBone && requiredNames.has(parent.name)) fail('optional Root must sit above participating bones');
        }

        for (const [name, { bone, inverse }] of map) {
          if (!worldTranslationOnly(bone)) fail('candidate world rest rotation/scale is unsupported: ' + name);
          if (!inverseMatchesWorld(inverse, bone.matrixWorld)) fail('candidate inverse bind disagrees with its own rest matrix: ' + name);
          if (!requiredNames.has(name) && name !== 'Root') {
            // Extra joints are only safe when they are translation-only nodes on a mapped joint path.
            const hasMappedDescendant = [...map.values()].some(({ bone: other }) => {
              if (requiredNames.has(other.name)) for (let p = other.parent; p; p = p.parent) if (p === bone) return true;
              return false;
            });
            if (!hasMappedDescendant) fail('unsupported extra candidate bone ' + name);
            if (!localTranslationOnly(bone)) fail('extra intermediary rotation/scale is unsupported: ' + name);
          }
        }

        // Only the optional source Root is handled by the renderer; reject other
        // intermediate bones even if their current rotation happens to be identity.
        for (const { bone } of map.values()) if (requiredNames.has(bone.name)) {
          for (let parent = bone.parent; parent; parent = parent.parent) {
            if (parent.isBone && requiredNames.has(parent.name)) break;
            if (parent.isBone && parent.name === 'Root' && requiredNames.has('Root')) break;
            if (!localTranslationOnly(parent)) fail('extra intermediary rotation/scale is unsupported above ' + bone.name);
            if(parent.isBone && !requiredNames.has(parent.name) && parent.name!=='Root') fail('unsupported intermediary bone above '+bone.name);
          }
          const expectedParent = nearestParentName(referenceBones.get(bone.name).bone, requiredNames);
          const actualParent = nearestParentName(bone, requiredNames);
          if (expectedParent !== actualParent)
            fail('nearest participating parent mismatch for ' + bone.name + ': expected ' + (expectedParent || '<root>') + ', got ' + (actualParent || '<root>'));
        }

        for (const [aName, bName] of links) {
          const a = elements(map.get(aName).bone.matrixWorld), b = elements(map.get(bName).bone.matrixWorld);
          const length = Math.hypot(b[12] - a[12], b[13] - a[13], b[14] - a[14]);
          if (!Number.isFinite(length) || length <= 1e-6) fail('invalid limb length ' + aName + ' -> ' + bName);
        }
        return map;
      };

      // Baseline skins must describe one named hierarchy as well.
      for (let i = 1; i < referenceSkins.length; i++) {
        const names = byName(referenceSkins[i], 'baseline skin ' + i);
        if (names.size !== requiredNames.size || [...requiredNames].some(name => !names.has(name)))
          fail('baseline skins have inconsistent bone names');
      }
      const candidateNameSet = new Set(byName(candidateSkins[0], 'candidate skin 0').keys());
      for (let i = 0; i < candidateSkins.length; i++) validateSkin(candidateSkins[i], i, candidateNameSet);

      return {
        ok: true,
        mappedBones: requiredNames.size,
        candidateSkins: candidateSkins.length,
        optionalBones: [...candidateNameSet].filter(name => !requiredNames.has(name)),
      };
    }
  };
  if (enabled) console.info('Experimental player enabled:', variant, '(visual acceptance pending)');
})();
