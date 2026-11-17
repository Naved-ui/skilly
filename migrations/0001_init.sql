CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 80),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  major TEXT NOT NULL DEFAULT '' CHECK(length(major) <= 100),
  bio TEXT NOT NULL DEFAULT '' CHECK(length(bio) <= 400),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_teach TEXT NOT NULL CHECK(length(can_teach) BETWEEN 2 AND 100),
  wants_to_learn TEXT NOT NULL CHECK(length(wants_to_learn) BETWEEN 2 AND 100),
  category TEXT NOT NULL CHECK(category IN ('Creative', 'Tech', 'Study', 'Life')),
  availability TEXT NOT NULL DEFAULT '' CHECK(length(availability) <= 100),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE swap_requests (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  wants_to_learn TEXT NOT NULL CHECK(length(wants_to_learn) BETWEEN 2 AND 100),
  can_offer TEXT NOT NULL CHECK(length(can_offer) BETWEEN 2 AND 100),
  message TEXT NOT NULL DEFAULT '' CHECK(length(message) <= 600),
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK(from_user_id != to_user_id)
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX skills_owner_id_idx ON skills(owner_id);
CREATE INDEX skills_category_idx ON skills(category);
CREATE INDEX swaps_to_user_status_idx ON swap_requests(to_user_id, status, created_at);
CREATE INDEX swaps_from_user_created_idx ON swap_requests(from_user_id, created_at);
