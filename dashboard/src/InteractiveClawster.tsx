import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue, useSpring } from "framer-motion";

type Mood =
  | "idle"
  | "happy"
  | "sleep"
  | "walking"
  | "startle"
  | "peek"
  | "side-eye"
  | "doze"
  | "proud"
  | "huff"
  | "spin"
  | "crossed";

const PET_SIZE = 128;
const PET_FRAME = 160;
const VIEWPORT_PADDING = 24;
const HEADER_CLEARANCE = 88;
const DOZE_DELAY = 5_000;
const SLEEP_DELAY = 10_000;
const FOLLOW_START_DELAY = 8_000;
const FOLLOW_THRESHOLD = 200;
const FOLLOW_SPEED = 0.008;

const CLICK_EMOTES: Mood[] = ["happy", "proud", "startle", "spin", "huff", "crossed", "peek", "side-eye"];

const MOOD_DURATIONS: Partial<Record<Mood, number>> = {
  happy: 1_500,
  proud: 1_500,
  startle: 800,
  spin: 1_200,
  huff: 1_500,
  crossed: 1_500,
  peek: 1_500,
  "side-eye": 1_500,
};

const MOOD_MESSAGES: Partial<Record<Mood, string>> = {
  happy: "Hi there!",
  proud: "Look at me!",
  startle: "!",
  spin: "Wheee!",
  huff: "Hmph!",
  crossed: "...",
  peek: "Boo!",
  "side-eye": "I see you",
};

const MOOD_COLORS: Record<Mood, string> = {
  idle: "#a855f7",
  happy: "#FF8C69",
  sleep: "#6366f1",
  walking: "#8b5cf6",
  startle: "#ef4444",
  peek: "#22c55e",
  "side-eye": "#eab308",
  doze: "#3b82f6",
  proud: "#f97316",
  huff: "#ec4899",
  spin: "#14b8a6",
  crossed: "#008080",
};

const MOOD_ASSETS: Record<Mood, string> = {
  idle: new URL("./assets/clawster/idle.svg", import.meta.url).href,
  happy: new URL("./assets/clawster/happy.svg", import.meta.url).href,
  sleep: new URL("./assets/clawster/sleep.svg", import.meta.url).href,
  walking: new URL("./assets/clawster/walking.svg", import.meta.url).href,
  startle: new URL("./assets/clawster/startle.svg", import.meta.url).href,
  peek: new URL("./assets/clawster/peek.svg", import.meta.url).href,
  "side-eye": new URL("./assets/clawster/side-eye.svg", import.meta.url).href,
  doze: new URL("./assets/clawster/doze.svg", import.meta.url).href,
  proud: new URL("./assets/clawster/proud.svg", import.meta.url).href,
  huff: new URL("./assets/clawster/huff.svg", import.meta.url).href,
  spin: new URL("./assets/clawster/spin.svg", import.meta.url).href,
  crossed: new URL("./assets/clawster/crossed.svg", import.meta.url).href,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampToViewport(nextX: number, nextY: number) {
  const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - PET_FRAME - VIEWPORT_PADDING);
  const maxY = Math.max(HEADER_CLEARANCE, window.innerHeight - PET_FRAME - VIEWPORT_PADDING);

  return {
    x: clamp(nextX, VIEWPORT_PADDING, maxX),
    y: clamp(nextY, HEADER_CLEARANCE, maxY),
  };
}

