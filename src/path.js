import * as THREE from 'three';

// 歩く道筋。閉じた曲線なので、終点がそのまま始点につながりループする。
// 座標は地面（XZ平面）上の [x, z]、単位はメートル。
const CONTROL_POINTS = [
  [0, 0],
  [0, -90],
  [10, -170],
  [70, -210],
  [150, -200],
  [200, -150],
  [205, -70],
  [190, 10],
  [130, 50],
  [60, 40],
];

// 道筋を3等分してエリアを割り当てる。u は道筋上の位置（0〜1、距離に比例）。
export const AREAS = [
  { id: 'neon', name: 'ネオン街', from: 0, to: 1 / 3 },
  { id: 'houses', name: '住宅街', from: 1 / 3, to: 2 / 3 },
  { id: 'rails', name: '線路沿い', from: 2 / 3, to: 1 },
];

export function createPath() {
  const curve = new THREE.CatmullRomCurve3(
    CONTROL_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'centripetal',
  );
  // 距離に比例した位置指定（getPointAt）の精度を上げる
  curve.arcLengthDivisions = 2000;
  const length = curve.getLength();

  const wrap = (u) => ((u % 1) + 1) % 1;

  return {
    curve,
    length,
    wrap,

    // 道筋上の点
    pointAt(u, target = new THREE.Vector3()) {
      return curve.getPointAt(wrap(u), target);
    },

    // 進行方向（単位ベクトル）
    tangentAt(u, target = new THREE.Vector3()) {
      return curve.getTangentAt(wrap(u), target);
    },

    // 進行方向に対して右向きの単位ベクトル（地面に平行）
    rightAt(u, target = new THREE.Vector3()) {
      const t = curve.getTangentAt(wrap(u), target);
      return target.set(-t.z, 0, t.x).normalize();
    },

    areaAt(u) {
      const w = wrap(u);
      return AREAS.find((a) => w >= a.from && w < a.to) ?? AREAS[0];
    },
  };
}
