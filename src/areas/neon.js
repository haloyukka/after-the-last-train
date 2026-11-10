import * as THREE from 'three';
import { alongPath, createBoxBatch, createMaterials } from '../street.js';

// エリア1：ネオン街。光が多く、多色。
export const look = {
  background: 0x0d0818,
  fogDensity: 0.024,
};

const ROAD_HALF = 3;
const NEON_COLORS = [0xff3d8a, 0x3de0ff, 0x5cff9a, 0xffb347, 0xa06bff];
const WALL_COLORS = [0x15161d, 0x1a1820, 0x12141b];
const PAPER_LANTERN_COLOR = 0xff5a2a;
const VENDING_COLOR = 0xcfe6ff;

export function build({ scene, path, area, random, reducedMotion = false }) {
  const { solid, glow } = createMaterials({ glowBoost: 1.25 });
  const walls = createBoxBatch(solid);
  const lights = createBoxBatch(glow);
  const flickering = []; // ときどき明滅させる看板

  alongPath(path, area, 7, ({ at, yaw }) => {
    for (const side of [-1, 1]) {
      const depth = random.range(6, 10);
      const height = random.range(9, 22);
      const hasSign = random.chance(0.8);
      const neon = random.pick(NEON_COLORS);

      // 雑居ビル
      walls.add({
        position: at(side, ROAD_HALF + depth / 2),
        yaw,
        across: depth,
        height,
        along: random.range(5.5, 7),
        color: random.pick(WALL_COLORS),
      });

      // 道へ突き出す袖看板
      if (hasSign) {
        const signHeight = random.range(1.5, 4);
        const index = lights.add({
          position: at(side, ROAD_HALF - 0.45),
          yaw,
          across: 0.8,
          height: signHeight,
          along: 0.15,
          base: random.range(3, Math.max(3.5, height - signHeight - 1)),
          color: neon,
        });
        if (random.chance(0.12)) {
          flickering.push({ index, color: new THREE.Color(neon), a: random.range(5, 9), b: random.range(11, 17) });
        }
      }

      // 壁面の横長の看板
      if (random.chance(0.45)) {
        lights.add({
          position: at(side, ROAD_HALF - 0.05),
          yaw,
          across: 0.1,
          height: 0.7,
          along: random.range(2, 4),
          base: 2.6,
          color: random.pick(NEON_COLORS),
        });
      }

      // 軒先に並ぶ提灯
      if (random.chance(0.22)) {
        for (let i = -2; i <= 2; i += 1) {
          lights.add({
            position: at(side, ROAD_HALF - 0.3, i * 0.65),
            yaw,
            across: 0.24,
            height: 0.34,
            along: 0.24,
            base: 2.15,
            color: PAPER_LANTERN_COLOR,
          });
        }
      }

      // 自動販売機（本体と、光る前面）
      if (random.chance(0.14)) {
        const forward = random.range(-2, 2);
        walls.add({
          position: at(side, ROAD_HALF - 0.4, forward),
          yaw,
          across: 0.7,
          height: 1.85,
          along: 1,
          color: 0x23262e,
        });
        lights.add({
          position: at(side, ROAD_HALF - 0.77, forward),
          yaw,
          across: 0.04,
          height: 1.2,
          along: 0.84,
          base: 0.5,
          color: VENDING_COLOR,
        });
      }
    }
  });

  const lightMesh = lights.build();
  scene.add(walls.build(), lightMesh);

  const color = new THREE.Color();
  return {
    // 一部の看板を、切れかけの蛍光灯のように不規則に明滅させる
    update(time) {
      if (reducedMotion || flickering.length === 0) return;
      for (const sign of flickering) {
        const on = Math.sin(time * sign.a) + Math.sin(time * sign.b) > -1.25;
        lightMesh.setColorAt(sign.index, color.copy(sign.color).multiplyScalar(on ? 1 : 0.12));
      }
      lightMesh.instanceColor.needsUpdate = true;
    },
  };
}
