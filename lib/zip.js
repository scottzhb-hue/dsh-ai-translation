/**
 * 最小 ZIP 打包器：只做 store（不压缩），足够交付包里放 docx / csv / txt。
 *
 * 之所以不引第三方：交付包必须在任何机器上零依赖可用，而 store 模式写出的
 * zip 被 Windows 资源管理器、macOS 归档工具和 unzip 全部接受。代价是包体
 * 略大（docx 本身已是 zip，语言类文本的膨胀在可接受范围内）。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosStamp(date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f),
  }
}

function fileNameBytes(name) {
  // 统一用 UTF-8 并置位通用标志位 11（0x0800），中文文件名在任何解压工具里都不乱码。
  return Buffer.from(String(name).replace(/\\/g, '/'), 'utf8')
}

/**
 * @param {Array<{ name: string, data: Buffer | string, date?: Date }>} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  const files = entries.filter((entry) => entry && entry.name).map((entry) => {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8')
    return { name: fileNameBytes(entry.name), data, stamp: dosStamp(entry.date ?? new Date()), crc: crc32(data) }
  })

  const chunks = []
  const central = []
  let offset = 0

  for (const file of files) {
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x0800, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(file.stamp.time, 10)
    header.writeUInt16LE(file.stamp.date, 12)
    header.writeUInt32LE(file.crc, 14)
    header.writeUInt32LE(file.data.length, 18)
    header.writeUInt32LE(file.data.length, 22)
    header.writeUInt16LE(file.name.length, 26)
    header.writeUInt16LE(0, 28)
    chunks.push(header, file.name, file.data)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x0800, 8)
    entry.writeUInt16LE(0, 10)
    entry.writeUInt16LE(file.stamp.time, 12)
    entry.writeUInt16LE(file.stamp.date, 14)
    entry.writeUInt32LE(file.crc, 16)
    entry.writeUInt32LE(file.data.length, 20)
    entry.writeUInt32LE(file.data.length, 24)
    entry.writeUInt16LE(file.name.length, 28)
    entry.writeUInt16LE(0, 30)
    entry.writeUInt16LE(0, 32)
    entry.writeUInt16LE(0, 34)
    entry.writeUInt16LE(0, 36)
    entry.writeUInt32LE(0, 38)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, file.name)

    offset += header.length + file.name.length + file.data.length
  }

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, centralBuffer, end])
}
