import { useCallback, useEffect, useRef, useState } from "react";
import { useData } from "./DataContext";

/**
 * Load one ring and keep it current.
 *
 * state: idle | loading | ok | notfound | error
 * On "notfound" the last ring that did load stays in `ring` with `stale: true`, so the analyst keeps the picture they were
 * working with while the page explains that the id changed. It reloads whenever the server publishes a new state.
 */
export function useRing(ringId, nonce = 0) {
  const { getRing, dataVersion } = useData();
  const [s, setS] = useState({ state: "idle", ring: null, stale: false, message: "" });
  const lastGood = useRef({ id: null, ring: null });

  useEffect(() => {
    if (!ringId) {
      lastGood.current = { id: null, ring: null };
      setS({ state: "idle", ring: null, stale: false, message: "" });
      return undefined;
    }
    let cancelled = false;
    if (lastGood.current.id !== ringId) setS((p) => ({ state: "loading", ring: null, stale: false, message: "", prev: p.ring }));
    getRing(ringId).then((res) => {
      if (cancelled) return;
      if (res.status === "ok") {
        lastGood.current = { id: ringId, ring: res.data };
        setS({ state: "ok", ring: res.data, stale: false, message: "" });
      } else {
        const keep = lastGood.current.id === ringId ? lastGood.current.ring : null;
        setS({ state: res.status === "notfound" ? "notfound" : "error", ring: keep, stale: Boolean(keep), message: res.message || "" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ringId, getRing, dataVersion, nonce]);

  return s;
}

/** Load one account record: { state: loading | ok | notfound | error, account }. */
export function useAccountRecord(accountId) {
  const { getAccount, dataVersion } = useData();
  const [s, setS] = useState({ state: accountId ? "loading" : "idle", account: null, message: "" });

  useEffect(() => {
    if (!accountId) {
      setS({ state: "idle", account: null, message: "" });
      return undefined;
    }
    let cancelled = false;
    setS((p) => (p.account?.account_id === accountId ? p : { state: "loading", account: null, message: "" }));
    getAccount(accountId).then((res) => {
      if (cancelled) return;
      if (res.status === "ok") setS({ state: "ok", account: res.data, message: "" });
      else setS({ state: res.status === "notfound" ? "notfound" : "error", account: null, message: res.message || "" });
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, getAccount, dataVersion]);

  return s;
}

/**
 * After a ring id disappears: look up a few of its old members to see which current rings they belong to.
 * Only real answers from GET /accounts/{id} are used. Resolves to [{ ring_id, members: [ids] }].
 */
export function useSuccessors(staleRing, active) {
  const { getAccount, rings } = useData();
  const [found, setFound] = useState({ loading: false, rings: [] });
  const key = active && staleRing ? staleRing.ring_id : null;

  const lookup = useCallback(async () => {
    if (!staleRing) return;
    setFound({ loading: true, rings: [] });
    const probe = [...(staleRing.members || [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 6);
    const answers = await Promise.all(probe.map((m) => getAccount(m.id).then((r) => ({ id: m.id, r }))));
    const byRing = new Map();
    for (const { id, r } of answers) {
      if (r.status === "ok" && r.data.ring_id) {
        const cur = byRing.get(r.data.ring_id) || [];
        cur.push(id);
        byRing.set(r.data.ring_id, cur);
      }
    }
    setFound({ loading: false, rings: [...byRing].map(([ring_id, members]) => ({ ring_id, members })).sort((a, b) => b.members.length - a.members.length) });
  }, [staleRing, getAccount]);

  useEffect(() => {
    if (key) lookup();
    else setFound({ loading: false, rings: [] });
    // the list changing is what triggers a re-check: a refreshed /rings may now contain the successor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rings.length]);

  return found;
}

/**
 * The highest-scored accounts among the members of the top flagged rings the API returned. Built only from real
 * GET /rings/{id} answers; a ring that fails to load is skipped and counted, never replaced.
 * Resolves to { phase: loading | ready | empty | error, accounts: [{ id, role, score, ring_id, ring_score }], failed }.
 */
export function useTopAccounts(ringCount = 5, limit = 20) {
  const { rings, getRing, loaded, mode, dataVersion } = useData();
  const [state, setState] = useState({ phase: "loading", accounts: [], failed: 0 });
  const top = [...rings].sort((a, b) => b.risk - a.risk).slice(0, ringCount);
  const key = top.map((r) => r.ring_id).join(",") + "|" + dataVersion;

  useEffect(() => {
    if (!loaded) {
      setState({ phase: mode === "unreachable" ? "error" : "loading", accounts: [], failed: 0 });
      return undefined;
    }
    if (top.length === 0) {
      setState({ phase: "empty", accounts: [], failed: 0 });
      return undefined;
    }
    let cancelled = false;
    Promise.all(top.map((r) => getRing(r.ring_id))).then((results) => {
      if (cancelled) return;
      const accounts = [];
      let failed = 0;
      results.forEach((res, i) => {
        if (res.status !== "ok") {
          failed += 1;
          return;
        }
        for (const m of res.data.members || []) accounts.push({ id: m.id, role: m.role, score: m.score, ring_id: top[i].ring_id, ring_score: top[i].risk });
      });
      accounts.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
      setState({ phase: accounts.length ? "ready" : failed ? "error" : "empty", accounts: accounts.slice(0, limit), failed });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loaded]);

  return state;
}
