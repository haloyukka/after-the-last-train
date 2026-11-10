import * as THREE from 'three';

// 訪問者の操作。何もしなければ自動で歩き続け、操作している間だけその入力を優先する。
// 手を離してしばらく経つと、視線・左右の位置・速さは自動歩行の状態へゆっくり戻る。
//
//   見回す          マウスのドラッグ / 横スワイプ
//   速さを変える    ↑↓・W S・ホイール / 縦スワイプ
//   立ち止まる      スペース（もう一度で歩き出す） / 長押し（押している間）
//   左右に寄る      ←→・A D / 画面の左右の端をタップ

const MAX_YAW = THREE.MathUtils.degToRad(110);
const MAX_PITCH_UP = THREE.MathUtils.degToRad(35);
const MAX_PITCH_DOWN = THREE.MathUtils.degToRad(20);
const MAX_LATERAL = 1.5; // 道の中心から左右に寄れる距離（m）
const FAST = 1.9; // 速く歩くときの倍率
const SLOW = 0.35; // ゆっくり歩くときの倍率
const IDLE_SECONDS = 2.5; // 手を離してから自動歩行へ戻り始めるまでの時間
const LONG_PRESS_SECONDS = 0.35;
const TAP_SECONDS = 0.3;
const EDGE_RATIO = 0.22; // 画面の左右何割を「端」とみなすか

export function createControls(element) {
  const keys = new Set();
  const state = { yaw: 0, pitch: 0, lateral: 0, speedFactor: 1 };
  const target = { yaw: 0, pitch: 0, lateral: 0 };

  let enabled = false;
  let paused = false;
  let idle = 0;
  let wheelFactor = 1;
  let pointer = null; // 押している間の情報

  const touch = () => { idle = 0; };

  function onPointerDown(event) {
    if (!enabled || pointer) return;
    element.setPointerCapture?.(event.pointerId);
    pointer = {
      id: event.pointerId,
      isTouch: event.pointerType !== 'mouse',
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      held: 0,
      moved: false,
      axis: null, // タッチでは、動かし始めた向きで「見回す」か「速さ」かを決める
      speed: null,
    };
    touch();
  }

  function onPointerMove(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.lastX;
    const dy = event.clientY - pointer.lastY;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    const totalX = event.clientX - pointer.startX;
    const totalY = event.clientY - pointer.startY;
    if (Math.hypot(totalX, totalY) > 10) pointer.moved = true;
    touch();

    if (!pointer.isTouch) {
      // マウス：つかんで引っぱる向きに景色が動く
      target.yaw = THREE.MathUtils.clamp(target.yaw + dx * 0.005, -MAX_YAW, MAX_YAW);
      target.pitch = THREE.MathUtils.clamp(target.pitch + dy * 0.004, -MAX_PITCH_DOWN, MAX_PITCH_UP);
      return;
    }

    if (!pointer.moved) return;
    if (!pointer.axis) pointer.axis = Math.abs(totalX) >= Math.abs(totalY) ? 'look' : 'speed';
    if (pointer.axis === 'look') {
      target.yaw = THREE.MathUtils.clamp(target.yaw + dx * 0.006, -MAX_YAW, MAX_YAW);
    } else {
      // 上へスワイプで速く、下へスワイプでゆっくり（大きく下げると立ち止まる）
      pointer.speed = THREE.MathUtils.clamp(1 - totalY / 140, 0, FAST);
    }
  }

  function onPointerUp(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const { isTouch, moved, held, startX } = pointer;
    pointer = null;
    touch();

    // 画面の端を短くタップしたら、その方向へ寄る
    if (isTouch && !moved && held < TAP_SECONDS) {
      const ratio = startX / window.innerWidth;
      if (ratio < EDGE_RATIO) target.lateral -= 0.8;
      else if (ratio > 1 - EDGE_RATIO) target.lateral += 0.8;
      target.lateral = THREE.MathUtils.clamp(target.lateral, -MAX_LATERAL, MAX_LATERAL);
    }
  }

  function onKeyDown(event) {
    if (!enabled || event.target instanceof HTMLButtonElement) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'];
    if (!handled.includes(event.code)) return;
    event.preventDefault();
    if (event.code === 'Space') {
      if (!event.repeat) paused = !paused;
    } else {
      keys.add(event.code);
      if (event.code === 'ArrowUp' || event.code === 'KeyW') paused = false;
    }
    touch();
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onWheel(event) {
    if (!enabled) return;
    event.preventDefault();
    wheelFactor = THREE.MathUtils.clamp(wheelFactor - Math.sign(event.deltaY) * 0.2, SLOW, FAST);
    touch();
  }

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());

  const down = (...codes) => codes.some((code) => keys.has(code));

  return {
    state,

    enable() {
      enabled = true;
    },

    // 毎フレーム呼ぶ。state に、いまの視線・左右の位置・速さの倍率が入る
    update(delta) {
      idle += delta;
      if (pointer) pointer.held += delta;

      // 左右に寄る（キーを押している間）
      const sideways = (down('ArrowRight', 'KeyD') ? 1 : 0) - (down('ArrowLeft', 'KeyA') ? 1 : 0);
      if (sideways !== 0) {
        target.lateral = THREE.MathUtils.clamp(target.lateral + sideways * 1.6 * delta, -MAX_LATERAL, MAX_LATERAL);
        idle = 0;
      }

      // 速さ
      let speed = wheelFactor;
      if (down('ArrowUp', 'KeyW')) speed = FAST;
      if (down('ArrowDown', 'KeyS')) speed = SLOW;
      if (pointer?.speed != null) speed = pointer.speed;
      const longPress = pointer?.isTouch && !pointer.moved && pointer.held > LONG_PRESS_SECONDS;
      if (paused || longPress) speed = 0;
      if (down('ArrowUp', 'ArrowDown', 'KeyW', 'KeyS') || pointer) idle = 0;

      // しばらく操作がなければ、自動歩行の状態へゆっくり戻す
      if (idle > IDLE_SECONDS) {
        target.yaw = THREE.MathUtils.damp(target.yaw, 0, 1.4, delta);
        target.pitch = THREE.MathUtils.damp(target.pitch, 0, 1.4, delta);
        target.lateral = THREE.MathUtils.damp(target.lateral, 0, 0.5, delta);
        wheelFactor = THREE.MathUtils.damp(wheelFactor, 1, 0.8, delta);
      }

      state.yaw = THREE.MathUtils.damp(state.yaw, target.yaw, 9, delta);
      state.pitch = THREE.MathUtils.damp(state.pitch, target.pitch, 9, delta);
      state.lateral = THREE.MathUtils.damp(state.lateral, target.lateral, 4, delta);
      state.speedFactor = THREE.MathUtils.damp(state.speedFactor, speed, 3, delta);
      return state;
    },
  };
}
