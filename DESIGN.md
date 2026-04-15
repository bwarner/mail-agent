# Email Agent System — Design Document

## Overview

A multi-user email ingestion and processing system that pulls email from
Gmail and Outlook/M365 accounts, classifies messages, extracts data and
attachments, and routes work to downstream agents. Each user can have
multiple email accounts across different providers.

## Principles

- **Security first** — no auto-reply, no outbound email actions (prevents replay/spoofing attacks)
- **Rule-based by default** — deterministic processing keeps costs predictable; LLM is opt-in per rule
- **Multi-account** — one user can connect N Gmail + M Outlook accounts
- **Attachments are first-class** — stored persistently, PDFs OCR'd and indexed for search
- **Agent routing** — processed mail routes to downstream agents, not humans

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Email Agent System                       │
│                                                                 │
│  ┌───────────────────────────────────────────┐                  │
│  │           Account Manager                 │                  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐     │                  │
│  │  │ Gmail   │ │ Gmail   │ │Outlook  │ ... │                  │
│  │  │ Acct 1  │ │ Acct 2  │ │ Acct 1  │     │                  │
│  │  └────┬────┘ └────┬────┘ └────┬────┘     │                  │
│  │       │           │           │           │                  │
│  │  ┌────▼───────────▼───────────▼────┐      │                  │
│  │  │     Credential Vault            │      │                  │
│  │  │  (OAuth2 tokens, encrypted)     │      │                  │
│  │  └─────────────────────────────────┘      │                  │
│  └───────────────────────────────────────────┘                  │
│                         │                                       │
│                         ▼                                       │
│  ┌───────────────────────────────────────────┐                  │
│  │           Connector Layer                 │                  │
│  │                                           │                  │
│  │  ┌──────────────┐  ┌──────────────────┐   │                  │
│  │  │  Gmail API   │  │ Microsoft Graph  │   │                  │
│  │  │  Connector   │  │   Connector      │   │                  │
│  │  └──────┬───────┘  └────────┬─────────┘   │                  │
│  │         │                   │              │                  │
│  │  ┌──────▼───────────────────▼──────┐       │                  │
│  │  │      Normalized Message         │       │                  │
│  │  │  (common format across provid.) │       │                  │
│  │  └─────────────────────────────────┘       │                  │
│  └───────────────────────────────────────────┘                  │
│                         │                                       │
│                         ▼                                       │
│  ┌───────────────────────────────────────────┐                  │
│  │         Processing Pipeline               │                  │
│  │                                           │                  │
│  │  1. Dedup / already-processed check       │                  │
│  │  2. Rule Engine (classify, tag, filter)   │                  │
│  │  3. Attachment Processor                  │                  │
│  │     - Extract & store in blob storage     │                  │
│  │     - PDF → OCR → searchable text         │                  │
│  │     - Index content for full-text search  │                  │
│  │  4. Data Extractor (dates, amounts, etc.) │                  │
│  │  5. Optional: LLM step (Claude) for       │                  │
│  │     complex classification / extraction   │                  │
│  │  6. Router → assign to downstream agent   │                  │
│  └───────────────────────────────────────────┘                  │
│                         │                                       │
│                         ▼                                       │
│  ┌───────────────────────────────────────────┐                  │
│  │           Agent Router                    │                  │
│  │                                           │                  │
│  │  Routes processed messages to:            │                  │
│  │  - Invoice processing agent               │                  │
│  │  - Support ticket agent                   │                  │
│  │  - Document filing agent                  │                  │
│  │  - Notification agent (alerts, no reply)  │                  │
│  │  - Custom user-defined agents             │                  │
│  └───────────────────────────────────────────┘                  │
│                                                                 │
│  ┌───────────────────────────────────────────┐                  │
│  │              Storage Layer                │                  │
│  │                                           │                  │
│  │  ┌────────────┐ ┌─────────────────────┐   │                  │
│  │  │ Message DB │ │ Attachment Blob     │   │                  │
│  │  │ (metadata, │ │ Storage (S3/local)  │   │                  │
│  │  │  state,    │ │                     │   │                  │
│  │  │  audit log)│ │ ┌─────────────────┐ │   │                  │
│  │  └────────────┘ │ │ Search Index    │ │   │                  │
│  │                 │ │ (OCR'd text,    │ │   │                  │
│  │                 │ │  extracted data)│ │   │                  │
│  │                 │ └─────────────────┘ │   │                  │
│  │                 └─────────────────────┘   │                  │
│  └───────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

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
- Credentials encrypted at rest — never stored in plaintext
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
| `to`             | []string     | Recipients                           |
| `cc`             | []string     | CC recipients                        |
| `subject`        | string       | Subject line                         |
| `body_text`      | string       | Plain text body                      |
| `body_html`      | string       | HTML body (sanitized)                |
| `date`           | datetime     | Message date                         |
| `headers`        | map          | Raw headers for rule matching        |
| `attachments`    | []Attachment | Attachment metadata + content        |
| `labels`         | []string     | Provider labels/folders              |
| `thread_id`      | string       | Thread/conversation ID               |
| `in_reply_to`    | string       | Parent message ID                    |

