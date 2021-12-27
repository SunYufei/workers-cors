addEventListener('fetch', (e) => {
   e.respondWith(handleRequest(e.request))
})

/**
 * @param {Request} request
 * @returns {Response}
 */
async function handleRequest(request) {
   // 请求头，返回对象
   const reqHeaders = new Headers(request.headers)
   let respBody, respContentType, respStatus
   const respHeaders = new Headers({ 'Access-Control-Allow-Origin': '*' })

   try {
      let url = request.url.slice(8)
      url = decodeURIComponent(url.slice(url.indexOf('/') + 1))
      console.log(url)
      if (
         request.method === 'OPTIONS' ||
         url.length < 3 ||
         url.indexOf('.') === -1 ||
         ['favicon.ico', 'robots.txt'].includes(url)
      ) {
         respBody = JSON.stringify({ code: 0 })
         respContentType = 'application/json'
      } else {
         // 补上前缀
         if (url.toLowerCase().indexOf('http') === -1) {
            url = `https://${url}`
            console.log(url)
         }
         // 构建 fetch 参数
         const fetchParams = {
            body: null,
            method: request.method,
            headers: {},
         }
         // 保留头部其他信息
         const headers = reqHeaders.entries()
         for (const header of headers) {
            if (!['Content-Length', 'Content-Type'].includes(header[0])) {
               fetchParams.headers[header[0]] = header[1]
            }
         }
         // 是否带 body
         if (['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(request.method) >= 0) {
            const contentType = (
               reqHeaders.get('Content-Type') || ''
            ).toLowerCase()
            if (contentType.includes('application/json')) {
               fetchParams.body = JSON.stringify(await request.json())
            } else if (
               contentType.includes('application/text') ||
               contentType.includes('text/html') ||
               contentType.includes('x-www-form-urlencoded')
            ) {
               fetchParams.body = await request.text()
            } else if (contentType.includes('form')) {
               fetchParams.body = await request.formData()
            } else {
               fetchParams.body = request.body
            }
         }

         // 发起 fetch
         const response = await fetch(url, fetchParams)
         for (const header of response.headers) {
            respHeaders.set(header[0], header[1])
         }
         respContentType = response.headers.get('Content-Type')
         respBody = response.body
         respStatus = response.status
      }
   } catch (e) {
      respContentType = 'application/json'
      respBody = JSON.stringify({
         code: -1,
         msg: JSON.stringify(e.stack) || e,
      })
      respStatus = 500
   }

   // 设置 content-type
   if (respContentType && respContentType !== '') {
      respHeaders.set('Content-Type', respContentType)
   }

   return new Response(respBody, {
      status: respStatus,
      headers: respHeaders,
   })
}
