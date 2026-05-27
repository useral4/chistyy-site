import * as THREE from "/vendor/three.module.js";

const canvas = document.querySelector("#heroScene");

if (canvas && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0.45, 9.2);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const root = new THREE.Group();
  scene.add(root);

  scene.add(new THREE.AmbientLight(0xeaf3ff, 2.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 4.2);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x8db9ff, 2.4);
  rimLight.position.set(-4, 2, -3);
  scene.add(rimLight);

  const blue = new THREE.MeshPhysicalMaterial({
    color: 0x3f7df1,
    roughness: 0.38,
    metalness: 0.1,
    clearcoat: 0.7,
    clearcoatRoughness: 0.28
  });

  const blueDark = new THREE.MeshPhysicalMaterial({
    color: 0x184fb7,
    roughness: 0.44,
    metalness: 0.12,
    clearcoat: 0.5
  });

  const silver = new THREE.MeshPhysicalMaterial({
    color: 0xd8e0ea,
    roughness: 0.24,
    metalness: 0.72,
    clearcoat: 0.65
  });

  const white = new THREE.MeshPhysicalMaterial({
    color: 0xf8fbff,
    roughness: 0.34,
    metalness: 0.18,
    clearcoat: 0.6
  });

  const dark = new THREE.MeshStandardMaterial({
    color: 0x071735,
    roughness: 0.55
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.55, 0.78, 10, 10, 2), blue);
  body.position.set(0, -0.42, 0);
  body.rotation.set(-0.08, -0.28, 0.02);
  root.add(body);

  const bodyShadow = new THREE.Mesh(new THREE.BoxGeometry(3.65, 0.5, 0.82), blueDark);
  bodyShadow.position.set(0.08, -2.28, -0.02);
  bodyShadow.rotation.copy(body.rotation);
  root.add(bodyShadow);

  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.18, 1.34, 0.18), white);
  plate.position.set(0.04, -0.44, 0.52);
  plate.rotation.copy(body.rotation);
  root.add(plate);

  const keyCircle = new THREE.Mesh(new THREE.SphereGeometry(0.18, 28, 16), dark);
  keyCircle.position.set(0.04, -0.28, 0.66);
  keyCircle.scale.set(1, 1, 0.32);
  keyCircle.rotation.copy(body.rotation);
  root.add(keyCircle);

  const keySlot = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.72, 3), dark);
  keySlot.position.set(0.04, -0.74, 0.66);
  keySlot.rotation.set(Math.PI, 0, Math.PI / 3);
  root.add(keySlot);

  const shackle = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.16, 22, 90, Math.PI), silver);
  shackle.position.set(0, 1.35, -0.06);
  shackle.rotation.set(0, 0, Math.PI);
  shackle.scale.set(1.05, 1.22, 1);
  root.add(shackle);

  const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.52, 24), silver);
  leftLeg.position.set(-1.52, 0.72, -0.06);
  root.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.52, 24), silver);
  rightLeg.position.set(1.52, 0.72, -0.06);
  root.add(rightLeg);

  function makeAsterisk(scale = 1) {
    const group = new THREE.Group();
    for (let i = 0; i < 3; i += 1) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.12, 0.12), silver);
      bar.rotation.z = (Math.PI / 3) * i;
      group.add(bar);
    }
    group.scale.setScalar(scale);
    return group;
  }

  const stars = [
    { x: -2.65, y: 0.95, s: 0.72, r: -0.2 },
    { x: 2.35, y: 0.92, s: 0.56, r: 0.35 },
    { x: -2.15, y: -1.82, s: 0.48, r: 0.55 },
    { x: 2.15, y: -1.52, s: 0.9, r: -0.35 }
  ].map((item) => {
    const star = makeAsterisk(item.s);
    star.position.set(item.x, item.y, 0.62);
    star.rotation.z = item.r;
    root.add(star);
    return star;
  });

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 80),
    new THREE.MeshBasicMaterial({ color: 0x90b7ff, transparent: true, opacity: 0.08 })
  );
  floor.position.set(0.2, -2.78, -1.1);
  floor.scale.set(1.4, 0.32, 1);
  root.add(floor);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const clock = new THREE.Clock();
  function animate() {
    const time = clock.getElapsedTime();
    root.rotation.y = Math.sin(time * 0.28) * 0.16;
    root.rotation.x = Math.sin(time * 0.22) * 0.035;
    root.position.y = Math.sin(time * 0.75) * 0.08;
    stars.forEach((star, index) => {
      star.rotation.z += 0.0025 + index * 0.0005;
      star.position.y += Math.sin(time * 1.1 + index) * 0.0007;
    });
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  requestAnimationFrame(animate);
}
