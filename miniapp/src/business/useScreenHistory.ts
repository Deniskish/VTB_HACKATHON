import { useEffect, useRef } from "react";

/** Browser Back restores the same screen snapshot, without putting business data in the URL. */
export function useScreenHistory<T>(
  snapshot: T,
  restore: (snapshot: T) => void,
) {
  const latest = useRef({ restore });
  latest.current = { restore };
  const applying = useRef(false);
  const previous = useRef("");
  const serialized = JSON.stringify(snapshot);
  const session = useRef(crypto.randomUUID());
  useEffect(() => {
    if (serialized === previous.current) return;
    const initial = !previous.current;
    previous.current = serialized;
    if (applying.current) {
      applying.current = false;
      return;
    }
    const state = {
      oporaScreen: JSON.parse(serialized),
      oporaSession: session.current,
    };
    if (initial) history.replaceState(state, "");
    else history.pushState(state, "");
  }, [serialized]);
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      if (
        event.state?.oporaSession !== session.current ||
        !event.state?.oporaScreen
      )
        return;
      applying.current = true;
      latest.current.restore(event.state.oporaScreen);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
}
