// 画質の段階。端末の性能に合わせて3段階を使い分け、重いときは自動で1段階ずつ下げる。
//
//   高 … 路面の映り込み、光のにじみ、雨と波紋をすべて有効
//   中 … 映り込みの解像度と雨粒の数を減らす
//   低 … 映り込みと光のにじみを切り、霧を濃くして遠くを描かない

export const LEVELS = {
  high: { pixelRatio: 2, reflection: true, reflectionScale: 0.5, bloom: true, rain: 3500, fog: 1, ripple: 1 },
  mid: { pixelRatio: 1.5, reflection: true, reflectionScale: 0.33, bloom: true, rain: 2000, fog: 1, ripple: 1 },
  low: { pixelRatio: 1, reflection: false, reflectionScale: 0.25, bloom: false, rain: 900, fog: 1.3, ripple: 0 },
};

const ORDER = ['high', 'mid', 'low'];

// この値（1秒あたりのコマ数）を下回ったら1段階下げる
const MIN_FPS = { high: 42, mid: 26 };
const WARMUP_SECONDS = 3; // 開始直後は読み込みの影響があるので測らない
const WINDOW_SECONDS = 3; // コマ数を平均する時間

export function createQuality(onChange) {
  const params = new URLSearchParams(window.location.search);
  const forced = params.get('q'); // 確認用：?q=low のように固定できる（自動調整は止まる）
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;

  let level = LEVELS[forced] ? forced : (coarse || small ? 'mid' : 'high');
  const auto = !LEVELS[forced];
  let measuring = false;
  let warmup = 0;
  let time = 0;
  let frames = 0;

  return {
    get level() {
      return level;
    },
    get settings() {
      return LEVELS[level];
    },

    // 歩き始めてから測定を始める
    start() {
      measuring = auto;
      warmup = 0;
      time = 0;
      frames = 0;
    },

    // 毎フレーム呼ぶ。delta はこのフレームにかかった秒数（上限で切る前の値）
    update(delta) {
      if (!measuring) return;
      // タブが裏に回っていた直後など、極端に長いフレームは測定から外してやり直す
      if (delta > 0.5) {
        time = 0;
        frames = 0;
        return;
      }
      if (warmup < WARMUP_SECONDS) {
        warmup += delta;
        return;
      }
      time += delta;
      frames += 1;
      if (time < WINDOW_SECONDS) return;

      const fps = frames / time;
      time = 0;
      frames = 0;
      const minimum = MIN_FPS[level];
      if (minimum && fps < minimum) {
        level = ORDER[ORDER.indexOf(level) + 1];
        warmup = 0; // 切り替え直後は再び様子を見る
        onChange(LEVELS[level], level);
      }
      if (level === 'low') measuring = false;
    },
  };
}
