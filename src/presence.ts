import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

/** Someone else signed in to this organisation right now. tab is null when they are somewhere that is not shown. */
export type Present = { user_id: string; name: string; tab: string | null };

/**
 * Who else is here. Nothing is stored: it lasts only while browsers are open.
 * If the live connection is not available the list is simply empty.
 * Pass tab as null to be shown as online without saying where.
 */
export function usePresence(organisationId: string, userId: string, name: string, tab: string | null): Present[] {
  const [others, setOthers] = useState<Present[]>([]);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const mine = useRef({ name, tab });
  mine.current = { name, tab };

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let closed = false;
    const channel = client.channel(`org:${organisationId}`, { config: { private: true, presence: { key: userId } } });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<{ name: string; tab: string | null }>();
      const list: Present[] = [];
      for (const [id, entries] of Object.entries(state)) {
        if (id === userId) continue;
        // One person may have several windows open; show each tab once
        const seen = new Set<string>();
        for (const e of entries) {
          const key = String(e.tab);
          if (seen.has(key)) continue;
          seen.add(key);
          list.push({ user_id: id, name: String(e.name ?? "Someone").slice(0, 80), tab: typeof e.tab === "string" ? e.tab : null });
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
    if (channelRef.current) void channelRef.current.track({ name, tab });
  }, [name, tab]);

  return others;
}

/** "Sarah", "Sarah and Andre", "Sarah, Andre and Kim" */
export function nameList(names: string[]) {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}
