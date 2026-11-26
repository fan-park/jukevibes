// Types and constants shared by the server and the browser.

export const GENRES = [
  "amapiano",
  "gqom",
  "afrobeats",
  "hip hop",
  "r&b",
  "pop",
  "house",
  "deep house",
  "kwaito",
  "gospel",
  "soul",
  "rock",
  "dance",
  "reggae",
  "jazz",
  "bollywood",
] as const;

export type QueueItem = {
  id: string;
  track_id: string;
  name: string;
  artists: string;
  image: string | null;
  duration_ms: number | null;
  requested_by: string | null;
  source: "guest" | "genre";
  score: number;
  ups: number;
  downs: number;
  my_vote: -1 | 0 | 1;
  mine: boolean;
};

export type RoomState = {
  room: {
    code: string;
    name: string;
    mode: "car" | "party";
    host_display_name: string | null;
    voting_open: boolean;
    skip_ratio: number;
    max_pending_per_guest: number;
    ended: boolean;
  };
  me: { id: string; nickname: string; is_host: boolean; genre_vote: string | null; pending: number };
  now_playing: {
    id: string;
    name: string;
    artists: string;
    image: string | null;
    duration_ms: number;
    progress_ms: number;
    is_playing: boolean;
    fetched_at: string;
  } | null;
  up_next: { id: string; name: string; artists: string; image: string | null; requested_by: string | null } | null;
  queue: QueueItem[];
  skip: { votes: number; needed: number; mine: boolean };
  genres: { genre: string; votes: number }[];
  guests: { id: string; nickname: string; is_host: boolean }[];
};
