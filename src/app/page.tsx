import JoinForm from "@/components/JoinForm";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="wrap">
      <div className="brand">
        <img src="/icon.svg" alt="" />
        Jukevibe
      </div>

      <h1>
        The room picks
        <br />
        <em>the music.</em>
      </h1>
      <p className="lead">
        Friends in the car or at the party request songs and vote on what plays next on your Spotify. No app or
        account needed for them.
      </p>

      {error && <p className="error card">{error}</p>}

      <section className="card stack">
        <div className="title">Join a session</div>
        <JoinForm />
      </section>

      <div className="divider">or</div>

      <section className="card stack">
        <div className="title">Host with your Spotify</div>
        <p className="sub" style={{ whiteSpace: "normal" }}>
          Needs Spotify Premium, with Spotify open and playing on your phone.
        </p>
        <div className="row">
          <a className="btn primary grow" href="/api/auth/login?mode=car">
            🚗 Car
          </a>
          <a className="btn primary grow" href="/api/auth/login?mode=party">
            🎉 Party
          </a>
        </div>
      </section>

      <h2>How it works</h2>
      <ol className="steps">
        <li>The host connects Spotify and gets a code and QR.</li>
        <li>Everyone scans it and picks a name.</li>
        <li>Request songs, vote them up or down, and vote to skip.</li>
        <li>Near the end of each song, the top-voted request gets queued.</li>
      </ol>
    </main>
  );
}
