import { alongPath, createBoxBatch, createMaterials } from '../street.js';

// エリア1：ネオン街（仮の箱）。光が多く、多色。
export const look = {
  background: 0x0b0714,
  fogDensity: 0.022,
};

const ROAD_HALF = 3;
const NEON_COLORS = [0xff3d8a, 0x3de0ff, 0x5cff9a, 0xffb347, 0xa06bff];
const WALL_COLORS = [0x15161d, 0x1a1820, 0x12141b];

export function build({ scene, path, area, random }) {
  const { solid, glow } = createMaterials();
  const walls = createBoxBatch(solid);
  const lights = createBoxBatch(glow);

  alongPath(path, area, 7, ({ at, yaw }) => {
    for (const side of [-1, 1]) {
      // 雑居ビル
      const depth = random.range(6, 10);
      const height = random.range(9, 22);
      walls.add({
        position: at(side, ROAD_HALF + depth / 2),
        yaw,
        across: depth,
        height,
        along: random.range(5.5, 7),
        color: random.pick(WALL_COLORS),
      });

      // 道へ突き出す袖看板
      if (random.chance(0.75)) {
        const signHeight = random.range(1.5, 4);
        lights.add({
          position: at(side, ROAD_HALF - 0.45),
          yaw,
          across: 0.8,
          height: signHeight,
          along: 0.15,
          base: random.range(3, Math.max(3.5, height - signHeight - 1)),
          color: random.pick(NEON_COLORS),
        });
      }

      // 壁面の横長の看板
      if (random.chance(0.4)) {
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
    }
  });

  scene.add(walls.build(), lights.build());
  return { update() {} };
}
