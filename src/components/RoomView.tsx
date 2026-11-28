"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GENRES, type QueueItem, type RoomState } from "@/lib/shared";

type Invite = { joinUrl: string; qrSvg: string; displayUrl: string };
type Track = { id: string; name: string; artists: string; image: string | null; duration_ms: number };
type Status = "loading" | "join" | "ready" | "notfound" | "offline";

const POLL_MS = 3000;

async function api<T = { ok: boolean }>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error || "Something went wrong") as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Art({ src, big }: { src: string | null; big?: boolean }) {
  return src ? (
    <img className={`art${big ? " big" : ""}`} src={src} alt="" />
  ) : (
    <div className={`art${big ? " big" : ""}`} />
  );
}

export default function RoomView({ code, invite }: { code: string; invite?: Invite }) {
  const base = `/api/rooms/${encodeURIComponent(code)}`;
  const [status, setStatus] = useState<Status>("loading");
  const [state, setState] = useState<RoomState | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api<RoomState>(`${base}/state`);
      setState(data);
      setReceivedAt(Date.now());
      setStatus("ready");
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) setStatus("join");
      else if (status === 404) setStatus("notfound");
      else setStatus((s) => (s === "ready" ? s : "offline"));
    }
  }, [base]);

  useEffect(() => {
    refresh();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const act = useCallback(
    async (path: string, body: unknown, success?: string) => {
      try {
        await api(`${base}/${path}`, { method: "POST", body: JSON.stringify(body) });
        if (success) flash(success);
        await refresh();
      } catch (e) {
        flash((e as Error).message);
      }
    },
    [base, flash, refresh],
  );

  if (status === "loading") {
    return (
      <main className="wrap">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (status === "notfound") {
    return (
      <main className="wrap stack">
        <h1>No session called {code}</h1>
        <p className="lead">Check the code with the host, or scan their QR code again.</p>
        <a className="btn" href="/">
          Back
        </a>
      </main>
    );
  }
  if (status === "join") return <JoinRoom code={code} base={base} onJoined={refresh} />;
  if (status === "offline" || !state) {
    return (
      <main className="wrap stack">
        <p className="muted">Can&apos;t reach Jukevibe right now. Retrying…</p>
      </main>
    );
  }

  const { room, me, now_playing: np } = state;
  const progress = np ? Math.min(np.duration_ms, np.progress_ms + (np.is_playing ? now - receivedAt : 0)) : 0;

  if (room.ended) {
    return (
      <main className="wrap stack">
        <h1>That&apos;s a wrap</h1>
        <p className="lead">{room.name} has ended. Thanks for the vibes.</p>
        <a className="btn primary" href="/">
          Start or join another
        </a>
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="row">
        <div className="brand grow">
          <img src="/icon.svg" alt="" />
          <span className="title">{room.name}</span>
        </div>
        <span className="pill">{room.code}</span>
      </div>

      {me.is_host && invite && (
        <section className="card stack" style={{ marginTop: 16 }}>
          <div className="row">
            <div className="qr" dangerouslySetInnerHTML={{ __html: invite.qrSvg }} />
            <div className="grow">
              <div className="muted small">Scan to join, or enter</div>
              <div className="big-code">{room.code}</div>
              <div className="sub small">{invite.displayUrl}</div>
            </div>
          </div>
          <ShareButtons code={room.code} roomName={room.name} flash={flash} />
        </section>
      )}

      <h2>Now playing</h2>
      {np ? (
        <section className="card">
          <div className="row">
            <Art src={np.image} big />
            <div className="grow">
              <div className="title">{np.name}</div>
              <div className="sub">{np.artists}</div>
              {!np.is_playing && <span className="pill">Paused</span>}
            </div>
          </div>
          <div className="progress">
            <div style={{ width: `${np.duration_ms ? (progress / np.duration_ms) * 100 : 0}%` }} />
          </div>
          <div className="row small muted" style={{ marginTop: 6 }}>
            <span className="grow">{fmt(progress)}</span>
            <span>{fmt(np.duration_ms)}</span>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className={`btn small grow${state.skip.mine ? " danger" : ""}`}
              onClick={() => act("skip", {}, state.skip.mine ? "Skip vote removed" : undefined)}
            >
              👎 {state.skip.mine ? "Voted to skip" : "Vote to skip"} ({state.skip.votes}/{state.skip.needed})
            </button>
            {me.is_host && (
              <button className="btn small" onClick={() => act("host", { action: "skip" }, "Skipped")}>
                ⏭ Skip now
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="card muted">
          {me.is_host
            ? "Nothing playing. Open Spotify on your phone and press play. Jukevibe takes it from there."
            : "Nothing playing yet. Waiting for the host to press play."}
        </section>
      )}

      {state.up_next && (
        <>
          <h2>Up next · locked in</h2>
          <section className="card row">
            <Art src={state.up_next.image} />
            <div className="grow">
              <div className="title">{state.up_next.name}</div>
              <div className="sub">
                {state.up_next.artists}
                {state.up_next.requested_by ? ` · ${state.up_next.requested_by}` : " · genre pick"}
              </div>
            </div>
          </section>
        </>
      )}

      <h2>Request a song</h2>
      <Search
        base={base}
        disabled={!room.voting_open && !me.is_host}
        remaining={me.is_host ? null : room.max_pending_per_guest - me.pending}
        onRequest={(t) => act("requests", { trackId: t.id }, `Requested ${t.name}`)}
      />

      <h2>Vote on what&apos;s next</h2>
      <section className="card">
        {state.queue.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No requests yet. Search above to add one{state.genres.length ? ", or the top genre picks." : "."}
          </p>
        ) : (
          <ul className="list">
            {state.queue.map((q, i) => (
              <QueueRow
                key={q.id}
                item={q}
                first={i === 0}
                isHost={me.is_host}
                onVote={(value) => act("vote", { requestId: q.id, value })}
                onRemove={() => act("host", { action: "remove", requestId: q.id }, "Removed")}
              />
            ))}
          </ul>
        )}
      </section>

      <h2>Vibe check · pick a genre</h2>
      <p className="muted small" style={{ marginTop: -4 }}>
        Kicks in when the current song ends: if there are no requests, the top genre picks the next song.
      </p>
      <div className="chips">
        {GENRES.map((g) => {
          const votes = state.genres.find((x) => x.genre === g)?.votes ?? 0;
          const on = me.genre_vote === g;
          return (
            <button key={g} className={`chip${on ? " on" : ""}`} onClick={() => act("genre", { genre: on ? null : g })}>
              {g}
              {votes > 0 && <b>{votes}</b>}
            </button>
          );
        })}
      </div>

      <h2>In the {room.mode === "car" ? "car" : "room"} · {state.guests.length}</h2>
      <div className="chips">
        {state.guests.map((g) => (
          <span key={g.id} className="chip">
            {g.is_host ? "🎧 " : ""}
            {g.nickname}
            {g.id === me.id ? " (you)" : ""}
          </span>
        ))}
      </div>

      {!me.is_host && (
        <>
          <h2>Invite friends</h2>
          <ShareButtons code={room.code} roomName={room.name} flash={flash} />
        </>
      )}

      {me.is_host && <HostSettings state={state} act={act} />}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function ShareButtons({ code, roomName, flash }: { code: string; roomName: string; flash: (msg: string) => void }) {
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && "share" in navigator), []);

  const link = () => `${window.location.origin}/r/${code}`;
  const message = () => `Join ${roomName} on Jukevibe and vote on what plays next 🎶 ${link()}`;

  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
      <a
        className="btn small whatsapp grow"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          window.open(`https://wa.me/?text=${encodeURIComponent(message())}`, "_blank", "noopener");
        }}
      >
        WhatsApp
      </a>
      {canShare && (
        <button
          className="btn small grow"
          onClick={() =>
            navigator.share({ title: "Jukevibe", text: `Join ${roomName} on Jukevibe 🎶`, url: link() }).catch(() => {})
          }
        >
          Share…
        </button>
      )}
      <button
        className="btn small grow"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link());
            flash("Link copied");
          } catch {
            flash(link());
          }
        }}
      >
        Copy link
      </button>
    </div>
  );
}

