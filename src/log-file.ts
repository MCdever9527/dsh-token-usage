/**
 * The host-side fallback reader for one session's log file.
 *
 * The session-persistence seam is the primary reader: it migrates historical
 * generations, validates replay, and never serves a torn tail. It can still
 * refuse a session — a historical generation whose migration fails in this
 * environment, or a composition without a read-capable backend — and a refusal
 * must not silently drop that session's tokens from the statistics.
 *
 * So this module reads the newest log generation straight off disk:
 *
 * - The artifact is a sequence of independent Zstandard frames (one header
 *   frame, then one frame per append batch), which is why a plain
 *   `zstdDecompressSync(wholeFile)` only yields the first frame. The walker
 *   below computes every frame's byte length from the Zstandard frame header
 *   (or, when the header omits the content size, by walking its data blocks)
 *   and decodes each frame on its own.
 * - Frame sizes come from the format itself, so no magic-number scanning can
 *   be fooled by a magic byte sequence occurring inside compressed data.
 * - The newest generation wins by filename, which orders `session.v4.jsonl.zstd`
 *   above the legacy `session.jsonl.zstd`, so a migrated session is never read
 *   from its stale predecessor as well.
 *
 * Legacy generations parse through the same fold: their `assistant/message`
 * records carry `data.usage` and `data.message.source`, and their provider-less
 * `assistant/chunk` frames are simply event types the fold does not count.
 *
 * @module dsh-token-usage/log-file
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import type { FoldEvent } from './fold.ts'

/** Zstandard frame magic (little-endian 0xFD2FB528) and skippable-frame base. */
const ZSTD_MAGIC = 0xfd2fb528
const ZSTD_SKIPPABLE_MASK = 0xfffffff0
const ZSTD_SKIPPABLE_BASE = 0x184d2a50

/** One frame's location inside the artifact. */
interface FrameSpan {
  readonly offset: number
  readonly size: number
  readonly skippable: boolean
}

/** A canonical log filename of any generation, compressed or raw. */
const LOG_FILENAME = /^session(\.v\d+)?\.jsonl(\.zstd)?$/

/** Little-endian 24-bit read used by the block-header walk. */
function readUint24(buffer: Buffer, offset: number): number {
  return buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16)
}

/**
 * Compute every frame span of one artifact from the frame headers.
 *
 * A frame with a recorded content size is skipped by arithmetic; a frame
 * without one is walked block by block (3-byte block header: last-block bit,
 * 2-bit block type, 21-bit block size; an RLE block stores exactly one literal
 * byte however large its regenerated size is). A skippable frame carries its
 * own 4-byte length.
 *
 * @param buffer - the whole artifact.
 * @returns spans in file order; a truncated tail yields spans only for the
 *   frames that are fully present, and the caller decodes whatever it got.
 */
