# Email Agent System — Design Document

## Overview

A local-first desktop application (Electron) for email ingestion and
processing. Pulls email from Gmail and Outlook/M365 accounts, classifies
messages, extracts data and attachments, OCRs documents for search, and
routes work to downstream agents. Each user can have multiple email
accounts across different providers.

All data stays on the user's machine by default. Optional Couchbase
Capella sync for multi-device access.

## Principles

- **Local-first** — data lives on-device in Couchbase Lite; no cloud required
- **Security first** — no auto-reply, no outbound email (prevents replay/spoofing)
- **Rule-based by default** — deterministic processing; LLM is opt-in per rule
- **LLM-agnostic** — pluggable LLM backend (Ollama local, Claude, OpenAI, etc.)
- **Multi-account** — one user can connect N Gmail + M Outlook accounts
- **Attachments are first-class** — stored locally, PDFs OCR'd and indexed for search
- **Agent routing** — processed mail routes to downstream agents via HTTP

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Electron App (Desktop)                          │
│                                                                     │
│  ┌────────────────────────────────┐  ┌───────────────────────────┐  │
│  │        Renderer Process        │  │      Main Process         │  │
│  │        (React / UI)            │  │      (Node.js)            │  │
│  │                                │  │                           │  │
│  │  - Inbox view / search        │  │  ┌──────────────────────┐ │  │
│  │  - Rule editor                │  │  │  Account Manager     │ │  │
│  │  - Account setup (OAuth flow) │  │  │  - Gmail connector   │ │  │
│  │  - Attachment browser         │  │  │  - Outlook connector │ │  │
│  │  - Agent status dashboard     │  │  │  - Credential vault  │ │  │
│  │  - LLM provider settings     │  │  └──────────┬───────────┘ │  │
│  │                                │  │             │             │  │
│  └──────────────┬─────────────────┘  │  ┌──────────▼───────────┐ │  │
│                 │ IPC                │  │  Processing Pipeline │ │  │
│                 │                    │  │  1. Dedup            │ │  │
│                 │                    │  │  2. Rule Engine      │ │  │
│                 │                    │  │  3. Attachments      │ │  │
│                 │                    │  │  4. Data Extraction  │ │  │
│                 │                    │  │  5. LLM (optional)   │ │  │
│                 │                    │  │  6. Agent Router     │ │  │
│                 │                    │  └──────────┬───────────┘ │  │
│                 │                    │             │             │  │
│                 │                    │  ┌──────────▼───────────┐ │  │
│                 └────────────────────┤  │  Storage Layer       │ │  │
│                                      │  │  - Couchbase Lite DB │ │  │
│                                      │  │  - Local file store  │ │  │
│                                      │  │  - FTS indexes       │ │  │
│                                      │  └──────────────────────┘ │  │
│                                      └───────────────────────────┘  │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    Sidecar Processes                           │  │
│  │                                                                │  │
│  │  ┌─────────────────┐  ┌──────────────────────────────────┐    │  │
│  │  │  PaddleOCR       │  │  Ollama (optional, or external) │    │  │
│  │  │  (Python sidecar)│  │  Local LLM inference            │    │  │
│  │  └─────────────────┘  └──────────────────────────────────┘    │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP callbacks
                              ▼
                ┌──────────────────────────┐
                │   Downstream Agents      │
                │   (external services)    │
                │   - Invoice processor    │
                │   - Document filer       │
                │   - Notification agent   │
                │   - Custom agents        │
                └──────────────────────────┘
```

## Tech Decisions

| Decision         | Choice                   | Rationale                                    |
|------------------|--------------------------|----------------------------------------------|
| **Platform**     | Electron                 | Cross-platform desktop, Node.js + Chromium   |
| **Language**     | TypeScript               | Type safety, Electron-native                 |
| **Database**     | Couchbase Lite (JS)      | Embedded, local-first, optional Capella sync |
| **File storage** | Local filesystem         | Desktop app — no cloud dependency            |
| **OCR**          | PaddleOCR (Python sidecar)| Modern, accurate, multilingual              |
| **LLM**         | Pluggable (Ollama-first) | Local inference = free + private             |
| **Agent comms**  | HTTP callbacks           | Simple, debuggable, language-agnostic        |
| **UI**           | React                    | Component model, ecosystem                   |

## Component Details

### Account Manager

Handles the relationship: **User → many Accounts → one Provider each**.

```
User
 ├── Gmail Account (personal)
 ├── Gmail Account (work)
 └── Outlook Account (corporate)
