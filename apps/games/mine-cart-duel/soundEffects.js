import { assetUrl } from "./assetPaths.js";

const GUNSHOT_SRC = assetUrl("sfx/gunshot.wav");
const RELOAD_SRC = assetUrl("sfx/reload.wav");
const HIT_SRCS = [
  assetUrl("sfx/hit-1.wav"),
  assetUrl("sfx/hit-2.wav"),
  assetUrl("sfx/hit-3.wav"),
  assetUrl("sfx/hit-4.wav"),
];

export class SoundEffects {
  constructor() {
    this.players = new Map();
    this.warmed = false;
    this.reloadDurationMs = 920;
    this.readyPromise = this.preload([GUNSHOT_SRC, RELOAD_SRC, ...HIT_SRCS]);
  }

  preload(sources) {
    return Promise.all(
      sources.map((src) => {
        if (this.players.has(src)) {
          return this.players.get(src).readyPromise;
        }

        const audio = new Audio(src);
        audio.preload = "auto";

        const readyPromise = new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) {
              return;
            }
            settled = true;
            if (src === RELOAD_SRC && Number.isFinite(audio.duration)) {
              this.reloadDurationMs = Math.max(300, Math.round(audio.duration * 1000));
            }
            resolve();
          };

          audio.addEventListener("loadedmetadata", finish, { once: true });
          audio.addEventListener("canplaythrough", finish, { once: true });
          audio.addEventListener("error", finish, { once: true });
        });

        this.players.set(src, { audio, readyPromise });
        audio.load();
        return readyPromise;
      }),
    );
  }

  async ready() {
    await this.readyPromise;
  }

  getReloadDurationMs() {
    return this.reloadDurationMs;
  }

  async unlock() {
    if (this.warmed) {
      return;
    }

    this.warmed = true;
    this.players.forEach((entry) => {
      entry.audio.load();
    });
  }

  playEvents(events = []) {
    events.forEach((event) => {
      if (event.type === "shot") {
        this.playShot(event.actor);
      } else if (event.type === "reload") {
        this.playReload(event.actor);
      } else if (event.type === "hurt") {
        this.playHurt(event.actor);
      }
    });
  }

  playShot(actor) {
    this.playClip(GUNSHOT_SRC, actor === "player" ? 0.84 : 0.72);
  }

  playReload(actor) {
    this.playClip(RELOAD_SRC, actor === "player" ? 0.86 : 0.72);
  }

  playHurt(actor) {
    const index = Math.floor(Math.random() * HIT_SRCS.length);
    this.playClip(HIT_SRCS[index], actor === "player" ? 0.92 : 0.86);
  }

  playClip(src, volume = 1) {
    const entry = this.players.get(src);
    if (!entry) {
      return;
    }

    const player = entry.audio.cloneNode(true);
    player.volume = volume;
    player.play().catch(() => {});
  }
}
