import * as THREE from 'three';
import { AREAS, createPath } from './path.js';
import { createRandom } from './random.js';
import { addUnderpass, createBoxBatch, createMaterials } from './street.js';
import { createWalker } from './walker.js';
import { createComposer, createRain, createWetGround } from './effects.js';
import { createAudio } from './audio.js';
import { createControls } from './controls.js';
import { createQuality } from './quality.js';
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
const HINT_SECONDS = 7; // 開始直後に操作ヒントを出しておく時間

const AREA_MODULES = { neon, houses, rails };

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const startButton = document.getElementById('start');
const soundButton = document.getElementById('sound');
const helpButton = document.getElementById('help');
const hint = document.getElementById('hint');
const message = document.getElementById('message');

// 端末の「視差効果を減らす」設定。有効なら揺れと明滅を抑える
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// 指で操作する端末かどうか（操作ヒントの文面を切り替える）
const touchDevice = window.matchMedia('(pointer: coarse)').matches;

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

  // 画質。重いと判断したら自動で1段階ずつ下がり、そのたびに applyQuality が呼ばれる
  let fogScale = 1;
  function applyQuality(settings, level) {
    canvas.dataset.quality = level; // 確認用：いまの画質を開発者ツールから見られるようにする
    fogScale = settings.fog;
    ground.setReflection(settings.reflection);
    ground.setRipple(reducedMotion ? 0 : settings.ripple);
    rain.setCount(settings.rain);
    composer.bloom.enabled = settings.bloom;
    resize();
  }
  const quality = createQuality(applyQuality);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const settings = quality.settings;
    const pixelRatio = Math.min(window.devicePixelRatio, settings.pixelRatio);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer.setSize(width, height, pixelRatio);
    ground.setSize(width * pixelRatio * settings.reflectionScale, height * pixelRatio * settings.reflectionScale);
    camera.aspect = width / height;
    // 縦長の画面では左右が狭くなるので、視野を広げて街並みが入るようにする
    camera.fov = camera.aspect < 1 ? 74 : 58;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  applyQuality(quality.settings, quality.level);

  // 音。前回の「音を切る」設定を覚えておく（保存できない環境では毎回「入」から始まる）
  const audio = createAudio();
  const railsSound = areas.find(({ area }) => area.id === 'rails').instance.sound;
  const weights = { neon: 1, houses: 0, rails: 0 };
  const MUTE_KEY = 'after-the-last-train:muted';
  try {
    audio.setMuted(window.localStorage.getItem(MUTE_KEY) === '1');
  } catch {
    // 保存領域が使えなくても動作に支障はない
  }
  const showMuted = () => {
    soundButton.dataset.muted = String(audio.muted);
    soundButton.setAttribute('aria-label', audio.muted ? '音を入れる' : '音を切る');
  };
  showMuted();
  soundButton.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    showMuted();
    try {
      window.localStorage.setItem(MUTE_KEY, audio.muted ? '1' : '0');
    } catch {
      // 同上
    }
  });
  document.addEventListener('visibilitychange', () => audio.setSuspended(document.hidden));

  // 操作と、操作ヒント
  const controls = createControls(canvas);
  hint.textContent = touchDevice
    ? '横スワイプで見回す ・ 縦スワイプで速さ ・ 長押しで立ち止まる ・ 画面の端をタップで左右に寄る'
    : 'ドラッグで見回す ・ ↑↓で速さ ・ ←→で左右に寄る ・ スペースで立ち止まる';
  let hintTimer = 0;
  function showHint(seconds) {
    window.clearTimeout(hintTimer);
    hint.classList.add('is-visible');
    if (seconds) hintTimer = window.setTimeout(() => hint.classList.remove('is-visible'), seconds * 1000);
  }
  helpButton.addEventListener('click', () => {
    if (hint.classList.contains('is-visible')) {
      window.clearTimeout(hintTimer);
      hint.classList.remove('is-visible');
    } else {
      showHint(HINT_SECONDS);
    }
  });

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
    scene.fog.density = THREE.MathUtils.lerp(current.look.fogDensity, other.look.fogDensity, mix) * fogScale;

    // 音の混ぜ具合にも同じ割合を使う
    for (const { area } of areas) weights[area.id] = 0;
    weights[current.area.id] += 1 - mix;
    weights[other.area.id] += mix;
  }

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
  const gaze = new THREE.Vector3();
  const pitchAxis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function frame(now) {
    const rawDelta = (now - previous) / 1000;
    // タブが裏に回っていた間の時間を一気に進めないよう、1フレームの上限を設ける
    const delta = Math.min(rawDelta, 0.1);
    previous = now;
    elapsed += delta;
    quality.update(rawDelta);

    const input = controls.update(delta);

    // エリア側から「ここでは立ち止まる」という指示（踏切の電車待ち）があれば従う
    let limit = 1;
    for (const { instance } of areas) {
      if (instance.speedLimit) limit = Math.min(limit, instance.speedLimit(u));
    }
    const wanted = walking ? WALK_SPEED * Math.min(input.speedFactor, 2) * limit : 0;
    speed = THREE.MathUtils.damp(speed, wanted, 4, delta);
    const distance = speed * delta;
    u = path.wrap(u + distance / path.length);

    // 歩行者（道の中心から左右へ寄った位置）
    path.pointAt(u, position);
    path.tangentAt(u, tangent);
    path.rightAt(u, right);
    position.addScaledVector(right, input.lateral);
    const stepped = walker.update({
      position,
      yaw: Math.atan2(tangent.x, tangent.z),
      distance,
      time: elapsed,
      sway: reducedMotion ? 0 : 1,
    });
    if (stepped) audio.step();
    walker.group.updateMatrixWorld(true);
    const lanternPosition = walker.getLanternPosition();

    // カメラ：歩行者の後ろ上から、少し先を見る。見回す操作のぶんだけ視線を回す
    const behindU = u - CAMERA_BEHIND / path.length;
    path.pointAt(behindU, behind);
    path.rightAt(behindU, right);
    const side = CAMERA_SIDE + input.lateral * 0.85;
    camera.position.set(behind.x + right.x * side, CAMERA_HEIGHT, behind.z + right.z * side);
    path.pointAt(u + LOOK_AHEAD / path.length, ahead);
    gaze.set(ahead.x - camera.position.x, 1.35 - CAMERA_HEIGHT, ahead.z - camera.position.z);
    gaze.applyAxisAngle(up, input.yaw);
    pitchAxis.set(-gaze.z, 0, gaze.x).normalize();
    gaze.applyAxisAngle(pitchAxis, input.pitch);
    camera.lookAt(camera.position.x + gaze.x, camera.position.y + gaze.y, camera.position.z + gaze.z);

    applyLook(u);
    for (const { instance } of areas) instance.update(elapsed, { u, delta, walkSpeed: WALK_SPEED });

    const shared = { time: elapsed, camera, lanternPosition, lanternColor: walker.lanternColor };
    ground.update({ ...shared, fog: scene.fog });
    rain.update(shared);

    camera.updateMatrixWorld();
    audio.update({ weights, camera, crossing: railsSound, trainCars: railsSound.trainCars });

    composer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 開始ボタン
  startButton.disabled = false;
  startButton.textContent = 'はじめる';
  startButton.addEventListener('click', () => {
    walking = true;
    audio.start();
    controls.enable();
    quality.start();
    overlay.classList.add('is-hidden');
    soundButton.hidden = false;
    helpButton.hidden = false;
    showHint(HINT_SECONDS);
  }, { once: true });
}

init();
