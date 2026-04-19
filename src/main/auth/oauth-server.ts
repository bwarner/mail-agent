import { createServer, type Server } from 'http'
import { URL } from 'url'

export interface OAuthCallbackResult {
  code: string
  state?: string
}

export function startOAuthServer(): Promise<{
  port: number
  waitForCallback: () => Promise<OAuthCallbackResult>
  close: () => void
}> {
  return new Promise((resolveSetup) => {
    let resolveCallback: (result: OAuthCallbackResult) => void
    let rejectCallback: (err: Error) => void

    const callbackPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
      resolveCallback = resolve
      rejectCallback = reject
    })

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      const state = url.searchParams.get('state') ?? undefined

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(errorPage(error))
        rejectCallback(new Error(`OAuth error: ${error}`))
        return
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(successPage())
        resolveCallback({ code, state })
        return
      }

      res.writeHead(404)
      res.end()
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' ? addr!.port : 0

      resolveSetup({
        port,
        waitForCallback: () => callbackPromise,
        close: () => server.close()
      })
    })
  })
}

function successPage(): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e6e6e6">
    <div style="text-align:center"><h1>Account Connected</h1><p>You can close this window and return to Mail Agent.</p></div>
  </body></html>`
}

function errorPage(error: string): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e94560">
    <div style="text-align:center"><h1>Authentication Failed</h1><p>${error}</p><p>Please close this window and try again.</p></div>
  </body></html>`
}
