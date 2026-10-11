import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

/** Someone else signed in to this organisation right now. tab is null when they are somewhere that is not shown. */
export type Present = { user_id: string; name: string; tab: string | null; idle: boolean };

/** No mouse, keyboard, touch or scrolling for this long counts as inactive */
export const IDLE_AFTER_MS = 15 * 60 * 1000;

/**
 * Who else is here. Nothing is stored: it lasts only while browsers are open.
 * If the live connection is not available the list is simply empty.
 * Pass tab as null to be shown as online without saying where.
 */
export function usePresence(organisationId: string, userId: string, name: string, tab: string | null): Present[] {
  const [others, setOthers] = useState<Present[]>([]);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const [idle, setIdle] = useState(false);
  const mine = useRef({ name, tab, idle });
  mine.current = { name, tab, idle };

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let closed = false;
    const channel = client.channel(`org:${organisationId}`, { config: { private: true, presence: { key: userId } } });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<{ name: string; tab: string | null; idle?: boolean }>();
      const list: Present[] = [];
      for (const [id, entries] of Object.entries(state)) {
        if (id === userId) continue;
        // One person may have several windows open; show each tab once
        const seen = new Set<string>();
        for (const e of entries) {
          const key = String(e.tab);
          if (seen.has(key)) continue;
          seen.add(key);
          list.push({ user_id: id, name: String(e.name ?? "Someone").slice(0, 80), tab: typeof e.tab === "string" ? e.tab : null, idle: e.idle === true });
        }
      }
      if (!closed) setOthers(list);
    });
    void client.realtime
      .setAuth()
      .catch(() => undefined)
      .then(() => {
        if (closed) return;
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            channelRef.current = channel;
            void channel.track(mine.current);
          }
        });
      });
    return () => {
      closed = true;
      channelRef.current = null;
      void client.removeChannel(channel);
    };
  }, [organisationId, userId]);

  useEffect(() => {
    if (channelRef.current) void channelRef.current.track({ name, tab, idle });
  }, [name, tab, idle]);

  // Inactive after 15 minutes without mouse, keyboard, touch or scrolling in this window; active again on the next one
  useEffect(() => {
    let last = Date.now();
    const check = () => setIdle(Date.now() - last >= IDLE_AFTER_MS);
    const active = () => {
      last = Date.now();
      setIdle(false);
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, active, { passive: true });
    window.addEventListener("scroll", active, { passive: true, capture: true });
    const timer = window.setInterval(check, 30_000);
    return () => {
      for (const e of events) window.removeEventListener(e, active);
      window.removeEventListener("scroll", active, { capture: true });
      window.clearInterval(timer);
    };
  }, []);

  return others;
}

/** Each person once, marked inactive only if every window they have open (in this group) is inactive */
export function people(list: Present[]) {
  const byId = new Map<string, { name: string; idle: boolean }>();
  for (const o of list) {
    const was = byId.get(o.user_id);
    byId.set(o.user_id, { name: o.name, idle: was ? was.idle && o.idle : o.idle });
  }
  return [...byId.values()];
}
export const labelled = (list: Present[]) => nameList(people(list).map((p) => (p.idle ? `${p.name} (inactive)` : p.name)));

/** "Sarah", "Sarah and Andre", "Sarah, Andre and Kim" */
export function nameList(names: string[]) {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}
