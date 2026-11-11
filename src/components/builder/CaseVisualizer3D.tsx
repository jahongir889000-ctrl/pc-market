'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { useBuilder } from '@/lib/builder-context';
import { useI18n } from '@/lib/i18n/context';
import { BuildConfiguration } from '@/lib/compatibility';
import { Rotate3d, Eye, Palette, Sparkles, Pause, Play, MousePointerClick, Zap } from 'lucide-react';

type SlotKey = keyof BuildConfiguration;
type CameraView = 'iso' | 'inside' | 'front' | 'top';

interface CaseVisualizer3DProps {
  onSelectSlot?: (slot: SlotKey) => void;
}

const SLOT_LABELS: Record<SlotKey, { ru: string; uz: string }> = {
  cpu: { ru: 'Процессор', uz: 'Protsessor' },
  motherboard: { ru: 'Материнская плата', uz: 'Ona plata' },
  ram: { ru: 'Оперативная память', uz: 'Tezkor xotira' },
  gpu: { ru: 'Видеокарта', uz: 'Videokarta' },
  cooler: { ru: 'Охлаждение', uz: 'Sovutish' },
  storage: { ru: 'SSD накопитель', uz: 'SSD disk' },
  psu: { ru: 'Блок питания', uz: 'Quvvat bloki' },
  case: { ru: 'Корпус', uz: 'Korpus' },
};

const CAMERA_VIEWS: Record<CameraView, { pos: [number, number, number]; target: [number, number, number] }> = {
  iso: { pos: [4.6, 2.9, 4.9], target: [0, 1.3, 0] },
  inside: { pos: [2.5, 1.8, 0.7], target: [-0.35, 1.5, -0.35] },
  front: { pos: [0.4, 1.5, 5.8], target: [0, 1.3, 0] },
  top: { pos: [2.4, 5.6, 1.6], target: [0, 1.1, 0] },
};

// Case dimensions (X = width, Y = height, Z = depth; glass side = +X, front = +Z)
const W = 1.5;
const H = 2.5;
const D = 2.7;
const MB_X = -W / 2 + 0.07;

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

interface BuildCtx {
  rgbMats: Array<{ mat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | THREE.LineBasicMaterial; keepColor?: boolean }>;
  lights: THREE.PointLight[];
  fans: Array<{ rotor: THREE.Object3D; speed: number }>;
  spinners: THREE.Object3D[];
  ghostMats: Array<THREE.MeshBasicMaterial | THREE.LineBasicMaterial>;
  disposables: Array<{ dispose: () => void }>;
  rgb: THREE.Color;
  mat: Record<string, THREE.Material>;
  rgbMat: THREE.MeshStandardMaterial;
  rgbSoft: THREE.MeshStandardMaterial;
}

