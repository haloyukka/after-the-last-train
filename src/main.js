import * as THREE from 'three';
import { AREAS, createPath } from './path.js';
import { createRandom } from './random.js';
import { addUnderpass, createBoxBatch, createMaterials } from './street.js';
import { createWalker } from './walker.js';
import { createComposer, createRain, createWetGround } from './effects.js';
import * as neon from './areas/neon.js';
import * as houses from './areas/houses.js';
import * as rails from './areas/rails.js';

const WALK_SPEED = 2.8; // 歩く速さ（m/秒）。一周およそ4〜5分
const CAMERA_BEHIND = 3.4; // カメラが歩行者の後ろにつく距離（m）
const CAMERA_HEIGHT = 2.0; // カメラの高さ（m）
const CAMERA_SIDE = 0.55; // カメラを道の右へ寄せる量（m）。歩行者の肩越しに前が見える
const LOOK_AHEAD = 5; // 歩行者の何m先を見るか
const BLEND_BAND = 0.02; // エリアの境目で霧と背景色を混ぜる幅（道筋に対する割合）
const SEED = 20261110; // 街並みの乱数の種。変えると別の街になる
const MAX_PIXEL_RATIO = 2;

const AREA_MODULES = { neon, houses, rails };

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const startButton = document.getElementById('start');
const message = document.getElementById('message');

// 端末の「視差効果を減らす」設定。有効なら揺れと明滅を抑える
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function showError(text) {
  startButton.hidden = true;
  message.hidden = false;
  message.textContent = text;
}

function createRenderer() {
  try {
    // 後処理（にじみ）を通すので、描画側のアンチエイリアスは使わない
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    // 色の鮮やかさを保ったまま、明るすぎる部分だけをなだらかに抑える
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    return renderer;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function init() {
  const renderer = createRenderer();
  if (!renderer) {
    showError('この端末またはブラウザでは WebGL が使えないため、表示できません。');
    return;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(neon.look.background);
  scene.fog = new THREE.FogExp2(neon.look.background, neon.look.fogDensity);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400);

  // 全体をうっすら照らす夜空の光
  scene.add(new THREE.HemisphereLight(0x3a4670, 0x08080c, 0.9));

  // 道筋と3つのエリア
  const path = createPath();
  const random = createRandom(SEED);
  const areas = AREAS.map((area) => ({
    area,
    look: AREA_MODULES[area.id].look,
    instance: AREA_MODULES[area.id].build({ scene, path, area, random, reducedMotion }),
  }));

  // エリアの境目ごとに、道をまたぐ高架を置く
  const underpasses = createBoxBatch(createMaterials().solid);
  for (const area of AREAS) addUnderpass(underpasses, path, area.from);
  scene.add(underpasses.build());

  // 歩行者、濡れた路面、雨
  const walker = createWalker();
  scene.add(walker.group);

  const ground = createWetGround({ center: new THREE.Vector3(100, 0, -80) });
  scene.add(ground.mesh);

  const rain = createRain();
  scene.add(rain.mesh);

  const composer = createComposer(renderer, scene, camera);

  // 現在地に応じた背景色と霧。エリアの境目では前後の値をなめらかに混ぜる
  const colorA = new THREE.Color();
  const colorB = new THREE.Color();
  function applyLook(u) {
    const index = Math.max(areas.findIndex(({ area }) => u >= area.from && u < area.to), 0);
    const current = areas[index];
    const span = current.area.to - current.area.from;
    const band = Math.min(BLEND_BAND, span / 2);
    const fromStart = u - current.area.from;
    const toEnd = current.area.to - u;

    let other = current;
    let mix = 0;
    if (toEnd < band) {
      other = areas[(index + 1) % areas.length];
      mix = 0.5 * (1 - toEnd / band);
    } else if (fromStart < band) {
      other = areas[(index - 1 + areas.length) % areas.length];
      mix = 0.5 * (1 - fromStart / band);
    }

    colorA.set(current.look.background);
    colorB.set(other.look.background);
    colorA.lerp(colorB, mix);
    scene.background.copy(colorA);
    scene.fog.color.copy(colorA);
    scene.fog.density = THREE.MathUtils.lerp(current.look.fogDensity, other.look.fogDensity, mix);
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer.setSize(width, height, pixelRatio);
    ground.setSize(width * pixelRatio * 0.5, height * pixelRatio * 0.5);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // 毎フレームの更新
  // 道筋上の現在位置（0〜1）。確認用に ?u=0.5 のようにURLで開始位置を指定できる
  let u = path.wrap(Number(new URLSearchParams(window.location.search).get('u')) || 0);
  let walking = false;
  let speed = 0; // 現在の歩く速さ（m/秒）。歩き出しと立ち止まりをなめらかにする
  let elapsed = 0;
  let previous = performance.now();
  const position = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const right = new THREE.Vector3();
  const behind = new THREE.Vector3();
  const ahead = new THREE.Vector3();

  function frame(now) {
    // タブが裏に回っていた間の時間を一気に進めないよう、1フレームの上限を設ける
    const delta = Math.min((now - previous) / 1000, 0.1);
    previous = now;
    elapsed += delta;

    // エリア側から「ここでは立ち止まる」という指示（踏切の電車待ち）があれば従う
    let limit = 1;
    for (const { instance } of areas) {
      if (instance.speedLimit) limit = Math.min(limit, instance.speedLimit(u));
    }
    speed = THREE.MathUtils.damp(speed, walking ? WALK_SPEED * limit : 0, 4, delta);
    const distance = speed * delta;
    u = path.wrap(u + distance / path.length);

    // 歩行者
    path.pointAt(u, position);
    path.tangentAt(u, tangent);
    walker.update({
      position,
      yaw: Math.atan2(tangent.x, tangent.z),
      distance,
      time: elapsed,
      sway: reducedMotion ? 0 : 1,
    });
    walker.group.updateMatrixWorld(true);
    const lanternPosition = walker.getLanternPosition();

    // カメラ：歩行者の後ろ上から、少し先を見る
    const behindU = u - CAMERA_BEHIND / path.length;
    path.pointAt(behindU, behind);
    path.rightAt(behindU, right);
    path.pointAt(u + LOOK_AHEAD / path.length, ahead);
    camera.position.set(behind.x + right.x * CAMERA_SIDE, CAMERA_HEIGHT, behind.z + right.z * CAMERA_SIDE);
    camera.lookAt(ahead.x, 1.35, ahead.z);

    applyLook(u);
    for (const { instance } of areas) instance.update(elapsed, { u, delta, walkSpeed: WALK_SPEED });

    const shared = { time: elapsed, camera, lanternPosition, lanternColor: walker.lanternColor };
    ground.update({ ...shared, fog: scene.fog });
    rain.update(shared);

    composer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 開始ボタン
  startButton.disabled = false;
  startButton.textContent = 'はじめる';
  startButton.addEventListener('click', () => {
    walking = true;
    overlay.classList.add('is-hidden');
  }, { once: true });
}

init();
