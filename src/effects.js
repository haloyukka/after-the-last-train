import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// 濡れた路面
// Three.js 付属の Reflector（街を上下反転して描いた画像を地面に貼る仕組み）に、
// 独自のシェーダーを渡して「水たまり・アスファルトのざらつき・雨の波紋・灯りの照り返し」を足す。
// ---------------------------------------------------------------------------

const groundShader = {
  name: 'WetRoadShader',

  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uCameraPosition: { value: new THREE.Vector3() },
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0.02 },
    uLanternPosition: { value: new THREE.Vector3() },
    uLanternColor: { value: new THREE.Color() },
    uRipple: { value: 1 },
  },

  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;

    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec3 uCameraPosition;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform vec3 uLanternPosition;
    uniform vec3 uLanternColor;
    uniform float uRipple;
    varying vec4 vUv;
    varying vec3 vWorld;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    vec2 hash2(vec2 p) {
      return vec2(hash(p), hash(p + 17.17));
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    float fbm(vec2 p) {
      return noise(p) * 0.6 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 + 9.1) * 0.1;
    }

    // 雨粒が落ちてできる波紋。マス目ごとに1つ、時間をずらして広がる輪を作り、
    // 輪の位置で反射をずらす向き（中心から外向き）を返す。
    vec2 ripple(vec2 p, float cell, float speed) {
      vec2 id = floor(p / cell);
      vec2 local = fract(p / cell) - 0.5;
      vec2 center = (hash2(id) - 0.5) * 0.4;
      float t = fract(uTime * speed + hash(id + 3.1));
      vec2 d = local - center;
      float dist = length(d);
      float radius = t * 0.3;
      float ring = smoothstep(0.035, 0.0, abs(dist - radius)) * (1.0 - t);
      return (d / max(dist, 0.001)) * ring;
    }

    void main() {
      vec2 ground = vWorld.xz;
      float distanceToCamera = distance(vWorld, uCameraPosition);

      // 水たまり（1に近いほど鏡のように映る）とアスファルトのざらつき
      float puddle = smoothstep(0.42, 0.62, fbm(ground * 0.22));
      float grain = noise(ground * 16.0);

      // 反射をずらす量：水たまりは波紋、それ以外はざらつきで乱す
      float near = smoothstep(45.0, 8.0, distanceToCamera);
      vec2 rings = (ripple(ground, 0.55, 0.9) + ripple(ground + 7.3, 0.8, 0.7)) * uRipple * near;
      vec2 offset = rings * 0.012 * mix(0.35, 1.0, puddle)
        + (vec2(grain, noise(ground * 16.0 + 5.0)) - 0.5) * 0.007 * (1.0 - puddle);

      // 反射を縦方向に少しぼかす（濡れた路面で光が縦に伸びる見え方）
      vec2 uv = vUv.xy / vUv.w + offset;
      float streak = mix(0.014, 0.003, puddle);
      vec3 reflection = texture2D(tDiffuse, uv).rgb * 0.3;
      reflection += texture2D(tDiffuse, uv + vec2(0.0, streak)).rgb * 0.22;
      reflection += texture2D(tDiffuse, uv - vec2(0.0, streak)).rgb * 0.22;
      reflection += texture2D(tDiffuse, uv + vec2(0.0, streak * 2.2)).rgb * 0.13;
      reflection += texture2D(tDiffuse, uv - vec2(0.0, streak * 2.2)).rgb * 0.13;

      // 浅い角度で見るほど強く映る
      vec3 viewDirection = normalize(uCameraPosition - vWorld);
      float fresnel = mix(0.3, 1.0, pow(1.0 - max(viewDirection.y, 0.0), 2.5));
      float wetness = mix(0.4, 1.0, puddle);

      // 歩行者の灯りが足元を照らす
      vec3 toLantern = uLanternPosition - vWorld;
      float lanternDistance = length(toLantern);
      float lanternLight = max(toLantern.y / lanternDistance, 0.0) / (1.0 + lanternDistance * lanternDistance * 0.35);
      vec3 asphalt = color * mix(0.7, 1.0, grain) * mix(1.0, 0.55, puddle);
      vec3 lit = asphalt * (vec3(0.04, 0.045, 0.06) + uLanternColor * lanternLight * 3.2);

      vec3 result = lit + reflection * wetness * fresnel;

      // 霧
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * distanceToCamera * distanceToCamera);
      result = mix(result, uFogColor, fog);

      gl_FragColor = vec4(result, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

export function createWetGround({ size = 800, center = new THREE.Vector3(), color = 0x1a1c22 } = {}) {
  const ground = new Reflector(new THREE.PlaneGeometry(size, size), {
    color,
    textureWidth: 512,
    textureHeight: 512,
    clipBias: 0.003,
    shader: groundShader,
  });
  ground.rotation.x = -Math.PI / 2;
  ground.position.copy(center);

  const uniforms = ground.material.uniforms;

  return {
    mesh: ground,
    // 反射用の画像の解像度。画面の半分程度で十分（にじませて使うため）
    setSize(width, height) {
      ground.getRenderTarget().setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    },
    update({ time, camera, fog, lanternPosition, lanternColor }) {
      uniforms.uTime.value = time;
      uniforms.uCameraPosition.value.copy(camera.position);
      uniforms.uFogColor.value.copy(fog.color);
      uniforms.uFogDensity.value = fog.density;
      uniforms.uLanternPosition.value.copy(lanternPosition);
      uniforms.uLanternColor.value.copy(lanternColor);
    },
  };
}

// ---------------------------------------------------------------------------
// 雨
// カメラの周りの箱の中だけに細い線を降らせる。位置の計算はすべてシェーダー側で行い、
// 箱から出た雨粒は反対側から入り直すので、歩き続けても雨が途切れない。
// ---------------------------------------------------------------------------

export function createRain({ count = 3500, box = new THREE.Vector3(30, 14, 30) } = {}) {
  const positions = new Float32Array(count * 2 * 3);
  const ends = new Float32Array(count * 2);
  const speeds = new Float32Array(count * 2);

  for (let i = 0; i < count; i += 1) {
    const x = Math.random();
    const y = Math.random();
    const z = Math.random();
    const speed = 0.8 + Math.random() * 0.4;
    for (let v = 0; v < 2; v += 1) {
      const k = (i * 2 + v) * 3;
      positions[k] = x;
      positions[k + 1] = y;
      positions[k + 2] = z;
      ends[i * 2 + v] = v;
      speeds[i * 2 + v] = speed;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uBox: { value: box },
      uCenter: { value: new THREE.Vector3() },
      uLanternPosition: { value: new THREE.Vector3() },
      uLanternColor: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */ `
      attribute float aEnd;
      attribute float aSpeed;
      uniform float uTime;
      uniform vec3 uBox;
      uniform vec3 uCenter;
      uniform vec3 uLanternPosition;
      varying float vAlpha;
      varying float vLantern;

      void main() {
        vec3 p = position * uBox;
        p.y = mod(p.y - uTime * 13.0 * aSpeed, uBox.y);
        vec3 world = vec3(
          mod(p.x - uCenter.x, uBox.x) - uBox.x * 0.5 + uCenter.x,
          p.y,
          mod(p.z - uCenter.z, uBox.z) - uBox.z * 0.5 + uCenter.z
        );
        // 線のもう一方の端。少し傾けて風を感じさせる
        world.y += aEnd * 0.45;
        world.x += aEnd * 0.04;

        vec4 view = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * view;

        float distanceToCamera = length(view.xyz);
        vAlpha = (1.0 - aEnd) * smoothstep(1.0, 4.0, distanceToCamera) * smoothstep(16.0, 9.0, distanceToCamera);
        float lanternDistance = distance(world, uLanternPosition);
        vLantern = 1.0 / (1.0 + lanternDistance * lanternDistance * 0.25);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uLanternColor;
      varying float vAlpha;
      varying float vLantern;

      void main() {
        vec3 rain = vec3(0.5, 0.58, 0.75) * 0.22 + uLanternColor * vLantern * 0.9;
        gl_FragColor = vec4(rain * vAlpha, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;

  return {
    mesh: lines,
    update({ time, camera, lanternPosition, lanternColor }) {
      material.uniforms.uTime.value = time;
      material.uniforms.uCenter.value.copy(camera.position);
      material.uniforms.uLanternPosition.value.copy(lanternPosition);
      material.uniforms.uLanternColor.value.copy(lanternColor);
    },
  };
}

// ---------------------------------------------------------------------------
// 光のにじみ（ブルーム）
// 明るい部分だけを取り出してぼかし、元の絵に重ねる後処理。
// ---------------------------------------------------------------------------

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 0.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return {
    bloom,
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    },
    render() {
      composer.render();
    },
  };
}
