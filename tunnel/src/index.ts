import { errorResponse, jsonResponse } from './resp'
import { notValidUUID } from './util'

export interface Env {
   UUID: string
   PROXY_IP: string
   DNS_RESOLVER_URL: string
}

export default {
   async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const userId = env.UUID
      if (notValidUUID(userId)) {
         return errorResponse('UUID is invalid')
      }
      // WebSocket
      const upgradeHeader = request.headers.get('Upgrade')
      if (upgradeHeader == 'websocket') {
         // VLESS over WebSocket handler
      }
      // HTTP path
      const url = new URL(request.url)
      const pathname = url.pathname
      if (pathname == '/cf') {
         return jsonResponse(JSON.stringify(request.cf, null, 4))
      }
      if (pathname == '/connect') {
         // Socket connect test
      }
      if (pathname == `/${userId}`) {
         // VLESS config HTML
      }
      // For any other path, reverse proxy to 'www.fmprc.gov.cn' and return the original response, caching it in the process
      // Note: remove any other hostname and caching process
      return fetch('https://global.cctv.com/')
   },
}
