/**
 * Checks if a given string is a valid UUID.
 * Note: This is not a real UUID validation.
 * @param uuid The string to validate as a UUID.
 * @returns True if the string is an invalid UUID, false otherwise.
 */
export const notValidUUID = (uuid: string | null) =>
   !uuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)
