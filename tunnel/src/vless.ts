import { connect } from 'cloudflare:sockets'
import { DNS_HEADER } from './resp'
import { base64ToArrayBuffer, byteToHex, slice } from './util'

// Command in VLESS request
const TCP = 1
const UDP = 2
const MUX = 3
// Address type in VLESS request
const IPV4 = 1
const DOMAIN_NAME = 2
const IPV6 = 3

// VLESS handler logger
let logAddress = ''
let logPort = ''
const logInfo = (text: string, ...data: any[]) =>
   console.log(`[${new Date()} ${logAddress}:${logPort}]`, text, data)
const logError = (text: string, e: unknown) =>
   console.error(`[${new Date()} ${logAddress}:${logPort}]`, text, e)

// WebSocket ready state
const WS_READY_STATE_OPEN = 1
const WS_READY_STATE_CLOSING = 2

/**
 * Handles VLESS over WebSocket requests by creating a WebSocket pair, accepting the WebSocket connection, and processing the VLESS header.
 * @param request The incoming request object.
 * @param userId
 * @param dohURL
 * @returns A promise that resolves to a WebSocket response object.
 */
export async function vlessOverWebSocketHandler(
   request: Request,
   userId: string,
   proxyIP: string,
   dohURL: string
): Promise<Response> {
   const [client, server] = Object.values(new WebSocketPair())
   server.accept()

   const earlyDataHeader = request.headers.get('sec-websocket-protocol')
   const readableWebSocketStream = makeReadableWebSocketStream(server, earlyDataHeader)

   // ws --> remote
   let isDNS = false
   let udpStreamWriteFunc: ((chunk: Uint8Array) => void) | null = null
   let remoteSocketWrapper: Socket | null = null
   readableWebSocketStream
      .pipeTo(
         new WritableStream({
            async write(chunk, controller) {
               if (isDNS && udpStreamWriteFunc) {
                  udpStreamWriteFunc(chunk)
                  return
               }
               if (remoteSocketWrapper) {
                  const writer = remoteSocketWrapper.writable.getWriter()
                  await writer.write(chunk)
                  writer.releaseLock()
                  return
               }

               const { vlessVersion, isUDP, portRemote, addressRemote, requestData } =
                  processVLESSRequest(chunk, userId)

               // Update address and port to Logger
               logAddress = addressRemote
               logPort = `${portRemote} ${isUDP ? 'UDP' : 'TCP'}`

               // If UDP and not DNS port, close it
               if (isUDP && portRemote != 53) {
                  // cf seems has bug, controller.error will not end stream
                  throw new Error('UDP proxy only enabled for DNS which is port 53')
               }

               if (isUDP && portRemote == 53) {
                  isDNS = true
               }

               // VLESS response
               // 0, +1 Protocol version
               // 1, +1 Extend message length (N)
               // 2, +N Extend message (ProtoBuf)
               // 2+N, +Y Response data
               const vlessResponseHeader = new Uint8Array([vlessVersion, 0])

               // TODO: support udp here when cf runtime has udp support
               if (isDNS) {
                  const writeFunc = handleUDPOutBound(server, vlessResponseHeader, dohURL)
                  udpStreamWriteFunc = writeFunc
                  udpStreamWriteFunc(requestData)
                  return
               } else {
                  handleTCPOutBound(
                     remoteSocketWrapper,
                     proxyIP,
                     addressRemote,
                     portRemote,
                     requestData,
                     server,
                     vlessResponseHeader
                  )
               }
            },

            close() {
               logInfo('readableWebSocketStream is close')
            },

            abort(reason) {
               logInfo('readableWebSocketStream is abort', reason)
            },
         })
      )
      .catch((e) => logError('readableWebSocketStream pipeTo error', e))

   return new Response(null, { status: 101, webSocket: client })
}

/**
 * Creates a readable stream from a WebSocket server, allowing for data to be read from the WebSocket.
 * @param socketServer The WebSocket server to create the readable stream from.
 * @param earlyDataHeader The header containing early data for WebSocket 0-RTT.
 * @returns A readable stream that can be used to read data from the WebSocket.
 */
const makeReadableWebSocketStream = (socketServer: WebSocket, earlyDataHeader: string | null) =>
   new ReadableStream({
      start(controller) {
         socketServer.addEventListener('message', (event) => controller.enqueue(event.data))

         socketServer.addEventListener('close', () => {
            safeCloseWebSocket(socketServer)
            controller.close()
         })

         socketServer.addEventListener('error', (e) => {
            logError('WebSocket server has error', e)
            controller.error(e)
         })

         const { buffer, error } = base64ToArrayBuffer(earlyDataHeader)
         if (error) {
            controller.error(error)
         } else if (buffer) {
            controller.enqueue(buffer)
         }
      },

      pull(controller) {
         // if ws can stop read if stream is full, we can implement backpressure
         // https://streams.spec.whatwg.org/#example-rs-push-backpressure
      },

      cancel(reason) {
         logInfo('ReadableStream was canceled, due to', reason)
         safeCloseWebSocket(socketServer)
      },
   })

