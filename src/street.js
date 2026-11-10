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
      return items.length - 1; // 後から色を変える（ネオンの明滅など）ための番号
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
// at(side, distance, forward) は、その地点から道の左右（side: -1 左 / +1 右）へ distance、
// 進行方向へ forward だけ離れた位置を返す。
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
      at: (side, distance, forward = 0) => point.clone()
        .addScaledVector(right, side * distance)
        .addScaledVector(tangent, forward),
    });
  }
}

// 光を受ける面（建物など）と、自ら光る面（ネオンや窓）の素材。
// glowBoost を1より大きくすると画面の白より明るくなり、光のにじみ（ブルーム）が強く出る。
export function createMaterials({ glowBoost = 1 } = {}) {
  const glow = new THREE.MeshBasicMaterial();
  glow.color.setScalar(glowBoost);
  return {
    solid: new THREE.MeshLambertMaterial(),
    glow,
  };
}

// エリアの境目に置く、道をまたぐ高架。くぐる間は暗くなり、前後の街並みの切り替わりを隠す。
export function addUnderpass(batch, path, u, { color = 0x101116 } = {}) {
  const point = path.pointAt(u);
  const tangent = path.tangentAt(u);
  const right = path.rightAt(u);
  const yaw = Math.atan2(tangent.x, tangent.z);

  // 桁（頭上の床）
  batch.add({ position: point, yaw, across: 30, height: 1.3, along: 10, base: 4.4, color });
  // 橋脚：道の両脇と、その外側
  for (const side of [-1, 1]) {
    for (const distance of [3.6, 13.5]) {
      batch.add({
        position: point.clone().addScaledVector(right, side * distance),
        yaw,
        across: 0.9,
        height: 4.4,
        along: 10,
        color,
      });
    }
  }
}

// 街灯などの下にできる、地面の光のたまり。中心が明るく外へ向かって消える円を、加算で重ねる。
export function createLightPools(pools) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.35)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const geometry = new THREE.CircleGeometry(1, 24);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(pools.length, 1));
  mesh.count = pools.length;
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  pools.forEach((pool, i) => {
    matrix.makeScale(pool.radius, 1, pool.radius);
    matrix.setPosition(pool.position.x, 0.03, pool.position.z);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, color.set(pool.color).multiplyScalar(pool.strength ?? 0.25));
  });
  mesh.frustumCulled = false;
  return mesh;
}
