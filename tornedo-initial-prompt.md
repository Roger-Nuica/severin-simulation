Create an interactive 3D tornado simulator using HTML and JavaScript, with Three.js and a lightweight physics approach (e.g. Cannon-es or Rapier, or hand-rolled force/velocity math if that's simpler and more performant — no need for a full rigid-body engine).

Build this as a single self-contained HTML file with Three.js loaded via CDN. Build it incrementally: scene/camera/lighting first, then the vortex, then the environment objects, then the tiered damage behavior, then the UI/stats panel.

The simulation should allow the user to create and control a tornado by adjusting parameters such as:

Tornado intensity
Wind speed
Tornado size/radius
Rotation speed
Duration
Number and size of objects/debris in the environment (cap total active objects to keep performance smooth — target 60fps on a mid-range laptop, roughly a few hundred debris pieces max)

The user should be able to start, pause, reset, and observe the tornado developing in real time. Include OrbitControls (or similar) so the user can rotate and zoom the camera view.

Create a realistic-looking 3D environment containing buildings, trees, cars, and other objects that can be affected by the tornado. Objects should react to the tornado based on its strength and their physical properties:

Weak tornadoes should mainly move lightweight objects and debris.
Stronger tornadoes should damage buildings, overturn vehicles, uproot trees, and lift objects into the vortex.
Extremely strong tornadoes should cause significant structural destruction and create a large debris field.

For building damage, it doesn't need to be true structural simulation — losing discrete pieces (roof panels, wall sections) or toppling as rigid chunks is enough to sell the effect.

Show relevant simulation information such as wind speed, tornado intensity, radius, objects affected, and an estimated damage score (based on factors like number of objects displaced/destroyed and buildings damaged).

The tornado should have a clearly visible rotating vortex with realistic wind/debris movement. Use physically plausible behavior where practical, but prioritize a visually convincing and interactive simulation over strict accuracy.

The goal is to create an engaging sandbox where the user can experiment with different tornado parameters and observe how the environment reacts.