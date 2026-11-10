import * as THREE from 'three';
import { alongPath, createBoxBatch, createMaterials } from '../street.js';

// エリア3：線路沿い。光はごく少ない。
// 線路は道の右側を並んで走り、エリアの終わり近くで左へ曲がって道を横切る（踏切）。
// 歩行者が踏切に近づくと警報が鳴り始め、電車が後ろから追い抜いて目の前を横切る。
export const look = {
  background: 0x040508,
  fogDensity: 0.035,
};

const ROAD_HALF = 2.5;
const TRACK_OFFSET = 6; // 道の中心から線路の中心までの距離（m）
const BEND_START = 0.925; // 線路が道から離れて曲がり始める位置（道筋全体に対する割合）
const BEND_RADIUS = 30; // 曲がりの半径（m）
const BEND_ANGLE = THREE.MathUtils.degToRad(60);
const TRACK_AFTER_CROSSING = 45; // 踏切を過ぎてから線路が続く長さ（m）
const RAIL_GAUGE = 0.6; // 線路の中心からレールまでの距離（m）

const APPROACH_DISTANCE = 40; // 踏切の何m手前で警報が鳴り始めるか
const GATE_DISTANCE = 3.4; // 踏切の中心から遮断機までの距離（m）
const STOP_DISTANCE = 4.6; // 踏切の中心から歩行者が立ち止まる位置までの距離（m）

const TRAIN_SPEED = 15; // 電車の速さ（m/秒）
const CAR_COUNT = 4;
const CAR_LENGTH = 14;
const CAR_GAP = 0.6;
const TRAIN_LENGTH = CAR_COUNT * (CAR_LENGTH + CAR_GAP);

const CROSSING_RED = 0xff2a2a;
const WINDOW_COLOR = 0xffe2b0;

// 線路の中心線を作る。前半は道に沿い、途中から左へ曲がってまっすぐ伸びる。
function createTrack(path, area) {
  const step = 2;
  const points = [];
  const start = area.from * path.length;
  const bend = BEND_START * path.length;

  for (let s = start; s < bend; s += step) {
    const u = s / path.length;
    points.push(path.pointAt(u).addScaledVector(path.rightAt(u), TRACK_OFFSET));
  }

  const tangent = path.tangentAt(BEND_START);
  let heading = Math.atan2(tangent.x, tangent.z);
  const position = path.pointAt(BEND_START).addScaledVector(path.rightAt(BEND_START), TRACK_OFFSET);
  const bendLength = BEND_RADIUS * BEND_ANGLE;
  for (let d = 0; d < 170; d += step) {
    points.push(position.clone());
    if (d < bendLength) heading += step / BEND_RADIUS; // 左へ曲がる
    position.x += Math.sin(heading) * step;
    position.z += Math.cos(heading) * step;
  }

  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  curve.arcLengthDivisions = 1500;
  const fullLength = curve.getLength();

  // 道と線路が交わる点（踏切）を探す
  let best = { distance: Infinity, u: 0, s: 0 };
  const onPath = new THREE.Vector3();
  const onTrack = new THREE.Vector3();
  for (let s = bend - start; s < fullLength; s += 0.5) {
    curve.getPointAt(s / fullLength, onTrack);
    for (let u = BEND_START; u < 1; u += 0.0005) {
      const distance = path.pointAt(u, onPath).distanceTo(onTrack);
      if (distance < best.distance) best = { distance, u, s };
    }
  }

  const length = Math.min(best.s + TRACK_AFTER_CROSSING, fullLength);
  const frame = (s, point = new THREE.Vector3(), direction = new THREE.Vector3()) => {
    const t = THREE.MathUtils.clamp(s / fullLength, 0, 1);
    curve.getPointAt(t, point);
    curve.getTangentAt(t, direction);
    return { point, direction, yaw: Math.atan2(direction.x, direction.z) };
  };

  return { length, frame, crossingU: best.u, crossingS: best.s };
}

function createCar({ first, last }) {
  const car = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.7, 2.9, CAR_LENGTH),
    new THREE.MeshLambertMaterial({ color: 0x23252e, emissive: 0x0b0c11 }),
  );
  body.position.y = 0.75 + 1.45;
  car.add(body);

  // 車体より少し幅の広い光る帯を通し、両側面に窓の列として見せる
  const windowMaterial = new THREE.MeshBasicMaterial({ color: WINDOW_COLOR });
  windowMaterial.color.multiplyScalar(0.62);
  const windows = new THREE.Mesh(new THREE.BoxGeometry(2.74, 0.8, CAR_LENGTH - 1.6), windowMaterial);
  windows.position.y = 2.55;
  car.add(windows);

  // 窓の桟（光る帯を区切る）
  const mullionMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1c23 });
  const mullionGeometry = new THREE.BoxGeometry(2.78, 0.9, 0.35);
  for (let i = -2; i <= 2; i += 1) {
    const mullion = new THREE.Mesh(mullionGeometry, mullionMaterial);
    mullion.position.set(0, 2.55, i * 2.5);
    car.add(mullion);
  }

  // 先頭の前照灯と、最後尾の尾灯
  const lampGeometry = new THREE.SphereGeometry(0.14, 10, 8);
  if (first) {
    const material = new THREE.MeshBasicMaterial({ color: 0xfff2d0 });
    material.color.multiplyScalar(2.2);
    for (const x of [-0.8, 0.8]) {
      const lamp = new THREE.Mesh(lampGeometry, material);
      lamp.position.set(x, 1.5, CAR_LENGTH / 2 + 0.02);
      car.add(lamp);
    }
  }
  if (last) {
    const material = new THREE.MeshBasicMaterial({ color: CROSSING_RED });
    material.color.multiplyScalar(1.6);
    for (const x of [-0.8, 0.8]) {
      const lamp = new THREE.Mesh(lampGeometry, material);
      lamp.position.set(x, 1.5, -CAR_LENGTH / 2 - 0.02);
      car.add(lamp);
    }
  }

  car.visible = false;
  return car;
}

