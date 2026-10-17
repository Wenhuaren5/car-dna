/*
 * Local GLB body library.
 *
 * These are fixed exterior design assets, not engineering models. They are loaded only for the
 * five standard body types used by the questionnaire and the car database. A body type without a
 * verified local model keeps the procedural concept car, so the fallback is always available.
 *
 * Every entry must point at a local file under public/models/ and record its provenance. The
 * models shipped with this checkpoint are original, unbranded Innerscene models released under
 * CC0 1.0 (public domain). The minivan is a CC0 derivative: its high-roof donor cabin was
 * compressed to low-roof family-MPV proportions, with the wheels and lower body left untouched.
 * No manufacturer badges, logos or branded vehicle geometry are used.
 */

export const CAR_MODEL_LIBRARY = {
  sedan: {
    bodyKey: 'sedan',
    label: 'Sedan',
    file: 'sedan.glb',
    url: 'models/sedan.glb',
    title: 'Red four-door sedan',
    source: 'Innerscene 3D Parts Library',
    sourceUrl: 'https://www.innerscene.com/tools/library/3d-parts/red-four-door-sedan-1d32e180',
    license: 'CC0 1.0 Universal (public domain)',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    credit: 'Innerscene (CC0 1.0)',
    retrieved: '2026-10-17',
    byteSize: 5058464,
    triangles: 132082,
    // The source model faces -X. Rotating it by 180° puts the nose on +X, where the
    // procedural car and the existing camera expect it.
    yaw: Math.PI,
  },
  hatchback: {
    bodyKey: 'hatchback',
    label: 'Hatchback',
    file: 'hatchback.glb',
    url: 'models/hatchback.glb',
    title: 'Blue five-door compact hatchback',
    source: 'Innerscene 3D Parts Library',
    sourceUrl: 'https://www.innerscene.com/tools/library/3d-parts/blue-five-door-compact-hatchback-5b95b2a0',
    license: 'CC0 1.0 Universal (public domain)',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    credit: 'Innerscene (CC0 1.0)',
    retrieved: '2026-10-17',
    byteSize: 5037744,
    triangles: 130902,
    yaw: Math.PI,
  },
  suv: {
    bodyKey: 'suv',
    label: 'SUV / Crossover',
    file: 'suv.glb',
    url: 'models/suv.glb',
    title: 'Charcoal five-door crossover SUV',
    source: 'Innerscene 3D Parts Library',
    sourceUrl: 'https://www.innerscene.com/tools/library/3d-parts/charcoal-five-door-crossover-suv-a1996830',
    license: 'CC0 1.0 Universal (public domain)',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    credit: 'Innerscene (CC0 1.0)',
    retrieved: '2026-10-17',
    byteSize: 5081324,
    triangles: 133178,
    // The source model faces -X. Rotating it by 180° puts the nose on +X, where the
    // procedural car and the existing camera expect it.
    yaw: Math.PI,
  },
  minivan: {
    bodyKey: 'minivan',
    label: 'Minivan (MPV)',
    file: 'minivan.glb',
    url: 'models/minivan.glb',
    title: 'White passenger van adapted to low-roof family MPV proportions',
    source: 'Innerscene 3D Parts Library (CC0 source, adapted)',
    sourceUrl: 'https://www.innerscene.com/tools/library/3d-parts/passenger-van-with-side-windows-474dd4a2',
    license: 'CC0 1.0 Universal (public domain)',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    credit: 'Innerscene (CC0 1.0); MPV adaptation for Car DNA',
    retrieved: '2026-10-17',
    byteSize: 6319312,
    triangles: 147492,
    yaw: Math.PI,
    adaptation: 'The CC0 passenger-van source was scaled to 0.90× length and its cabin above 1.25 m compressed to 0.62× height, removing the high-roof commercial-van silhouette while keeping the wheels, glazing, lights and lower body unchanged.',
  },
  pickup: {
    bodyKey: 'pickup',
    label: 'Pickup Truck',
    file: 'pickup.glb',
    url: 'models/pickup.glb',
    title: 'Crew-cab pickup with open bed',
    source: 'Innerscene 3D Parts Library',
    sourceUrl: 'https://www.innerscene.com/tools/library/3d-parts/crew-cab-pickup-with-open-bed-4f02e0cc',
    license: 'CC0 1.0 Universal (public domain)',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    credit: 'Innerscene (CC0 1.0)',
    retrieved: '2026-10-17',
    byteSize: 5614548,
    triangles: 145816,
    yaw: Math.PI,
  },
};

