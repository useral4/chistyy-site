import * as THREE from "/vendor/three.module.js";

const canvas = document.querySelector("#heroScene");

if (canvas && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0.8, 9.8);

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

  const keyLight = new THREE.DirectionalLight(0xffffff, 3.8);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);
  scene.add(new THREE.AmbientLight(0xdcebff, 2.2));

  const blue = new THREE.MeshPhysicalMaterial({
    color: 0x1670ff,
    roughness: 0.24,
    metalness: 0.08,
    transmission: 0.12,
    thickness: 0.8,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2
  });
  const cyan = new THREE.MeshPhysicalMaterial({
    color: 0x2fe6ff,
    roughness: 0.18,
    metalness: 0.02,
    transmission: 0.22,
    thickness: 1.2,
    clearcoat: 1
  });
  const red = new THREE.MeshPhysicalMaterial({
    color: 0xff3659,
    roughness: 0.34,
    clearcoat: 0.7
  });
  const green = new THREE.MeshPhysicalMaterial({
    color: 0x16c784,
    roughness: 0.3,
    clearcoat: 0.6
  });
  const white = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.22,
    transmission: 0.18,
    thickness: 0.6,
    clearcoat: 1
  });

  const plateGeometry = new THREE.BoxGeometry(1.5, 2.15, 0.2);
  const cubeGeometry = new THREE.BoxGeometry(0.72, 0.72, 0.72);
  const barGeometry = new THREE.BoxGeometry(0.34, 2.6, 0.34);
  const torusGeometry = new THREE.TorusGeometry(1.7, 0.045, 12, 96);

  const materials = [blue, cyan, white, blue, cyan, white, blue, cyan];
  for (let i = 0; i < 8; i += 1) {
    const plate = new THREE.Mesh(plateGeometry, materials[i]);
    plate.position.set((i - 3.5) * 0.64, Math.sin(i * 0.7) * 0.16, -0.45 - i * 0.04);
    plate.rotation.set(-0.22, 0.54, -0.18 + i * 0.02);
    plate.scale.set(1, 1, 1 + i * 0.02);
    root.add(plate);
  }

  const center = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 2), blue);
  center.position.set(0.25, 0.02, 0.62);
  root.add(center);

  const shield = new THREE.Mesh(new THREE.OctahedronGeometry(0.78, 0), white);
  shield.position.set(0.25, 0.02, 1.5);
  shield.rotation.set(0.4, 0.22, 0.2);
  root.add(shield);

  const orbitA = new THREE.Mesh(torusGeometry, cyan);
  orbitA.rotation.set(1.15, 0.1, -0.15);
  root.add(orbitA);

  const orbitB = new THREE.Mesh(torusGeometry, blue);
  orbitB.scale.set(0.74, 0.74, 0.74);
  orbitB.rotation.set(1.3, 0.86, 0.2);
  root.add(orbitB);

  const accents = [
    { x: -2.7, y: 1.65, z: 1.4, m: red, s: 0.72 },
    { x: 2.85, y: 1.1, z: 1.1, m: green, s: 0.64 },
    { x: -2.85, y: -1.7, z: 0.8, m: cyan, s: 0.58 },
    { x: 2.65, y: -1.55, z: 0.6, m: blue, s: 0.62 }
  ];

  accents.forEach((item) => {
    const cube = new THREE.Mesh(cubeGeometry, item.m);
    cube.position.set(item.x, item.y, item.z);
    cube.scale.setScalar(item.s);
    cube.rotation.set(0.4, 0.7, 0.2);
    root.add(cube);
  });

  for (let i = 0; i < 12; i += 1) {
    const bar = new THREE.Mesh(barGeometry, i % 3 === 0 ? cyan : blue);
    const angle = (i / 12) * Math.PI * 2;
    bar.position.set(Math.cos(angle) * 3.25, Math.sin(angle) * 1.85, -1.1);
    bar.rotation.set(0.3, 0.72, angle);
    bar.scale.y = 0.52 + (i % 4) * 0.16;
    root.add(bar);
  }

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
    root.rotation.y = Math.sin(time * 0.32) * 0.22;
    root.rotation.x = Math.sin(time * 0.22) * 0.08;
    center.rotation.y = time * 0.85;
    center.rotation.x = time * 0.34;
    shield.rotation.y = -time * 0.7;
    orbitA.rotation.z = time * 0.26;
    orbitB.rotation.z = -time * 0.34;
    root.children.forEach((mesh, index) => {
      if (mesh.isMesh) mesh.position.y += Math.sin(time * 0.9 + index) * 0.0009;
    });
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  requestAnimationFrame(animate);
}