```

- Each account stores: provider type, OAuth2 credentials, sync cursor
  (last-seen message ID / sync token), polling interval, folder filters
- Credentials encrypted at rest via Electron `safeStorage` API
- OAuth2 only — no app passwords, no stored user passwords
- Token refresh handled transparently per provider

### Connector Layer

One connector per provider, both producing the same **NormalizedMessage**:

| Field            | Type         | Description                          |
|------------------|--------------|--------------------------------------|
| `message_id`     | string       | Provider-native unique ID            |
| `account_id`     | string       | Which account this came from         |
| `provider`       | enum         | gmail | outlook                      |
| `from_address`   | string       | Sender email                         |
| `from_name`      | string       | Sender display name                  |
| `to`             | string[]     | Recipients                           |
| `cc`             | string[]     | CC recipients                        |
| `subject`        | string       | Subject line                         |
| `body_text`      | string       | Plain text body                      |
| `body_html`      | string       | HTML body (sanitized)                |
| `date`           | string (ISO) | Message date                         |
| `headers`        | Record       | Raw headers for rule matching        |
| `attachments`    | Attachment[] | Attachment metadata + content ref    |
| `labels`         | string[]     | Provider labels/folders              |
| `thread_id`      | string       | Thread/conversation ID               |
| `in_reply_to`    | string       | Parent message ID                    |

**Gmail Connector** — uses Gmail API via `googleapis` npm package.
`users.messages.list` for polling; Gmail push notifications (Pub/Sub)
for near-real-time in later phases.

**Outlook Connector** — uses Microsoft Graph API via `@microsoft/microsoft-graph-client`.
Delta queries for polling; change notifications (webhooks) for near-real-time
in later phases.

Both fall back to polling when push is unavailable (default for Phase 1).

### Processing Pipeline

Processes each NormalizedMessage through an ordered sequence of steps:

#### Step 1: Dedup / State Check
- Check `message_id` against Couchbase Lite messages collection
- Skip already-processed messages
- Idempotent — safe to re-process the same batch

#### Step 2: Rule Engine
Pattern-matching rules applied in priority order. Each rule has:

```yaml
rules:
  - name: "invoices"
    priority: 10
    conditions:
      any:
        - field: "subject"
          op: "contains"
          value: "invoice"
        - field: "from_address"
          op: "matches"
          value: "*@billing.example.com"
        - field: "attachments"
          op: "has_type"
          value: "application/pdf"
    actions:
      - tag: "invoice"
      - route_to: "invoice_agent"
      - extract: ["amount", "due_date", "vendor"]

  - name: "newsletters"
    priority: 50
    conditions:
      all:
        - field: "headers.List-Unsubscribe"
          op: "exists"
    actions:
      - tag: "newsletter"
      - route_to: "archive_agent"