/**
 * Processes the VLESS request buffer and returns an object with the relevant information.
 * https://xtls.github.io/development/protocols/vless.html
 * @param vlessBuffer The VLESS request buffer to process.
 * @param userId The user ID to validate against the UUID in the VLESS request.
 * @returns An object with the relevant information extracted from the VLESS request buffer.
 */
function processVLESSRequest(
   vlessBuffer: ArrayBuffer,
   userId: string
): {
   vlessVersion: number
   isUDP: boolean
   portRemote: number
   addressType: number
   addressRemote: string
   requestData: Uint8Array
} {
   if (vlessBuffer.byteLength < 24) {
      throw new Error(`Invalid data length ${vlessBuffer.byteLength}`)
   }
   // 0, +1 Protocol version
   const vlessVersion = new DataView(vlessBuffer, 0, 1).getUint8(0)
   // 1, +16 UUID
   const uuid = byteToHex(new Uint8Array(vlessBuffer.slice(1, 17)))
   if (uuid != userId.replace(/-/g, '')) {
      throw new Error(`Invalid UUID ${uuid}`)
   }
   // 17, +1 Extend message length (M)
   const optLength = new DataView(vlessBuffer, 17, 1).getUint8(0)
   // 18, +M Extend message (ProtoBuf)
   // skip opt for now
   // 18+M, +1 Command
   const command = new DataView(vlessBuffer, 18 + optLength, 1).getUint8(0)
   let isUDP = false
   if (command == TCP) {
      isUDP = false
   } else if (command == UDP) {
      isUDP = true
   } else {
      throw new Error(`Command ${command} is not support.`)
   }
   // 18+M+1, +2 Port
   const portIndex = 18 + optLength + 1
   // port is big-Endian in raw data etc 80 == 0x005d
   const portRemote = new DataView(vlessBuffer, portIndex, 2).getUint16(0)
   // 18+M+3, +1 Address type
   const addressIndex = portIndex + 2
   const addressType = new DataView(vlessBuffer, addressIndex, 1).getUint8(0)
   // 18+M+4, +S Address
   let addressValueIndex = addressIndex + 1
   let addressLength = 0 // S
   let addressValue: string | null = null
   if (addressType == IPV4) {
      addressLength = 4
      addressValue = new Uint8Array(slice(vlessBuffer, addressValueIndex, addressLength)).join('.')
   } else if (addressType == DOMAIN_NAME) {
      addressLength = new DataView(vlessBuffer, addressValueIndex, 1).getUint8(0)
      addressValueIndex += 1
      addressValue = new TextDecoder().decode(slice(vlessBuffer, addressValueIndex, addressLength))
   } else if (addressType == IPV6) {
      addressLength = 16
      const dataView = new DataView(vlessBuffer, addressValueIndex, addressLength)
      // 2001:0db8:85a3:0000:0000:8a2e:0370:7334
      addressValue = Array.from({ length: 8 }, (_, i) =>
         dataView.getUint16(i * 2).toString(16)
      ).join(':')
      // seems no need add [] for ipv6
   } else {
      throw new Error(`Invalid address type ${addressType}.`)
   }
   if (!addressValue) {
      throw new Error(`addressValue is empty, addressType ${addressType}`)
   }
   // 18+M+4+S, +Y Request data
   const requestDataIndex = addressValueIndex + addressLength
   const requestData = new Uint8Array(vlessBuffer.slice(requestDataIndex))

   return {
      vlessVersion,
      isUDP,
      portRemote,
      addressType,
      addressRemote: addressValue,
      requestData,
   }
}

/**
 * Handles outbound UDP traffic by transforming the data into DNS queries and sending them over a WebSocket connection.
 * @param webSocket The WebSocket connection to send the DNS queries over.
 * @param vlessResponseHeader The VLESS response header.
 * @param dohURL DNS server url.
 * @returns An object with a write method that accepts a Uint8Array chunk to write to the transform stream.
 */
function handleUDPOutBound(
   webSocket: WebSocket,
   vlessResponseHeader: ArrayBuffer,
   dohURL: string
): (chunk: Uint8Array) => void {
   let isVLESSHeaderSent = false
   const transformStream = new TransformStream({
      start(controller) {},

      transform(chunk: ArrayBuffer, controller) {
         // UDP message 2 byte is the the length of UDP data
         // TODO: this should have bug, beacsue maybe udp chunk can be in two websocket message
         for (let i = 0; i < chunk.byteLength; ) {
            const packetLength = new DataView(chunk, i, i + 2).getUint16(0)
            const data = new Uint8Array(slice(chunk, i + 2, packetLength))
            i = i + 2 + packetLength
            controller.enqueue(data)
         }
      },

      flush(controller) {},
   })

   // Only handle DNS UDP for now
   transformStream.readable
      .pipeTo(
         new WritableStream({
            async write(chunk, controller) {
               const resp = await fetch(dohURL, {
                  method: 'POST',
                  headers: DNS_HEADER,
                  body: chunk,
               })
               const dnsQueryResult = await resp.arrayBuffer()
               const udpSize = dnsQueryResult.byteLength
               const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff])
               if (webSocket.readyState == WS_READY_STATE_OPEN) {
                  logInfo('DoH success and DNS message length is', udpSize)
                  if (isVLESSHeaderSent) {
                     webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer())
                  } else {
                     webSocket.send(
                        await new Blob([
                           vlessResponseHeader,
                           udpSizeBuffer,
                           dnsQueryResult,
                        ]).arrayBuffer()
                     )
                     isVLESSHeaderSent = true
                  }
               }
            },
         })
      )
      .catch((e) => logError('DNS UDP has error', e))

   const writer = transformStream.writable.getWriter()

   return writer.write
}

