const JSON_HEADER = { 'Content-Type': 'application/json; charset=utf-8' }
const TEXT_HEADER = { 'Content-Type': 'text/plain; charset=utf-8' }
export const DNS_HEADER = { 'Content-Type': 'application/dns-message' }

export const jsonResponse = (body: string | null, status = 200) =>
   new Response(body, { status: status, headers: JSON_HEADER })

export const textResponse = (body: string | null, status = 200) =>
   new Response(body, { status: status, headers: TEXT_HEADER })

export const errorResponse = (body: string | null) => textResponse(body, 500)
