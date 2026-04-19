# Email Agent System — Design Document

## Overview

A local-first desktop email client and intelligent processing agent.
Functions as a full-featured email client (read, compose, reply, manage)
while also providing automated email classification, data extraction,
OCR, and routing to downstream agents. Supports Gmail and Outlook/M365
accounts. Each user can have multiple email accounts across providers.

All data stays on the user's machine by default. Optional Couchbase
Capella sync for multi-device access.

## Principles

- **Local-first** — data lives on-device in Couchbase Lite; no cloud required
- **Full email client** — read, compose, reply, forward, manage folders/labels
- **Security first** — agents/rules NEVER send email; only the human user can send via UI
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

### Plugin System

Plugins are the extensibility mechanism — they replace the hardcoded
agent concept with a user-installable, sandboxed module system (think
VS Code extensions for email).

#### Plugin Types

| Type          | When it runs                | What it can do                        |
|---------------|------------------------------|---------------------------------------|
| **processor** | During pipeline (step 5.5)   | Enrich messages: add tags, extract data, classify |
| **action**    | After routing (step 6)       | React to messages: file docs, send notifications, call APIs |
| **viewer**    | In the UI                    | Custom panels: dashboards, charts, reports |

#### Plugin Manifest (`plugin.json`)

```json
{
  "name": "receipt-scanner",
  "version": "1.0.0",
  "displayName": "Receipt Scanner",
  "description": "Extracts purchase data from email receipts",
  "author": "Jane Developer",
  "license": "MIT",
  "type": "processor",
  "main": "index.js",
  "permissions": [
    "read_messages",
    "read_attachments",
    "write_tags",
    "write_extracted_data"
  ],
  "config_schema": {
    "type": "object",
    "properties": {
      "currency": { "type": "string", "default": "USD" },
      "min_amount": { "type": "number", "default": 0 }
    }
  },
  "hooks": {
    "on_message": true,
    "on_schedule": "*/30 * * * *"
  }
}
```

#### Available Permissions

| Permission              | Description                                      |
|------------------------|--------------------------------------------------|
| `read_messages`        | Read message content, headers, metadata          |
| `read_attachments`     | Access attachment files (read-only)              |
| `write_tags`           | Add/remove tags on messages                      |
| `write_extracted_data` | Add extracted data fields to messages             |
| `http_outbound`        | Make HTTP requests to external services           |
| `storage_read`         | Read from plugin's private storage namespace      |
| `storage_write`        | Write to plugin's private storage namespace       |
| `notifications`        | Show desktop notifications to the user            |

**Explicitly forbidden** (never grantable):
- `send_email` — plugins can NEVER send email
- `modify_rules` — plugins cannot alter processing rules
- `access_credentials` — plugins cannot read OAuth tokens or API keys

#### Plugin Lifecycle

```
Install → Configure → Enable → [on_message / on_schedule] → Disable → Uninstall
              │                         │
              │                    Runs in Worker
              │                    thread (sandboxed)
              ▼                         │
        User sets config            Returns result
        via Settings UI             (tags, data, actions)
```

#### Plugin Sandbox

Plugins run in **Node.js Worker threads** — isolated from the main
process. They communicate via structured message passing only.

```
Main Process
├── Plugin Manager
│   ├── Plugin Registry (Couchbase Lite)
│   ├── Plugin Loader (reads ~/.mail-agent/plugins/)
│   └── Plugin Runner
│       ├── Worker Thread: receipt-scanner
│       ├── Worker Thread: slack-notifier
│       └── Worker Thread: invoice-filer
│
│   Each Worker:
│   ├── Receives: read-only message data (per permissions)
│   ├── Returns: enrichments or action results
│   ├── Has: own private storage namespace
│   └── Cannot: access main process APIs, send email, read credentials
```

**Sandbox enforcement:**
- Worker threads have no access to `ipcMain`, `electron`, or `safeStorage`
- The plugin API is a narrow, typed interface passed via `postMessage`
- File system access is restricted to the plugin's own directory
- HTTP outbound requires the `http_outbound` permission and is logged

#### Plugin API (available inside Worker)

```typescript
interface PluginContext {
  // Read (requires read_messages)
  message: ReadonlyMessage
  attachments: ReadonlyAttachment[]

  // Write (requires respective permissions)
  addTag(tag: string): void
  removeTag(tag: string): void
  setExtractedData(key: string, value: unknown): void

  // Storage (requires storage_read / storage_write)
  storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
    list(prefix?: string): Promise<string[]>
  }

  // HTTP (requires http_outbound)
  fetch(url: string, opts?: RequestInit): Promise<Response>

  // Notifications (requires notifications)
  notify(title: string, body: string): void

  // Config
  config: Record<string, unknown>

  // Logging
  log: {
    info(msg: string): void
    warn(msg: string): void
    error(msg: string): void
  }
}
```

#### Plugin Directory Structure

