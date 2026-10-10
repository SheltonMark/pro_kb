# Findings

- Empty initial local and GitHub repositories, no CodeGraph index.
- Final requirements: server persistence, public access/CRUD, fixed dark neutral-black and light-gray floating glass (no theme switch or localStorage).
- D3 official references https://d3js.org/d3-force and https://d3js.org/d3-zoom; vendor7.9.0 separate from business code.
- Demo sources/22-note links verified. CS7 summaries retain Host/board/cloud distinctions and original source SHA256, see docs/DEMO_SOURCES.md.
- Built-in browser backend unavailable (discovery empty); local Chrome Playwright used for actual browser verification.
- Git global127.0.0.1:7890 proxy unavailable; per-command git -c http.proxy= works.
- Deployment host runs existing Node20 service3000 through Nginx80. Install independent Node22.19.0 and additive /kb/ proxy route; do not replace root app.
- Debugging discoveries and validated fixes recorded in docs/kb/2026-10-10-首版实现与验证.md.