export function build({ scene, path, area, random }) {
  const { solid } = createMaterials();
  const walls = createBoxBatch(solid);
  const track = createTrack(path, area);
  const crossingU = track.crossingU;
  const gateU = GATE_DISTANCE / path.length;
  const stopU = crossingU - STOP_DISTANCE / path.length;
  const approachU = crossingU - APPROACH_DISTANCE / path.length;

  // --- 道沿い：フェンス（踏切の手前まで）と、反対側のまばらな建物 ---
  alongPath(path, area, 2.5, ({ u, at, yaw, index }) => {
    if (u < crossingU - gateU * 1.6) {
      walls.add({ position: at(1, ROAD_HALF), yaw, across: 0.08, height: 1.6, along: 0.08, color: 0x2a2c33 });
      for (const base of [0.75, 1.5]) {
        walls.add({ position: at(1, ROAD_HALF), yaw, across: 0.05, height: 0.05, along: 2.6, base, color: 0x2a2c33 });
      }
    }
    if (index % 6 === 0 && random.chance(0.7) && Math.abs(u - crossingU) > 0.02) {
      const depth = random.range(6, 9);
      walls.add({
        position: at(-1, ROAD_HALF + 1 + depth / 2),
        yaw,
        across: depth,
        height: random.range(4, 9),
        along: random.range(7, 11),
        color: 0x101116,
      });
    }
  });

  // --- 線路：砂利、枕木、レール、架線柱、架線 ---
  const point = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const side = new THREE.Vector3();
  const trackAt = (s, lateral = 0) => {
    const frame = track.frame(s, point, direction);
    side.set(-direction.z, 0, direction.x);
    return { position: point.clone().addScaledVector(side, lateral), yaw: frame.yaw };
  };

  for (let s = 0; s < track.length; s += 2) {
    const { position, yaw } = trackAt(s);
    walls.add({ position, yaw, across: 3.2, height: 0.12, along: 2.1, color: 0x1d1f24 });
    for (const lateral of [-RAIL_GAUGE, RAIL_GAUGE]) {
      const rail = trackAt(s, lateral);
      walls.add({ position: rail.position, yaw: rail.yaw, across: 0.08, height: 0.1, along: 2.1, base: 0.16, color: 0x4a4e5a });
    }
  }
  for (let s = 0; s < track.length; s += 0.7) {
    const { position, yaw } = trackAt(s);
    walls.add({ position, yaw, across: 2.1, height: 0.05, along: 0.24, base: 0.12, color: 0x15161a });
  }
  for (let s = 6; s < track.length; s += 36) {
    const pole = trackAt(s, 2.3);
    walls.add({ position: pole.position, yaw: pole.yaw, across: 0.22, height: 6.4, along: 0.22, color: 0x1d1f25 });
    const arm = trackAt(s, 1.1);
    walls.add({ position: arm.position, yaw: arm.yaw, across: 2.6, height: 0.1, along: 0.1, base: 5.6, color: 0x1d1f25 });
  }
  for (let s = 0; s < track.length; s += 4) {
    const { position, yaw } = trackAt(s);
    walls.add({ position, yaw, across: 0.03, height: 0.03, along: 4.1, base: 5.2, color: 0x08090c });
  }

  // 線路の終わりを隠す暗い建物（電車はここへ消えていく）
  const end = trackAt(track.length + 5);
  walls.add({ position: end.position, yaw: end.yaw, across: 9, height: 7, along: 12, color: 0x0b0c10 });

  // --- 踏切：路面の板、警報機、遮断機 ---
  const crossing = trackAt(track.crossingS);
  walls.add({ position: crossing.position, yaw: crossing.yaw, across: 3.4, height: 0.2, along: 7, color: 0x2a2622 });

  const lampGeometry = new THREE.SphereGeometry(0.15, 12, 8);
  const lamps = [];
  const gates = [];
  const barMaterial = new THREE.MeshLambertMaterial({ color: 0x8a7a3a, emissive: 0x2a2410 });

  // 手前側は道の左、向こう側は道の右に警報機を立て、遮断棒が道をふさぐ
  for (const [offsetU, postSide] of [[-gateU, -1], [gateU, 1]]) {
    const u = crossingU + offsetU;
    const center = path.pointAt(u);
    const right = path.rightAt(u);
    const tangent = path.tangentAt(u);
    const yaw = Math.atan2(tangent.x, tangent.z);
    const post = center.clone().addScaledVector(right, postSide * (ROAD_HALF + 0.3));

    walls.add({ position: post, yaw, across: 0.14, height: 3.4, along: 0.14, color: 0x2a2c33 });
    walls.add({ position: post, yaw, across: 1.1, height: 0.5, along: 0.08, base: 2.25, color: 0x15161a });

    for (const [lateral, phase] of [[-0.3, 0], [0.3, 1]]) {
      const lamp = new THREE.Mesh(lampGeometry, new THREE.MeshBasicMaterial());
      lamp.position.copy(post).addScaledVector(right, lateral);
      lamp.position.y = 2.5;
      scene.add(lamp);
      lamps.push({ lamp, phase });
    }

    // 遮断棒。付け根を軸に、上がった状態（ほぼ垂直）から水平まで倒れる
    const length = ROAD_HALF * 2 + 0.2;
    const barGeometry = new THREE.BoxGeometry(length, 0.08, 0.08);
    barGeometry.translate((postSide * length) / 2, 0, 0);
    const bar = new THREE.Mesh(barGeometry, barMaterial);
    const pivot = new THREE.Group();
    pivot.position.copy(post);
    pivot.position.y = 1.1;
    pivot.rotation.y = yaw;
    pivot.add(bar);
    scene.add(pivot);
    gates.push({ bar, postSide });
  }

  // --- 電車 ---
  const cars = Array.from({ length: CAR_COUNT }, (_, i) => createCar({ first: i === 0, last: i === CAR_COUNT - 1 }));
  for (const car of cars) scene.add(car);
  const trainLight = new THREE.PointLight(WINDOW_COLOR, 0, 30, 2);
  scene.add(trainLight);

  scene.add(walls.build());

  const on = new THREE.Color(CROSSING_RED).multiplyScalar(2);
  const off = new THREE.Color(0x2a0606);
  const train = { active: false, headS: 0, passedThisLap: false };
  let gateAngle = 0; // 0 = 上がっている、1 = 下りている

  const cleared = () => !train.active || train.headS - TRAIN_LENGTH > track.crossingS + 4;

  // 音を鳴らす側（audio.js）へ渡す状態
  const sound = { alarm: false, position: crossing.position.clone().setY(2.5), trainCars: [] };

  return {
    crossingU,
    sound,

    // 踏切で電車を待つ間、歩く速さを落とす（1 = そのまま歩く、0 = 立ち止まる）
    speedLimit(u) {
      if (cleared() || u >= crossingU || u < approachU) return 1;
      const remaining = (stopU - u) * path.length;
      return THREE.MathUtils.clamp(remaining / 2.5, 0, 1);
    },

    update(time, { u = 0, delta = 0, walkSpeed = 2.8 } = {}) {
      // 歩行者が踏切に近づいたら、ちょうど手前に着く頃に電車が通るよう走らせる
      if (!train.active && !train.passedThisLap && u >= approachU && u < stopU) {
        const secondsToStop = ((stopU - u) * path.length) / walkSpeed;
        train.active = true;
        train.headS = track.crossingS - TRAIN_SPEED * (secondsToStop + 0.6);
      }
      if (u < area.from) train.passedThisLap = false;

      if (train.active) {
        train.headS += TRAIN_SPEED * delta;
        cars.forEach((car, i) => {
          const s = train.headS - CAR_LENGTH / 2 - i * (CAR_LENGTH + CAR_GAP);
          car.visible = s > 0 && s < track.length;
          if (!car.visible) return;
          const frame = track.frame(s, point, direction);
          car.position.copy(frame.point);
          car.rotation.y = frame.yaw;
        });
        const middle = train.headS - TRAIN_LENGTH / 2;
        const lit = middle > 0 && middle < track.length;
        trainLight.intensity = lit ? 30 : 0;
        if (lit) {
          trainLight.position.copy(track.frame(middle, point, direction).point);
          trainLight.position.y = 2.6;
        }
        if (train.headS - TRAIN_LENGTH > track.length) {
          train.active = false;
          train.passedThisLap = true;
          trainLight.intensity = 0;
        }
      }

      sound.trainCars = train.active ? cars.filter((car) => car.visible).map((car) => car.position) : [];

      // 警報機：左右の赤いランプを交互に点ける（1秒に1往復未満のゆっくりした点滅）
      const alarm = !cleared();
      sound.alarm = alarm;
      const step = Math.floor(time / 0.6) % 2;
      for (const { lamp, phase } of lamps) {
        lamp.material.color.copy(alarm && step === phase ? on : off);
      }

      // 遮断機
      gateAngle = THREE.MathUtils.damp(gateAngle, alarm ? 1 : 0, 2.2, delta);
      for (const { bar, postSide } of gates) {
        bar.rotation.z = postSide * (1 - gateAngle) * 1.35;
      }
    },
  };
}
