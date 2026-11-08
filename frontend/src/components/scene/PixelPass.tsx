"use client";

/**
 * 像素化渲染（16 §5.2）：接管 R3F 的默认渲染循环。
 *
 * 1. 整个场景以 1/pixelScale 分辨率渲染到离屏目标（带深度贴图）；
 * 2. 全屏四边形按最近邻放大回屏幕，同时用深度差描出墨色轮廓——
 *    只给「前景物体挨着更远处」的像素描边，得到与 UI 一致的 1 大像素宽描边；
 * 3. 地名标签（LABEL_LAYER）最后以全分辨率叠加，保证文字可读。
 *
 * 只改变画面，不改变拾取：R3F 指针事件按 CSS 尺寸归一化，与渲染分辨率无关。
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { PX } from "@/lib/palette";
import { LABEL_LAYER } from "./RealCityLayers";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float cameraNear;
uniform float cameraFar;
uniform vec3 ink;
uniform float strength;
varying vec2 vUv;

float viewDistance(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
}

void main() {
  vec4 color = texture2D(tColor, vUv);
  float raw = texture2D(tDepth, vUv).x;
  float z = viewDistance(vUv);
  float zl = viewDistance(vUv - vec2(texel.x, 0.0));
  float zr = viewDistance(vUv + vec2(texel.x, 0.0));
  float zd = viewDistance(vUv - vec2(0.0, texel.y));
  float zu = viewDistance(vUv + vec2(0.0, texel.y));
  // 深度拉普拉斯：平面（地面、墙面、屋顶）≈ 0；只有「我在前、邻居明显更远」才为正。
  // 只描前景一侧，得到与 UI 一致的 1 大像素宽墨线；阈值随距离放宽，远处小楼不糊成一片黑
  float lap = (zl + zr + zd + zu) - 4.0 * z;
  float edge = raw < 1.0 ? step(z * 0.004 + 1.5, lap) : 0.0;
  gl_FragColor = vec4(mix(color.rgb, ink, edge * strength), 1.0);
  #include <colorspace_fragment>
}`;

export default function PixelPass({ pixelScale, outline = 0.85 }: { pixelScale: number; outline?: number }) {
  const gl = useThree((s) => s.gl);

  const target = useMemo(() => {
    const t = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
    });
    t.depthTexture = new THREE.DepthTexture(1, 1);
    return t;
  }, []);

  const { quadScene, quadCamera, material } = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        texel: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 1 },
        cameraFar: { value: 1000 },
        ink: { value: new THREE.Color(PX.ink) },
        strength: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    return { quadScene: scene, quadCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), material: mat };
  }, []);

  useEffect(() => {
    // R3F/three 惯用法：renderer.info 与 shader uniforms 属于外部可变对象，
    // react-hooks/immutability 对 useFrame 内的渲染器状态更新不适用
    /* eslint-disable react-hooks/immutability */
    const info = gl.info;
    info.autoReset = false;
    return () => {
      info.autoReset = true;
      target.dispose();
      target.depthTexture?.dispose();
      material.dispose();
      (quadScene.children[0] as THREE.Mesh).geometry.dispose();
    };
  }, [gl, target, material, quadScene]);

  useFrame(({ gl: renderer, scene, camera, size }) => {
    renderer.info.reset();
    const w = Math.max(1, Math.floor(size.width / pixelScale));
    const h = Math.max(1, Math.floor(size.height / pixelScale));
    if (target.width !== w || target.height !== h) target.setSize(w, h);

    // 1) 低分辨率场景（不含标签层）
    camera.layers.disable(LABEL_LAYER);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // 2) 最近邻放大 + 深度描边
    const cam = camera as THREE.PerspectiveCamera;
    const u = material.uniforms;
    u.tColor.value = target.texture;
    u.tDepth.value = target.depthTexture;
    u.texel.value.set(1 / w, 1 / h);
    u.cameraNear.value = cam.near;
    u.cameraFar.value = cam.far;
    u.strength.value = outline;
    renderer.render(quadScene, quadCamera);

    // 3) 全分辨率叠加地名标签（不重算阴影、不画背景）
    camera.layers.set(LABEL_LAYER);
    const background = scene.background;
    const fog = scene.fog;
    const autoClear = renderer.autoClear;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    scene.background = null;
    scene.fog = null;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.render(scene, camera);
    renderer.shadowMap.autoUpdate = shadowAuto;
    renderer.autoClear = autoClear;
    scene.background = background;
    scene.fog = fog;
    camera.layers.enable(0);
    camera.layers.enable(LABEL_LAYER);
    /* eslint-enable react-hooks/immutability */
  }, 1);

  return null;
}
