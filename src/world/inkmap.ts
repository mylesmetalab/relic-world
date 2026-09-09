import * as THREE from "three";

/**
 * Where the player's light has been. A world-space R8 map, one texel per
 * metre, centred on the origin. The shaders read it as "has this rock ever
 * been printed"; `stamp` inks a disc around a torch each frame. Persistent for
 * the session — the world you have walked stays drawn.
 */
export class InkMap {
  readonly size = 512;
  readonly x0 = -256;
  readonly z0 = -256;
  readonly data: Uint8Array;
  readonly texture: THREE.DataTexture;
  private dirty = false;

  constructor() {
    this.data = new Uint8Array(this.size * this.size);
    this.texture = new THREE.DataTexture(this.data, this.size, this.size, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /** The rect the shaders map world xz into: x0, z0, size, enabled. */
  rect(enabled: boolean): THREE.Vector4 {
    return new THREE.Vector4(this.x0, this.z0, this.size, enabled ? 1 : 0);
  }

  /** Ink a disc: full strength inside `reach * 0.45`, fading to nothing at `reach`. */
  stamp(x: number, z: number, reach: number): void {
    const cx = x - this.x0;
    const cz = z - this.z0;
    const r = reach;
    const ix0 = Math.max(0, Math.floor(cx - r)), ix1 = Math.min(this.size - 1, Math.ceil(cx + r));
    const iz0 = Math.max(0, Math.floor(cz - r)), iz1 = Math.min(this.size - 1, Math.ceil(cz + r));
    const inner = r * 0.45;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const d = Math.hypot(ix + 0.5 - cx, iz + 0.5 - cz);
        if (d >= r) continue;
        const v = d <= inner ? 255 : Math.round(255 * (1 - (d - inner) / (r - inner)));
        const k = iz * this.size + ix;
        if (v > this.data[k]!) {
          this.data[k] = v;
          this.dirty = true;
        }
      }
    }
  }

  /** Upload if anything changed (call once per frame). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.texture.needsUpdate = true;
  }

  /** Fraction of the map that has been inked (HUD). */
  coverage(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i += 16) if (this.data[i]! > 128) n++;
    return n / (this.data.length / 16);
  }
}
