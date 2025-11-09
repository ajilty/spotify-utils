import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "https://esm.sh/react@18?dev";
import { createRoot } from "https://esm.sh/react-dom@18/client?dev";
import { createPortal } from "https://esm.sh/react-dom@18?dev";

const SETTINGS_KEY = "su_playlist_cleaner_settings";
const TOKEN_KEY = "su_playlist_cleaner_token";
const PKCE_KEY = "su_playlist_cleaner_pkce";
const REQUIRED_SCOPES = ["playlist-modify-public", "playlist-modify-private"];

function useSessionStorage(key, initialValue = null) {
  const readValue = () => {
    try {
      const stored = sessionStorage.getItem(key);
      if (!stored) return initialValue;
      return JSON.parse(stored);
    } catch (error) {
      console.warn(`Unable to read sessionStorage key "${key}"`, error);
      return initialValue;
    }
  };

  const [value, setState] = useState(readValue);

  const setValue = useCallback(
    (nextValue) => {
      setState((prev) => {
        const resolved = typeof nextValue === "function" ? nextValue(prev) : nextValue;
        if (resolved === null || resolved === undefined) {
          sessionStorage.removeItem(key);
          return null;
        }
        sessionStorage.setItem(key, JSON.stringify(resolved));
        return resolved;
      });
    },
    [key]
  );

  return [value, setValue];
}

function useToasts() {
  const [toasts, setToasts] = useState([]);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((message) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => dismissToast(id), 3200);
  }, [dismissToast]);

  return { toasts, pushToast, dismissToast };
}

function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;

  return createPortal(
    React.createElement(
      "div",
      { className: "toast-stack", role: "region", "aria-live": "polite" },
      toasts.map((toast) =>
        React.createElement(
          "div",
          {
            key: toast.id,
            className: "toast",
            role: "alert",
            onClick: () => onDismiss(toast.id),
          },
          toast.message
        )
      )
    ),
    document.body
  );
}

