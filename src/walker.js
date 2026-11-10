import * as THREE from 'three';

// 傘を差し、提灯のような灯りを持った歩行者。細部は描かず、影絵のような姿にする。
// 原点は足元、正面は +Z 方向。

const LANTERN_COLOR = 0xffb866;
const STEP_LENGTH = 0.72; // 一歩の長さ（m）

export function createWalker() {
  const group = new THREE.Group();
  // 暗い街の中でも輪郭が消えないよう、わずかに自ら光らせる（emissive）
  const dark = new THREE.MeshLambertMaterial({ color: 0x2b2d38, emissive: 0x181a24 });
  const legMaterial = new THREE.MeshLambertMaterial({ color: 0x15161c, emissive: 0x0e0f15 });
  const darker = new THREE.MeshLambertMaterial({ color: 0x343744, emissive: 0x1b1d28, side: THREE.DoubleSide });

  // 脚（付け根を軸に前後へ振る）
  const legGeometry = new THREE.BoxGeometry(0.13, 0.85, 0.15);
  legGeometry.translate(0, -0.425, 0);
  const legs = [-1, 1].map((side) => {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(side * 0.1, 0.87, 0);
    group.add(leg);
    return leg;
  });

  // コート、頭
  const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.27, 0.8, 10), dark);
  coat.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), dark);
  head.position.y = 1.72;
  group.add(coat, head);

  // 傘
  const umbrella = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.28, 10, 1, true), darker);
  canopy.position.y = 2.16;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.95, 6), dark);
  shaft.position.y = 1.72;
  umbrella.add(canopy, shaft);
  umbrella.position.set(0.14, 0, 0.05);
  group.add(umbrella);

  // 灯り（右手から下げる）。自ら光る球と、周囲を照らす点光源を重ねる
  const lantern = new THREE.Group();
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.25, 4), dark);
  cord.position.y = -0.125;
  const glowMaterial = new THREE.MeshBasicMaterial({ color: LANTERN_COLOR });
  glowMaterial.color.multiplyScalar(1.8); // にじみが出るよう、画面の白より明るくする
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), glowMaterial);
  glow.scale.y = 1.35;
  glow.position.y = -0.38;
  const light = new THREE.PointLight(LANTERN_COLOR, 55, 26, 2);
  light.position.y = -0.38;
  lantern.add(cord, glow, light);
  lantern.position.set(-0.34, 1.12, 0.12);
  group.add(lantern);

  let phase = 0;
  const lanternWorld = new THREE.Vector3();
  const lanternColor = new THREE.Color(LANTERN_COLOR);

  return {
    group,
    lanternColor,

    // 灯りの位置（ワールド座標）。路面や雨を照らす計算に使う
    getLanternPosition() {
      return glow.getWorldPosition(lanternWorld);
    },

    // distance: このフレームで進んだ距離（m） / sway: 揺れの強さ（0〜1）
    // 戻り値：このフレームで足が地面に着いたら true（足音を鳴らすきっかけ）
    update({ position, yaw, distance, time, sway = 1 }) {
      const before = Math.floor(phase / Math.PI + 0.5);
      phase += (distance / STEP_LENGTH) * Math.PI;
      const stepped = Math.floor(phase / Math.PI + 0.5) !== before;
      const swing = Math.sin(phase);

      group.position.set(position.x, Math.abs(swing) * 0.025 * sway, position.z);
      group.rotation.y = yaw;
      legs[0].rotation.x = swing * 0.45;
      legs[1].rotation.x = -swing * 0.45;
      umbrella.rotation.z = Math.sin(phase * 0.5) * 0.02 * sway;
      lantern.rotation.x = Math.sin(phase + 0.6) * 0.12 * sway;
      lantern.rotation.z = Math.sin(time * 1.3) * 0.04 * sway;
      return stepped;
    },
  };
}
