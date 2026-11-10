import { UUID_PATTERN } from "@/lib/uuid";

const EVENT_KEY = /^[0-9]{4}[a-z0-9]+$/;

/**
 * Object path inside the private "robot-photos" bucket:
 *
 *   {event_key}/{team_number}/{photo_uuid}.jpg
 *
 * Deterministic from the client-generated photo id, so a retried upload targets
 * the SAME object (and, with upsert:false, the retry reports "already exists",
 * which we treat as success). It deliberately does not include the entry id: the
 * entry's id can change when two scouts create the same team offline, and photos
 * must not have to be moved in storage when that happens.
 *
 * Throws on bad input rather than building a path that points somewhere else.
 */
export function photoStoragePath(
  eventKey: string,
  teamNumber: number,
  photoId: string,
): string {
  if (!EVENT_KEY.test(eventKey))
    throw new Error(`Invalid event key: ${eventKey}`);
  if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 99999) {
    throw new Error(`Invalid team number: ${teamNumber}`);
  }
  if (!UUID_PATTERN.test(photoId)) throw new Error("Invalid photo id");
  return `${eventKey}/${teamNumber}/${photoId.toLowerCase()}.jpg`;
}
