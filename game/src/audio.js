// Synthesised sound: every effect is built from oscillators and filtered
// noise at play time, so the game ships no audio files at all.
export function createAudio() {
  let ctx = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noiseBuffer(duration) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ freq = 180, dur = 0.12, type = 'square', gain = 0.5, slide = 0, noise = 0, lowpass = 0 }) {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    if (noise > 0) {
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(dur);
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpass || 3000;
      const g = c.createGain();
      g.gain.setValueAtTime(noise, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start(t);
      src.stop(t + dur);
    } else {
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slide !== 0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + dur);
    }
  }

  return {
    unlock() { ensure(); },
    setEnabled(value) { enabled = value; },
    shot(weapon) {
      if (weapon === 'longbow') burst({ freq: 120, dur: 0.28, slide: -70, noise: 0.9, lowpass: 1800 });
      else if (weapon === 'hornet') burst({ freq: 320, dur: 0.07, noise: 0.5, lowpass: 4200 });
      else if (weapon === 'p9') burst({ freq: 240, dur: 0.09, noise: 0.55, lowpass: 3500 });
      else burst({ freq: 200, dur: 0.11, noise: 0.7, lowpass: 2800 });
    },
    enemyShot(distance) {
      const gain = Math.max(0.08, 0.5 - distance * 0.008);
      burst({ freq: 200, dur: 0.1, noise: gain, lowpass: 2400 });
    },
    reload() { burst({ freq: 700, dur: 0.05, type: 'square', gain: 0.18 }); },
    hit() { burst({ freq: 1100, dur: 0.05, type: 'sine', gain: 0.3 }); },
    kill() { burst({ freq: 520, dur: 0.12, type: 'sine', gain: 0.35 }); burst({ freq: 780, dur: 0.16, type: 'sine', gain: 0.3 }); },
    hurt() { burst({ freq: 90, dur: 0.18, slide: -40, noise: 0.3, lowpass: 900 }); },
    dryFire() { burst({ freq: 900, dur: 0.03, type: 'square', gain: 0.15 }); },
    plantBeep(final) { burst({ freq: final ? 1400 : 950, dur: 0.09, type: 'sine', gain: 0.4 }); },
    explosion() {
      burst({ freq: 60, dur: 0.9, slide: -30, noise: 1.0, lowpass: 700 });
      burst({ freq: 40, dur: 1.2, type: 'sine', gain: 0.8, slide: -15 });
    },
    roundWin() {
      burst({ freq: 523, dur: 0.14, type: 'sine', gain: 0.35 });
      setTimeout(() => burst({ freq: 659, dur: 0.14, type: 'sine', gain: 0.35 }), 140);
      setTimeout(() => burst({ freq: 784, dur: 0.26, type: 'sine', gain: 0.4 }), 280);
    },
    roundLose() {
      burst({ freq: 392, dur: 0.16, type: 'sine', gain: 0.35 });
      setTimeout(() => burst({ freq: 311, dur: 0.3, type: 'sine', gain: 0.35 }), 170);
    },
    buy() { burst({ freq: 880, dur: 0.06, type: 'sine', gain: 0.25 }); },
    denied() { burst({ freq: 180, dur: 0.12, type: 'square', gain: 0.2 }); },
    throwGrenade() { burst({ freq: 300, dur: 0.08, noise: 0.25, lowpass: 2000 }); },
  };
}