function track<T extends { dispose: () => void }>(ctx: BuildCtx, item: T): T {
  ctx.disposables.push(item);
  return item;
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function makePcbTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#070b14';
  g.fillRect(0, 0, 512, 512);
  const rnd = seeded(42);
  g.lineWidth = 2;
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(56, 220, 255, ${0.08 + rnd() * 0.18})`;
    let x = rnd() * 512;
    let y = rnd() * 512;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      if (rnd() > 0.5) x += (rnd() - 0.5) * 220;
      else y += (rnd() - 0.5) * 220;
      g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = 'rgba(120, 240, 255, 0.35)';
    g.fillRect(x - 3, y - 3, 6, 6);
  }
  g.strokeStyle = 'rgba(56,220,255,0.25)';
  g.lineWidth = 4;
  g.strokeRect(10, 10, 492, 492);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeLabelTexture(text: string, sub?: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 192;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#ffffff';
  g.font = '900 96px "Unbounded", "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 512, sub ? 80 : 96);
  if (sub) {
    g.font = '600 40px "JetBrains Mono", monospace';
    g.globalAlpha = 0.7;
    g.fillText(sub, 512, 156);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFan(ctx: BuildCtx, size: number, opts: { frame?: boolean; speed?: number } = {}) {
  const g = new THREE.Group();
  const r = size / 2;
  const depth = size * 0.24;
  if (opts.frame !== false) {
    const t = size * 0.07;
    const bars: Array<[number, number, number, number]> = [
      [0, r - t / 2, size, t],
      [0, -r + t / 2, size, t],
      [r - t / 2, 0, t, size],
      [-r + t / 2, 0, t, size],
    ];
    bars.forEach(([x, y, w, h]) => {
      const m = new THREE.Mesh(track(ctx, new THREE.BoxGeometry(w, h, depth)), ctx.mat.frame);
      m.position.set(x, y, 0);
      g.add(m);
    });
  }
  const ringGeo = track(ctx, new THREE.TorusGeometry(r * 0.84, size * 0.022, 10, 56));
  const ringA = new THREE.Mesh(ringGeo, ctx.rgbMat);
  ringA.position.z = depth / 2;
  const ringB = new THREE.Mesh(ringGeo, ctx.rgbMat);
  ringB.position.z = -depth / 2;
  g.add(ringA, ringB);

  const rotor = new THREE.Group();
  const hub = new THREE.Mesh(track(ctx, new THREE.CylinderGeometry(r * 0.27, r * 0.27, depth * 0.7, 28)), ctx.mat.hub);
  hub.rotation.x = Math.PI / 2;
  rotor.add(hub);
  const cap = new THREE.Mesh(track(ctx, new THREE.CircleGeometry(r * 0.18, 28)), ctx.rgbMat);
  cap.position.z = depth * 0.36;
  rotor.add(cap);
  const bladeGeo = track(ctx, new THREE.BoxGeometry(r * 0.6, r * 0.34, size * 0.008));
  const blades = 9;
  for (let i = 0; i < blades; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i * Math.PI * 2) / blades;
    const blade = new THREE.Mesh(bladeGeo, ctx.mat.blade);
    blade.position.x = r * 0.55;
    blade.rotation.x = 0.6;
    blade.rotation.z = 0.18;
    pivot.add(blade);
    rotor.add(pivot);
  }
  g.add(rotor);
  ctx.fans.push({ rotor, speed: opts.speed ?? 10 });
  return g;
}

function makeGhost(ctx: BuildCtx, w: number, h: number, d: number) {
  const g = new THREE.Group();
  const fill = track(ctx, new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.03, depthWrite: false }));
  const line = track(ctx, new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 }));
  ctx.ghostMats.push(fill, line);
  const geo = track(ctx, new THREE.BoxGeometry(w, h, d));
  g.add(new THREE.Mesh(geo, fill));
  g.add(new THREE.LineSegments(track(ctx, new THREE.EdgesGeometry(geo)), line));
  g.userData.ghost = true;
  return g;
}

function tube(ctx: BuildCtx, points: THREE.Vector3[], radius: number, mat: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(track(ctx, new THREE.TubeGeometry(curve, 48, radius, 12, false)), mat);
}

function box(ctx: BuildCtx, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, rounded = 0) {
  const geo = rounded > 0 ? new RoundedBoxGeometry(w, h, d, 3, rounded) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(track(ctx, geo), mat);
  m.position.set(x, y, z);
  return m;
}

function slotGroup(slot: SlotKey) {
  const g = new THREE.Group();
  g.userData.slot = slot;
  return g;
}

function buildPc(build: BuildConfiguration, ctx: BuildCtx): Record<SlotKey, THREE.Group> {
  const m = ctx.mat;
  const groups = {} as Record<SlotKey, THREE.Group>;

  // ======================= CASE / CHASSIS =======================
  const chassis = slotGroup('case');
  groups.case = chassis;
  const post = 0.06;
  [
    [W / 2 - post / 2, D / 2 - post / 2],
    [-W / 2 + post / 2, D / 2 - post / 2],
    [W / 2 - post / 2, -D / 2 + post / 2],
    [-W / 2 + post / 2, -D / 2 + post / 2],
  ].forEach(([x, z]) => chassis.add(box(ctx, post, H, post, m.chassis, x, H / 2, z, 0.02)));
  chassis.add(box(ctx, W, 0.05, D, m.chassis, 0, 0.025, 0, 0.02)); // bottom
  chassis.add(box(ctx, W, 0.05, D, m.chassis, 0, H - 0.025, 0, 0.02)); // top
  chassis.add(box(ctx, W - 0.1, 0.012, D - 0.4, m.mesh, 0, H + 0.002, 0)); // top mesh vent
  chassis.add(box(ctx, 0.03, H - 0.05, D - 0.05, m.chassisInner, -W / 2 + 0.015, H / 2, 0)); // right steel panel
  chassis.add(box(ctx, W - 0.05, H - 0.05, 0.03, m.chassisInner, 0, H / 2, -D / 2 + 0.015)); // rear
  chassis.add(box(ctx, W, H, 0.05, m.mesh, 0, H / 2, D / 2 - 0.025)); // front mesh
  // Front vertical LED strips
  chassis.add(box(ctx, 0.025, H - 0.25, 0.02, ctx.rgbMat, W / 2 - 0.09, H / 2, D / 2 + 0.005));
  chassis.add(box(ctx, 0.025, H - 0.25, 0.02, ctx.rgbMat, -W / 2 + 0.09, H / 2, D / 2 + 0.005));
  // Power button
  const btn = new THREE.Mesh(track(ctx, new THREE.TorusGeometry(0.035, 0.008, 8, 24)), ctx.rgbMat);
  btn.rotation.x = -Math.PI / 2;
  btn.position.set(0.45, H + 0.01, D / 2 - 0.15);
  chassis.add(btn);
  // Feet
  [[0.55, 1.1], [-0.55, 1.1], [0.55, -1.1], [-0.55, -1.1]].forEach(([x, z]) => {
    const f = new THREE.Mesh(track(ctx, new THREE.CylinderGeometry(0.06, 0.07, 0.05, 20)), m.chassis);
    f.position.set(x, -0.02, z);
    chassis.add(f);
  });
  // Front intake fans (behind mesh)
  [0.98, 1.58, 2.15].forEach((y) => {
    const fan = makeFan(ctx, 0.52, { speed: 9 });
    fan.position.set(0, y, D / 2 - 0.2);
    chassis.add(fan);
  });
  // Rear exhaust
  const rearFan = makeFan(ctx, 0.45, { speed: 11 });
  rearFan.position.set(0.1, 2.0, -D / 2 + 0.15);
  chassis.add(rearFan);

  // PSU shroud (front part closed, rear part open to show PSU)
  chassis.add(box(ctx, W - 0.08, 0.03, D - 0.12, m.chassisInner, 0, 0.62, 0));
  chassis.add(box(ctx, 0.025, 0.6, 1.5, m.chassisInner, W / 2 - 0.06, 0.32, 0.5));
  chassis.add(box(ctx, 0.03, 0.015, D - 0.14, ctx.rgbMat, W / 2 - 0.06, 0.635, 0));
  const shroudLabelMat = track(ctx, new THREE.MeshBasicMaterial({ map: track(ctx, makeLabelTexture('JK', 'MARKET.UZ')), transparent: true, color: ctx.rgb.clone(), depthWrite: false }));
  ctx.rgbMats.push({ mat: shroudLabelMat });
  const shroudLabel = new THREE.Mesh(track(ctx, new THREE.PlaneGeometry(0.95, 0.18)), shroudLabelMat);
  shroudLabel.rotation.y = Math.PI / 2;
  shroudLabel.position.set(W / 2 - 0.045, 0.34, 0.5);
  chassis.add(shroudLabel);

  // Tempered glass panel (animated separately)
  const glass = new THREE.Group();
  glass.name = 'glassPanel';
  const glassGeo = track(ctx, new THREE.BoxGeometry(0.02, H - 0.04, D - 0.04));
  const glassMesh = new THREE.Mesh(glassGeo, m.glass);
  glassMesh.raycast = () => {};
  glass.add(glassMesh);
  const glassEdges = new THREE.LineSegments(track(ctx, new THREE.EdgesGeometry(glassGeo)), m.glassEdge);
  glassEdges.raycast = () => {};
  glass.add(glassEdges);
  glass.position.set(W / 2 + 0.012, H / 2, 0);

  // ======================= MOTHERBOARD =======================
  if (build.motherboard) {
    const mb = slotGroup('motherboard');
    mb.add(box(ctx, 0.025, 1.6, 1.55, m.pcb, MB_X, 1.55, -0.38));
    // I/O shroud with RGB
    const io = box(ctx, 0.12, 0.55, 0.2, m.frame, MB_X + 0.07, 2.05, -1.04, 0.02);
    mb.add(io);
    mb.add(box(ctx, 0.01, 0.5, 0.02, ctx.rgbMat, MB_X + 0.135, 2.05, -0.94));
    // VRM heatsinks
    mb.add(box(ctx, 0.09, 0.13, 0.5, m.alu, MB_X + 0.055, 2.2, -0.55, 0.015));
    mb.add(box(ctx, 0.09, 0.5, 0.13, m.alu, MB_X + 0.055, 1.82, -0.88, 0.015));
    // Chipset heatsink
    const chip = box(ctx, 0.04, 0.32, 0.38, m.alu, MB_X + 0.03, 0.98, 0.05, 0.01);
    mb.add(chip);
    mb.add(box(ctx, 0.005, 0.02, 0.3, ctx.rgbMat, MB_X + 0.052, 0.98, 0.05));
    // PCIe slots
    mb.add(box(ctx, 0.03, 0.035, 0.95, m.silver, MB_X + 0.025, 1.27, -0.6));
    mb.add(box(ctx, 0.03, 0.035, 0.95, m.frame, MB_X + 0.025, 0.88, -0.6));
    // DIMM slots
    [-0.18, -0.12, -0.06, 0.0].forEach((z) => mb.add(box(ctx, 0.03, 0.62, 0.025, m.frame, MB_X + 0.025, 1.82, z)));
    // 24-pin header
    mb.add(box(ctx, 0.06, 0.24, 0.05, m.frame, MB_X + 0.04, 1.72, 0.3));
    // CPU socket frame
    mb.add(box(ctx, 0.02, 0.34, 0.34, m.silver, MB_X + 0.02, 1.85, -0.55));
    groups.motherboard = mb;
  } else {
    const ghost = makeGhost(ctx, 0.05, 1.6, 1.55);
    ghost.position.set(MB_X, 1.55, -0.38);
    const mb = slotGroup('motherboard');
    mb.add(ghost);
    groups.motherboard = mb;
  }

  // ======================= CPU =======================
  {
    const cpu = slotGroup('cpu');
    if (build.cpu) {
      cpu.add(box(ctx, 0.03, 0.24, 0.24, m.ihs, MB_X + 0.04, 1.85, -0.55, 0.01));
    } else {
      const ghost = makeGhost(ctx, 0.05, 0.26, 0.26);
      ghost.position.set(MB_X + 0.045, 1.85, -0.55);
      cpu.add(ghost);
    }
    groups.cpu = cpu;
  }

  // ======================= COOLER =======================
  {
    const cooler = slotGroup('cooler');
    if (build.cooler && build.cooler.coolerType && build.cooler.coolerType.startsWith('AIO')) {
      // Pump with infinity-mirror rings
      const pump = new THREE.Group();
      pump.position.set(MB_X + 0.13, 1.85, -0.55);
      const body = new THREE.Mesh(track(ctx, new THREE.CylinderGeometry(0.17, 0.17, 0.14, 48)), m.frame);
      body.rotation.z = Math.PI / 2;
      pump.add(body);
      const face = new THREE.Mesh(track(ctx, new THREE.CircleGeometry(0.15, 48)), m.mirror);
      face.rotation.y = Math.PI / 2;
      face.position.x = 0.071;
      pump.add(face);
      const rings = new THREE.Group();
      [0.145, 0.115, 0.085, 0.055].forEach((r, i) => {
        const ring = new THREE.Mesh(track(ctx, new THREE.TorusGeometry(r, 0.007, 8, 64)), i === 0 ? ctx.rgbMat : ctx.rgbSoft);
        ring.rotation.y = Math.PI / 2;
        ring.position.x = 0.072 - i * 0.008;
        rings.add(ring);
      });
      const arc = new THREE.Mesh(track(ctx, new THREE.TorusGeometry(0.1, 0.012, 8, 32, Math.PI * 0.6)), ctx.rgbMat);
      arc.rotation.y = Math.PI / 2;
      arc.position.x = 0.075;
      const arcPivot = new THREE.Group();
      arcPivot.add(arc);
      ctx.spinners.push(arcPivot);
      pump.add(rings, arcPivot);
      cooler.add(pump);

      // Radiator 360 on top
      const radLen = build.cooler.coolerType === 'AIO_240' ? 0.95 : 1.4;
      const rad = new THREE.Group();
      rad.position.set(0.08, H - 0.14, -0.2);
      rad.add(box(ctx, 0.45, 0.07, radLen, m.frame, 0, 0, 0, 0.01));
      const finsCount = Math.round(radLen * 60);
      const finGeo = track(ctx, new THREE.BoxGeometry(0.42, 0.075, 0.006));
      const fins = new THREE.InstancedMesh(finGeo, m.alu, finsCount);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < finsCount; i++) {
        dummy.position.set(0, 0, -radLen / 2 + 0.03 + (i / finsCount) * (radLen - 0.06));
        dummy.updateMatrix();
        fins.setMatrixAt(i, dummy.matrix);
      }
      rad.add(fins);
      const fanCount = radLen > 1.2 ? 3 : 2;
      for (let f = 0; f < fanCount; f++) {
        const fan = makeFan(ctx, 0.42, { speed: 12 });
        fan.rotation.x = Math.PI / 2;
        fan.position.set(0, -0.1, (f - (fanCount - 1) / 2) * 0.45);
        rad.add(fan);
      }
      cooler.add(rad);

      // Tubes
      const p0 = new THREE.Vector3(MB_X + 0.2, 1.95, -0.48);
      const p1 = new THREE.Vector3(MB_X + 0.2, 1.95, -0.62);
      cooler.add(tube(ctx, [p0, new THREE.Vector3(0.0, 2.15, -0.35), new THREE.Vector3(0.15, 2.3, -0.6), new THREE.Vector3(0.25, H - 0.16, -0.2 - radLen / 2 + 0.04)], 0.032, m.sleeve));
      cooler.add(tube(ctx, [p1, new THREE.Vector3(-0.05, 2.2, -0.7), new THREE.Vector3(0.05, 2.32, -0.85), new THREE.Vector3(0.12, H - 0.16, -0.2 - radLen / 2 + 0.04)], 0.032, m.sleeve));
    } else if (build.cooler) {
      // Tower air cooler
      const tower = new THREE.Group();
      tower.position.set(0, 1.85, -0.55);
      tower.add(box(ctx, 0.05, 0.22, 0.22, m.copper, MB_X + 0.07, 0, 0, 0.01));
      [-0.07, -0.025, 0.025, 0.07].forEach((z) => {
        const pipe = new THREE.Mesh(track(ctx, new THREE.CylinderGeometry(0.016, 0.016, 0.52, 12)), m.copper);
        pipe.rotation.z = Math.PI / 2;
        pipe.position.set(MB_X + 0.34, 0.06, z);
        tower.add(pipe);
      });
      const finCount = 42;
      const fins = new THREE.InstancedMesh(track(ctx, new THREE.BoxGeometry(0.006, 0.56, 0.4)), m.alu, finCount);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < finCount; i++) {
        dummy.position.set(MB_X + 0.14 + i * 0.0105, 0.06, 0);
        dummy.updateMatrix();
        fins.setMatrixAt(i, dummy.matrix);
      }
      tower.add(fins);
      const capX = MB_X + 0.14 + finCount * 0.0105 + 0.01;
      tower.add(box(ctx, 0.025, 0.58, 0.42, m.frame, capX, 0.06, 0, 0.01));
      tower.add(box(ctx, 0.008, 0.5, 0.012, ctx.rgbMat, capX + 0.014, 0.06, 0.17));
      tower.add(box(ctx, 0.008, 0.5, 0.012, ctx.rgbMat, capX + 0.014, 0.06, -0.17));
      const fan = makeFan(ctx, 0.5, { speed: 12 });
      fan.position.set(MB_X + 0.36, 0.06, 0.27);
      tower.add(fan);
      cooler.add(tower);
    } else {
      const ghost = makeGhost(ctx, 0.5, 0.58, 0.5);
      ghost.position.set(MB_X + 0.34, 1.9, -0.55);
      cooler.add(ghost);
    }
    groups.cooler = cooler;
  }

  // ======================= RAM =======================
  {
    const ram = slotGroup('ram');
    if (build.ram) {
      [-0.12, 0.0].forEach((z) => {
        const stick = new THREE.Group();
        stick.position.set(MB_X + 0.13, 1.82, z);
        stick.add(box(ctx, 0.17, 0.6, 0.032, m.ramSpreader, 0, 0, 0, 0.006));
        stick.add(box(ctx, 0.002, 0.42, 0.034, m.alu, 0, 0.02, 0)); // accent line
        const diffuser = box(ctx, 0.045, 0.6, 0.03, ctx.rgbMat, 0.105, 0, 0, 0.008);
        stick.add(diffuser);
        ram.add(stick);
      });
    } else {
      const ghost = makeGhost(ctx, 0.2, 0.62, 0.18);
      ghost.position.set(MB_X + 0.13, 1.82, -0.09);
      ram.add(ghost);
    }
    groups.ram = ram;
  }

  // ======================= GPU =======================
  {
    const gpu = slotGroup('gpu');
    if (build.gpu) {
      const len = Math.min(2.2, Math.max(1.0, (build.gpu.gpuLength || 280) / 200));
      const width = 0.56;
      const thick = 0.22;
      const g = new THREE.Group();
      g.position.set(MB_X + 0.03 + width / 2, 1.14, -D / 2 + 0.08 + len / 2);
      g.add(box(ctx, width, thick, len, m.gpuShroud, 0, 0, 0, 0.03));
      // Backplate (top)
      g.add(box(ctx, width + 0.01, 0.015, len + 0.01, m.backplate, 0, thick / 2 + 0.008, 0, 0.005));
      // Accent cuts on backplate
      g.add(box(ctx, 0.012, 0.004, len * 0.7, ctx.rgbMat, width * 0.25, thick / 2 + 0.017, 0));
      // Fans (facing down)
      const fanCount = len > 1.35 ? 3 : 2;
      const fanSize = Math.min(0.46, (len - 0.1) / fanCount);
      for (let f = 0; f < fanCount; f++) {
        const fan = makeFan(ctx, fanSize, { frame: false, speed: 14 });
        fan.rotation.x = Math.PI / 2;
        fan.position.set(0, -thick / 2 - 0.005, (f - (fanCount - 1) / 2) * (len / fanCount));
        g.add(fan);
      }
      // Glass-side edge: RGB strip + logo
      g.add(box(ctx, 0.012, 0.03, len * 0.86, ctx.rgbMat, width / 2 + 0.004, thick / 2 - 0.04, 0));
      const logoMat = track(ctx, new THREE.MeshBasicMaterial({ map: track(ctx, makeLabelTexture('JK', 'GRAPHICS')), transparent: true, color: ctx.rgb.clone(), depthWrite: false }));
      ctx.rgbMats.push({ mat: logoMat });
      const logo = new THREE.Mesh(track(ctx, new THREE.PlaneGeometry(0.6, 0.11)), logoMat);
      logo.rotation.y = Math.PI / 2;
      logo.position.set(width / 2 + 0.006, -0.03, 0.05);
      g.add(logo);
      // Bracket on rear
      g.add(box(ctx, width * 0.9, thick + 0.04, 0.02, m.silver, -0.02, 0, -len / 2 - 0.01));
      gpu.add(g);
      // Power cable from shroud
      gpu.add(tube(ctx, [new THREE.Vector3(0.45, 0.63, -0.1), new THREE.Vector3(0.48, 0.9, -0.15), new THREE.Vector3(0.38, 1.27, -0.25)], 0.028, m.sleeve));
    } else {
      const ghost = makeGhost(ctx, 0.56, 0.22, 1.4);
      ghost.position.set(MB_X + 0.31, 1.14, -D / 2 + 0.78);
      gpu.add(ghost);
    }
    groups.gpu = gpu;
  }

  // ======================= STORAGE (M.2) =======================
  {
    const st = slotGroup('storage');
    if (build.storage) {
      st.add(box(ctx, 0.03, 0.09, 0.46, m.alu, MB_X + 0.03, 1.47, -0.32, 0.008));
      st.add(box(ctx, 0.005, 0.015, 0.38, ctx.rgbMat, MB_X + 0.047, 1.47, -0.32));
    } else {
      const ghost = makeGhost(ctx, 0.04, 0.1, 0.46);
      ghost.position.set(MB_X + 0.03, 1.47, -0.32);
      st.add(ghost);
    }
    groups.storage = st;
  }

  // ======================= PSU =======================
  {
    const psu = slotGroup('psu');
    if (build.psu) {
      const p = new THREE.Group();
      p.position.set(0, 0.3, -D / 2 + 0.52);
      p.add(box(ctx, W - 0.32, 0.46, 0.86, m.psu, 0, 0, 0, 0.02));
      const grill = new THREE.Mesh(track(ctx, new THREE.CircleGeometry(0.19, 40)), m.mesh);
      grill.rotation.x = -Math.PI / 2;
      grill.position.y = -0.235;
      p.add(grill);
      p.add(box(ctx, 0.006, 0.02, 0.7, ctx.rgbMat, (W - 0.32) / 2 + 0.003, 0.15, 0));
      const wattMat = track(ctx, new THREE.MeshBasicMaterial({ map: track(ctx, makeLabelTexture(`${build.psu.psuWattage || 750}W`, build.psu.psuCertification || '80+ GOLD')), transparent: true, depthWrite: false }));
      const watt = new THREE.Mesh(track(ctx, new THREE.PlaneGeometry(0.5, 0.095)), wattMat);
      watt.rotation.y = Math.PI / 2;
      watt.position.set((W - 0.32) / 2 + 0.004, -0.02, 0);
      p.add(watt);
      psu.add(p);
      // 24-pin cable
      psu.add(tube(ctx, [new THREE.Vector3(0.3, 0.63, 0.32), new THREE.Vector3(0.1, 0.95, 0.42), new THREE.Vector3(MB_X + 0.1, 1.7, 0.33)], 0.045, m.sleeve));
    } else {
      const ghost = makeGhost(ctx, W - 0.32, 0.46, 0.86);
      ghost.position.set(0, 0.3, -D / 2 + 0.52);
      psu.add(ghost);
    }
    groups.psu = psu;
  }

  // Interior RGB lights
  const l1 = new THREE.PointLight(ctx.rgb, 2.2, 2.6, 2);
  l1.position.set(0.2, 1.7, 0.3);
  const l2 = new THREE.PointLight(ctx.rgb, 1, 2, 2);
  l2.position.set(0.2, 0.75, 0.6);
  ctx.lights.push(l1, l2);
  chassis.add(l1, l2);
  chassis.add(glass);

  return groups;
}

function createMaterials(ctx: BuildCtx, pcbTex: THREE.Texture) {
  const add = <T extends THREE.Material>(mat: T) => track(ctx, mat);
  ctx.rgbMat = add(new THREE.MeshStandardMaterial({ color: ctx.rgb, emissive: ctx.rgb, emissiveIntensity: 1.7, roughness: 0.3 }));
  ctx.rgbSoft = add(new THREE.MeshStandardMaterial({ color: ctx.rgb, emissive: ctx.rgb, emissiveIntensity: 0.7, roughness: 0.3, transparent: true, opacity: 0.6 }));
  ctx.rgbMats.push({ mat: ctx.rgbMat }, { mat: ctx.rgbSoft });
  const blade = add(new THREE.MeshStandardMaterial({ color: 0xe6f6ff, emissive: ctx.rgb, emissiveIntensity: 0.18, roughness: 0.4, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  ctx.rgbMats.push({ mat: blade, keepColor: true });
  ctx.mat = {
    chassis: add(new THREE.MeshStandardMaterial({ color: 0x141a26, metalness: 0.85, roughness: 0.32 })),
    chassisInner: add(new THREE.MeshStandardMaterial({ color: 0x0b0f18, metalness: 0.6, roughness: 0.55 })),
    mesh: add(new THREE.MeshStandardMaterial({ color: 0x0a0d14, metalness: 0.7, roughness: 0.7 })),
    frame: add(new THREE.MeshStandardMaterial({ color: 0x101520, metalness: 0.6, roughness: 0.45 })),
    hub: add(new THREE.MeshStandardMaterial({ color: 0x1b2230, metalness: 0.7, roughness: 0.35 })),
    blade,
    pcb: add(new THREE.MeshStandardMaterial({ map: pcbTex, metalness: 0.4, roughness: 0.6 })),
    alu: add(new THREE.MeshStandardMaterial({ color: 0x8a96a8, metalness: 0.95, roughness: 0.28 })),
    silver: add(new THREE.MeshStandardMaterial({ color: 0xc9d1dc, metalness: 1, roughness: 0.2 })),
    ihs: add(new THREE.MeshStandardMaterial({ color: 0xd8dee8, metalness: 1, roughness: 0.12 })),
    copper: add(new THREE.MeshStandardMaterial({ color: 0xc8743c, metalness: 1, roughness: 0.25 })),
    mirror: add(new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: 1, roughness: 0.05 })),
    ramSpreader: add(new THREE.MeshStandardMaterial({ color: 0x1a1f2b, metalness: 0.9, roughness: 0.25 })),
    gpuShroud: add(new THREE.MeshStandardMaterial({ color: 0x1c2230, metalness: 0.85, roughness: 0.28 })),
    backplate: add(new THREE.MeshStandardMaterial({ color: 0x2a3344, metalness: 0.95, roughness: 0.22 })),
    psu: add(new THREE.MeshStandardMaterial({ color: 0x0f131c, metalness: 0.8, roughness: 0.4 })),
    sleeve: add(new THREE.MeshStandardMaterial({ color: 0x1a2130, metalness: 0.3, roughness: 0.6 })),
    glass: add(new THREE.MeshPhysicalMaterial({ color: 0x9cc6dd, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.08, clearcoat: 0.6, envMapIntensity: 0.6, depthWrite: false })),
    glassEdge: add(new THREE.LineBasicMaterial({ color: ctx.rgb, transparent: true, opacity: 0.6 })),
  };
  ctx.rgbMats.push({ mat: ctx.mat.glassEdge as THREE.LineBasicMaterial });
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CaseVisualizer3D({ onSelectSlot }: CaseVisualizer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const { build, compatibility } = useBuilder();
  const { lang, formatPrice } = useI18n();

  const [glassOpen, setGlassOpen] = useState(false);
  const [rgbColor, setRgbColor] = useState('#b026ff');
  const [rainbow, setRainbow] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [cameraPreset, setCameraPreset] = useState<CameraView>('iso');
  const [hovered, setHovered] = useState<SlotKey | null>(null);
  const [ready, setReady] = useState(false);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const ctxRef = useRef<BuildCtx | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const camTweenRef = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const prevBuildRef = useRef<Partial<Record<SlotKey, string | null>>>({});
  const animInRef = useRef<Array<{ obj: THREE.Object3D; t: number }>>([]);
  const glassOpenRef = useRef(glassOpen);
  const rainbowRef = useRef(rainbow);
  const autoRotateRef = useRef(autoRotate);
  const rgbRef = useRef(new THREE.Color(rgbColor));
  const hoveredRef = useRef<SlotKey | null>(null);
  const onSelectRef = useRef(onSelectSlot);
  const pcbTexRef = useRef<THREE.Texture | null>(null);

  useEffect(() => { onSelectRef.current = onSelectSlot; }, [onSelectSlot]);
  useEffect(() => { glassOpenRef.current = glassOpen; }, [glassOpen]);
  useEffect(() => { rainbowRef.current = rainbow; }, [rainbow]);
  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);

  const applyRgb = (color: THREE.Color) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.rgbMats.forEach(({ mat, keepColor }) => {
      if (!keepColor) (mat as THREE.MeshBasicMaterial).color.copy(color);
      if ('emissive' in mat) (mat as THREE.MeshStandardMaterial).emissive.copy(color);
    });
    ctx.lights.forEach((l) => l.color.copy(color));
  };

  useEffect(() => {
    rgbRef.current.set(rgbColor);
    if (!rainbow) applyRgb(rgbRef.current);
  }, [rgbColor, rainbow]);

  // ---------------- Scene init ----------------
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    let width = container.clientWidth || 600;
    let height = container.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03060c);
    scene.fog = new THREE.FogExp2(0x03060c, 0.075);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(...CAMERA_VIEWS.iso.pos);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.45;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.35, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 1.8;
    controls.maxDistance = 9;
    controls.autoRotateSpeed = 0.7;
    controls.target.set(...CAMERA_VIEWS.iso.target);
    controlsRef.current = controls;

    // Lighting
    scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x05070c, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -2;
    key.shadow.bias = -0.0005;
    scene.add(key);
    const rimCyan = new THREE.DirectionalLight(0x22d3ee, 1.6);
    rimCyan.position.set(-5, 3, -4);
    scene.add(rimCyan);
    const rimMagenta = new THREE.DirectionalLight(0xd946ef, 1.1);
    rimMagenta.position.set(5, 2, -5);
    scene.add(rimMagenta);

    // Floor
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(30, 64),
      new THREE.MeshStandardMaterial({ color: 0x04070d, metalness: 0.85, roughness: 0.38 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Holographic grid shader
    const gridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xb026ff) } },
      vertexShader: `varying vec2 vUv; varying vec3 vPos; void main(){ vUv=uv; vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uColor; varying vec3 vPos;
        float line(float v, float w){ float d = abs(fract(v - 0.5) - 0.5) / fwidth(v); return 1.0 - min(d / w, 1.0); }
        void main(){
          vec2 p = vPos.xy;
          float g = max(line(p.x * 2.0, 1.0), line(p.y * 2.0, 1.0)) * 0.35;
          g += max(line(p.x * 0.5, 1.2), line(p.y * 0.5, 1.2)) * 0.5;
          float r = length(p);
          float pulse = smoothstep(0.25, 0.0, abs(fract(r * 0.12 - uTime * 0.15) - 0.5)) * 0.35;
          float fade = smoothstep(14.0, 2.5, r);
          gl_FragColor = vec4(uColor * (g + pulse * g * 3.0), (g + pulse * 0.2) * fade * 0.55);
        }`,
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = 0.003;
    scene.add(grid);

    // Pedestal
    const pedestal = new THREE.Group();
    const pedMat = new THREE.MeshStandardMaterial({ color: 0x0a0f18, metalness: 0.9, roughness: 0.25 });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.15, 0.1, 96), pedMat);
    ped.position.y = 0.05;
    ped.receiveShadow = true;
    pedestal.add(ped);
    const pedRingMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 2 });
    const pedRing = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.012, 8, 160), pedRingMat);
    pedRing.rotation.x = Math.PI / 2;
    pedRing.position.y = 0.1;
    pedestal.add(pedRing);
    const arcs = new THREE.Group();
    const arcMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 3; i++) {
      const arc = new THREE.Mesh(new THREE.RingGeometry(2.25 + i * 0.12, 2.28 + i * 0.12, 96, 1, i * 2, Math.PI * (0.35 + i * 0.15)), arcMat);
      arc.rotation.x = -Math.PI / 2;
      arc.position.y = 0.01 + i * 0.001;
      arcs.add(arc);
    }
    pedestal.add(arcs);
    scene.add(pedestal);

    // Scanner ring
    const scanMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    const scan = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.006, 6, 128), scanMat);
    scan.rotation.x = Math.PI / 2;
    scene.add(scan);

    // Particles
    const pCount = 380;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    const pSpeed = new Float32Array(pCount);
    for (let i = 0; i < pCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2.2 + Math.random() * 4.5;
      pPos[i * 3] = Math.cos(a) * r;
      pPos[i * 3 + 1] = Math.random() * 5;
      pPos[i * 3 + 2] = Math.sin(a) * r;
      pSpeed[i] = 0.08 + Math.random() * 0.25;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: 0x67e8f9, size: 0.03, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    // Hover outline
    const outlineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), outlineMat);
    outline.visible = false;
    scene.add(outline);

    pcbTexRef.current = makePcbTexture();

    // Interaction: auto-rotate pause on user input
    let interacting = false;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    controls.addEventListener('start', () => {
      interacting = true;
      camTweenRef.current = null;
      if (resumeTimer) clearTimeout(resumeTimer);
    });
    controls.addEventListener('end', () => {
      resumeTimer = setTimeout(() => { interacting = false; }, 3500);
    });

    // Picking
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos: { x: number; y: number } | null = null;
    const pick = (ev: PointerEvent): SlotKey | null => {
      const root = rootRef.current;
      if (!root) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(root, true);
      for (const hit of hits) {
        let o: THREE.Object3D | null = hit.object;
        while (o && !o.userData.slot) o = o.parent;
        if (o?.userData.slot) return o.userData.slot as SlotKey;
      }
      return null;
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.buttons) return;
      const slot = pick(ev);
      if (slot !== hoveredRef.current) {
        hoveredRef.current = slot;
        setHovered(slot);
      }
      renderer.domElement.style.cursor = slot ? 'pointer' : 'grab';
    };
    const onDown = (ev: PointerEvent) => { downPos = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (!downPos) return;
      const moved = Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y);
      downPos = null;
      if (moved > 5) return;
      const slot = pick(ev);
      if (slot && onSelectRef.current) onSelectRef.current(slot);
    };
    const onLeave = () => { hoveredRef.current = null; setHovered(null); };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    // Animation loop
    const clock = new THREE.Clock();
    const tmpBox = new THREE.Box3();
    const tmpSize = new THREE.Vector3();
    const tmpCenter = new THREE.Vector3();
    const rainbowColor = new THREE.Color();
    let frame = 0;

    const animate = () => {
      frame = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const ctx = ctxRef.current;

      if (rainbowRef.current) {
        rainbowColor.setHSL((t * 0.08) % 1, 1, 0.55);
        applyRgb(rainbowColor);
      }
      const accent = rainbowRef.current ? rainbowColor : rgbRef.current;
      pedRingMat.color.copy(accent);
      pedRingMat.emissive.copy(accent);
      arcMat.color.copy(accent);
      scanMat.color.copy(accent);
      gridMat.uniforms.uColor.value.copy(accent).lerp(new THREE.Color(0x22d3ee), 0.5);
      gridMat.uniforms.uTime.value = t;
      outlineMat.color.copy(accent).lerp(new THREE.Color(0xffffff), 0.4);

      if (ctx) {
        ctx.fans.forEach(({ rotor, speed }) => { rotor.rotation.z += dt * speed; });
        ctx.spinners.forEach((s) => { s.rotation.x += dt * 2.2; });
        const ghostPulse = 0.35 + Math.sin(t * 3) * 0.2;
        ctx.ghostMats.forEach((mat) => {
          mat.opacity = mat instanceof THREE.LineBasicMaterial ? ghostPulse + 0.2 : 0.04 + ghostPulse * 0.06;
          mat.color.copy(accent);
        });
      }

      // Glass slide
      const root = rootRef.current;
      const glass = root?.getObjectByName('glassPanel');
      if (glass) {
        const targetX = W / 2 + 0.012 + (glassOpenRef.current ? 1.6 : 0);
        glass.position.x += (targetX - glass.position.x) * Math.min(1, dt * 6);
        glass.visible = glass.position.x < W / 2 + 1.5;
      }

      // Parts drop-in animation
      animInRef.current = animInRef.current.filter((a) => {
        a.t = Math.min(1, a.t + dt / 0.8);
        const e = easeOutCubic(a.t);
        a.obj.position.set((1 - e) * 1.8, (1 - e) * 0.6, 0);
        return a.t < 1;
      });

      arcs.rotation.y += dt * 0.25;
      pedRing.scale.setScalar(1 + Math.sin(t * 2) * 0.004);
      scan.position.y = 0.15 + ((Math.sin(t * 0.7) + 1) / 2) * (H + 0.1);
      scanMat.opacity = 0.25 + Math.sin(t * 0.7 * 2) * 0.1;

      const pos = pGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pCount; i++) {
        let y = pos.getY(i) + pSpeed[i] * dt;
        if (y > 5) y = 0;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      particles.rotation.y += dt * 0.03;

      const hv = hoveredRef.current;
      const hvGroup = hv && root ? root.children.find((c) => c.userData.slot === hv) : null;
      if (hvGroup) {
        const glassObj = hvGroup.getObjectByName('glassPanel');
        if (glassObj) glassObj.visible = false;
        tmpBox.setFromObject(hvGroup);
        if (glassObj) glassObj.visible = true;
        tmpBox.getSize(tmpSize);
        tmpBox.getCenter(tmpCenter);
        outline.position.copy(tmpCenter);
        outline.scale.copy(tmpSize).addScalar(0.04);
        outline.visible = true;
        outlineMat.opacity = 0.6 + Math.sin(t * 8) * 0.3;
      } else {
        outline.visible = false;
      }

      // Camera tween
      const tw = camTweenRef.current;
      if (tw) {
        const k = Math.min(1, dt * 3.2);
        camera.position.lerp(tw.pos, k);
        controls.target.lerp(tw.target, k);
        if (camera.position.distanceTo(tw.pos) < 0.01) camTweenRef.current = null;
      }

      controls.autoRotate = autoRotateRef.current && !interacting && !camTweenRef.current && !hv;
      controls.update();
      composer.render();
    };
    animate();
    setReady(true);

    const ro = new ResizeObserver(() => {
      width = container.clientWidth;
      height = container.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      if (resumeTimer) clearTimeout(resumeTimer);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      ctxRef.current?.disposables.forEach((d) => d.dispose());
      ctxRef.current = null;
      rootRef.current = null;
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      pcbTexRef.current?.dispose();
      envTex.dispose();
      pmrem.dispose();
      controls.dispose();
      composer.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      sceneRef.current = null;
      prevBuildRef.current = {};
    };
  }, []);

  // ---------------- Rebuild PC on build change ----------------
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !pcbTexRef.current) return;

    const old = rootRef.current;
    if (old) scene.remove(old);
    ctxRef.current?.disposables.forEach((d) => d.dispose());

    const ctx = {
      rgbMats: [],
      lights: [],
      fans: [],
      spinners: [],
      ghostMats: [],
      disposables: [],
      rgb: rgbRef.current.clone(),
    } as unknown as BuildCtx;
    createMaterials(ctx, pcbTexRef.current);
    const groups = buildPc(build, ctx);

    const root = new THREE.Group();
    root.name = 'pcRoot';
    root.position.y = 0.1;
    const prev = prevBuildRef.current;
    const isFirst = Object.keys(prev).length === 0;
    const anims: Array<{ obj: THREE.Object3D; t: number }> = [];
    (Object.keys(groups) as SlotKey[]).forEach((slot) => {
      const g = groups[slot];
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      root.add(g);
      const id = build[slot]?.id ?? null;
      if (!isFirst && slot !== 'case' && id && prev[slot] !== id) {
        anims.push({ obj: g, t: 0 });
        g.position.set(1.8, 0.6, 0);
      }
      prev[slot] = id;
    });
    // glass stays where it was
    const oldGlass = old?.getObjectByName('glassPanel');
    const newGlass = root.getObjectByName('glassPanel');
    if (oldGlass && newGlass) {
      newGlass.position.x = oldGlass.position.x;
      newGlass.visible = oldGlass.visible;
    }
    animInRef.current = anims;
    scene.add(root);
    rootRef.current = root;
    ctxRef.current = ctx;
  }, [build, ready]);

  const setCameraView = (view: CameraView) => {
    setCameraPreset(view);
    const v = CAMERA_VIEWS[view];
    camTweenRef.current = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target) };
  };

  const colors = [
    { name: 'Cyber Cyan', hex: '#00f0ff' },
    { name: 'Neon Purple', hex: '#b026ff' },
    { name: 'Hot Magenta', hex: '#ff2bd6' },
    { name: 'Matrix Emerald', hex: '#10ff9a' },
    { name: 'Flame Red', hex: '#ff3b3b' },
    { name: 'Solar Amber', hex: '#ffb020' },
    { name: 'Pure White', hex: '#ffffff' },
  ];

  const installed = (Object.keys(SLOT_LABELS) as SlotKey[]).filter((k) => build[k]).length;
  const hoveredPart = hovered ? build[hovered] : null;
  const L = (ru: string, uz: string) => (lang === 'ru' ? ru : uz);
  const viewLabels: Record<CameraView, string> = {
    iso: L('3D Обзор', '3D Ko‘rinish'),
    inside: L('Внутри', 'Ichkari'),
    front: L('Спереди', 'Old tomon'),
    top: L('Сверху', 'Yuqoridan'),
  };

  return (
    <div className="keep-dark cyber-panel cyber-corners relative rounded-3xl p-4 sm:p-5 border border-cyan-400/25 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-3 border-b border-cyan-400/15 relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_10px_#22d3ee] animate-pulse" />
            <h3 className="font-display font-bold text-white text-sm sm:text-base tracking-wider flex items-center gap-2 uppercase">
              <Rotate3d className="w-5 h-5 text-cyan-400" />
              {L('3D Голо-сборка ПК', '3D Golo-yig‘ma')}
            </h3>
          </div>
          <p className="text-[11px] text-cyan-100/50 mt-1 font-mono">
            {L('Вращайте мышью • колесо — зум • клик по детали — выбрать', 'Sichqoncha bilan aylantiring • g‘ildirak — zum • qismni bosing — tanlash')}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-black/50 p-1 rounded-xl border border-cyan-400/20 text-xs font-mono">
          {(Object.keys(CAMERA_VIEWS) as CameraView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setCameraView(v)}
              className={`px-2.5 py-1 rounded-lg font-semibold uppercase tracking-wide transition-all ${
                cameraPreset === v ? 'bg-cyan-400 text-black shadow-[0_0_16px_rgba(34,211,238,0.6)]' : 'text-cyan-100/60 hover:text-white'
              }`}
            >
              {viewLabels[v]}
            </button>
          ))}
        </div>
      </div>

      {/* Canvas + HUD */}
      <div className="relative w-full h-[420px] sm:h-[500px] rounded-2xl overflow-hidden border border-cyan-400/20 bg-[#03060c]">
        <div ref={mountRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />

        <div className="pointer-events-none absolute inset-0 hud-scanlines" />
        <span className="pointer-events-none absolute top-3 left-3 w-6 h-6 border-t-2 border-l-2 border-cyan-400/70" />
        <span className="pointer-events-none absolute top-3 right-3 w-6 h-6 border-t-2 border-r-2 border-cyan-400/70" />
        <span className="pointer-events-none absolute bottom-3 left-3 w-6 h-6 border-b-2 border-l-2 border-cyan-400/70" />
        <span className="pointer-events-none absolute bottom-3 right-3 w-6 h-6 border-b-2 border-r-2 border-cyan-400/70" />

        <div className="pointer-events-none absolute top-5 left-6 font-mono text-[10px] sm:text-[11px] leading-relaxed text-cyan-200/80">
          <div className="text-cyan-300">SYS://RENDER <span className="text-emerald-400">ONLINE</span></div>
          <div>{L('МОДУЛИ', 'MODULLAR')}: <span className="text-white">{installed}/8</span></div>
          <div className="mt-1 w-28 h-1 bg-cyan-950 rounded overflow-hidden">
            <div className="h-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] transition-all duration-500" style={{ width: `${(installed / 8) * 100}%` }} />
          </div>
        </div>

        <div className="pointer-events-none absolute top-5 right-6 font-mono text-[10px] sm:text-[11px] text-right leading-relaxed text-cyan-200/80">
          <div className="flex items-center justify-end gap-1"><Zap className="w-3 h-3 text-amber-300" /> ~{compatibility.estimatedWattage}W</div>
          <div className={compatibility.isCompatible ? 'text-emerald-400' : 'text-rose-400'}>
            {compatibility.isCompatible ? L('СОВМЕСТИМО', 'MOS') : L('КОНФЛИКТ', 'NOMOS')}
          </div>
        </div>

        {/* Hover tooltip */}
        <div
          className={`pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-5 transition-all duration-200 ${
            hovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
          }`}
        >
          {hovered && (
            <div className="px-4 py-2 rounded-xl bg-black/70 backdrop-blur-md border border-cyan-400/40 shadow-[0_0_24px_rgba(34,211,238,0.25)] text-center min-w-[200px]">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300">{L(SLOT_LABELS[hovered].ru, SLOT_LABELS[hovered].uz)}</div>
              <div className="text-sm font-semibold text-white truncate max-w-[300px]">
                {hoveredPart ? (lang === 'ru' ? hoveredPart.nameRu : hoveredPart.nameUz) : L('Не выбрано', 'Tanlanmagan')}
              </div>
              <div className="flex items-center justify-center gap-1 text-[10px] text-cyan-100/60 mt-0.5">
                <MousePointerClick className="w-3 h-3" /> {hoveredPart ? L('Клик — заменить', 'Bosing — almashtirish') : L('Клик — выбрать', 'Bosing — tanlash')}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="mt-4 pt-3 border-t border-cyan-400/15 flex flex-wrap items-center justify-between gap-3 text-xs relative z-10">
        <div className="flex items-center gap-2 flex-wrap">
          <Palette className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="text-cyan-100/50 font-mono hidden sm:inline">ARGB</span>
          <div className="flex items-center gap-1.5">
            {colors.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => { setRainbow(false); setRgbColor(c.hex); }}
                style={{ backgroundColor: c.hex, boxShadow: !rainbow && rgbColor === c.hex ? `0 0 14px ${c.hex}` : undefined }}
                title={c.name}
                className={`w-5 h-5 rounded-full transition-all border ${
                  !rainbow && rgbColor === c.hex ? 'ring-2 ring-white scale-125 border-black' : 'border-white/30 opacity-70 hover:opacity-100'
                }`}
              />
            ))}
            <button
              type="button"
              onClick={() => setRainbow(!rainbow)}
              title="Rainbow wave"
              className={`w-5 h-5 rounded-full transition-all border border-white/30 bg-[conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)] ${
                rainbow ? 'ring-2 ring-white scale-125 animate-spin [animation-duration:3s]' : 'opacity-70 hover:opacity-100'
              }`}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRotate(!autoRotate)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-semibold text-xs transition-all ${
              autoRotate ? 'bg-cyan-400/15 text-cyan-200 border-cyan-400/40' : 'bg-white/5 text-gray-300 border-white/10 hover:border-white/30'
            }`}
          >
            {autoRotate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {L('Авто-вращение', 'Avto-aylanish')}
          </button>
          <button
            type="button"
            onClick={() => setGlassOpen(!glassOpen)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-semibold text-xs transition-all ${
              glassOpen ? 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/40' : 'bg-white/5 text-gray-300 border-white/10 hover:border-white/30'
            }`}
          >
            <Eye className="w-3.5 h-3.5 text-cyan-400" />
            {glassOpen ? L('Вернуть стекло', 'Oynani qaytarish') : L('Снять стекло', 'Oynani olish')}
          </button>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-sm font-bold text-cyan-300 neon-text">
          <Sparkles className="w-4 h-4" />
          {formatPrice(compatibility.totalPriceUzs)}
        </div>
      </div>
    </div>
  );
}
