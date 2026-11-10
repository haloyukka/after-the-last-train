import * as THREE from 'three';
import { AREAS, createPath } from './path.js';
import { createRandom } from './random.js';
import * as neon from './areas/neon.js';
import * as houses from './areas/houses.js';
import * as rails from './areas/rails.js';

const WALK_SPEED = 2.8; // 歩く速さ（m/秒）。一周およそ4〜5分
const EYE_HEIGHT = 1.6; // カメラの高さ（m）
const LOOK_AHEAD = 6; // 視線を向ける先までの距離（m）
const BLEND_BAND = 0.02; // エリアの境目で霧と背景色を混ぜる幅（道筋に対する割合）
const SEED = 20261110; // 街並みの乱数の種。変えると別の街になる

const AREA_MODULES = { neon, houses, rails };

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const startButton = document.getElementById('start');
const message = document.getElementById('message');

function showError(text) {
  startButton.hidden = true;
  message.hidden = false;
  message.textContent = text;
}

function createRenderer() {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);

  // 全体をうっすら照らす夜空の光と、歩行者の灯りの代わりになる手元の光
  scene.add(new THREE.HemisphereLight(0x2a3555, 0x06060a, 2.2));
  const lantern = new THREE.PointLight(0xffcf8a, 110, 30, 2);
  scene.add(lantern);

  // 地面
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshLambertMaterial({ color: 0x0b0c11 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(100, 0, -80);
  scene.add(ground);

  // 道筋と3つのエリア
  const path = createPath();
  const random = createRandom(SEED);
  const areas = AREAS.map((area) => ({
    area,
    look: AREA_MODULES[area.id].look,
    instance: AREA_MODULES[area.id].build({ scene, path, area, random }),
  }));

  // 現在地に応じた背景色と霧。エリアの境目では前後の値をなめらかに混ぜる
  const colorA = new THREE.Color();
  const colorB = new THREE.Color();
  function applyLook(u) {
    const index = areas.findIndex(({ area }) => u >= area.from && u < area.to);
    const current = areas[Math.max(index, 0)];
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
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // 毎フレームの更新
  // 道筋上の現在位置（0〜1）。確認用に ?u=0.5 のようにURLで開始位置を指定できる
  let u = path.wrap(Number(new URLSearchParams(window.location.search).get('u')) || 0);
  let walking = false;
  let elapsed = 0;
  let previous = performance.now();
  const position = new THREE.Vector3();
  const target = new THREE.Vector3();

  function frame(now) {
    // タブが裏に回っていた間の時間を一気に進めないよう、1フレームの上限を設ける
    const delta = Math.min((now - previous) / 1000, 0.1);
    previous = now;
    elapsed += delta;

    if (walking) {
      u = path.wrap(u + (WALK_SPEED * delta) / path.length);
    }

    path.pointAt(u, position);
    path.pointAt(u + LOOK_AHEAD / path.length, target);
    camera.position.set(position.x, EYE_HEIGHT, position.z);
    camera.lookAt(target.x, EYE_HEIGHT - 0.1, target.z);
    lantern.position.set(position.x, EYE_HEIGHT - 0.4, position.z);

    applyLook(u);
    for (const { instance } of areas) instance.update(elapsed);

    renderer.render(scene, camera);
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
