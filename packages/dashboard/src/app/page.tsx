"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Orb, type OrbState } from "@/components/Orb";
import { JarvisInput } from "@/components/JarvisInput";

/** Time-of-day greeting in the user's timezone (Asia/Bangkok). */
function greetingNow(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Bangkok",
    }).format(new Date()),
  );
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const router = useRouter();
  // Greeting depends on the clock — set after mount to keep the static
  // prerender hydration-safe.
  const [greeting, setGreeting] = useState<string | null>(null);
  const [orbState, setOrbState] = useState<OrbState>("idle");

  useEffect(() => {
    setGreeting(greetingNow());
  }, []);

  function handleAsk(text: string) {
    setOrbState("thinking");
    sessionStorage.setItem("jarvis.pending", text);
    router.push("/chat");
  }

  return (
    <div className="jarvis-home">
      <div className="jarvis-stage">
        <Orb state={orbState} />

        <motion.div
          className="jarvis-greeting"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 70, damping: 18, delay: 0.15 }}
        >
          <h1 className={greeting ? "" : "pending"}>
            {greeting ?? "Hello"}, Fran.
          </h1>
          <p>How can I help you today?</p>
        </motion.div>
      </div>

      <motion.div
        className="jarvis-input-dock"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 70, damping: 18, delay: 0.3 }}
      >
        <JarvisInput
          onSubmit={handleAsk}
          onFocusChange={(focused) =>
            setOrbState((s) =>
              s === "thinking" ? s : focused ? "listening" : "idle",
            )
          }
        />
      </motion.div>
    </div>
  );
}