```

Rules support: `contains`, `matches` (glob), `regex`, `exists`, `equals`,
`has_type` (for attachments). Combinators: `all`, `any`, `none`.

#### Step 3: Attachment Processor
- Extract attachments from message
- Store original file on local filesystem (keyed by SHA-256 hash for dedup)
- For PDFs: send to PaddleOCR sidecar → extract text
- For images: OCR if flagged by rules
- Store OCR text in Couchbase Lite (indexed via FTS)
- Store metadata: filename, mime type, size, hash, local path, OCR text ref

#### Step 4: Data Extractor
Rule-driven extraction of structured data from message body:
- Dates, amounts, phone numbers, addresses (regex-based)
- Key-value pairs from structured emails (order confirmations, etc.)

#### Step 5: Optional LLM Step
When a rule specifies `use_llm: true`, send the message to the configured
LLM provider for:
- Complex classification that rules can't handle
- Summarization of long threads
- Extraction of unstructured data

This is **opt-in per rule** to control costs.

#### Step 6: Router
Based on tags and rule actions, dispatch to downstream agents via HTTP.

### LLM Provider System

Pluggable architecture — user configures one or more LLM providers,
selects which to use per rule or as a default.

```typescript
interface LLMProvider {
  name: string;
  type: "ollama" | "anthropic" | "openai" | "custom";
  endpoint: string;           // e.g. http://localhost:11434 for Ollama
  model: string;              // e.g. "llama3", "claude-sonnet-4-20250514"
  apiKey?: string;            // encrypted via safeStorage, not needed for Ollama
  maxTokens?: number;
  temperature?: number;
}
```

**Supported providers:**

| Provider    | Endpoint                          | Use case                     |
|-------------|-----------------------------------|------------------------------|
| **Ollama**  | `http://localhost:11434`          | Free, private, local         |
| **Claude**  | `https://api.anthropic.com`      | High accuracy, paid          |
| **OpenAI**  | `https://api.openai.com`         | Alternative cloud option     |
| **Custom**  | Any OpenAI-compatible endpoint   | Self-hosted, other providers |

All providers are called via a unified interface. The system normalizes
the request/response format so rules don't care which LLM is behind them.

**Ollama is the recommended default** — free, fully local, keeps data
on-device. Cloud LLMs are available for users who want higher accuracy
on specific tasks.

### PaddleOCR Sidecar

PaddleOCR runs as a Python child process managed by the Electron main process.

```
Electron Main Process
    │
    │  spawn + stdio/HTTP
    │
    ▼
Python Process (paddleocr_server.py)
    │
    ├── Listens on localhost:{port} or communicates via stdin/stdout
    ├── Receives: file path to PDF/image
    ├── Returns: extracted text + bounding boxes + confidence scores
    └── Bundled with app via PyInstaller or embedded Python
```

**Why PaddleOCR over Tesseract:**
- Higher accuracy, especially on complex layouts (tables, multi-column)
- Better multilingual support (80+ languages out of the box)
- Layout analysis built-in (detects text regions, tables, figures)
- Active development by Baidu, modern deep learning architecture

**Packaging options:**
1. **PyInstaller bundle** — freeze PaddleOCR into a standalone executable,
   ship alongside Electron app. No Python install required on user's machine.
2. **Embedded Python** — ship a minimal Python runtime with the app.
3. **User's Python** — require user to install PaddleOCR separately
   (developer/power-user mode).

### Agent Router

Routes processed messages to downstream agents via HTTP callbacks.
Agents are registered with:

```json
{
  "agent_id": "invoice_processor",
  "name": "Invoice Processor",
  "endpoint": "http://localhost:8081/invoice",
  "method": "POST",
  "auth": {
    "type": "bearer",
    "token_ref": "encrypted:agent_tokens/invoice_processor"
  },
  "input_schema": {
    "type": "object",
    "properties": {
      "message": { "$ref": "#/NormalizedMessage" },
      "tags": { "type": "array", "items": { "type": "string" } },
      "extracted_data": { "type": "object" },
      "attachments": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "local_path": { "type": "string" },
            "filename": { "type": "string" },
            "mime_type": { "type": "string" },
            "ocr_text": { "type": "string" }
          }
        }
      }
    }
  },
  "retry": { "max_attempts": 3, "backoff": "exponential" },
  "timeout_seconds": 30
}
```

Delivery semantics: at-least-once with idempotency key (message_id + agent_id).
Failed deliveries logged to audit trail and retried with exponential backoff.

Agents can be local (localhost) or remote — HTTP is the universal interface.

### Storage Layer

#### Couchbase Lite (Embedded)

All structured data stored locally in Couchbase Lite JS:

```
database: mail_agent.cblite2
├── collection: messages        # NormalizedMessage + processing metadata
├── collection: attachments     # Attachment metadata (local path, OCR text)
├── collection: rules           # User-defined processing rules
├── collection: accounts        # Email account configs + sync cursors
├── collection: audit_log       # Immutable action log
├── collection: agents          # Registered downstream agents
└── collection: llm_providers   # LLM provider configurations
```

