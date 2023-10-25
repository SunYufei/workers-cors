/**
 * Checks if a given string is a valid UUID.
 * Note: This is not a real UUID validation.
 * @param uuid The string to validate as a UUID.
 * @returns True if the string is an invalid UUID, false otherwise.
 */
export const notValidUUID = (uuid: string | null) =>
   !uuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)

/**
 * Convert an Uint8Array to a hex string.
 * @param array Uint8Array
 * @returns Hex string
 */
export const byteToHex = (array: Uint8Array) =>
   Array.from(array, (v, _) => (v + 256).toString(16).slice(1))
      .join('')
      .toLowerCase()

/**
 * Get a slice from an ArrayBuffer.
 * @param buffer ArrayBuffer
 * @param begin begin
 * @param length length
 * @returns buffer[begin, begin + length)
 */
export const slice = (buffer: ArrayBuffer, begin: number, length: number) =>
   buffer.slice(begin, begin + length)