function ensureTrailingSlash(value) {
  try {
    const url = new URL(value);
    if (!url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  } catch {
    return value.endsWith("/") ? value : `${value}/`;
  }
}

function parsePlaylistId(value) {
  if (!value) return null;
  const urlMatch = value.match(/playlist\/(\w+)/i);
  if (urlMatch) return urlMatch[1];
  const uriMatch = value.match(/spotify:playlist:(\w+)/i);
  if (uriMatch) return uriMatch[1];
  const clean = value.replace(/[^a-zA-Z0-9]/g, "");
  return clean.length ? clean : null;
}

function hasRequiredScopes(scopeString = "") {
  const scopes = new Set(scopeString.split(" ").filter(Boolean));
  return REQUIRED_SCOPES.every((scope) => scopes.has(scope));
}

function getPkce() {
  try {
    const raw = sessionStorage.getItem(PKCE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearQueryParams() {
  const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

function base64UrlEncode(buffer) {
  let binary = "";
  buffer.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateCodeVerifier() {
  const array = new Uint8Array(96);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(codeVerifier) {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

async function beginAuthorizationFlow(settings) {
  const state = crypto.randomUUID();
  const codeVerifier = await generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  sessionStorage.setItem(
    PKCE_KEY,
    JSON.stringify({ state, codeVerifier, timestamp: Date.now(), redirectUri: settings.redirectUri })
  );

  const params = new URLSearchParams({
    client_id: settings.clientId,
    response_type: "code",
    redirect_uri: settings.redirectUri,
    scope: REQUIRED_SCOPES.join(" "),
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    state,
  });

  window.location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

async function exchangeCodeForToken(code, pkce, settings) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: settings.redirectUri,
      client_id: settings.clientId,
      code_verifier: pkce.codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error("Token exchange failed. Verify your Redirect URI in the Spotify Dashboard.");
  }

  const tokenResponse = await response.json();
  return normaliseTokenResponse(tokenResponse);
}

function normaliseTokenResponse(response) {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    scope: response.scope ?? "",
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
  };
}

async function safeParseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchProfile(accessToken) {
  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("Unable to load profile");
  }

  return response.json();
}

async function fetchUserPlaylists(accessToken) {
  const playlists = [];
  let nextUrl = "https://api.spotify.com/v1/me/playlists?limit=50";

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 401) {
      const error = new Error("Authorization expired");
      error.status = 401;
      throw error;
    }

    if (!response.ok) {
      const detail = await safeParseJson(response);
      const message = detail?.error?.message || "Unable to load playlists";
      throw new Error(message);
    }

    const data = await response.json();
    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        playlists.push({
          id: item.id,
          name: item.name || "Untitled playlist",
          trackCount: item.tracks?.total ?? 0,
          ownerName: item.owner?.display_name || item.owner?.id || "Unknown",
        });
      }
    }

    nextUrl = data.next || null;
  }

  return playlists;
}

async function fetchPlaylistSummary(accessToken, playlistId) {
  const response = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks.total`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (response.status === 401) {
    const error = new Error("Authorization expired");
    error.status = 401;
    throw error;
  }

  if (!response.ok) {
    const detail = await safeParseJson(response);
    const message = detail?.error?.message || "Unable to load playlist details";
    throw new Error(message);
  }

  return response.json();
}

function useEnsureAccessToken(settings, token, setToken) {
  return useCallback(async () => {
    if (!token) return null;

    if (token.expiresAt && Date.now() < token.expiresAt - 60 * 1000) {
      return token;
    }

    if (!token.refreshToken) {
      setToken(null);
      return null;
    }

    if (!settings?.clientId) {
      return null;
    }

    try {
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token.refreshToken,
          client_id: settings.clientId,
        }),
      });

      if (!response.ok) {
        throw new Error("Refresh failed");
      }

      const refreshed = await response.json();
      const merged = {
        ...token,
        accessToken: refreshed.access_token,
        expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
        refreshToken: refreshed.refresh_token ?? token.refreshToken,
        scope: refreshed.scope ?? token.scope,
      };
      setToken(merged);
      return merged;
    } catch (error) {
      console.error(error);
      setToken(null);
      return null;
    }
  }, [settings, setToken, token]);
}

function App() {
  const defaultRedirect = useMemo(
    () => ensureTrailingSlash(`${window.location.origin}${window.location.pathname}`),
    []
  );
  const isMounted = useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);
  const [settings, setSettings] = useSessionStorage(SETTINGS_KEY, null);
  const [token, setToken] = useSessionStorage(TOKEN_KEY, null);
  const [clientId, setClientId] = useState(() => settings?.clientId ?? "");
  const [redirectUri, setRedirectUri] = useState(() => settings?.redirectUri ?? defaultRedirect);
  const [playlistValue, setPlaylistValue] = useState("");
  const [authorizeState, setAuthorizeState] = useState("idle");
  const [status, setStatus] = useState("");
  const [profile, setProfile] = useState(null);
  const [isClearing, setIsClearing] = useState(false);
  const [playlists, setPlaylists] = useState([]);
  const [playlistsState, setPlaylistsState] = useState("idle");
  const [playlistsError, setPlaylistsError] = useState("");
  const { toasts, pushToast, dismissToast } = useToasts();
  const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);

  useEffect(() => {
    setClientId(settings?.clientId ?? "");
    setRedirectUri(settings?.redirectUri ?? defaultRedirect);
  }, [settings, defaultRedirect]);

  const ensureAccessToken = useEnsureAccessToken(settings, token, setToken);

  const loadPlaylists = useCallback(
    async ({ skipToast = false } = {}) => {
      if (!isMounted.current) {
        return null;
      }

      if (!token) {
        if (isMounted.current) {
          setPlaylists([]);
          setPlaylistsState("idle");
          setPlaylistsError("");
        }
        return null;
      }

      if (isMounted.current) {
        setPlaylistsState("loading");
        setPlaylistsError("");
      }

      const activeToken = await ensureAccessToken();
      if (!activeToken) {
        const message = "Session expired. Please sign in again.";
        if (!skipToast) {
          pushToast(message);
        }
        if (isMounted.current) {
          setPlaylists([]);
          setPlaylistsState("error");
          setPlaylistsError(message);
          setProfile(null);
          setToken(null);
        }
        return null;
      }

      try {
        const fetched = await fetchUserPlaylists(activeToken.accessToken);
        if (!isMounted.current) {
          return fetched;
        }
        setPlaylists(fetched);
        setPlaylistsState("success");
        setPlaylistsError("");
        return fetched;
      } catch (error) {
        console.error(error);
        const message =
          error.status === 401
            ? "Authorization expired. Sign in again."
            : error.message || "Unable to load playlists.";
        if (!skipToast) {
          pushToast(message);
        }
        if (isMounted.current) {
          if (error.status === 401) {
            setToken(null);
            setProfile(null);
          }
          setPlaylistsState("error");
          setPlaylistsError(message);
        }
        return null;
      }
    },
    [ensureAccessToken, isMounted, pushToast, setProfile, setToken, token]
  );

  const isAuthenticated = Boolean(token);

  useEffect(() => {
    if (!isAuthenticated) {
      setPlaylists([]);
      setPlaylistsState("idle");
      setPlaylistsError("");
      return;
    }

    loadPlaylists();
  }, [isAuthenticated, loadPlaylists]);

  const handleRefreshPlaylists = useCallback(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  const formatTrackCount = useCallback(
    (count) => {
      if (count === 1) {
        return "1 track";
      }
      return `${numberFormatter.format(Math.max(count, 0))} tracks`;
    },
    [numberFormatter]
  );

  const selectedPlaylistId = useMemo(
    () => parsePlaylistId(playlistValue.trim()),
    [playlistValue]
  );

  const sortedPlaylists = useMemo(() => {
    return [...playlists].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [playlists]);

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [playlists, selectedPlaylistId]
  );

  const playlistStatus = useMemo(() => {
    if (playlistsState === "loading") {
      return { message: "Loading playlists…", tone: "info" };
    }

    if (playlistsState === "error") {
      return {
        message: playlistsError || "Unable to load playlists.",
        tone: "error",
      };
    }

    if (playlistsState === "idle") {
      return { message: "Select a playlist or paste a URL below.", tone: "info" };
    }

    if (!playlists.length) {
      return {
        message: "No editable playlists found yet. Try refreshing if you recently created one.",
        tone: "info",
      };
    }

    if (selectedPlaylist) {
      const trackLabel = formatTrackCount(selectedPlaylist.trackCount);
      return {
        message: `"${selectedPlaylist.name}" currently has ${trackLabel}.`,
        tone: "info",
      };
    }
    return { message: "Select a playlist or paste a URL below.", tone: "info" };
  }, [formatTrackCount, playlists, playlistsError, playlistsState, selectedPlaylist]);

  useEffect(() => {
    if (!token) {
      setProfile(null);
      return;
    }

    let cancelled = false;

    (async () => {
      const freshToken = await ensureAccessToken();
      if (!freshToken) {
        if (!cancelled) {
          setProfile(null);
        }
        return;
      }

      try {
        const profileData = await fetchProfile(freshToken.accessToken);
        if (cancelled) return;
        setProfile(profileData);
        if (!hasRequiredScopes(freshToken.scope)) {
          pushToast("Missing scopes. Re-authorize with playlist modify permissions.");
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          pushToast("Unable to load profile. Please sign in again.");
          setToken(null);
          setProfile(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ensureAccessToken, pushToast, setToken, token]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (error) {
      pushToast(`Spotify returned an error: ${error}`);
      clearQueryParams();
      return;
    }

    if (!code) {
      return;
    }

    const pkce = getPkce();
    if (!pkce || pkce.state !== state) {
      pushToast("State mismatch. Please try signing in again.");
      sessionStorage.removeItem(PKCE_KEY);
      clearQueryParams();
      return;
    }

    if (!settings?.clientId || !settings?.redirectUri) {
      pushToast("Missing app settings. Save your Client ID and Redirect URI.");
      sessionStorage.removeItem(PKCE_KEY);
      clearQueryParams();
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setAuthorizeState("loading");
        const tokenResponse = await exchangeCodeForToken(code, pkce, settings);
        if (!cancelled) {
          setToken(tokenResponse);
          pushToast("Authorization complete.");
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          pushToast(err.message || "Failed to complete authorization.");
        }
      } finally {
        sessionStorage.removeItem(PKCE_KEY);
        clearQueryParams();
        if (!cancelled) {
          setAuthorizeState("idle");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pushToast, setToken, settings]);

  const handleSettingsSubmit = useCallback(
    (event) => {
      event.preventDefault();
      const trimmedId = clientId.trim();
      const normalisedRedirect = ensureTrailingSlash(redirectUri.trim());
      if (!trimmedId || !normalisedRedirect) {
        pushToast("Enter both Client ID and Redirect URI.");
        return;
      }
      setSettings({ clientId: trimmedId, redirectUri: normalisedRedirect });
      pushToast("Settings saved for this session.");
    },
    [clientId, redirectUri, pushToast, setSettings]
  );

  const handleAuthorize = useCallback(() => {
    if (!settings?.clientId || !settings?.redirectUri) {
      pushToast("Save your Client ID and Redirect URI first.");
      return;
    }

    setAuthorizeState("loading");
    beginAuthorizationFlow(settings).catch((error) => {
      console.error(error);
      pushToast(error.message || "Unable to start authorization.");
      setAuthorizeState("idle");
    });
  }, [pushToast, settings]);

  const handleLogout = useCallback(() => {
    setToken(null);
    sessionStorage.removeItem(PKCE_KEY);
    setProfile(null);
    setStatus("");
    pushToast("Signed out.");
  }, [pushToast, setToken]);

  const handleClearPlaylist = useCallback(
    async (event) => {
      event.preventDefault();
      const playlistId = parsePlaylistId(playlistValue.trim());
      if (!playlistId) {
        pushToast("Enter a valid playlist URL or ID.");
        return;
      }

      setIsClearing(true);
      setStatus("Preparing playlist details…");

      const activeToken = await ensureAccessToken();
      if (!activeToken) {
        const message = "Session expired. Please sign in again.";
        setStatus(message);
        pushToast(message);
        setProfile(null);
        setIsClearing(false);
        return;
      }

      try {
        const summary = await fetchPlaylistSummary(activeToken.accessToken, playlistId);
        const trackCount = summary?.tracks?.total ?? 0;
        const playlistName = summary?.name?.trim() || "this playlist";
        const trackLabel = formatTrackCount(trackCount);
        const confirmed = window.confirm(
          trackCount === 0
            ? `"${playlistName}" already appears empty. Clear it anyway?`
            : `Are you sure you want to remove all ${trackLabel} from "${playlistName}"? This cannot be undone.`
        );

        if (!confirmed) {
          setStatus("Clearing cancelled.");
          return;
        }

        setStatus("Clearing playlist…");

        const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${activeToken.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uris: [] }),
        });

        if (response.status === 401) {
          const message = "Authorization expired. Sign in again.";
          setToken(null);
          setProfile(null);
          setStatus(message);
          pushToast(message);
          return;
        }

        if (!response.ok) {
          const detail = await safeParseJson(response);
          throw new Error(detail?.error?.message || "Spotify rejected the request.");
        }

        setStatus(`Removed ${trackLabel} from "${playlistName}".`);
        setPlaylistValue("");
        pushToast("Playlist emptied.");
        await loadPlaylists({ skipToast: true });
      } catch (error) {
        console.error(error);
        const message =
          error.status === 401
            ? "Authorization expired. Sign in again."
            : error.message || "Unable to clear playlist.";
        if (error.status === 401) {
          setToken(null);
          setProfile(null);
        }
        setStatus(message);
        pushToast(message);
      } finally {
        setIsClearing(false);
      }
    },
    [
      ensureAccessToken,
      loadPlaylists,
      formatTrackCount,
      playlistValue,
      pushToast,
      setPlaylistValue,
      setProfile,
      setToken,
    ]
  );

  const authorizeDisabled = !clientId.trim() || !redirectUri.trim() || authorizeState === "loading";
  const authorizeLabel = authorizeState === "loading" ? "Opening Spotify…" : "Sign in with Spotify";
  const userDisplay = profile?.display_name ?? profile?.id ?? "Loading profile…";

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "header",
      { className: "app-header" },
      React.createElement("a", { className: "back-link", href: "../" }, "\u2190 Back to utilities"),
      React.createElement("h1", null, "Playlist Cleaner"),
      React.createElement(
        "p",
        { className: "subtitle" },
        "Authenticate with Spotify and instantly empty any playlist you own or can edit."
      )
    ),
    React.createElement(
      "main",
      { className: "app-shell" },
        !isAuthenticated &&
          React.createElement(
            "section",
            { className: "card auth-card" },
            React.createElement("h2", null, "Authorize with Spotify"),
            React.createElement(
              "p",
              null,
              "Playlist Cleaner uses Spotify's secure Authorization Code Flow with PKCE. Provide your app credentials, then sign in to grant access."
            ),
            React.createElement(
              "form",
              { id: "settings-form", autoComplete: "off", onSubmit: handleSettingsSubmit },
              React.createElement(
                "label",
                { className: "field" },
                React.createElement("span", null, "Client ID"),
                React.createElement("input", {
                  id: "clientId",
                  name: "clientId",
                  type: "text",
                  placeholder: "e.g. 123abc456def789ghi012jkl",
                  required: true,
                  inputMode: "latin-prose",
                  spellCheck: "false",
                  value: clientId,
                  onChange: (event) => setClientId(event.target.value),
                })
              ),
              React.createElement(
                "label",
                { className: "field" },
                React.createElement("span", null, "Redirect URI"),
                React.createElement("input", {
                  id: "redirectUri",
                  name: "redirectUri",
                  type: "url",
                  placeholder: "https://<username>.github.io/spotify-utilities/playlist-cleaner/",
                  required: true,
                  spellCheck: "false",
                  value: redirectUri,
                  onChange: (event) => setRedirectUri(event.target.value),
                })
              ),
              React.createElement(
                "p",
                { className: "helper-text" },
                "Values are stored only in this browser session. Create your app at ",
                React.createElement(
                  "a",
                  {
                    href: "https://developer.spotify.com/dashboard/",
                    target: "_blank",
                    rel: "noreferrer",
                  },
                  "Spotify Developer Dashboard"
                ),
                "."
              ),
              React.createElement(
                "button",
                { type: "submit", className: "primary" },
                "Save & Continue"
              )
            ),
            React.createElement("div", { className: "divider", role: "separator", "aria-hidden": "true" }),
            React.createElement(
              "button",
              {
                id: "authorize",
                className: "primary",
                "data-state": authorizeState,
                disabled: authorizeDisabled,
                onClick: handleAuthorize,
              },
              authorizeLabel
            ),
            React.createElement(
              "p",
              { className: "helper-text" },
              "Required scopes: ",
              React.createElement("code", null, "playlist-modify-public"),
              ", ",
              React.createElement("code", null, "playlist-modify-private")
            )
          ),
        isAuthenticated &&
          React.createElement(
            "section",
            { className: "card action-card" },
            React.createElement(
              "header",
              { className: "card-header" },
              React.createElement(
                "div",
                null,
                React.createElement("h2", null, "Clear a playlist"),
                React.createElement(
                  "p",
                  { className: "muted" },
                  "Authenticated as ",
                  React.createElement("span", { className: "user-display" }, userDisplay)
                )
              ),
              React.createElement(
                "button",
                { id: "logout", className: "ghost", type: "button", onClick: handleLogout },
                "Log out"
              )
            ),
            React.createElement(
              "form",
              { id: "playlist-form", className: "form-grid", onSubmit: handleClearPlaylist },
              React.createElement(
                "label",
                { className: "field" },
                React.createElement("span", null, "Choose a playlist"),
                React.createElement(
                  "select",
                  {
                    id: "playlistSelect",
                    name: "playlistSelect",
                    className: "select",
                    value: selectedPlaylistId ?? "",
                    disabled: playlistsState === "loading",
                    onChange: (event) => setPlaylistValue(event.target.value),
                  },
                  React.createElement(
                    "option",
                    { value: "" },
                    playlistsState === "loading" ? "Loading playlists…" : "Select a playlist"
                  ),
                  sortedPlaylists.map((playlist) =>
                    React.createElement(
                      "option",
                      { key: playlist.id, value: playlist.id },
                      `${playlist.name} • ${formatTrackCount(playlist.trackCount)} • ${playlist.ownerName}`
                    )
                  )
                ),
                playlistStatus.message &&
                  React.createElement(
                    "p",
                    {
                      className: `helper-text${
                        playlistStatus.tone === "error" ? " helper-text-error" : ""
                      }`,
                    },
                    playlistStatus.message
                  )
              ),
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "ghost refresh-button",
                  onClick: handleRefreshPlaylists,
                  disabled: playlistsState === "loading",
                },
                playlistsState === "loading" ? "Refreshing…" : "Refresh list"
              ),
              React.createElement(
                "label",
                { className: "field" },
                React.createElement("span", null, "Playlist URL or ID"),
                React.createElement("input", {
                  id: "playlistInput",
                  name: "playlist",
                  type: "text",
                  placeholder: "https://open.spotify.com/playlist/…",
                  required: true,
                  spellCheck: "false",
                  value: playlistValue,
                  onChange: (event) => setPlaylistValue(event.target.value),
                }),
                React.createElement(
                  "p",
                  { className: "helper-text" },
                  "Selecting from the list fills this field automatically."
                )
              ),
              React.createElement(
                "button",
                {
                  type: "submit",
                  className: "primary",
                  id: "clearBtn",
                  disabled: isClearing,
                },
                isClearing ? "Clearing…" : "Empty playlist"
              )
            ),
            React.createElement(
              "div",
              { id: "status", role: "status", "aria-live": "polite", className: "status" },
              status
            )
          )
    ),
    React.createElement(
      "footer",
      { className: "app-footer" },
      React.createElement(
        "p",
        null,
        "Tokens are stored in ",
        React.createElement("code", null, "sessionStorage"),
        " and cleared on logout. Reload the page to refresh the auth state."
      )
    ),
    React.createElement(ToastStack, { toasts, onDismiss: dismissToast })
  );
}

const container = document.getElementById("root");
createRoot(container).render(React.createElement(App));