```
~/.mail-agent/plugins/
├── receipt-scanner/
│   ├── plugin.json          # Manifest
│   ├── index.js             # Entry point
│   ├── README.md            # Documentation
│   └── icon.png             # Display icon (optional)
├── slack-notifier/
│   ├── plugin.json
│   └── index.js
└── invoice-filer/
    ├── plugin.json
    ├── index.js
    └── templates/
        └── invoice.hbs
```

#### Plugin Installation

1. **Manual** — drop a plugin folder into `~/.mail-agent/plugins/`
2. **URL** — paste a git repo URL or tarball URL in Settings
3. **Future: Registry** — browse and install from a plugin marketplace

### Agent Router (Legacy / HTTP Plugins)

For backward compatibility and language-agnostic plugins, HTTP-based
agents are still supported. They function as external plugins with
the `http_outbound` permission.

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
  "retry": { "max_attempts": 3, "backoff": "exponential" },
  "timeout_seconds": 30
}
```

Delivery semantics: at-least-once with idempotency key (message_id + agent_id).
Failed deliveries logged to audit trail and retried with exponential backoff.

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
├── collection: agents          # Registered downstream agents (HTTP legacy)
├── collection: plugins         # Installed plugin metadata + config
├── collection: plugin_storage  # Plugin private key-value storage
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
├── plugins/                     # Installed plugins
│   ├── receipt-scanner/
│   │   ├── plugin.json
│   │   └── index.js
│   └── slack-notifier/
│       ├── plugin.json
│       └── index.js
└── config/
    └── settings.json            # App settings (non-sensitive)
```

Content-addressed by SHA-256 hash for dedup. Original filename stored in
Couchbase Lite attachment metadata document.

## Security

### Send Security Model
The **user** can compose, reply, and forward email through the UI.
The **rule engine and agents can NEVER send email** — this is enforced
architecturally, not by convention:

- Send operations are only exposed in the renderer → main IPC layer
- The pipeline/rule engine has no access to send functions
- Plugins run in Worker threads with no access to send APIs
- Plugin permissions are declared in manifest and enforced at runtime
- Agent HTTP callbacks receive read-only message data; no send endpoint exists
- Every outbound email is logged in the audit trail with `origin: "user"`

This preserves protection against automated attack vectors:
- Replay attacks (attacker crafts email that triggers auto-reply to victim)
- Spoofed sender exploitation via rules
- Email loop amplification
- Data exfiltration via agent-triggered reply

### Credential Security
- OAuth2 only — system never sees user passwords
- Tokens encrypted at rest via Electron `safeStorage` API (uses OS keychain:
  Keychain on macOS, DPAPI on Windows, libsecret on Linux)
- OAuth scopes for full email client functionality:
  - Gmail: `gmail.modify`, `gmail.compose`, `gmail.send`
  - Outlook: `Mail.ReadWrite`, `Mail.Send`
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

### Phase 1: Foundation (done)
- Electron + React scaffold (electron-vite)
- Couchbase Lite JS integration + collection setup
- NormalizedMessage TypeScript types
- Gmail connector (read-only, polling via `googleapis`)
- Outlook connector (Microsoft Graph, read-only)
- Basic rule engine (classify + tag)
- Processing pipeline with dedup + extraction
- Basic inbox viewer UI (dark theme, split-pane)

### Phase 1.5: Email Client
- Thread/conversation view (group messages by thread_id)
- Compose, reply, reply-all, forward
- Rich HTML email rendering (sandboxed)
- Message management: read/unread, star, archive, delete, move
- Folder/label navigation in sidebar
- Multi-account send (pick "From" account)
- Drafts support
- Send operations restricted to user-initiated UI actions only

### Phase 2: Attachments + OCR
- PaddleOCR sidecar (Python process, PyInstaller-packaged)
- Attachment extraction → local filesystem
- PDF/image OCR pipeline → text stored in Couchbase Lite
- Couchbase Lite FTS index over OCR'd text + message bodies
- Attachment browser UI + inline attachment viewing

### Phase 3: Plugin System
- Plugin manifest format and validation
- Plugin loader (scan ~/.mail-agent/plugins/)
- Plugin sandbox (Worker thread runner with permission enforcement)
- Plugin API (PluginContext: messages, storage, fetch, notifications)
- Plugin integration into processing pipeline
- Plugin management UI (install, configure, enable/disable)
- Example plugins: receipt-scanner, slack-notifier

### Phase 4: LLM Integration
- LLM provider system (Ollama, Claude, OpenAI, custom)
- LLM settings UI (provider config, model selection)
- LLM available as a plugin API (plugins can request LLM inference)
- HTTP agent compatibility layer (legacy agents as external plugins)

### Phase 5: Polish + Sync
- Electron `safeStorage` for all credentials
- Optional Couchbase Capella sync (multi-device)
- Rule editor UI (visual rule builder)
- Audit log viewer
- Auto-updater (electron-updater)
- Installer packaging (DMG, NSIS, AppImage)
- Plugin registry / marketplace (future)
