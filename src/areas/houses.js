import * as THREE from 'three';
import { alongPath, createBoxBatch, createLightPools, createMaterials } from '../street.js';

// エリア2：住宅街。光は少なく、暖色の窓明かりと白い街灯だけ。
export const look = {
  background: 0x05070d,
  fogDensity: 0.03,
};

const ROAD_HALF = 2.5;
const SETBACK = 1.5; // 塀から家までの距離
const WINDOW_COLOR = 0xffd9a0;
const TV_COLOR = 0x8fb4ff;
const LAMP_COLOR = 0xcfe4ff;
const WALL_COLORS = [0x14151a, 0x17181c, 0x111318];
const SPACING = 9; // 家1軒ぶんの間口（m）

export function build({ scene, path, area, random, reducedMotion = false }) {
  const { solid, glow } = createMaterials({ glowBoost: 1.4 });
  const walls = createBoxBatch(solid);
  const lights = createBoxBatch(glow);
  const pools = [];
  const televisions = []; // テレビの光がちらつく窓

  alongPath(path, area, SPACING, ({ at, yaw, index }) => {
    for (const side of [-1, 1]) {
      // 塀
      walls.add({
        position: at(side, ROAD_HALF + 0.1),
        yaw,
        across: 0.2,
        height: 1.4,
        along: SPACING + 0.2,
        color: 0x1b1c21,
      });

      // 家：1階と、ひと回り小さい2階（ときどき平屋）
      const depth = random.range(6, 8);
      const width = random.range(6, 8);
      const twoStory = random.chance(0.75);
      const color = random.pick(WALL_COLORS);
      walls.add({
        position: at(side, ROAD_HALF + SETBACK + depth / 2),
        yaw,
        across: depth,
        height: 3,
        along: width,
        color,
      });
      if (twoStory) {
        walls.add({
          position: at(side, ROAD_HALF + SETBACK + 0.6 + depth / 2),
          yaw,
          across: depth - 1.2,
          height: random.range(2.6, 3.2),
          along: width - 1.4,
          base: 3,
          color,
        });
      }
      // 軒（屋根の出っ張り）
      walls.add({
        position: at(side, ROAD_HALF + SETBACK + depth / 2),
        yaw,
        across: depth + 0.6,
        height: 0.15,
        along: width + 0.6,
        base: 3,
        color: 0x0e0f13,
      });

      // まばらな窓明かり。たまにテレビの青い光
      if (random.chance(0.3)) {
        const upstairs = twoStory && random.chance(0.5);
        const television = random.chance(0.25);
        const index2 = lights.add({
          position: at(side, ROAD_HALF + SETBACK + (upstairs ? 0.6 : 0) - 0.05, random.range(-1.5, 1.5)),
          yaw,
          across: 0.1,
          height: 1,
          along: 1.2,
          base: upstairs ? 4 : 1.5,
          color: television ? TV_COLOR : WINDOW_COLOR,
        });
        if (television) televisions.push({ index: index2, a: random.range(2, 4), b: random.range(5, 8) });
      }
    }

    // 街灯（4軒に1本、左右交互）と、その下の光のたまり
    if (index % 4 === 0) {
      const side = (index / 4) % 2 === 0 ? -1 : 1;
      walls.add({ position: at(side, ROAD_HALF - 0.3), yaw, across: 0.15, height: 5, along: 0.15, color: 0x202228 });
      walls.add({ position: at(side, ROAD_HALF - 0.75), yaw, across: 1, height: 0.08, along: 0.08, base: 4.95, color: 0x202228 });
      lights.add({ position: at(side, ROAD_HALF - 1.1), yaw, across: 0.6, height: 0.12, along: 0.35, base: 4.82, color: LAMP_COLOR });
      pools.push({ position: at(side, ROAD_HALF - 1.1), radius: 5, color: LAMP_COLOR, strength: 0.1 });
    }

    // 電柱（3軒に1本、街灯と反対側に寄せる）と電線
    if (index % 3 === 1) {
      walls.add({ position: at(1, ROAD_HALF - 0.15), yaw, across: 0.28, height: 8, along: 0.28, color: 0x18191e });
      walls.add({ position: at(1, ROAD_HALF - 0.15), yaw, across: 1.8, height: 0.1, along: 0.1, base: 7.2, color: 0x18191e });
    }
    for (const offset of [-0.8, 0, 0.6]) {
      walls.add({
        position: at(1, ROAD_HALF - 0.15 + offset),
        yaw,
        across: 0.03,
        height: 0.03,
        along: SPACING + 0.3,
        base: 7.3,
        color: 0x08090c,
      });
    }
  });

  const lightMesh = lights.build();
  scene.add(walls.build(), lightMesh, createLightPools(pools));

  const base = new THREE.Color(TV_COLOR);
  const color = new THREE.Color();
  return {
    // テレビの光を、番組の場面が変わるようにゆっくり明るさを変える
    update(time) {
      if (reducedMotion || televisions.length === 0) return;
      for (const tv of televisions) {
        const level = 0.65 + 0.25 * Math.sin(time * tv.a) + 0.1 * Math.sin(time * tv.b);
        lightMesh.setColorAt(tv.index, color.copy(base).multiplyScalar(level));
      }
      lightMesh.instanceColor.needsUpdate = true;
    },
  };
}
