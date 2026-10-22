// 诊断：列出所有设备及其 alive/running 状态；聚合设备额外列出子设备状态
import CoreAudio
import Foundation

func devices() -> [AudioDeviceID] {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == 0 else { return [] }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == 0 else { return [] }
  return ids
}
func name(_ d: AudioDeviceID) -> String {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var n: CFString? = nil
  var size = UInt32(MemoryLayout<CFString?>.size)
  let st = withUnsafeMutablePointer(to: &n) { AudioObjectGetPropertyData(d, &addr, 0, nil, &size, $0) }
  guard st == 0, let s = n else { return "(noname)" }
  return s as String
}
func u32(_ d: AudioDeviceID, _ sel: AudioObjectPropertySelector) -> UInt32? {
  var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var v: UInt32 = 0
  var size = UInt32(MemoryLayout<UInt32>.size)
  guard AudioObjectGetPropertyData(d, &addr, 0, nil, &size, &v) == 0 else { return nil }
  return v
}
func outChannels(_ d: AudioDeviceID) -> Int {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioObjectPropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(d, &addr, 0, nil, &size) == 0 else { return -1 }
  let buf = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 8).bindMemory(to: AudioBufferList.self, capacity: 1)
  defer { buf.deallocate() }
  guard AudioObjectGetPropertyData(d, &addr, 0, nil, &size, buf) == 0 else { return -1 }
  let list = UnsafeMutableAudioBufferListPointer(buf)
  var ch = 0
  for b in list { ch += Int(b.mNumberChannels) }
  return ch
}
func subDevices(_ d: AudioDeviceID) -> [AudioDeviceID] {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyOwnedObjects, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(d, &addr, 0, nil, &size) == 0, size > 0 else { return [] }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(d, &addr, 0, nil, &size, &ids) == 0 else { return [] }
  return ids
}
let lines = devices().map { d -> String in
  let alive = u32(d, kAudioDevicePropertyDeviceIsAlive).map(String.init) ?? "?"
  let running = u32(d, kAudioDevicePropertyDeviceIsRunning).map(String.init) ?? "?"
  let hidden = u32(d, kAudioObjectPropertyElementMain == 0 ? kAudioDevicePropertyDeviceIsRunning : kAudioDevicePropertyDeviceCanBeDefaultDevice).map(String.init) ?? "-"
  let channels = outChannels(d)
  var s = "id=\(d) name=\(name(d)) alive=\(alive) running=\(running) canBeDefault=\(hidden) outCh=\(channels) transport=\(u32(d, kAudioDevicePropertyTransportType).map(String.init) ?? "?")"
  let subs = subDevices(d)
  if !subs.isEmpty {
    s += " subs=[\(subs.map { "\(name($0))(alive=\(u32($0, kAudioDevicePropertyDeviceIsAlive).map(String.init) ?? "?"))" }.joined(separator: ", "))]"
  }
  return s
}
print(lines.joined(separator: "\n"))
