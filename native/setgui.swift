// 验证：以 GUI app 包身份设置默认输出是否生效（命令行身份实测无效）
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
  guard st == 0, let s = n else { return "" }
  return s as String
}
func currentID() -> AudioDeviceID {
  var dev = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev) == 0 else { return 0 }
  return dev
}
func setDefault(_ d: AudioDeviceID) -> OSStatus {
  var dev = d
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  return AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, UInt32(MemoryLayout<AudioDeviceID>.size), &dev)
}

let needle = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "多输出"
let target = devices().first(where: { name($0).contains(needle) })
var lines: [String] = []
lines.append("before=\(name(currentID())) target=\(target.map(name) ?? "NOMATCH") id=\(target.map(String.init) ?? "-")")
if let t = target {
  let st = setDefault(t)
  lines.append("setStatus=\(st)")
  Thread.sleep(forTimeInterval: 1.0)
  lines.append("after=\(name(currentID()))")
}
let out = lines.joined(separator: "\n") + "\n"
print(out)
try? out.write(toFile: "/tmp/setroute_gui.log", atomically: true, encoding: .utf8)
