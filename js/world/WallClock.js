// The wall clock above the ammo table: shows how far through the night you are (10 pm → 6 am at dawn).
// Code-made: a dark wooden rim, a yellowed paper face, two iron hands. Driven by WaveSystem.clockHours.
import * as THREE from 'three';
import { WALL_CLOCK } from './Layout.js';

export class WallClock {
  constructor(scene) {
    const R = WALL_CLOCK.radius;
    const g = new THREE.Group();
    g.position.copy(WALL_CLOCK.position);
    g.rotation.y = Math.PI;   // the face looks into the room (the south wall faces -z)
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.12, R * 1.12, 0.05, 32), new THREE.MeshStandardMaterial({ color: 0x2a1a0e, roughness: 0.7 }));
    rim.rotation.x = Math.PI / 2;
    g.add(rim);
    const face = new THREE.Mesh(new THREE.CircleGeometry(R, 32), new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.9 }));
    face.position.z = 0.026;
    g.add(face);
    const iron = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.4 });
    const hand = (len, w) => {
      const pivot = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.004), iron);
      m.position.y = len / 2 - len * 0.12;
      pivot.add(m);
      pivot.position.z = 0.03;
      g.add(pivot);
      return pivot;
    };
    this.hour = hand(R * 0.55, 0.014);
    this.minute = hand(R * 0.85, 0.009);
    this.minute.position.z = 0.034;
    scene.add(g);
    this.group = g;
  }

  /** hours: time of day, may run past 24 (22 .. 30). */
  set(hours) {
    const h = hours % 12, m = (hours % 1) * 60;
    // the group is turned to face the room, so clockwise on the face is +z rotation here
    this.hour.rotation.z = -(h / 12) * Math.PI * 2;
    this.minute.rotation.z = -(m / 60) * Math.PI * 2;
  }
}

function faceTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#c9b88f'; x.fillRect(0, 0, 256, 256);
  // age stains
  for (let i = 0; i < 30; i++) {
    x.fillStyle = `rgba(90,60,20,${Math.random() * 0.08})`;
    x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 40, 0, 7); x.fill();
  }
  x.translate(128, 128);
  x.fillStyle = '#1b140c';
  x.font = 'bold 30px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const roman = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    x.fillText(roman[i], Math.sin(a) * 92, -Math.cos(a) * 92);
    x.fillRect(Math.sin(a) * 116 - 2, -Math.cos(a) * 116 - 2, 4, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
