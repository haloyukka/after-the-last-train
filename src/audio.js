// 環境音。音声ファイルは使わず、ブラウザの Web Audio API ですべて合成する。
// 基本の作り方は「ノイズをフィルターで削って形を作る」「短い音の粒を不規則に散らす」の2つ。
//
// 音の層：
//   いつも鳴る … 雨（遠くの雨、傘に当たる雨粒、地面の水音）
//   エリアごと … 街の低いうなり、ネオンのジーという音、室外機、遠くの車
//   出来事     … 足音、踏切の警報音、電車の通過音

const MASTER_VOLUME = 0.85;

// 各エリアでの音量（街のうなり、ネオン、室外機）
const AREA_MIX = {
  neon: { drone: 1, buzz: 1, aircon: 0 },
  houses: { drone: 0.45, buzz: 0, aircon: 1 },
  rails: { drone: 0.25, buzz: 0, aircon: 0 },
};

export function createAudio() {
  let context = null;
  let nodes = null;
  let muted = false;
  let noise = null;
  let nextBellTime = 0;
  let nextCarTime = 0;
  let stepIndex = 0;

  // ---- 素材になるノイズ ----

  function createNoiseBuffers() {
    const rate = context.sampleRate;

    // ホワイトノイズ：全ての高さの音が均等に混ざった「サー」という音
    const white = context.createBuffer(1, rate * 3, rate);
    const whiteData = white.getChannelData(0);
    for (let i = 0; i < whiteData.length; i += 1) whiteData[i] = Math.random() * 2 - 1;

    // ブラウンノイズ：低い音が強い「ゴー」という音
    const brown = context.createBuffer(1, rate * 4, rate);
    const brownData = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < brownData.length; i += 1) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      brownData[i] = last * 3.5;
    }

    return {
      white,
      brown,
      // 雨粒：ごく短い音の粒を不規則に並べたもの
      patter: createDrops({ seconds: 5, perSecond: 90, decay: 0.012, level: [0.2, 1] }),
      drips: createDrops({ seconds: 6, perSecond: 22, decay: 0.03, level: [0.3, 1] }),
      // 電車の「ガタン、ゴトン」
      clatter: createClatter(),
      // 足音1回ぶん
      step: createDrops({ seconds: 0.16, perSecond: 0, decay: 0.03, level: [1, 1], single: true }),
    };
  }

  function createDrops({ seconds, perSecond, decay, level, single = false }) {
    const rate = context.sampleRate;
    const buffer = context.createBuffer(1, Math.floor(rate * seconds), rate);
    const data = buffer.getChannelData(0);
    const count = single ? 1 : Math.floor(seconds * perSecond);
    const length = Math.floor(decay * 6 * rate);
    for (let n = 0; n < count; n += 1) {
      const start = single ? 0 : Math.floor(Math.random() * (data.length - length));
      const gain = level[0] + Math.random() * (level[1] - level[0]);
      for (let i = 0; i < length && start + i < data.length; i += 1) {
        data[start + i] += (Math.random() * 2 - 1) * gain * Math.exp(-i / (decay * rate));
      }
    }
    return buffer;
  }

  function createClatter() {
    const rate = context.sampleRate;
    const seconds = 1.5;
    const buffer = context.createBuffer(1, Math.floor(rate * seconds), rate);
    const data = buffer.getChannelData(0);
    // 車輪がレールの継ぎ目を踏む音。2つずつ組になって聞こえる
    for (const [time, gain] of [[0, 1], [0.13, 0.8], [0.75, 0.9], [0.88, 0.7]]) {
      const start = Math.floor(time * rate);
      const length = Math.floor(0.25 * rate);
      for (let i = 0; i < length && start + i < data.length; i += 1) {
        data[start + i] += (Math.random() * 2 - 1) * gain * Math.exp(-i / (0.035 * rate));
      }
    }
    return buffer;
  }

  // ---- 部品 ----

  function loop(buffer, { rate = 1 } = {}) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    // 複数の層が同じ位置から始まって揃わないよう、開始位置をずらす
    source.start(0, Math.random() * buffer.duration);
    return source;
  }

  function filter(type, frequency, q = 0.7) {
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }

  function gain(value) {
    const node = context.createGain();
    node.gain.value = value;
    return node;
  }

  function oscillator(type, frequency) {
    const node = context.createOscillator();
    node.type = type;
    node.frequency.value = frequency;
    node.start();
    return node;
  }

  // 複数のノードを順につなぎ、最後のノードを返す
  function chain(...list) {
    for (let i = 0; i < list.length - 1; i += 1) list[i].connect(list[i + 1]);
    return list[list.length - 1];
  }

  // 音量をなめらかに目標値へ近づける（急に変えるとプツッという雑音になる）
  function fade(param, value, seconds = 0.4) {
    param.setTargetAtTime(value, context.currentTime, seconds);
  }

  // ---- 音の層を組み立てる ----

  function build() {
    const master = gain(0);
    const compressor = context.createDynamicsCompressor();
    chain(master, compressor, context.destination);

    // 雨：遠くの雨（低めのザー）＋高めのサー。ゆっくり強弱をつける
    const rain = gain(1);
    chain(loop(noise.brown), filter('highpass', 350), gain(0.5), rain);
    chain(loop(noise.white), filter('bandpass', 5200, 0.5), gain(0.05), rain);
    chain(oscillator('sine', 0.07), gain(0.12), rain.gain);
    rain.connect(master);

    // 傘に当たる雨粒と、地面の水音
    chain(loop(noise.patter), filter('bandpass', 1700, 0.8), gain(0.3), master);
    chain(loop(noise.drips), filter('bandpass', 3800, 1.2), gain(0.1), master);

    // 街の低いうなり
    const drone = gain(0);
    chain(loop(noise.brown, { rate: 0.6 }), filter('lowpass', 140), gain(0.55), drone);
    chain(oscillator('sine', 55), gain(0.02), drone);
    chain(oscillator('sine', 82.4), gain(0.012), drone);
    drone.connect(master);

    // ネオンのジーという音（電源の周波数に由来するうなりと、その高い成分）
    const buzz = gain(0);
    const buzzLevel = gain(0.014);
    chain(oscillator('sawtooth', 100), filter('bandpass', 3100, 2.5), buzzLevel, buzz);
    chain(oscillator('sine', 7.3), gain(0.004), buzzLevel.gain);
    chain(oscillator('sine', 100), gain(0.012), buzz);
    buzz.connect(master);

    // 室外機の低い音
    const aircon = gain(0);
    const airconLevel = gain(0.22);
    chain(loop(noise.brown), filter('bandpass', 190, 1.1), airconLevel, aircon);
    chain(oscillator('sine', 11), gain(0.03), airconLevel.gain);
    chain(oscillator('sine', 96), gain(0.008), aircon);
    aircon.connect(master);

    // 踏切の警報音と電車：左右の位置（パン）と距離で聞こえ方を変える
    const bellPan = context.createStereoPanner();
    const bell = gain(0);
    chain(bell, bellPan, master);

    const trainPan = context.createStereoPanner();
    const train = gain(0);
    chain(loop(noise.brown), filter('lowpass', 240), gain(1.1), train);
    chain(loop(noise.white), filter('bandpass', 2400, 0.7), gain(0.05), train);
    chain(loop(noise.clatter), filter('lowpass', 750), gain(0.9), train);
    chain(train, trainPan, master);

    return { master, drone, buzz, aircon, bell, bellPan, train, trainPan };
  }

  // 踏切の「カン」1回。高さの近い2つの音を重ねて、電子音の鐘らしい濁りを出す
  function strikeBell(time) {
    const envelope = gain(0);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(0.5, time + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + 0.36);
    for (const frequency of [700, 746]) {
      const tone = context.createOscillator();
      tone.type = 'sine';
      tone.frequency.value = frequency;
      tone.connect(envelope);
      tone.start(time);
      tone.stop(time + 0.4);
    }
    envelope.connect(nodes.bell);
  }

  // 住宅街の遠くを車が通り過ぎる音。左右どちらかから反対側へ流れる
  function passCar(time) {
    const duration = 6 + Math.random() * 3;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const source = context.createBufferSource();
    source.buffer = noise.white;
    source.loop = true;
    const band = filter('bandpass', 350, 0.9);
    band.frequency.setValueAtTime(300, time);
    band.frequency.linearRampToValueAtTime(800, time + duration / 2);
    band.frequency.linearRampToValueAtTime(280, time + duration);
    const envelope = gain(0);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(0.07, time + duration / 2);
    envelope.gain.linearRampToValueAtTime(0, time + duration);
    const pan = context.createStereoPanner();
    pan.pan.setValueAtTime(-0.8 * direction, time);
    pan.pan.linearRampToValueAtTime(0.8 * direction, time + duration);
    chain(source, band, envelope, pan, nodes.master);
    source.start(time);
    source.stop(time + duration + 0.1);
  }

  // 聞き手（カメラ）から見た音源の方向と距離
  function locate(position, camera) {
    const local = position.clone().applyMatrix4(camera.matrixWorldInverse);
    const distance = local.length();
    return { distance, pan: Math.max(-1, Math.min(1, local.x / (distance + 0.001))) * 0.85 };
  }

  return {
    get muted() {
      return muted;
    },

    // 訪問者の操作（開始ボタン）をきっかけに呼ぶ。ブラウザは操作なしに音を鳴らせない
    start() {
      if (context) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      try {
        context = new AudioContextClass();
        noise = createNoiseBuffers();
        nodes = build();
        fade(nodes.master.gain, muted ? 0 : MASTER_VOLUME, 1.2);
        nextCarTime = context.currentTime + 12;
      } catch (error) {
        console.error(error);
        context = null;
      }
    },

    setMuted(value) {
      muted = value;
      if (context) fade(nodes.master.gain, muted ? 0 : MASTER_VOLUME, 0.15);
    },

    // タブが裏に回ったら音を止め、戻ったら再開する
    setSuspended(suspended) {
      if (!context) return;
      if (suspended) context.suspend();
      else context.resume();
    },

    // 足音。左右の足で少し音の高さを変える
    step() {
      if (!context || context.state !== 'running') return;
      const time = context.currentTime;
      stepIndex += 1;
      const source = context.createBufferSource();
      source.buffer = noise.step;
      source.playbackRate.value = 0.85 + Math.random() * 0.2;
      const tone = stepIndex % 2 === 0 ? 1050 : 1250;
      chain(source, filter('lowpass', tone + Math.random() * 150), gain(0.2), nodes.master);
      // 濡れた路面の、水をはねる高い音
      const splash = context.createBufferSource();
      splash.buffer = noise.step;
      splash.playbackRate.value = 1.6;
      chain(splash, filter('highpass', 3200), gain(0.045), nodes.master);
      source.start(time);
      splash.start(time + 0.015);
    },

    // weights: 各エリアにいる度合い（合計1）
    // crossing: { alarm, position } / trainCars: 見えている車両の位置の配列
    update({ weights, camera, crossing, trainCars }) {
      if (!context || context.state !== 'running') return;
      const time = context.currentTime;

      // エリアごとの音量を、境目でなめらかに入れ替える
      for (const layer of ['drone', 'buzz', 'aircon']) {
        let level = 0;
        for (const id of Object.keys(weights)) level += (AREA_MIX[id]?.[layer] ?? 0) * weights[id];
        fade(nodes[layer].gain, level);
      }

      // 遠くの車（住宅街にいるときだけ、ときどき）
      if (time >= nextCarTime) {
        if ((weights.houses ?? 0) > 0.5) passCar(time + 0.1);
        nextCarTime = time + 22 + Math.random() * 25;
      }

      // 踏切の警報音：近づくほど大きく、踏切のある方向から聞こえる
      if (crossing?.alarm) {
        const { distance, pan } = locate(crossing.position, camera);
        fade(nodes.bell.gain, 0.55 / (1 + (distance / 9) ** 2), 0.2);
        fade(nodes.bellPan.pan, pan, 0.2);
        if (nextBellTime < time) nextBellTime = time + 0.05;
        while (nextBellTime < time + 0.25) {
          strikeBell(nextBellTime);
          nextBellTime += 0.46;
        }
      } else {
        fade(nodes.bell.gain, 0, 0.3);
        nextBellTime = 0;
      }

      // 電車：いちばん近い車両までの距離で音量を決める
      let nearest = null;
      for (const position of trainCars ?? []) {
        const located = locate(position, camera);
        if (!nearest || located.distance < nearest.distance) nearest = located;
      }
      if (nearest) {
        fade(nodes.train.gain, 0.6 / (1 + (nearest.distance / 11) ** 2), 0.25);
        fade(nodes.trainPan.pan, nearest.pan, 0.25);
      } else {
        fade(nodes.train.gain, 0, 0.5);
      }
    },
  };
}
