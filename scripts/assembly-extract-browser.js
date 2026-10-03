/** Inspect the original runtime's prepared assembly, without executing its shaders.
 * The vertex records carry baked world positions and normals. Their 96-byte
 * stride also includes native animation/morph data; this export preserves the
 * base mesh only. Header values without verified semantics remain raw fields.
 */
function extractOrbitAssembly(input, options = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start, size) => String.fromCharCode(...bytes.subarray(start, start + size));
  const u32 = (offset) => view.getUint32(offset, true);
  const f32 = (offset) => view.getFloat32(offset, true);
  const vector = (offset, count) => Array.from({ length: count }, (_, n) => f32(offset + n * 4));
  const isHex = (n) => (n >= 48 && n <= 57) || (n >= 97 && n <= 102);
  const records = [];
  for (let offset = 4; offset + 68 < bytes.length; offset += 1) {
    if (!isHex(bytes[offset]) || !isHex(bytes[offset + 63]) || bytes[offset + 64] !== 58) continue;
    const size = u32(offset - 4);
    if (size < 65 || size > 2048 || offset + size + 4 >= bytes.length) continue;
    const key = text(offset, size);
    if (!/^[0-9a-f]{64}:[ -~]+$/.test(key)) continue;
    const vertexCount = u32(offset + size);
    if (vertexCount < 3 || vertexCount > 1000000) continue;
    const vertexStart = offset + size + 4;
    const vertexEnd = vertexStart + vertexCount * 96;
    if (vertexEnd + 8 > bytes.length) continue;
    const largeCount = u32(vertexEnd);
    const smallCountOffset = vertexEnd + 4 + largeCount * 4;
    if (largeCount > 6000000 || smallCountOffset + 4 > bytes.length) continue;
    const smallCount = u32(smallCountOffset);
    const indexStart = largeCount ? vertexEnd + 4 : smallCountOffset + 4;
    const indexCount = largeCount || smallCount;
    const width = largeCount ? 4 : 2;
    if (!indexCount || indexCount % 3 || indexCount > 6000000 || indexStart + indexCount * width > bytes.length) continue;
    let name = '', header = -1;
    // Fixed 266-byte native record header precedes a length-prefixed label.
    for (let length = 0; length <= 96; length += 1) {
      const nameSizeAt = offset - 9 - length;
      const start = nameSizeAt - 266;
      if (start < 0 || u32(nameSizeAt) !== length || bytes[offset - 5] !== 1 || u32(start) > 16) continue;
      const value = text(nameSizeAt + 4, length);
      if (!/^[a-z0-9_ -]*$/.test(value)) continue;
      name = value;
      header = start;
      break;
    }
    if (header < 0) {
      // Attachment labels occur before their transform fields instead.
      for (let length = 1; length <= 96; length += 1) {
        const start = offset - 4 - 271 - length;
        if (start < 0 || u32(start) > 16 || u32(start + 84) !== length || bytes[offset - 5] !== 1) continue;
        const value = text(start + 88, length);
        if (!/^[a-z0-9_ -]+$/.test(value)) continue;
        name = value;
        header = start;
        break;
      }
    }
    const isBody = key.includes(':body:');
    const position = new Array(vertexCount * 3);
    const normal = new Array(vertexCount * 3);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let valid = true;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = f32(vertexStart + vertex * 96 + axis * 4);
        const norm = f32(vertexStart + vertex * 96 + 12 + axis * 4);
        if (!Number.isFinite(value) || Math.abs(value) > 1000 || !Number.isFinite(norm) || Math.abs(norm) > 1.001) valid = false;
        position[vertex * 3 + axis] = value;
        normal[vertex * 3 + axis] = norm;
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
    const index = new Array(indexCount);
    for (let i = 0; i < indexCount; i += 1) {
      index[i] = width === 2 ? view.getUint16(indexStart + i * 2, true) : u32(indexStart + i * 4);
      if (index[i] >= vertexCount) valid = false;
    }
    if (!valid) throw new Error(`Invalid prepared mesh ${name || key.slice(0, 8)}`);
    const record = {
      key, name, isBody, vertexCount, indexCount,
      bounds: { min, max, size: max.map((value, i) => value - min[i]), center: max.map((value, i) => (value + min[i]) / 2) },
      color: header >= 0 ? vector(header + 4, 3) : [0.12, 0.12, 0.12],
      nativeAnchor: header >= 0 ? vector(header + 16, 3) : null,
      nativeMaterialFields: header >= 0 ? vector(header + 28, 8) : null,
      position, normal, index,
    };
    if (isBody && !options.includeBody) {
      record.position = undefined;
      record.normal = undefined;
      record.index = undefined;
    }
    records.push(record);
    offset = vertexEnd - 1;
  }
  if (!records.some((record) => record.isBody)) throw new Error('Prepared assembly contains no validated body record');
  return { schemaVersion: 1, source: 'original-orbit-native-prepared-assembly', coordinateSystem: 'x right, y up, z front; native world positions baked', nativeVertexStride: 96, records };
}