**Gmail Connector** — uses Gmail API with `users.messages.list` + watch/push
notifications via Pub/Sub for near-real-time.

**Outlook Connector** — uses Microsoft Graph API with delta queries +
change notifications (webhooks) for near-real-time.

Both fall back to polling when webhooks are unavailable.

### Processing Pipeline

Processes each NormalizedMessage through an ordered sequence of steps:

#### Step 1: Dedup / State Check
- Check message_id against processed-message log
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
- Store original file in blob storage (keyed by hash to dedup)
- For PDFs: run OCR (Tesseract or similar) → extract text
- For images: OCR if flagged by rules
- Index extracted text in full-text search engine
- Store metadata: filename, mime type, size, hash, extracted text ref

#### Step 4: Data Extractor
Rule-driven extraction of structured data from message body:
- Dates, amounts, phone numbers, addresses (regex-based)
- Key-value pairs from structured emails (order confirmations, etc.)

#### Step 5: Optional LLM Step
When a rule specifies `use_llm: true`, send the message to Claude for:
- Complex classification that rules can't handle
- Summarization of long threads
- Extraction of unstructured data

This is **opt-in per rule** to control costs. Most mail never hits this step.

#### Step 6: Router
Based on tags and rule actions, dispatch to the appropriate downstream agent
via a message queue or direct invocation.

### Agent Router

Routes processed messages to downstream agents. Agents are registered with:
- Name and type
- Input schema (what data they expect)
- Endpoint (queue topic, HTTP endpoint, function reference)

Built-in agent types:
- **Document filing** — stores and organizes extracted documents
- **Notification** — sends alerts (Slack, webhook) — READ-ONLY, never replies
- **Data pipeline** — feeds extracted data to external systems

Custom agents can be registered by users.

### Storage Layer

Three storage concerns:

1. **Message DB** — metadata, processing state, audit trail
   - Which messages were processed, when, what actions taken
   - Rule match history (which rules fired, what was extracted)
   - Per-account sync cursors

2. **Attachment Blob Storage** — original files
   - Content-addressed (hash-keyed) to dedup identical attachments
   - Retention policies per user/account

3. **Search Index** — full-text search over OCR'd documents and extracted data
   - OCR text from PDFs and images
   - Extracted structured data
   - Message body text (optional, configurable)

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
- Tokens encrypted at rest (AES-256 or similar)
- Minimal scopes: read-only email access
  - Gmail: `gmail.readonly`
  - Outlook: `Mail.Read`
- Token refresh handled server-side, refresh tokens encrypted separately
- Per-account credential isolation — compromise of one account doesn't
  expose others

### Input Sanitization
- HTML bodies sanitized before storage (strip scripts, iframes, etc.)
- Attachment filenames sanitized (path traversal prevention)
- Rule matching operates on sanitized/decoded content
- OCR input validated — no execution of embedded content

### Rule Injection Prevention
- Rules defined by config, not by email content
- No eval() or dynamic code execution from message data
- Extraction patterns are pre-defined, not derived from messages

### Audit Trail
- Every action logged: message received, rules matched, attachments stored,
  agents notified
- Immutable audit log — append-only
- Per-user activity visible to account owner

## Open Questions

1. **Tech stack** — Python (good Gmail/Graph SDKs, Tesseract bindings) vs
   TypeScript (good async story, Graph SDK)? Leaning Python.
2. **Database** — PostgreSQL (structured data + full-text search via
   tsvector) vs SQLite (simpler) + separate search (Typesense/Meilisearch)?
3. **Blob storage** — S3-compatible (MinIO for self-hosted) vs local
   filesystem vs database BLOBs?
4. **Deployment** — Docker compose? Single binary? Cloud functions?
5. **Agent interface** — HTTP callbacks? Message queue (Redis streams,
   RabbitMQ)? In-process function calls?
6. **Multi-tenancy** — shared DB with row-level isolation vs per-user DB?
7. **OCR engine** — Tesseract (free, local) vs cloud OCR (Google Vision,
   Azure AI)?

## Phased Delivery

### Phase 1: Foundation
- Project scaffold, config system, credential vault
- Gmail connector (read-only, polling)
- NormalizedMessage format
- SQLite message DB
- Basic rule engine (classify + tag)

### Phase 2: Outlook + Attachments
- Outlook/M365 connector
- Attachment extraction and blob storage
- PDF OCR pipeline (Tesseract)
- Full-text search index

### Phase 3: Agent Routing
- Agent registry and router
- Built-in agents (document filing, notifications)
- Custom agent interface

### Phase 4: Production Hardening
- Webhook/push notifications (replace polling)
- Encrypted credential storage
- Audit logging
- Multi-user admin
- Monitoring and alerting
