# VGC Tools

Competitive Pokémon (VGC) teambuilding intelligence, shipped three ways: an open-source MCP server and local dashboard for AI-tool users, and a paid hosted copilot for everyone else.

## Language

**The Server**:
The open-source MCP server that gives an AI agent VGC teambuilding tools (meta, deep-dives, threat analysis, damage calc).
_Avoid_: the MCP, the backend, the API

**The Dashboard**:
The free local web UI served by `npm run ui`, running over the same data as the Server. A deployed read-only copy serves as the public demo.
_Avoid_: the app, the site

**The Copilot**:
The paid hosted product: a web frontend where Claude Fable generates Reports and answers follow-up chat. Lives in a separate private repo; not part of the open-source release.
_Avoid_: the frontend, the SaaS, the AI app

**The Report**:
The Copilot's core paid artifact — a Fable-written team coaching document (threats, leads, tech recommendations, spread fixes) produced from one bounded tool-loop run over a submitted team.
_Avoid_: analysis, readout, summary

**Report Chat**:
The follow-up conversation scoped to a specific Report, served by a cheaper model than the Report itself.
_Avoid_: chat (unqualified)

**The Data Layer**:
The shared core (usage-stats fetchers, damage-calc service, threat analyzer, team storage) that the Server, the Dashboard, and the Copilot all import. Open source.
_Avoid_: the service layer, utils

**Credit**:
The unit of Copilot billing. One Report costs a fixed number of Credits; new users get free Credits. Payment buys compute and analysis, never Pokémon content.
_Avoid_: token (collides with API tokens), point
