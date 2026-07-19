const fs = require('fs')
const path = require('path')

function getAudioDurationMs(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const buffer = fs.readFileSync(filePath)

  if (ext === '.wav') return readWavDurationMs(buffer)
  if (ext === '.mp3') return readMp3DurationMs(buffer)
  if (ext === '.ogg') return readOggDurationMs(buffer)

  return null
}

function readWavDurationMs(buffer) {
  if (buffer.length < 44) return null
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') return null

  let offset = 12
  let byteRate = null
  let dataSize = null

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8

    if (chunkId === 'fmt ' && chunkStart + 16 <= buffer.length) {
      byteRate = buffer.readUInt32LE(chunkStart + 8)
    } else if (chunkId === 'data') {
      dataSize = chunkSize
    }

    offset = chunkStart + chunkSize + (chunkSize % 2)
  }

  if (!byteRate || !dataSize) return null
  return Math.round((dataSize / byteRate) * 1000)
}

function readMp3DurationMs(buffer) {
  let offset = skipId3v2(buffer)
  let durationSeconds = 0
  let frameCount = 0

  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1
      continue
    }

    const frame = parseMp3FrameHeader(buffer, offset)
    if (!frame) {
      offset += 1
      continue
    }

    durationSeconds += frame.samplesPerFrame / frame.sampleRate
    frameCount += 1
    offset += frame.frameLength
  }

  return frameCount ? Math.round(durationSeconds * 1000) : null
}

function skipId3v2(buffer) {
  if (buffer.length < 10 || buffer.toString('ascii', 0, 3) !== 'ID3') return 0

  const size = (
    ((buffer[6] & 0x7f) << 21) |
    ((buffer[7] & 0x7f) << 14) |
    ((buffer[8] & 0x7f) << 7) |
    (buffer[9] & 0x7f)
  )
  const footerSize = (buffer[5] & 0x10) ? 10 : 0
  return Math.min(10 + size + footerSize, buffer.length)
}

function parseMp3FrameHeader(buffer, offset) {
  const b1 = buffer[offset + 1]
  const b2 = buffer[offset + 2]
  const b3 = buffer[offset + 3]
  const versionBits = (b1 >> 3) & 0x03
  const layerBits = (b1 >> 1) & 0x03
  const bitrateIndex = (b2 >> 4) & 0x0f
  const sampleRateIndex = (b2 >> 2) & 0x03
  const padding = (b2 >> 1) & 0x01

  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return null
  }

  const version = versionBits === 3 ? '1' : (versionBits === 2 ? '2' : '2.5')
  const layer = layerBits === 3 ? 1 : (layerBits === 2 ? 2 : 3)
  const bitrate = getMp3Bitrate(version, layer, bitrateIndex)
  const sampleRate = getMp3SampleRate(version, sampleRateIndex)
  const samplesPerFrame = getMp3SamplesPerFrame(version, layer)
  if (!bitrate || !sampleRate || !samplesPerFrame) return null

  const frameLength = layer === 1
    ? Math.floor(((12 * bitrate * 1000 / sampleRate) + padding) * 4)
    : Math.floor(((version === '1' ? 144 : 72) * bitrate * 1000 / sampleRate) + padding)

  if (frameLength <= 4) return null
  return { frameLength, sampleRate, samplesPerFrame }
}

function getMp3Bitrate(version, layer, index) {
  const table = {
    '1:1': [null, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    '1:2': [null, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    '1:3': [null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    '2:1': [null, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    '2:2': [null, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    '2:3': [null, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  }
  const key = version === '1' ? `1:${layer}` : `2:${layer}`
  return table[key] && table[key][index]
}

function getMp3SampleRate(version, index) {
  const table = {
    '1': [44100, 48000, 32000],
    '2': [22050, 24000, 16000],
    '2.5': [11025, 12000, 8000]
  }
  return table[version] && table[version][index]
}

function getMp3SamplesPerFrame(version, layer) {
  if (layer === 1) return 384
  if (layer === 2) return 1152
  return version === '1' ? 1152 : 576
}

function readOggDurationMs(buffer) {
  const sampleRate = readVorbisSampleRate(buffer)
  if (!sampleRate) return null

  let offset = 0
  let lastGranule = null

  while (offset + 27 <= buffer.length) {
    if (buffer.toString('ascii', offset, offset + 4) !== 'OggS') {
      offset += 1
      continue
    }

    const pageSegments = buffer[offset + 26]
    if (offset + 27 + pageSegments > buffer.length) break

    const granule = readUInt64LE(buffer, offset + 6)
    if (granule >= 0) lastGranule = granule

    let pageSize = 27 + pageSegments
    for (let i = 0; i < pageSegments; i += 1) {
      pageSize += buffer[offset + 27 + i]
    }
    offset += pageSize
  }

  if (lastGranule === null) return null
  return Math.round((lastGranule / sampleRate) * 1000)
}

function readVorbisSampleRate(buffer) {
  const signature = Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73])
  const packetOffset = buffer.indexOf(signature)
  if (packetOffset < 0 || packetOffset + 16 > buffer.length) return null
  return buffer.readUInt32LE(packetOffset + 12) || null
}

function readUInt64LE(buffer, offset) {
  if (offset + 8 > buffer.length) return -1
  const value = buffer.readBigUInt64LE(offset)
  if (value === BigInt('0xffffffffffffffff')) return -1
  return Number(value)
}

module.exports = {
  getAudioDurationMs
}
