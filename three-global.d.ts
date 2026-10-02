// Makes `THREE.Vector3` and friends usable in JSDoc types of files that do
// not import three themselves (type positions only; values still need an import).
import * as T from 'three';
export = T;
export as namespace THREE;
