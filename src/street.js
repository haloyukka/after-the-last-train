import * as THREE from 'three';

// 箱をまとめて1回で描画するための入れ物（InstancedMesh）。
// 街並みは大量の箱でできているので、1個ずつ描くより大幅に軽くなる。
export function createBoxBatch(material) {
  const items = [];

  return {
    // across: 道を横切る方向の幅 / height: 高さ / along: 道に沿う方向の長さ
    // base: 箱の底面の高さ（省略時は地面）
    add({ position, yaw, across, height, along, base = 0, color }) {
      items.push({ position: position.clone(), yaw, across, height, along, base, color });
    },

    build() {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(items.length, 1));
      mesh.count = items.length;

      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const center = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      const color = new THREE.Color();

      items.forEach((item, i) => {
        quaternion.setFromAxisAngle(up, item.yaw);
        scale.set(item.across, item.height, item.along);
        center.copy(item.position);
        center.y = item.base + item.height / 2;
        matrix.compose(center, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, color.set(item.color));
      });

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // 道筋全体に広がるため、まとめての視界外判定は行わない
      mesh.frustumCulled = false;
      return mesh;
    },
  };
}

// エリアの区間を一定間隔で歩き、各地点の情報を fn に渡す。
// at(side, distance) は、その地点から道の左右（side: -1 左 / +1 右）へ distance だけ離れた位置を返す。
export function alongPath(path, area, spacing, fn) {
  const start = area.from * path.length;
  const end = area.to * path.length;
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const right = new THREE.Vector3();

  let index = 0;
  for (let s = start; s < end; s += spacing, index += 1) {
    const u = s / path.length;
    path.pointAt(u, point);
    path.tangentAt(u, tangent);
    path.rightAt(u, right);
    fn({
      u,
      index,
      point,
      yaw: Math.atan2(tangent.x, tangent.z),
      at: (side, distance) => point.clone().addScaledVector(right, side * distance),
    });
  }
}

// 光を受ける面（建物など）と、自ら光る面（ネオンや窓）の素材
export function createMaterials() {
  return {
    solid: new THREE.MeshLambertMaterial(),
    glow: new THREE.MeshBasicMaterial(),
  };
}
