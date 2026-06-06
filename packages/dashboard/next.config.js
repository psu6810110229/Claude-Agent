/**
 * Local-first dashboard config.
 *
 * The backend binds to 127.0.0.1 only and has no CORS. Instead of exposing it
 * to the browser cross-origin, we proxy same-origin `/api/*` requests through
 * Next to the backend. The browser only ever talks to the dashboard origin.
 *
 * Backend port mirrors the backend default (8787), overridable via env.
 */
const BACKEND_PORT = process.env.CLAUDE_AGENT_PORT ?? "8787";
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_ORIGIN}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
