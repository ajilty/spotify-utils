# Spotify Utilities

A collection of browser-based Spotify tools built to simplify account management and data hygiene — all running **client-side** with modern OAuth security.  
The utilities are deployable as a **GitHub Pages** static site using **Authorization Code Flow with PKCE** (Spotify’s recommended auth model).

---

## 🎧 Overview

This repository hosts multiple lightweight Spotify utilities.  
Each tool runs entirely in your browser — no server, no secrets, no backend dependencies.

| Utility | Purpose | Status |
|----------|----------|--------|
| **Playlist Cleaner** | Empty a playlist you own or can edit | ✅ Complete |
| **Playlist Exporter** | Download playlist metadata and tracks as CSV | 🧩 Planned |
| **Library Deduplicator** | Detect and remove duplicate songs across playlists | 🧩 Planned |
| **Saved Tracks Manager** | Filter and batch-remove tracks from “Liked Songs” | 🧩 Planned |

---

## 🔐 Authentication (Authorization Code Flow with PKCE)

All utilities use Spotify’s **Authorization Code Flow with PKCE**, which replaces the deprecated Implicit Grant.  
This flow is safe for static apps because it never stores a client secret.

**Steps:**
1. The app generates a random **code_verifier** and **code_challenge**.
2. User is redirected to Spotify’s `/authorize` endpoint.
3. After login, Spotify redirects back with an authorization `code`.
4. The browser exchanges the `code` for an **access token** (and optionally refresh token) via:
   ```http
   POST https://accounts.spotify.com/api/token
   grant_type=authorization_code&
   code=<CODE>&
   redirect_uri=<YOUR_REDIRECT_URI>&
   client_id=<YOUR_CLIENT_ID>&
   code_verifier=<CODE_VERIFIER>
