import * as THREE from 'three';
import { buns, fillings } from './burger';

type Point = readonly [radius: number, height: number];
type ColorStop = readonly [height: number, color: string];
type SurfaceDetail = { x: number; y: number; z: number; width: number; height: number; depth: number; angle?: number; color: string; normal?: THREE.Vector3 };

const models = new Map<string, THREE.Group>();
const textures = new Map<string, THREE.DataTexture>();
const detailGeometry = new THREE.SphereGeometry(1, 9, 6);
const crumbGeometry = new THREE.IcosahedronGeometry(1, 1);
const tau = 2 * Math.PI;
const up = new THREE.Vector3(0, 1, 0);

function randomFrom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function grain(name: string, seed: number, contrast: number, pits: number) {
  const cached = textures.get(name);
  if (cached) return cached;

  const size = 128;
  const random = randomFrom(seed);
  const makeField = (scale: number) => Float32Array.from({ length: scale * scale }, random);
  const broad = makeField(12);
  const small = makeField(36);
  const sample = (field: Float32Array, scale: number, x: number, y: number) => {
    const u = x / size * scale;
    const v = y / size * scale;
    const firstX = Math.floor(u);
    const firstY = Math.floor(v);
    const nextX = (firstX + 1) % scale;
    const nextY = (firstY + 1) % scale;
    const mixX = u - firstX;
    const mixY = v - firstY;
    const a = THREE.MathUtils.lerp(field[firstY * scale + firstX], field[firstY * scale + nextX], mixX);
    const b = THREE.MathUtils.lerp(field[nextY * scale + firstX], field[nextY * scale + nextX], mixX);
    return THREE.MathUtils.lerp(a, b, mixY);
  };

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = 252 - contrast * (0.6 * sample(broad, 12, x, y) + 0.25 * sample(small, 36, x, y) + 0.15 * random());
      const shade = random() < pits ? value * 0.69 : value;
      const index = (y * size + x) * 4;
      data.set([shade, shade, shade, 255], index);
    }
  }

  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  textures.set(name, texture);
  return texture;
}

function surface(color: string, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, ...extra });
}

function foodSurface(roughness: number, texture?: THREE.DataTexture, bump = 0.012, side: THREE.Side = THREE.FrontSide) {
  return surface('#ffffff', roughness, { vertexColors: true, map: texture, bumpMap: texture, bumpScale: bump, side });
}