function QueueRow({
  item,
  first,
  isHost,
  onVote,
  onRemove,
}: {
  item: QueueItem;
  first: boolean;
  isHost: boolean;
  onVote: (value: -1 | 0 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <li>
      <Art src={item.image} />
      <div className="grow">
        <div className="title">{item.name}</div>
        <div className="sub">{item.artists}</div>
        <div className="row small" style={{ gap: 6, marginTop: 4 }}>
          {first && <span className="pill hot">Leading</span>}
          <span className="muted">
            {item.source === "genre" ? "Genre pick" : item.mine ? "Your request" : `by ${item.requested_by}`}
          </span>
          {isHost && (
            <button className="btn small danger" style={{ padding: "2px 10px" }} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      </div>
      <div className="votes">
        <button
          className={`vote up${item.my_vote === 1 ? " on" : ""}`}
          aria-label="Vote up"
          onClick={() => onVote(item.my_vote === 1 ? 0 : 1)}
        >
          ▲
        </button>
        <span className="score">{item.score}</span>
        <button
          className={`vote down${item.my_vote === -1 ? " on" : ""}`}
          aria-label="Vote down"
          onClick={() => onVote(item.my_vote === -1 ? 0 : -1)}
        >
          ▼
        </button>
      </div>
    </li>
  );
}

function Search({
  base,
  disabled,
  remaining,
  onRequest,
}: {
  base: string;
  disabled: boolean;
  remaining: number | null;
  onRequest: (t: Track) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setBusy(true);
      try {
        const { tracks } = await api<{ tracks: Track[] }>(`${base}/search?q=${encodeURIComponent(query)}`);
        setResults(tracks);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [q, base]);

  if (disabled) return <section className="card muted">The host has paused requests for now.</section>;

  return (
    <section className="card stack">
      <input
        className="input"
        placeholder="Search songs or artists"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        enterKeyHint="search"
      />
      {remaining !== null && (
        <div className="muted small">
          {remaining > 0
            ? `You can have ${remaining} more request${remaining === 1 ? "" : "s"} waiting.`
            : "Your requests are full. Wait for one to play."}
        </div>
      )}
      {busy && <div className="muted small">Searching…</div>}
      {error && <p className="error">{error}</p>}
      {results.length > 0 && (
        <ul className="list">
          {results.map((t) => (
            <li key={t.id}>
              <Art src={t.image} />
              <div className="grow">
                <div className="title">{t.name}</div>
                <div className="sub">
                  {t.artists} · {fmt(t.duration_ms)}
                </div>
              </div>
              <button
                className="btn small primary"
                disabled={remaining !== null && remaining <= 0}
                onClick={async () => {
                  await onRequest(t);
                  setQ("");
                  setResults([]);
                }}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HostSettings({
  state,
  act,
}: {
  state: RoomState;
  act: (path: string, body: unknown, success?: string) => Promise<void>;
}) {
  const { room } = state;
  const set = (patch: Record<string, unknown>) => act("host", { action: "settings", ...patch }, "Saved");
  return (
    <>
      <h2>Host controls</h2>
      <section className="card settings">
        <label>
          <span>Requests &amp; voting</span>
          <button className="btn small" onClick={() => set({ voting_open: !room.voting_open })}>
            {room.voting_open ? "On · pause" : "Paused · resume"}
          </button>
        </label>
        <label>
          <span>Mode</span>
          <select value={room.mode} onChange={(e) => set({ mode: e.target.value })}>
            <option value="car">Car</option>
            <option value="party">Party</option>
          </select>
        </label>
        <label>
          <span>Skip when</span>
          <select value={String(room.skip_ratio)} onChange={(e) => set({ skip_ratio: Number(e.target.value) })}>
            <option value="0.34">a third vote skip</option>
            <option value="0.5">half vote skip</option>
            <option value="0.6">60% vote skip</option>
            <option value="0.75">three quarters vote skip</option>
            <option value="1">everyone votes skip</option>
          </select>
        </label>
        <label>
          <span>Requests waiting per person</span>
          <select
            value={String(room.max_pending_per_guest)}
            onChange={(e) => set({ max_pending_per_guest: Number(e.target.value) })}
          >
            {[1, 2, 3, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn block danger"
          style={{ marginTop: 12 }}
          onClick={() => {
            if (confirm("End this session for everyone?")) act("host", { action: "end" });
          }}
        >
          End session
        </button>
      </section>
      <p className="muted small">
        Keep Spotify playing on your phone. Jukevibe adds the winning song to your Spotify queue about 25 seconds before
        each song ends, as long as someone has this page open.
      </p>
    </>
  );
}

function JoinRoom({ code, base, onJoined }: { code: string; base: string; onJoined: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="wrap">
      <div className="brand">
        <img src="/icon.svg" alt="" />
        Jukevibe
      </div>
      <h1>
        Join <em>{code}</em>
      </h1>
      <p className="lead">Pick a name so everyone knows who requested the bangers (and the duds).</p>
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api(`${base}/join`, { method: "POST", body: JSON.stringify({ nickname: name }) });
            await onJoined();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          className="input"
          placeholder="Your name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button className="btn primary block" disabled={busy || !name.trim()}>
          Let&apos;s go
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
