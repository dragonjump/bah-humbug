import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Hands, Results } from './types';

// --- Constants ---
const MP_VERSION = '0.4.1646424915';
const TARGET_FPS_DETECTION = 30;
const DETECTION_INTERVAL = 1000 / TARGET_FPS_DETECTION;
const MAX_ENEMIES = 6; 
const SPAWN_DISTANCE = 40; 
const FLIGHT_SPEED = 0.133; 
const MAGNETIC_RADIUS = 0.5; 
const FIRE_RATE_MS = 150; // Faster for dual wielding fun
const MAX_LIVES = 5;
const MAX_BOMBS = 3;
const BOMB_CHARGE_MS = 3000;

// --- Sound Synth Helper ---
const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
let audioCtx: AudioContext | null = null;

const initAudio = () => {
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') audioCtx.resume();
};

const playSound = (type: 'shoot' | 'hit' | 'spawn' | 'fail' | 'gameover' | 'charge' | 'explode' | 'powerup') => {
  if (!audioCtx) initAudio();
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;
  
  if (type === 'shoot') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'hit') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'spawn') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'fail') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.linearRampToValueAtTime(50, now + 0.3);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (type === 'gameover') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(10, now + 1.0);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.linearRampToValueAtTime(0, now + 1.0);
    osc.start(now);
    osc.stop(now + 1.0);
  } else if (type === 'charge') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.linearRampToValueAtTime(300, now + 0.1);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'explode') {
    const noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < audioCtx.sampleRate * 2; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.connect(gain);
    gain.gain.setValueAtTime(1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 2);
    noise.start(now);
  } else if (type === 'powerup') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.linearRampToValueAtTime(1800, now + 0.2);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  }
};

// --- Types ---
type EntityType = 'bird' | 'boss' | 'orb' | 'health';

interface Entity {
  group: THREE.Group;
  leftWing?: THREE.Mesh;
  rightWing?: THREE.Mesh;
  id: string;
  active: boolean;
  seed: number;
  type: EntityType;
}

interface HandState {
  indexExtended: boolean;
  isGun: boolean;
  isFist: boolean;
  aim: { x: number, y: number } | null;
}

