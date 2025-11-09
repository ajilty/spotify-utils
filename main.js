import React from "https://esm.sh/react@18?dev";
import { createRoot } from "https://esm.sh/react-dom@18/client?dev";

const utilities = [
  {
    title: "Playlist Cleaner",
    description:
      "Empty any playlist you own or collaborate on. Authenticate via PKCE, paste a playlist link, and clear it in a click.",
    status: "complete",
    href: "./playlist-cleaner/",
  },
  {
    title: "Playlist Exporter",
    description:
      "Download playlist tracks and metadata as CSV. Coming soon for catalog auditing and offline review.",
    status: "planned",
  },
  {
    title: "Library Deduplicator",
    description:
      "Surface duplicate tracks across playlists and quickly declutter your saved music. Coming soon.",
    status: "planned",
  },
  {
    title: "Saved Tracks Manager",
    description:
      "Filter, sort, and batch-remove songs from Liked Songs without ever leaving the browser. Coming soon.",
    status: "planned",
  },
];

const statusLabels = {
  complete: "Complete",
  planned: "Planned",
};

function StatusChip({ status }) {
  const label = statusLabels[status] ?? status;
  const iconPath =
    status === "complete"
      ? "M16.704 5.29a1 1 0 0 1 0 1.414l-7.25 7.25a1 1 0 0 1-1.414 0l-3.25-3.25a1 1 0 0 1 1.414-1.414l2.543 2.543 6.543-6.543a1 1 0 0 1 1.414 0Z"
      : "M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.981-1.742 2.981H4.42c-1.53 0-2.492-1.647-1.743-2.98l5.58-9.92Zm1.743 3.4a1 1 0 0 0-1 1v2.5a1 1 0 1 0 2 0v-2.5a1 1 0 0 0-1-1Zm0 7a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z";

  return React.createElement(
    "div",
    {
      className: `status-chip ${status}`,
      "aria-label": `Utility status: ${label}`,
    },
    React.createElement(
      "svg",
      { viewBox: "0 0 20 20", fill: "currentColor", "aria-hidden": "true" },
      React.createElement("path", { fillRule: "evenodd", d: iconPath, clipRule: "evenodd" })
    ),
    label
  );
}

function UtilityCard({ utility }) {
  const { title, description, href, status } = utility;
  const content = [
    React.createElement(StatusChip, { status, key: "status" }),
    React.createElement("h2", { key: "title" }, title),
    React.createElement("p", { key: "description" }, description),
  ];

  if (href) {
    content.push(
      React.createElement(
        "a",
        { key: "cta", href },
        "Launch utility",
        " \u2192"
      )
    );
  }

  return React.createElement(
    "article",
    {
      className: "card",
      ...(href ? {} : { "aria-disabled": "true" }),
    },
    ...content
  );
}

function App() {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "header",
      null,
      React.createElement("h1", null, "Spotify Utilities"),
      React.createElement(
        "p",
        { className: "lead" },
        "A suite of privacy-friendly tools to help you manage playlists and saved tracks — all running securely in your browser with OAuth PKCE."
      )
    ),
    React.createElement(
      "main",
      null,
      React.createElement(
        "section",
        { className: "card-grid", "aria-label": "Available Spotify tools" },
        utilities.map((utility) =>
          React.createElement(UtilityCard, { key: utility.title, utility })
        )
      )
    ),
    React.createElement(
      "footer",
      null,
      "Built with the Spotify Web API · OAuth 2.0 Authorization Code Flow with PKCE"
    )
  );
}

const container = document.getElementById("root");
createRoot(container).render(React.createElement(App));
