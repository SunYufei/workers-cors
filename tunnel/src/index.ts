import { connect } from 'cloudflare:sockets'
import { errorResponse, jsonResponse, textResponse } from './resp'
import { notValidUUID } from './util'
import { vlessOverWebSocketHandler } from './vless'

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
         return vlessOverWebSocketHandler(request, userId, env.PROXY_IP, env.DNS_RESOLVER_URL)
      }
      // HTTP path
      const url = new URL(request.url)
      const pathname = url.pathname
      if (pathname == '/cf') {
         return jsonResponse(JSON.stringify(request.cf, null, 4))
      }
      if (pathname == '/connect') {
         // Socket connect test
         return socketTest('cloudflare.com')
      }
      if (pathname == `/${userId}`) {
         // VLESS config HTML
         return vlessConfigResponse(userId, env.PROXY_IP, request.headers.get('Host'))
      }
      // For any other path, reverse proxy to 'www.fmprc.gov.cn' and return the original response, caching it in the process
      // Note: remove any other hostname and caching process
      return fetch('https://global.cctv.com/')
   },
}

async function socketTest(hostname: string, port = 80): Promise<Response> {
   console.log(`Connecting to ${hostname} ${port}`)
   const socket = connect({ hostname: hostname, port: port })
   const writer = socket.writable.getWriter()
   const reader = socket.readable.getReader()
   try {
      await writer.write(new TextEncoder().encode(`GET / HTTP/1.1\r\nHost: ${hostname}\r\n\r\n`))
      writer.releaseLock()
      const { value } = await reader.read()
      return textResponse(new TextDecoder().decode(value))
   } catch (e) {
      return errorResponse(JSON.stringify(e))
   } finally {
      writer.releaseLock()
      reader.releaseLock()
      await socket.close()
   }
}

function vlessConfigResponse(userId: string, proxy: string, hostname: string | null): Response {
   const line = '-'.repeat(36)
   const body = `${line}
Workers-VLESS-WebSocket 分享链接
${line}
vless://${userId}@${proxy}:80?encryption=none&security=none&type=ws&host=${hostname}&path=%2F%3Fed%3D2048#Workers%20VLESS
${line}
客户端参数
${line}
地址(address): ${proxy}
端口(port): 80

用户ID(id): ${userId}
level: 0
流控(flow):
加密方式(encryption): none

传输协议(network): ws
伪装类型(type): none
伪装域名(host): ${hostname}
路径(path): /?ed=2048

传输层安全(TLS/security): none
${line}`
   return textResponse(body)
}