const BASE_URL = (() => {
  try {
    return import.meta.env?.BASE_URL || './';
  } catch (error) {
    return './';
  }
})();

export function modelForBody(bodyKey) {
  return CAR_MODEL_LIBRARY[bodyKey] || null;
}

export function resolveModelUrl(model) {
  if (!model) return null;
  const base = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  return `${base}${String(model.url).replace(/^\.?\//, '')}`;
}

export function modelAttribution(model) {
  if (!model) return 'Procedural concept body';
  return `${model.title} — ${model.credit}`;
}

function collectMaterials(root) {
  const materials = new Set();
  root.traverse(object => {
    if (!object.isMesh || !object.material) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    list.forEach(material => materials.add(material));
  });
  return [...materials];
}

function countTriangles(root) {
  let triangles = 0;
  root.traverse(object => {
    if (!object.isMesh || !object.geometry) return;
    const geometry = object.geometry;
    if (geometry.index) triangles += geometry.index.count / 3;
    else if (geometry.attributes?.position) triangles += geometry.attributes.position.count / 3;
  });
  return Math.round(triangles);
}

/*
 * Normalise a loaded GLB into the stage convention used by the procedural car:
 *   - nose on +X (a per-model yaw offset corrects the asset's own heading),
 *   - length on X and width on Z (a 90° yaw is applied if the asset is authored that way),
 *   - horizontally centred on the origin and resting with its lowest point on y = 0,
 *   - metres preserved. Only an implausible unit scale is corrected; DNA values never resize it.
 */
export function prepareGlbModel(THREE, gltf, model, options = {}) {
  const scene = gltf?.scene || gltf?.scenes?.[0];
  if (!scene) throw new Error('The GLB contains no renderable scene.');

  const root = new THREE.Group();
  root.name = `glb-body-${model?.bodyKey || 'unknown'}`;
  root.add(scene);
  root.rotation.y = Number.isFinite(model?.yaw) ? model.yaw : 0;
  root.updateMatrixWorld(true);

  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.x) || !Number.isFinite(size.y) || !Number.isFinite(size.z)) {
    throw new Error('The GLB has invalid bounds.');
  }

  // Some libraries author the car along Z. Put the long axis on X so the existing
  // three-quarter camera always sees a side/front view rather than a head-on end.
  if (size.z > size.x * 1.08) {
    root.rotation.y += Math.PI / 2;
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    size = box.getSize(new THREE.Vector3());
  }

  // Guard against a centimetre/millimetre export. Real models stay at 1:1.
  const targetLength = Number(options.targetLength) || 0;
  let scale = 1;
  if (!(size.x >= 2.5 && size.x <= 8.5)) {
    if (targetLength > 0) scale = targetLength / Math.max(size.x, 0.001);
    scale = Math.min(200, Math.max(0.001, scale));
    root.scale.multiplyScalar(scale);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    size = box.getSize(new THREE.Vector3());
  }

  const centre = box.getCenter(new THREE.Vector3());
  root.position.x -= centre.x;
  root.position.z -= centre.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  size = box.getSize(new THREE.Vector3());

  const materials = collectMaterials(root);
  const materialState = materials.map(material => ({
    material,
    transparent: material.transparent,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
  }));

  root.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = false;
    // The model is a set of small, detached parts. Per-part culling is correct and
    // keeps the draw list small without hiding anything.
    object.frustumCulled = true;
  });

  return {
    root,
    size,
    box,
    scale,
    materials,
    materialState,
    triangles: countTriangles(root),
    model,
  };
}

/*
 * Presentation finish for the fixed GLB exterior. Only material response is tuned; geometry,
 * proportions and colour maps stay exactly as authored. The DNA accent is used as a faint sheen,
 * never as a claim that the car's engineering parameters changed.
 */