export default function InteractiveClawster() {
  const [mood, setMood] = useState<Mood>("idle");
  const [isDragging, setIsDragging] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const smoothX = useSpring(x, { stiffness: 220, damping: 24, mass: 0.8 });
  const smoothY = useSpring(y, { stiffness: 220, damping: 24, mass: 0.8 });

  const lastInteractionRef = useRef(Date.now());
  const lastMouseMoveRef = useRef(0);
  const moodRef = useRef<Mood>("idle");
  const draggingRef = useRef(false);
  const followingRef = useRef(false);
  const pinnedRef = useRef(false);
  const temporaryMoodRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const pointerStateRef = useRef<{
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const mouseRef = useRef({ x: 0, y: 0, seen: false });
  const temporaryTimerRef = useRef<number | null>(null);
  const lastEmoteRef = useRef<Mood | null>(null);

  moodRef.current = mood;
  draggingRef.current = isDragging;
  followingRef.current = isFollowing;
  pinnedRef.current = isPinned;

  const moodAsset = useMemo(() => MOOD_ASSETS[mood], [mood]);
  const speech = MOOD_MESSAGES[mood] ?? null;

  const stopFollowing = useEffectEvent(() => {
    if (!followingRef.current) {
      return;
    }

    setIsFollowing(false);
  });

  const clearTemporaryMood = useEffectEvent(() => {
    temporaryMoodRef.current = false;

    if (temporaryTimerRef.current !== null) {
      window.clearTimeout(temporaryTimerRef.current);
      temporaryTimerRef.current = null;
    }
  });

  const settleMood = useEffectEvent((fallback: Mood = "idle") => {
    const inactiveFor = Date.now() - lastInteractionRef.current;

    if (draggingRef.current) {
      setMood("walking");
      return;
    }

    if (followingRef.current) {
      setMood("walking");
      return;
    }

    if (inactiveFor >= SLEEP_DELAY) {
      setMood("sleep");
      return;
    }

    if (inactiveFor >= DOZE_DELAY) {
      setMood("doze");
      return;
    }

    setMood(fallback);
  });

  const setTemporaryMood = useEffectEvent((nextMood: Mood, returnTo: Mood = "idle") => {
    clearTemporaryMood();
    temporaryMoodRef.current = true;
    setMood(nextMood);

    const duration = MOOD_DURATIONS[nextMood] ?? 1_000;
    temporaryTimerRef.current = window.setTimeout(() => {
      temporaryMoodRef.current = false;
      temporaryTimerRef.current = null;
      settleMood(returnTo);
    }, duration);
  });

  const markInteraction = useEffectEvent(() => {
    lastInteractionRef.current = Date.now();
  });

  const handlePoke = useEffectEvent(() => {
    if (draggingRef.current) {
      return;
    }

    markInteraction();
    stopFollowing();

    const candidates = CLICK_EMOTES.filter((candidate) => candidate !== lastEmoteRef.current);
    const pool = candidates.length > 0 ? candidates : CLICK_EMOTES;
    const nextMood = pool[Math.floor(Math.random() * pool.length)];
    lastEmoteRef.current = nextMood;

    const currentY = y.get();
    const bouncedY = clampToViewport(x.get(), currentY - 20).y;
    animate(y, [currentY, bouncedY, currentY], {
      duration: 0.4,
      ease: "easeOut",
    });

    setTemporaryMood(nextMood, "idle");
  });

  useEffect(() => {
    const next = clampToViewport(
      window.innerWidth - PET_FRAME - 40,
      window.innerHeight - PET_FRAME - 40
    );

    x.set(next.x);
    y.set(next.y);
    setIsReady(true);

    function handleResize() {
      const current = clampToViewport(x.get(), y.get());
      x.set(current.x);
      y.set(current.y);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [x, y]);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      mouseRef.current = {
        x: event.clientX,
        y: event.clientY,
        seen: true,
      };
      lastMouseMoveRef.current = Date.now();
    }

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (temporaryMoodRef.current || draggingRef.current || followingRef.current) {
        return;
      }

      const inactiveFor = Date.now() - lastInteractionRef.current;
      const currentMood = moodRef.current;

      if (inactiveFor >= SLEEP_DELAY) {
        if (currentMood !== "sleep") {
          setMood("sleep");
        }
        return;
      }

      if (inactiveFor >= DOZE_DELAY) {
        if (currentMood !== "doze") {
          setMood("doze");
        }
        return;
      }

      if (currentMood === "sleep" || currentMood === "doze") {
        setMood("idle");
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (draggingRef.current || temporaryMoodRef.current || !mouseRef.current.seen) {
        return;
      }

      if (pinnedRef.current) {
        return;
      }

      const inactiveFor = Date.now() - lastInteractionRef.current;

      if (
        !followingRef.current &&
        moodRef.current === "sleep" &&
        inactiveFor >= FOLLOW_START_DELAY &&
        lastMouseMoveRef.current >= lastInteractionRef.current
      ) {
        setMood("side-eye");
        setIsFollowing(true);
        return;
      }

      if (!followingRef.current) {
        return;
      }

      const targetX = mouseRef.current.x - PET_FRAME / 2;
      const targetY = mouseRef.current.y - PET_FRAME / 2;
      const deltaX = targetX - x.get();
      const deltaY = targetY - y.get();
      const distance = Math.hypot(deltaX, deltaY);

      if (distance <= FOLLOW_THRESHOLD) {
        setIsFollowing(false);
        markInteraction();
        setTemporaryMood("happy", "idle");
        return;
      }

      setMood("walking");
      const next = clampToViewport(
        x.get() + deltaX * FOLLOW_SPEED,
        y.get() + deltaY * FOLLOW_SPEED
      );
      x.set(next.x);
      y.set(next.y);
    }, 50);

    return () => window.clearInterval(interval);
  }, [markInteraction, setTemporaryMood, x, y]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (event.pointerId !== pointerIdRef.current || pointerStateRef.current === null) {
        return;
      }

      const pointerState = pointerStateRef.current;
      const movedFarEnough = Math.hypot(
        event.clientX - pointerState.startX,
        event.clientY - pointerState.startY
      ) > 6;

      if (movedFarEnough && !pointerState.moved) {
        pointerState.moved = true;
        setIsDragging(true);
        setMood("walking");
      }

      if (!pointerState.moved) {
        return;
      }

      const next = clampToViewport(
        event.clientX - pointerState.offsetX,
        event.clientY - pointerState.offsetY
      );
      x.set(next.x);
      y.set(next.y);
    }

    function finishPointer(event: PointerEvent) {
      if (event.pointerId !== pointerIdRef.current) {
        return;
      }

      const pointerState = pointerStateRef.current;
      pointerIdRef.current = null;
      pointerStateRef.current = null;

      if (pointerState?.moved) {
        setIsDragging(false);
        setIsPinned(true);
        markInteraction();
        setTemporaryMood("happy", "idle");
        return;
      }

      setIsDragging(false);
      handlePoke();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
    };
  }, [handlePoke, markInteraction, setTemporaryMood, x, y]);

  useEffect(() => {
    return () => {
      clearTemporaryMood();
    };
  }, [clearTemporaryMood]);

  if (!isReady) {
    return null;
  }

  return (
    <motion.div
      className="clawster-companion"
      style={{ x: smoothX, y: smoothY }}
      aria-hidden="true"
    >
      <motion.div
        className="clawster-speech"
        initial={false}
        animate={{
          opacity: speech ? 1 : 0,
          y: speech ? 0 : 10,
          scale: speech ? 1 : 0.92,
        }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {speech}
        <span className="clawster-speech-tail" />
      </motion.div>

      <div
        className="clawster-shell"
        onMouseEnter={() => {
          if (moodRef.current !== "idle" || draggingRef.current || followingRef.current || temporaryMoodRef.current) {
            return;
          }

          markInteraction();
          setTemporaryMood("peek", "idle");
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }

          clearTemporaryMood();
          stopFollowing();
          markInteraction();

          pointerIdRef.current = event.pointerId;
          pointerStateRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - x.get(),
            offsetY: event.clientY - y.get(),
            moved: false,
          };
        }}
      >
        <motion.div
          className="clawster-glow"
          animate={{
            opacity: mood === "sleep" ? 0.24 : 0.42,
            scale: mood === "proud" ? 1.35 : isDragging ? 1.28 : 1.22,
            backgroundColor: MOOD_COLORS[mood],
          }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />

        <motion.div
          className="clawster-shadow"
          animate={{
            scale: mood === "sleep" || mood === "doze" ? [1, 0.92, 1] : isDragging ? 0.88 : 1,
            opacity: isDragging ? 0.22 : 0.34,
          }}
          transition={{
            duration: mood === "sleep" || mood === "doze" ? 2 : 0.2,
            repeat: mood === "sleep" || mood === "doze" ? Number.POSITIVE_INFINITY : 0,
            ease: "easeInOut",
          }}
        />

        <motion.div
          className="clawster-body"
          animate={{
            rotate:
              mood === "spin"
                ? 360
                : mood === "peek"
                  ? 10
                  : isDragging
                    ? -6
                    : 0,
            y: mood === "sleep" || mood === "doze" ? [0, 4, 0] : 0,
            scale:
              mood === "proud"
                ? [1, 1.08, 1]
                : mood === "huff"
                  ? [1, 0.95, 1]
                  : isDragging
                    ? 1.04
                    : 1,
          }}
          transition={{
            rotate: { duration: mood === "spin" ? 0.55 : 0.2, ease: "easeInOut" },
            y: {
              duration: 2,
              repeat: mood === "sleep" || mood === "doze" ? Number.POSITIVE_INFINITY : 0,
              ease: "easeInOut",
            },
            scale: { duration: 0.35, ease: "easeInOut" },
          }}
        >
          <img className="clawster-image" src={moodAsset} alt="" draggable={false} />
        </motion.div>
      </div>
    </motion.div>
  );
}
