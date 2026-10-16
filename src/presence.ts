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
    let channel: ReturnType<typeof client.channel> | null = null;
    let retry: number | undefined;
    let attempts = 0;
    let connecting = false;

    const onSync = (ch: ReturnType<typeof client.channel>) => () => {
      const state = ch.presenceState<{ name: string; tab: string | null; idle?: boolean }>();
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
      if (!closed && ch === channel) setOthers(list);
    };

    // Start (or restart) the live channel. A dropped connection, a timeout or an expired sign-in
    // token used to end presence for good; now it reconnects, waiting a little longer each time.
    const connect = async () => {
      if (closed || connecting) return;
      connecting = true;
      window.clearTimeout(retry);
      if (channel) {
        const old = channel;
        channel = null;
        channelRef.current = null;
        await client.removeChannel(old).catch(() => undefined);
      }
      await client.realtime.setAuth().catch(() => undefined);
      connecting = false;
      if (closed) return;
      const ch = client.channel(`org:${organisationId}`, { config: { private: true, presence: { key: userId } } });
      channel = ch;
      ch.on("presence", { event: "sync" }, onSync(ch));
      ch.subscribe((status) => {
        if (closed || ch !== channel) return;
        if (status === "SUBSCRIBED") {
          // The library may rejoin by itself before our retry fires; then the retry is not needed
          window.clearTimeout(retry);
          attempts = 0;
          channelRef.current = ch;
          void ch.track(mine.current);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          // While disconnected we do not know who is here, so show nobody rather than an old list
          channelRef.current = null;
          setOthers([]);
          attempts += 1;
          retry = window.setTimeout(() => void connect(), Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6)));
        }
      });
    };

    // Coming back to the tab, or back online: make sure we are connected and shown
    const wake = () => {
      if (closed || document.visibilityState === "hidden") return;
      const state = channel?.state;
      if (channelRef.current && state === "joined") void channelRef.current.track(mine.current);
      else if (!channel || state === "closed" || state === "errored") void connect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);

    void connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      channelRef.current = null;
      if (channel) void client.removeChannel(channel);
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