function addMesh(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function tint(geometry: THREE.BufferGeometry, colorAt: (x: number, y: number, z: number) => THREE.Color) {
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    colorAt(positions.getX(i), positions.getY(i), positions.getZ(i)).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function palette(stops: readonly ColorStop[]) {
  const colors = stops.map(([at, color]) => ({ at, color: new THREE.Color(color) }));
  const output = new THREE.Color();
  return (value: number) => {
    for (let i = 1; i < colors.length; i++) {
      const low = colors[i - 1];
      const high = colors[i];
      if (value <= high.at) {
        const fraction = THREE.MathUtils.clamp((value - low.at) / (high.at - low.at), 0, 1);
        return output.copy(low.color).lerp(high.color, fraction);
      }
    }
    return output.copy(colors[colors.length - 1].color);
  };
}

function radialGeometry(profile: readonly Point[], radius: number, height: number, wobble: number, segments = 64) {
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const detail = segments > 42 ? 3 : 2;
  const points = curve.getPoints(profile.length * detail).map((point) => new THREE.Vector2(Math.max(point.x, 0) * radius, point.y * height));
  const geometry = new THREE.LatheGeometry(points, segments);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const angle = Math.atan2(z, x);
    const edge = Math.hypot(x, z) / radius;
    const ripple = Math.sin(angle * 5 + y * 9) * 0.49 + Math.sin(angle * 9 - y * 18) * 0.28 + Math.sin(angle * 17 + y * 11) * 0.15 + Math.sin(angle * 29 - y * 13) * 0.08;
    const scale = 1 + wobble * ripple * Math.min(1, edge);
    positions.setXYZ(i, x * scale, y + height * wobble * 0.7 * ripple * edge, z * scale);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function coloredRadial(profile: readonly Point[], radius: number, height: number, wobble: number, stops: readonly ColorStop[], segments?: number) {
  const geometry = radialGeometry(profile, radius, height, wobble, segments);
  const colorAt = palette(stops);
  tint(geometry, (x, y, z) => colorAt(y / height).multiplyScalar(1 + 0.10 * Math.sin(x * 9 + z * 5) * Math.cos(z * 8 - x * 6)));
  return geometry;
}

function details(group: THREE.Group, pieces: readonly SurfaceDetail[], roughness: number, geometry: THREE.BufferGeometry = detailGeometry) {
  const mesh = new THREE.InstancedMesh(geometry, surface('#ffffff', roughness), pieces.length);
  const transform = new THREE.Object3D();
  const spin = new THREE.Quaternion();
  const color = new THREE.Color();
  pieces.forEach((piece, index) => {
    transform.position.set(piece.x, piece.y, piece.z);
    transform.scale.set(piece.width, piece.height, piece.depth);
    transform.quaternion.setFromUnitVectors(up, piece.normal ?? up);
    transform.quaternion.multiply(spin.setFromAxisAngle(up, piece.angle ?? 0));
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, color.set(piece.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

const bunDome: Point[] = [
  [0, 0.023], [0.52, 0.02], [0.81, 0.024], [0.93, 0.043], [0.984, 0.107],
  [1, 0.23], [0.985, 0.39], [0.943, 0.54], [0.86, 0.69], [0.73, 0.824],
  [0.56, 0.92], [0.35, 0.975], [0.16, 0.995], [0, 1],
];
const bunBase: Point[] = [
  [0, 0.008], [0.55, 0], [0.79, 0.035], [0.91, 0.11], [0.979, 0.25],
  [1, 0.49], [0.99, 0.72], [0.963, 0.872], [0.925, 0.95], [0.80, 0.982],
  [0.60, 0.992], [0.37, 1], [0.16, 0.997], [0, 0.991],
];
const bunMaterials = new Map<string, THREE.MeshPhysicalMaterial>();
const breadSegments = 96;

function breadNoise(columns: number, rows: number, random: () => number) {
  const values = Float32Array.from({ length: columns * (rows + 1) }, random);
  return (u: number, v: number) => {
    const x = u * columns;
    const y = Math.min(v * rows, rows - 0.00001);
    const left = Math.floor(x);
    const row = Math.floor(y);
    const uWeight = THREE.MathUtils.smoothstep(x - left, 0, 1);
    const vWeight = THREE.MathUtils.smoothstep(y - row, 0, 1);
    const first = left % columns;
    const second = (first + 1) % columns;
    const low = THREE.MathUtils.lerp(values[row * columns + first], values[row * columns + second], uWeight);
    const high = THREE.MathUtils.lerp(values[(row + 1) * columns + first], values[(row + 1) * columns + second], uWeight);
    return THREE.MathUtils.lerp(low, high, vWeight);
  };
}

function breadPores(columns: number, rows: number, random: () => number) {
  const cells = Array.from({ length: columns * rows }, () => ({
    x: 0.30 + random() * 0.40,
    y: 0.30 + random() * 0.40,
    width: 0.12 + random() ** 1.8 * 0.21,
    depth: random() ** 1.3,
  }));
  return (u: number, v: number) => {
    const x = u * columns;
    const y = Math.min(v * rows, rows - 0.00001);
    const column = Math.floor(x);
    const row = Math.floor(y);
    const cell = cells[row * columns + column % columns];
    const distance = Math.hypot((x - column - cell.x) * 1.08, (y - row - cell.y) * 0.94) / cell.width;
    const well = (1 - THREE.MathUtils.smoothstep(distance, 0.15, 0.85)) * cell.depth;
    const rim = (1 - THREE.MathUtils.smoothstep(Math.abs(distance - 0.90), 0.04, 0.24)) * cell.depth;
    return well - 0.13 * rim;
  };
}

function breadCutMask(v: number, top: boolean) {
  return top ? 1 - THREE.MathUtils.smoothstep(v, 0.204, 0.299) : THREE.MathUtils.smoothstep(v, 0.633, 0.726);
}

function foodDataTexture(data: Uint8Array, width: number, height: number, colorSpace: string) {
  const texture = new THREE.DataTexture(data, width, height);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function breadMaterial(potato: boolean, top: boolean) {
  const key = `${potato}-${top}`;
  const cached = bunMaterials.get(key);
  if (cached) return cached;

  const random = randomFrom((potato ? 541 : 849) + (top ? 13 : 721));
  const mottle = breadNoise(18, 10, random);
  const blister = breadNoise(53, 30, random);
  const grit = breadNoise(130, 77, random);
  const crustPore = breadPores(103, 68, random);
  const crumbPore = breadPores(71, 42, random);
  const width = 512;
  const height = 256;
  const albedo = new Uint8Array(width * height * 4);
  const relief = new Uint8Array(albedo.length);

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const cut = breadCutMask(v, top);
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const baked = mottle(u, v);
      const bubbles = blister(u, v);
      const grain = grit(u, v);
      const skin = crustPore(u, v);
      const crumb = crumbPore(u, v);
      const wrinkle = Math.sin(v * 138 + baked * 9 + Math.sin(u * tau * 7) * 1.4) * bubbles;
      const freckles = THREE.MathUtils.smoothstep(grain, 0.5, 0.9);
      const skinColor = 225 + 18 * baked + 22 * bubbles - 85 * skin - 22 * freckles + 4 * wrinkle;
      const crumbColor = 249 + 8 * grain - 102 * crumb - 17 * bubbles;
      const tone = THREE.MathUtils.lerp(skinColor, crumbColor, cut);
      const depth = THREE.MathUtils.lerp(136 + bubbles * 38 + grain * 26 - skin * 102 + wrinkle * 9, 143 + grain * 36 - crumb * 138, cut);
      const roughness = THREE.MathUtils.lerp((potato ? 161 : 94) + 53 * baked + 18 * bubbles, 225 + 20 * grain, cut);
      const i = (y * width + x) * 4;
      albedo[i] = THREE.MathUtils.clamp(tone + (1 - cut) * 4, 0, 255);
      albedo[i + 1] = THREE.MathUtils.clamp(tone, 0, 255);
      albedo[i + 2] = THREE.MathUtils.clamp(tone - (1 - cut) * (11 + 5 * baked), 0, 255);
      albedo[i + 3] = 255;
      relief[i] = THREE.MathUtils.clamp(depth, 0, 255);
      relief[i + 1] = roughness;
      relief[i + 2] = 0;
      relief[i + 3] = 255;
    }
  }

  const texture = foodDataTexture(albedo, width, height, THREE.SRGBColorSpace);
  const microSurface = foodDataTexture(relief, width, height, THREE.NoColorSpace);
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.91, map: texture,
    bumpMap: microSurface, bumpScale: 0.022, roughnessMap: microSurface,
    clearcoat: top && !potato ? 0.19 : 0.045, clearcoatRoughness: 0.46,
    envMapIntensity: 0.72,
  });
  bunMaterials.set(key, material);
  return material;
}

function colorBread(geometry: THREE.BufferGeometry, height: number, potato: boolean, top: boolean) {
  const crust = palette(top
    ? [[0, '#c58449'], [0.17, '#d38b42'], [0.40, potato ? '#cd9042' : '#bc6d28'], [0.70, potato ? '#c58333' : '#9d4317'], [1, potato ? '#ac6c26' : '#7e2c10']]
    : [[0, '#77401c'], [0.23, '#a75c2b'], [0.55, '#bd733a'], [0.82, '#d49650'], [1, '#bd6d31']]);
  const crumb = new THREE.Color(potato ? '#f3ce93' : '#efc490');
  const toastedRim = new THREE.Color(potato ? '#d8a25e' : '#c48b45');
  const crumbTone = new THREE.Color();
  const vertices = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const colors = new Float32Array(vertices.count * 3);

  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i);
    const y = vertices.getY(i);
    const z = vertices.getZ(i);
    const marbling = 0.948 + 0.069 * Math.sin(x * 5.6 + z * 7.7) * Math.cos(x * 4.3 - z * 6.1);
    const rim = THREE.MathUtils.smoothstep(Math.hypot(x, z) + 0.024 * Math.sin(x * 18.3 + z * 11.9), 0.80, 1.21);
    crumbTone.copy(crumb).lerp(toastedRim, rim);
    crust(y / height).multiplyScalar(marbling).lerp(crumbTone, breadCutMask(uv.getY(i), top)).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function sesameSeedGeometry() {
  const geometry = new THREE.SphereGeometry(1, 12, 8);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const taper = 0.95 + x * 0.28;
    positions.setXYZ(i, x, y * taper + 0.21 * x * x, z * taper);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function smoothLatheNormals(geometry: THREE.BufferGeometry, segments: number) {
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const rows = normals.count / (segments + 1);
  const average = new THREE.Vector3();
  const end = new THREE.Vector3();
  for (let row = 1; row < rows - 1; row++) {
    const last = segments * rows + row;
    average.fromBufferAttribute(normals, row).add(end.fromBufferAttribute(normals, last)).normalize();
    normals.setXYZ(row, average.x, average.y, average.z);
    normals.setXYZ(last, average.x, average.y, average.z);
  }
  for (let segment = 0; segment <= segments; segment++) {
    normals.setXYZ(segment * rows, 0, -1, 0);
    normals.setXYZ(segment * rows + rows - 1, 0, 1, 0);
  }
}

function bun(style: string, top: boolean, height: number) {
  const group = new THREE.Group();
  const radius = top ? 1.30 : 1.23;
  const potato = style === 'potato';
  const profile = top ? bunDome : bunBase;
  const geometry = radialGeometry(profile, radius, height, potato ? 0.065 : 0.047, breadSegments);
  smoothLatheNormals(geometry, breadSegments);
  colorBread(geometry, height, potato, top);
  addMesh(group, geometry, breadMaterial(potato, top));

  if (top && style === 'sesame') {
    const random = randomFrom(441);
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const vertexCount = profile.length * 3 + 1;
    const shades = ['#e2bb78', '#ead39d', '#f0dfaf', '#bf8f4c', '#f3dfab'];
    const points: SurfaceDetail[] = [];
    for (let i = 0; i < 79; i++) {
      const angle = (((i * 0.61803398875) + random() * 0.065) % 1) * breadSegments;
      const segment = Math.floor(angle);
      const row = 20 + Math.floor(Math.sqrt(random()) * 20);
      const a = segment * vertexCount + row;
      const b = (segment + 1) * vertexCount + row;
      const fraction = angle - segment;
      const position = new THREE.Vector3().fromBufferAttribute(positions, a).lerp(new THREE.Vector3().fromBufferAttribute(positions, b), fraction);
      const normal = new THREE.Vector3().fromBufferAttribute(normals, a).lerp(new THREE.Vector3().fromBufferAttribute(normals, b), fraction).normalize();
      position.addScaledVector(normal, 0.004);
      points.push({
        x: position.x, y: position.y, z: position.z, normal,
        width: 0.030 + random() * 0.014, height: 0.008 + random() * 0.005,
        depth: 0.013 + random() * 0.006, angle: random() * tau,
        color: shades[Math.floor(random() * shades.length)],
      });
    }
    details(group, points, 0.64, sesameSeedGeometry());
  }
  return group;
}

const pattyProfile: Point[] = [[0, 0.09], [0.68, 0.06], [0.86, 0.03], [0.97, 0.16], [1, 0.35], [0.99, 0.61], [0.95, 0.78], [0.83, 0.90], [0.66, 0.97], [0.33, 0.98], [0, 1]];
const smashProfile: Point[] = [[0, 0.11], [0.60, 0.06], [0.84, 0.02], [0.95, 0.09], [1, 0.27], [1, 0.48], [0.94, 0.68], [0.84, 0.81], [0.63, 0.94], [0.3, 0.99], [0, 1]];

const crustPalettes: Record<string, ColorStop[]> = {
  smash: [[0, '#23100a'], [0.29, '#3b1c12'], [0.47, '#653620'], [0.66, '#925633'], [0.83, '#b7784e'], [1, '#d6a16f']],
  beef: [[0, '#26130e'], [0.27, '#412519'], [0.47, '#72432c'], [0.64, '#995c38'], [0.84, '#bf8356'], [1, '#d4a274']],
  chicken: [[0, '#552407'], [0.28, '#8a4214'], [0.48, '#c47a2c'], [0.65, '#e59f47'], [0.83, '#f1bd66'], [1, '#f8d395']],
  'mushroom-patty': [[0, '#291d13'], [0.27, '#493624'], [0.46, '#775639'], [0.66, '#a17a50'], [0.86, '#bc9566'], [1, '#e1b980']],
};

function crustNoise(random: () => number, columns: number, rows: number) {
  const field = Float32Array.from({ length: columns * rows }, random);
  const fade = (n: number) => n * n * (3 - 2 * n);
  return (u: number, v: number) => {
    const x = (u - Math.floor(u)) * columns;
    const y = (v - Math.floor(v)) * rows;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = (x0 + 1) % columns;
    const y1 = (y0 + 1) % rows;
    const horizontal = fade(x - x0);
    const a = THREE.MathUtils.lerp(field[y0 * columns + x0], field[y0 * columns + x1], horizontal);
    const b = THREE.MathUtils.lerp(field[y1 * columns + x0], field[y1 * columns + x1], horizontal);
    return THREE.MathUtils.lerp(a, b, fade(y - y0));
  };
}

function pattyCrust(id: string) {
  const chicken = id === 'chicken';
  const random = randomFrom(chicken ? 390 : id === 'smash' ? 580 : id === 'beef' ? 416 : 314);
  const browning = crustNoise(random, 17, 17);
  const mince = crustNoise(random, 70, 70);
  const pores = crustNoise(random, 145, 145);
  const reliefAt = (u: number, v: number) => 0.52 * mince(u, v) + 0.30 * browning(u, v) + 0.18 * pores(u, v);
  const contourAt = (u: number, v: number) => 0.60 * browning(u, v) + 0.40 * mince(u, v);
  const colors = palette(crustPalettes[id]);
  const rgb = { r: 0, g: 0, b: 0 };
  const width = 384;
  const height = 384;
  const albedo = new Uint8Array(width * height * 4);
  const details = new Uint8Array(width * height * 4);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const u = (col + 0.5) / width;
      const v = (row + 0.5) / height;
      const patch = browning(u, v);
      const raised = reliefAt(u, v);
      const pore = pores(u, v);
      const browned = 0.62 * raised + 0.26 * patch + 0.12 * pore;
      const crevice = 1 - THREE.MathUtils.smoothstep(raised, 0.22, 0.41);
      const fleck = THREE.MathUtils.smoothstep(pore * 0.66 + patch * 0.34, 0.66, 0.94);
      colors(0.5 + (browned - 0.5) * 0.81 - crevice * 0.065 + fleck * 0.095).getRGB(rgb, THREE.SRGBColorSpace);

      const i = (row * width + col) * 4;
      albedo[i] = rgb.r * 255;
      albedo[i + 1] = rgb.g * 255;
      albedo[i + 2] = rgb.b * 255;
      albedo[i + 3] = 255;
      // The red channel carries bump height and the green channel carries roughness.
      details[i] = 48 + 152 * raised + 30 * pore;
      details[i + 1] = chicken ? 211 + 36 * pore : 156 + 70 * crevice + 23 * pore - 32 * fleck;
      details[i + 3] = 255;
    }
  }

  const map = foodDataTexture(albedo, width, height, THREE.SRGBColorSpace);
  const reliefMap = foodDataTexture(details, width, height, THREE.NoColorSpace);
  map.wrapT = reliefMap.wrapT = THREE.RepeatWrapping;
  return { map, reliefMap, contourAt };
}

function projectPattyCrust(material: THREE.MeshPhysicalMaterial) {
  // Cylindrical UVs stretch toward the center of the patty. Blend local projections
  // across its crust so the grain stays even on the face and along the edge.
  const varyings = 'varying vec3 vCrustPosition; varying vec3 vCrustNormal;';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + varyings)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrustPosition = position; vCrustNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        ${varyings}
        vec4 pattyCrustSample(sampler2D crustMap) {
          vec3 p = vCrustPosition * 0.41 + vec3(0.52, 0.18, 0.50);
          vec3 weight = pow(abs(normalize(vCrustNormal)), vec3(6.0));
          weight /= max(dot(weight, vec3(1.0)), 0.0001);
          return texture2D(crustMap, p.zy) * weight.x
               + texture2D(crustMap, p.xz) * weight.y
               + texture2D(crustMap, p.xy) * weight.z;
        }
      `)
      .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'pattyCrustSample( map )'))
      .replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment.replace('texture2D( roughnessMap, vRoughnessMapUv )', 'pattyCrustSample( roughnessMap )'))
      .replace('#include <bumpmap_pars_fragment>', THREE.ShaderChunk.bumpmap_pars_fragment.replace(
        /vec2 dHdxy_fwd\(\)\s*\{[\s\S]*?\n\s*\}/,
        `vec2 dHdxy_fwd() {
          float height = bumpScale * pattyCrustSample( bumpMap ).r;
          return vec2(dFdx(height), dFdy(height));
        }`,
      ));
  };
  return material;
}

function patty(id: string, height: number) {
  const group = new THREE.Group();
  const chicken = id === 'chicken';
  const smash = id === 'smash';
  const radius = chicken ? 1.20 : 1.26;
  const { map, reliefMap, contourAt } = pattyCrust(id);
  const segments = 112;
  const geometry = radialGeometry(smash ? smashProfile : pattyProfile, radius, height, smash ? 0.12 : 0.072, segments);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const radial = Math.hypot(x, z) / radius;
    const edge = THREE.MathUtils.smoothstep(radial, 0.45, 0.97);
    const noise = contourAt(0.37 * x + 0.68 * y + 0.52, 0.37 * z - 0.63 * y + 0.5) - 0.48;
    const puff = 1 + edge * noise * (smash || chicken ? 0.18 : 0.125);
    positions.setXYZ(i, x * puff, y + noise * edge * (chicken ? 0.073 : 0.048), z * puff);
  }
  smoothLatheNormals(geometry, segments);

  const sear = new THREE.Color('#8f7060');
  const color = new THREE.Color();
  tint(geometry, (x, y, z) => {
    const upperFace = THREE.MathUtils.smoothstep(y / height, 0.62, 0.94);
    const stripe = id === 'beef' ? Math.max(0, Math.cos(x * 13 + z * 7)) ** 7 * upperFace : 0;
    return color.setScalar(0.81 + upperFace * 0.19).lerp(sear, stripe * 0.76);
  });
  addMesh(group, geometry, projectPattyCrust(new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    map,
    bumpMap: reliefMap,
    roughnessMap: reliefMap,
    bumpScale: chicken ? 0.059 : 0.04,
    roughness: 0.95,
    clearcoat: chicken ? 0.04 : 0.15,
    clearcoatRoughness: 0.44,
  })));
  return group;
}

const meltedSlice: Point[] = [
  [0, 0.66], [0.32, 0.66], [0.56, 0.65], [0.72, 0.64], [0.84, 0.60], [0.92, 0.57], [0.97, 0.56], [0.992, 0.61],
  [1, 0.72], [0.993, 0.81], [0.971, 0.86], [0.92, 0.87], [0.84, 0.89], [0.72, 0.91], [0.56, 0.94], [0.32, 0.95], [0, 0.95],
];

function cheese(id: string, height: number) {
  const group = new THREE.Group();
  const cheddar = id === 'cheddar';
  const mozzarella = id === 'mozzarella';
  const extent = cheddar ? 1.075 : 1.02;
  const rotation = cheddar ? 0.97 : -0.21;
  const roundness = mozzarella ? 0.60 : 0.40;
  const segments = 112;
  const curve = new THREE.SplineCurve(meltedSlice.map(([radius, level]) => new THREE.Vector2(radius, level * height)));
  const profile = curve.getPoints(48);
  const geometry = new THREE.LatheGeometry(profile, segments);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const angle = Math.atan2(z, x);
    const radius = Math.hypot(x, z);
    const edge = THREE.MathUtils.smoothstep(radius, 0.58, 1);
    const wave = 1 + (Math.sin(angle * 3 + 1) * 0.030 + Math.cos(angle * 7 - 0.7) * 0.017 + Math.sin(angle * 13) * 0.009) * edge;
    const taper = extent * radius * wave;
    const shapeX = Math.sign(x) * (Math.abs(Math.cos(angle)) ** roundness) * taper;
    const shapeZ = Math.sign(z) * (Math.abs(Math.sin(angle)) ** roundness) * taper;
    const radiusFromCenter = Math.hypot(shapeX, shapeZ);
    const overhang = THREE.MathUtils.smoothstep(radiusFromCenter, 1.03, 1.36);
    const droop = cheddar ? 0.71 + 0.28 * Math.sin(angle - 0.65) + 0.15 * Math.sin(angle * 3) : 0.50;
    const wrinkle = 0.08 * Math.sin(angle * 5 - 2 * radius) * edge + 0.040 * Math.sin(shapeX * 10 + shapeZ * 4) * radius;
    const y = positions.getY(i) + height * (wrinkle - droop * overhang - Math.abs(Math.cos(angle + 0.8)) * edge * 0.09);
    positions.setXYZ(i, shapeX, y, shapeZ);
  }
  smoothLatheNormals(geometry, segments);
  const face = new THREE.Color(cheddar ? '#edab37' : mozzarella ? '#f1e2c1' : '#ead89c');
  const folds = new THREE.Color(cheddar ? '#c37323' : mozzarella ? '#d6b87c' : '#c4a56b');
  const shade = new THREE.Color();
  tint(geometry, (x, y, z) => {
    const rim = THREE.MathUtils.smoothstep(Math.hypot(x, z), 0.80, 1.35);
    const curl = 1 - THREE.MathUtils.smoothstep(y / height, 0.24, 0.86);
    const warmth = 0.96 + 0.04 * Math.sin(x * 7 + z * 5);
    return shade.copy(face).lerp(folds, rim * (0.29 + 0.46 * curl)).multiplyScalar(warmth);
  });
  addMesh(group, geometry, new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: cheddar ? 0.38 : 0.45,
    clearcoat: cheddar ? 0.29 : 0.17,
    clearcoatRoughness: 0.32,
  }));

  if (id === 'pepper-jack') {
    const random = randomFrom(82);
    const flecks: SurfaceDetail[] = [];
    const normals = geometry.getAttribute('normal');
    for (let i = 0; i < 32; i++) {
      const column = Math.floor((i * 0.61803398875 % 1) * segments);
      const row = 29 + Math.floor((1 - Math.sqrt(random())) * 17);
      const vertex = column * profile.length + row;
      const normal = new THREE.Vector3().fromBufferAttribute(normals, vertex).normalize();
      const position = new THREE.Vector3().fromBufferAttribute(positions, vertex).addScaledVector(normal, 0.001);
      flecks.push({ x: position.x, y: position.y, z: position.z, normal, width: 0.014 + random() * 0.012, height: 0.0035, depth: 0.011, angle: random() * tau, color: i % 2 ? '#4c6939' : '#913c2f' });
    }
    details(group, flecks, 0.76);
  }
  group.rotation.y = rotation;
  return group;
}

function lettuce(height: number) {
  const group = new THREE.Group();
  const material = foodSurface(0.55, grain('lettuce', 89, 52, 0.02), 0.013, THREE.DoubleSide);
  const colors = palette([[0, '#d7e48b'], [0.22, '#96bb45'], [0.51, '#6ca334'], [0.83, '#447d25'], [0.94, '#80ac34'], [1, '#a8c54c']]);
  const rings = 14;
  const sectors = 104;

  for (let layer = 0; layer < 2; layer++) {
    const positions: number[] = [];
    const indices: number[] = [];
    const vertexColors: number[] = [];
    const uvs: number[] = [];
    for (let ring = 0; ring <= rings; ring++) {
      const depth = ring / rings;
      for (let sector = 0; sector <= sectors; sector++) {
        const angle = sector / sectors * tau;
        const scallops = 0.1 * Math.sin(angle * 8 + layer * 2) + 0.038 * Math.sin(angle * 24 + layer) + 0.045 * Math.cos(angle * 3 - layer * 2);
        const radius = depth * (1.25 - 0.16 * layer + scallops);
        const x = Math.cos(angle) * radius + layer * 0.15;
        const z = Math.sin(angle) * radius - layer * 0.11;
        const fold = depth ** 2 * (Math.sin(angle * 10 + 1 + layer) * 0.26 + Math.cos(angle * 22 - layer) * 0.13);
        const curl = depth ** 5 * Math.sin(angle * 37 + layer) * 0.1;
        const y = height * (0.20 + layer * 0.38 + depth ** 2 * 0.14 + fold + curl);
        positions.push(x, y, z);
        uvs.push((1 + x / 1.4) * 0.5, (1 + z / 1.4) * 0.5);
        const vein = Math.max(0, Math.sin(8 * angle + 3 * depth + layer)) ** 19;
        const color = colors(depth).multiplyScalar(0.97 + 0.22 * vein + 0.12 * Math.sin(angle * 12 + 0.8) * depth);
        vertexColors.push(color.r, color.g, color.b);
        if (ring < rings && sector < sectors) {
          const a = ring * (sectors + 1) + sector;
          const b = a + sectors + 1;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    addMesh(group, geometry, material);
  }
  return group;
}

const sliceProfile: Point[] = [[0, 0.03], [0.59, 0.025], [0.91, 0.035], [0.98, 0.15], [1, 0.42], [1, 0.67], [0.965, 0.88], [0.86, 0.96], [0.65, 0.98], [0.36, 1], [0, 0.98]];

function tomato(height: number) {
  const group = new THREE.Group();
  const radius = 1.16;
  const geometry = radialGeometry(sliceProfile, radius, height, 0.05);
  const flesh = new THREE.Color('#d43c24');
  const skin = new THREE.Color('#b52312');
  const center = new THREE.Color('#df7551');
  const core = new THREE.Color('#ec9d72');
  const tintColor = new THREE.Color();
  tint(geometry, (x, y, z) => {
    const distance = Math.hypot(x, z) / radius;
    const angle = Math.atan2(z, x);
    const chambers = Math.max(0, Math.cos(angle * 6 + 0.2)) ** 4;
    const sheen = Math.max(0, 1 - Math.abs(distance - 0.53) * 3.1);
    const cut = y / height > 0.8;
    tintColor.copy(flesh);
    tintColor.lerp(skin, THREE.MathUtils.smoothstep(distance, 0.82, 0.99));
    if (cut) tintColor.lerp(center, chambers * sheen * 0.7).lerp(core, Math.max(0, 1 - distance * 5));
    return tintColor;
  });
  addMesh(group, geometry, foodSurface(0.28, grain('tomato', 34, 30, 0.008), 0.008));

  const random = randomFrom(472);
  const seeds: SurfaceDetail[] = [];
  for (let i = 0; i < 25; i++) {
    const angle = i % 6 / 6 * tau + (random() - 0.5) * 0.5;
    const radius = 0.31 + random() * 0.47;
    seeds.push({ x: Math.cos(angle) * radius, y: height * 0.993, z: Math.sin(angle) * radius, width: 0.022, height: 0.006, depth: 0.034, angle: random() * tau, color: i % 4 ? '#e8ae6d' : '#f3dbac' });
  }
  details(group, seeds, 0.42);
  return group;
}

const ringProfile: Point[] = [[0.74, 0.08], [0.89, 0], [0.985, 0.11], [1, 0.48], [0.98, 0.83], [0.91, 1], [0.74, 0.98], [0.675, 0.76], [0.675, 0.24], [0.74, 0.08]];

function slicedPepper(id: string, height: number) {
  const group = new THREE.Group();
  const pickle = id === 'pickle';
  const count = pickle ? 5 : 6;
  const random = randomFrom(pickle ? 624 : 384);
  const texture = grain(id, pickle ? 75 : 29, pickle ? 71 : 42, 0.032);
  const material = foodSurface(pickle ? 0.35 : 0.42, texture, 0.012);
  const shade = new THREE.Color();
  const edge = new THREE.Color(pickle ? '#557a24' : '#32752e');
  const face = new THREE.Color(pickle ? '#aec565' : '#789d46');
  const strip = new THREE.Color(pickle ? '#d2cf83' : '#bccb79');
  const grains: SurfaceDetail[] = [];

  for (let i = 0; i < count; i++) {
    const angle = i / count * tau + 0.23;
    const radius = pickle ? 0.43 : 0.31 + 0.055 * random();
    const x = Math.cos(angle) * (pickle ? 0.77 : 0.89);
    const z = Math.sin(angle) * (pickle ? 0.77 : 0.89);
    const y = (i % 2) * height * 0.19;
    const thickness = height * (pickle ? 0.80 : 0.70);
    const geometry = radialGeometry(pickle ? sliceProfile : ringProfile, radius, thickness, pickle ? 0.09 : 0.06, 30);
    tint(geometry, (x, y, z) => {
      const distance = Math.hypot(x, z) / radius;
      const skin = THREE.MathUtils.smoothstep(distance, 0.82, 0.99);
      const ray = Math.atan2(z, x);
      const inner = Math.max(0, 1 - Math.abs(distance - (pickle ? 0.37 : 0.71)) * 5);
      shade.copy(face).lerp(edge, skin).lerp(strip, inner * 0.8);
      return shade.multiplyScalar(1 + 0.1 * Math.sin(ray * 10) * (0.3 + y / thickness));
    });
    const slice = addMesh(group, geometry, material);
    slice.position.set(x, y, z);
    slice.rotation.y = angle;
    slice.scale.z = pickle ? 0.86 : 0.91;

    for (let j = 0; j < (pickle ? 6 : 2); j++) {
      const direction = random() * tau;
      const distance = radius * (pickle ? 0.22 + random() * 0.27 : 0.69 + random() * 0.1);
      grains.push({ x: x + Math.cos(direction) * distance, y: y + thickness * 0.98, z: z + Math.sin(direction) * distance * 0.9, width: 0.015, height: 0.006, depth: 0.027, angle: direction, color: '#dfd6a4' });
    }
  }
  details(group, grains, 0.63);
  return group;
}

const onionRing: Point[] = [[0.83, 0.08], [0.91, 0.01], [0.98, 0.08], [1, 0.34], [1, 0.73], [0.95, 1], [0.86, 0.96], [0.82, 0.72], [0.81, 0.35], [0.83, 0.08]];

function onion(height: number) {
  const group = new THREE.Group();
  const texture = grain('onion', 87, 33, 0.008);
  const material = foodSurface(0.47, texture, 0.009);
  const purple = new THREE.Color('#772456');
  const white = new THREE.Color('#ead2dc');
  const edge = new THREE.Color('#bd7b9f');
  const color = new THREE.Color();
  const rings = [[-0.37, 0.22, 0.82], [0.51, -0.26, 0.66], [0.52, 0.34, 0.54], [-0.39, 0.22, 0.60], [-0.46, 0.19, 0.44], [0.55, -0.28, 0.45]];
  rings.forEach(([x, z, radius], i) => {
    const thickness = height * (0.58 + i % 2 * 0.15);
    const geometry = radialGeometry(onionRing, radius, thickness, 0.035, 42);
    tint(geometry, (vx, y, vz) => {
      const rim = THREE.MathUtils.smoothstep(Math.hypot(vx, vz) / radius, 0.86, 0.995);
      color.copy(white).lerp(edge, rim * 0.54).lerp(purple, rim ** 4 * (y / thickness < 0.85 ? 0.95 : 0.4));
      return color;
    });
    const mesh = addMesh(group, geometry, material);
    mesh.position.set(x, (i % 3) * height * 0.17, z);
    mesh.scale.z = 0.87 + i % 3 * 0.07;
    mesh.rotation.y = i * 0.71;
  });
  return group;
}

const sauceColors: Readonly<Record<string, string>> = {
  'burger-sauce': '#d67442',
  bbq: '#682712',
  'spicy-mayo': '#eb8d57',
  'cheese-sauce': '#f1a221',
};

function sauce(id: string, height: number) {
  const group = new THREE.Group();
  const color = sauceColors[id];
  const material = new THREE.MeshPhysicalMaterial({ color, roughness: 0.29, clearcoat: 0.52, clearcoatRoughness: 0.19 });
  addMesh(group, radialGeometry(sliceProfile, 1.07, height * 0.49, 0.23, 52), material);

  const points: THREE.Vector3[] = [];
  for (let i = 0; i < 58; i++) {
    const fraction = i / 57;
    const angle = fraction * 9.2;
    const radius = 0.15 + fraction * 1.04 + 0.08 * Math.sin(angle * 2.1);
    points.push(new THREE.Vector3(Math.cos(angle) * radius, height * 0.62 + Math.cos(angle * 2) * 0.006, Math.sin(angle) * radius));
  }
  const swirl = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 70, 0.074, 10, false);
  swirl.scale(1, 0.38, 1);
  swirl.translate(0, height * 0.30, 0);
  addMesh(group, swirl, material);

  const puddles: SurfaceDetail[] = [
    { x: 1.11, y: height * 0.26, z: -0.22, width: 0.17, height: 0.022, depth: 0.15, color },
    { x: -0.26, y: height * 0.23, z: -1.04, width: 0.20, height: 0.018, depth: 0.19, color },
    { x: 0.61, y: height * 0.33, z: 0.93, width: 0.23, height: 0.024, depth: 0.16, color },
    { x: -1.08, y: height * 0.25, z: 0.44, width: 0.15, height: 0.02, depth: 0.13, color },
  ];
  for (const point of [points[0], points[points.length - 1]]) {
    puddles.push({ x: point.x, y: point.y * 0.38 + height * 0.3, z: point.z, width: 0.08, height: 0.028, depth: 0.08, color });
  }
  details(group, puddles, 0.28);
  return group;
}

function friedOnion(height: number) {
  const group = new THREE.Group();
  const texture = grain('fried-onion', 742, 94, 0.04);
  const material = foodSurface(0.77, texture, 0.018);
  const colors = palette([[0, '#733416'], [0.27, '#a15924'], [0.58, '#d2883b'], [0.85, '#e6ad59'], [1, '#be6e29']]);
  const random = randomFrom(827);
  for (let strip = 0; strip < 7; strip++) {
    const centerAngle = strip / 7 * tau;
    const centerRadius = 0.62 + random() * 0.23;
    const x = Math.cos(centerAngle) * centerRadius;
    const z = Math.sin(centerAngle) * centerRadius;
    const curl = 0.30 + random() * 0.25;
    const length = 2.9 + random() * 1.78;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 17; i++) {
      const fraction = i / 17;
      const angle = fraction * length + centerAngle;
      const r = curl + 0.035 * Math.sin(angle * 4);
      points.push(new THREE.Vector3(x + Math.cos(angle) * r, height * (0.27 + 0.29 * (strip % 2) + 0.15 * Math.sin(angle * 3)), z + Math.sin(angle) * r));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 26, 0.054, 8, false);
    tint(tube, (x, y, z) => colors(y / height).multiplyScalar(1 + 0.16 * Math.sin(x * 39 + z * 14) * Math.cos(z * 28)));
    addMesh(group, tube, material);
  }
  return group;
}

function grilledMushroom(height: number) {
  const group = new THREE.Group();
  const family = new THREE.Group();
  const texture = grain('grilled-mushroom', 75, 123, 0.027);
  const face = new THREE.Shape();
  face.moveTo(-0.13, -0.42);
  face.quadraticCurveTo(-0.20, -0.23, -0.15, -0.05);
  face.bezierCurveTo(-0.50, -0.08, -0.57, 0.12, -0.43, 0.24);
  face.bezierCurveTo(-0.27, 0.50, 0.22, 0.45, 0.41, 0.29);
  face.bezierCurveTo(0.61, 0.11, 0.48, -0.11, 0.14, -0.055);
  face.quadraticCurveTo(0.15, -0.25, 0.09, -0.43);
  face.quadraticCurveTo(-0.017, -0.49, -0.13, -0.42);
  const geometry = new THREE.ExtrudeGeometry(face, { depth: height * 0.54, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.022, bevelThickness: 0.019, curveSegments: 7 });
  geometry.rotateX(-Math.PI / 2);
  const edge = new THREE.Color('#784525');
  const core = new THREE.Color('#dbc18e');
  const tintColor = new THREE.Color();
  tint(geometry, (x, y, z) => {
    const distance = THREE.MathUtils.clamp(Math.hypot(x, z * 0.6) * 1.65, 0.18, 0.98);
    return tintColor.copy(core).lerp(edge, distance * (y > height * 0.42 ? 0.83 : 1)).multiplyScalar(1 + 0.13 * Math.sin(x * 15 - z * 10));
  });
  addMesh(family, geometry, foodSurface(0.63, texture, 0.008));

  const spokes: SurfaceDetail[] = [];
  for (let i = -4; i <= 4; i++) {
    spokes.push({ x: i * 0.071, y: height * 0.54 + 0.019, z: -0.132, width: 0.008, height: 0.005, depth: 0.124 - Math.abs(i) * 0.011, angle: -i * 0.14, color: i % 2 ? '#a57542' : '#b28855' });
  }
  details(family, spokes, 0.82);

  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * tau + 0.24;
    const mushroom = family.clone(true);
    mushroom.position.set(Math.cos(angle) * 0.71, (i % 3) * height * 0.107, Math.sin(angle) * 0.71);
    mushroom.rotation.y = -angle + 0.7 * i;
    mushroom.scale.setScalar(0.91 + (i % 2) * 0.13);
    group.add(mushroom);
  }
  return group;
}

function friedEgg(height: number) {
  const group = new THREE.Group();
  const edge = new THREE.Color('#c89148');
  const albumen = new THREE.Color('#fff0c9');
  const eggColor = new THREE.Color();
  const white = radialGeometry(sliceProfile, 1.17, height * 0.40, 0.20);
  tint(white, (x, y, z) => {
    const shell = THREE.MathUtils.smoothstep(Math.hypot(x, z), 0.94, 1.25);
    const toasted = y > height * 0.28 ? 0.43 : 0.9;
    return eggColor.copy(albumen).lerp(edge, shell * toasted).multiplyScalar(1 + 0.07 * Math.sin(x * 12 + z * 8));
  });
  addMesh(group, white, foodSurface(0.49, grain('egg', 274, 38, 0.016), 0.01));

  const yolkShape: Point[] = [[0, 0.04], [0.78, 0.03], [0.96, 0.16], [1, 0.34], [0.88, 0.60], [0.67, 0.83], [0.36, 0.96], [0, 1]];
  const yolk = coloredRadial(yolkShape, 0.38, height * 0.75, 0.04, [[0, '#ea9f1f'], [0.33, '#f8ac19'], [0.7, '#efa527'], [1, '#ffbb2b']], 42);
  const mesh = addMesh(group, yolk, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 0.40, clearcoatRoughness: 0.20 }));
  mesh.position.set(0.19, height * 0.30, -0.09);
  return group;
}

const recipe: Readonly<Record<string, { height: number; contactLevel?: number; build: (height: number) => THREE.Group }>> = {
  'brioche-top': { height: buns.brioche.topHeight, build: (h) => bun('brioche', true, h) },
  'sesame-top': { height: buns.sesame.topHeight, build: (h) => bun('sesame', true, h) },
  'potato-top': { height: buns.potato.topHeight, build: (h) => bun('potato', true, h) },
  'brioche-bottom': { height: buns.brioche.bottomHeight, build: (h) => bun('brioche', false, h) },
  'sesame-bottom': { height: buns.sesame.bottomHeight, build: (h) => bun('sesame', false, h) },
  'potato-bottom': { height: buns.potato.bottomHeight, build: (h) => bun('potato', false, h) },
  smash: { height: fillings.smash.height, build: (h) => patty('smash', h) },
  beef: { height: fillings.beef.height, build: (h) => patty('beef', h) },
  chicken: { height: fillings.chicken.height, build: (h) => patty('chicken', h) },
  'mushroom-patty': { height: fillings['mushroom-patty'].height, build: (h) => patty('mushroom-patty', h) },
  cheddar: { height: fillings.cheddar.height, contactLevel: 0.60, build: (h) => cheese('cheddar', h) },
  mozzarella: { height: fillings.mozzarella.height, build: (h) => cheese('mozzarella', h) },
  'pepper-jack': { height: fillings['pepper-jack'].height, build: (h) => cheese('pepper-jack', h) },
  lettuce: { height: fillings.lettuce.height, build: lettuce },
  tomato: { height: fillings.tomato.height, build: tomato },
  pickle: { height: fillings.pickle.height, build: (h) => slicedPepper('pickle', h) },
  onion: { height: fillings.onion.height, build: onion },
  jalapeno: { height: fillings.jalapeno.height, build: (h) => slicedPepper('jalapeno', h) },
  'burger-sauce': { height: fillings['burger-sauce'].height, build: (h) => sauce('burger-sauce', h) },
  bbq: { height: fillings.bbq.height, build: (h) => sauce('bbq', h) },
  'spicy-mayo': { height: fillings['spicy-mayo'].height, build: (h) => sauce('spicy-mayo', h) },
  'cheese-sauce': { height: fillings['cheese-sauce'].height, build: (h) => sauce('cheese-sauce', h) },
  'fried-onion': { height: fillings['fried-onion'].height, build: friedOnion },
  'grilled-mushroom': { height: fillings['grilled-mushroom'].height, build: grilledMushroom },
  egg: { height: fillings.egg.height, build: friedEgg },
};

export function getIngredientModel(id: string): THREE.Group {
  const cached = models.get(id);
  if (cached) return cached.clone(true);

  const root = new THREE.Group();
  root.name = id;
  if (!Object.hasOwn(recipe, id)) return root;

  const { height, contactLevel, build } = recipe[id];
  const model = build(height);
  const box = new THREE.Box3().setFromObject(model);
  // A melted corner can hang below the center where the slice rests.
  const contact = contactLevel === undefined ? box.min.y : contactLevel * height;
  model.scale.y = height / (box.max.y - contact);
  model.position.y = -contact * model.scale.y;
  root.add(model);
  models.set(id, root);
  return root.clone(true);
}
