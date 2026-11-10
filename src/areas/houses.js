import { alongPath, createBoxBatch, createMaterials } from '../street.js';

// エリア2：住宅街（仮の箱）。光は少なく、暖色の窓明かりと白い街灯だけ。
export const look = {
  background: 0x05070d,
  fogDensity: 0.03,
};

const ROAD_HALF = 2.5;
const SETBACK = 1.5; // 塀から家までの距離
const WINDOW_COLOR = 0xffd9a0;
const LAMP_COLOR = 0xcfe4ff;
const WALL_COLORS = [0x14151a, 0x17181c, 0x111318];

export function build({ scene, path, area, random }) {
  const { solid, glow } = createMaterials();
  const walls = createBoxBatch(solid);
  const lights = createBoxBatch(glow);

  alongPath(path, area, 9, ({ at, yaw, index }) => {
    for (const side of [-1, 1]) {
      // 塀
      walls.add({
        position: at(side, ROAD_HALF + 0.1),
        yaw,
        across: 0.2,
        height: 1.4,
        along: 9.2,
        color: 0x1b1c21,
      });

      // 家
      const depth = random.range(6, 8);
      walls.add({
        position: at(side, ROAD_HALF + SETBACK + depth / 2),
        yaw,
        across: depth,
        height: random.range(5, 7.5),
        along: random.range(6, 8),
        color: random.pick(WALL_COLORS),
      });

      // まばらな窓明かり
      if (random.chance(0.3)) {
        lights.add({
          position: at(side, ROAD_HALF + SETBACK - 0.05),
          yaw,
          across: 0.1,
          height: 1,
          along: 1.2,
          base: random.chance(0.5) ? 1.6 : 4,
          color: WINDOW_COLOR,
        });
      }
    }

    // 街灯（4軒に1本、左右交互）
    if (index % 4 === 0) {
      const side = (index / 4) % 2 === 0 ? -1 : 1;
      walls.add({
        position: at(side, ROAD_HALF - 0.3),
        yaw,
        across: 0.15,
        height: 5,
        along: 0.15,
        color: 0x202228,
      });
      lights.add({
        position: at(side, ROAD_HALF - 0.6),
        yaw,
        across: 0.7,
        height: 0.15,
        along: 0.4,
        base: 4.9,
        color: LAMP_COLOR,
      });
    }
  });

  scene.add(walls.build(), lights.build());
  return { update() {} };
}
