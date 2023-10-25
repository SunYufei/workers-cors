import { byteToHex, slice } from './util'

// Command in VLESS request
const TCP = 1
const UDP = 2
const MUX = 3
// Address type in VLESS request
const IPV4 = 1
const DOMAIN_NAME = 2
const IPV6 = 3

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
   dohURL: string
): Promise<Response> {
   const [client, server] = Object.values(new WebSocketPair())
   server.accept()

   return new Response(null, { status: 101, webSocket: client })
}

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