export default function App() {
  const [hasStarted, setHasStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Checking the Naughty List...");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(MAX_LIVES);
  const [bombs, setBombs] = useState(MAX_BOMBS);
  const [gameOver, setGameOver] = useState(false);
  const [damageEffect, setDamageEffect] = useState(false);
  const [bombFlash, setBombFlash] = useState(false);
  const [bombCharge, setBombCharge] = useState(0); 
  const [bgMode, setBgMode] = useState<'camera' | 'space'>('camera');
  const [santaSmile, setSantaSmile] = useState(false);
  
  // Track states for up to 2 hands
  const [handsUIState, setHandsUIState] = useState<HandState[]>([]);
  
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null); 
  const mountRef = useRef<HTMLDivElement>(null);
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);
  
  const enemiesRef = useRef<Entity[]>([]);
  const handsRef = useRef<Hands | null>(null);
  const lastDetectionTimeRef = useRef(0);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const scoreRef = useRef(0);
  const snowParticlesRef = useRef<THREE.Points | null>(null);
  
  // Logic Refs
  const isReadyRef = useRef(false); 
  const livesRef = useRef(MAX_LIVES);
  const bombsRef = useRef(MAX_BOMBS);
  const handAimsRef = useRef<( {x: number, y: number} | null )[]>([null, null]);
  const handGunsRef = useRef<boolean[]>([false, false]);
  const handFistsRef = useRef<boolean[]>([false, false]);
  const lastShotTimesRef = useRef<number[]>([0, 0]);
  const fistStartTimeRef = useRef<number | null>(null);
  
  // --- Initialization ---
  const handleStartGame = () => {
    initAudio();
    
    // Initialize background music
    if (!bgMusicRef.current) {
      const audio = new Audio('melody-1.wav');
      audio.loop = true;
      audio.volume = 0.35;
      audio.play().catch(err => console.error("Could not play melody-1.wav. Ensure it is in the root directory.", err));
      bgMusicRef.current = audio;
    }

    setHasStarted(true);
    startCamera();
  };

  const startCamera = async () => {
      setLoading(true);
      isReadyRef.current = false;
      livesRef.current = MAX_LIVES;
      bombsRef.current = MAX_BOMBS;
      setLives(MAX_LIVES);
      setBombs(MAX_BOMBS);
      setGameOver(false);
      setErrorMsg(null);
      setLoadingStatus("Polishing Sleigh Lenses...");
      
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          }
        });
        
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await new Promise<void>((resolve) => {
              if (videoRef.current) {
                videoRef.current.onloadedmetadata = () => {
                  videoRef.current!.play();
                  resolve();
                };
              }
            });
            initGame();
        }
      } catch (err: any) {
        console.error("Camera Init failed:", err);
        setLoading(false);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
             setErrorMsg("Camera access denied. Santa needs a camera to see the Grinches!");
        } else {
             setErrorMsg("Could not access camera. Maybe an Elf is using it?");
        }
      }
  };

  const initGame = async () => {
      try {
        if (!canvasRef.current || !mountRef.current) return;

        setLoadingStatus("Summoning Snowflakes...");
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        if (rendererRef.current) {
            rendererRef.current.dispose();
        }

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0xe0f2fe, 0.02);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(5, 15, 10);
        scene.add(dirLight);

        // Snowfall Particles
        const snowCount = 1000;
        const snowGeo = new THREE.BufferGeometry();
        const snowPositions = new Float32Array(snowCount * 3);
        for(let i=0; i < snowCount; i++) {
            snowPositions[i*3] = (Math.random() - 0.5) * 100;
            snowPositions[i*3+1] = (Math.random() - 0.5) * 100;
            snowPositions[i*3+2] = (Math.random() - 0.5) * 100;
        }
        snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
        const snowMat = new THREE.PointsMaterial({ 
            color: 0xffffff, 
            size: 0.2, 
            transparent: true, 
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });
        const snowParticles = new THREE.Points(snowGeo, snowMat);
        scene.add(snowParticles);
        snowParticlesRef.current = snowParticles;

        const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        camera.position.z = 10; 

        const renderer = new THREE.WebGLRenderer({ 
          canvas: canvasRef.current, 
          alpha: true, 
          antialias: true 
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        
        sceneRef.current = scene;
        cameraRef.current = camera;
        rendererRef.current = renderer;

        setLoadingStatus("Loading Elf-Tech AI...");
        let attempts = 0;
        while (!window.Hands && attempts < 100) {
          await new Promise<void>(resolve => setTimeout(() => resolve(), 100));
          attempts++;
        }
        if (!window.Hands) throw new Error("Failed to load MediaPipe Hands.");

        const hands = new window.Hands({
          locateFile: (file) => `https://unpkg.com/@mediapipe/hands@${MP_VERSION}/${file}`
        });

        hands.setOptions({
          maxNumHands: 2, // Dual hand support
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        hands.onResults(onHandResults);
        handsRef.current = hands;

        if (videoRef.current) {
            await hands.send({ image: videoRef.current });
        }
        
        setLoading(false);
        isReadyRef.current = true; 
        
        spawnEnemy(); 
        requestRef.current = requestAnimationFrame(gameLoop);

      } catch (err) {
        console.error("Game Init failed:", err);
        setErrorMsg("Failed to initialize game engine.");
        setLoading(false);
      }
  };

  useEffect(() => {
    const handleResize = () => {
      if (cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      }
      if (debugCanvasRef.current) {
          debugCanvasRef.current.width = window.innerWidth;
          debugCanvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
            e.preventDefault();
            setBgMode(prev => prev === 'camera' ? 'space' : 'camera');
        }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      if (requestRef.current !== undefined) cancelAnimationFrame(requestRef.current);
      if (handsRef.current) handsRef.current.close();
      if (bgMusicRef.current) {
        bgMusicRef.current.pause();
        bgMusicRef.current = null;
      }
      if (videoRef.current && videoRef.current.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
      enemiesRef.current.forEach(e => {
          if (sceneRef.current) sceneRef.current.remove(e.group);
      });
      isReadyRef.current = false;
    };
  }, []);

  // --- Logic Helpers ---

  const addAngryFace = (group: THREE.Group, eyeY: number, eyeZ: number) => {
    const browMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const browGeo = new THREE.BoxGeometry(0.3, 0.05, 0.05);
    const leftBrow = new THREE.Mesh(browGeo, browMat);
    leftBrow.position.set(-0.25, eyeY + 0.15, eyeZ);
    leftBrow.rotation.z = -Math.PI / 6;
    group.add(leftBrow);
    const rightBrow = new THREE.Mesh(browGeo, browMat);
    rightBrow.position.set(0.25, eyeY + 0.15, eyeZ);
    rightBrow.rotation.z = Math.PI / 6;
    group.add(rightBrow);
    const eyeGeo = new THREE.SphereGeometry(0.08, 4, 4);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.2, eyeY, eyeZ);
    group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.2, eyeY, eyeZ);
    group.add(rightEye);
    const mouthGeo = new THREE.TorusGeometry(0.2, 0.03, 4, 8, Math.PI);
    const mouth = new THREE.Mesh(mouthGeo, eyeMat);
    mouth.position.set(0, eyeY - 0.2, eyeZ);
    mouth.rotation.x = -Math.PI / 2;
    mouth.rotation.z = Math.PI;
    group.add(mouth);
  };

  const createChristmasEntityMesh = (isBoss: boolean) => {
    const group = new THREE.Group();
    const scale = isBoss ? 2.5 : 1.0;
    const subTypes = ['grinch', 'gingerbread', 'snowman'];
    const subType = isBoss ? 'boss' : subTypes[Math.floor(Math.random() * subTypes.length)];

    if (subType === 'grinch' || subType === 'boss') {
        const bodyGeo = new THREE.SphereGeometry(0.8, 8, 8);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.5, metalness: 0.1 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        group.add(body);
        const hatGeo = new THREE.ConeGeometry(0.6, 1.2, 8);
        hatGeo.translate(0, 0.8, 0);
        const hatMat = new THREE.MeshStandardMaterial({ color: 0xef4444 });
        const hat = new THREE.Mesh(hatGeo, hatMat);
        group.add(hat);
        const puffGeo = new THREE.SphereGeometry(0.2, 8, 8);
        puffGeo.translate(0, 1.4, 0);
        const puffMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        group.add(new THREE.Mesh(puffGeo, puffMat));
        const trimGeo = new THREE.TorusGeometry(0.6, 0.1, 8, 16);
        trimGeo.rotateX(Math.PI * 0.5);
        trimGeo.translate(0, 0.4, 0);
        group.add(new THREE.Mesh(trimGeo, puffMat));
        addAngryFace(group, 0.1, 0.7);
    } else if (subType === 'gingerbread') {
        const gingerMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.8 });
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), gingerMat);
        head.position.y = 0.5;
        group.add(head);
        const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.5, 4, 8), gingerMat);
        group.add(torso);
        const armGeo = new THREE.CapsuleGeometry(0.15, 0.4, 4, 8);
        const lArm = new THREE.Mesh(armGeo, gingerMat);
        lArm.position.set(-0.5, 0.2, 0);
        lArm.rotation.z = Math.PI / 4;
        group.add(lArm);
        const rArm = new THREE.Mesh(armGeo, gingerMat);
        rArm.position.set(0.5, 0.2, 0);
        rArm.rotation.z = -Math.PI / 4;
        group.add(rArm);
        const legGeo = new THREE.CapsuleGeometry(0.15, 0.4, 4, 8);
        const lLeg = new THREE.Mesh(legGeo, gingerMat);
        lLeg.position.set(-0.25, -0.6, 0);
        group.add(lLeg);
        const rLeg = new THREE.Mesh(legGeo, gingerMat);
        rLeg.position.set(0.25, -0.6, 0);
        group.add(rLeg);
        const buttonMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
        const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 4, 4), buttonMat);
        b1.position.set(0, 0.2, 0.35);
        group.add(b1);
        addAngryFace(group, 0.6, 0.4);
    } else if (subType === 'snowman') {
        const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
        const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), snowMat);
        b1.position.y = 0.5;
        group.add(b1);
        const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), snowMat);
        b2.position.y = -0.2;
        group.add(b2);
        const b3 = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 8), snowMat);
        b3.position.y = -1.0;
        group.add(b3);
        const carrotMat = new THREE.MeshBasicMaterial({ color: 0xffa500 });
        const carrotGeo = new THREE.ConeGeometry(0.08, 0.4, 4);
        carrotGeo.rotateX(Math.PI / 2);
        const nose = new THREE.Mesh(carrotGeo, carrotMat);
        nose.position.set(0, 0.5, 0.4);
        group.add(nose);
        addAngryFace(group, 0.6, 0.35);
    }

    const wingGeo = new THREE.PlaneGeometry(2, 0.8);
    wingGeo.translate(1, 0, 0);
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const leftWing = new THREE.Mesh(wingGeo, wingMat);
    leftWing.position.set(0.2, 0, 0);
    const rightWing = new THREE.Mesh(wingGeo, wingMat);
    rightWing.position.set(-0.2, 0, 0);
    rightWing.scale.x = -1;
    group.add(leftWing);
    group.add(rightWing);
    group.scale.set(scale, scale, scale);
    return { group, leftWing, rightWing };
  };

  const createChristmasItemMesh = (type: 'orb' | 'health') => {
    const group = new THREE.Group();
    if (type === 'orb') {
        const boxMat = new THREE.MeshStandardMaterial({ color: 0xef4444 });
        group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), boxMat));
        const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xfacc15 });
        group.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.2), ribbonMat));
        group.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), ribbonMat));
    } else {
        const heartMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xef4444, emissiveIntensity: 0.5 });
        group.add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), heartMat));
    }
    return { group };
  };

  const spawnEnemy = () => {
    if (!sceneRef.current) return;
    if (enemiesRef.current.filter(e => e.active).length >= MAX_ENEMIES) return;
    const id = Math.random().toString(36);
    const rand = Math.random();
    let type: EntityType = 'bird';
    if (rand > 0.95) type = 'health';
    else if (rand > 0.90) type = 'orb';
    else if (rand > 0.75) type = 'boss';
    let entityParts;
    if (type === 'bird' || type === 'boss') {
        entityParts = createChristmasEntityMesh(type === 'boss');
    } else {
        entityParts = createChristmasItemMesh(type);
    }
    const { group, leftWing, rightWing } = entityParts;
    group.userData = { id, isEnemy: true, type };
    const radius = SPAWN_DISTANCE + (Math.random() * 5); 
    const startX = (Math.random() - 0.5) * 40;
    const startY = (Math.random() - 0.5) * 20;
    group.position.set(startX, startY, -radius);
    group.lookAt(0, 0, 0);
    sceneRef.current.add(group);
    enemiesRef.current.push({ group, leftWing, rightWing, id, active: true, seed: Math.random() * 100, type });
    playSound('spawn');
  };

  const triggerSantaSmile = () => {
    setSantaSmile(true);
    setTimeout(() => setSantaSmile(false), 800);
  };

  const createFloatingText = (text: string, x: number, y: number, type: 'hit' | 'fail' | 'nuke' | 'powerup') => {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.position = 'absolute';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (type === 'hit') el.style.color = '#ef4444';
    if (type === 'fail') el.style.color = '#1e3a8a';
    if (type === 'nuke') el.style.color = '#facc15';
    if (type === 'powerup') el.style.color = '#4ade80';
    el.style.fontSize = type === 'nuke' ? '60px' : (type === 'hit' ? '40px' : '20px');
    el.style.fontFamily = '"Comic Sans MS", cursive, sans-serif';
    el.style.fontWeight = 'bold';
    el.style.pointerEvents = 'none';
    el.style.transition = 'all 0.5s ease-out';
    el.style.textShadow = '2px 2px 4px rgba(0,0,0,0.5)';
    el.style.transform = 'translate(-50%, -50%) scale(0.5)';
    el.style.zIndex = '100';
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = `translate(-50%, -150%) scale(${type === 'hit' ? 1.5 : (type === 'nuke' ? 2 : 1)})`;
      el.style.opacity = '0';
    });
    setTimeout(() => { if (document.body.contains(el)) document.body.removeChild(el); }, 500);
  };

  const fireLaser = (from: THREE.Vector2) => {
      if (!sceneRef.current) return;
      const laserMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
      const startV = new THREE.Vector3(from.x * 5, from.y * 5 - 2, 8); 
      const endV = new THREE.Vector3(from.x * 50, from.y * 50, -50); 
      const laserGeo = new THREE.BufferGeometry().setFromPoints([startV, endV]);
      const laserLine = new THREE.Line(laserGeo, laserMat);
      sceneRef.current.add(laserLine);
      setTimeout(() => sceneRef.current?.remove(laserLine), 100);
      playSound('shoot');
  };

  const detonateBomb = () => {
    if (!sceneRef.current) return;
    playSound('explode');
    setBombFlash(true);
    setTimeout(() => setBombFlash(false), 500);
    bombsRef.current -= 1;
    setBombs(bombsRef.current);
    fistStartTimeRef.current = null;
    setBombCharge(0);
    enemiesRef.current.forEach(enemy => {
        if (enemy.active) {
            enemy.active = false;
            sceneRef.current?.remove(enemy.group);
            if (enemy.type === 'boss') scoreRef.current += 300;
            else if (enemy.type === 'bird') scoreRef.current += 100;
        }
    });
    setScore(scoreRef.current);
    triggerSantaSmile();
    createFloatingText("BAH HUMBUG! BLAST!", window.innerWidth/2, window.innerHeight/2, 'nuke');
  };

  const checkShooting = () => {
    const now = performance.now();
    
    // Bomb Charging Logic (either hand can trigger)
    const isFisting = handFistsRef.current.some(f => f);
    const hasBombs = bombsRef.current > 0;
    if (isFisting && hasBombs) {
        if (fistStartTimeRef.current === null) fistStartTimeRef.current = now;
        const elapsed = now - fistStartTimeRef.current;
        const progress = Math.min(elapsed / BOMB_CHARGE_MS, 1);
        setBombCharge(progress);
        if (progress < 1 && Math.floor(elapsed / 200) > Math.floor((elapsed - 16) / 200)) playSound('charge');
        if (progress >= 1) { detonateBomb(); return; }
    } else {
        fistStartTimeRef.current = null;
        setBombCharge(0);
    }

    // Shooting Logic for each hand
    handAimsRef.current.forEach((aim, index) => {
        if (!aim) return;
        const isGun = handGunsRef.current[index];
        const lastShotTime = lastShotTimesRef.current[index];

        if (isGun && now - lastShotTime > FIRE_RATE_MS) {
            lastShotTimesRef.current[index] = now;
            const ndc = new THREE.Vector2((aim.x * 2) - 1, -(aim.y * 2) + 1);
            if (!cameraRef.current || !sceneRef.current) return;
            fireLaser(ndc);

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(ndc, cameraRef.current);
            const activeGroups = enemiesRef.current.filter(e => e.active).map(e => e.group);
            const intersects = raycaster.intersectObjects(activeGroups, true);

            if (intersects.length > 0) {
                let hitObj: THREE.Object3D | null = intersects[0].object;
                let hitEnemyId: string | null = null;
                while(hitObj && hitObj !== sceneRef.current) {
                    if (hitObj.userData && hitObj.userData.isEnemy) {
                        hitEnemyId = hitObj.userData.id;
                        break;
                    }
                    hitObj = hitObj.parent;
                }

                if (hitEnemyId) {
                    const enemyIndex = enemiesRef.current.findIndex(e => e.id === hitEnemyId);
                    if (enemyIndex !== -1) {
                        const enemy = enemiesRef.current[enemyIndex];
                        const screenX = aim.x * window.innerWidth;
                        const screenY = aim.y * window.innerHeight;
                        enemy.active = false;
                        sceneRef.current.remove(enemy.group);
                        triggerSantaSmile();
                        if (enemy.type === 'orb') {
                            bombsRef.current = Math.min(bombsRef.current + 1, MAX_BOMBS);
                            setBombs(bombsRef.current);
                            playSound('powerup');
                            createFloatingText("GIFT COLLECTED!", screenX, screenY, 'powerup');
                        } else if (enemy.type === 'health') {
                            livesRef.current = Math.min(livesRef.current + 1, MAX_LIVES);
                            setLives(livesRef.current);
                            playSound('powerup');
                            createFloatingText("SWEET TREAT!", screenX, screenY, 'powerup');
                        } else {
                            const points = enemy.type === 'boss' ? 300 : 100;
                            scoreRef.current += points;
                            setScore(scoreRef.current);
                            playSound('hit');
                            const phrases = ["BAH!", "HUMBUG!", "GOTCHA!", "STAY BACK!"];
                            createFloatingText(phrases[Math.floor(Math.random() * phrases.length)], screenX, screenY, 'hit');
                        }
                    }
                }
            }
        }
    });
  };

  const drawHandSkeleton = (ctx: CanvasRenderingContext2D, landmarks: any[], isGun: boolean) => {
      const width = debugCanvasRef.current!.width;
      const height = debugCanvasRef.current!.height;
      ctx.save();
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      const drawBone = (indices: number[], color: string) => {
          ctx.beginPath();
          ctx.moveTo(landmarks[indices[0]].x * width, landmarks[indices[0]].y * height);
          for (let i = 1; i < indices.length; i++) ctx.lineTo(landmarks[indices[i]].x * width, landmarks[indices[i]].y * height);
          ctx.strokeStyle = color;
          ctx.lineWidth = 6; 
          ctx.lineCap = 'round';
          ctx.stroke();
      };
      const baseColor = '#ffffff';
      drawBone([0, 5, 9, 13, 17, 0], baseColor);
      drawBone([0, 5, 6, 7, 8], isGun ? '#ef4444' : '#ffffff');
      drawBone([0, 9, 10, 11, 12], '#ffffff');
      drawBone([0, 13, 14, 15, 16], '#ffffff');
      drawBone([0, 17, 18, 19, 20], '#ffffff');
      ctx.restore();
  };

  const onHandResults = useCallback((results: Results) => {
    const ctx = debugCanvasRef.current?.getContext('2d');
    if (ctx && debugCanvasRef.current) ctx.clearRect(0, 0, debugCanvasRef.current.width, debugCanvasRef.current.height);

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      handAimsRef.current = [null, null];
      handGunsRef.current = [false, false];
      handFistsRef.current = [false, false];
      setHandsUIState([]);
      return;
    }

    const newHandStates: HandState[] = [];
    const newAims = [null, null] as ( {x: number, y: number} | null )[];
    const newGuns = [false, false];
    const newFists = [false, false];

    results.multiHandLandmarks.forEach((landmarks, index) => {
        if (index > 1) return; // Limit to 2 hands
        
        const d = (i1: number, i2: number) => {
            const p1 = landmarks[i1];
            const p2 = landmarks[i2];
            return Math.hypot(p1.x - p2.x, p1.y - p2.y);
        };
        const indexExtended = d(0, 8) > d(0, 6) * 1.05; 
        const indexCurled = d(0, 8) < d(0, 5) * 1.2; 
        const middleCurled = d(0, 12) < d(0, 9) * 1.2; 
        const ringCurled = d(0, 16) < d(0, 13) * 1.2;
        const pinkyCurled = d(0, 20) < d(0, 17) * 1.2;
        const isGun = indexExtended && middleCurled && ringCurled && !indexCurled;
        const isFist = indexCurled && middleCurled && ringCurled && pinkyCurled;
        
        const aimPoint = isFist ? landmarks[9] : landmarks[8];
        const aimX = 1 - aimPoint.x; 
        const aimY = aimPoint.y;
        
        let finalAimX = aimX;
        let finalAimY = aimY;
        if (isGun && cameraRef.current) {
            let minDist = MAGNETIC_RADIUS;
            let closestEnemyPos: THREE.Vector3 | null = null;
            enemiesRef.current.forEach(enemy => {
                if (!enemy.active) return;
                const pos = enemy.group.position.clone();
                pos.project(cameraRef.current!);
                const ex = (pos.x + 1) / 2;
                const ey = -(pos.y - 1) / 2;
                const dist = Math.sqrt(Math.pow(ex - aimX, 2) + Math.pow(ey - aimY, 2));
                if (dist < minDist) { minDist = dist; closestEnemyPos = pos; }
            });
            if (closestEnemyPos) { finalAimX = (closestEnemyPos.x + 1) / 2; finalAimY = -(closestEnemyPos.y - 1) / 2; }
        }

        newAims[index] = { x: finalAimX, y: finalAimY };
        newGuns[index] = isGun;
        newFists[index] = isFist;
        newHandStates.push({ indexExtended, isGun, isFist, aim: { x: finalAimX, y: finalAimY } });

        if (ctx) drawHandSkeleton(ctx, landmarks, isGun);
    });

    handAimsRef.current = newAims;
    handGunsRef.current = newGuns;
    handFistsRef.current = newFists;
    setHandsUIState(newHandStates);
  }, []);

  const gameLoop = (time: number) => {
    requestRef.current = requestAnimationFrame(gameLoop);
    if (livesRef.current <= 0) return;
    if (isReadyRef.current && videoRef.current && handsRef.current && videoRef.current.readyState === 4) {
      if (time - lastDetectionTimeRef.current >= DETECTION_INTERVAL) {
        lastDetectionTimeRef.current = time;
        try { handsRef.current.send({ image: videoRef.current }); } catch (e) {}
      }
    }
    checkShooting();
    const activeCount = enemiesRef.current.filter(e => e.active).length;
    if (activeCount < MAX_ENEMIES && Math.random() < 0.04) spawnEnemy();
    if (snowParticlesRef.current) {
        const pos = snowParticlesRef.current.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < pos.length; i += 3) {
            pos[i+1] -= 0.1;
            if (pos[i+1] < -50) pos[i+1] = 50;
            pos[i] += Math.sin(time/500 + i) * 0.02;
        }
        snowParticlesRef.current.geometry.attributes.position.needsUpdate = true;
    }
    enemiesRef.current.forEach(enemy => {
        if (enemy.active) {
            const t = time / 1000;
            if (enemy.type === 'bird' || enemy.type === 'boss') {
                if (enemy.leftWing && enemy.rightWing) {
                    const fSpeed = enemy.type === 'boss' ? 8 : 15;
                    enemy.leftWing.rotation.z = Math.sin(t * fSpeed + enemy.seed) * 0.5;
                    enemy.rightWing.rotation.z = -Math.sin(t * fSpeed + enemy.seed) * 0.5;
                }
            } else {
                enemy.group.rotation.y += 0.02;
                enemy.group.rotation.x = Math.sin(t) * 0.2;
            }
            const currentPos = enemy.group.position;
            const dir = new THREE.Vector3(0, 0, 0).sub(currentPos).normalize();
            dir.y += Math.sin(t * 2 + enemy.seed) * 0.05;
            const sMod = enemy.type === 'boss' ? 0.7 : 1.0; 
            enemy.group.position.add(dir.multiplyScalar(FLIGHT_SPEED * sMod));
            enemy.group.lookAt(0, 0, 0);
            if (enemy.group.position.length() < 3) {
                enemy.active = false;
                sceneRef.current?.remove(enemy.group);
                if (enemy.type === 'bird' || enemy.type === 'boss') {
                    playSound('fail');
                    livesRef.current -= (enemy.type === 'boss' ? 2 : 1);
                    setLives(livesRef.current);
                    createFloatingText("BAH HUMBUG!", window.innerWidth/2, window.innerHeight/2, 'fail');
                    setDamageEffect(true); setTimeout(() => setDamageEffect(false), 200);
                    if (livesRef.current <= 0) { setGameOver(true); playSound('gameover'); }
                }
            }
        }
    });
    enemiesRef.current = enemiesRef.current.filter(e => e.active);
    if (rendererRef.current && sceneRef.current && cameraRef.current) rendererRef.current.render(sceneRef.current, cameraRef.current);
  };

  if (errorMsg) return (
      <div className="flex flex-col items-center justify-center w-full h-full bg-slate-900 text-white p-6">
          <h2 className="text-2xl font-bold text-red-500 mb-4">Bah Humbug!</h2>
          <p className="mb-6 text-center max-w-md">{errorMsg}</p>
          <button onClick={() => window.location.reload()} className="px-6 py-3 bg-red-600 hover:bg-red-500 rounded-full font-bold transition">Try Again</button>
      </div>
  );

  return (
  <div ref={mountRef} className={`relative w-full h-full bg-slate-100 overflow-hidden select-none ${hasStarted ? 'cursor-none' : 'cursor-auto'}`}>
       {!hasStarted && (
         <div className="absolute inset-0 bg-gradient-to-br from-blue-900 via-indigo-900 to-black z-[100] flex flex-col items-center justify-center p-8 text-white">
            <div className="absolute inset-0 opacity-20 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]"></div>
            <div className="relative mb-8 text-center animate-in zoom-in duration-700">
               <span className="text-8xl mb-4 block">🎅</span>
               <h1 className="text-6xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-red-500 drop-shadow-2xl">
                 BAH HUMBUG!
               </h1>
               <div className="w-24 h-1 bg-red-500 mx-auto mt-4 rounded-full"></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl w-full mb-12">
               <div className="bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/20 hover:bg-white/20 transition group">
                  <div className="text-3xl mb-2 group-hover:scale-110 transition">👉</div>
                  <h3 className="font-black text-xl mb-1 text-green-400">DUAL POINT</h3>
                  <p className="text-sm opacity-80">Use both hands! Extend index fingers to fire snowballs at Grinches!</p>
               </div>
               <div className="bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/20 hover:bg-white/20 transition group">
                  <div className="text-3xl mb-2 group-hover:scale-110 transition">✊</div>
                  <h3 className="font-black text-xl mb-1 text-red-400">DOUBLE BOMB</h3>
                  <p className="text-sm opacity-80">Hold either hand in a fist to charge a massive area-of-effect Blast!</p>
               </div>
               <div className="bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/20 hover:bg-white/20 transition group">
                  <div className="text-3xl mb-2 group-hover:scale-110 transition">🎄</div>
                  <h3 className="font-black text-xl mb-1 text-yellow-400">DEFEND</h3>
                  <p className="text-sm opacity-80">Don't let the Grinches, Gingerbread Men, or Snowmen touch you!</p>
               </div>
               <div className="bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/20 hover:bg-white/20 transition group">
                  <div className="text-3xl mb-2 group-hover:scale-110 transition">🎁</div>
                  <h3 className="font-black text-xl mb-1 text-white">LOOT</h3>
                  <p className="text-sm opacity-80">Shoot floating Gifts for bombs and Candy for extra lives!</p>
               </div>
            </div>

            <button onClick={handleStartGame} className="px-12 py-6 bg-red-600 border-4 border-white text-white text-3xl font-black rounded-full shadow-[0_0_30px_rgba(239,68,68,0.5)] hover:bg-red-500 hover:scale-110 active:scale-95 transition transform cursor-pointer">START MISSION</button>
            <p className="mt-8 text-xs opacity-50 font-mono uppercase tracking-widest animate-pulse">Camera Access Required</p>
         </div>
       )}

       {/* Game Scene Viewports */}
       <div className={`absolute top-0 left-0 w-full h-full bg-gradient-to-b from-blue-900 via-indigo-900 to-slate-950 transition-opacity duration-500 z-0 ${bgMode === 'space' ? 'opacity-100' : 'opacity-0'}`}>
          <div className="w-full h-full opacity-30 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]"></div>
       </div>

       <div className={`absolute top-0 left-0 w-full h-full bg-white pointer-events-none transition-opacity duration-300 z-50 ${bombFlash ? 'opacity-100' : 'opacity-0'}`} style={{ mixBlendMode: 'screen' }} />
       <div className={`absolute top-0 left-0 w-full h-full bg-red-600 pointer-events-none transition-opacity duration-75 z-20 ${damageEffect ? 'opacity-40' : 'opacity-0'}`} style={{ mixBlendMode: 'overlay' }} />
       
       <div className={`w-full h-full relative transition-transform duration-75 z-10 ${damageEffect ? 'translate-x-2 translate-y-2 rotate-1' : ''} ${bombFlash ? 'scale-105' : ''}`}>
           <video ref={videoRef} className={`absolute top-0 left-0 w-full h-full object-cover transition-opacity duration-500 ${bgMode === 'camera' ? 'opacity-100' : 'opacity-0'}`} style={{ transform: 'scaleX(-1)' }} playsInline muted />
           <canvas ref={debugCanvasRef} className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-90" />
           <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full pointer-events-none" />
       </div>

       {/* Santa Feedback UI */}
       <div className={`absolute bottom-10 left-10 transition-all duration-300 pointer-events-none z-50 flex flex-col items-center ${santaSmile ? 'opacity-100 translate-y-0 scale-110' : 'opacity-0 translate-y-10 scale-50'}`}>
          <span className="text-8xl drop-shadow-[0_0_20px_rgba(255,255,255,0.8)] animate-bounce">🎅✨</span>
          <span className="text-white font-black text-2xl tracking-tighter drop-shadow-md bg-red-600 px-4 py-1 rounded-full -mt-4">HO HO HO!</span>
       </div>

       {/* In-Game HUD */}
       <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-30">
          <div className="absolute top-6 left-6 flex flex-col gap-2">
            <div className="text-white font-mono text-4xl font-bold drop-shadow-[0_0_10px_rgba(239,68,68,0.8)] flex items-center gap-3">
                <span className="text-red-500">🎄</span>{score.toString().padStart(6, '0')}
            </div>
            <div className="text-xs text-white font-sans tracking-widest uppercase bg-red-600 px-2 py-1 rounded w-fit font-bold">BAH HUMBUG! AR</div>
          </div>

          <div className="absolute top-6 right-6 flex flex-col items-end gap-2">
             <div className="flex items-center gap-1 mb-2 bg-black/20 p-2 rounded-xl backdrop-blur-sm">
                 {Array.from({length: MAX_LIVES}).map((_, i) => (
                     <div key={i} className={`w-8 h-8 flex items-center justify-center transition-all duration-300 ${i < lives ? 'scale-110 opacity-100' : 'scale-50 opacity-20 grayscale'}`}>
                        <span className="text-3xl drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]">⭐</span>
                     </div>
                 ))}
             </div>
             <div className="flex items-center gap-2 bg-red-600/80 px-4 py-2 rounded-full border border-white/50 backdrop-blur-sm shadow-lg">
                <span className="text-2xl">🎁</span>
                <span className={`text-2xl font-mono font-bold ${bombs > 0 ? 'text-white' : 'text-white/40'}`}>x {bombs}</span>
             </div>
          </div>
          
          {bombCharge > 0 && bombs > 0 && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2 z-40">
                <div className="w-48 h-6 bg-white/20 rounded-full overflow-hidden border border-white/50 backdrop-blur-md">
                    <div className="h-full bg-gradient-to-r from-red-500 to-white transition-all duration-75" style={{ width: `${bombCharge * 100}%` }} />
                </div>
                <div className="text-white font-black tracking-widest text-lg animate-pulse drop-shadow-[0_0_8px_rgba(255,255,255,1)]">CHARGING MERRY BLAST</div>
            </div>
          )}

          {/* Individual Hand Crosshairs */}
       {handsUIState.map((hand, i) => hand.aim && (
          <div key={i} className="absolute transition-transform duration-75 ease-out will-change-transform"
            style={{ top: `${hand.aim.y * 100}%`, left: `${hand.aim.x * 100}%`, width: '60px', height: '60px',
             border: `3px dashed ${hand.isFist ? '#FFFFFF' : (hand.isGun ? '#FFFFFF' : '#ef4444')}`, 
             borderRadius: '50%',
             boxShadow: `0 0 20px ${hand.isFist ? '#FFFFFF' : (hand.isGun ? '#FFFFFF' : '#ef4444')}`,
             transform: 'translate(-50%, -50%) scale(1)' }}>
            <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-white rounded-full -translate-x-1/2 -translate-y-1/2"/>

            {/* Enhanced radial charge indicator for fists */}
            {hand.isFist && bombCharge > 0 && bombs > 0 && (
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
               {/* Outer ring using conic-gradient to show progress */}
               <div style={{ width: 96, height: 96, borderRadius: '50%', padding: 6, boxSizing: 'border-box',
                        background: `conic-gradient(rgba(255,255,255,0.95) ${bombCharge * 360}deg, rgba(255,255,255,0.12) ${bombCharge * 360}deg)`,
                        boxShadow: '0 0 30px rgba(255,255,255,0.9)' }}>
                {/* Inner fill to make a donut and show numeric countdown */}
                <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800 }}>
                  <div style={{ fontSize: 14 }}>{Math.max(0, ((1 - bombCharge) * BOMB_CHARGE_MS / 1000)).toFixed(1)}s</div>
                  <div style={{ fontSize: 10, opacity: 0.9 }}>CHARGE</div>
                </div>
               </div>
              </div>
            )}
          </div>
       ))}

          {/* Control Status */}
          <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2">
             <div className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-colors ${handsUIState.some(h => h.isFist) ? 'bg-red-600 border-white text-white' : (handsUIState.some(h => h.isGun) ? 'bg-green-600 border-white text-white' : 'bg-white/10 border-white/30 text-white/50')}`}>
                <span className="text-sm font-bold uppercase tracking-tight">
                    {handsUIState.length === 0 ? 'NO HANDS DETECTED' : (handsUIState.some(h => h.isFist) ? 'BLAST READY' : (handsUIState.some(h => h.isGun) ? 'DUAL POINTING' : 'IDLE'))}
                </span>
             </div>
          </div>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto flex flex-col items-center gap-1 group">
             <button onClick={() => setBgMode(prev => prev === 'camera' ? 'space' : 'camera')} className="px-6 py-2 bg-red-600 border-2 border-white rounded-full text-white font-mono text-sm hover:bg-red-700 transition flex items-center gap-2 backdrop-blur-sm shadow-xl active:scale-95">
                <span className="uppercase font-bold tracking-wider">{bgMode === 'camera' ? '📸 AR MODE' : '❄️ WINTER MODE'}</span>
             </button>
          </div>
       </div>

       {/* Game Over Screen */}
       {gameOver && (
          <div className="absolute top-0 left-0 w-full h-full bg-red-900/90 backdrop-blur-xl z-[200] flex flex-col items-center justify-center animate-in fade-in duration-500 cursor-auto pointer-events-auto text-white">
             <span className="text-8xl mb-4">🎅</span>
             <h1 className="text-6xl font-black mb-4 tracking-tighter drop-shadow-2xl">BAH HUMBUG!</h1>
             <div className="text-2xl font-mono mb-8 bg-black/20 px-6 py-2 rounded-full border border-white/20">SCORE: <span className="text-yellow-400 font-black">{score}</span></div>
             <button onClick={() => window.location.reload()} className="px-10 py-5 bg-white text-red-600 font-black text-2xl rounded-full hover:scale-105 hover:bg-green-100 transition transform shadow-2xl border-b-4 border-gray-300">RESTART ADVENTURE</button>
          </div>
       )}

       {/* Loading Overlay */}
       {loading && (
         <div className="absolute top-0 left-0 w-full h-full bg-red-600 z-[300] flex flex-col items-center justify-center text-white">
           <div className="relative w-32 h-32 mb-8 flex items-center justify-center">
             <div className="absolute inset-0 border-8 border-white/20 border-t-white rounded-full animate-spin shadow-xl"></div>
             <span className="text-2xl font-black text-white drop-shadow-md">BAH!</span>
           </div>
           <h1 className="text-4xl font-black tracking-tighter mb-2 italic uppercase">BAH HUMBUG!</h1>
           <p className="font-mono text-sm opacity-80 animate-pulse uppercase tracking-widest">{loadingStatus}</p>
         </div>
       )}
    </div>
  );
}