export function frameSpans(buffer: Buffer): FrameSpan[] {
  const spans: FrameSpan[] = []
  let offset = 0
  while (offset + 4 <= buffer.length) {
    const magic = buffer.readUInt32LE(offset)
    if (((magic & ZSTD_SKIPPABLE_MASK) >>> 0) === ZSTD_SKIPPABLE_BASE) {
      if (offset + 8 > buffer.length) break
      const payload = buffer.readUInt32LE(offset + 4)
      spans.push({ offset, size: 8 + payload, skippable: true })
      offset += 8 + payload
      continue
    }
    if (magic !== ZSTD_MAGIC) break

    const descriptor = buffer[offset + 4]!
    const contentSizeFlag = (descriptor >> 6) & 3
    const singleSegment = (descriptor >> 5) & 1
    const hasChecksum = (descriptor >> 2) & 1
    const dictionaryIdFlag = descriptor & 3

    // Frame_Content_Size field size: flag 0 means one byte when the frame is
    // single-segment (nothing when it is not), flag 1 means two bytes whose
    // value carries a 256 offset, flags 2 and 3 mean four and eight bytes.
    let contentSizeBytes: number
    if (contentSizeFlag === 0) contentSizeBytes = singleSegment === 1 ? 1 : 0
    else if (contentSizeFlag === 1) contentSizeBytes = 2
    else if (contentSizeFlag === 2) contentSizeBytes = 4
    else contentSizeBytes = 8
    const dictionarySizeBytes = [0, 1, 2, 4][dictionaryIdFlag]!
    let headerSize = 1
    if (singleSegment === 0) headerSize += 1
    headerSize += dictionarySizeBytes + contentSizeBytes

    // The recorded content size is the DECODED size; it does not say how many
    // bytes the frame occupies (a compressed block stores fewer, and every
    // block carries its own 3-byte header). So the frame length always comes
    // from walking the data blocks; the content-size field only contributes
    // its own width to the frame header.
    let cursor = offset + 4 + headerSize
    let complete = false
    while (cursor + 3 <= buffer.length) {
      const blockHeader = readUint24(buffer, cursor)
      const isLast = blockHeader & 1
      const blockType = (blockHeader >> 1) & 3
      const blockSize = blockHeader >> 3
      cursor += 3
      if (blockType === 3) break // reserved: the frame is unreadable
      if (blockType === 1) cursor += 1 // RLE: one literal byte
      else cursor += blockSize // raw or compressed payload
      if (isLast === 1) {
        complete = true
        break
      }
    }
    if (!complete) break
    if (hasChecksum === 1) cursor += 4
    const size = cursor - offset

    if (size <= 0 || offset + size > buffer.length) break
    spans.push({ offset, size, skippable: false })
    offset += size
  }
  return spans
}

/** Decode one artifact into its JSONL lines, tolerating an unreadable frame. */
export function decodeArtifact(buffer: Buffer): { lines: string[]; frames: number; unreadable: number } {
  const lines: string[] = []
  let unreadable = 0
  const spans = frameSpans(buffer)
  for (const span of spans) {
    if (span.skippable) continue
    let text: string
    try {
      text = zstdDecompressSync(buffer.subarray(span.offset, span.offset + span.size)).toString('utf8')
    } catch {
      unreadable += 1
      continue
    }
    for (const line of text.split('\n')) if (line.trim().length > 0) lines.push(line)
  }
  return { lines, frames: spans.length, unreadable }
}

/** The newest log generation inside one session directory, if any. */
export function newestLogFile(directory: string): string | undefined {
  let newest: string | undefined
  let newestName = ''
  for (const name of readdirSync(directory)) {
    if (!LOG_FILENAME.test(name)) continue
    if (name <= newestName) continue
    const candidate = join(directory, name)
    try {
      if (!statSync(candidate).isFile()) continue
    } catch {
      continue
    }
    newest = candidate
    newestName = name
  }
  return newest
}

/**
 * Read one session's events straight off disk.
 *
 * @param sessionsRoot - the persistence root holding the per-project directories.
 * @param sessionId - the session directory name (already a single path segment).
 * @returns the parsed events of the newest generation.
 * @throws when the session has no readable log file.
 */
export function readSessionLogFile(sessionsRoot: string, sessionId: string): { events: FoldEvent[]; frames: number; unreadable: number } {
  for (const project of readdirSync(sessionsRoot)) {
    const directory = join(sessionsRoot, project, sessionId)
    let isDirectory = false
    try {
      isDirectory = statSync(directory).isDirectory()
    } catch {
      continue
    }
    if (!isDirectory) continue
    const file = newestLogFile(directory)
    if (file === undefined) continue
    const buffer = readFileSync(file)
    const raw = buffer.subarray(0, 4)
    const compressed = raw.length === 4 && raw.readUInt32LE(0) === ZSTD_MAGIC
    const { lines, frames, unreadable } = compressed
      ? decodeArtifact(buffer)
      : { lines: buffer.toString('utf8').split('\n').filter((line) => line.trim().length > 0), frames: 1, unreadable: 0 }
    const events: FoldEvent[] = []
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as FoldEvent)
      } catch {
        /* one damaged line never discards the rest of the log */
      }
    }
    return { events, frames, unreadable }
  }
  throw new Error(`no log file for session "${sessionId}" under ${sessionsRoot}`)
}