export function applyGlbFinish(THREE, prepared, accentHex) {
  if (!prepared) return;
  // If the finish changes while the reveal fade is running, start again from the stored
  // presentation baseline. Otherwise the fade's temporary transparency would be captured
  // as the final state (leaving every material transparent and not depth-writing).
  prepared.materialState.forEach(entry => {
    entry.material.transparent = entry.transparent;
    entry.material.opacity = entry.opacity;
    entry.material.depthWrite = entry.depthWrite;
  });
  const accent = new THREE.Color(accentHex || '#78f0ba');
  prepared.materials.forEach(material => {
    const name = String(material.name || '').toLowerCase();
    material.envMapIntensity = 1.25;
    if (name.includes('paint') || name.includes('body')) {
      material.metalness = Math.max(0.48, Number(material.metalness) || 0);
      material.roughness = Math.min(0.32, Number(material.roughness) || 0.3);
      material.clearcoat = 1;
      material.clearcoatRoughness = 0.07;
      material.envMapIntensity = 1.65;
      if ('sheen' in material) {
        material.sheen = 0.32;
        material.sheenRoughness = 0.45;
        material.sheenColor = accent.clone().lerp(new THREE.Color(0xffffff), 0.72);
      }
    } else if (name.includes('glass') || name.includes('clearlens')) {
      material.envMapIntensity = 1.45;
      material.roughness = 0.035;
      material.depthWrite = false;
      if ('transmission' in material) material.transmission = Math.max(0.82, material.transmission || 0);
    } else if (name.includes('chrome') || name.includes('steel')) {
      material.envMapIntensity = 1.55;
    } else if (name.includes('rubber')) {
      material.envMapIntensity = 0.7;
    } else if (name.includes('redlens')) {
      material.emissive = new THREE.Color(0x340602);
      material.emissiveIntensity = 0.35;
      material.envMapIntensity = 1.2;
    } else if (name.includes('white')) {
      material.emissive = new THREE.Color(0x183b32);
      material.emissiveIntensity = 0.28;
    }
    material.needsUpdate = true;
  });
  // Capture the finished material state as the reveal baseline, so completing the fade
  // restores the presentation values (not the raw GLB values).
  prepared.materialState = prepared.materials.map(material => ({
    material,
    transparent: material.transparent,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
  }));
}

/*
 * Concept reveal: a short material fade plus a small vertical settle. This is deliberately a
 * presentation effect, not a component-by-component assembly of the GLB.
 */
export function setGlbReveal(prepared, amount, reduceMotion = false) {
  if (!prepared) return;
  const reveal = reduceMotion ? 1 : Math.min(1, Math.max(0, amount));
  const complete = reveal >= 0.995;
  // The presentation state is already settled; avoid resetting material flags every frame.
  if (complete && prepared.revealed === true) return;
  prepared.revealed = complete;
  prepared.root.visible = reveal > 0.002;
  prepared.root.scale.y = prepared.scale * (0.92 + reveal * 0.08);
  const fading = !complete;
  prepared.materialState.forEach(entry => {
    const material = entry.material;
    let dirty = false;
    if (fading) {
      if (!material.transparent) { material.transparent = true; dirty = true; }
      if (material.depthWrite) { material.depthWrite = false; dirty = true; }
      material.opacity = entry.opacity * reveal;
    } else {
      if (material.transparent !== entry.transparent) {
        material.transparent = entry.transparent;
        dirty = true;
      }
      if (material.depthWrite !== entry.depthWrite) {
        material.depthWrite = entry.depthWrite;
        dirty = true;
      }
      material.opacity = entry.opacity;
    }
    // Only a transparency/depth-write change needs a program refresh; opacity is a uniform.
    if (dirty) material.needsUpdate = true;
  });
}

export function releaseGlbModel(prepared) {
  if (!prepared?.root) return;
  const textures = new Set();
  const materials = new Set();
  prepared.root.traverse(object => {
    if (object.geometry) object.geometry.dispose();
    if (!object.material) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    list.forEach(material => {
      materials.add(material);
      ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap',
        'clearcoatMap', 'clearcoatRoughnessMap', 'transmissionMap', 'thicknessMap', 'sheenColorMap']
        .forEach(key => {
          if (material[key]) textures.add(material[key]);
        });
    });
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  if (prepared.root.parent) prepared.root.parent.remove(prepared.root);
  prepared.root.clear();
}
