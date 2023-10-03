const CONTENT_TYPE = 'Content-Type'

const APPLICATION_JSON = 'application/json; charset=utf-8'

export interface Env {}

export default {
   async fetch(
      request: Request,
      env: Env,
      ctx: ExecutionContext
   ): Promise<Response> {
      // 响应头
      const headers = new Headers({ 'Access-Control-Allow-Origin': '*' })
      // 响应体
      let body: BodyInit | null
      // 响应码
      let status = 500

      try {
         const { pathname } = new URL(request.url)
         let url = decodeURIComponent(pathname.slice(1))
         // URI 检查
         if (
            request.method === 'OPTIONS' ||
            url.length < 3 ||
            url.indexOf('.') === -1 ||
            ['favicon.ico', 'robots.txt'].includes(url)
         ) {
            body = JSON.stringify({ code: 0 })
            headers.set(CONTENT_TYPE, APPLICATION_JSON)
         } else {
            // 补充前缀
            if (url.indexOf('http') === -1) {
               url = `https://${url}`
            }
            // 发起请求
            const response = await fetch(url, request)
            for (const header of response.headers) {
               headers.set(header[0], header[1])
            }
            body = response.body
            status = response.status
         }
      } catch (e) {
         body = JSON.stringify({
            code: -1,
            error: JSON.stringify(e),
         })
         status = 500
         headers.set(CONTENT_TYPE, APPLICATION_JSON)
      }

      return new Response(body, {
         status: status,
         headers: headers,
      })
   },
}