/**
 * Handles outbound TCP connections.
 * @param remoteSocket
 * @param proxyIP
 * @param addressRemote The remote address to connect to.
 * @param portRemote The remote port to connect to.
 * @param requestData The VLESS request data to write.
 * @param webSocket The WebSocket to pass the remote socket to.
 * @param vlessResponseHeader The VLESS response header.
 */
async function handleTCPOutBound(
   remoteSocket: Socket | null,
   proxyIP: string,
   addressRemote: string,
   portRemote: number,
   requestData: Uint8Array,
   webSocket: WebSocket,
   vlessResponseHeader: Uint8Array
) {
   /**
    * Connects to a given address and port and writes data to the socket.
    * @param address The address to connect to.
    * @param port The port to connect to.
    * @returns A promise that resolves to the connected socket.
    */
   async function connectAndWrite(address: string, port: number): Promise<Socket> {
      const socket = connect({
         hostname: address,
         port: port,
      })
      remoteSocket = socket
      logInfo(`Connect to ${address}:${port}`)
      const writer = socket.writable.getWriter()
      await writer.write(requestData) // first write, normal is TLS client hello
      writer.releaseLock()
      return socket
   }

   /**
    * Retries connecting to the remote address and port if the Cloudflare socket has no incoming data.
    */
   async function retry() {
      const socket = await connectAndWrite(proxyIP || addressRemote, portRemote)
      socket.closed
         .catch((e) => logError('Retry TCP socket closed error', e))
         .finally(() => safeCloseWebSocket(webSocket))
      await remoteSocketToWebSocket(socket, webSocket, vlessResponseHeader, null)
   }

   const socket = await connectAndWrite(addressRemote, portRemote)

   // when remote socket is ready, pass to WebSocket
   // remote --> ws
   remoteSocketToWebSocket(socket, webSocket, vlessResponseHeader, retry)
}

/**
 * Converts a remote socket to a WebSocket connection.
 * @param remoteSocket The remote socket to convert.
 * @param webSocket The WebSocket to connect to.
 * @param vlessResponseHeader The VLESS response heeader.
 * @param retry The function to retry the connection if it fails.
 */
async function remoteSocketToWebSocket(
   remoteSocket: Socket,
   webSocket: WebSocket,
   vlessResponseHeader: ArrayBuffer,
   retry: (() => Promise<void>) | null
) {
   // remote --> ws
   let remoteChunkCount = 0
   let vlessHeader: ArrayBuffer | null = vlessResponseHeader
   let hasIncomingData = false // check if remoteSocket has incoming data
   await remoteSocket.readable
      .pipeTo(
         new WritableStream({
            start(controller) {},

            async write(chunk: Uint8Array, controller) {
               hasIncomingData = true
               remoteChunkCount += 1
               if (webSocket.readyState != WS_READY_STATE_OPEN) {
                  controller.error('webSocket.readyState maybe closed')
               }
               if (vlessHeader) {
                  webSocket.send(await new Blob([vlessHeader, chunk]).arrayBuffer())
                  vlessHeader = null
               } else {
                  webSocket.send(chunk)
               }
            },

            close() {
               logInfo('remoteConnection.readable is closeh hasIncomingData is', hasIncomingData)
            },

            abort(reason) {
               logError('remoteConnection.readable abort', reason)
            },
         })
      )
      .catch((e) => {
         logError('remoteSocketToWebSocket has exception', e)
         safeCloseWebSocket(webSocket)
      })

   // seems is cf connect socket has error,
   // 1. Socket.closed will have error
   // 2. Socket.readable will be close without any data coming
   if (hasIncomingData == false && retry) {
      logInfo('retry')
      retry()
   }
}

/**
 * Closes a WebSocket connection safely without throwing exceptions.
 * @param socket The WebSocket connection to close.
 */
function safeCloseWebSocket(socket: WebSocket) {
   try {
      if (socket.readyState == WS_READY_STATE_OPEN || socket.readyState == WS_READY_STATE_CLOSING) {
         socket.close()
      }
   } catch (e) {
      console.error('safeCloseWebSocket error', e)
   }
}
