import * as THREE from 'three';
import { alongPath, createBoxBatch, createMaterials } from '../street.js';

// エリア3：線路沿い（仮の箱）。光はごく少なく、終わりに踏切の赤い点滅がある。
export const look = {
  background: 0x040508,
  fogDensity: 0.035,
};

const ROAD_HALF = 2.5;
const TRACK_SIDE = -1; // 線路は進行方向の左側
const RAIL_DISTANCES = [5, 6.4];
const CROSSING_RED = 0xff2a2a;

export function build({ scene, path, area, random }) {
  const { solid } = createMaterials();
  const walls = createBoxBatch(solid);

  alongPath(path, area, 2.5, ({ at, yaw, index }) => {
    // フェンスの支柱と横棒
    walls.add({
      position: at(TRACK_SIDE, ROAD_HALF),
      yaw,
      across: 0.08,
      height: 1.6,
      along: 0.08,
      color: 0x2a2c33,
    });
    walls.add({
      position: at(TRACK_SIDE, ROAD_HALF),
      yaw,
      across: 0.05,
      height: 0.05,
      along: 2.6,
      base: 1.5,
      color: 0x2a2c33,
    });

    // レール
    for (const distance of RAIL_DISTANCES) {
      walls.add({
        position: at(TRACK_SIDE, distance),
        yaw,
        across: 0.1,
        height: 0.15,
        along: 2.7,
        color: 0x3a3d47,
      });
    }

    // 架線柱
    if (index % 16 === 0) {
      walls.add({
        position: at(TRACK_SIDE, 8),
        yaw,
        across: 0.25,
        height: 7,
        along: 0.25,
        color: 0x1d1f25,
      });
    }

    // 反対側のまばらな建物
    if (index % 6 === 0 && random.chance(0.7)) {
      const depth = random.range(6, 9);
      walls.add({
        position: at(1, ROAD_HALF + 1 + depth / 2),
        yaw,
        across: depth,
        height: random.range(4, 9),
        along: random.range(7, 11),
        color: 0x101116,
      });
    }
  });

  // 踏切：エリアの終わり近くに、道の両脇へ警報機を立てる
  const crossingU = area.to - 0.015;
  const point = path.pointAt(crossingU);
  const right = path.rightAt(crossingU);
  const tangent = path.tangentAt(crossingU);
  const yaw = Math.atan2(tangent.x, tangent.z);
  const lampGeometry = new THREE.SphereGeometry(0.16, 12, 8);
  const lamps = [];

  for (const side of [-1, 1]) {
    const base = point.clone().addScaledVector(right, side * (ROAD_HALF - 0.2));
    walls.add({ position: base, yaw, across: 0.12, height: 3, along: 0.12, color: 0x2a2c33 });

    for (const offset of [-0.3, 0.3]) {
      const lamp = new THREE.Mesh(lampGeometry, new THREE.MeshBasicMaterial({ color: CROSSING_RED }));
      lamp.position.copy(base).addScaledVector(right, offset);
      lamp.position.y = 2.4;
      scene.add(lamp);
      lamps.push({ lamp, phase: offset < 0 ? 0 : 1 });
    }
  }

  scene.add(walls.build());

  const on = new THREE.Color(CROSSING_RED).multiplyScalar(2);
  const off = new THREE.Color(0x2a0606);

  return {
    // 左右の赤いランプを約1秒ごとに交互に点ける（激しい点滅にはしない）
    update(time) {
      const step = Math.floor(time) % 2;
      for (const { lamp, phase } of lamps) {
        lamp.material.color.copy(step === phase ? on : off);
      }
    },
  };
}
