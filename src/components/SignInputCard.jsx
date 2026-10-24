import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, CameraOff, Scan, RotateCcw, Play, Square, Users, Sparkles, Type, Hash, MessageSquare, Space, Delete, Clock, CheckCircle2 } from 'lucide-react';
import { classifyHands, ALPHABET_A_TO_Z, NUMBERS_0_TO_10, FULL_SIGN_VOCABULARY, distance } from '../utils/signClassifier';
import { uniSignStreamProcessor } from '../utils/uniSignEngine';
import {
  CAMERA_STATES,
  getCameraConstraints,
  getFriendlyCameraError,
  getMediaPipeStatus,
  hasCameraApi,
  stopMediaStream,
  waitForVideoReady
} from '../utils/cameraLifecycle';

export default function SignInputCard({
  signLanguage,
  setSignLanguage,
  isSessionActive,
  onStartSession,
  onStopSession,
  onResetSession,
  onGestureDetected,
  mirrorMode,
  setMirrorMode,
  inputMode,
  setInputMode,
  onFingerspellLetter,
  onFingerspellSpace,
  onFingerspellBackspace,
  sensitivity = 70
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [cameraState, setCameraState] = useState(CAMERA_STATES.IDLE);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [recognitionState, setRecognitionState] = useState('checking');
  const [currentGesture, setCurrentGesture] = useState(null);
  const [detectionConfidence, setDetectionConfidence] = useState(0);
  const [targetSecondPerson, setTargetSecondPerson] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Hold-to-Confirm steady recognition states (gives user time to show sign)
  const [candidateGesture, setCandidateGesture] = useState(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [confirmedGesture, setConfirmedGesture] = useState(null);

  // Motion Tracking & Turn-taking State
  const [motionState, setMotionState] = useState('idle'); // 'idle' | 'moving' | 'paused' | 'analyzing'
  const [lastSpokenPhrase, setLastSpokenPhrase] = useState('');
  const [bufferFillCount, setBufferFillCount] = useState(0);
  const [poseDetected, setPoseDetected] = useState(false);
  const [handCountDetected, setHandCountDetected] = useState(0);

  // Refs for velocity, timing, pause detection, and signBridge 16-frame clip buffer
  const prevLandmarksRef = useRef(null);
  const lastMotionTimeRef = useRef(0);
  const isMovingRef = useRef(false);
  const pauseTriggerTimeoutRef = useRef(null);
  const handsModelRef = useRef(null);
  const poseModelRef = useRef(null);
  const poseLandmarksRef = useRef(null);
  const cameraUtilRef = useRef(null);
  const isAnalyzingRef = useRef(false);
  const lastProcessedTimeRef = useRef(0);
  const recentDetectionsRef = useRef([]);
  const lastEmittedSignRef = useRef(null);
  const lastEmittedTimeRef = useRef(0);
  const isMountedRef = useRef(true);
  const startRequestIdRef = useRef(0);

  // Candidate hold tracker ref (requires steady holding before emitting)
  const candidateRef = useRef({
    name: null,
    sign: null,
    startTime: 0,
    lastSeenTime: 0,
    consecutiveFrames: 0,
    jitterFrames: 0
  });
  const confirmedTimeoutRef = useRef(null);

  // signBridge 16-frame temporal buffer (~12.5 FPS / 80ms per frame)
  const CLIP_LENGTH = 16;
  const clipBufferRef = useRef([]);
  const lastBufferTimeRef = useRef(0);
  const isSendingFrameRef = useRef(false);
  const frameLoopIdRef = useRef(null);
  const cameraActiveRef = useRef(false);
  const [scannedFrameCount, setScannedFrameCount] = useState(0);

  // Keep latest callbacks in mutable refs to avoid stale closures in MediaPipe
  const onHandsResultsRef = useRef(null);
  const onPoseResultsRef = useRef(null);

  const loadScript = useCallback((src) => new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Document is not available.'));
      return;
    }

    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (existingScript) {
      if (existingScript.dataset.loaded === 'true') {
        resolve();
        return;
      }

      existingScript.addEventListener('load', () => {
        existingScript.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      existingScript.addEventListener('error', () => reject(new Error(`Failed to load MediaPipe script: ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load MediaPipe script: ${src}`));
    document.head.appendChild(script);
  }), []);

  /**
   * Robust model loader that safely initializes MediaPipe Hands & Pose.
   * It verifies script availability explicitly and handles CDN failures gracefully.
   */
  const ensureModelsLoaded = useCallback(async () => {
    if (typeof window === 'undefined') return false;

    const status = getMediaPipeStatus(window);
    if (status.ready) {
      setRecognitionState('ready');
      return true;
    }

    setRecognitionState('loading');

    try {
      const scriptMap = [
        'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js',
        'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js',
        'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js'
      ];

      await Promise.all(scriptMap.map((src) => loadScript(src)));
    } catch (error) {
      console.error('MediaPipe resource loading failed:', error);
      setRecognitionState('unavailable');
      throw new Error('MediaPipe recognition dependencies could not be loaded.');
    }

    if (!window.Hands || !window.Pose) {
      setRecognitionState('unavailable');
      throw new Error('MediaPipe Hands and Pose were not available after script load.');
    }

    if (!handsModelRef.current && window.Hands) {
      try {
        const hands = new window.Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        hands.onResults((results) => {
          onHandsResultsRef.current?.(results);
        });

        handsModelRef.current = hands;
      } catch (err) {
        console.error('Hands initialization error:', err);
        throw err;
      }
    }

    if (!poseModelRef.current && window.Pose) {
      try {
        const pose = new window.Pose({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
        });

        pose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        pose.onResults((results) => {
          onPoseResultsRef.current?.(results);
        });

        poseModelRef.current = pose;
      } catch (err) {
        console.warn('Pose initialization warning:', err);
      }
    }

    const finalStatus = getMediaPipeStatus(window);
    setRecognitionState(finalStatus.ready ? 'ready' : 'unavailable');
    return finalStatus.ready;
  }, [loadScript]);

  const stopCamera = useCallback(() => {
    cameraActiveRef.current = false;
    if (frameLoopIdRef.current) {
      cancelAnimationFrame(frameLoopIdRef.current);
      frameLoopIdRef.current = null;
    }
    if (cameraUtilRef.current) {
      cameraUtilRef.current.stop();
      cameraUtilRef.current = null;
    }
    if (videoRef.current) {
      if (videoRef.current.srcObject) {
        stopMediaStream(videoRef.current.srcObject);
      }
      videoRef.current.srcObject = null;
      videoRef.current.pause?.();
    }
    if (pauseTriggerTimeoutRef.current) {
      clearTimeout(pauseTriggerTimeoutRef.current);
      pauseTriggerTimeoutRef.current = null;
    }
    if (confirmedTimeoutRef.current) {
      clearTimeout(confirmedTimeoutRef.current);
      confirmedTimeoutRef.current = null;
    }
    candidateRef.current = {
      name: null,
      sign: null,
      startTime: 0,
      lastSeenTime: 0,
      consecutiveFrames: 0,
      jitterFrames: 0
    };
    clipBufferRef.current = [];
    setBufferFillCount(0);
    setCameraState(CAMERA_STATES.IDLE);
    setCameraActive(false);
    setCurrentGesture(null);
    setCandidateGesture(null);
    setConfirmedGesture(null);
    setHoldProgress(0);
    setMotionState('idle');
    setPoseDetected(false);
    setHandCountDetected(0);
    onStopSession?.();
  }, [onStopSession]);

  useEffect(() => {
    isMountedRef.current = true;
    void ensureModelsLoaded().catch(() => {
      if (isMountedRef.current) {
        setCameraError('MediaPipe model assets could not be loaded. Recognition will remain unavailable until the page is refreshed.');
      }
    });

    const timer = setInterval(() => {
      if (!handsModelRef.current && isMountedRef.current) {
        void ensureModelsLoaded().catch(() => undefined);
      } else {
        clearInterval(timer);
      }
    }, 400);

    return () => {
      isMountedRef.current = false;
      clearInterval(timer);
      stopCamera();
    };
  }, [ensureModelsLoaded, stopCamera]);

  /**
   * Listener for MediaPipe Pose (Head, Chin, Forehead, Shoulders, Chest)
   */
  const onPoseResults = useCallback((results) => {
    if (results && results.poseLandmarks && results.poseLandmarks.length > 0) {
      poseLandmarksRef.current = results.poseLandmarks;
      setPoseDetected(true);
    } else {
      poseLandmarksRef.current = null;
      setPoseDetected(false);
    }
  }, []);

  useEffect(() => {
    onPoseResultsRef.current = onPoseResults;
  }, [onPoseResults]);

  /**
   * Finalize the signed thought using pure Uni-Sign (ICLR 2025) ST-GCN multi-frame sequence translation
   */
  const processCompletedSigning = useCallback(async () => {
    if (!videoRef.current || isAnalyzingRef.current) return;

    const now = Date.now();
    if (now - lastProcessedTimeRef.current < 1600) return; // Prevent double-triggering

    isAnalyzingRef.current = true;
    setMotionState('analyzing');

    try {
      const result = uniSignStreamProcessor.translateSequence(clipBufferRef.current, currentGesture, {
        language: signLanguage,
        mode: inputMode
      });

      if (result && result.detected && (result.text || result.signName)) {
        lastProcessedTimeRef.current = Date.now();
        const cleanText = (result.text || result.signName || '').trim();
        const isLetter = result.type === 'letter' || (cleanText.length === 1 && /^[A-Z]$/i.test(cleanText));
        const isNumber = result.type === 'number' || (cleanText.length === 1 && /^[0-9]$/.test(cleanText));
        const isWord = !isLetter && !isNumber;

        const signObj = {
          id: (result.signName || cleanText).toLowerCase().replace(/\s+/g, '_'),
          name: result.signName || (isLetter ? `Letter ${cleanText.toUpperCase()}` : cleanText),
          type: isLetter ? 'letter' : (isNumber ? 'number' : 'word'),
          text: isLetter ? cleanText.toUpperCase() : cleanText,
          phrase: isLetter ? cleanText.toUpperCase() : cleanText,
          isLetter: isLetter,
          letter: isLetter ? cleanText.toUpperCase() : undefined,
          isNumber: isNumber,
          digit: isNumber ? cleanText : undefined,
          isWord: isWord,
          hindiPhrase: result.hindi || '',
          confidence: result.confidence || 0.98,
          source: 'Uni-Sign (ICLR 2025) ST-GCN Buffer'
        };

        setCurrentGesture(signObj);
        setConfirmedGesture(signObj);
        setHoldProgress(100);
        setDetectionConfidence(Math.round(signObj.confidence * 100));
        setLastSpokenPhrase(signObj.text);
        onGestureDetected(signObj);

        if (confirmedTimeoutRef.current) clearTimeout(confirmedTimeoutRef.current);
        confirmedTimeoutRef.current = setTimeout(() => {
          setConfirmedGesture(null);
          setHoldProgress(0);
          setCandidateGesture(null);
        }, 1500);
      } else if (currentGesture) {
        lastProcessedTimeRef.current = Date.now();
        setConfirmedGesture(currentGesture);
        setHoldProgress(100);
        onGestureDetected(currentGesture);
        setLastSpokenPhrase(currentGesture.text || currentGesture.phrase);

        if (confirmedTimeoutRef.current) clearTimeout(confirmedTimeoutRef.current);
        confirmedTimeoutRef.current = setTimeout(() => {
          setConfirmedGesture(null);
          setHoldProgress(0);
          setCandidateGesture(null);
        }, 1500);
      }
    } catch (err) {
      console.error('Uni-Sign ST-GCN translation error:', err);
    } finally {
      setTimeout(() => {
        isAnalyzingRef.current = false;
        setMotionState('idle');
      }, 350);
    }
  }, [signLanguage, inputMode, currentGesture, onGestureDetected]);

  /**
   * Helper to draw connections manually if drawing_utils CDN is delayed
   */
  const drawCustomHandSkeleton = (ctx, landmarks, strokeColor, fillColor) => {
    const HAND_PAIRS = [
      [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8],       // Index
      [0, 9], [9, 10], [10, 11], [11, 12],  // Middle
      [0, 13], [13, 14], [14, 15], [15, 16],// Ring
      [0, 17], [17, 18], [18, 19], [19, 20],// Pinky
      [5, 9], [9, 13], [13, 17]              // Palm
    ];

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    HAND_PAIRS.forEach(([i, j]) => {
      const p1 = landmarks[i];
      const p2 = landmarks[j];
      if (p1 && p2) {
        ctx.beginPath();
        ctx.moveTo(p1.x * ctx.canvas.width, p1.y * ctx.canvas.height);
        ctx.lineTo(p2.x * ctx.canvas.width, p2.y * ctx.canvas.height);
        ctx.stroke();
      }
    });

    landmarks.forEach((p, idx) => {
      const isTip = [4, 8, 12, 16, 20].includes(idx);
      ctx.beginPath();
      ctx.arc(p.x * ctx.canvas.width, p.y * ctx.canvas.height, isTip ? 5 : 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = isTip ? '#ffffff' : fillColor;
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  };

  /**
   * Landmark frame listener with velocity, Pose anchors, and pause detection
   */
  const onHandsResults = useCallback((results) => {
    const canvas = canvasRef.current;
    if (!canvas || !videoRef.current) return;

    setScannedFrameCount(c => c + 1);

    const ctx = canvas.getContext('2d');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (mirrorMode && !targetSecondPerson) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    // 1. Draw MediaPipe Pose Skeleton (signBridge emerald green overlay)
    const poseLms = poseLandmarksRef.current;
    if (poseLms && poseLms.length > 0) {
      if (window.drawConnectors && window.POSE_CONNECTIONS) {
        window.drawConnectors(ctx, poseLms, window.POSE_CONNECTIONS, {
          color: '#10b981',
          lineWidth: 2.5
        });
        if (window.drawLandmarks) {
          window.drawLandmarks(ctx, poseLms.slice(0, 23), {
            color: '#ffffff',
            fillColor: '#059669',
            radius: 3,
            lineWidth: 1
          });
        }
      } else {
        // Fallback draw key head & shoulder anchors
        [0, 11, 12].forEach(idx => {
          const pt = poseLms[idx];
          if (pt) {
            ctx.beginPath();
            ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 4, 0, 2 * Math.PI);
            ctx.fillStyle = '#10b981';
            ctx.fill();
          }
        });
      }
    }

    // 2. Draw Hands (Left Hand cyan #06b6d4, Right Hand purple #c084fc)
    const handCount = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
    setHandCountDetected(handCount);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      results.multiHandLandmarks.forEach((landmarks, idx) => {
        const isSecondHand = idx === 1;
        const strokeColor = isSecondHand ? '#c084fc' : '#06b6d4';
        const fillColor = isSecondHand ? '#9333ea' : '#0284c7';

        if (window.drawConnectors && window.HAND_CONNECTIONS) {
          window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, {
            color: strokeColor,
            lineWidth: 3
          });
          if (window.drawLandmarks) {
            window.drawLandmarks(ctx, landmarks, {
              color: '#ffffff',
              fillColor: fillColor,
              radius: 3.5,
              lineWidth: 1
            });
          }
        } else {
          drawCustomHandSkeleton(ctx, landmarks, strokeColor, fillColor);
        }
      });

      // Maintain Uni-Sign 16-frame sliding temporal clip buffer (~12.5 FPS / 80ms)
      const now = Date.now();
      if (now - lastBufferTimeRef.current >= 80) {
        lastBufferTimeRef.current = now;
        clipBufferRef.current.push({
          handsLandmarks: results.multiHandLandmarks,
          poseLandmarks: poseLandmarksRef.current,
          timestamp: now
        });
        if (clipBufferRef.current.length > CLIP_LENGTH) {
          clipBufferRef.current.shift();
        }
        setBufferFillCount(clipBufferRef.current.length);
      }

      // Multi-point motion velocity tracking across wrist and fingertips
      const h0 = results.multiHandLandmarks[0];
      let maxDisplacement = 0;
      let avgDisplacement = 0;

      if (prevLandmarksRef.current && prevLandmarksRef.current.length >= 21) {
        const prevH0 = prevLandmarksRef.current;
        const keyPoints = [0, 4, 8, 12, 16, 20];
        let totalD = 0;
        keyPoints.forEach(pt => {
          const d = distance(h0[pt], prevH0[pt]);
          if (d > maxDisplacement) maxDisplacement = d;
          totalD += d;
        });
        avgDisplacement = totalD / keyPoints.length;
      }
      prevLandmarksRef.current = h0;

      // Active gesture motion: true if either fingertips or wrist is moving
      const isMoving = maxDisplacement > 0.012 || avgDisplacement > 0.006;

      if (isMoving) {
        isMovingRef.current = true;
        lastMotionTimeRef.current = now;
        setMotionState('moving');

        // Cancel any pending pause completion while hands are actively moving
        if (pauseTriggerTimeoutRef.current) {
          clearTimeout(pauseTriggerTimeoutRef.current);
          pauseTriggerTimeoutRef.current = null;
        }
      } else {
        // Hands are held steady or paused
        if (isMovingRef.current && now - lastMotionTimeRef.current > 550) {
          // Person paused to finish what they want to say
          setMotionState('paused');

          if (!pauseTriggerTimeoutRef.current && !isAnalyzingRef.current) {
            pauseTriggerTimeoutRef.current = setTimeout(() => {
              isMovingRef.current = false;
              pauseTriggerTimeoutRef.current = null;
              processCompletedSigning();
            }, 300); // 300ms verification pause
          }
        } else if (inputMode === 'phrases' && !isMoving && !isAnalyzingRef.current) {
          // In phrases mode: If hands are held steady and not in motion, let Uni-Sign ST-GCN interpret
          if (now - lastMotionTimeRef.current > 850 && now - lastProcessedTimeRef.current > 2200) {
            if (!pauseTriggerTimeoutRef.current && clipBufferRef.current.length >= 3) {
              setMotionState('paused');
              pauseTriggerTimeoutRef.current = setTimeout(() => {
                pauseTriggerTimeoutRef.current = null;
                processCompletedSigning();
              }, 250);
            }
          }
        }
      }

      // Run local classifier using both Hands and Pose anchors
      const detected = classifyHands(results.multiHandLandmarks, poseLandmarksRef.current, signLanguage, inputMode);
      const nowMs = Date.now();
      // Hold duration adjusted dynamically by sensitivity: lower sensitivity -> more hold needed to ensure clarity
      const baseHoldDuration = inputMode === 'alphabet' ? 850 : (inputMode === 'numbers' ? 900 : 1100);
      const holdDuration = Math.round(baseHoldDuration * (1.4 - (sensitivity / 100) * 0.6));

      if (detected) {
        setCurrentGesture(detected);
        setDetectionConfidence(Math.round(detected.confidence * 100));

        const cand = candidateRef.current;
        if (cand.name === detected.name) {
          // Sustaining the exact same sign
          cand.lastSeenTime = nowMs;
          cand.consecutiveFrames += 1;
          cand.jitterFrames = 0;
          cand.sign = detected;

          const elapsed = nowMs - cand.startTime;
          const progress = Math.min(100, Math.round((elapsed / holdDuration) * 100));
          setHoldProgress(progress);
          setCandidateGesture(detected);

          // Once held steady for required hold time with solid consecutive frame agreement
          if (progress >= 100 && cand.consecutiveFrames >= 4) {
            const timeSinceLastEmit = nowMs - lastEmittedTimeRef.current;
            const isSameAsLast = lastEmittedSignRef.current === detected.name;

            // Enforce cooldown before repeating identical sign, or emit immediately if it's a new sign
            if (!isSameAsLast || timeSinceLastEmit > 1600) {
              lastEmittedSignRef.current = detected.name;
              lastEmittedTimeRef.current = nowMs;

              setConfirmedGesture(detected);
              setHoldProgress(100);

              // Deliver confirmed sign to output
              onGestureDetected(detected);

              // Reset candidate tracker for next sign
              candidateRef.current = {
                name: null,
                sign: null,
                startTime: 0,
                lastSeenTime: 0,
                consecutiveFrames: 0,
                jitterFrames: 0
              };

              if (confirmedTimeoutRef.current) clearTimeout(confirmedTimeoutRef.current);
              confirmedTimeoutRef.current = setTimeout(() => {
                setConfirmedGesture(null);
                setHoldProgress(0);
                setCandidateGesture(null);
              }, 750);
            }
          }
        } else {
          // Different candidate gesture
          // If previous candidate had multiple frames, tolerate a 1-frame jitter before switching
          if (cand.name && nowMs - cand.lastSeenTime < 180 && cand.consecutiveFrames >= 3) {
            cand.jitterFrames = (cand.jitterFrames || 0) + 1;
            if (cand.jitterFrames <= 2) {
              // Maintain current candidate during momentary transition noise
              ctx.restore();
              return;
            }
          }

          // Start observing the newly formed sign
          candidateRef.current = {
            name: detected.name,
            sign: detected,
            startTime: nowMs,
            lastSeenTime: nowMs,
            consecutiveFrames: 1,
            jitterFrames: 0
          };
          setCandidateGesture(detected);
          setHoldProgress(10);
        }
      } else {
        // No valid gesture in this frame
        const cand = candidateRef.current;
        if (cand.name && nowMs - cand.lastSeenTime > 320) {
          // User relaxed or dropped hand
          candidateRef.current = {
            name: null,
            sign: null,
            startTime: 0,
            lastSeenTime: 0,
            consecutiveFrames: 0,
            jitterFrames: 0
          };
          setCandidateGesture(null);
          setHoldProgress(0);
        }
      }
    } else {
      prevLandmarksRef.current = null;
      recentDetectionsRef.current = [];
      candidateRef.current = {
        name: null,
        sign: null,
        startTime: 0,
        lastSeenTime: 0,
        consecutiveFrames: 0,
        jitterFrames: 0
      };
      setCandidateGesture(null);
      setHoldProgress(0);
      if (isMovingRef.current) {
        // Hands dropped after gesturing -> trigger completion
        isMovingRef.current = false;
        if (!isAnalyzingRef.current) {
          processCompletedSigning();
        }
      }
      setMotionState('idle');
    }

    ctx.restore();
  }, [mirrorMode, targetSecondPerson, signLanguage, inputMode, sensitivity, processCompletedSigning, onGestureDetected]);

  useEffect(() => {
    onHandsResultsRef.current = onHandsResults;
  }, [onHandsResults]);

  /**
   * Start camera with robust universal getUserMedia and resilient frame driving loop.
   */
  const startCamera = useCallback(async (customTargetSecondPerson) => {
    const isSecondPerson = customTargetSecondPerson !== undefined ? customTargetSecondPerson : targetSecondPerson;
    const requestId = ++startRequestIdRef.current;

    if (!isMountedRef.current) return;
    if (!hasCameraApi()) {
      setCameraState(CAMERA_STATES.ERROR);
      setCameraError('This browser does not support webcam access. Please use a modern browser with camera support.');
      return;
    }

    if (cameraState === CAMERA_STATES.REQUESTING_PERMISSION || cameraState === CAMERA_STATES.INITIALIZING || cameraState === CAMERA_STATES.STOPPING) {
      return;
    }

    setCameraError(null);
    setCameraState(CAMERA_STATES.REQUESTING_PERMISSION);

    try {
      const isMediaPipeReady = await ensureModelsLoaded();
      if (!isMediaPipeReady) {
        throw new Error('MediaPipe recognition dependencies are unavailable.');
      }

      setCameraState(CAMERA_STATES.INITIALIZING);

      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(getCameraConstraints(!isSecondPerson));
      } catch (firstError) {
        console.warn('Constrained getUserMedia failed, falling back to basic video:', firstError);
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }

      if (requestId !== startRequestIdRef.current) {
        stopMediaStream(stream);
        return;
      }

      if (!videoRef.current) {
        stopMediaStream(stream);
        throw new Error('Video element was not ready when the camera stream was acquired.');
      }

      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      videoRef.current.autoplay = true;
      videoRef.current.playsInline = true;

      try {
        await waitForVideoReady(videoRef.current, 2000);
      } catch (videoError) {
        stopMediaStream(stream);
        throw videoError;
      }

      try {
        await videoRef.current.play();
      } catch (playError) {
        console.warn('Video playback warning:', playError);
      }

      if (requestId !== startRequestIdRef.current) {
        stopMediaStream(stream);
        return;
      }

      cameraActiveRef.current = true;
      setCameraState(CAMERA_STATES.ACTIVE);
      setCameraActive(true);
      onStartSession?.();

      const runFrameLoop = async () => {
        if (!cameraActiveRef.current || requestId !== startRequestIdRef.current) return;

        const video = videoRef.current;
        if (video && video.readyState >= 2 && !isSendingFrameRef.current) {
          isSendingFrameRef.current = true;

          try {
            if (handsModelRef.current) {
              await handsModelRef.current.send({ image: video });
            }
          } catch (err) {
            console.warn('Hands frame send warning:', err);
          }

          try {
            if (poseModelRef.current) {
              await poseModelRef.current.send({ image: video });
            }
          } catch (err) {
            // Pose is auxiliary and should never block the active camera feed.
          } finally {
            isSendingFrameRef.current = false;
          }
        }

        if (cameraActiveRef.current && requestId === startRequestIdRef.current) {
          frameLoopIdRef.current = requestAnimationFrame(runFrameLoop);
        }
      };

      if (frameLoopIdRef.current) {
        cancelAnimationFrame(frameLoopIdRef.current);
      }
      frameLoopIdRef.current = requestAnimationFrame(runFrameLoop);
    } catch (err) {
      const message = getFriendlyCameraError(err, 'Could not access the camera. Please allow webcam permissions in your browser.');
      console.error('Camera access error:', err);
      if (videoRef.current) {
        stopMediaStream(videoRef.current.srcObject);
        videoRef.current.srcObject = null;
        videoRef.current.pause?.();
      }
      setCameraError(message);
      setCameraState(CAMERA_STATES.ERROR);
      cameraActiveRef.current = false;
      setCameraActive(false);
    }
  }, [cameraState, ensureModelsLoaded, onStartSession, targetSecondPerson]);


  const handleSimulateGesture = (item) => {
    const signObj = {
      id: item.id,
      name: item.name || `Letter ${item.letter}`,
      phrase: item.phrase || item.letter || item.digit,
      hindiPhrase: item.hindiPhrase,
      confidence: 0.99,
      handsUsed: item.tags && item.tags.includes('Two Hands') ? 2 : 1,
      isLetter: item.isLetter,
      isNumber: item.isNumber
    };

    setCurrentGesture(signObj);
    setDetectionConfidence(99);
    setLastSpokenPhrase(signObj.phrase);
    onGestureDetected(signObj);
  };

  const categories = ['All', 'Greetings', 'Family', 'Responses', 'Questions', 'Emergency', 'Daily Needs', 'Emotions', 'Actions', 'Time'];
  const filteredVocabulary = selectedCategory === 'All'
    ? FULL_SIGN_VOCABULARY
    : FULL_SIGN_VOCABULARY.filter(item => item.category === selectedCategory);

  const cameraStatusLabel = cameraState === CAMERA_STATES.REQUESTING_PERMISSION
    ? 'REQUESTING'
    : cameraState === CAMERA_STATES.INITIALIZING
      ? 'INITIALIZING'
      : cameraState === CAMERA_STATES.ERROR
        ? 'ERROR'
        : cameraActive
          ? 'LIVE'
          : 'CAMERA OFF';

  return (
    <div style={{
      backgroundColor: 'var(--bg-card)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: 'var(--shadow-card)'
    }}>
      {/* Card Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 24px',
        borderBottom: '1px solid var(--border-subtle)',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Scan size={18} color="var(--text-secondary)" />
          <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Sign input
          </span>

          {/* Mode Switcher Tabs */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'var(--bg-card-subtle)',
            borderRadius: '999px',
            padding: '3px',
            border: '1px solid var(--border-subtle)',
            marginLeft: '12px'
          }}>
            <button
              onClick={() => setInputMode('phrases')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 12px',
                borderRadius: '999px',
                border: 'none',
                backgroundColor: inputMode === 'phrases' ? '#ffffff' : 'transparent',
                color: inputMode === 'phrases' ? '#000000' : 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <MessageSquare size={12} />
              <span>Phrases & Sentences</span>
            </button>

            <button
              onClick={() => setInputMode('alphabet')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 12px',
                borderRadius: '999px',
                border: 'none',
                backgroundColor: inputMode === 'alphabet' ? '#ffffff' : 'transparent',
                color: inputMode === 'alphabet' ? '#000000' : 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <Type size={12} />
              <span>A–Z Alphabet</span>
            </button>

            <button
              onClick={() => setInputMode('numbers')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 12px',
                borderRadius: '999px',
                border: 'none',
                backgroundColor: inputMode === 'numbers' ? '#ffffff' : 'transparent',
                color: inputMode === 'numbers' ? '#000000' : 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <Hash size={12} />
              <span>Numbers (0–10)</span>
            </button>
          </div>
        </div>

        {/* Uni-Sign Engine Status & Language */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: '6px',
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              color: '#10b981',
              fontSize: '11px',
              fontWeight: 600
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }} />
            <span>Uni-Sign ST-GCN Online</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label htmlFor="sign-lang-select" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Language:
            </label>
            <select
              id="sign-lang-select"
              value={signLanguage}
              onChange={(e) => setSignLanguage(e.target.value)}
              style={{
                backgroundColor: 'var(--bg-card-subtle)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                borderRadius: 'var(--radius-md)',
                padding: '5px 10px',
                fontSize: '12px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="ISL">Indian Sign Language (ISL)</option>
              <option value="ASL">American Sign Language (ASL)</option>
              <option value="BSL">British Sign Language (BSL)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Viewport Container */}
      <div
        onClick={() => {
          if (!cameraActive) startCamera();
        }}
        style={{
          position: 'relative',
          backgroundColor: '#0c0d10',
          minHeight: '440px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderBottom: '1px solid var(--border-subtle)',
          cursor: !cameraActive ? 'pointer' : 'default'
        }}
      >
        {/* Corner Reticle Brackets */}
        <div className={`corner-bracket corner-tl ${cameraActive ? 'active' : ''}`} />
        <div className={`corner-bracket corner-tr ${cameraActive ? 'active' : ''}`} />
        <div className={`corner-bracket corner-bl ${cameraActive ? 'active' : ''}`} />
        <div className={`corner-bracket corner-br ${cameraActive ? 'active' : ''}`} />

        {/* Top-Left Status HUD */}
        <div style={{
          position: 'absolute',
          top: '16px',
          left: '52px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: cameraState === CAMERA_STATES.ERROR ? '#f87171' : cameraActive ? 'var(--accent-green)' : 'var(--text-muted)',
          zIndex: 10,
          flexWrap: 'wrap'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: cameraState === CAMERA_STATES.ERROR ? '#f87171' : cameraActive ? 'var(--accent-green)' : 'var(--text-muted)',
              boxShadow: cameraActive ? '0 0 8px var(--accent-green)' : 'none'
            }} />
            <span>{cameraStatusLabel}</span>
          </div>

          <span style={{ color: 'var(--border-strong)', margin: '0 2px' }}>|</span>

          {/* Uni-Sign Multi-Modal ST-GCN Buffer Progress Bar */}
          {cameraActive && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 8px',
              borderRadius: '999px',
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              fontSize: '10px',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)'
            }}>
              <span style={{ color: bufferFillCount >= 16 ? '#10b981' : '#06b6d4' }}>
                UNI-SIGN ST-GCN BUFFER: {bufferFillCount}/16
              </span>
              <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                {[...Array(16)].map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: '3px',
                      height: '8px',
                      borderRadius: '1px',
                      backgroundColor: i < bufferFillCount ? '#10b981' : 'rgba(255, 255, 255, 0.12)',
                      transition: 'background-color 0.1s ease'
                    }}
                  />
                ))}
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>~12.5 FPS</span>
            </div>
          )}

          {/* Uni-Sign Pose & Hands Tracker Status */}
          {cameraActive && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)'
            }}>
              <span style={{
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: poseDetected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                color: poseDetected ? '#10b981' : '#64748b',
                border: `1px solid ${poseDetected ? 'rgba(16, 185, 129, 0.3)' : 'transparent'}`
              }}>
                {poseDetected ? 'UNI-SIGN BODY: LOCKED' : 'UNI-SIGN BODY: SCAN'}
              </span>
              <span style={{
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: handCountDetected > 0 ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                color: handCountDetected > 0 ? '#06b6d4' : '#64748b',
                border: `1px solid ${handCountDetected > 0 ? 'rgba(6, 182, 212, 0.3)' : 'transparent'}`
              }}>
                {handCountDetected > 0 ? `HANDS: ${handCountDetected}` : 'HANDS: 0'}
              </span>

              {currentGesture?.anchor && (
                <span style={{
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(245, 158, 11, 0.18)',
                  color: '#f59e0b',
                  border: '1px solid rgba(245, 158, 11, 0.4)',
                  fontWeight: 600
                }}>
                  ANCHOR: {currentGesture.anchor.toUpperCase()}
                </span>
              )}

              {candidateGesture && !confirmedGesture && (
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(6, 182, 212, 0.2)',
                  color: 'var(--accent-cyan)',
                  border: '1px solid rgba(6, 182, 212, 0.4)',
                  fontWeight: 600
                }}>
                  HOLDING: {candidateGesture.name} ({holdProgress}%)
                </span>
              )}

              {confirmedGesture && (
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(16, 185, 129, 0.25)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.5)',
                  fontWeight: 700
                }}>
                  ✓ CONFIRMED: {confirmedGesture.name}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Top-Right Motion State HUD */}
        <div style={{
          position: 'absolute',
          top: '16px',
          right: '52px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          zIndex: 10
        }}>
          {motionState === 'moving' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '999px',
              backgroundColor: 'rgba(245, 158, 11, 0.2)',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              color: 'var(--accent-amber)',
              fontSize: '11px',
              fontWeight: 600
            }}>
              <span className="animate-pulse-slow">●</span>
              <span>TRACKING MOVEMENTS...</span>
            </div>
          )}

          {motionState === 'paused' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '999px',
              backgroundColor: 'rgba(16, 185, 129, 0.2)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              color: 'var(--accent-green)',
              fontSize: '11px',
              fontWeight: 600
            }}>
              <Clock size={12} />
              <span>MOVEMENT PAUSED — FINALIZING...</span>
            </div>
          )}

          {motionState === 'analyzing' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '999px',
              backgroundColor: 'rgba(6, 182, 212, 0.2)',
              border: '1px solid rgba(6, 182, 212, 0.4)',
              color: 'var(--accent-cyan)',
              fontSize: '11px',
              fontWeight: 600
            }}>
              <Sparkles size={12} className="animate-pulse-slow" />
              <span>UNI-SIGN MULTIMODAL TRANSLATION...</span>
            </div>
          )}
        </div>

        {/* Video & Skeleton Canvas */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: cameraActive ? 'block' : 'none',
            transform: (mirrorMode && !targetSecondPerson) ? 'scaleX(-1)' : 'none',
            zIndex: 1
          }}
        />

        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: cameraActive ? 'block' : 'none',
            pointerEvents: 'none',
            backgroundColor: 'transparent',
            zIndex: 2
          }}
        />

        {/* Camera Off State */}
        {!cameraActive && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            maxWidth: '420px',
            padding: '30px 20px',
            zIndex: 10
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              backgroundColor: 'rgba(6, 182, 212, 0.1)',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '22px'
            }}>
              <Camera size={26} color="var(--accent-cyan)" />
            </div>

            <h3 style={{
              fontSize: '22px',
              fontWeight: 500,
              color: 'var(--text-primary)',
              marginBottom: '8px'
            }}>
              Ready when you are.
            </h3>

            <p style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              marginBottom: '24px'
            }}>
              Detects every sign movement precisely, waits for you to finish your sentence, and synthesizes speech as soon as you stop.
            </p>

            <button
              onClick={(e) => {
                e.stopPropagation();
                if (cameraState === CAMERA_STATES.REQUESTING_PERMISSION || cameraState === CAMERA_STATES.INITIALIZING) return;
                startCamera();
              }}
              disabled={cameraState === CAMERA_STATES.REQUESTING_PERMISSION || cameraState === CAMERA_STATES.INITIALIZING}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                backgroundColor: cameraState === CAMERA_STATES.ERROR ? '#f97316' : '#06b6d4',
                color: '#ffffff',
                border: 'none',
                borderRadius: '999px',
                padding: '14px 28px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: cameraState === CAMERA_STATES.REQUESTING_PERMISSION || cameraState === CAMERA_STATES.INITIALIZING ? 'not-allowed' : 'pointer',
                marginBottom: '16px',
                boxShadow: '0 4px 20px rgba(6, 182, 212, 0.4)',
                transition: 'all 0.2s ease',
                opacity: cameraState === CAMERA_STATES.REQUESTING_PERMISSION || cameraState === CAMERA_STATES.INITIALIZING ? 0.8 : 1
              }}
              onMouseEnter={e => {
                if (cameraState !== CAMERA_STATES.REQUESTING_PERMISSION && cameraState !== CAMERA_STATES.INITIALIZING) {
                  e.currentTarget.style.backgroundColor = cameraState === CAMERA_STATES.ERROR ? '#ea580c' : '#0891b2';
                }
              }}
              onMouseLeave={e => {
                if (cameraState !== CAMERA_STATES.REQUESTING_PERMISSION && cameraState !== CAMERA_STATES.INITIALIZING) {
                  e.currentTarget.style.backgroundColor = cameraState === CAMERA_STATES.ERROR ? '#f97316' : '#06b6d4';
                }
              }}
            >
              <Camera size={18} />
              <span>
                {cameraState === CAMERA_STATES.ERROR
                  ? 'Retry Camera'
                  : cameraState === CAMERA_STATES.REQUESTING_PERMISSION
                    ? 'Requesting camera access...'
                    : cameraState === CAMERA_STATES.INITIALIZING
                      ? 'Starting camera...'
                      : 'Enable camera & Start Translating'}
              </span>
            </button>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: 'var(--text-muted)'
            }}>
              <span>🔒</span>
              <span>Your browser will ask for camera access</span>
            </div>

            {cameraError && (
              <div style={{
                marginTop: '16px',
                padding: '8px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                fontSize: '12px',
                color: '#f87171'
              }}>
                {cameraError}
              </div>
            )}

            {recognitionState !== 'ready' && (
              <div style={{
                marginTop: '12px',
                fontSize: '11px',
                color: 'var(--text-muted)',
                letterSpacing: '0.05em',
                textTransform: 'uppercase'
              }}>
                Recognition status: {recognitionState === 'loading' ? 'Loading' : recognitionState === 'unavailable' ? 'Unavailable' : 'Checking'}
              </div>
            )}
          </div>
        )}

        {/* Central Recognition & Hold-to-Confirm Visual HUD */}
        {cameraActive && (candidateGesture || confirmedGesture || motionState === 'analyzing') && (
          <div style={{
            position: 'absolute',
            bottom: '54px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 25,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: confirmedGesture 
              ? 'rgba(16, 185, 129, 0.95)' 
              : (motionState === 'analyzing' ? 'rgba(6, 182, 212, 0.92)' : 'rgba(12, 13, 16, 0.88)'),
            backdropFilter: 'blur(16px)',
            border: `1.5px solid ${confirmedGesture ? '#10b981' : (motionState === 'analyzing' ? '#06b6d4' : 'rgba(6, 182, 212, 0.5)')}`,
            boxShadow: confirmedGesture 
              ? '0 8px 32px rgba(16, 185, 129, 0.5)' 
              : (motionState === 'analyzing' ? '0 8px 32px rgba(6, 182, 212, 0.5)' : '0 8px 30px rgba(0, 0, 0, 0.8)'),
            borderRadius: '16px',
            padding: '12px 22px',
            minWidth: '280px',
            maxWidth: '420px',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            {motionState === 'analyzing' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0' }}>
                <Sparkles size={18} color="#ffffff" className="animate-spin" />
                <span style={{ fontSize: '15px', fontWeight: 600, color: '#ffffff' }}>
                  Uni-Sign AI: Accurately Recognizing Sign...
                </span>
              </div>
            ) : (
              <>
                {/* Header: Sign Name & Confirmation Badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: confirmedGesture ? '#ffffff' : 'var(--accent-cyan)',
                      letterSpacing: '0.04em'
                    }}>
                      {confirmedGesture ? `✓ ${confirmedGesture.name}` : candidateGesture?.name}
                    </span>
                    {candidateGesture?.phrase && !confirmedGesture && (
                      <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.65)' }}>
                        "{candidateGesture.phrase}"
                      </span>
                    )}
                  </div>

                  <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    color: confirmedGesture ? '#ffffff' : (holdProgress > 70 ? '#10b981' : 'var(--accent-cyan)'),
                    backgroundColor: confirmedGesture ? 'rgba(0,0,0,0.2)' : 'rgba(255, 255, 255, 0.08)',
                    padding: '2px 8px',
                    borderRadius: '999px'
                  }}>
                    {confirmedGesture ? 'CONFIRMED' : `${holdProgress}%`}
                  </span>
                </div>

                {/* Hold-to-Confirm Animated Progress Bar */}
                {!confirmedGesture && (
                  <div style={{
                    width: '100%',
                    height: '7px',
                    backgroundColor: 'rgba(255, 255, 255, 0.12)',
                    borderRadius: '999px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${holdProgress}%`,
                      height: '100%',
                      borderRadius: '999px',
                      backgroundColor: holdProgress > 80 ? '#10b981' : '#06b6d4',
                      boxShadow: `0 0 10px ${holdProgress > 80 ? '#10b981' : '#06b6d4'}`,
                      transition: 'width 0.08s linear'
                    }} />
                  </div>
                )}

                {/* Instruction / Status Text */}
                <div style={{
                  fontSize: '11px',
                  color: confirmedGesture ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  {confirmedGesture ? (
                    <span>Confirmed & added to detected text</span>
                  ) : (
                    <span>Hold steady to recognize sign ({holdProgress}%)</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Reticle Guide */}
        <div style={{
          position: 'absolute',
          bottom: '20px',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: 'var(--text-muted)',
          zIndex: 10
        }}>
          FACE + BOTH HANDS IN FRAME (PAUSE WHEN FINISHED SIGNING)
        </div>

        {/* Manual Instant Translate Trigger & Second Person Switch */}
        <div style={{
          position: 'absolute',
          bottom: '16px',
          right: '52px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          zIndex: 15
        }}>
          {cameraActive && (
            <>
              <button
                onClick={processCompletedSigning}
                disabled={motionState === 'analyzing'}
                title="Click anytime to have Uni-Sign (ICLR 2025) ST-GCN accurately recognize whether this is a letter or a word sign"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 15px',
                  borderRadius: '8px',
                  backgroundColor: '#06b6d4',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: motionState === 'analyzing' ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 15px rgba(6, 182, 212, 0.45)',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#0891b2'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = '#06b6d4'}
              >
                <Sparkles size={14} color="#ffffff" className={motionState === 'analyzing' ? 'animate-spin' : ''} />
                <span>{motionState === 'analyzing' ? 'Translating...' : 'Translate Sign (Uni-Sign AI)'}</span>
              </button>

              <button
                onClick={stopCamera}
                title="Stop camera video feed"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(239, 68, 68, 0.2)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#f87171',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <CameraOff size={12} />
                <span>Stop Camera</span>
              </button>
            </>
          )}

          <button
            onClick={async () => {
              const nextVal = !targetSecondPerson;
              setTargetSecondPerson(nextVal);
              if (cameraActiveRef.current) {
                stopCamera();
                setTimeout(() => startCamera(nextVal), 150);
              }
            }}
            title="Toggle between scanning a second person facing you vs yourself"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '6px',
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            <Users size={12} color="var(--accent-cyan)" />
            <span>{targetSecondPerson ? 'Scanning 2nd Person' : 'Self Mode'}</span>
          </button>
        </div>
      </div>

      {/* Vocabulary Toolbar */}
      {inputMode === 'alphabet' ? (
        <div style={{
          padding: '12px 18px',
          backgroundColor: 'var(--bg-card-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-cyan)', letterSpacing: '0.06em' }}>
              COMPLETE A–Z FINGERSPELLING:
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onClick={onFingerspellSpace}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                <Space size={12} />
                <span>Space</span>
              </button>
              <button
                onClick={onFingerspellBackspace}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                <Delete size={12} />
                <span>Backspace</span>
              </button>
            </div>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            overflowX: 'auto',
            paddingBottom: '4px'
          }}>
            {ALPHABET_A_TO_Z.map(item => (
              <button
                key={item.id}
                onClick={() => handleSimulateGesture(item)}
                title={item.description}
                style={{
                  minWidth: '32px',
                  height: '32px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = 'var(--accent-cyan)';
                  e.currentTarget.style.color = '#000000';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }}
              >
                {item.letter}
              </button>
            ))}
          </div>
        </div>
      ) : inputMode === 'numbers' ? (
        <div style={{
          padding: '12px 18px',
          backgroundColor: 'var(--bg-card-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          overflowX: 'auto'
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-cyan)', letterSpacing: '0.06em' }}>
            NUMBERS (0–10):
          </span>
          {NUMBERS_0_TO_10.map(num => (
            <button
              key={num.id}
              onClick={() => handleSimulateGesture(num)}
              title={num.description}
              style={{
                minWidth: '36px',
                height: '32px',
                borderRadius: '6px',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = 'var(--accent-green)';
                e.currentTarget.style.color = '#000000';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
            >
              {num.digit}
            </button>
          ))}
        </div>
      ) : (
        <div style={{
          padding: '10px 18px',
          backgroundColor: 'var(--bg-card-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            overflowX: 'auto',
            paddingBottom: '2px'
          }}>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: '3px 9px',
                  borderRadius: '999px',
                  border: 'none',
                  backgroundColor: selectedCategory === cat ? '#ffffff' : 'rgba(255, 255, 255, 0.04)',
                  color: selectedCategory === cat ? '#000000' : 'var(--text-secondary)',
                  fontSize: '11px',
                  fontWeight: selectedCategory === cat ? 600 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
            paddingBottom: '4px'
          }}>
            {filteredVocabulary.map(sign => (
              <button
                key={sign.id}
                onClick={() => handleSimulateGesture(sign)}
                title={sign.description}
                style={{
                  padding: '4px 10px',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)';
                  e.currentTarget.style.color = '#ffffff';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                <span>{sign.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Card Footer */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 24px',
        backgroundColor: 'var(--bg-card)',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: cameraActive ? 'var(--accent-green)' : 'var(--text-muted)'
          }}>
            {cameraActive ? <Camera size={18} /> : <CameraOff size={18} />}
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
              {cameraActive ? 'Turn-Taking Motion Engine Active' : 'Camera access not enabled'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {cameraActive
                ? (isSessionActive ? 'Sign freely. When you stop moving, Uni-Sign translates your sign directly into spoken audio.' : 'Camera ready. Click Start session to begin.')
                : 'Enable your camera, then start a session to translate.'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => {
              stopCamera();
              onResetSession();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'transparent',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <RotateCcw size={14} />
            <span>Reset</span>
          </button>

          {!isSessionActive ? (
            <button
              onClick={() => {
                if (!cameraActive) {
                  startCamera();
                }
                onStartSession();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 18px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'}
            >
              <Play size={14} fill="currentColor" />
              <span>Start session</span>
            </button>
          ) : (
            <button
              onClick={() => {
                stopCamera();
                onStopSession();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 18px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'rgba(239, 68, 68, 0.18)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#fca5a5',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.28)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.18)'}
            >
              <Square size={14} fill="currentColor" />
              <span>Stop session</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
