# Open-core split: public Server + Data Layer, private Copilot

The project pursues GitHub stars and revenue at once, which pull in opposite directions. We resolved it with an open-core split: the Server, the Dashboard, and the Data Layer stay fully open source and free-standing (the star asset), while the Copilot — the paid hosted frontend with auth, billing, and Fable prompt code — lives in a separate private repo that imports the open Data Layer. The OSS repo never touches money.

## Considered Options

- Everything public, charge only for hosting (Plausible model) — rejected: anyone can self-host the paid product, and the differentiator (Report prompts) is trivially copyable.
- Closed-source directory inside the public repo — rejected: muddies the license story and weakens the "fully free" launch pitch.

## Consequences

- Sequencing: OSS launch ships first; the Copilot is phase 2, gated on demand signal (stars, sponsor clicks) from the launch.
- The Data Layer must stay importable as a clean package boundary — Copilot needs must not leak private assumptions into it.