**Couchbase Lite advantages for this use case:**
- Embedded — no separate database server to install or manage
- JSON document model — NormalizedMessage maps directly
- Full-text search — built-in FTS for searching OCR'd text and message bodies
- **Optional Capella sync** — if user later wants multi-device or cloud backup,
  Couchbase Lite syncs to Capella via Sync Gateway with no schema changes
- Conflict resolution — handles offline edits + sync gracefully

#### Local Filesystem (Attachments)

```
~/.mail-agent/
├── data/
│   └── mail_agent.cblite2       # Couchbase Lite database
├── attachments/
│   ├── {sha256_hash}.pdf
│   ├── {sha256_hash}.docx
│   └── ...
├── ocr_cache/
│   └── {sha256_hash}.txt        # Cached OCR results
└── config/
    └── settings.json            # App settings (non-sensitive)
```

Content-addressed by SHA-256 hash for dedup. Original filename stored in
Couchbase Lite attachment metadata document.

## Security

### No Outbound Email
The system **never sends email**. No replies, no forwards, no drafts.
This eliminates entire classes of attacks:
- Replay attacks (attacker crafts email that triggers auto-reply to victim)
- Spoofed sender exploitation
- Email loop amplification
- Data exfiltration via reply

### Credential Security
- OAuth2 only — system never sees user passwords
- Tokens encrypted at rest via Electron `safeStorage` API (uses OS keychain:
  Keychain on macOS, DPAPI on Windows, libsecret on Linux)
- Minimal scopes: read-only email access
  - Gmail: `gmail.readonly`
  - Outlook: `Mail.Read`
- Token refresh handled locally, refresh tokens encrypted separately
- LLM API keys also stored via `safeStorage`
- Per-account credential isolation

### Local-First Privacy
- All email data stays on-device by default
- LLM processing can be fully local via Ollama — no data leaves the machine
- OCR runs locally via PaddleOCR sidecar
- Cloud LLM providers are opt-in; user explicitly chooses what data to send
- No telemetry, no analytics, no phone-home

### Input Sanitization
- HTML bodies sanitized before storage (DOMPurify — strip scripts, iframes)
- Attachment filenames sanitized (path traversal prevention)
- Rule matching operates on sanitized/decoded content
- PaddleOCR input validated — no execution of embedded content

### Rule Injection Prevention
- Rules defined by user config, not by email content
- No eval() or dynamic code execution from message data
- Extraction patterns are pre-defined, not derived from messages

### Audit Trail
- Every action logged: message received, rules matched, attachments stored,
  agents notified
- Immutable audit log — append-only Couchbase Lite collection
- Viewable in app UI

## Phased Delivery

### Phase 1: Foundation
- Electron + React scaffold (electron-forge or electron-vite)
- Couchbase Lite JS integration + collection setup
- NormalizedMessage TypeScript types
- Gmail connector (read-only, polling via `googleapis`)
- Basic rule engine (classify + tag)
- Message dedup and state tracking
- Simple inbox viewer UI

### Phase 2: Outlook + OCR
- Outlook/M365 connector (Microsoft Graph, read-only)
- PaddleOCR sidecar (Python process, PyInstaller-packaged)
- Attachment extraction → local filesystem
- PDF/image OCR pipeline → text stored in Couchbase Lite
- Couchbase Lite FTS index over OCR'd text + message bodies
- Attachment browser UI

### Phase 3: LLM + Agent Routing
- LLM provider system (Ollama, Claude, OpenAI, custom)
- LLM settings UI (provider config, model selection)
- Agent registry + HTTP dispatcher with retry
- Built-in agents (document filing, notifications)
- Agent status dashboard UI

### Phase 4: Polish + Sync
- Electron `safeStorage` for all credentials
- Optional Couchbase Capella sync (multi-device)
- Rule editor UI (visual rule builder)
- Audit log viewer
- Auto-updater (electron-updater)
- Installer packaging (DMG, NSIS, AppImage)
