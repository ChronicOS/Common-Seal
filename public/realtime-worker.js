// Keeps the live connection's heartbeat going while the tab is in the background.
// Browsers slow down timers in background tabs, which made Supabase Realtime drop
// the connection (and with it "who's online"). Timers in a worker are not slowed as much.
let timer = null;
self.onmessage = (event) => {
  if (event.data && event.data.event === "start") {
    if (timer) clearInterval(timer);
    timer = setInterval(() => self.postMessage({ event: "keepAlive" }), event.data.interval);
  }
};
