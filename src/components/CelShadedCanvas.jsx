import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function CelShadedCanvas() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // --- 1. Scene, Camera, Renderer ---
    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(
      40,
      container.clientWidth / container.clientHeight,
      0.1,
      200
    );
    // Start slightly further back for a subtle cinematic ease-in
    camera.position.set(0, 0.25, 17.5);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(renderer.domElement);

    // --- 2. Geometry Utility: Angle-Weighted Smooth Normals for Seamless Outlines ---
    const addSmoothNormals = (geometry) => {
      const posAttr = geometry.attributes.position;
      const index = geometry.index;
      const map = new Map();

      const pA = new THREE.Vector3();
      const pB = new THREE.Vector3();
      const pC = new THREE.Vector3();
      const ab = new THREE.Vector3();
      const ac = new THREE.Vector3();
      const ba = new THREE.Vector3();
      const bc = new THREE.Vector3();
      const ca = new THREE.Vector3();
      const cb = new THREE.Vector3();
      const faceNormal = new THREE.Vector3();

      const keyOf = (v) => `${v.x.toFixed(4)}_${v.y.toFixed(4)}_${v.z.toFixed(4)}`;
      const addWeighted = (v, n, weight) => {
        const key = keyOf(v);
        let acc = map.get(key);
        if (!acc) {
          acc = new THREE.Vector3();
          map.set(key, acc);
        }
        acc.x += n.x * weight;
        acc.y += n.y * weight;
        acc.z += n.z * weight;
      };

      const triCount = index ? index.count / 3 : posAttr.count / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

        pA.fromBufferAttribute(posAttr, i0);
        pB.fromBufferAttribute(posAttr, i1);
        pC.fromBufferAttribute(posAttr, i2);

        ab.subVectors(pB, pA);
        ac.subVectors(pC, pA);
        faceNormal.crossVectors(ab, ac);
        const len = faceNormal.length();
        if (len < 1e-10) continue;
        faceNormal.divideScalar(len);

        ba.subVectors(pA, pB);
        bc.subVectors(pC, pB);
        ca.subVectors(pA, pC);
        cb.subVectors(pB, pC);

        const angleA = ab.angleTo(ac);
        const angleB = ba.angleTo(bc);
        const angleC = ca.angleTo(cb);

        addWeighted(pA, faceNormal, angleA);
        addWeighted(pB, faceNormal, angleB);
        addWeighted(pC, faceNormal, angleC);
      }

      const smoothNormals = new Float32Array(posAttr.count * 3);
      const tmp = new THREE.Vector3();
      for (let i = 0; i < posAttr.count; i++) {
        pA.fromBufferAttribute(posAttr, i);
        const acc = map.get(keyOf(pA));
        if (acc && acc.lengthSq() > 1e-10) {
          tmp.copy(acc).normalize();
        } else {
          tmp.set(0, 0, 1);
        }
        smoothNormals[i * 3] = tmp.x;
        smoothNormals[i * 3 + 1] = tmp.y;
        smoothNormals[i * 3 + 2] = tmp.z;
      }

      geometry.setAttribute('aSmoothNormal', new THREE.BufferAttribute(smoothNormals, 3));
      return geometry;
    };

    const resolutionUniform = { value: new THREE.Vector2(container.clientWidth, container.clientHeight) };

    const createScreenOutlineMaterial = (colorHex, pixelWidth) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(colorHex) },
          uPixelWidth: { value: pixelWidth },
          uResolution: resolutionUniform
        },
        vertexShader: `
          attribute vec3 aSmoothNormal;
          uniform float uPixelWidth;
          uniform vec2 uResolution;
          void main() {
            vec4 clipPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            vec3 viewNormal = normalize(normalMatrix * aSmoothNormal);
            vec2 clipNormal = (mat3(projectionMatrix) * viewNormal).xy;
            float len = length(clipNormal);
            if (len > 0.0001) {
              clipNormal /= len;
            }
            clipPos.xy += clipNormal * (uPixelWidth * 2.0 / uResolution) * clipPos.w;
            gl_Position = clipPos;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          void main() {
            gl_FragColor = vec4(uColor, 1.0);
            #include <colorspace_fragment>
          }
        `,
        side: THREE.BackSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
      });

    const createOutlineMaterial = (colorHex, thickness, opacity = 1.0) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(colorHex) },
          uThickness: { value: thickness },
          uOpacity: { value: opacity }
        },
        vertexShader: `
          attribute vec3 aSmoothNormal;
          uniform float uThickness;
          void main() {
            vec3 pos = position + aSmoothNormal * uThickness;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          void main() {
            gl_FragColor = vec4(uColor, uOpacity);
            #include <colorspace_fragment>
          }
        `,
        side: THREE.BackSide,
        transparent: opacity < 1.0,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
      });

    // --- 3. Cinematic Hero Cel-Shader (Smooth Anti-Aliased Stepped Diffuse + Rim Light) ---
    const createHeroCelMaterial = (highlightHex, midHex, shadowHex, rimHex) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uLightDir: { value: new THREE.Vector3(0.42, 0.58, 0.7).normalize() },
          uHighlight: { value: new THREE.Color(highlightHex) },
          uMid: { value: new THREE.Color(midHex) },
          uShadow: { value: new THREE.Color(shadowHex) },
          uRimColor: { value: new THREE.Color(rimHex) }
        },
        vertexShader: `
          varying vec3 vNormalView;
          varying vec3 vViewPos;
          void main() {
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vViewPos = -mvPos.xyz;
            vNormalView = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          uniform vec3 uLightDir;
          uniform vec3 uHighlight;
          uniform vec3 uMid;
          uniform vec3 uShadow;
          uniform vec3 uRimColor;
          varying vec3 vNormalView;
          varying vec3 vViewPos;

          void main() {
            vec3 n = normalize(vNormalView);
            vec3 v = normalize(vViewPos);
            vec3 l = normalize(uLightDir);

            float ndotl = dot(n, l);

            // Smooth anti-aliased 3-band cel shading (no harsh stair-step glitches)
            float midFactor = smoothstep(-0.04, 0.04, ndotl);
            float highFactor = smoothstep(0.66, 0.73, ndotl);

            vec3 baseColor = mix(uShadow, uMid, midFactor);
            baseColor = mix(baseColor, uHighlight, highFactor);

            // Subtle smooth cel specular on rounded bevels
            vec3 h = normalize(l + v);
            float spec = pow(max(dot(n, h), 0.0), 48.0);
            float celSpec = smoothstep(0.55, 0.65, spec) * 0.22;

            // Clean golden sun-side Fresnel rim light
            float fresnel = 1.0 - max(dot(n, v), 0.0);
            float rim = smoothstep(0.64, 0.74, fresnel) * smoothstep(-0.05, 0.35, ndotl);

            vec3 finalColor = mix(baseColor, uRimColor, rim * 0.52) + vec3(celSpec);
            gl_FragColor = vec4(finalColor, 1.0);
            #include <colorspace_fragment>
          }
        `
      });

    // --- 4. Centerpiece: Sculpted 3D Cel-Shaded Logo ---
    const logoGroup = new THREE.Group();
    scene.add(logoGroup);

    const createLogoShape = (scaleX = 1, scaleY = 1) => {
      const s = new THREE.Shape();
      // Left foot
      s.moveTo(-0.92 * scaleX, -1.58 * scaleY);
      s.lineTo(-0.58 * scaleX, -0.45 * scaleY);
      s.lineTo(-0.92 * scaleX, 1.72 * scaleY);
      // Top-left bar cap
      s.quadraticCurveTo(-0.92 * scaleX, 1.84 * scaleY, -0.78 * scaleX, 1.85 * scaleY);
      s.lineTo(-0.34 * scaleX, 1.90 * scaleY);
      s.quadraticCurveTo(-0.24 * scaleX, 1.90 * scaleY, -0.24 * scaleX, 1.78 * scaleY);
      // Inner top slot down
      s.lineTo(-0.22 * scaleX, -0.05 * scaleY);
      s.quadraticCurveTo(-0.07 * scaleX, -0.18 * scaleY, 0.08 * scaleX, -0.05 * scaleY);
      // Inner top slot up to taller right pillar
      s.lineTo(0.10 * scaleX, 2.02 * scaleY);
      s.quadraticCurveTo(0.10 * scaleX, 2.14 * scaleY, 0.22 * scaleX, 2.15 * scaleY);
      // Top-right bar cap
      s.lineTo(0.86 * scaleX, 2.22 * scaleY);
      s.quadraticCurveTo(0.98 * scaleX, 2.22 * scaleY, 0.96 * scaleX, 2.08 * scaleY);
      // Right outer edge down to waist pinch
      s.lineTo(0.48 * scaleX, -0.42 * scaleY);
      // Flare to bottom-right foot
      s.lineTo(0.76 * scaleX, -1.48 * scaleY);
      s.quadraticCurveTo(0.76 * scaleX, -1.58 * scaleY, 0.64 * scaleX, -1.58 * scaleY);
      s.lineTo(0.18 * scaleX, -1.54 * scaleY);
      s.quadraticCurveTo(0.08 * scaleX, -1.54 * scaleY, 0.07 * scaleX, -1.44 * scaleY);
      // Bottom notch up
      s.lineTo(0.05 * scaleX, -1.04 * scaleY);
      s.quadraticCurveTo(-0.08 * scaleX, -0.92 * scaleY, -0.21 * scaleX, -1.04 * scaleY);
      // Bottom notch down to left foot
      s.lineTo(-0.23 * scaleX, -1.62 * scaleY);
      s.quadraticCurveTo(-0.24 * scaleX, -1.72 * scaleY, -0.35 * scaleX, -1.72 * scaleY);
      s.lineTo(-0.82 * scaleX, -1.69 * scaleY);
      s.quadraticCurveTo(-0.93 * scaleX, -1.68 * scaleY, -0.92 * scaleX, -1.58 * scaleY);
      s.closePath();
      return s;
    };

    // Front Orange 3D Glyph (keep ExtrudeGeometry's crisp flat normals for shading; add angle-weighted smooth normals for outline)
    const frontGeo = new THREE.ExtrudeGeometry(createLogoShape(1.0, 1.0), {
      depth: 0.42,
      bevelEnabled: true,
      bevelSegments: 8,
      steps: 1,
      bevelSize: 0.052,
      bevelThickness: 0.052,
      curveSegments: 36
    });
    addSmoothNormals(frontGeo);

    const orangeMat = createHeroCelMaterial(0xff842e, 0xff6b1a, 0xd44606, 0xffe680);
    const inkOutlineMat = createOutlineMaterial(0x111111, 0.044);

    const frontMesh = new THREE.Mesh(frontGeo, orangeMat);
    const frontOutline = new THREE.Mesh(frontGeo, inkOutlineMat);
    const frontGroup = new THREE.Group();
    frontGroup.add(frontMesh, frontOutline);
    frontGroup.position.set(0, 0, 0.24);
    logoGroup.add(frontGroup);

    // Back/Offset Yellow 3D Layer
    const backGeo = new THREE.ExtrudeGeometry(createLogoShape(1.01, 1.01), {
      depth: 0.48,
      bevelEnabled: true,
      bevelSegments: 8,
      steps: 1,
      bevelSize: 0.055,
      bevelThickness: 0.055,
      curveSegments: 36
    });
    addSmoothNormals(backGeo);

    const yellowMat = createHeroCelMaterial(0xfff15c, 0xffd500, 0xd49b00, 0xffffff);
    const backMesh = new THREE.Mesh(backGeo, yellowMat);
    const backOutline = new THREE.Mesh(backGeo, inkOutlineMat);
    const backGroup = new THREE.Group();
    backGroup.add(backMesh, backOutline);
    backGroup.position.set(0.18, -0.22, -0.24);
    logoGroup.add(backGroup);

    logoGroup.position.set(0, 0.35, 0.8);

    // --- 5. Luminous Atmospheric Cel-Shaded Sun ---
    const sunGroup = new THREE.Group();

    // Soft outer atmospheric bloom glow (radial shader)
    const glowGeo = new THREE.PlaneGeometry(11, 11);
    const glowMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffe766) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
        fragmentShader: `
          uniform vec3 uColor;
          varying vec2 vUv;
          void main() {
            float dist = length(vUv - 0.5) * 2.0;
            float alpha = pow(max(0.0, 1.0 - dist), 2.8) * 0.42;
            gl_FragColor = vec4(uColor, alpha);
            #include <colorspace_fragment>
          }
        `,
      transparent: true,
      depthWrite: false
    });
    const glowPlane = new THREE.Mesh(glowGeo, glowMat);
    sunGroup.add(glowPlane);

    // Crisp inner cel sun disc with subtle warm ring
    const sunDiscGeo = new THREE.SphereGeometry(1.15, 36, 36);
    const sunDiscMat = new THREE.MeshBasicMaterial({ color: 0xffe44d });
    const sunDisc = new THREE.Mesh(sunDiscGeo, sunDiscMat);
    sunGroup.add(sunDisc);

    const sunHaloRingGeo = new THREE.RingGeometry(1.26, 1.5, 48);
    const sunHaloRingMat = new THREE.MeshBasicMaterial({
      color: 0xffef8f,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide
    });
    const sunHaloRing = new THREE.Mesh(sunHaloRingGeo, sunHaloRingMat);
    sunGroup.add(sunHaloRing);

    sunGroup.position.set(8.4, 5.1, -19);
    scene.add(sunGroup);

    // --- 6. Sculpted Ghibli-Style Cel-Shaded Clouds Spread Across Full Sky ---
    const createCloudMaterial = (highlightHex, shadowHex, opacity = 1.0) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uLightDir: { value: new THREE.Vector3(0.45, 0.85, 0.35).normalize() },
          uHighlight: { value: new THREE.Color(highlightHex) },
          uShadow: { value: new THREE.Color(shadowHex) },
          uOpacity: { value: opacity }
        },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uLightDir;
          uniform vec3 uHighlight;
          uniform vec3 uShadow;
          uniform float uOpacity;
          varying vec3 vNormal;
          void main() {
            float ndotl = dot(normalize(vNormal), uLightDir);
            vec3 col = ndotl > 0.08 ? uHighlight : uShadow;
            gl_FragColor = vec4(col, uOpacity);
            #include <colorspace_fragment>
          }
        `,
        transparent: opacity < 1.0
      });

    // 4 distinct sculptural cloud archetypes (wider, organic, flat-bottomed cumulus silhouettes)
    const cloudArchetypes = [
      // Archetype 0: Classic Wide Cumulus
      [
        { x: 0.0, y: 0.25, z: 0.0, rx: 1.05, ry: 0.78, rz: 0.85 },
        { x: -0.9, y: 0.05, z: 0.08, rx: 0.85, ry: 0.62, rz: 0.72 },
        { x: 0.95, y: 0.1, z: -0.05, rx: 0.88, ry: 0.64, rz: 0.74 },
        { x: -1.65, y: -0.18, z: 0.0, rx: 0.65, ry: 0.44, rz: 0.58 },
        { x: 1.75, y: -0.15, z: 0.05, rx: 0.68, ry: 0.45, rz: 0.58 },
        { x: -0.45, y: 0.48, z: 0.12, rx: 0.72, ry: 0.58, rz: 0.68 },
        { x: 0.48, y: 0.42, z: -0.08, rx: 0.68, ry: 0.56, rz: 0.66 },
        { x: 0.0, y: -0.22, z: 0.18, rx: 1.4, ry: 0.36, rz: 0.75 }
      ],
      // Archetype 1: Tall Asymmetric Billow
      [
        { x: -0.2, y: 0.42, z: 0.0, rx: 0.95, ry: 0.85, rz: 0.85 },
        { x: 0.65, y: 0.2, z: 0.1, rx: 0.82, ry: 0.68, rz: 0.75 },
        { x: -1.05, y: 0.02, z: -0.05, rx: 0.75, ry: 0.55, rz: 0.7 },
        { x: 1.38, y: -0.12, z: 0.0, rx: 0.62, ry: 0.44, rz: 0.55 },
        { x: -1.65, y: -0.22, z: 0.05, rx: 0.52, ry: 0.38, rz: 0.5 },
        { x: 0.25, y: 0.68, z: -0.06, rx: 0.62, ry: 0.55, rz: 0.6 },
        { x: 0.0, y: -0.24, z: 0.12, rx: 1.35, ry: 0.34, rz: 0.7 }
      ],
      // Archetype 2: Sleek Horizontal Drift Cloud
      [
        { x: 0.0, y: 0.12, z: 0.0, rx: 1.25, ry: 0.55, rz: 0.8 },
        { x: -1.1, y: -0.02, z: 0.05, rx: 0.9, ry: 0.44, rz: 0.7 },
        { x: 1.15, y: -0.02, z: -0.05, rx: 0.92, ry: 0.45, rz: 0.7 },
        { x: -1.9, y: -0.16, z: 0.0, rx: 0.58, ry: 0.32, rz: 0.5 },
        { x: 1.95, y: -0.14, z: 0.02, rx: 0.62, ry: 0.34, rz: 0.52 },
        { x: 0.35, y: 0.32, z: 0.08, rx: 0.75, ry: 0.44, rz: 0.65 },
        { x: -0.45, y: 0.28, z: -0.06, rx: 0.7, ry: 0.42, rz: 0.62 }
      ],
      // Archetype 3: Soft Puff Trio
      [
        { x: 0.0, y: 0.22, z: 0.0, rx: 0.85, ry: 0.68, rz: 0.78 },
        { x: -0.78, y: -0.04, z: 0.06, rx: 0.66, ry: 0.48, rz: 0.62 },
        { x: 0.82, y: -0.02, z: -0.04, rx: 0.68, ry: 0.5, rz: 0.64 },
        { x: -0.28, y: 0.36, z: -0.08, rx: 0.56, ry: 0.46, rz: 0.56 },
        { x: 0.0, y: -0.2, z: 0.1, rx: 1.05, ry: 0.32, rz: 0.62 }
      ]
    ];

    // Pre-build smooth unit sphere geometry once for fast instancing
    const baseSphereGeo = new THREE.SphereGeometry(1, 24, 24);
    addSmoothNormals(baseSphereGeo);

    // Depth-layered cloud materials with consistent screen-space pixel outlines across all depths
    const farCloudMat = createCloudMaterial(0xeaf5ff, 0xc2e3ff, 1.0);
    const farOutlineMat = createScreenOutlineMaterial(0x1359ba, 1.8);

    const midCloudMat = createCloudMaterial(0xffffff, 0xcbe8ff, 1.0);
    const midOutlineMat = createScreenOutlineMaterial(0x0f4ea8, 2.2);

    const nearCloudMat = createCloudMaterial(0xffffff, 0xd4edff, 1.0);
    const nearOutlineMat = createScreenOutlineMaterial(0x0c4291, 2.5);

    const createCloudInstance = (archetypeIdx, scale, layer) => {
      const specs = cloudArchetypes[archetypeIdx % cloudArchetypes.length];
      const group = new THREE.Group();

      const mat = layer === 'far' ? farCloudMat : layer === 'near' ? nearCloudMat : midCloudMat;
      const outMat = layer === 'far' ? farOutlineMat : layer === 'near' ? nearOutlineMat : midOutlineMat;

      specs.forEach((p) => {
        const puff = new THREE.Group();
        const mesh = new THREE.Mesh(baseSphereGeo, mat);
        const outline = new THREE.Mesh(baseSphereGeo, outMat);
        puff.add(mesh, outline);
        puff.position.set(p.x, p.y, p.z);
        puff.scale.set(p.rx, p.ry, p.rz);
        group.add(puff);
      });

      group.scale.setScalar(scale);
      return group;
    };

    // Helper: get horizontal half-width visible at any Z depth
    const getHalfWidthAtZ = (z, camZ = camera.position.z) => {
      const dist = camZ - z;
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const halfHeight = Math.tan(vFov / 2) * dist;
      return halfHeight * camera.aspect;
    };

    // Responsive layout state updated in handleResize
    let targetCamZ = 14.5;
    let baseLogoScale = 1.06;
    let baseLogoY = 0.35;

    // 14 evenly distributed clouds spanning left, center, right, top, and lower-frame across 3 depth layers
    // Using normalized X (-1.05 to +1.05 of frustum half-width at that depth) so they NEVER bunch on one side!
    const cloudDefs = [
      // Far horizon atmospheric clouds (high & mid sky, spanning full width)
      { nx: -0.92, y: 3.4, z: -18, scale: 1.55, speed: 0.14, arch: 2, layer: 'far', phase: 0.2 },
      { nx: -0.25, y: 4.5, z: -20, scale: 1.4, speed: 0.11, arch: 3, layer: 'far', phase: 1.5 },
      { nx: 0.38, y: 2.7, z: -17, scale: 1.5, speed: 0.13, arch: 0, layer: 'far', phase: 2.8 },
      { nx: 0.95, y: 2.6, z: -19, scale: 1.65, speed: 0.12, arch: 1, layer: 'far', phase: 4.1 },

      // Midground sculptural clouds (evenly distributed left-to-right across sky)
      { nx: -0.85, y: 0.8, z: -9, scale: 1.35, speed: 0.22, arch: 0, layer: 'mid', phase: 0.7 },
      { nx: -0.45, y: 2.3, z: -11, scale: 1.15, speed: 0.19, arch: 1, layer: 'mid', phase: 2.1 },
      { nx: 0.02, y: -2.2, z: -8, scale: 1.3, speed: 0.24, arch: 2, layer: 'mid', phase: 3.4 },
      { nx: 0.48, y: 2.0, z: -10, scale: 1.2, speed: 0.20, arch: 3, layer: 'mid', phase: 4.9 },
      { nx: 0.88, y: -0.3, z: -8.5, scale: 1.4, speed: 0.23, arch: 1, layer: 'mid', phase: 1.2 },
      { nx: -0.62, y: -2.6, z: -9.5, scale: 1.25, speed: 0.21, arch: 2, layer: 'mid', phase: 5.5 },

      // Foreground framing clouds (subtle bottom-left & bottom-right corners + soft depth parallax)
      { nx: -0.88, y: -3.2, z: -3.2, scale: 1.45, speed: 0.30, arch: 0, layer: 'near', phase: 0.9 },
      { nx: 0.86, y: -3.0, z: -2.8, scale: 1.5, speed: 0.32, arch: 1, layer: 'near', phase: 2.7 },
      { nx: -0.28, y: -3.85, z: -4.2, scale: 1.25, speed: 0.28, arch: 2, layer: 'near', phase: 4.3 },
      { nx: 0.36, y: -3.75, z: -3.8, scale: 1.3, speed: 0.29, arch: 3, layer: 'near', phase: 5.8 }
    ];

    const clouds = cloudDefs.map((def) => {
      const mesh = createCloudInstance(def.arch, def.scale, def.layer);
      const hw = getHalfWidthAtZ(def.z, 14.5);
      mesh.position.set(def.nx * hw, def.y, def.z);
      scene.add(mesh);
      return {
        mesh,
        nx: def.nx,
        baseScale: def.scale,
        baseY: def.y,
        z: def.z,
        speed: def.speed,
        phase: def.phase,
        parallaxFactor: def.layer === 'near' ? 0.55 : def.layer === 'mid' ? 0.28 : 0.12
      };
    });

    // --- 7. Minimalist Floating Yellow Sparkles & Sunlit Dust Motes ---
    const sparkles = [];
    const starShape = new THREE.Shape();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? 0.22 : 0.075;
      const a = (i * Math.PI) / 4;
      if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    starShape.closePath();

    const sparkleGeo = new THREE.ExtrudeGeometry(starShape, {
      depth: 0.06,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.015,
      bevelThickness: 0.015
    });
    sparkleGeo.center();
    sparkleGeo.computeVertexNormals();
    addSmoothNormals(sparkleGeo);

    const sparkleOutlineMat = createOutlineMaterial(0x111111, 0.014);

    const sparkleConfigs = [
      { maxX: -3.5, nx: -0.48, y: 1.85, z: -0.6, scale: 0.85, phase: 0.0 },
      { maxX: 3.6, nx: 0.5, y: 1.4, z: -1.1, scale: 0.72, phase: 2.1 },
      { maxX: 2.8, nx: 0.42, y: -1.1, z: -0.5, scale: 0.58, phase: 4.0 },
      { maxX: -2.6, nx: -0.38, y: -1.35, z: -0.9, scale: 0.52, phase: 1.3 }
    ];

    sparkleConfigs.forEach((cfg) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(sparkleGeo, yellowMat));
      g.add(new THREE.Mesh(sparkleGeo, sparkleOutlineMat));
      g.position.set(cfg.maxX, cfg.y, cfg.z);
      g.scale.setScalar(cfg.scale);
      scene.add(g);
      sparkles.push({
        mesh: g,
        maxX: cfg.maxX,
        nx: cfg.nx,
        baseY: cfg.y,
        z: cfg.z,
        phase: cfg.phase
      });
    });

    // Sparse delicate golden sunlit motes drifting gently
    const moteCount = 26;
    const motePositions = new Float32Array(moteCount * 3);
    const motePhases = [];
    for (let i = 0; i < moteCount; i++) {
      motePositions[i * 3] = (Math.random() - 0.5) * 18;
      motePositions[i * 3 + 1] = (Math.random() - 0.5) * 9;
      motePositions[i * 3 + 2] = -6 + Math.random() * 7;
      motePhases.push(Math.random() * Math.PI * 2);
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
    const moteMat = new THREE.PointsMaterial({
      color: 0xffe97d,
      size: 0.075,
      transparent: true,
      opacity: 0.65
    });
    const motes = new THREE.Points(moteGeo, moteMat);
    scene.add(motes);

    // --- 8. Pointer Parallax, Drag Orbit & Gentle Click Spring ---
    let pointerX = 0;
    let pointerY = 0;
    let smoothPX = 0;
    let smoothPY = 0;
    let isDragging = false;
    let dragRotY = 0;
    let dragRotX = 0;
    let prevX = 0;
    let prevY = 0;
    let dragDist = 0;
    let bounceT = 1.0;

    const onPointerMove = (e) => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      pointerX = (e.clientX / w) * 2 - 1;
      pointerY = -(e.clientY / h) * 2 + 1;

      if (isDragging) {
        const dx = e.clientX - prevX;
        const dy = e.clientY - prevY;
        dragDist += Math.abs(dx) + Math.abs(dy);
        dragRotY += dx * 0.009;
        dragRotX += dy * 0.009;
        dragRotX = Math.max(-0.55, Math.min(0.55, dragRotX));
        prevX = e.clientX;
        prevY = e.clientY;
      }
    };

    const onPointerDown = (e) => {
      isDragging = true;
      dragDist = 0;
      prevX = e.clientX;
      prevY = e.clientY;
    };

    const onPointerUp = () => {
      if (isDragging && dragDist < 6) {
        // Gentle refined click bounce
        bounceT = 0.0;
      }
      isDragging = false;
    };

    window.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    // --- 9. Cinematic Animation Loop ---
    const clock = new THREE.Clock();
    let animId;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.getElapsedTime();

      // Smooth camera entrance toward responsive targetCamZ
      camera.position.z += (targetCamZ - camera.position.z) * 0.045;

      // Smooth pointer inertia
      smoothPX += (pointerX - smoothPX) * 0.05;
      smoothPY += (pointerY - smoothPY) * 0.05;

      // Subtle camera parallax
      camera.position.x = smoothPX * 0.45;
      camera.position.y = 0.2 + smoothPY * 0.25;
      camera.lookAt(0, 0.2, 0);

      // Gentle return of drag rotation when released
      if (!isDragging) {
        dragRotY *= 0.94;
        dragRotX *= 0.94;
      }

      // Heroic 3/4 resting tilt + smooth mouse tracking + calm levitation
      const targetY = -0.22 + smoothPX * 0.26 + dragRotY + Math.sin(t * 0.65) * 0.06;
      const targetX = 0.06 - smoothPY * 0.16 + dragRotX;

      logoGroup.rotation.y += (targetY - logoGroup.rotation.y) * 0.07;
      logoGroup.rotation.x += (targetX - logoGroup.rotation.x) * 0.07;
      logoGroup.position.y = baseLogoY + Math.sin(t * 1.45) * 0.13;

      // Subtle squash & stretch spring on click
      if (bounceT < 1.0) {
        bounceT = Math.min(1.0, bounceT + dt * 1.8);
        const decay = Math.exp(-bounceT * 5.0);
        const osc = Math.sin(bounceT * Math.PI * 3.5);
        const s = osc * decay * 0.14;
        logoGroup.scale.set(
          baseLogoScale * (1 + s * 0.7),
          baseLogoScale * (1 - s),
          baseLogoScale * (1 + s * 0.7)
        );
      }

      // Seamless frustum-aware drifting cel clouds
      clouds.forEach((c) => {
        const hw = getHalfWidthAtZ(c.z) * 1.32;
        c.mesh.position.x += c.speed * dt;
        c.mesh.position.y = c.baseY + Math.sin(t * 0.55 + c.phase) * 0.09;

        if (c.mesh.position.x > hw + 2.5) {
          c.mesh.position.x = -hw - 2.5;
        }
      });

      // Gentle sun halo pulse
      const haloScale = 1 + Math.sin(t * 1.1) * 0.045;
      sunHaloRing.scale.set(haloScale, haloScale, 1);

      // Sparkles float & spin softly
      sparkles.forEach((sp) => {
        sp.mesh.position.y = sp.baseY + Math.sin(t * 1.3 + sp.phase) * 0.14;
        sp.mesh.rotation.y = t * 0.55 + sp.phase;
        sp.mesh.rotation.z = Math.sin(t * 0.7 + sp.phase) * 0.12;
      });

      // Drift golden sunlit motes gently upward & across
      const posArr = moteGeo.attributes.position.array;
      for (let i = 0; i < moteCount; i++) {
        posArr[i * 3] += 0.004;
        posArr[i * 3 + 1] += Math.sin(t * 0.8 + motePhases[i]) * 0.002;
        if (posArr[i * 3] > 9) posArr[i * 3] = -9;
      }
      moteGeo.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    };

    animate();

    // --- 10. Responsive Resize (Desktop, Tablet, Mobile Portrait & Mobile Landscape) ---
    let lastAspect = container.clientWidth / Math.max(1, container.clientHeight);
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = Math.max(1, container.clientHeight);
      const aspect = w / h;

      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      resolutionUniform.value.set(w, h);

      // Responsive camera distance, logo scale & vertical offset
      targetCamZ = aspect < 0.85 ? 14.5 + (0.85 - aspect) * 7.5 : h < 500 ? 15.8 : 14.5;
      baseLogoScale = h < 500 ? 0.72 : aspect < 0.7 ? 0.88 : aspect < 1.0 ? 0.96 : 1.06;
      baseLogoY = h < 500 ? 0.52 : aspect < 0.7 ? 0.42 : 0.35;
      logoGroup.scale.setScalar(baseLogoScale);

      // Keep sun visibly framed in upper-right sky across narrow mobile & wide desktop
      const sunHW = getHalfWidthAtZ(-19, targetCamZ);
      sunGroup.position.set(
        Math.min(8.4, sunHW * 0.54),
        h < 500 ? 4.3 : aspect < 0.7 ? 5.6 : 5.1,
        -19
      );
      sunGroup.scale.setScalar(aspect < 0.7 ? 0.85 : 1.0);

      // Keep sparkles framed comfortably around the logo
      sparkles.forEach((sp) => {
        const spHW = getHalfWidthAtZ(sp.z, targetCamZ);
        sp.mesh.position.x = Math.sign(sp.nx) * Math.min(Math.abs(sp.maxX), spHW * Math.abs(sp.nx));
      });

      // Scale cloud puffs proportionally on narrow portrait viewports and re-spread on big aspect shifts
      const cloudScaleMult = aspect < 0.65 ? 0.72 : aspect < 0.95 ? 0.86 : 1.0;
      const aspectChangedSignificantly = Math.abs(aspect - lastAspect) > 0.15;
      clouds.forEach((c) => {
        c.mesh.scale.setScalar(c.baseScale * cloudScaleMult);
        if (aspectChangedSignificantly) {
          const hw = getHalfWidthAtZ(c.z, targetCamZ);
          c.mesh.position.x = c.nx * hw;
        }
      });
      lastAspect = aspect;
    };

    handleResize();
    // Snap initial camera Z slightly further back from targetCamZ for smooth entrance
    camera.position.z = targetCamZ + 2.8;
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-full h-full cursor-grab active:cursor-grabbing z-0 touch-none"
    />
  );
}
