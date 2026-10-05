---
name: vfx-particle-pool
description: Use when adding or changing transient Three.js particles, smoke, embers, snow, or other pooled VFX; follow the shared pool and global particle budget.
---

# Shared VFX Particle Pools

Create transient point effects with the existing fixed-size particle pools and shared capacity tracker instead of allocating per-particle scene objects.

**SAVES:** Keeps tracked emissions within the actual 10,000-particle ceiling and avoids rebuilding particle buffers during updates.

**SOURCE:** `src/app/tornado/engine/particlePool.js`; `src/app/tornado/engine/perf/caps.js`; `src/app/tornado/engine/player/blackHole/matter.js`; `src/app/tornado/engine/yeti.js`; `PROJECT_HISTORY.md` (findings), “Particle budget”.

## How it works

- `createParticlePool(scene, count, map, blending, name, options)` allocates fixed `Float32Array` buffers for positions, RGBA colours, sizes, velocities and lifetimes, then creates one `THREE.Points` object. Its `position`, `aColour` and `aSize` attributes use `THREE.DynamicDrawUsage` (`particlePool.js:75-125`).
- The shader reads per-particle colour and size, allowing particles in the same pool to grow, shrink and fade without one mesh per particle (`particlePool.js:14-45`).
- `markPoolDirty(pool)` flags the three dynamic attributes for upload after in-place mutation (`particlePool.js:128-137`). `disposeParticlePool(scene, pool)` removes the Points object and disposes its geometry, texture and material (`particlePool.js:140-153`).
- `CAPS.particles` is a shared 10,000 particle ceiling across tracked pools. Effects check `ctx.systems.caps.particleRoom()` before emitting; pools created after startup register with `trackPool()` (`perf/caps.js:24-31, 49-60`).
- `blackHole/matter.js` creates one pool for the hole's matter and tracks it with `ctx.systems.caps.trackPool(pool)`; `yeti.js` creates a snow pool during initialization (`blackHole/matter.js:56-58`; `yeti.js:372`).

## How to extend it

1. Find the existing effect owner and reuse its pool if the new particles belong to that effect family.
2. Create a fixed-capacity pool during the owning system's initialization, not inside its per-frame update.
3. Before each emission, limit requested particles to `ctx.systems.caps.particleRoom()`; track pools created after the caps system's initial scene scan.
4. Reuse buffer slots and mutate typed arrays in place. After writing attributes, call `markPoolDirty(pool)`.
5. Follow the owner system's reset/dispose lifecycle. Call `disposeParticlePool` when the pool is destroyed; the current helper disposes the pool's texture too, so give it a texture owned by that pool.

## Pitfalls / common mistakes

- Do not instantiate `Mesh` or `Points` per particle or allocate a fresh typed array each frame.
- Do not treat a pool's local `count` as extra capacity beyond the global 10,000 budget.
- Do not omit `trackPool()` for a pool created after `initCaps()`.
- Do not forget to mark updated attributes dirty or to dispose pool GPU resources through the existing helper.
